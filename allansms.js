// Cliente da API da AllanSMS (números virtuais para receber SMS/OTP).
// Auth por Bearer token. Valores SEMPRE em centavos (inteiro) — nunca float.
// Doc do painel: https://allansms.com (painel › API). Base padrão:
const BASE = 'https://allansms.com/api/v1'

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// Faz a requisição com timeout e backoff em 429 (respeita Retry-After).
async function req(base, apiKey, pathAndQuery, { method = 'GET', body, idempotencyKey, timeoutMs = 30000, maxRetries = 3 } = {}) {
  const url = base.replace(/\/$/, '') + pathAndQuery
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      })
    } catch (e) { clearTimeout(t); throw new Error(`sem conexão com a AllanSMS: ${e.message}`) }
    clearTimeout(t)

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('Retry-After')) || (2 ** attempt)
      await sleep(Math.min(retryAfter, 30) * 1000)
      continue
    }
    const raw = await res.text()
    let data = {}
    try { data = raw ? JSON.parse(raw) : {} } catch { data = { raw } }
    if (!res.ok) {
      const errObj = data && data.error
      const msg = (errObj && errObj.message) || (typeof errObj === 'string' ? errObj : null) || (data && data.message) || `HTTP ${res.status}`
      const err = new Error(msg)
      err.status = res.status
      err.code = (errObj && errObj.code) || (data && data.code) || null
      throw err
    }
    return data
  }
}

const q = (params) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') s.set(k, v)
  const str = s.toString()
  return str ? '?' + str : ''
}

class AllanSmsClient {
  constructor(apiKey, base = BASE) { this.apiKey = (apiKey || '').trim(); this.base = base || BASE }
  _get(p, opts) { return req(this.base, this.apiKey, p, opts) }

  me() { return this._get('/me') }
  balance() { return this._get('/balance') }
  countries() { return this._get('/countries') }
  services(country, { server, all } = {}) { return this._get('/services' + q({ country, server, all: all ? 1 : undefined })) }
  servers(country, service) { return this._get('/servers' + q({ country, service })) }
  operators(country) { return this._get('/operators' + q({ country })) }
  catalog(country) { return this._get('/catalog' + q({ country })) }

  // Compra um número. Debita o saldo na hora; resposta traz phone e status.
  createOrder({ country, service, server, operator, maxPriceCents, externalId, metadata } = {}, idempotencyKey) {
    const body = { country, service }
    if (server) body.server = server
    if (operator) body.operator = operator
    if (maxPriceCents != null) body.max_price_cents = Math.round(Number(maxPriceCents))
    if (externalId) body.external_id = externalId
    if (metadata) body.metadata = metadata
    return req(this.base, this.apiKey, '/orders', { method: 'POST', body, idempotencyKey })
  }
  getOrder(id) { return this._get(`/orders/${encodeURIComponent(id)}`) }
  listOrders({ status, limit } = {}) { return this._get('/orders' + q({ status, limit })) }
  cancelOrder(id) { return req(this.base, this.apiKey, `/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' }) }
  finishOrder(id) { return req(this.base, this.apiKey, `/orders/${encodeURIComponent(id)}/finish`, { method: 'POST' }) }

  // Compra + polling até chegar o código OTP (ou timeout). Devolve o pedido.
  // onUpdate(order) é chamado a cada mudança; stop.stopped interrompe o polling.
  async buyNumber(service, country, { server, operator, maxPriceCents, timeoutMs = 300000, pollMs = 4000, idempotencyKey, onUpdate, stop } = {}) {
    const poll = Math.max(Number(pollMs) || 4000, 3000) // nunca mais rápido que 3s
    const key = idempotencyKey || ('fc-' + Date.now() + '-' + Math.random().toString(16).slice(2))
    const first = await this.createOrder({ country, service, server, operator, maxPriceCents }, key)
    let order = first.data || first
    if (onUpdate) onUpdate(order)
    const deadline = Date.now() + (Number(timeoutMs) || 300000)
    const FINAL = new Set(['completed', 'cancelled', 'expired', 'failed', 'refunded'])
    while (true) {
      if (order && order.sms_code) return order
      if (order && (order.is_final || FINAL.has(order.status))) return order
      if (stop && stop.stopped) return order
      if (Date.now() >= deadline) return order
      await sleep(poll)
      if (stop && stop.stopped) return order
      try { const r = await this.getOrder(order.id); order = r.data || r; if (onUpdate) onUpdate(order) }
      catch (e) { if (e.status === 404) return order; /* transitório: segue tentando */ }
    }
  }
}

module.exports = { AllanSmsClient, ALLANSMS_BASE: BASE }
