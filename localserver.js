// Servidor local HTTP + WebSocket para uma extensão Chrome própria.
// Entrega: (1) os Gmails disponíveis (verdes) e (2) push em tempo real de
// {email, code} sempre que um Gmail recebe um código novo.
// Fica preso em 127.0.0.1 e exige um token — códigos de Gmail são sensíveis.
const http = require('http')
const crypto = require('crypto')

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function sha1accept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

// Codifica um frame de texto (servidor -> cliente, SEM máscara).
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const n = payload.length
  let header
  if (n < 126) { header = Buffer.from([0x81, n]) }
  else if (n < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(n, 2) }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(n), 2) }
  return Buffer.concat([header, payload])
}

class LocalServer {
  // provider: { available(), accounts(), codesFor(email), latestFor(email) }
  constructor(provider, log) {
    this.provider = provider
    this.log = log || (() => {})
    this.server = null
    this.clients = new Set()
    this.port = 8777
    this.token = ''
    this.enabled = false
  }

  start({ port, token, enabled }) {
    this.port = Number(port) || 8777
    this.token = token || ''
    this.enabled = enabled !== false
    this.stop()
    if (!this.enabled) { this.log('info', 'Servidor local desligado nas configurações.'); return }

    this.server = http.createServer((req, res) => this._onRequest(req, res))
    this.server.on('upgrade', (req, socket) => this._onUpgrade(req, socket))
    this.server.on('error', (e) => this.log('error', `Servidor local: ${e.message}`))
    this.server.listen(this.port, '127.0.0.1', () => {
      this.log('ok', `Servidor local no ar em http://127.0.0.1:${this.port} (API para a extensão).`)
    })
  }

  stop() {
    for (const c of this.clients) { try { c.destroy() } catch { /* ignore */ } }
    this.clients.clear()
    if (this.server) { try { this.server.close() } catch { /* ignore */ } this.server = null }
  }

  _checkToken(req, url) {
    if (!this.token) return true
    const q = url.searchParams.get('token')
    const h = req.headers['x-token'] || ''
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    return q === this.token || h === this.token || auth === this.token
  }

  _send(res, code, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Token, Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      // Permite que uma página pública (instagram.com) fale com a API no
      // loopback (Private Network Access). Sem isto o Chrome bloqueia o fetch.
      'Access-Control-Allow-Private-Network': 'true'
    })
    res.end(body)
  }

  _onRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`)
    if (req.method === 'OPTIONS') return this._send(res, 204, {})
    if (url.pathname === '/health') return this._send(res, 200, { ok: true, service: 'flash-creator', port: this.port })

    if (!this._checkToken(req, url)) return this._send(res, 401, { error: 'token inválido ou ausente' })

    // A extensão pede pra comprar um Gmail (ex.: cota do atual esgotada).
    if (req.method === 'POST' && url.pathname === '/api/flow/buy') {
      let raw = ''
      req.on('data', (d) => { raw += d; if (raw.length > 8192) req.destroy() })
      req.on('end', async () => {
        let body = {}
        try { body = raw ? JSON.parse(raw) : {} } catch { body = {} }
        const serviceId = body.service_id || url.searchParams.get('service_id') || undefined
        const maxRaw = body.max_price_cents != null ? body.max_price_cents : url.searchParams.get('max_price_cents')
        const maxPriceCents = (maxRaw != null && maxRaw !== '') ? Number(maxRaw) : undefined
        if (!this.provider.flowBuy) return this._send(res, 501, { error: 'compra indisponível' })
        try {
          const r = await this.provider.flowBuy({ serviceId, maxPriceCents })
          if (r.error) return this._send(res, 400, { error: r.error })
          return this._send(res, 200, { ok: true, order: r.order })
        } catch (e) { return this._send(res, 500, { error: e.message }) }
      })
      return
    }

    try {
      if (url.pathname === '/api/available') return this._send(res, 200, { available: this.provider.available() })
      if (url.pathname === '/api/accounts') return this._send(res, 200, { accounts: this.provider.accounts() })
      if (url.pathname === '/api/codes') {
        const email = url.searchParams.get('email')
        return this._send(res, 200, { codes: this.provider.codesFor(email) })
      }
      if (url.pathname === '/api/latest') {
        const email = url.searchParams.get('email')
        return this._send(res, 200, { latest: this.provider.latestFor(email) })
      }
      // ---- Números SMS (AllanSMS) ----
      if (url.pathname === '/api/sms') return this._send(res, 200, { sms: this.provider.smsActive ? this.provider.smsActive() : [] })
      if (url.pathname === '/api/sms/latest') return this._send(res, 200, { latest: this.provider.smsLatest ? this.provider.smsLatest() : null })
      // ---- Gmail comprados (FlowOTP) ----
      if (url.pathname === '/api/flow') return this._send(res, 200, { flow: this.provider.flowActive ? this.provider.flowActive() : [] })
      if (url.pathname === '/api/flow/latest') return this._send(res, 200, { latest: this.provider.flowLatest ? this.provider.flowLatest() : null })
    } catch (e) { return this._send(res, 500, { error: e.message }) }
    return this._send(res, 404, { error: 'rota desconhecida' })
  }

  _onUpgrade(req, socket) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`)
    if (url.pathname !== '/ws' || !this._checkToken(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
    }
    const key = req.headers['sec-websocket-key']
    if (!key) { socket.destroy(); return }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${sha1accept(key)}\r\n\r\n`
    )
    this.clients.add(socket)
    this.log('info', `Extensão conectada ao WebSocket (${this.clients.size} ativa(s)).`)
    socket.on('data', (buf) => { if (buf.length && (buf[0] & 0x0f) === 0x8) socket.destroy() }) // close frame
    socket.on('close', () => { this.clients.delete(socket); })
    socket.on('error', () => { this.clients.delete(socket) })
    // snapshot inicial: Gmails verdes + números SMS ativos + Gmails comprados ativos
    this._write(socket, {
      type: 'snapshot',
      available: this.provider.available(),
      sms: this.provider.smsActive ? this.provider.smsActive() : [],
      flow: this.provider.flowActive ? this.provider.flowActive() : []
    })
  }

  _write(socket, obj) {
    try { socket.write(encodeFrame(JSON.stringify(obj))) } catch { this.clients.delete(socket) }
  }

  broadcast(obj) { for (const c of this.clients) this._write(c, obj) }

  // chamado pelo main quando chega um código novo
  pushCode(email, code, extra = {}) {
    this.broadcast({ type: 'code', email, code, ...extra })
  }
  // chamado quando a lista de disponíveis muda (status/add/remove)
  pushAvailable() {
    this.broadcast({ type: 'available', available: this.provider.available() })
  }
  // chamado quando um número SMS recebe o código OTP
  pushSms(order) {
    this.broadcast({
      type: 'sms', order_id: order.id, phone: order.phone || '', code: order.sms_code || '',
      service: order.service || '', country: order.country || '', status: order.status || ''
    })
  }
  // chamado quando a lista de números SMS ativos muda (compra/encerra)
  pushSmsAvailable() {
    this.broadcast({ type: 'sms_available', sms: this.provider.smsActive ? this.provider.smsActive() : [] })
  }
  // chamado quando um Gmail comprado (FlowOTP) recebe um código OTP
  pushFlow(o) {
    this.broadcast({ type: 'flow', order_id: o.order_id, email: o.email || '', code: o.code || '', service_id: o.service_id || '' })
  }
  // chamado quando a lista de Gmails comprados ativos muda
  pushFlowAvailable() {
    this.broadcast({ type: 'flow_available', flow: this.provider.flowActive ? this.provider.flowActive() : [] })
  }
}

module.exports = { LocalServer }
