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
      await sleep(60);
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
      await sleep(300);
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

  let feito = false;
  async function run() {
    if (feito) return;

    // 1) Preenche usuário e senha (se o formulário de login existir).
    const fields = getFields();
    if (fields) {
      feito = true;
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
        // 2) Entra (se houver um botão de login separado do "conectar conta").
        const entrar = findButton(ENTRAR);
        if (entrar) { entrar.click(); }
        else if (fields.pass.form) { fields.pass.form.requestSubmit(); }
      } catch (e) {
        notice('Não consegui preencher: ' + (e?.message || e), true);
        feito = false;
        return;
      }
    }

    // 3) Depois que o site carrega por completo, clica em "Conectar conta".
    const conectar = await waitFor(() => findButton(CONECTAR), 20000);
    if (conectar) {
      conectar.click();
      notice('Conectar conta acionado.');
    }
  }

  const kick = () => { run().catch((e) => notice('Flashpost: ' + (e?.message || e), true)); };
  setTimeout(kick, 1200);
  new MutationObserver(() => { if (!feito) kick(); }).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('pageshow', kick);
})();
