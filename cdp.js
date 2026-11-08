// Cliente mínimo do Chrome DevTools Protocol em Node puro (net + crypto),
// mais helpers de grade de janelas. Portado de cdp.py do dolphin-auto.
const net = require('net')
const crypto = require('crypto')
const http = require('http')

class CDPError extends Error {}

function httpJson(url, { method = 'GET', timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, timeout }, (res) => {
      let raw = ''
      res.on('data', (d) => (raw += d))
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new CDPError(`HTTP ${res.statusCode} em ${url}`))
        try { resolve(raw ? JSON.parse(raw) : {}) }
        catch { resolve(raw) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new CDPError('timeout')) })
    req.end()
  })
}

// Abre uma aba nova na porta de depuração (equivalente a PUT /json/new?url).
async function openTab(port, url, timeout = 10000) {
  const enc = encodeURIComponent(url)
  try {
    const r = await httpJson(`http://127.0.0.1:${port}/json/new?${enc}`, { method: 'PUT', timeout })
    return r && r.id ? r.id : null
  } catch (e) {
    // Chromium antigo só aceita GET nesse endpoint
    const r = await httpJson(`http://127.0.0.1:${port}/json/new?${enc}`, { method: 'GET', timeout })
    return r && r.id ? r.id : null
  }
}

async function activateTab(port, targetId, timeout = 10000) {
  await httpJson(`http://127.0.0.1:${port}/json/activate/${targetId}`, { timeout })
}

async function listPages(port, timeout = 2000) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json/list`, { timeout })
  return Array.isArray(tabs) ? tabs.filter((t) => t.type === 'page') : []
}

class CDP {
  constructor(sock) {
    this.sock = sock
    this._id = 0
    this._buf = Buffer.alloc(0)
    this._pending = new Map()
    this._closed = false
    sock.on('data', (chunk) => this._onData(chunk))
    sock.on('close', () => this._fail(new CDPError('conexão fechada pelo navegador')))
    sock.on('error', (e) => this._fail(e))
  }

  static connect(wsUrl, timeout = 10000) {
    return new Promise((resolve, reject) => {
      let u
      try { u = new URL(wsUrl) } catch { return reject(new CDPError('ws url inválida')) }
      const port = Number(u.port) || 80
      const sock = net.createConnection({ host: u.hostname, port, timeout })
      const key = crypto.randomBytes(16).toString('base64')
      let head = Buffer.alloc(0)
      let upgraded = false
      const onData = (chunk) => {
        head = Buffer.concat([head, chunk])
        const i = head.indexOf('\r\n\r\n')
        if (i < 0) return
        const status = head.slice(0, head.indexOf('\r\n')).toString()
        if (!status.includes(' 101 ')) {
          sock.destroy()
          return reject(new CDPError('handshake recusado: ' + status))
        }
        upgraded = true
        sock.removeListener('data', onData)
        const rest = head.slice(i + 4)
        const cdp = new CDP(sock)
        if (rest.length) cdp._onData(rest)
        sock.setTimeout(0)
        resolve(cdp)
      }
      sock.on('connect', () => {
        sock.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}:${port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        )
      })
      sock.on('data', onData)
      sock.on('timeout', () => { if (!upgraded) { sock.destroy(); reject(new CDPError('timeout no handshake')) } })
      sock.on('error', (e) => { if (!upgraded) reject(e) })
    })
  }

  _fail(err) {
    this._closed = true
    for (const { reject } of this._pending.values()) reject(err instanceof Error ? err : new CDPError(String(err)))
    this._pending.clear()
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk])
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this._buf.length < 2) return
      const b1 = this._buf[0]
      const b2 = this._buf[1]
      let n = b2 & 0x7f
      let offset = 2
      if (n === 126) { if (this._buf.length < 4) return; n = this._buf.readUInt16BE(2); offset = 4 }
      else if (n === 127) { if (this._buf.length < 10) return; n = Number(this._buf.readBigUInt64BE(2)); offset = 10 }
      if (this._buf.length < offset + n) return
      const payload = this._buf.slice(offset, offset + n)
      this._buf = this._buf.slice(offset + n)
      const opcode = b1 & 0x0f
      if (opcode === 0x8) { this._fail(new CDPError('o navegador fechou a conexão')); return }
      if (opcode === 0x9 || opcode === 0xa) continue // ping/pong
      let msg
      try { msg = JSON.parse(payload.toString('utf8')) } catch { continue }
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id)
        this._pending.delete(msg.id)
        if (msg.error) reject(new CDPError(`${msg.error.message || 'erro CDP'}`))
        else resolve(msg.result || {})
      }
    }
  }

  _send(text) {
    const payload = Buffer.from(text, 'utf8')
    const mask = crypto.randomBytes(4)
    const n = payload.length
    let header
    if (n < 126) header = Buffer.from([0x81, 0x80 | n])
    else if (n < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(n, 2) }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(n), 2) }
    const masked = Buffer.alloc(n)
    for (let i = 0; i < n; i++) masked[i] = payload[i] ^ mask[i % 4]
    this.sock.write(Buffer.concat([header, mask, masked]))
  }

  call(method, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (this._closed) return reject(new CDPError('conexão fechada'))
      this._id += 1
      const id = this._id
      this._pending.set(id, { resolve, reject })
      const t = setTimeout(() => {
        if (this._pending.has(id)) { this._pending.delete(id); reject(new CDPError(`${method}: timeout`)) }
      }, timeout)
      const wrap = (fn) => (v) => { clearTimeout(t); fn(v) }
      this._pending.set(id, { resolve: wrap(resolve), reject: wrap(reject) })
      try { this._send(JSON.stringify({ id, method, params })) }
      catch (e) { clearTimeout(t); this._pending.delete(id); reject(e) }
    })
  }

  close() {
    this._closed = true
    try { this.sock.destroy() } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- grade
function gridShape(perScreen) {
  let cols = Math.ceil(Math.sqrt(perScreen))
  let rows = Math.ceil(perScreen / cols)
  if (perScreen === 2) { cols = 2; rows = 1 }
  else if (perScreen === 3) { cols = 3; rows = 1 }
  else if (perScreen === 6) { cols = 3; rows = 2 }
  return [cols, rows]
}

function cellBounds(index, perScreen, area) {
  const { x, y, width: w, height: h } = area
  const [cols, rows] = gridShape(perScreen)
  const slot = index % perScreen
  const c = slot % cols
  const r = Math.floor(slot / cols)
  const cw = Math.floor(w / cols)
  const rh = Math.floor(h / rows)
  return { left: x + c * cw, top: y + r * rh, width: cw, height: rh }
}

async function placeWindow(port, bounds, timeout = 10000) {
  const version = await httpJson(`http://127.0.0.1:${port}/json/version`, { timeout })
  const cdp = await CDP.connect(version.webSocketDebuggerUrl, timeout)
  try {
    const { targetInfos } = await cdp.call('Target.getTargets')
    const page = (targetInfos || []).find((t) => t.type === 'page')
    if (!page) throw new CDPError('nenhuma aba encontrada para localizar a janela')
    const { windowId } = await cdp.call('Browser.getWindowForTarget', { targetId: page.targetId })
    await cdp.call('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    await cdp.call('Browser.setWindowBounds', { windowId, bounds })
    return windowId
  } finally { cdp.close() }
}

module.exports = { CDP, CDPError, httpJson, openTab, activateTab, listPages, gridShape, cellBounds, placeWindow }
