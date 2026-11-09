// ───────────────────────── Estado ─────────────────────────
let accounts = []
let codes = []
let cfg = { code_limit: 6, window_days: 4 }
let selEmail = null
let cycleUsed = new Set()
let leasedEmails = new Set() // Gmails entregues pela API e "em uso" (aguardando código)

// Sessões de navegador (aba Contas)
let sessions = []
let activeTabId = null
let tabCounter = 0
const POLL_MS = 25000
const seenIds = new Map()

// Dolphin
let okCount = 0, errCount = 0
let mirrorMother = null

const POLL_SCRIPT = `
(async () => {
  try {
    const r = await fetch('https://mail.google.com/mail/feed/atom');
    if (!r.ok) return null;
    const xml = await r.text();
    const g = (s, tag) => { const m = s.match(new RegExp('<' + tag + '>([^<]*)<\\/' + tag + '>')); return m ? m[1] : ''; };
    const feedTitle = g(xml, 'title');
    const emailMatch = feedTitle.match(/([a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,})/);
    const email = emailMatch ? emailMatch[1] : null;
    if (!email) return null;
    const entries = [];
    const re = /<entry>([\\s\\S]*?)<\\/entry>/g; let m;
    while ((m = re.exec(xml)) !== null) {
      const e = m[1];
      const id = g(e, 'id'); const title = g(e, 'title'); const summary = g(e, 'summary'); const sender = g(e, 'name');
      const code = (title + ' ' + summary).match(/\\b(\\d{6})\\b/);
      if (code) entries.push({ id, code: code[1], subject: title, sender, email });
    }
    const allIds = [];
    const re2 = /<entry>([\\s\\S]*?)<\\/entry>/g; let m2;
    while ((m2 = re2.exec(xml)) !== null) { const id = g(m2[1], 'id'); if (id) allIds.push(id); }
    return { email, entries, allIds };
  } catch(e) { return null; }
})()
`

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
function cp(text) { if (text && text !== '—') { window.api.copyText(text); toast('Copiado!', 'ok') } }

// ───────────────────────── Init ─────────────────────────
async function refreshData() {
  const d = await window.api.getData()
  accounts = d.accounts
  codes = d.codes
  cfg = d.config || cfg
  if (!selEmail && accounts.length) { selEmail = accounts[0].email; cycleUsed.add(selEmail) }
  renderCards(); renderManaged(); updateLegend()
}

async function init() {
  await refreshData()
  for (const acc of accounts) createSession(acc.partition, acc.email)

  window.api.onNewCode(async (entry) => {
    toast(`Código ${entry.code} recebido!`, 'ok')
    await refreshData()
  })
  window.api.onLog((e) => appendLog(e.level, e.msg))
  window.api.onProgress((e) => dolphinProgress(e))
  window.api.onProfileOpened(() => loadMade())
  window.api.onSmsUpdate((order) => {
    upsertLocalOrder(order)
    renderSmsOrders()
    if (order && order.sms_code) toast(`Código SMS ${order.sms_code} recebido!`, 'ok')
  })
  window.api.onFlowUpdate((order) => {
    upsertLocalFlow(order)
    renderFlowOrders()
    if (order && order.lastCode) toast(`Código ${order.lastCode} recebido (${order.email || 'Gmail'})!`, 'ok')
  })
  window.api.onLeasesUpdate((emails) => {
    leasedEmails = new Set(emails || [])
    renderCards()
    renderFlowOrders()
  })

  await loadConfigIntoForm()
  await loadServerInfo()
  renderPayloads()
  await loadProxies()
  await loadMade()
}

function updateLegend() {
  const L = cfg.code_limit, D = cfg.window_days
  for (const id of ['legend-limit', 'legend-limit2']) { const el = document.getElementById(id); if (el) el.textContent = L }
  const dd = document.getElementById('legend-days'); if (dd) dd.textContent = D
}

// ───────────────────────── Gmail cards (status + fila) ─────────────────────────
function lastEventAt(acc) {
  const c = codes.find((x) => x.email === acc.email)
  return c ? new Date(c.ts).getTime() : new Date(acc.addedAt || 0).getTime()
}
function orderedAccounts() {
  const rank = (a) => (a.status === 'green' ? 0 : 1)
  return accounts.slice().sort((a, b) => rank(a) - rank(b) || lastEventAt(b) - lastEventAt(a))
}

function renderCards() {
  const grid = document.getElementById('cards-grid')
  if (!accounts.length) { grid.innerHTML = '<div class="muted" style="padding:20px;grid-column:1/-1">Nenhuma conta. Vá em Contas Gmail → Adicionar Gmail.</div>'; renderSwitchHint(); return }
  grid.innerHTML = orderedAccounts().map((acc) => {
    const isActive = acc.email === selEmail
    const acCodes = codes.filter((c) => c.email === acc.email)
    const latest = acCodes[0] || null
    const history = acCodes.slice(1, 8)
    const codeArea = latest
      ? `<div class="code-num" data-act="copy" data-val="${esc(latest.code)}" title="Clique para copiar">${esc(latest.code)}</div>
         <div class="code-meta">${esc(latest.sender ? 'via ' + latest.sender + ' · ' : '')}${esc(latest.received_at)}</div>`
      : '<div class="code-wait">📬 Aguardando código...</div>'
    const hist = history.map((c) => `<div class="hist-item"><span class="hist-num">${esc(c.code)}</span><span class="hist-from">${esc(c.sender || c.subject || '—')}</span><span class="hist-time">${esc((c.received_at || '').split(' ')[1] || c.received_at)}</span><button class="btn ghost sm" data-act="copy" data-val="${esc(c.code)}">Copiar</button></div>`).join('')
    const manualCls = acc.manual ? ' manual' : ''
    const inUse = leasedEmails.has(acc.email)
    const tag = inUse
      ? '<span class="status-tag inuse">em uso</span>'
      : (acc.status === 'green' ? '<span class="status-tag green">disponível</span>' : '<span class="status-tag red">indisponível</span>')
    return `<div class="gmail-card ${acc.status}${inUse ? ' inuse' : ''}${isActive ? ' active' : ''}" data-act="select" data-email="${esc(acc.email)}">
      <div class="card-top">
        <span class="status-dot ${acc.status}${manualCls}" data-act="cycle" data-email="${esc(acc.email)}" title="Clique para fixar/soltar a cor (${acc.manual ? 'manual' : 'automático'})"></span>
        <span class="card-email" data-act="copy" data-val="${esc(acc.email)}" title="Copiar Gmail">${esc(acc.email)}</span>
        ${tag}
        <span class="card-badge" title="${acc.recent} nos últimos ${cfg.window_days} dias">${acc.count || 0}</span>
      </div>
      <div class="code-area">${codeArea}</div>
      ${history.length ? `<div class="hist-label">HISTÓRICO</div>${hist}` : ''}
    </div>`
  }).join('')
  renderSwitchHint()
}

function renderSwitchHint() {
  const remaining = accounts.filter((a) => !cycleUsed.has(a.email)).length
  const h = document.getElementById('switch-hint')
  if (h) h.textContent = accounts.length > 1 ? `· ${remaining} restante(s)` : ''
}

// Delegação de cliques (evita onclick inline com dados do Gmail)
document.getElementById('cards-grid').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]')
  if (!t) return
  const act = t.dataset.act
  if (act === 'copy') { e.stopPropagation(); cp(t.dataset.val) }
  else if (act === 'cycle') { e.stopPropagation(); await cycleStatus(t.dataset.email) }
  else if (act === 'select') { selEmail = t.dataset.email; cycleUsed.add(selEmail); renderCards() }
})

async function cycleStatus(email) {
  const acc = accounts.find((a) => a.email === email)
  if (!acc) return
  const next = acc.manualStatus == null ? 'green' : acc.manualStatus === 'green' ? 'red' : null
  await window.api.setManualStatus(email, next)
  toast(next ? `Status fixado: ${next === 'green' ? 'verde' : 'vermelho'}` : 'Status voltou ao automático')
  await refreshData()
}

function switchAccount() {
  if (!accounts.length) return
  const unused = accounts.filter((a) => !cycleUsed.has(a.email))
  let next
  if (unused.length) next = unused.find((a) => a.email !== selEmail) || unused[0]
  else { cycleUsed.clear(); next = accounts.find((a) => a.email !== selEmail) || accounts[0] }
  selEmail = next.email; cycleUsed.add(selEmail); renderCards()
}

// ───────────────────────── Contas / webviews ─────────────────────────
function renderManaged() {
  const list = document.getElementById('managed-list')
  if (!accounts.length) { list.innerHTML = '<div class="muted">Nenhuma conta cadastrada</div>'; return }
  list.innerHTML = accounts.map((acc) => {
    const sess = sessions.find((s) => s.email === acc.email)
    return `<div class="managed-item">
      <div class="managed-row"><span class="dot ${sess ? 'online' : 'pending'}"></span><span class="managed-email">${esc(acc.email)}</span></div>
      <div class="managed-stats">${acc.count || 0} código(s) · ${acc.status === 'green' ? 'disponível' : 'indisponível'}</div>
      <div class="inline-row" style="margin-top:0">
        <button class="btn ghost sm" data-copy="${esc(acc.email)}">📋 Copiar</button>
        <button class="btn danger sm" data-remove="${esc(acc.email)}">Remover</button>
        ${sess ? `<button class="btn ghost sm" data-open="${sess.tabId}">Abrir</button>` : ''}
      </div></div>`
  }).join('')
}
document.getElementById('managed-list').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-copy]'); const r = e.target.closest('[data-remove]'); const o = e.target.closest('[data-open]')
  if (c) cp(c.dataset.copy)
  else if (r) { await removeAccount(r.dataset.remove) }
  else if (o) { activateTab(o.dataset.open); switchTab('accounts') }
})

function createSession(partition, email) {
  const tabId = 'tab-' + (++tabCounter)
  const session = { tabId, partition, email: email || null, status: email ? 'online' : 'pending', firstPoll: true }
  sessions.push(session)

  const wv = document.createElement('webview')
  wv.id = 'wv-' + tabId
  wv.src = 'https://mail.google.com'
  wv.setAttribute('partition', partition)
  wv.setAttribute('allowpopups', 'true')

  const bar = document.createElement('div')
  bar.className = 'webview-bar'
  bar.innerHTML = `<span class="dot ${email ? 'online' : 'pending'}" id="dot-${tabId}"></span><span id="hint-${tabId}" style="flex:1">${email ? esc(email) : 'Faça login no Gmail — a conta é detectada sozinha'}</span>`
  const reload = document.createElement('button'); reload.className = 'btn ghost sm'; reload.textContent = '↻'; reload.onclick = () => wv.reload(); bar.appendChild(reload)

  const slot = document.createElement('div')
  slot.className = 'webview-slot'; slot.id = 'slot-' + tabId
  slot.appendChild(bar); slot.appendChild(wv)
  document.getElementById('empty-browser').style.display = 'none'
  document.getElementById('webview-container').appendChild(slot)

  wv.addEventListener('dom-ready', () => { setTimeout(() => pollSession(session), 4000); setInterval(() => pollSession(session), POLL_MS) })
  renderBrowserTabs(); activateTab(tabId)
  return session
}

async function pollSession(session) {
  const wv = document.getElementById('wv-' + session.tabId)
  if (!wv) return
  try {
    const result = await wv.executeJavaScript(POLL_SCRIPT)
    if (!result) return
    const { email, entries } = result
    if (!session.email && email) {
      const res = await window.api.addAccount({ email, partition: session.partition })
      if (res.success || (res.error && res.error.includes('já cadastrada'))) {
        session.email = email; session.status = 'online'
        updateSessionBar(session); await refreshData()
        if (res.success) toast(`${email} adicionado!`, 'ok')
      }
    }
    if (session.email) {
      if (!seenIds.has(session.email)) seenIds.set(session.email, new Set())
      const seen = seenIds.get(session.email)
      if (session.firstPoll) { session.firstPoll = false; (result.allIds || []).forEach((id) => seen.add(id)) }
      else { for (const e of entries) { if (seen.has(e.id)) continue; seen.add(e.id); await window.api.receiveCode({ email: session.email, code: e.code, subject: e.subject, sender: e.sender }) } }
    }
  } catch { /* ignore */ }
}

function updateSessionBar(session) {
  const dot = document.getElementById('dot-' + session.tabId); const hint = document.getElementById('hint-' + session.tabId)
  if (dot) dot.className = 'dot ' + (session.status === 'online' ? 'online' : 'pending')
  if (hint) hint.textContent = session.email || 'Faça login no Gmail — a conta é detectada sozinha'
  renderBrowserTabs()
}
async function addNewTab() { const partition = await window.api.getNextPartition(); createSession(partition, null); switchTab('accounts') }
function activateTab(tabId) {
  activeTabId = tabId
  document.querySelectorAll('.webview-slot').forEach((s) => s.classList.remove('active'))
  const slot = document.getElementById('slot-' + tabId); if (slot) slot.classList.add('active')
  renderBrowserTabs()
}
function closeTab(tabId) {
  const idx = sessions.findIndex((s) => s.tabId === tabId); if (idx < 0) return
  const slot = document.getElementById('slot-' + tabId); if (slot) slot.remove()
  sessions.splice(idx, 1)
  if (activeTabId === tabId) {
    activeTabId = sessions.length ? sessions[Math.min(idx, sessions.length - 1)].tabId : null
    if (activeTabId) activateTab(activeTabId); else document.getElementById('empty-browser').style.display = 'flex'
  }
  renderBrowserTabs()
}
function renderBrowserTabs() {
  const bar = document.getElementById('browser-tabs'); bar.innerHTML = ''
  for (const s of sessions) {
    const tab = document.createElement('div'); tab.className = 'browser-tab' + (s.tabId === activeTabId ? ' active' : '')
    const label = document.createElement('span'); label.textContent = s.email || 'Novo Gmail'; label.onclick = () => activateTab(s.tabId)
    const close = document.createElement('span'); close.className = 'tab-close'; close.textContent = '×'; close.onclick = () => closeTab(s.tabId)
    tab.appendChild(label); tab.appendChild(close); bar.appendChild(tab)
  }
  const add = document.createElement('button'); add.className = 'add-tab-btn'; add.textContent = '+'; add.title = 'Adicionar Gmail'; add.onclick = addNewTab; bar.appendChild(add)
}
async function removeAccount(email) {
  await window.api.removeAccount(email)
  const sess = sessions.find((s) => s.email === email); if (sess) closeTab(sess.tabId)
  if (selEmail === email) selEmail = null
  cycleUsed.delete(email); await refreshData()
}

// ───────────────────────── Dolphin ─────────────────────────
async function loadStats() {
  const { counts } = await window.api.proxyList()
  const only4g = (document.getElementById('d-only4g') || {}).checked !== false
  document.getElementById('st-free').textContent = only4g ? (counts.free4g || 0) : counts.free
  document.getElementById('st-used').textContent = counts.used
  const sub = document.getElementById('d-substatus')
  const running = document.getElementById('d-stop') && !document.getElementById('d-stop').disabled
  if (sub && !running) sub.textContent = `${counts.free4g || 0} proxies Mobile 4G livres · ${counts.free} livres no total`
}
function dolphinProgress(e) {
  if (e.ok) okCount++; else errCount++
  document.getElementById('st-ok').textContent = okCount
  document.getElementById('st-err').textContent = errCount
  document.getElementById('d-bar').style.width = (e.done / e.total * 100) + '%'
  document.getElementById('d-status').textContent = `Executando: ${e.done} de ${e.total}`
  loadStats()
}
// Proxies marcadas na aba Proxies (host:port:login). Vazio = usa qualquer uma livre.
function selectedProxyKeys() {
  return [...document.querySelectorAll('.proxy-sel:checked')].map((c) => c.value)
}
async function dolphinCreate() {
  okCount = 0; errCount = 0
  document.getElementById('st-ok').textContent = 0; document.getElementById('st-err').textContent = 0; document.getElementById('d-bar').style.width = '0'
  document.getElementById('d-run').disabled = true; document.getElementById('d-stop').disabled = false
  document.getElementById('d-status').textContent = 'Iniciando...'
  const opts = {
    quantity: +document.getElementById('d-qty').value, namePattern: document.getElementById('d-name').value,
    startNumber: +document.getElementById('d-start').value, platform: document.getElementById('d-platform').value,
    tags: document.getElementById('d-tags').value, delay: +document.getElementById('d-delay').value,
    openAfter: document.getElementById('d-open').checked, startUrls: document.getElementById('d-urls').value,
    pageZoom: +document.getElementById('d-zoom').value, focusIndex: +document.getElementById('d-focus').value,
    tile: document.getElementById('d-tile').checked, tileCount: +document.getElementById('d-tilecount').value,
    autoMirror: document.getElementById('d-automirror').checked, autoMirrorName: document.getElementById('d-mirrorname').value,
    only4g: document.getElementById('d-only4g').checked,
    rotateSingle: document.getElementById('d-rotate4g').checked, rotateWait: +document.getElementById('d-rotatewait').value,
    sequential: document.getElementById('d-sequential').checked,
    selectedProxies: selectedProxyKeys()
  }
  const res = await window.api.dolphinCreate(opts)
  document.getElementById('d-run').disabled = false; document.getElementById('d-stop').disabled = true
  if (res.error) { document.getElementById('d-status').textContent = 'Erro'; toast(res.error, 'error') }
  else { document.getElementById('d-status').textContent = `Concluído: ${res.created} perfis criados`; document.getElementById('d-start').value = res.nextNumber; toast(`${res.created} perfis criados`, 'ok') }
  loadStats(); loadMade()
}
function dolphinStop() { window.api.dolphinStop() }
function toggleRotate4g() {
  const on = document.getElementById('d-rotate4g').checked
  document.getElementById('d-rotate-wait-row').style.display = on ? 'flex' : 'none'
  const only = document.getElementById('d-only4g')
  only.disabled = on // no modo rotação é 1 proxy só, não "uma por perfil"
}
function toggleSequential() {
  const on = document.getElementById('d-sequential').checked
  const open = document.getElementById('d-open')
  open.disabled = on // no modo sequência cada perfil já abre sozinho, um por vez
  if (on) open.checked = false
}
async function dolphinTest() {
  await window.api.setConfig(collectConfig())
  const r = await window.api.dolphinTest()
  const set = (dot, txt, state, labels) => { const d = document.getElementById(dot), t = document.getElementById(txt); d.className = 'dot-sm ' + (state === 'ok' ? 'green' : state === 'no-token' ? '' : 'red'); t.textContent = labels[state] || labels.err }
  set('s-remote', 's-remote-txt', r.remote, { ok: 'API remota: conectada', erro: 'API remota: erro', 'no-token': 'API remota: sem token', err: 'API remota: erro' })
  set('s-local', 's-local-txt', r.local, { ok: 'Dolphin local: conectado', offline: 'Dolphin local: offline', 'no-token': 'Dolphin local: sem token', err: 'Dolphin local: offline' })
}
let madeData = []
async function loadMade() {
  const { made } = await window.api.dolphinMadeList(); madeData = made
  const el = document.getElementById('made-list')
  if (!made.length) { el.innerHTML = '<div class="made-row muted">Nenhum perfil criado ainda.</div>' }
  else {
    el.innerHTML = '<div class="made-row head"><input type="checkbox" id="made-all"><span class="col-grow">PERFIL</span><span style="width:110px">ID</span><span style="width:70px">ESTADO</span></div>' +
      made.map((m) => `<label class="made-row"><input type="checkbox" class="made-cb" value="${esc(m.id)}"><span class="col-grow">${esc(m.name)} <span class="muted">· ${esc(m.proxy)}</span></span><span style="width:110px" class="muted">${esc(m.id)}</span><span style="width:70px">${m.open ? '<span class="pill free">aberto</span>' : '<span class="pill used">—</span>'}</span></label>`).join('')
    document.getElementById('made-all').onclick = (e) => document.querySelectorAll('.made-cb').forEach((c) => { c.checked = e.target.checked })
  }
  document.getElementById('made-count').textContent = `${made.length} perfis`
  const names = made.map((m) => m.name)
  const sel = document.getElementById('d-mirrorname'); sel.innerHTML = ['Primeiro perfil aberto', ...names].map((n) => `<option>${esc(n)}</option>`).join('')
}
function selectedMade() { return Array.from(document.querySelectorAll('.made-cb:checked')).map((c) => c.value) }
async function openSelected() { const ids = selectedMade(); if (!ids.length) return toast('Selecione um ou mais perfis', 'error'); const r = await window.api.dolphinOpen(ids); if (r.error) toast(r.error, 'error'); loadMade() }
async function openAll() { const ids = madeData.map((m) => m.id); if (!ids.length) return; const r = await window.api.dolphinOpen(ids); if (r.error) toast(r.error, 'error'); loadMade() }
async function refreshRemote() { const r = await window.api.dolphinRefreshRemote(); if (r.error) toast(r.error, 'error'); else loadMade() }

// Espelhamento
async function mirrorSetMother() { const ids = selectedMade(); if (!ids.length) return toast('Selecione o perfil aberto que será a mãe', 'error'); mirrorMother = ids[0]; await window.api.mirrorConfigure(mirrorMother, madeData.map((m) => m.id)); document.getElementById('mirror-status').textContent = 'Perfil-Mãe definido · pronto para iniciar' }
async function mirrorStart() { if (!mirrorMother) { await mirrorSetMother(); if (!mirrorMother) return } const r = await window.api.mirrorStart(); if (r.error) return toast(r.error, 'error'); document.getElementById('m-start').disabled = true; document.getElementById('m-pause').disabled = false; document.getElementById('mirror-status').textContent = 'Ativo · cliques do Perfil-Mãe sendo replicados' }
async function mirrorPause() { const r = await window.api.mirrorPause(); document.getElementById('m-pause').textContent = r.paused ? 'Retomar' : 'Pausar'; document.getElementById('mirror-status').textContent = r.paused ? 'Pausado' : 'Ativo · replicando' }
async function mirrorStop() { await window.api.mirrorStop(); document.getElementById('m-start').disabled = false; document.getElementById('m-pause').disabled = true; document.getElementById('m-pause').textContent = 'Pausar'; document.getElementById('mirror-status').textContent = 'Inativo · espelhamento encerrado' }
function mirrorForceUrls(on) { window.api.mirrorForceUrls(on) }
async function mirrorGoUrl() { const r = await window.api.mirrorGoUrl(document.getElementById('m-url').value); if (r.error) toast(r.error, 'error') }

// ───────────────────────── Proxies ─────────────────────────
async function loadProxies() {
  const { proxies, counts } = await window.api.proxyList()
  const el = document.getElementById('proxy-list')
  if (!proxies.length) el.innerHTML = '<div class="made-row muted">Nenhuma proxy na lista.</div>'
  else el.innerHTML = '<div class="made-row head"><span style="width:30px"><input type="checkbox" id="proxy-sel-all" title="Selecionar/limpar todas as livres"></span><span style="width:70px">STATUS</span><span class="col-grow">PROXY</span><span style="width:130px">GB / FONTE</span><span style="width:150px">PERFIL</span></div>' +
    proxies.map((p) => {
      const gb = p.source === 'allan'
        ? (p.disponivelGb != null ? `${Number(p.disponivelGb).toFixed(1)}/${p.totalGb || p.gbContratado || '?'} GB` : (p.gbContratado != null ? `${p.gbContratado} GB` : 'Allan'))
        : '<span class="muted">manual</span>'
      const rotate = p.source === 'allan' ? ` <button class="btn ghost sm" data-rotate="${esc(p.login)}" title="Trocar localização / novo IP">↻ IP</button>` : ''
      const warn = p.source === 'allan' && !p.password ? ' <span class="pill used" style="color:var(--red)">sem senha</span>' : ''
      const cat = p.category === 'mobile4g' ? ' <span class="pill" style="background:var(--accent-soft);color:#cbb6ff">4G</span>' : p.category === 'residencial' ? ' <span class="pill used">resid</span>' : ''
      // chave de seleção SEM senha (host:port:login). Só proxies livres dá pra selecionar.
      const selKey = `${p.host}:${p.port}:${p.login || ''}`
      const check = p.used ? '' : `<input type="checkbox" class="proxy-sel" value="${esc(selKey)}">`
      return `<div class="made-row"><span style="width:30px">${check}</span><span style="width:70px">${p.used ? '<span class="pill used">usada</span>' : '<span class="pill free">livre</span>'}</span><span class="col-grow">${esc(p.display)}${cat}${warn}</span><span style="width:130px" class="muted">${gb}${rotate}</span><span style="width:150px" class="muted">${p.used ? esc(p.profile_name || '') : ''}</span></div>`
    }).join('')
  const selAll = document.getElementById('proxy-sel-all')
  if (selAll) selAll.addEventListener('change', () => {
    document.querySelectorAll('.proxy-sel').forEach((c) => { c.checked = selAll.checked })
  })
  document.getElementById('p-count').textContent = `${counts.free} livres · ${counts.free4g || 0} Mobile 4G livres · ${counts.used} usadas · ${counts.free + counts.used} total`
  loadAllanForm()
  loadStats()
}
async function proxyAdd() { const text = document.getElementById('p-text').value; if (!text.trim()) return toast('Cole as proxies primeiro', 'error'); const r = await window.api.proxyAdd(text, document.getElementById('p-type').value, document.getElementById('p-cat').value); if (r.added) document.getElementById('p-text').value = ''; toast(`${r.added} adicionadas, ${r.dup} repetidas`, 'ok'); loadProxies() }

// Allan Proxys (API do fornecedor)
async function loadAllanForm() {
  const c = await window.api.getConfig()
  document.getElementById('a-key').value = c.allan_key || ''
  document.getElementById('a-pass').value = c.allan_password || ''
  document.getElementById('a-type').value = c.allan_type || 'http'
}
async function saveAllanCfg() {
  await window.api.setConfig({ allan_key: document.getElementById('a-key').value.trim(), allan_password: document.getElementById('a-pass').value.trim(), allan_type: document.getElementById('a-type').value })
}
async function allanTest() { await saveAllanCfg(); const r = await window.api.allanTest(); document.getElementById('a-status').textContent = r.error ? r.error : `OK: ${r.conta.proxies} proxies`; toast(r.error || 'Chave válida', r.error ? 'error' : 'ok') }
async function allanFetch() {
  await saveAllanCfg()
  const r = await window.api.allanFetch()
  if (r.error) { document.getElementById('a-status').textContent = r.error; return toast(r.error, 'error') }
  document.getElementById('a-status').textContent = `${r.added} importadas, ${r.updated} atualizadas`
  if (r.missingPassword) toast('Importado — mas preencha a senha das proxies p/ elas funcionarem', 'error')
  else toast(`${r.added} importadas, ${r.updated} atualizadas`, 'ok')
  loadProxies()
}
async function allanBalances() { await saveAllanCfg(); document.getElementById('a-status').textContent = 'Consultando saldos...'; const r = await window.api.allanBalances(); if (r.error) return toast(r.error, 'error'); document.getElementById('a-status').textContent = `Saldo de ${r.ok}/${r.total} atualizado`; loadProxies() }
async function allanRotate(login) { const r = await window.api.allanRotate(login); toast(r.error || `IP de ${login} rotacionado`, r.error ? 'error' : 'ok'); if (!r.error) setTimeout(() => allanBalances(), 500) }
document.getElementById('proxy-list').addEventListener('click', (e) => { const b = e.target.closest('[data-rotate]'); if (b) allanRotate(b.dataset.rotate) })
async function proxyRemoveUnused() { if (!confirm('Remover todas as proxies livres?')) return; await window.api.proxyRemoveUnused(); loadProxies() }
async function proxyResetUsed() { if (!confirm('Marcar TODAS as proxies como livres?')) return; await window.api.proxyResetUsed(); loadProxies() }
async function proxyClear() { if (!confirm('Apagar a lista INTEIRA de proxies? Não dá para desfazer.')) return; await window.api.proxyClear(); loadProxies() }

// ───────────────────────── API / Extensão ─────────────────────────
let serverInfo = { port: 8777, token: '', enabled: true, running: false }
async function loadServerInfo() {
  serverInfo = await window.api.getServerInfo()
  document.getElementById('srv-state').textContent = serverInfo.running ? 'no ar' : 'desligado'
  document.getElementById('srv-url').textContent = `http://127.0.0.1:${serverInfo.port}`
  document.getElementById('srv-token').textContent = serverInfo.token
  document.getElementById('srv-enabled').checked = serverInfo.enabled
  document.getElementById('srv-port').value = serverInfo.port
  renderPayloads()
}
async function toggleServer(on) { await window.api.setConfig({ server_enabled: on }); await window.api.restartServer(); await loadServerInfo() }
async function setPort(v) { await window.api.setConfig({ server_port: +v }); await window.api.restartServer(); await loadServerInfo() }
async function regenToken() { const r = await window.api.regenToken(); serverInfo.token = r.token; await loadServerInfo(); toast('Novo token gerado', 'ok') }
function renderPayloads() {
  const base = `http://127.0.0.1:${serverInfo.port}`
  document.getElementById('payload-code').textContent = JSON.stringify({ type: 'code', email: 'exemplo@gmail.com', code: '123456', subject: 'Seu código de verificação', sender: 'Google', received_at: '05/11/2026 17:02:11' }, null, 2)
  document.getElementById('payload-available').textContent = JSON.stringify({ available: [{ email: 'conta1@gmail.com', count: 2 }, { email: 'conta2@gmail.com', count: 0 }] }, null, 2)
  const smsEl = document.getElementById('payload-sms')
  if (smsEl) smsEl.textContent = JSON.stringify({ type: 'sms', order_id: 'abc123', phone: '+5511999999999', code: '456789', service: 'whatsapp', country: 'brazil', status: 'sms_received' }, null, 2)
  const smsListEl = document.getElementById('payload-sms-list')
  if (smsListEl) smsListEl.textContent = JSON.stringify({ sms: [{ order_id: 'abc123', phone: '+5511999999999', service: 'whatsapp', country: 'brazil', status: 'active', code: null }] }, null, 2)
  const flowEl = document.getElementById('payload-flow')
  if (flowEl) flowEl.textContent = JSON.stringify({ type: 'flow', order_id: 'ord_789', email: 'contaxyz@gmail.com', code: '654321', service_id: 'svc_google' }, null, 2)
  document.getElementById('payload-js').textContent =
`// background.js da sua extensão (modo desenvolvedor)
const BASE = '${base}';
const TOKEN = '${serverInfo.token}';

// 1) Puxar os Gmails disponíveis
async function disponiveis() {
  const r = await fetch(BASE + '/api/available?token=' + TOKEN);
  const { available } = await r.json();
  return available; // [{ email, count }]
}

// 2) Puxar os números SMS ativos (telefone + último OTP)
async function smsAtivos() {
  const r = await fetch(BASE + '/api/sms?token=' + TOKEN);
  const { sms } = await r.json();
  return sms; // [{ order_id, phone, service, country, status, code }]
}

// 3) Receber código em tempo real (Gmail E SMS no mesmo socket)
const ws = new WebSocket(BASE.replace('http','ws') + '/ws?token=' + TOKEN);
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'code') {
    // código de Gmail
    console.log('Gmail:', msg.email, msg.code);
  } else if (msg.type === 'sms') {
    // OTP de número SMS
    console.log('SMS:', msg.phone, msg.code, msg.service);
    // ...sua lógica aqui...
  } else if (msg.type === 'flow') {
    // código de um Gmail comprado (FlowOTP)
    console.log('Gmail comprado:', msg.email, msg.code);
    // ...sua lógica aqui...
  } else if (msg.type === 'available' || msg.type === 'sms_available' || msg.type === 'flow_available' || msg.type === 'snapshot') {
    // listas atualizadas: msg.available (Gmails verdes), msg.sms (números), msg.flow (Gmails comprados)
  }
};

// 4) Gmails comprados sob demanda + comprar outro quando a cota esgota
async function gmailsComprados() {
  const r = await fetch(BASE + '/api/flow?token=' + TOKEN);
  const { flow } = await r.json();  // [{ order_id, email, code, quota_remaining, exhausted }]
  return flow;
}
async function comprarGmail(serviceId, maxReais) {
  const r = await fetch(BASE + '/api/flow/buy?token=' + TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: serviceId, max_price_cents: maxReais ? Math.round(maxReais*100) : undefined })
  });
  return r.json(); // { ok, order } ou { error }
}
// Ex.: se nenhum Gmail tem código disponível (cota esgotada), compra outro
async function trocarSeEsgotou(serviceId) {
  const ativos = (await gmailsComprados()).filter(g => !g.exhausted);
  if (!ativos.length) await comprarGmail(serviceId);
}`
}

// ───────────────────────── Números SMS (AllanSMS) ─────────────────────────
let smsOrders = []
const SMS_FINAL = new Set(['completed', 'cancelled', 'expired', 'failed', 'refunded'])
const SMS_STATUS_PT = {
  searching_number: 'procurando número', active: 'ativo', sms_received: 'SMS recebido',
  completed: 'finalizado', cancelled: 'cancelado', expired: 'expirado', failed: 'falhou', refunded: 'estornado'
}
const brl = (cents) => cents == null ? '' : 'R$ ' + (Number(cents) / 100).toFixed(2)

async function loadSmsForm() {
  const c = await window.api.getConfig()
  document.getElementById('sms-key').value = c.allansms_key || ''
  if (c.allansms_country) document.getElementById('sms-country').value = c.allansms_country
}
async function saveSmsKey() {
  await window.api.setConfig({ allansms_key: document.getElementById('sms-key').value.trim() })
}
async function smsTest() {
  await saveSmsKey()
  const r = await window.api.smsTest()
  const st = document.getElementById('sms-key-status')
  if (r.error) { st.textContent = r.error; st.style.color = 'var(--red)'; return toast(r.error, 'error') }
  st.style.color = ''
  st.textContent = `OK · ${r.me.email || r.me.name || ''} · saldo ${brl(r.me.balance_cents)}${r.test ? ' · MODO TESTE' : ''}`
  document.getElementById('sms-balance').textContent = `Saldo: ${brl(r.me.balance_cents)}${r.test ? ' (teste)' : ''}`
  toast('Chave válida', 'ok')
  smsLoadCountries(); smsLoadServices()
}
async function smsLoadCountries() {
  const r = await window.api.smsCountries()
  if (r.error || !r.countries) return
  const sel = document.getElementById('sms-country')
  const cur = sel.value
  sel.innerHTML = r.countries.map((c) => `<option value="${esc(c.code)}">${esc(c.name || c.code)}</option>`).join('')
  if (r.countries.find((c) => c.code === cur)) sel.value = cur
}
async function smsLoadServices() {
  await saveSmsKey()
  const country = document.getElementById('sms-country').value
  const sel = document.getElementById('sms-service')
  sel.innerHTML = '<option value="">carregando...</option>'
  const r = await window.api.smsServices(country)
  if (r.error) { sel.innerHTML = '<option value="">—</option>'; return toast(r.error, 'error') }
  const list = (r.services || []).filter((s) => s.available !== false)
  const cur = sel.value
  sel.innerHTML = '<option value="">escolha...</option>' + list.map((s) => {
    const price = s.price_cents != null ? ` · ${brl(s.price_cents)}` : ''
    const stock = s.stock != null ? ` · ${s.stock} em estoque` : ''
    return `<option value="${esc(s.code)}">${esc(s.name || s.code)}${price}${stock}</option>`
  }).join('')
  if (cur) sel.value = cur
}
async function smsBuy() {
  await saveSmsKey()
  const service = document.getElementById('sms-service').value
  if (!service) return toast('Escolha o serviço', 'error')
  const country = document.getElementById('sms-country').value
  const maxReais = document.getElementById('sms-maxprice').value
  const opts = { country, service }
  if (maxReais) opts.maxPriceCents = Math.round(parseFloat(maxReais) * 100)
  const btn = document.getElementById('sms-buy-btn'); btn.disabled = true
  document.getElementById('sms-buy-status').textContent = 'Comprando número...'
  const r = await window.api.smsBuy(opts)
  btn.disabled = false
  if (r.error) { document.getElementById('sms-buy-status').textContent = r.error; return toast(r.error, 'error') }
  document.getElementById('sms-buy-status').textContent = `Número ${r.order.phone || ''} comprado — aguardando código...`
  toast('Número comprado! Aguardando SMS', 'ok')
  upsertLocalOrder(r.order)
  renderSmsOrders()
}
function upsertLocalOrder(order) {
  if (!order || !order.id) return
  const i = smsOrders.findIndex((o) => String(o.id) === String(order.id))
  if (i >= 0) smsOrders[i] = { ...smsOrders[i], ...order }; else smsOrders.unshift(order)
}
async function smsRefreshList() {
  const r = await window.api.smsList()
  smsOrders = r.orders || []
  renderSmsOrders()
}
function renderSmsOrders() {
  const el = document.getElementById('sms-orders')
  if (!smsOrders.length) { el.innerHTML = '<div class="made-row muted">Nenhum número comprado ainda.</div>'; document.getElementById('sms-count').textContent = ''; return }
  el.innerHTML = smsOrders.map((o) => {
    const final = o.is_final || SMS_FINAL.has(o.status)
    const code = o.sms_code
      ? `<span class="hist-num" data-act="copy" data-val="${esc(o.sms_code)}" title="Copiar código" style="cursor:pointer;font-size:16px">${esc(o.sms_code)}</span>`
      : (final ? '<span class="muted">sem código</span>' : '<span class="muted">⏳ aguardando SMS...</span>')
    const statusCls = o.status === 'sms_received' ? 'free' : final && o.status !== 'completed' ? 'used' : ''
    const canCancel = !final && (o.can_cancel || o.status === 'active' || o.status === 'searching_number')
    const canFinish = !final && (o.status === 'active' || o.status === 'sms_received')
    const actions = [
      o.sms_code ? `<button class="btn ghost sm" data-act="copy" data-val="${esc(o.sms_code)}">Copiar código</button>` : '',
      canCancel ? `<button class="btn ghost sm" data-cancel="${esc(o.id)}">Cancelar</button>` : '',
      canFinish ? `<button class="btn ghost sm" data-finish="${esc(o.id)}">Encerrar</button>` : ''
    ].filter(Boolean).join(' ')
    return `<div class="made-row" style="align-items:center">
      <span class="col-grow">
        <b>${esc(o.service || '')}</b> <span class="muted">${esc(o.country || '')}</span><br>
        <span data-act="copy" data-val="${esc(o.phone || '')}" title="Copiar número" style="cursor:pointer">📞 ${esc(o.phone || '—')}</span>
        ${o.price_cents != null ? `<span class="muted"> · ${esc(brl(o.price_cents))}</span>` : ''}
      </span>
      <span style="width:150px">${code}</span>
      <span style="width:110px"><span class="pill ${statusCls}">${esc(SMS_STATUS_PT[o.status] || o.status || '')}</span></span>
      <span style="width:220px;text-align:right">${actions}</span>
    </div>`
  }).join('')
  document.getElementById('sms-count').textContent = `${smsOrders.length}`
}
document.getElementById('sms-orders').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-act="copy"]')
  const cancel = e.target.closest('[data-cancel]')
  const finish = e.target.closest('[data-finish]')
  if (copy) cp(copy.dataset.val)
  else if (cancel) { const r = await window.api.smsCancel(cancel.dataset.cancel); if (r.error) toast(r.error, 'error'); else { toast('Cancelado', 'ok'); if (r.order) upsertLocalOrder(r.order); renderSmsOrders() } }
  else if (finish) { const r = await window.api.smsFinish(finish.dataset.finish); if (r.error) toast(r.error, 'error'); else { toast('Número encerrado', 'ok'); if (r.order) upsertLocalOrder(r.order); renderSmsOrders() } }
})
async function smsClearDone() { const r = await window.api.smsClear(); smsOrders = r.orders || []; renderSmsOrders() }
async function loadSms() { await loadSmsForm(); await smsRefreshList(); if (document.getElementById('sms-service').options.length <= 1) { smsLoadCountries(); smsLoadServices() } }

// ───────────────────────── Gmail comprados (FlowOTP) ─────────────────────────
let flowOrders = []
const FLOW_STATUS_PT = {
  processing: 'preparando', waiting: 'aguardando', active: 'ativo', unavailable: 'indisponível',
  review: 'em revisão', refunded: 'estornado', failed: 'falhou'
}
async function loadFlowForm() {
  const c = await window.api.getConfig()
  document.getElementById('flow-key').value = c.flowotp_key || ''
}
async function saveFlowKey() { await window.api.setConfig({ flowotp_key: document.getElementById('flow-key').value.trim() }) }
async function flowSaveService() { const v = document.getElementById('flow-service').value; if (v) await window.api.setConfig({ flowotp_service: v }) }
async function flowTest() {
  await saveFlowKey()
  const r = await window.api.flowTest()
  const st = document.getElementById('flow-key-status')
  if (r.error) { st.textContent = r.error; st.style.color = 'var(--red)'; return toast(r.error, 'error') }
  st.style.color = ''
  const w = r.wallet || {}
  st.textContent = `OK · saldo ${brl(w.available_cents)}${w.loyalty ? ' · desconto ' + (w.loyalty.discount_percent || 0) + '%' : ''}`
  document.getElementById('flow-balance').textContent = `Saldo: ${brl(w.available_cents)}`
  toast('Chave válida', 'ok')
  flowLoadServices()
}
async function flowLoadServices() {
  await saveFlowKey()
  const sel = document.getElementById('flow-service')
  sel.innerHTML = '<option value="">carregando...</option>'
  const r = await window.api.flowProducts()
  if (r.error) { sel.innerHTML = '<option value="">—</option>'; return toast(r.error, 'error') }
  if (r.maintenance) toast('FlowOTP em manutenção', 'error')
  const cur = sel.value
  const list = r.services || []
  sel.innerHTML = '<option value="">escolha...</option>' + list.map((s) => {
    const pr = (s.priorities && s.priorities[0] && s.priorities[0].price_cents != null) ? ` · ${brl(s.priorities[0].price_cents)}` : ''
    return `<option value="${esc(s.id)}">${esc(s.name || s.id)}${pr}</option>`
  }).join('')
  if (cur) sel.value = cur
}
async function flowBuy() {
  await saveFlowKey()
  const serviceId = document.getElementById('flow-service').value
  if (!serviceId) return toast('Escolha o serviço', 'error')
  const maxReais = document.getElementById('flow-maxprice').value
  const opts = { serviceId }
  if (maxReais) opts.maxPriceCents = Math.round(parseFloat(maxReais) * 100)
  const btn = document.getElementById('flow-buy-btn'); btn.disabled = true
  document.getElementById('flow-buy-status').textContent = 'Comprando...'
  const r = await window.api.flowBuy(opts)
  btn.disabled = false
  if (r.error) { document.getElementById('flow-buy-status').textContent = r.error; return toast(r.error, 'error') }
  document.getElementById('flow-buy-status').textContent = 'Comprado — aguardando o Gmail e o código...'
  toast('Gmail comprado! Aguardando código', 'ok')
  upsertLocalFlow(r.order); renderFlowOrders()
}
function upsertLocalFlow(order) {
  if (!order) return
  const keyOf = (o) => o.order_id || o.intentId
  const i = flowOrders.findIndex((o) => keyOf(o) === keyOf(order))
  if (i >= 0) flowOrders[i] = { ...flowOrders[i], ...order }; else flowOrders.unshift(order)
}
async function flowRefreshList() { const r = await window.api.flowList(); flowOrders = r.orders || []; renderFlowOrders() }
function renderFlowOrders() {
  const el = document.getElementById('flow-orders')
  if (!flowOrders.length) { el.innerHTML = '<div class="made-row muted">Nenhum Gmail comprado ainda.</div>'; document.getElementById('flow-count').textContent = ''; return }
  el.innerHTML = flowOrders.map((o) => {
    const email = o.email ? `<span data-act="copy" data-val="${esc(o.email)}" title="Copiar e-mail" style="cursor:pointer">📧 ${esc(o.email)}</span>` : '<span class="muted">aguardando Gmail...</span>'
    const code = o.lastCode
      ? `<span class="hist-num" data-act="copy" data-val="${esc(o.lastCode)}" title="Copiar código" style="cursor:pointer;font-size:16px">${esc(o.lastCode)}</span>`
      : (o.closed ? '<span class="muted">sem código</span>' : '<span class="muted">⏳ aguardando...</span>')
    const q = o.code_quota ? `<span class="muted"> · ${o.code_quota.used || 0}/${o.code_quota.limit || 3} em 24h</span>` : ''
    const inUse = o.email && leasedEmails.has(o.email)
    const statusCls = inUse ? 'inuse' : (o.lastCode ? 'free' : (o.closed ? 'used' : ''))
    const statusTxt = inUse ? 'em uso' : (FLOW_STATUS_PT[o.status] || o.status || '')
    const actions = o.lastCode ? `<button class="btn ghost sm" data-act="copy" data-val="${esc(o.lastCode)}">Copiar código</button>` : ''
    return `<div class="made-row" style="align-items:center">
      <span class="col-grow">${email}${q}</span>
      <span style="width:130px">${code}</span>
      <span style="width:110px"><span class="pill ${statusCls}">${esc(statusTxt)}</span></span>
      <span style="width:160px;text-align:right">${actions}</span>
    </div>`
  }).join('')
  document.getElementById('flow-count').textContent = `${flowOrders.length}`
}
document.getElementById('flow-orders').addEventListener('click', (e) => {
  const copy = e.target.closest('[data-act="copy"]'); if (copy) cp(copy.dataset.val)
})
async function flowClearDone() { const r = await window.api.flowClear(); flowOrders = r.orders || []; renderFlowOrders() }
async function loadFlow() { await loadFlowForm(); await flowRefreshList(); if (document.getElementById('flow-service').options.length <= 1) flowLoadServices() }

// ───────────────────────── Configurações ─────────────────────────
function collectConfig() {
  return {
    token: document.getElementById('s-token').value.trim(),
    remote_api: document.getElementById('s-remote-api').value.trim(),
    local_api: document.getElementById('s-local-api').value.trim(),
    code_limit: +document.getElementById('s-limit').value || 6,
    window_days: +document.getElementById('s-days').value || 4
  }
}
async function loadConfigIntoForm() {
  const c = await window.api.getConfig()
  document.getElementById('s-token').value = c.token || ''
  document.getElementById('s-remote-api').value = c.remote_api || ''
  document.getElementById('s-local-api').value = c.local_api || ''
  document.getElementById('s-limit').value = c.code_limit || 6
  document.getElementById('s-days').value = c.window_days || 4
}
async function saveSettings() { await window.api.setConfig(collectConfig()); await refreshData(); toast('Configurações salvas', 'ok') }

// ───────────────────────── Navegação / log / toast ─────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('show'))
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'))
  document.getElementById('tab-' + name).classList.add('show')
  document.getElementById('nav-' + name).classList.add('active')
  if (name === 'dolphin') { loadStats(); loadMade() }
  if (name === 'proxies') loadProxies()
  if (name === 'sms') loadSms()
  if (name === 'flow') loadFlow()
  if (name === 'api') loadServerInfo()
}
function toggleLog() { document.getElementById('log-drawer').classList.toggle('open') }
function appendLog(level, msg) {
  const body = document.getElementById('log-body')
  const line = document.createElement('div'); line.className = 'log-line ' + level
  const t = new Date().toLocaleTimeString('pt-BR')
  line.innerHTML = `<span class="t">${t}</span> ${esc(msg)}`
  body.appendChild(line); body.scrollTop = body.scrollHeight
  while (body.children.length > 500) body.removeChild(body.firstChild)
}
let toastTimer
function toast(msg, type = '') { const el = document.getElementById('toast'); el.textContent = msg; el.className = 'show ' + type; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = '' }, 2500) }

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') switchTab('codes') })

// expõe funções usadas por onclick inline do HTML estático
Object.assign(window, { switchTab, switchAccount, addNewTab, dolphinCreate, dolphinStop, dolphinTest, openSelected, openAll, refreshRemote, mirrorSetMother, mirrorStart, mirrorPause, mirrorStop, mirrorForceUrls, mirrorGoUrl, proxyAdd, proxyRemoveUnused, proxyResetUsed, proxyClear, allanTest, allanFetch, allanBalances, allanRotate, smsTest, smsLoadServices, smsBuy, smsRefreshList, smsClearDone, flowTest, flowLoadServices, flowSaveService, flowBuy, flowRefreshList, flowClearDone, toggleRotate4g, toggleSequential, toggleServer, setPort, regenToken, saveSettings, toggleLog, cp })

init()
