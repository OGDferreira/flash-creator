const $ = (id) => document.getElementById(id)
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))

async function load() {
  const { base = 'http://127.0.0.1:8777', token = '', available = [], codes = [], lastSync } = await chrome.storage.local.get(['base', 'token', 'available', 'codes', 'lastSync'])
  $('base').value = base
  $('token').value = token
  $('status').textContent = lastSync ? 'Última sync: ' + new Date(lastSync).toLocaleTimeString('pt-BR') : (token ? 'Aguardando conexão...' : 'Informe o token')
  $('available').innerHTML = available.length
    ? available.map((a) => `<div class="row"><span class="dot"></span><span class="email">${esc(a.email)}</span><span class="muted">${a.count || 0}</span></div>`).join('')
    : '<div class="muted">Nenhum disponível</div>'
  $('codes').innerHTML = codes.length
    ? codes.map((c) => `<div class="row"><span class="code">${esc(c.code)}</span><span class="email">${esc(c.email)}</span><span class="muted">${new Date(c.at).toLocaleTimeString('pt-BR')}</span></div>`).join('')
    : '<div class="muted">Nenhum código ainda</div>'
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ base: $('base').value.trim().replace(/\/$/, ''), token: $('token').value.trim() })
  $('status').textContent = 'Salvo. Conectando...'
  setTimeout(load, 600)
})

chrome.storage.onChanged.addListener(load)
load()
