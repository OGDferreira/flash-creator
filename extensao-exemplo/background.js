// Service worker da extensão de exemplo.
// Conecta no servidor local do Flash Creator, recebe os códigos em tempo real
// (WebSocket) e mantém a lista de Gmails disponíveis no storage.
//
// OBS: no Manifest V3 o service worker pode ser desligado pelo Chrome quando
// fica ocioso. Por isso usamos chrome.alarms para reabrir o WebSocket e
// re-puxar a lista de disponíveis a cada 1 min. Para um uso intenso, considere
// manter o popup aberto ou migrar para uma extensão com página persistente.

let ws = null

async function cfg() {
  const { base = 'http://127.0.0.1:8777', token = '' } = await chrome.storage.local.get(['base', 'token'])
  return { base, token }
}

async function puxarDisponiveis() {
  const { base, token } = await cfg()
  if (!token) return
  try {
    const r = await fetch(`${base}/api/available?token=${encodeURIComponent(token)}`)
    if (!r.ok) return
    const { available } = await r.json()
    await chrome.storage.local.set({ available, lastSync: Date.now() })
  } catch { /* servidor fora do ar */ }
}

async function conectar() {
  const { base, token } = await cfg()
  if (!token) return
  try { if (ws && ws.readyState <= 1) return } catch { /* ignore */ }
  const url = base.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(token)
  ws = new WebSocket(url)
  ws.onopen = () => puxarDisponiveis()
  ws.onmessage = async (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type === 'snapshot' || msg.type === 'available') {
      await chrome.storage.local.set({ available: msg.available || [] })
    } else if (msg.type === 'code') {
      // ----- É AQUI que chega o dado principal: o Gmail + o código -----
      const { email, code } = msg
      const hist = (await chrome.storage.local.get('codes')).codes || []
      hist.unshift({ email, code, at: Date.now() })
      await chrome.storage.local.set({ codes: hist.slice(0, 50) })
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icon.png', title: `Código: ${code}`, message: email, priority: 2
      })
      await puxarDisponiveis() // o status pode ter virado vermelho
    }
  }
  ws.onclose = () => { ws = null }
  ws.onerror = () => { try { ws.close() } catch { /* ignore */ } ws = null }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('keepalive', { periodInMinutes: 1 }); conectar() })
chrome.runtime.onStartup.addListener(() => conectar())
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'keepalive') { conectar(); puxarDisponiveis() } })
chrome.storage.onChanged.addListener((ch) => { if (ch.base || ch.token) { try { ws && ws.close() } catch { /* ignore */ } ws = null; conectar() } })

conectar()
