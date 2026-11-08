// Lógica do Dolphin Anty portada de dolphin_core.py / espelhamento.py para Node.
// Usa fetch nativo (Node 18+) para a API REST e o cliente CDP cru (cdp.js) para
// abrir abas, posicionar janelas e espelhar cliques.
const cdp = require('./cdp')

const PROXY_TYPES = ['http', 'https', 'socks4', 'socks5', 'ssh']
const REMOTE_API = 'https://dolphin-anty-api.com'
const LOCAL_API = 'http://localhost:3001/v1.0'
const HARDWARE_ATTEMPTS = 4

// ------------------------------------------------------------ proxies
function proxyKey(p) {
  return `${p.type}://${p.login}:${p.password}@${p.host}:${p.port}`.toLowerCase()
}
function proxyDisplay(p) {
  const auth = p.login ? `${p.login}:***@` : ''
  return `${p.type}://${auth}${p.host}:${p.port}`
}

function parseProxy(line, defaultType = 'http') {
  line = (line || '').trim()
  if (!line || line.startsWith('#')) return null
  let ptype = defaultType
  const m = line.match(/^([a-z0-9]+):\/\/(.+)$/i)
  if (m) { ptype = m[1].toLowerCase(); line = m[2] }
  if (!PROXY_TYPES.includes(ptype)) throw new Error(`tipo de proxy desconhecido: ${ptype}`)

  let login = '', password = '', host, port
  if (line.includes('@')) {
    const at = line.lastIndexOf('@')
    const auth = line.slice(0, at)
    const hostport = line.slice(at + 1)
    if (auth.includes(':')) { const i = auth.indexOf(':'); login = auth.slice(0, i); password = auth.slice(i + 1) }
    else login = auth
    const parts = hostport.split(':')
    if (parts.length !== 2) throw new Error('esperado host:porta depois do @')
    ;[host, port] = parts
  } else {
    const parts = line.split(':')
    if (parts.length === 2) { [host, port] = parts }
    else if (parts.length >= 4 && /^\d+$/.test(parts[1])) { host = parts[0]; port = parts[1]; login = parts[2]; password = parts.slice(3).join(':') }
    else if (parts.length === 4 && /^\d+$/.test(parts[3])) { [login, password, host, port] = parts }
    else throw new Error('formato não reconhecido')
  }
  host = host.trim(); port = String(port).trim()
  if (!host || !/^\d+$/.test(port) || !(Number(port) > 0 && Number(port) < 65536)) throw new Error('host ou porta inválidos')
  return { type: ptype, host, port, login: login.trim(), password: password.trim(), used: false, profile_id: '', profile_name: '', used_at: '' }
}

function parseProxyText(text, defaultType = 'http') {
  const proxies = [], errors = []
  const lines = String(text || '').split(/\r?\n/)
  lines.forEach((line, i) => {
    try { const p = parseProxy(line, defaultType); if (p) proxies.push(p) }
    catch (e) { errors.push({ line: i + 1, text: line.trim(), why: e.message }) }
  })
  return { proxies, errors }
}

// ------------------------------------------------------------ API REST
async function request(method, url, { token, body, timeout = 60000 } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  let res
  try {
    res = await fetch(url, { method, headers, body: body != null ? JSON.stringify(body) : undefined, signal: ctrl.signal })
  } catch (e) {
    clearTimeout(t)
    const err = new Error(`sem conexão com ${url}: ${e.message}`); err.status = null; err.retryable = true
    throw err
  }
  clearTimeout(t)
  const raw = await res.text()
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} em ${method} ${url}: ${raw.slice(0, 500)}`)
    err.status = res.status
    err.retryable = res.status === 429 || res.status >= 500
    throw err
  }
  try { return raw ? JSON.parse(raw) : {} }
  catch { const err = new Error(`resposta inesperada de ${url}: ${raw.slice(0, 300)}`); err.status = 0; err.retryable = false; throw err }
}

class DolphinClient {
  constructor(token, remote = REMOTE_API, local = LOCAL_API) {
    this.token = (token || '').trim()
    this.remote = remote.replace(/\/$/, '')
    this.local = local.replace(/\/$/, '')
  }
  loginLocal() { return request('POST', `${this.local}/auth/login-with-token`, { body: { token: this.token } }) }
  async getUseragent(platform = 'windows') {
    const q = new URLSearchParams({ browser_type: 'anty', browser_version: 'latest', platform })
    const res = await request('GET', `${this.remote}/fingerprints/useragent?${q}`, { token: this.token })
    const ua = res && res.data
    if (!ua) throw new Error(`não veio user-agent: ${JSON.stringify(res).slice(0, 200)}`)
    return ua
  }
  getFingerprint(platform = 'windows') {
    const q = new URLSearchParams({ platform, browser_type: 'anty', browser_version: 'latest', type: 'fingerprint', screen: '' })
    return request('GET', `${this.remote}/fingerprints/fingerprint?${q}`, { token: this.token })
  }
  static buildBody(name, proxy, useragent, platform, tags, fp, realHardware) {
    fp = fp || {}
    const webgl = fp.webgl || {}
    const webglInfo = (webgl.unmaskedVendor && webgl.unmaskedRenderer)
      ? { mode: 'manual', vendor: webgl.unmaskedVendor, renderer: webgl.unmaskedRenderer, webgl2Maximum: fp.webgl2Maximum }
      : { mode: 'random' }
    const cpu = fp.hardwareConcurrency || 8
    const memory = fp.deviceMemory || 8
    return {
      name, tags: tags || [], platform, browserType: 'anty', mainWebsite: '',
      useragent: { mode: 'manual', value: useragent },
      webrtc: { mode: 'altered', ipAddress: null },
      canvas: { mode: 'real' }, webgl: { mode: 'real' }, webglInfo,
      clientRect: { mode: 'real' },
      timezone: { mode: 'auto', value: null }, locale: { mode: 'auto', value: null },
      geolocation: { mode: 'auto', latitude: null, longitude: null },
      cpu: realHardware ? { mode: 'real' } : { mode: 'manual', value: cpu },
      memory: realHardware ? { mode: 'real' } : { mode: 'manual', value: memory },
      doNotTrack: false,
      proxy: { type: proxy.type, host: proxy.host, port: proxy.port, login: proxy.login, password: proxy.password, name: `${proxy.host}:${proxy.port}` }
    }
  }
  async createProfile(body) {
    const res = await request('POST', `${this.remote}/browser_profiles`, { token: this.token, body })
    const pid = res && (res.browserProfileId || (res.data && res.data.id))
    if (!pid) { const e = new Error(`perfil não criado: ${JSON.stringify(res).slice(0, 400)}`); e.status = 0; e.retryable = false; throw e }
    return pid
  }
  async listProfiles(limit = 1000) {
    const res = await request('GET', `${this.remote}/browser_profiles?${new URLSearchParams({ limit })}`, { token: this.token })
    let payload = (res && res.data) || res
    if (payload && !Array.isArray(payload)) payload = payload.items || payload.browserProfiles || payload.profiles || []
    const ids = new Set()
    for (const item of payload || []) {
      if (typeof item === 'string' || typeof item === 'number') ids.add(String(item))
      else if (item && typeof item === 'object') { const pid = item.id || item.browserProfileId || item.profileId; if (pid != null) ids.add(String(pid)) }
    }
    return ids
  }
  async startProfile(profileId, automation = false) {
    const url = `${this.local}/browser_profiles/${profileId}/start${automation ? '?automation=1' : ''}`
    const res = await request('GET', url, { timeout: 120000 })
    if (res && res.success === false) { const e = new Error(`não abriu o perfil ${profileId}: ${JSON.stringify(res)}`); e.status = 0; e.retryable = false; throw e }
    return res
  }
}

function isHardwareError(err) { return err.status === 422 && String(err.message).includes('E_HARDWARE') }

// Cria UM perfil: pega user-agent, tenta fingerprint e re-sorteia hardware se o
// Dolphin recusar. Usado pela criação em lote e pela criação em sequência.
async function buildAndCreate(client, proxy, name, platform, tags, log) {
  const ua = await client.getUseragent(platform)
  for (let attempt = 1; attempt <= HARDWARE_ATTEMPTS; attempt++) {
    const last = attempt === HARDWARE_ATTEMPTS
    let fp = null
    if (!last) { try { fp = await client.getFingerprint(platform) } catch (e) { log('warn', `Fingerprint não obtida, usando WebGL aleatório (${e.message}).`) } }
    const body = DolphinClient.buildBody(name, proxy, ua, platform, tags, fp, last)
    try { return await client.createProfile(body) }
    catch (e) {
      if (last || !isHardwareError(e)) throw e
      log('warn', `'${name}': o Dolphin recusou a combinação de hardware sorteada. Sorteando outra (${attempt + 1}/${HARDWARE_ATTEMPTS})...`)
    }
  }
}

// Espera o usuário FECHAR o navegador do perfil: tenta listar as abas pela porta
// de depuração; quando a porta morre (algumas falhas seguidas), considera fechado.
async function waitUntilClosed(port, { stop, log, pollMs = 3000, graceMs = 4000 } = {}) {
  await new Promise((r) => setTimeout(r, graceMs)) // dá tempo de o navegador subir
  let fails = 0
  while (true) {
    if (stop && stop.stopped) return
    try { await cdp.listPages(port); fails = 0 }
    catch { fails++; if (fails >= 2) return }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

async function withRetry(fn, log, what, { attempts = 3, baseDelay = 3, stop } = {}) {
  for (let n = 1; n <= attempts; n++) {
    try { return await fn() }
    catch (e) {
      if (!e.retryable || n === attempts || (stop && stop.stopped)) throw e
      const wait = baseDelay * n
      log('warn', `${what}: ${e.message}. Tentando de novo em ${wait}s (${n + 1}/${attempts})...`)
      await new Promise((r) => setTimeout(r, wait * 1000))
    }
  }
}

// ------------------------------------------------------------ execução
async function runBatch(client, store, opts, log, progress, stop, onOpen) {
  const { quantity, namePattern, startNumber, platform, tags, openAfter, delay, startUrls, focusIndex, tile, area, pageZoom } = opts
  // Modo "1 proxy + rotação de IP": reusa a mesma proxy em todos os perfis e
  // rotaciona o IP dela antes de cada perfil (opts.rotateBefore).
  let queue
  if (opts.singleProxy) {
    queue = Array.from({ length: Math.max(1, quantity) }, () => opts.singleProxy)
    log('info', `Modo 1 proxy + rotação: ${proxyDisplay(opts.singleProxy)} será rotacionada a cada perfil.`)
  } else {
    let pool = store.available()
    if (opts.filter) pool = pool.filter(opts.filter)
    queue = pool.slice(0, quantity)
    if (queue.length < quantity) log('warn', `Só há ${queue.length} proxies livres${opts.filterLabel ? ' (' + opts.filterLabel + ')' : ''}; serão criados ${queue.length} perfis.`)
  }
  if (!queue.length) return []

  if (openAfter) {
    try { await client.loginLocal(); log('ok', 'Conectado à API local do Dolphin (app aberto).') }
    catch (e) { log('warn', `API local indisponível (${e.message}). Os perfis serão criados, mas talvez não abram.`) }
  }

  const created = []
  let number = startNumber
  const total = queue.length
  for (let i = 0; i < total; i++) {
    if (stop && stop.stopped) { log('warn', 'Interrompido pelo usuário.'); break }
    const proxy = queue[i]
    const name = namePattern.includes('{n}') ? namePattern.replace('{n}', String(number)) : `${namePattern} ${number}`

    // Modo 1 proxy: rotaciona o IP antes de criar (menos o primeiro, que usa o IP atual).
    if (opts.singleProxy && opts.rotateBefore) {
      try { await opts.rotateBefore(i) }
      catch (e) {
        log('error', `Rotação de IP falhou: ${e.message}. Parando — sem rotação os perfis ficariam com o mesmo IP.`)
        break
      }
      if (stop && stop.stopped) { log('warn', 'Interrompido pelo usuário.'); break }
    }

    log('step', `[${i + 1}/${total}] Criando '${name}' com proxy ${proxyDisplay(proxy)}...`)

    let pid
    try { pid = await withRetry(() => buildAndCreate(client, proxy, name, platform, tags, log), log, `Criar '${name}'`, { baseDelay: opts.retryDelay || 3, stop }) }
    catch (e) { log('error', `Falha ao criar '${name}': ${e.message}`); if (progress) progress(i + 1, total, false); continue }
    if (!opts.singleProxy) store.markUsed(proxy, pid, name)
    created.push({ id: pid, name })
    number += 1
    log('ok', opts.singleProxy ? `Perfil '${name}' criado (ID ${pid}).` : `Perfil '${name}' criado (ID ${pid}). Proxy marcada como usada.`)
    if (progress) progress(i + 1, total, true)
    if (delay && i < total - 1) await new Promise((r) => setTimeout(r, delay * 1000))
  }
  log('info', `Criação concluída: ${created.length} de ${total} perfis.`)
  if (openAfter && created.length) await openProfiles(client, created, log, { startUrls, focusIndex, tile, area, pageZoom, login: false, stop }, onOpen)
  return created
}

async function openProfiles(client, profiles, log, opts, onOpen) {
  const { startUrls = [], focusIndex = 1, tile = 0, area = null, pageZoom = 100, login = true, stop } = opts || {}
  if (login) {
    try { await client.loginLocal() }
    catch (e) { log('error', `API local indisponível (${e.message}). Abra o Dolphin Anty e tente de novo.`); return 0 }
  }
  log('step', `Abrindo ${profiles.length} perfil(is)...`)
  let opened = 0
  for (const { id, name } of profiles) {
    if (stop && stop.stopped) { log('warn', 'Abertura interrompida pelo usuário.'); break }
    log('step', `Abrindo '${name}'...`)
    let res
    try { res = await withRetry(() => client.startProfile(id, Boolean(startUrls.length || tile)), log, `Abrir '${name}'`, { baseDelay: 3, stop }); log('ok', `Perfil '${name}' aberto.`); opened++ }
    catch (e) { log('error', `Não foi possível abrir '${name}': ${e.message}`); continue }
    const port = res && res.automation && res.automation.port
    if (onOpen && port) onOpen(id, name, port)
    if (tile) {
      if (!port) log('error', `'${name}': o Dolphin não devolveu a porta do navegador, janela não organizada.`)
      else {
        const bounds = cdp.cellBounds(opened - 1, tile, area)
        let placed = false
        for (let k = 0; k < 10; k++) {
          try { await cdp.placeWindow(port, bounds); placed = true; break } catch { await new Promise((r) => setTimeout(r, 1000)) }
        }
        log(placed ? 'ok' : 'error', placed ? `'${name}': janela posicionada no espaço ${(opened - 1) % tile + 1} de ${tile}.` : `'${name}': não consegui posicionar a janela.`)
      }
    }
    if (startUrls.length) {
      if (!port) log('error', `'${name}': o Dolphin não devolveu a porta, não abri as páginas.`)
      else {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const ids = []
          for (const u of startUrls) ids.push(await cdp.openTab(port, u))
          log('ok', `'${name}': ${ids.length} página(s) inicial(is) aberta(s).`)
          const idx = Math.min(Math.max(focusIndex, 1), ids.length) - 1
          if (ids[idx]) { await cdp.activateTab(port, ids[idx]); log('ok', `'${name}': em primeiro plano: ${startUrls[idx]}`) }
        } catch (e) { log('error', `'${name}': falha ao preparar páginas: ${e.message}`) }
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return opened
}

// Criação em SEQUÊNCIA: cria um perfil, abre, e só cria o próximo depois que o
// usuário FECHAR o anterior. Vai até a quantidade pedida (ou o usuário parar).
async function runSequential(client, store, opts, log, progress, stop, onOpen) {
  const { quantity, namePattern, startNumber, platform, tags, startUrls = [], focusIndex = 1, tile = 0, area = null } = opts
  let getProxy
  if (opts.singleProxy) getProxy = () => opts.singleProxy
  else {
    let pool = store.available()
    if (opts.filter) pool = pool.filter(opts.filter)
    if (!pool.length) { log('warn', `Sem proxies livres${opts.filterLabel ? ' (' + opts.filterLabel + ')' : ''}.`); return [] }
    let idx = 0
    getProxy = () => pool[idx++]
  }
  try { await client.loginLocal(); log('ok', 'Conectado à API local do Dolphin (app aberto).') }
  catch (e) { log('error', `API local indisponível (${e.message}). Abra o Dolphin Anty e tente de novo.`); return [] }

  const created = []
  let number = startNumber
  const total = quantity
  for (let i = 0; i < total; i++) {
    if (stop && stop.stopped) { log('warn', 'Interrompido pelo usuário.'); break }
    const proxy = getProxy()
    if (!proxy) { log('warn', 'Acabaram as proxies livres.'); break }
    const name = namePattern.includes('{n}') ? namePattern.replace('{n}', String(number)) : `${namePattern} ${number}`

    if (opts.singleProxy && opts.rotateBefore) {
      try { await opts.rotateBefore(i) }
      catch (e) { log('error', `Rotação de IP falhou: ${e.message}. Parando.`); break }
      if (stop && stop.stopped) break
    }

    log('step', `[${i + 1}/${total}] Criando '${name}' com proxy ${proxyDisplay(proxy)}...`)
    let pid
    try { pid = await withRetry(() => buildAndCreate(client, proxy, name, platform, tags, log), log, `Criar '${name}'`, { baseDelay: opts.retryDelay || 3, stop }) }
    catch (e) { log('error', `Falha ao criar '${name}': ${e.message}`); if (progress) progress(i + 1, total, false); continue }
    if (!opts.singleProxy) store.markUsed(proxy, pid, name)
    created.push({ id: pid, name }); number += 1
    log('ok', `Perfil '${name}' criado (ID ${pid}). Abrindo...`)
    if (progress) progress(i + 1, total, true)

    let port = null
    try {
      const res = await withRetry(() => client.startProfile(pid, Boolean(startUrls.length || tile)), log, `Abrir '${name}'`, { baseDelay: 3, stop })
      port = res && res.automation && res.automation.port
      log('ok', `Perfil '${name}' aberto.`)
    } catch (e) { log('error', `Não abri '${name}': ${e.message}. Continuando sem esperar.`); continue }
    if (onOpen && port) onOpen(pid, name, port)

    if (port) {
      if (tile) {
        const bounds = cdp.cellBounds(0, tile, area)
        for (let k = 0; k < 10; k++) { try { await cdp.placeWindow(port, bounds); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }
      }
      if (startUrls.length) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const ids = []
          for (const u of startUrls) ids.push(await cdp.openTab(port, u))
          const k = Math.min(Math.max(focusIndex, 1), ids.length) - 1
          if (ids[k]) await cdp.activateTab(port, ids[k])
        } catch (e) { log('warn', `'${name}': páginas iniciais: ${e.message}`) }
      }
    }

    if (port && i < total - 1) {
      log('step', `Aguardando você FECHAR o perfil '${name}' para criar o próximo...`)
      await waitUntilClosed(port, { stop, log })
      if (stop && stop.stopped) { log('warn', 'Interrompido pelo usuário.'); break }
      log('ok', `'${name}' fechado. Criando o próximo.`)
    }
  }
  log('info', `Sequência concluída: ${created.length} de ${total} perfis.`)
  return created
}

function normalizeUrls(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(l) ? l : 'https://' + l))
}

// ------------------------------------------------------------ espelhamento (cliques)
const EVENT_SCRIPT = `
(() => {
  if (window.__fcMirrorInstalled) return;
  window.__fcMirrorInstalled = true;
  window.__fcMirrorQueue = [];
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      let part = el.tagName.toLowerCase();
      if (el.classList && el.classList.length) {
        const cls = [...el.classList].filter(x => /^[A-Za-z_-][\\w-]*$/.test(x)).slice(0, 2);
        if (cls.length) part += '.' + cls.map(CSS.escape).join('.');
      }
      let n = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) n++;
      part += ':nth-of-type(' + n + ')';
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };
  document.addEventListener('click', e => {
    if (window.__fcMirrorApplying) return;
    window.__fcMirrorQueue.push({selector: cssPath(e.target), action:'click'});
    if (window.__fcMirrorQueue.length > 100) window.__fcMirrorQueue.shift();
  }, true);
})()
`

class ProfileMirror {
  constructor(registry, log) {
    this.registry = registry // Map profileId -> { id, name, port }
    this.log = log || (() => {})
    this.motherId = null
    this.secondaryIds = []
    this.active = false
    this.paused = false
    this.forceUrls = false
    this._motherUrl = ''
    this._timer = null
  }
  configure(motherId, ids) { this.motherId = motherId; this.secondaryIds = ids.filter((x) => x !== motherId) }
  start() {
    if (!this.motherId || !this.secondaryIds.length) throw new Error('selecione um Perfil-Mãe e pelo menos um perfil espelhado')
    if (this.active) return
    this.active = true; this.paused = false
    this._timer = setInterval(() => this._tick().catch(() => {}), 150)
    this.log('ok', 'Espelhamento iniciado.')
  }
  stop() { this.active = false; this.paused = false; if (this._timer) clearInterval(this._timer); this._timer = null; this.log('info', 'Espelhamento encerrado.') }
  togglePause() { if (!this.active) return false; this.paused = !this.paused; this.log(this.paused ? 'warn' : 'ok', this.paused ? 'Espelhamento pausado.' : 'Espelhamento retomado.'); return this.paused }
  setForceUrls(on) { this.forceUrls = Boolean(on); this.log('info', 'Forçar URLs iguais ' + (on ? 'ativado.' : 'desativado.')) }

  async _activePage(profileId) {
    const b = this.registry.get(String(profileId))
    if (!b) throw new Error('perfil fechado')
    const pages = await cdp.listPages(b.port)
    if (!pages.length) throw new Error('nenhuma aba disponível')
    for (const p of pages) {
      try {
        const conn = await cdp.CDP.connect(p.webSocketDebuggerUrl)
        try {
          const r = await conn.call('Runtime.evaluate', { expression: "document.hasFocus() || document.visibilityState === 'visible'", returnByValue: true })
          if (r.result && r.result.value) return p
        } finally { conn.close() }
      } catch { /* tenta a próxima */ }
    }
    return pages[0]
  }
  async _navigate(page, url) {
    const conn = await cdp.CDP.connect(page.webSocketDebuggerUrl)
    try { await conn.call('Page.navigate', { url }) } finally { conn.close() }
  }
  async goToUrl(url) {
    url = (url || '').trim()
    if (!url) throw new Error('informe uma URL')
    if (!['http', 'https', 'file', 'about'].includes(url.split(':', 1)[0].toLowerCase())) url = 'https://' + url
    const ids = [this.motherId, ...this.secondaryIds]
    const errors = []
    for (const id of ids) { try { const p = await this._activePage(id); await this._navigate(p, url) } catch (e) { errors.push(`${id}: ${e.message}`) } }
    if (errors.length) throw new Error(errors.join('; '))
    this._motherUrl = url
    this.log('ok', `Todos os perfis foram direcionados para ${url}.`)
  }
  async _apply(conn, event) {
    const payload = JSON.stringify(event)
    const script = `(function(e){window.__fcMirrorApplying=true;try{const x=document.querySelector(e.selector);if(!x)return false;x.focus();if(e.action==='click'){x.click();}return true;}finally{window.__fcMirrorApplying=false;}})(${payload})`
    await conn.call('Runtime.evaluate', { expression: script, returnByValue: true })
  }
  async _tick() {
    if (!this.active || this.paused) return
    const motherPage = await this._activePage(this.motherId)
    if (!motherPage) return
    const mother = await cdp.CDP.connect(motherPage.webSocketDebuggerUrl)
    try {
      await mother.call('Runtime.enable')
      await mother.call('Runtime.evaluate', { expression: EVENT_SCRIPT, returnByValue: true })
      const read = await mother.call('Runtime.evaluate', {
        expression: "JSON.stringify({url:location.href,events:(window.__fcMirrorQueue||[]).splice(0)})",
        returnByValue: true
      })
      let data = { url: '', events: [] }
      try { data = JSON.parse((read.result && read.result.value) || '{"url":"","events":[]}') } catch { /* keep default */ }
      const currentUrl = data.url || ''
      if (this.forceUrls && currentUrl && currentUrl !== this._motherUrl) {
        for (const id of this.secondaryIds) { try { const p = await this._activePage(id); await this._navigate(p, currentUrl) } catch (e) { this.log('warn', `URL de ${id} não sincronizada: ${e.message}`) } }
      }
      this._motherUrl = currentUrl
      if (data.events && data.events.length) {
        for (const id of this.secondaryIds) {
          let page
          try { page = await this._activePage(id) } catch (e) { this.log('warn', `Perfil espelhado indisponível (${id}): ${e.message}`); continue }
          const conn = await cdp.CDP.connect(page.webSocketDebuggerUrl)
          try { for (const ev of data.events) { try { await this._apply(conn, ev) } catch (e) { this.log('warn', `Ação não replicada: ${e.message}`) } } }
          finally { conn.close() }
        }
      }
    } finally { mother.close() }
  }
}

module.exports = {
  PROXY_TYPES, REMOTE_API, LOCAL_API, DolphinClient, ProfileMirror,
  parseProxy, parseProxyText, proxyKey, proxyDisplay, normalizeUrls, runBatch, runSequential, openProfiles,
  buildAndCreate, waitUntilClosed
}
