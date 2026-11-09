// extensionsIG.avl — botão de teste para o IG POST FLOW (na mesma aba).
// ATENÇÃO: credenciais de teste estão embutidas no arquivo desta extensão.
// Não compartilhe o ZIP e não reutilize esta senha em contas importantes.
(() => {
  if (location.protocol !== 'https:' || location.hostname !== 'ebooksucessodigital.online') return;
  if (window.__extensionsIGFlowLogin && document.getElementById('extensions-ig-flow-login-button')) return;
  window.__extensionsIGFlowLogin = true;
  // Limpa botão antigo que ficou sem listener após atualizar a extensão.
  document.getElementById('extensions-ig-flow-login-button')?.remove();
  document.getElementById('extensions-ig-flow-status')?.remove();

  const TEST_LOGIN = Object.freeze({ username: 'avliston2', password: 'Gtatropa1*' });
  const BUTTON_ID = 'extensions-ig-flow-login-button';
  let shortcutButton = null;
  let refreshQueued = false;
  let busy = false;
  let submitted = false;
  let toastTimer = null;

  function isVisible(el) {
    return Boolean(el && el.isConnected && el.getClientRects().length && !el.disabled);
  }
  function getFormElements() {
    const pass = [...document.querySelectorAll('input[type="password"]')].find(isVisible);
    if (!pass) return null;
    const root = pass.form || pass.closest('main, article, section, div')?.parentElement || document;
    const userSelectors = [
      'input[autocomplete="username"]', 'input[autocomplete="email"]',
      'input[name="username"]', 'input[name="email"]',
      'input[type="email"]', 'input[type="text"]',
    ];
    let user = null;
    for (const sel of userSelectors) {
      user = [...root.querySelectorAll(sel)].find(el => el !== pass && isVisible(el));
      if (user) break;
    }
    if (!user) user = [...document.querySelectorAll('input[type="text"],input[type="email"]')].find(isVisible);
    return user ? {user, pass, root} : null;
  }
  function getSubmitButton({pass, root}) {
    const fieldsRoot = pass.form || root || document;
    const controls = [...fieldsRoot.querySelectorAll('button, input[type="submit"]')];
    const allowed = el => isVisible(el) && el.id !== BUTTON_ID;
    return controls.find(el => allowed(el) && el.type === 'submit') ||
      controls.find(el => allowed(el) && /^(entrar|login|sign in|acessar|continuar)$/i.test(String(el.textContent || el.value || '').trim())) ||
      [...document.querySelectorAll('button, input[type="submit"]')]
        .find(el => allowed(el) && /^(entrar|login|sign in|acessar)$/i.test(String(el.textContent || el.value || '').trim()));
  }
  function fill(input, value) {
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const before = input.value;
    if (native?.set) native.set.call(input, value);
    else input.value = value;
    // Os eventos atualizam campos controlados por React.
    if (input._valueTracker) input._valueTracker.setValue(before);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function notice(message, error=false) {
    let node = document.getElementById('extensions-ig-flow-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'extensions-ig-flow-status';
      node.style.cssText = 'position:fixed;right:16px;bottom:18px;z-index:2147483647;max-width:320px;padding:10px 12px;border-radius:8px;color:#fff;font:600 13px/1.3 system-ui;box-shadow:0 4px 14px #0006';
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.style.background = error ? '#ba3030' : '#185a79';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.remove(), error ? 5000 : 2800);
  }
  async function loginOnThisPage() {
    if (busy || submitted) return;
    const fields = getFormElements();
    const submit = fields && getSubmitButton(fields);
    if (!fields || (!submit && !fields.pass.form)) {
      notice('Aguarde o formulário de login carregar.', true);
      return;
    }
    busy = true;
    if (shortcutButton) {
      shortcutButton.disabled = true;
      shortcutButton.textContent = '🔐 Entrando…';
    }
    try {
      fill(fields.user, TEST_LOGIN.username);
      fill(fields.pass, TEST_LOGIN.password);
      // Uma pausa mínima permite ao formulário atualizar seu estado.
      await new Promise(resolve => setTimeout(resolve, 90));
      const latest = getFormElements();
      if (!latest) throw new Error('Formulário não encontrado depois do preenchimento.');
      if (latest.user.value !== TEST_LOGIN.username || latest.pass.value !== TEST_LOGIN.password) {
        // Re-renderizações podem substituir os elementos durante a digitação.
        fill(latest.user, TEST_LOGIN.username);
        fill(latest.pass, TEST_LOGIN.password);
      }
      const button = getSubmitButton(latest);
      if (!button && !latest.pass.form) throw new Error('Não encontrei o botão Entrar.');
      if (latest.user.value !== TEST_LOGIN.username || latest.pass.value !== TEST_LOGIN.password) {
        throw new Error('O site não aceitou os dados de teste.');
      }
      submitted = true;
      notice('Login enviado. Aguarde a resposta do Flow.');
      if (button) button.click();
      else latest.pass.form.requestSubmit();
      // Somente UMA tentativa a cada carregamento. Não retenta erro ou CAPTCHA.
    } catch (err) {
      notice(err?.message || 'Não foi possível iniciar o login.', true);
    } finally {
      busy = false;
      if (shortcutButton) {
        shortcutButton.disabled = submitted;
        shortcutButton.textContent = submitted ? '✓ Login enviado' : '🔐 Entrar Flow';
      }
    }
  }
  function showButton() {
    const fields = getFormElements();
    const submit = fields && getSubmitButton(fields);
    if (!fields || !submit) {
      shortcutButton?.remove();
      return;
    }
    if (!shortcutButton) {
      shortcutButton = document.createElement('button');
      shortcutButton.type = 'button';
      shortcutButton.id = BUTTON_ID;
      shortcutButton.textContent = '🔐 Entrar Flow';
      shortcutButton.title = 'Preencher e enviar login de teste sem abrir outra aba';
      shortcutButton.style.cssText = [
        'display:block','width:max-content','max-width:100%',
        'margin:8px auto 0','padding:6px 10px',
        'font:600 12px/1.2 system-ui,sans-serif',
        'background:#173447','color:#d5f5fa',
        'border:1px solid #186b80','border-radius:7px',
        'cursor:pointer','box-shadow:0 2px 8px #0003'
      ].join(';');
      shortcutButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void loginOnThisPage();
      });
    }
    if (submitted) {
      shortcutButton.disabled = true;
      shortcutButton.textContent = '✓ Login enviado';
    }
    if (submit.nextElementSibling !== shortcutButton) submit.after(shortcutButton);
  }
  function scheduleButtonCheck() {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => {refreshQueued = false;showButton();}, 110);
  }
  showButton();
  new MutationObserver(scheduleButtonCheck).observe(document.documentElement, {subtree:true, childList:true});
  // Formulários que aparecem após uma transição SPA ou troca de aba.
  window.addEventListener('pageshow', scheduleButtonCheck);
  window.addEventListener('focus', scheduleButtonCheck);
})();
