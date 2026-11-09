const { app, BrowserWindow, ipcMain, clipboard, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const dolphin = require('./dolphin')
const { LocalServer } = require('./localserver')
const { AllanClient, ALLAN_BASE } = require('./allan')
const { AllanSmsClient, ALLANSMS_BASE } = require('./allansms')
const { FlowOtpClient, FLOWOTP_BASE, newIdempotencyKey } = require('./flowotp')
const autoclick = require('./autoclick')

let mainWindow
let dataFile

const DEFAULT_CONFIG = {
  // Dolphin
  token: '', remote_api: dolphin.REMOTE_API, local_api: dolphin.LOCAL_API,
  name_pattern: 'Perfil {n}', next_number: 1, platform: 'windows', tags: '',
  delay: 1.0, start_urls: [], focus_index: 1, page_zoom: 80, tile: false, tile_count: 4,
  proxy_type: 'http',
  // Gmail status
  code_limit: 6, window_days: 4,
  // Servidor local (extensão)
  server_enabled: true, server_port: 8777, server_token: '',
  autoclick_enabled: true, // clica Enviar/Continuar/Permitir do Insta via CDP (clique real)
  // Allan Proxys (fornecedor de proxy via API)
  allan_key: '', allan_base: ALLAN_BASE, allan_password: '', allan_type: 'http',
  // AllanSMS (números virtuais p/ receber SMS/OTP)
  allansms_key: '', allansms_base: ALLANSMS_BASE, allansms_country: 'brazil', allansms_service: '',
  // FlowOTP (otpflow.site — Gmail que recebe OTP)
  flowotp_key: '', flowotp_base: FLOWOTP_BASE, flowotp_service: ''
}

const EMPTY = () => ({ accounts: [], codes: [], proxies: [], smsOrders: [], flowOrders: [], config: { ...DEFAULT_CONFIG }, partitionCounter: 0 })
let data = EMPTY()

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    data = Object.assign(EMPTY(), parsed)
    data.config = Object.assign({ ...DEFAULT_CONFIG }, data.config || {})
    if (!Array.isArray(data.smsOrders)) data.smsOrders = []
    if (!Array.isArray(data.flowOrders)) data.flowOrders = []
  } catch { data = EMPTY() }
  if (!data.config.server_token) data.config.server_token = crypto.randomBytes(16).toString('hex')
}

let _saveTimer = null
function saveData() {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => { try { fs.writeFileSync(dataFile, JSON.stringify(data, null, 2)) } catch (e) { log('error', 'Falha ao salvar: ' + e.message) } }, 120)
}

function log(level, msg) {
  try { mainWindow && mainWindow.webContents.send('log', { level, msg }) } catch { /* ignore */ }
  try {
    const logFile = path.join(app.getPath('userData'), 'log.txt')
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${msg}\n`)
  } catch { /* ignore */ }
}

// ------------------------------------------------------------ status dos Gmails
function windowMs() { return (Number(data.config.window_days) || 4) * 24 * 3600 * 1000 }
function codeLimit() { return Number(data.config.code_limit) || 6 }

function recentCount(email, now = Date.now()) {
  const w = windowMs()
  return data.codes.filter((c) => c.email === email && (now - new Date(c.ts).getTime()) < w).length
}

function statusOf(acc, now = Date.now()) {
  if (acc.manualStatus === 'red' || acc.manualStatus === 'green') {
    return { color: acc.manualStatus, manual: true, recent: recentCount(acc.email, now) }
  }
  const recent = recentCount(acc.email, now)
  return { color: recent >= codeLimit() ? 'red' : 'green', manual: false, recent }
}

function latestFor(email) { return data.codes.find((c) => c.email === email) || null }

// categoria de proxy a partir do nome do plano (p/ separar Mobile 4G de residencial)
function detectCategory(plano) {
  const s = String(plano || '').toLowerCase()
  if (/(mobile|4g|5g|m[oó]vel|movel|celular)/.test(s)) return 'mobile4g'
  if (/resid/.test(s)) return 'residencial'
  return 'outro'
}
function isMobile4g(p) { return (p.category || detectCategory(p.plano)) === 'mobile4g' }

// provider para o servidor local
const serverProvider = {
  available() {
    const now = Date.now()
    return data.accounts.filter((a) => statusOf(a, now).color === 'green').map((a) => ({ email: a.email, count: a.count || 0, in_use: isLeased(a.email) }))
  },
  accounts() {
    const now = Date.now()
    return data.accounts.map((a) => { const s = statusOf(a, now); return { email: a.email, status: s.color, manual: s.manual, count: a.count || 0, recent: s.recent, in_use: isLeased(a.email) } })
  },
  codesFor(email) { return (email ? data.codes.filter((c) => c.email === email) : data.codes).slice(0, 100) },
  latestFor(email) { return latestFor(email) },
  // Números SMS ativos (não finalizados) com telefone, e o último OTP de cada um.
  smsActive() {
    const FINAL = new Set(['completed', 'cancelled', 'expired', 'failed', 'refunded'])
    return data.smsOrders
      .filter((o) => o.phone && !(o.is_final || FINAL.has(o.status)))
      .map((o) => ({ order_id: o.id, phone: o.phone, service: o.service || '', country: o.country || '', status: o.status || '', code: o.sms_code || null }))
  },
  smsLatest() {
    const o = data.smsOrders.find((x) => x.sms_code)
    return o ? { order_id: o.id, phone: o.phone || '', code: o.sms_code, service: o.service || '', country: o.country || '', received_at: o.savedAt || '' } : null
  },
  // FlowOTP: Gmails ativos (não fechados) com o último código, cota e se ainda recebe código.
  flowActive() {
    return data.flowOrders
      .filter((o) => o.email && !o.closed && o.next_action !== 'closed' && !['refunded', 'failed'].includes(o.status) && o.mailbox_status !== 'inactive')
      .map((o) => {
        const q = o.code_quota || null
        const remaining = q ? (q.remaining != null ? q.remaining : Math.max(0, (q.limit || 3) - (q.used || 0))) : null
        return {
          order_id: o.order_id || o.intentId, email: o.email, service_id: o.service_id || '', status: o.status || '',
          code: o.lastCode || null, next_action: o.next_action || '',
          quota_used: q ? (q.used || 0) : null, quota_limit: q ? (q.limit || 3) : null, quota_remaining: remaining,
          exhausted: remaining === 0, // sem código disponível nesta janela de 24h
          in_use: isLeased(o.email) // reservado por um pedido da API até chegar o código
        }
      })
  },
  flowLatest() {
    const o = data.flowOrders.find((x) => x.lastCode)
    return o ? { order_id: o.order_id || o.intentId, email: o.email || '', code: o.lastCode, service_id: o.service_id || '', received_at: o.savedAt || '' } : null
  },
  // A extensão pede 1 Gmail: pega um livre e o marca "em uso" (ver leases).
  claim(clientId) { return claimEmail(clientId) },
  // A extensão pode liberar um Gmail que reservou mas não vai mais usar.
  release(email) { releaseLease(email); return { ok: true } },
  // A extensão pode pedir pra comprar outro Gmail (ex.: quando a cota do atual zera).
  flowBuy(opts) { return doFlowBuy(opts) }
}

const server = new LocalServer(serverProvider, log)
function startServer() { server.start({ port: data.config.server_port, token: data.config.server_token, enabled: data.config.server_enabled }) }

// ------------------------------------------------------- Gmail "em uso" (lease)
// Um Gmail entregue pela API (POST /api/claim) fica RESERVADO até receber o
// código dele. Assim, 2/3/4 pedidos simultâneos (vários perfis/pessoas) pegam
// Gmails DIFERENTES, nunca o mesmo. Preferência: Gmail normal (cadastrado à mão)
// primeiro; sem nenhum livre, compra na FlowOTP (e compra mais se a demanda
// concorrente exigir). Ao chegar o código, o app envia e LIBERA o Gmail.
const LEASE_TTL_MS = 10 * 60 * 1000  // 10 min sem código => solta sozinho (cadastro travou)
const WAITER_TTL_MS = 12 * 1000      // janela p/ medir a demanda concorrente
const BUY_COOLDOWN_MS = 2500         // intervalo mínimo entre compras automáticas
const leases = new Map()             // email -> { id, at, source }
const waiters = new Map()            // clientId -> timestamp (pedidos aguardando Gmail)
let lastAutoBuyAt = 0

function isLeased(email) { return Boolean(email) && leases.has(email) }
function leasedList() { return Array.from(leases.keys()) }
function emitLeases() { try { mainWindow && mainWindow.webContents.send('leases-update', leasedList()) } catch { /* ignore */ } }
function pushAvail() { try { server.pushAvailable(); server.pushFlowAvailable() } catch { /* ignore */ } }

function pruneLeases() {
  const now = Date.now()
  for (const [email, l] of leases) if (now - l.at > LEASE_TTL_MS) leases.delete(email)
  for (const [id, at] of waiters) if (now - at > WAITER_TTL_MS) waiters.delete(id)
}

// Libera um Gmail reservado (chamado quando o código dele chega, ou manualmente).
function releaseLease(email) {
  if (email && leases.delete(email)) { pushAvail(); emitLeases(); log('info', `Gmail ${email} liberado (voltou a ficar disponível).`) }
}

// Gmails livres, na ordem de preferência: normais (cadastrados à mão) e verdes,
// depois comprados (FlowOTP) com código ainda disponível. Exclui os já em uso.
function freeManual() {
  const now = Date.now()
  return data.accounts.filter((a) => statusOf(a, now).color === 'green' && !isLeased(a.email)).map((a) => a.email)
}
function freeFlow() {
  return serverProvider.flowActive().filter((g) => g.email && !g.exhausted && !isLeased(g.email)).map((g) => g.email)
}

// Entrega 1 Gmail livre e o marca "em uso" na hora (atômico: o Node roda este
// trecho sem ser interrompido, então dois pedidos simultâneos pegam e-mails
// diferentes). Sem nenhum livre: dispara compra conforme a demanda e pede espera.
function claimEmail(clientId) {
  pruneLeases()
  const manual = freeManual()
  const email = manual[0] || freeFlow()[0]
  if (email) {
    const source = manual.includes(email) ? 'manual' : 'flow'
    leases.set(email, { id: clientId || ('c-' + Date.now()), at: Date.now(), source })
    waiters.delete(clientId)
    pushAvail(); emitLeases()
    log('ok', `Gmail ${email} entregue à API e marcado "em uso".`)
    return { ok: true, email, source }
  }
  maybeAutoBuy(clientId)
  return { ok: false, waiting: true }
}

// Compra Gmail(s) quando o pool está vazio, na medida da demanda concorrente:
// nº de pedidos aguardando (waiters) menos os que já estão sendo preparados.
function maybeAutoBuy(clientId) {
  const now = Date.now()
  if (clientId) waiters.set(clientId, now)
  if (!flowKey()) return // sem chave da FlowOTP não dá pra comprar; fica só no pool normal
  const demanda = Math.max(waiters.size, 1)
  const emPreparo = data.flowOrders.filter((o) => !o.closed && !['refunded', 'failed'].includes(o.status) && !o.lastCode && !isLeased(o.email)).length
  if (demanda - emPreparo <= 0) return       // já tem Gmail suficiente a caminho
  if (now - lastAutoBuyAt < BUY_COOLDOWN_MS) return // não dispara compras em rajada
  lastAutoBuyAt = now
  doFlowBuy({}).then((r) => { if (r && r.error) log('warn', `Compra automática de Gmail: ${r.error}`) }).catch(() => {})
}

// ------------------------------------------------------------ códigos
function saveCode(email, code, subject, sender) {
  const now = Date.now()
  const dup = data.codes.find((c) => c.email === email && c.code === code && (now - new Date(c.ts).getTime()) < 60000)
  if (dup) return false
  const entry = { id: now, email, code, subject: subject || '', sender: sender || '', received_at: new Date().toLocaleString('pt-BR'), ts: new Date().toISOString() }
  data.codes.unshift(entry)
  if (data.codes.length > 1000) data.codes = data.codes.slice(0, 1000)
  const acc = data.accounts.find((a) => a.email === email)
  if (acc) acc.count = (acc.count || 0) + 1
  saveData()
  try { mainWindow && mainWindow.webContents.send('new-code', entry) } catch { /* ignore */ }
  // extensão: push do código + lista de disponíveis (o status pode ter virado vermelho)
  server.pushCode(email, code, { subject: entry.subject, sender: entry.sender, received_at: entry.received_at })
  server.pushAvailable()
  releaseLease(email) // chegou o código deste Gmail: libera a reserva "em uso"
  return true
}

// ------------------------------------------------------------ proxies (ProxyStore em JS)
const proxyStore = {
  get proxies() { return data.proxies },
  available() { return data.proxies.filter((p) => !p.used) },
  counts() { const used = data.proxies.filter((p) => p.used).length; return { free: data.proxies.length - used, used } },
  add(list) {
    const known = new Set(data.proxies.map(dolphin.proxyKey))
    let added = 0
    for (const p of list) { const k = dolphin.proxyKey(p); if (!known.has(k)) { data.proxies.push(p); known.add(k); added++ } }
    saveData(); return { added, dup: list.length - added }
  },
  markUsed(proxy, pid, name) { proxy.used = true; proxy.profile_id = String(pid); proxy.profile_name = name; proxy.used_at = new Date().toLocaleString('pt-BR'); saveData() },
  removeUnused() { const before = data.proxies.length; data.proxies = data.proxies.filter((p) => p.used); saveData(); return before - data.proxies.length },
  resetUsed() { for (const p of data.proxies) { p.used = false; p.profile_id = ''; p.profile_name = ''; p.used_at = '' } saveData() },
  clear() { const n = data.proxies.length; data.proxies = []; saveData(); return n }
}

// ------------------------------------------------------------ Dolphin: cliente, registro, espelhamento
function dolphinClient() {
  const c = data.config
  if (!c.token) return null
  return new dolphin.DolphinClient(c.token, c.remote_api || dolphin.REMOTE_API, c.local_api || dolphin.LOCAL_API)
}

const openRegistry = new Map() // profileId -> { id, name, port }
openRegistry.get = Map.prototype.get.bind(openRegistry)
const mirror = new dolphin.ProfileMirror(openRegistry, log)
let remoteIds = null
let currentStop = null

function registerOpen(id, name, port) {
  openRegistry.set(String(id), { id: String(id), name, port: Number(port) })
  try { mainWindow && mainWindow.webContents.send('profile-opened', { id: String(id), name, port: Number(port) }) } catch { /* ignore */ }
  // Clica os botões do Insta que exigem clique real (Enviar/Continuar/...) via CDP.
  if (data.config.autoclick_enabled !== false && Number(port)) {
    autoclick.watchProfile(Number(port), {
      log,
      isEnabled: () => data.config.autoclick_enabled !== false && openRegistry.has(String(id)),
    }).catch(() => {})
  }
}

function madeList() {
  let made = data.proxies.filter((p) => p.used && p.profile_id)
  if (remoteIds) made = made.filter((p) => remoteIds.has(String(p.profile_id)))
  made = made.slice().sort((a, b) => String(b.used_at).localeCompare(String(a.used_at)))
  return made.map((p) => ({ id: String(p.profile_id), name: p.profile_name, proxy: dolphin.proxyDisplay(p), used_at: p.used_at, open: openRegistry.has(String(p.profile_id)) }))
}

// ------------------------------------------------------------ AllanSMS (números/OTP)
function smsKey() { return (process.env.ALLANSMS_KEY || data.config.allansms_key || '').trim() }
function smsClient() { const k = smsKey(); return k ? new AllanSmsClient(k, data.config.allansms_base || ALLANSMS_BASE) : null }

const smsPollers = new Map() // orderId -> stop flag

function emitSms(order) { try { mainWindow && mainWindow.webContents.send('sms-update', order) } catch { /* ignore */ } }

// Salva/atualiza um pedido no store local (histórico que o usuário vê).
function upsertSmsOrder(order) {
  if (!order || !order.id) return
  const i = data.smsOrders.findIndex((o) => String(o.id) === String(order.id))
  const prev = i >= 0 ? data.smsOrders[i] : {}
  const merged = { ...prev, ...order, savedAt: new Date().toLocaleString('pt-BR') }
  if (i >= 0) data.smsOrders[i] = merged; else data.smsOrders.unshift(merged)
  if (data.smsOrders.length > 300) data.smsOrders = data.smsOrders.slice(0, 300)
  saveData()
  emitSms(merged)
  // extensão: push do OTP quando chega um código novo, e da lista de números ativos
  try {
    if (merged.sms_code && merged.sms_code !== prev.sms_code) server.pushSms(merged)
    server.pushSmsAvailable()
  } catch { /* ignore */ }
  return merged
}

const SMS_FINAL = new Set(['completed', 'cancelled', 'expired', 'failed', 'refunded'])

// Faz polling de um pedido até chegar o código ou virar final. Não bloqueia o IPC.
async function startSmsPoll(client, orderId, { timeoutMs = 20 * 60 * 1000, pollMs = 4000 } = {}) {
  if (smsPollers.has(String(orderId))) return
  const stop = { stopped: false }
  smsPollers.set(String(orderId), stop)
  const deadline = Date.now() + timeoutMs
  const poll = Math.max(pollMs, 3000)
  try {
    while (!stop.stopped && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, poll))
      if (stop.stopped) break
      let order
      try { const r = await client.getOrder(orderId); order = r.data || r }
      catch (e) { if (e.status === 404) break; continue }
      upsertSmsOrder(order)
      if (order.sms_code) { log('ok', `AllanSMS: código ${order.sms_code} recebido no número ${order.phone || orderId}.`); break }
      if (order.is_final || SMS_FINAL.has(order.status)) { log('info', `AllanSMS: pedido ${orderId} finalizou (${order.status}).`); break }
    }
  } finally { smsPollers.delete(String(orderId)) }
}

// ------------------------------------------------------------ FlowOTP (Gmail/OTP)
function flowKey() { return (process.env.FLOWOTP_API_KEY || data.config.flowotp_key || '').trim() }
function flowClient() { const k = flowKey(); return k ? new FlowOtpClient(k, data.config.flowotp_base || FLOWOTP_BASE) : null }

const flowPollers = new Map() // order_id (ou intentId) -> stop flag
const FLOW_CLOSED_STATUS = new Set(['refunded', 'failed'])

function emitFlow(order) { try { mainWindow && mainWindow.webContents.send('flow-update', order) } catch { /* ignore */ } }

function findFlowIntent(order) {
  // casa pelo id do pedido; se ainda não tem, casa pela chave de idempotência
  return data.flowOrders.find((o) => (order.id && o.order_id === order.id) || (order.idempotencyKey && o.idempotencyKey === order.idempotencyKey) || (order.intentId && o.intentId === order.intentId))
}

// Mescla o Order da API no registro local da intenção e detecta códigos NOVOS
// (pelo valor, não por codes.length — mesmo valor conta uma vez por pedido).
function upsertFlowOrder(apiOrder, intentRef) {
  const rec = intentRef || findFlowIntent(apiOrder) || {}
  const seen = new Set(rec.seenCodes || [])
  const codes = Array.isArray(apiOrder.codes) ? apiOrder.codes : (rec.codes || [])
  const fresh = []
  for (const c of codes) { const v = c && c.code; if (v && !seen.has(v)) { seen.add(v); fresh.push(v) } }
  const lastCode = codes.length ? codes[codes.length - 1].code : (rec.lastCode || null)
  const merged = {
    ...rec,
    order_id: apiOrder.id || rec.order_id || '',
    email: apiOrder.email != null ? apiOrder.email : rec.email || '',
    service_id: apiOrder.service_id || rec.service_id || '',
    status: apiOrder.status || rec.status || '',
    mailbox_status: apiOrder.mailbox_status || rec.mailbox_status || '',
    next_action: apiOrder.next_action || rec.next_action || '',
    poll_after_seconds: apiOrder.poll_after_seconds || rec.poll_after_seconds || 5,
    poll_in_progress: Boolean(apiOrder.poll_in_progress),
    poll_warning: apiOrder.poll_warning || '',
    first_code_received: Boolean(apiOrder.first_code_received),
    code_quota: apiOrder.code_quota || rec.code_quota || null,
    price_cents: apiOrder.price_cents != null ? apiOrder.price_cents : rec.price_cents,
    codes, lastCode, seenCodes: Array.from(seen),
    closed: apiOrder.next_action === 'closed' || FLOW_CLOSED_STATUS.has(apiOrder.status) || apiOrder.mailbox_status === 'inactive' || Boolean(rec.closed),
    savedAt: new Date().toLocaleString('pt-BR')
  }
  const i = data.flowOrders.findIndex((o) => o === rec || (rec.intentId && o.intentId === rec.intentId) || (merged.order_id && o.order_id === merged.order_id))
  if (i >= 0) data.flowOrders[i] = merged; else data.flowOrders.unshift(merged)
  if (data.flowOrders.length > 300) data.flowOrders = data.flowOrders.slice(0, 300)
  saveData()
  emitFlow(merged)
  // extensão: push de cada código novo + lista de Gmails ativos
  try {
    for (const code of fresh) server.pushFlow({ email: merged.email, code, service_id: merged.service_id, order_id: merged.order_id })
    server.pushFlowAvailable()
    if (fresh.length) releaseLease(merged.email) // chegou código: libera a reserva "em uso"
  } catch { /* ignore */ }
  if (fresh.length) log('ok', `FlowOTP: código ${fresh[fresh.length - 1]} recebido em ${merged.email || merged.order_id}.`)
  return merged
}

// Um poller por pedido. Respeita poll_after_seconds/Retry-After, trata 503 e
// poll_warning sem contar código novo, e para quando o pedido fecha.
async function startFlowPoll(client, key) {
  if (flowPollers.has(String(key))) return
  const stop = { stopped: false }
  flowPollers.set(String(key), stop)
  try {
    while (!stop.stopped) {
      const rec = data.flowOrders.find((o) => o.order_id === key || o.intentId === key)
      if (!rec || !rec.order_id) break
      if (rec.closed || rec.next_action === 'closed' || FLOW_CLOSED_STATUS.has(rec.status) || rec.mailbox_status === 'inactive') {
        log('info', `FlowOTP: pedido ${rec.order_id} encerrado (${rec.status || rec.next_action}). Parando o acompanhamento.`)
        break
      }
      const wait = Math.max(Number(rec.poll_after_seconds) || 5, 5)
      await new Promise((r) => setTimeout(r, wait * 1000))
      if (stop.stopped) break
      let r
      try { r = await client.pollCode(rec.order_id) }
      catch (e) { log('warn', `FlowOTP poll ${rec.order_id}: ${e.message}`); continue }
      if (r.status === 429 || r.status === 503) {
        const after = r.retryAfter || (r.body && r.body.poll_after_seconds) || 10
        rec.poll_after_seconds = after; saveData()
        if (r.body && r.body.order) upsertFlowOrder(r.body.order, rec) // estado salvo, não é código novo
        log('warn', `FlowOTP ${rec.order_id}: instabilidade (${r.status}), aguardando ${after}s.`)
        continue
      }
      if (!r.ok) {
        const code = r.body && r.body.error && r.body.error.code
        log('warn', `FlowOTP ${rec.order_id}: ${code || 'HTTP ' + r.status}.`)
        if (r.status === 404) { rec.closed = true; saveData(); break }
        continue
      }
      // 200 (inclui poll_warning=provider_retry: só aguarda, não é código novo)
      const merged = upsertFlowOrder(r.body, rec)
      if (merged.closed) { log('info', `FlowOTP: ${merged.order_id} fechou.`); break }
    }
  } finally { flowPollers.delete(String(key)) }
}

// Religa os pollers dos pedidos ainda abertos ao iniciar o app.
function resumeFlowPollers() {
  const client = flowClient(); if (!client) return
  for (const o of data.flowOrders) if (o.order_id && !o.closed) startFlowPoll(client, o.order_id)
}

// Compra um Gmail na FlowOTP. Usado pelo IPC (app) E pelo servidor local (extensão).
// opts: { serviceId, maxPriceCents? }. Persiste a intenção antes do POST, respeita
// o teto de preço localmente e começa o poller. Devolve { ok, order } ou { error }.
async function doFlowBuy(opts = {}) {
  const client = flowClient()
  if (!client) return { error: 'Informe a chave da API da FlowOTP em Configurações.' }
  const serviceId = opts.serviceId || data.config.flowotp_service
  if (!serviceId) return { error: 'Escolha o serviço.' }
  const teto = (opts.maxPriceCents != null) ? Math.round(Number(opts.maxPriceCents)) : null
  const emPreparo = data.flowOrders.filter((o) => !o.closed && !['refunded', 'failed'].includes(o.status)).length
  if (emPreparo >= 15) return { error: 'Você já tem 15 Gmails em preparação (limite da conta). Espere algum fechar.' }

  // confere o preço atual (com desconto da conta) só pra respeitar o teto
  let precoAtual = null
  try {
    const pr = await client.products()
    if (pr.ok) {
      const svc = (pr.body.services || []).find((s) => String(s.id) === String(serviceId))
      const precos = svc && Array.isArray(svc.priorities) ? svc.priorities.map((p) => Number(p.price_cents)).filter((n) => n > 0) : []
      if (precos.length) precoAtual = Math.min(...precos)
    }
  } catch { /* segue sem cotar */ }
  if (teto != null && precoAtual != null && precoAtual > teto) {
    return { error: `Preço atual R$ ${(precoAtual / 100).toFixed(2)} acima do seu máximo R$ ${(teto / 100).toFixed(2)}.` }
  }

  const intentId = 'w-' + crypto.randomBytes(5).toString('hex')
  const idempotencyKey = newIdempotencyKey('fc')
  const intent = {
    intentId, idempotencyKey, service_id: serviceId, max_price_cents: teto, expected_price_cents: precoAtual,
    order_id: '', email: '', status: 'processing', next_action: 'poll_codes', mailbox_status: 'unknown',
    codes: [], seenCodes: [], lastCode: null, code_quota: null, poll_after_seconds: 5, closed: false, savedAt: new Date().toLocaleString('pt-BR')
  }
  data.flowOrders.unshift(intent); saveData(); emitFlow(intent)

  let r
  try { r = await client.createOrder({ serviceId }, idempotencyKey) }
  catch (e) { intent.error = e.message; saveData(); log('error', `FlowOTP comprar: ${e.message}`); return { error: e.message } }
  if (r.status === 202 && r.body && r.body.error && r.body.error.code === 'reconciliation_required') {
    try { r = await client.createOrder({ serviceId }, idempotencyKey) }
    catch (e) { intent.error = e.message; saveData(); return { error: e.message } }
  }
  if (!r.ok && r.status !== 202) {
    const code = r.body && r.body.error && r.body.error.code
    const msg = (r.body && r.body.error && r.body.error.message) || `HTTP ${r.status}`
    intent.error = code || msg; saveData()
    if (r.status === 402) return { error: 'Saldo insuficiente na FlowOTP.' }
    if (code === 'purchase_queue_full') return { error: 'Fila cheia (15 em preparação). Espere abrir vaga.' }
    if (r.status === 429) return { error: `Limite de chamadas atingido. Espere ${r.retryAfter || 'alguns'} s.` }
    if (code === 'out_of_stock') return { error: 'Sem estoque para esse serviço agora.' }
    if (code === 'delivery_review_required') return { error: 'Pedido em revisão de entrega — fale com o suporte da FlowOTP.' }
    log('error', `FlowOTP comprar: ${msg}`)
    return { error: msg }
  }
  const order = r.body
  const saved = upsertFlowOrder(order, intent)
  data.config.flowotp_service = serviceId; saveData()
  log('ok', `FlowOTP: pedido ${order.id} criado (${order.status}). Acompanhando...`)
  startFlowPoll(client, order.id)
  return { ok: true, order: saved }
}

// ------------------------------------------------------------ IPC
function wireIpc() {
  ipcMain.handle('get-data', () => {
    const now = Date.now()
    return {
      accounts: data.accounts.map((a) => { const s = statusOf(a, now); return { email: a.email, count: a.count || 0, partition: a.partition, addedAt: a.addedAt, manualStatus: a.manualStatus || null, status: s.color, manual: s.manual, recent: s.recent } }),
      codes: data.codes.slice(0, 200),
      config: { code_limit: codeLimit(), window_days: Number(data.config.window_days) || 4 }
    }
  })
  ipcMain.handle('get-codes-for', (_, email) => (email ? data.codes.filter((c) => c.email === email) : data.codes).slice(0, 100))
  ipcMain.handle('add-account', (_, { email, partition }) => {
    if (data.accounts.find((a) => a.email === email)) return { success: false, error: 'Conta já cadastrada' }
    data.accounts.push({ email, partition, count: 0, addedAt: new Date().toISOString(), manualStatus: null })
    saveData(); server.pushAvailable(); return { success: true }
  })
  ipcMain.handle('remove-account', (_, email) => {
    data.accounts = data.accounts.filter((a) => a.email !== email)
    data.codes = data.codes.filter((c) => c.email !== email)
    saveData(); server.pushAvailable(); return { success: true }
  })
  ipcMain.handle('receive-code', (_, { email, code, subject, sender }) => saveCode(email, code, subject, sender))
  ipcMain.handle('set-manual-status', (_, { email, status }) => {
    const acc = data.accounts.find((a) => a.email === email)
    if (!acc) return { success: false }
    acc.manualStatus = (status === 'green' || status === 'red') ? status : null
    saveData(); server.pushAvailable(); return { success: true, manualStatus: acc.manualStatus }
  })
  ipcMain.handle('get-next-partition', () => { data.partitionCounter = (data.partitionCounter || 0) + 1; saveData(); return `persist:gmail-${data.partitionCounter}` })
  ipcMain.handle('copy-text', (_, text) => { if (text && text !== '—') clipboard.writeText(String(text)) })

  // config
  ipcMain.handle('get-config', () => ({ ...data.config }))
  ipcMain.handle('set-config', (_, patch) => {
    const serverKeys = ['server_enabled', 'server_port', 'server_token']
    const needRestart = serverKeys.some((k) => k in (patch || {}) && patch[k] !== data.config[k])
    data.config = Object.assign({}, data.config, patch || {})
    // propaga a senha das proxies Allan para as já importadas que estão sem senha definida
    if (patch && typeof patch.allan_password === 'string' && patch.allan_password) {
      for (const p of data.proxies) if (p.source === 'allan' && !p.password) p.password = patch.allan_password
    }
    saveData()
    if (needRestart) startServer()
    server.pushAvailable()
    return { ...data.config }
  })

  // servidor local
  ipcMain.handle('server-info', () => ({ port: data.config.server_port, token: data.config.server_token, enabled: data.config.server_enabled, running: Boolean(server.server) }))
  ipcMain.handle('server-restart', () => { startServer(); return { ok: true } })
  ipcMain.handle('server-regen-token', () => { data.config.server_token = crypto.randomBytes(16).toString('hex'); saveData(); startServer(); return { token: data.config.server_token } })

  // proxies
  ipcMain.handle('proxy-list', () => {
    const counts = proxyStore.counts()
    counts.free4g = data.proxies.filter((p) => !p.used && isMobile4g(p)).length
    counts.used4g = data.proxies.filter((p) => p.used && isMobile4g(p)).length
    return { proxies: data.proxies.map((p) => ({ ...p, category: p.category || detectCategory(p.plano), display: dolphin.proxyDisplay(p) })), counts }
  })
  ipcMain.handle('proxy-add', (_, { text, defaultType, category }) => {
    const { proxies, errors } = dolphin.parseProxyText(text, defaultType || data.config.proxy_type || 'http')
    for (const p of proxies) p.category = category || 'outro'
    const { added, dup } = proxyStore.add(proxies)
    data.config.proxy_type = defaultType || data.config.proxy_type; saveData()
    for (const e of errors) log('warn', `Proxy linha ${e.line} ignorada (${e.why}): ${e.text}`)
    log(added ? 'ok' : 'info', `${added} proxies adicionadas, ${dup} repetidas, ${errors.length} inválidas.`)
    return { added, dup, errors: errors.length, counts: proxyStore.counts() }
  })
  ipcMain.handle('proxy-remove-unused', () => { const n = proxyStore.removeUnused(); log('info', `${n} proxies livres removidas.`); return proxyStore.counts() })
  ipcMain.handle('proxy-reset-used', () => { proxyStore.resetUsed(); log('warn', 'Todas as proxies marcadas como livres.'); return proxyStore.counts() })
  ipcMain.handle('proxy-clear', () => { const n = proxyStore.clear(); log('warn', `${n} proxies removidas (lista zerada).`); return proxyStore.counts() })

  // Dolphin
  ipcMain.handle('dolphin-test', async () => {
    const client = dolphinClient()
    if (!client) return { remote: 'no-token', local: 'no-token' }
    const out = { remote: 'erro', local: 'offline' }
    try { const ua = await client.getUseragent(); log('ok', `Token válido. UA de teste: ${ua.slice(0, 50)}...`); out.remote = 'ok' }
    catch (e) { log('error', `API remota: ${e.message}`) }
    try { await client.loginLocal(); log('ok', 'API local do Dolphin conectada.'); out.local = 'ok' }
    catch (e) { log('error', `API local: ${e.message}`) }
    return out
  })
  ipcMain.handle('dolphin-create', async (_, opts) => {
    const client = dolphinClient()
    if (!client) return { error: 'Informe o token do Dolphin em Configurações.' }

    // Proxies escolhidas na aba Proxies (host:port:login). Vazio = qualquer livre.
    const selKey = (p) => `${p.host}:${p.port}:${p.login || ''}`
    const selSet = new Set((opts.selectedProxies || []).map(String))
    const isSelected = (p) => selSet.size === 0 || selSet.has(selKey(p))

    // Modo "1 proxy 4G + rotação de IP a cada perfil" (quando o usuário tem só 1 proxy).
    const rotateSingle = Boolean(opts.rotateSingle)
    let singleProxy = null, rotateBefore = null
    if (rotateSingle) {
      const c = data.config
      if (!c.allan_key) return { error: 'Pra rotacionar o IP preciso da chave da Allan Proxys (com permissão de configuração) na aba Proxies.' }
      // Se o usuário marcou proxies na lista, usa a 1ª marcada; senão cai no padrão (1ª Allan 4G).
      const sel = data.proxies.filter(isSelected)
      singleProxy = sel.find((p) => p.source === 'allan' && isMobile4g(p)) || sel.find((p) => isMobile4g(p)) || sel.find((p) => p.source === 'allan')
        || data.proxies.find((p) => p.source === 'allan' && isMobile4g(p)) || data.proxies.find((p) => isMobile4g(p)) || data.proxies.find((p) => p.source === 'allan')
      if (!singleProxy) return { error: 'Nenhuma proxy 4G encontrada. Importe sua proxy da Allan primeiro.' }
      if (!singleProxy.password) return { error: 'A proxy está sem senha. Preencha a senha das proxies Allan na aba Proxies.' }
      const allan = new AllanClient(c.allan_key, c.allan_base)
      const wait = Math.max(Number(opts.rotateWait) || 8, 2)
      // Lê o IP de saída atual da proxy (endpoint /teste). Usado pra PROVAR que a
      // rotação funcionou — sem isso a gente só torcia pra ter mudado.
      const lerIp = async () => {
        try { const r = await allan.teste(singleProxy.login); return (r && (r.ip || r.endereco || r.ipAtual || r.ip_saida)) || null }
        catch { return null }
      }
      let lastIp = null
      rotateBefore = async (i) => {
        if (i === 0) {
          lastIp = await lerIp()
          log('info', `Perfil 1 usa o IP atual da proxy ${singleProxy.login}${lastIp ? ` (${lastIp})` : ''}.`)
          return
        }
        log('step', `Rotacionando IP de ${singleProxy.login} antes do perfil ${i + 1}...`)
        let novoIp = null
        for (let tent = 1; tent <= 3; tent++) {
          try { await allan.config(singleProxy.login, singleProxy.pais ? { pais: singleProxy.pais } : {}) }
          catch (e) {
            if (e.status === 403) throw new Error('a chave da Allan é só de leitura — gere uma chave com permissão de configuração')
            if (e.status === 409) throw new Error('esta proxy não aceita troca de IP por API')
            throw e
          }
          await new Promise((r) => setTimeout(r, wait * 1000))
          novoIp = await lerIp()
          // Sem IP legível (ou sem baseline) não dá pra comparar: aceita e segue.
          if (!lastIp || !novoIp || novoIp !== lastIp) break
          log('warn', `IP continua ${novoIp} após rotacionar (tentativa ${tent}/3). Tentando de novo...`)
        }
        if (lastIp && novoIp && novoIp === lastIp) {
          throw new Error(`o IP NÃO mudou (${novoIp}) após 3 tentativas — esta proxy 4G pode não rotacionar por API, ou precisa de outro parâmetro`)
        }
        log('ok', `IP rotacionado: ${lastIp || '?'} → ${novoIp || '?'}.`)
        lastIp = novoIp || lastIp
      }
    }

    const only4g = !rotateSingle && opts.only4g !== false // padrão: só Mobile 4G (ignorado no modo rotação)
    // Elegibilidade: se o usuário MARCOU proxys, a seleção manda (qualquer uma,
    // 4G ou não); sem seleção, cai no filtro "Somente Mobile 4G".
    const elegivel = (p) => !p.used && (selSet.size ? isSelected(p) : (!only4g || isMobile4g(p)))
    if (!rotateSingle) {
      const freeOk = data.proxies.filter(elegivel).length
      if (!freeOk) {
        if (selSet.size) return { error: 'Nenhuma das proxys marcadas está livre. Marque outras na aba Proxies, ou desmarque tudo pra usar qualquer uma livre.' }
        return { error: only4g ? 'Sem proxies Mobile 4G livres. Importe/adicione proxies 4G (ou ligue "rotacionar IP", ou desligue "Somente Mobile 4G").' : 'Sem proxies livres. Adicione proxies primeiro.' }
      }
    }
    const reqQty = Number(opts.quantity) || 1
    const sequential = Boolean(opts.sequential)
    const qty = (rotateSingle || sequential) ? reqQty : Math.min(reqQty, data.proxies.filter(elegivel).length)
    currentStop = { stopped: false }
    const area = (opts.tile || sequential) ? displayWorkArea() : null
    const progress = (done, total, ok) => { try { mainWindow.webContents.send('dolphin-progress', { done, total, ok }) } catch { /* ignore */ } }
    const common = {
      quantity: qty, namePattern: (opts.namePattern || 'Perfil {n}').trim(), startNumber: Number(opts.startNumber) || 1,
      platform: opts.platform || 'windows', tags: (opts.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      startUrls: dolphin.normalizeUrls(opts.startUrls), focusIndex: Number(opts.focusIndex) || 1,
      tile: opts.tile ? (Number(opts.tileCount) || 4) : 0, area, pageZoom: Number(opts.pageZoom) || 100, retryDelay: 3,
      filter: selSet.size ? isSelected : (only4g ? isMobile4g : null),
      filterLabel: selSet.size ? 'selecionadas' : (only4g ? 'Mobile 4G' : ''),
      singleProxy, rotateBefore
    }
    try {
      let created
      if (sequential) {
        // cria um perfil, abre, e só cria o próximo depois que você fechar o anterior
        created = await dolphin.runSequential(client, proxyStore, common, log, progress, currentStop, registerOpen)
      } else {
        created = await dolphin.runBatch(client, proxyStore, {
          ...common, openAfter: Boolean(opts.openAfter), delay: Number(opts.delay) || 0,
          startUrls: opts.openAfter ? common.startUrls : []
        }, log, progress, currentStop, registerOpen)
      }
      data.config.next_number = (Number(opts.startNumber) || 1) + created.length; saveData()
      if (opts.autoMirror && created.length && !sequential) tryAutoMirror(created, opts.autoMirrorName)
      return { created: created.length, nextNumber: data.config.next_number }
    } catch (e) { log('error', `Erro inesperado: ${e.message}`); return { error: e.message } }
  })
  ipcMain.handle('dolphin-stop', () => { if (currentStop) currentStop.stopped = true; log('warn', 'Parando após o perfil atual...'); return { ok: true } })
  ipcMain.handle('dolphin-made-list', () => ({ made: madeList() }))
  ipcMain.handle('dolphin-refresh-remote', async () => {
    const client = dolphinClient(); if (!client) return { error: 'sem token' }
    try { remoteIds = await client.listProfiles(); const m = madeList(); log('ok', `Lista do Dolphin atualizada: ${m.length} perfil(is) existente(s).`); return { made: m } }
    catch (e) { log('error', `Não foi possível atualizar: ${e.message}`); return { error: e.message } }
  })
  ipcMain.handle('dolphin-open', async (_, ids) => {
    const client = dolphinClient(); if (!client) return { error: 'sem token' }
    const byId = new Map(data.proxies.filter((p) => p.used && p.profile_id).map((p) => [String(p.profile_id), p.profile_name]))
    const profiles = ids.map((id) => ({ id: String(id), name: byId.get(String(id)) || String(id) }))
    currentStop = { stopped: false }
    const c = data.config
    const tile = c.tile ? (Number(c.tile_count) || 4) : 0
    try {
      const n = await dolphin.openProfiles(client, profiles, log, {
        startUrls: dolphin.normalizeUrls((c.start_urls || []).join('\n')), focusIndex: Number(c.focus_index) || 1,
        tile, area: tile ? displayWorkArea() : null, pageZoom: Number(c.page_zoom) || 100, login: true, stop: currentStop
      }, registerOpen)
      log(n ? 'ok' : 'warn', `Abertura concluída: ${n} de ${profiles.length} perfis.`)
      return { opened: n }
    } catch (e) { log('error', `Erro ao abrir: ${e.message}`); return { error: e.message } }
  })

  // ---- Allan Proxys (API do fornecedor) ----
  ipcMain.handle('allan-test', async () => {
    const c = data.config
    if (!c.allan_key) return { error: 'Informe a chave da API da Allan Proxys.' }
    try { const conta = await new AllanClient(c.allan_key, c.allan_base).conta(); log('ok', `Allan Proxys: chave válida (${conta.email}, escopo ${conta.escopo}, ${conta.proxies} proxies).`); return { ok: true, conta } }
    catch (e) { log('error', `Allan Proxys: ${e.message}`); return { error: e.message } }
  })
  ipcMain.handle('allan-fetch', async () => {
    const c = data.config
    if (!c.allan_key) return { error: 'Informe a chave da API da Allan Proxys em Configurações/Proxies.' }
    let list
    try { list = await new AllanClient(c.allan_key, c.allan_base).proxies() }
    catch (e) { log('error', `Allan Proxys: ${e.message}`); return { error: e.message } }
    const items = (list && list.proxies) || []
    let added = 0, updated = 0
    for (const p of items) {
      const host = p.host; const port = String(p.porta); const login = p.login
      if (!host || !port || !login) continue
      const existing = data.proxies.find((x) => x.source === 'allan' && x.login === login && x.host === host)
      if (existing) {
        existing.port = port; existing.pais = p.pais; existing.gbContratado = p.gbContratado; existing.plano = p.plano
        existing.category = detectCategory(p.plano)
        if (!existing.password && c.allan_password) existing.password = c.allan_password
        updated++
      } else {
        data.proxies.push({
          type: c.allan_type || 'http', host, port, login, password: c.allan_password || '',
          used: false, profile_id: '', profile_name: '', used_at: '',
          source: 'allan', pais: p.pais, gbContratado: p.gbContratado, plano: p.plano, category: detectCategory(p.plano), disponivelGb: null
        })
        added++
      }
    }
    saveData()
    log('ok', `Allan Proxys: ${added} proxies importadas, ${updated} atualizadas.`)
    if (!c.allan_password) log('warn', 'As proxies vieram sem senha (a API não entrega a senha). Preencha a senha das proxies Allan para elas funcionarem.')
    return { added, updated, counts: proxyStore.counts(), missingPassword: !c.allan_password }
  })
  ipcMain.handle('allan-balances', async () => {
    const c = data.config
    if (!c.allan_key) return { error: 'sem chave' }
    const client = new AllanClient(c.allan_key, c.allan_base)
    const allan = data.proxies.filter((p) => p.source === 'allan')
    let ok = 0
    for (const p of allan) {
      try { const d = await client.proxy(p.login); if (d && d.trafego) { p.disponivelGb = d.trafego.disponivelGb; p.totalGb = d.trafego.totalGb; p.leitura = d.trafego.leitura; ok++ } }
      catch (e) { log('warn', `Allan saldo ${p.login}: ${e.message}`) }
    }
    saveData()
    log('ok', `Allan Proxys: saldo atualizado de ${ok}/${allan.length} proxies.`)
    return { ok, total: allan.length }
  })
  ipcMain.handle('allan-rotate', async (_, login) => {
    const c = data.config
    if (!c.allan_key) return { error: 'sem chave' }
    const p = data.proxies.find((x) => x.source === 'allan' && x.login === login)
    if (!p) return { error: 'proxy não encontrada' }
    try {
      // mantém o país e deixa o provedor sortear um novo IP/localização
      const r = await new AllanClient(c.allan_key, c.allan_base).config(login, p.pais ? { pais: p.pais } : {})
      log('ok', `Allan Proxys: IP de ${login} rotacionado.`)
      return { ok: true, result: r }
    } catch (e) {
      if (e.status === 403) return { error: 'A chave é só de leitura. Gere uma chave com permissão de configuração na Allan Proxys.' }
      if (e.status === 409) return { error: 'Esta proxy não aceita troca de localização por API.' }
      log('error', `Allan rotacionar ${login}: ${e.message}`); return { error: e.message }
    }
  })

  // ---- AllanSMS (números virtuais / OTP) ----
  ipcMain.handle('sms-test', async () => {
    const client = smsClient()
    if (!client) return { error: 'Informe a chave da API da AllanSMS.' }
    try { const me = await client.me(); const d = me.data || me; log('ok', `AllanSMS: chave válida (${d.email || d.name || '—'}, saldo R$ ${((d.balance_cents || 0) / 100).toFixed(2)}).`); return { ok: true, me: d, test: smsKey().startsWith('sk_test_') } }
    catch (e) { log('error', `AllanSMS: ${e.message}`); return { error: e.message } }
  })
  ipcMain.handle('sms-balance', async () => {
    const client = smsClient(); if (!client) return { error: 'sem chave' }
    try { const b = await client.balance(); return { ok: true, ...(b.data || b) } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('sms-countries', async () => {
    const client = smsClient(); if (!client) return { error: 'sem chave' }
    try { const r = await client.countries(); return { ok: true, countries: r.data || r || [] } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('sms-services', async (_, { country, all } = {}) => {
    const client = smsClient(); if (!client) return { error: 'sem chave' }
    try { const r = await client.services(country || data.config.allansms_country || 'brazil', { all }); return { ok: true, services: r.data || r || [] } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('sms-buy', async (_, opts = {}) => {
    const client = smsClient()
    if (!client) return { error: 'Informe a chave da API da AllanSMS em Configurações.' }
    const country = opts.country || data.config.allansms_country || 'brazil'
    const service = opts.service
    if (!service) return { error: 'Escolha o serviço (ex.: whatsapp, google).' }
    const key = 'fc-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex')
    let order
    try {
      const r = await client.createOrder({
        country, service, server: opts.server || undefined, operator: opts.operator || undefined,
        maxPriceCents: opts.maxPriceCents != null ? opts.maxPriceCents : undefined
      }, key)
      order = r.data || r
    } catch (e) {
      log('error', `AllanSMS comprar: ${e.message}`)
      return { error: e.message, code: e.code, status: e.status }
    }
    data.config.allansms_country = country; data.config.allansms_service = service
    const saved = upsertSmsOrder(order)
    log('ok', `AllanSMS: número ${order.phone || order.id} comprado (${service}/${country}). Aguardando SMS...`)
    // começa o polling em background (não bloqueia); a UI recebe sms-update
    startSmsPoll(client, order.id)
    return { ok: true, order: saved }
  })
  ipcMain.handle('sms-order-get', async (_, id) => {
    const client = smsClient(); if (!client) return { error: 'sem chave' }
    try { const r = await client.getOrder(id); return { ok: true, order: upsertSmsOrder(r.data || r) } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('sms-cancel', async (_, id) => {
    const client = smsClient(); if (!client) return { error: 'sem chave' }
    const stop = smsPollers.get(String(id)); if (stop) stop.stopped = true
    try { const r = await client.cancelOrder(id); const d = r.data || r; log('info', `AllanSMS: pedido ${id} cancelado.`); const cur = data.smsOrders.find((o) => String(o.id) === String(id)) || { id }; return { ok: true, order: upsertSmsOrder({ ...cur, ...d }) } }
    catch (e) {
      if (e.code === 'cancel_too_early') return { error: 'Ainda não dá pra cancelar — espere os 2 minutos iniciais.' }
      if (e.code === 'cancel_not_allowed') return { error: 'Esse número não pode ser cancelado agora (já recebeu SMS ou passou do prazo).' }
      return { error: e.message }
    }
  })
  ipcMain.handle('sms-finish', async (_, id) => {
    const client = smsClient(); if (!client) return { error: 'sem chave' }
    const stop = smsPollers.get(String(id)); if (stop) stop.stopped = true
    try { const r = await client.finishOrder(id); const d = r.data || r; log('info', `AllanSMS: número ${id} encerrado.`); const cur = data.smsOrders.find((o) => String(o.id) === String(id)) || { id }; return { ok: true, order: upsertSmsOrder({ ...cur, ...d }) } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('sms-list', () => ({ orders: data.smsOrders.slice(0, 100) }))
  ipcMain.handle('sms-clear', () => { data.smsOrders = data.smsOrders.filter((o) => !(o.is_final || SMS_FINAL.has(o.status))); saveData(); return { orders: data.smsOrders.slice(0, 100) } })

  // ---- FlowOTP (Gmail comprados / OTP) ----
  ipcMain.handle('flow-test', async () => {
    const client = flowClient()
    if (!client) return { error: 'Informe a chave da API da FlowOTP.' }
    try {
      const r = await client.balance()
      if (!r.ok) return { error: (r.body && r.body.error && r.body.error.message) || `HTTP ${r.status}` }
      const w = r.body
      log('ok', `FlowOTP: chave válida. Saldo R$ ${((w.available_cents || 0) / 100).toFixed(2)}.`)
      return { ok: true, wallet: w }
    } catch (e) { log('error', `FlowOTP: ${e.message}`); return { error: e.message } }
  })
  ipcMain.handle('flow-balance', async () => {
    const client = flowClient(); if (!client) return { error: 'sem chave' }
    try { const r = await client.balance(); return r.ok ? { ok: true, ...r.body } : { error: (r.body.error && r.body.error.message) || `HTTP ${r.status}` } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('flow-products', async () => {
    const client = flowClient(); if (!client) return { error: 'sem chave' }
    try {
      const r = await client.products()
      if (!r.ok) return { error: (r.body.error && r.body.error.message) || `HTTP ${r.status}` }
      return { ok: true, services: r.body.services || [], available: r.body.available, maintenance: r.body.maintenance }
    } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('flow-buy', (_, opts = {}) => doFlowBuy(opts))
  ipcMain.handle('flow-order-get', async (_, id) => {
    const client = flowClient(); if (!client) return { error: 'sem chave' }
    try { const r = await client.getOrder(id); if (!r.ok) return { error: (r.body.error && r.body.error.message) || `HTTP ${r.status}` }; return { ok: true, order: upsertFlowOrder(r.body) } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('flow-list', () => ({ orders: data.flowOrders.slice(0, 100) }))
  ipcMain.handle('flow-clear', () => { data.flowOrders = data.flowOrders.filter((o) => !o.closed); saveData(); return { orders: data.flowOrders.slice(0, 100) } })

  // espelhamento
  ipcMain.handle('mirror-configure', (_, { motherId, ids }) => { mirror.configure(String(motherId), ids.map(String)); return { ok: true } })
  ipcMain.handle('mirror-start', () => { try { mirror.configure(mirror.motherId, Array.from(openRegistry.keys())); mirror.start(); return { ok: true } } catch (e) { return { error: e.message } } })
  ipcMain.handle('mirror-stop', () => { mirror.stop(); return { ok: true } })
  ipcMain.handle('mirror-pause', () => ({ paused: mirror.togglePause() }))
  ipcMain.handle('mirror-force-urls', (_, on) => { mirror.setForceUrls(on); return { ok: true } })
  ipcMain.handle('mirror-go-url', async (_, url) => { try { await mirror.goToUrl(url); return { ok: true } } catch (e) { return { error: e.message } } })
}

function tryAutoMirror(created, motherName) {
  const available = created.filter((p) => openRegistry.has(String(p.id)))
  if (!available.length) { log('warn', 'Espelhamento automático: nenhum perfil devolveu porta CDP.'); return }
  const chosen = (available.find((p) => p.name === motherName) || available[0]).id
  try { mirror.configure(String(chosen), available.map((p) => String(p.id))); mirror.start() }
  catch (e) { log('error', `Espelhamento automático: ${e.message}`) }
}

function displayWorkArea() {
  try { const wa = screen.getPrimaryDisplay().workArea; return { x: wa.x, y: wa.y, width: wa.width, height: wa.height } }
  catch { return { x: 0, y: 0, width: 1920, height: 1040 } }
}

// ------------------------------------------------------------ app
app.whenReady().then(() => {
  dataFile = path.join(app.getPath('userData'), 'data.json')
  loadData()
  wireIpc()

  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1040, minHeight: 640,
    title: 'Flash Creator', backgroundColor: '#0e1016',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true }
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.on('did-finish-load', () => { startServer(); resumeFlowPollers() })

  const logFile = path.join(app.getPath('userData'), 'log.txt')
  app.on('render-process-gone', (_, wc, d) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] render-process-gone: ${d.reason} ${d.exitCode}\n`) } catch { /* ignore */ } })
})

app.on('window-all-closed', () => { try { mirror.stop() } catch { /* ignore */ } server.stop(); app.quit() })
