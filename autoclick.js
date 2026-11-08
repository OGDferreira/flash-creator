// autoclick.js — clica botões do Instagram com clique REAL (isTrusted) via CDP.
//
// Por quê: o Instagram ignora clique sintético (.click()/eventos de JS) no
// "Enviar" do cadastro, no "Continuar" do código e afins. O CDP
// (Input.dispatchMouseEvent) gera um clique de verdade, que o Instagram aceita.
// A extensão preenche os campos e navega; aqui o programa só dá os cliques que
// a página exige que sejam reais. Funciona nos perfis Dolphin abertos pelo
// próprio Flash Creator (ele já tem a porta de depuração de cada um).
const cdp = require('./cdp')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Botões que costumam exigir clique real, em ordem de prioridade. Cada item é
// uma lista de textos equivalentes (minúsculos, sem acento).
const DEFAULT_TARGETS = [
  ['enviar'],
  ['continuar'],
  ['permitir', 'allow', 'autorizar', 'authorize'],
  ['avancar', 'proximo', 'next'],
  ['concluir', 'finish', 'done', 'adicionar'],
  ['mudar', 'change'],
]

// Script injetado na página: acha o menor controle visível cujo texto é
// exatamente uma das palavras e devolve o centro dele (coord. do viewport).
// Marca o elemento clicado com um timestamp (data-itm-ac) e ignora o mesmo
// elemento por 6s — assim NÃO clica 2x o mesmo botão, mas clica os dois
// "Avançar" seguidos do destaque (são elementos diferentes a cada tela).
function locateScript(texts) {
  return `(() => {
    const clean = (s) => (s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim();
    const wants = ${JSON.stringify(texts)};
    const now = Date.now();
    // Trava: só clica o botão de avançar/enviar quando TODO campo de texto
    // visível já tem valor (evita apertar "Enviar" com o formulário vazio,
    // ou "Continuar" antes do código ser digitado). Telas sem campo passam.
    const campos = [...document.querySelectorAll('input')].filter((el) => {
      const r = el.getBoundingClientRect();
      const t = (el.type || 'text').toLowerCase();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly
        && ['text','email','tel','password','number',''].includes(t);
    });
    if (campos.some((el) => !String(el.value || '').trim())) return null;
    const ctrls = [...document.querySelectorAll('button,[role="button"],[role="radio"],input[type=submit],label,a')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const ts = Number(el.dataset.itmAc || 0);
        return r.width > 4 && r.height > 4 && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && (now - ts > 6000);
      });
    const hit = ctrls.filter((el) => wants.includes(clean(el.textContent) || clean(el.value)))
      .sort((a,b) => (clean(a.textContent)||'').length - (clean(b.textContent)||'').length)[0];
    if (!hit) return null;
    hit.dataset.itmAc = String(now);
    const r = hit.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: (clean(hit.textContent) || clean(hit.value)) };
  })()`
}

async function trustedClick(conn, x, y) {
  await conn.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await conn.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(40)
  await conn.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

// Observa UMA porta (um perfil). Para sozinho quando a porta morre (perfil
// fechado) — algumas falhas seguidas — ou quando isEnabled() retorna false.
async function watchProfile(port, { log = () => {}, isEnabled, targets = DEFAULT_TARGETS, pollMs = 1500 } = {}) {
  let fails = 0
  for (;;) {
    if (isEnabled && !isEnabled()) return
    let pages
    try { pages = await cdp.listPages(port, 2000); fails = 0 }
    catch { if (++fails >= 3) return; await sleep(pollMs); continue }

    const page = (pages || []).find((p) => /:\/\/(?:www\.)?instagram\.com/.test(p.url || ''))
    if (page && page.webSocketDebuggerUrl) {
      let conn
      try {
        conn = await cdp.CDP.connect(page.webSocketDebuggerUrl, 4000)
        for (const texts of (targets || DEFAULT_TARGETS)) {
          const { result } = await conn.call('Runtime.evaluate', { expression: locateScript(texts), returnByValue: true }, 5000)
          const pt = result && result.value
          if (!pt) continue
          await trustedClick(conn, pt.x, pt.y)
          log('ok', `Clique real (CDP) em "${pt.text}" — perfil na porta ${port}.`)
          break // um clique por ciclo; o próximo ciclo pega a tela seguinte
        }
      } catch { /* perfil pode ter trocado de aba/fechado */ }
      finally { if (conn) conn.close() }
    }
    await sleep(pollMs)
  }
}

module.exports = { watchProfile, trustedClick, DEFAULT_TARGETS }
