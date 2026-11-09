// flow-login.js — login automático no Flashpost e clique em "Conectar conta".
// ATENÇÃO: credenciais embutidas no arquivo. Não compartilhe o ZIP.
(() => {
  if (location.hostname !== 'flashpost.onrender.com') return;
  if (window.__itmFlashpostLogin) return;
  window.__itmFlashpostLogin = true;

  const LOGIN = Object.freeze({ username: 'guibrjoga', password: 'Gleicimeiri29' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  function visible(el) {
    return Boolean(el && el.isConnected && el.getClientRects().length && !el.disabled);
  }
  function labelOf(el) {
    return clean([el?.textContent, el?.value, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')].filter(Boolean).join(' '));
  }

  function notice(message, error = false) {
    let node = document.getElementById('itm-flashpost-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'itm-flashpost-status';
      node.style.cssText = 'position:fixed;right:16px;bottom:18px;z-index:2147483647;max-width:340px;padding:10px 12px;border-radius:8px;color:#fff;font:600 13px/1.3 system-ui;box-shadow:0 4px 14px #0006';
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.style.background = error ? '#ba3030' : '#185a79';
  }

  // Digita caractere a caractere (não cola) em campo controlado por React.
  async function typeInto(input, value) {
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    if (native) native.call(input, ''); else input.value = '';
    if (input._valueTracker) input._valueTracker.setValue('x');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    let acc = '';
    for (const ch of Array.from(String(value))) {
      acc += ch;
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      if (native) native.call(input, acc); else input.value = acc;
      if (input._valueTracker) input._valueTracker.setValue(acc.slice(0, -1));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await sleep(18);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getFields() {
    const pass = [...document.querySelectorAll('input[type="password"]')].find(visible);
    if (!pass) return null;
    const root = pass.form || document;
    const userSelectors = [
      'input[autocomplete="username"]', 'input[autocomplete="email"]',
      'input[name="username"]', 'input[name="email"]', 'input[name="user"]', 'input[name="login"]',
      'input[type="email"]', 'input[type="text"]',
    ];
    let user = null;
    for (const sel of userSelectors) {
      user = [...root.querySelectorAll(sel)].find((el) => el !== pass && visible(el));
      if (user) break;
    }
    if (!user) user = [...document.querySelectorAll('input[type="text"],input[type="email"]')].find((el) => el !== pass && visible(el));
    return user ? { user, pass } : null;
  }

  function findButton(patterns) {
    return [...document.querySelectorAll('button, [role="button"], input[type="submit"], a')]
      .filter(visible)
      .find((b) => patterns.some((p) => p.test(labelOf(b)))) || null;
  }

  async function waitFor(find, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const r = find();
      if (r) return r;
      await sleep(120);
    }
    return null;
  }

  async function step(label, fn, tries = 5) {
    let last;
    for (let i = 1; i <= tries; i++) {
      try { return await fn(); }
      catch (e) { last = e; if (i < tries) { notice(`${label}: repetindo em 3s…`, true); await sleep(3000); } }
    }
    throw last || new Error('falha: ' + label);
  }

  const CONECTAR = [/conectar conta/, /conectar/, /connect account/, /connect/];
  const ENTRAR = [/^(entrar|login|sign in|acessar|continuar|enviar)$/];
  const PERMITIR = [/^permitir$/, /^allow$/, /autorizar/, /authorize/, /aprovar/, /approve/];

  // Estado persistente (sobrevive aos redirects do OAuth) pra NÃO entrar em loop
  // de ficar relogando e clicando "Conectar conta" toda vez que a página recarrega.
  const FP_KEY = 'itm_fp_state_v1';
  const COOLDOWN_MS = 3 * 60 * 1000; // após conectar, não repete por 3 min
  function fpState() { try { return JSON.parse(localStorage.getItem(FP_KEY) || '{}'); } catch { return {}; } }
  function setFp(patch) { try { localStorage.setItem(FP_KEY, JSON.stringify({ ...fpState(), ...patch })); } catch { /* ok */ } }
  // "Run" único (a extensão abre o Flashpost com #afrun=<id> por conta nova).
  function currentRun() { const m = /[#&]afrun=([^&]+)/.exec(location.hash || ''); return m ? m[1] : ''; }

  let loginFeito = false;
  let conectarFeito = false;
  let permitirFeito = false;
  let stopped = false;
  let rodando = false;

  function stopFlow() { stopped = true; try { observer.disconnect(); } catch { /* ok */ } }

  async function run() {
    if (stopped || permitirFeito || rodando) return;
    rodando = true;
    try {
      const now = Date.now();
      const runId = currentRun();
      let st = fpState();
      // Conta nova (aberta pela extensão com novo afrun): zera o guard e conecta de novo.
      if (runId && runId !== st.lastRun) { setFp({ lastRun: runId, conectarAt: 0, done: false }); st = fpState(); }

      // Já conectou ESTA conta: conecta UMA vez só. Não reloga, não reclica
      // "Conectar conta", nem depois do cooldown. Só uma conta nova (novo #afrun,
      // tratado acima) libera conectar de novo. Mata o loop de ficar reconectando.
      if (st.done) { stopFlow(); return; }

      // Já clicou "Conectar" há pouco (ex.: voltou do OAuth): NÃO repete o fluxo.
      // Só confirma "Permitir" se essa tela estiver aqui e então para de vez.
      if (st.conectarAt && (now - st.conectarAt < COOLDOWN_MS)) {
        const permitir0 = findButton(PERMITIR);
        if (permitir0) { permitir0.click(); permitirFeito = true; setFp({ done: true }); notice('Permissão confirmada.'); }
        stopFlow();
        return;
      }

      // 1) Preenche usuário e senha (se o formulário de login existir).
      const fields = getFields();
      if (fields && !loginFeito) {
        loginFeito = true;
        try {
          await step('Preencher login', async () => {
            await typeInto(fields.user, LOGIN.username);
            await typeInto(fields.pass, LOGIN.password);
            await sleep(200);
            if (fields.user.value !== LOGIN.username || fields.pass.value !== LOGIN.password) {
              throw new Error('campos não aceitaram os dados');
            }
          });
          notice('Login preenchido. Enviando…');
          const entrar = findButton(ENTRAR);
          if (entrar) { entrar.click(); }
          else if (fields.pass.form) { fields.pass.form.requestSubmit(); }
        } catch (e) {
          notice('Não consegui preencher: ' + (e?.message || e), true);
          loginFeito = false;
          return;
        }
      }

      // 2) Clica em "Conectar conta" UMA vez e marca o horário (guard do cooldown).
      const conectar = await waitFor(() => findButton(CONECTAR), 5000);
      if (conectar && !conectarFeito) {
        conectar.click();
        conectarFeito = true;
        // Marca done=true JÁ no clique: conectar é ação de uma vez só por conta.
        // Mesmo que o OAuth volte pra cá, o guard do topo (st.done) impede reclique.
        setFp({ conectarAt: Date.now(), done: true });
        notice('Conectar conta acionado.');
        // Tenta confirmar "Permitir" se aparecer aqui, mas não reconecta mais.
        const permitirApos = await waitFor(() => findButton(PERMITIR), 20000);
        if (permitirApos) { permitirApos.click(); permitirFeito = true; notice('Permissão confirmada.'); }
        stopFlow();
        return;
      }

      // 3) Após Conectar conta, pode aparecer a tela de autorização ("Permitir").
      const permitir = await waitFor(() => findButton(PERMITIR), 20000);
      if (permitir && !permitirFeito) {
        permitir.click();
        permitirFeito = true;
        setFp({ done: true });
        notice('Permissão confirmada.');
        stopFlow();
      }
    } finally { rodando = false; }
  }

  // Observer com pequena folga (debounce) pra não disparar em rajada.
  let kickTimer = null;
  const kick = () => { if (kickTimer) return; kickTimer = setTimeout(() => { kickTimer = null; run().catch((e) => notice('Flashpost: ' + (e?.message || e), true)); }, 150); };
  const observer = new MutationObserver(() => { if (!stopped && !permitirFeito) kick(); });
  observer.observe(document.documentElement, { subtree: true, childList: true });
  setTimeout(kick, 300);
  window.addEventListener('pageshow', kick);
})();
