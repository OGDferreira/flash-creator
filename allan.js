// Cliente da API da Allan Proxys (fornecedor de proxies do Guilherme).
// Doc: https://allanproxys.com/minha-conta/api  — auth por Bearer token.
// A API NÃO devolve a senha da proxy, então o app guarda a senha à parte
// e a combina com login/host/porta vindos daqui.
const BASE = 'https://allanproxys.com'

async function req(base, apiKey, pathAndQuery, { method = 'GET', body } = {}) {
  const url = base.replace(/\/$/, '') + pathAndQuery
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30000)
  let res
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
  } catch (e) { clearTimeout(t); throw new Error(`sem conexão com a Allan Proxys: ${e.message}`) }
  clearTimeout(t)
  const raw = await res.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = { raw } }
  if (!res.ok) {
    const msg = (data && data.erro && data.erro.mensagem) || `HTTP ${res.status}`
    const err = new Error(msg); err.status = res.status; err.codigo = data && data.erro && data.erro.codigo
    throw err
  }
  return data
}

class AllanClient {
  constructor(apiKey, base = BASE) { this.apiKey = (apiKey || '').trim(); this.base = base || BASE }
  conta() { return req(this.base, this.apiKey, '/api/v1/conta') }
  proxies() { return req(this.base, this.apiKey, '/api/v1/proxies') }
  proxy(login) { return req(this.base, this.apiKey, `/api/v1/proxies/${encodeURIComponent(login)}`) }
  teste(login) { return req(this.base, this.apiKey, `/api/v1/proxies/${encodeURIComponent(login)}/teste`) }
  // Troca localização/servidor → rotaciona o IP da proxy. Precisa chave de configuração.
  config(login, patch) { return req(this.base, this.apiKey, `/api/v1/proxies/${encodeURIComponent(login)}/config`, { method: 'POST', body: patch || {} }) }
  localizacoes(pais, estado) {
    const q = new URLSearchParams(); if (pais) q.set('pais', pais); if (estado) q.set('estado', estado)
    return req(this.base, this.apiKey, `/api/v1/localizacoes${q.toString() ? '?' + q : ''}`)
  }
}

module.exports = { AllanClient, ALLAN_BASE: BASE }
