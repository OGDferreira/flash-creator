// Cliente da API FlowOTP (otpflow.site) — compra de Gmail que recebe OTP.
// Base https://otpflow.site/api/v1, auth por header X-API-Key. Valores em CENTAVOS.
// Doc: https://otpflow.site/llms.txt e /openapi.json. Sem webhook: recebimento por polling.
// req() NÃO lança em erro HTTP: devolve { status, ok, body, retryAfter } para o
// chamador aplicar as regras (202 processing vs erro, 503, poll_warning, etc).
const BASE = 'https://otpflow.site/api/v1'

async function req(base, apiKey, path, { method = 'GET', body, idempotencyKey, timeout = 45000 } = {}) {
  const url = base.replace(/\/$/, '') + path
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
  } catch (e) { clearTimeout(t); const err = new Error(`sem conexão com a FlowOTP: ${e.message}`); err.network = true; throw err }
  clearTimeout(t)
  const raw = await res.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = { raw } }
  const retryAfter = Number(res.headers.get('Retry-After')) || null
  return { status: res.status, ok: res.ok, body: data, retryAfter }
}

// Gera uma Idempotency-Key válida (^[a-zA-Z0-9_-]{8,100}$), única por compra nova.
function newIdempotencyKey(prefix = 'fc') {
  const rnd = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID().replace(/-/g, '') : Math.random().toString(16).slice(2) + Date.now().toString(16)
  return `${prefix}-${rnd}`.slice(0, 100)
}

class FlowOtpClient {
  constructor(apiKey, base = BASE) { this.apiKey = (apiKey || '').trim(); this.base = base || BASE }
  products() { return req(this.base, this.apiKey, '/products') }
  balance(serviceId) { return req(this.base, this.apiKey, '/balance' + (serviceId ? '?service_id=' + encodeURIComponent(serviceId) : '')) }
  listOrders({ limit = 30, offset = 0 } = {}) { return req(this.base, this.apiKey, `/orders?limit=${limit}&offset=${offset}`) }
  // Compra 1 unidade. Idempotency-Key OBRIGATÓRIA; a mesma chave recupera o mesmo pedido.
  createOrder({ serviceId, expectedPriceCents } = {}, idempotencyKey) {
    const body = { service_id: serviceId, quantity: 1 }
    if (expectedPriceCents != null) body.expected_price_cents = Math.round(Number(expectedPriceCents))
    return req(this.base, this.apiKey, '/orders', { method: 'POST', body, idempotencyKey })
  }
  getOrder(id) { return req(this.base, this.apiKey, `/orders/${encodeURIComponent(id)}`) } // estado, sem buscar código novo
  pollCode(id) { return req(this.base, this.apiKey, `/orders/${encodeURIComponent(id)}/code`) } // busca códigos (a cada 5s)
}

module.exports = { FlowOtpClient, FLOWOTP_BASE: BASE, newIdempotencyKey }
