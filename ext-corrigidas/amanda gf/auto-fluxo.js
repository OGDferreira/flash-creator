// auto-fluxo.js — orquestra o cadastro automático no Instagram.
// Passos: abre /accounts/emailsignup/ → espera 2s → digita o Gmail da API local
// no campo "Número de celular ou email" → aciona o botão AVL (nome, senha,
// usuário amanda.desp+nº, data) → envia → se o usuário estiver em uso, gera
// outro e reenvia → digita o código de confirmação (também vindo da API) →
// vai para o perfil, onde a extensão "destaque" cria o destaque.
// Cada etapa que falha espera 3s e tenta de novo.
//
// Também clica "Permitir" na tela de consentimento do Instagram (OAuth).
(() => {
  if (window.__itmAutoFluxo) return;
  window.__itmAutoFluxo = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const S = {
    get: () => sessionStorage.getItem('itm_af_estado') || 'inicio',
    set: (v) => sessionStorage.setItem('itm_af_estado', v),
    user: () => sessionStorage.getItem('itm_af_user') || '',
    setUser: (u) => sessionStorage.setItem('itm_af_user', u),
    email: () => sessionStorage.getItem('itm_af_email') || '',
    setEmail: (e) => sessionStorage.setItem('itm_af_email', e),
  };

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function labelOf(el) {
    return clean([el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')].filter(Boolean).join(' '));
  }
  // Clique com eventos de ponteiro — o botão "Enviar" do Instagram não reage só
  // ao .click(); precisa de pointerdown/up + mousedown/up.
  function robustClick(el) {
    const target = (el && el.closest) ? (el.closest('button, [role="button"], input[type="submit"], a, [tabindex]') || el) : el;
    if (!target) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      target.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mouseover', opts));
      target.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse' }));
      try { target.focus(); } catch { /* ok */ }
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch { /* segue pro click */ }
    try { target.click(); } catch { /* ok */ }
    try { target.dispatchEvent(new MouseEvent('click', opts)); } catch { /* ok */ }
    return true;
  }

  // ── Toast ──
  function toast(kind, msg) {
    let el = document.getElementById('itm-af-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'itm-af-toast';
      el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:340px;padding:10px 13px;border-radius:9px;color:#fff;font:600 13px/1.35 system-ui;box-shadow:0 5px 18px #0005;white-space:pre-line';
      document.documentElement.appendChild(el);
    }
    el.style.background = kind === 'err' ? '#c0392b' : kind === 'ok' ? '#248a52' : '#34506b';
    el.textContent = String(msg);
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '.0'; }, 6000);
    el.style.opacity = '1';
  }

  // ── Digitação char a char (não cola) ──
  async function typeInto(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!set) throw new Error('campo sem setter');
    input.focus();
    set.call(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    let acc = '';
    for (const ch of Array.from(String(value))) {
      acc += ch;
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      set.call(input, acc);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await sleep(70);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Retry de etapa: falhou, espera 3s e tenta de novo ──
  async function step(label, fn, tries = 5) {
    let last;
    for (let i = 1; i <= tries; i++) {
      try { return await fn(); }
      catch (e) {
        last = e;
        if (i < tries) { toast('info', `${label}: repetindo em 3s… (${i}/${tries - 1})`); await sleep(3000); }
      }
    }
    throw last || new Error('falha: ' + label);
  }

  async function waitFor(find, label, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const r = find();
      if (r) return r;
      await sleep(300);
    }
    throw new Error('não encontrei ' + label);
  }

  // ── API local via BACKGROUND (sem fetch direto no instagram.com, logo sem o
  // pop-up de "acessar dispositivos da rede local"). O background tem permissão
  // para 127.0.0.1 e responde rápido; aqui a gente repete até vir o dado. ──
  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
          resolve(resp || { ok: false });
        });
      } catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); }
    });
  }
  // Primeiro Gmail disponível; se não houver, o background compra e a gente espera.
  async function gmailDisponivel() {
    for (let i = 0; i < 25; i++) {
      const r = await ask({ type: 'afEmail' });
      if (r && r.ok && r.email) return r.email;
      if (r && r.error) throw new Error(r.error);
      await sleep(3000);
    }
    throw new Error('nenhum Gmail disponível na API');
  }
  // Código de confirmação do e-mail que usamos.
  async function codigoDoEmail(email) {
    for (let i = 0; i < 30; i++) {
      const r = await ask({ type: 'afCode', email });
      if (r && r.ok && r.code) return r.code;
      await sleep(3000);
    }
    throw new Error('código não chegou na API');
  }

  // ── Página de cadastro ──
  function isSignup() { return /^\/(?:accounts\/(?:emailsignup|signup)|signup)\/?$/.test(location.pathname); }
  function isConsent() { return /\/consent\//.test(location.pathname) || /\/oauth\//.test(location.pathname); }
  function isProfile() {
    const p = location.pathname.replace(/\/$/, '');
    return /^\/[^/]+$/i.test(p) && !/^\/(accounts|explore|direct|reels|stories|about|web|emailsignup|login|p|reel)$/i.test(p);
  }

  function emailField() {
    const inputs = [...document.querySelectorAll('input')].filter((el) => visible(el) && !el.disabled && !el.readOnly && el.type !== 'hidden' && el.type !== 'password');
    // 1) por name/autocomplete/aria/placeholder
    const match = inputs.find((el) => {
      const s = clean([el.name, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder].join(' '));
      return /emailorphone|email|celular|telefone|phone|mobile/.test(s);
    });
    if (match) return match;
    // 2) primeiro campo de texto da tela (o de cima no cadastro é o email/celular)
    return inputs.find((el) => ['text', 'email', 'tel', ''].includes(el.type)) || null;
  }
  function usernameField() {
    return [...document.querySelectorAll('input')].find((el) => {
      const s = clean([el.name, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder].join(' '));
      return visible(el) && /username|usuario|nome de usuario/.test(s);
    }) || null;
  }
  function codeField() {
    const inputs = [...document.querySelectorAll('input')].filter((el) => visible(el) && !el.disabled && el.type !== 'hidden' && el.type !== 'password');
    return inputs.find((el) => {
      const s = clean([el.name, el.getAttribute('aria-label'), el.placeholder].join(' '));
      return /codigo|confirmation|confirma|code|security/.test(s);
    }) || (inputs.length === 1 ? inputs[0] : null);
  }
  // Mesma abordagem da extensão amanda150-link-pill (que funcionava): só
  // controles VISÍVEIS de verdade (button/role=button/role=radio/label/a),
  // filtrados pelo texto, o mais curto primeiro. Assim nunca pega a palavra
  // "Enviar" da frase legal ("Ao tocar em Enviar, você concorda…").
  function visibleControls() {
    return [...document.querySelectorAll('button, [role="button"], [role="radio"], input[type="submit"], label, a')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled
          && el.getAttribute('aria-disabled') !== 'true'
          && el.id !== 'itm-avl-signup' && el.id !== 'itm-avl-next-username';
      });
  }
  function findByText(patterns) {
    return visibleControls()
      .filter((el) => { const t = clean(el.textContent) || clean(el.value); return t && patterns.some((p) => p.test(t)); })
      .sort((a, b) => (clean(a.textContent) || '').length - (clean(b.textContent) || '').length)[0] || null;
  }
  function submitButton() {
    return findByText([/^enviar$/, /^continuar$/, /^confirmar$/, /^cadastre-se$/, /^inscreva-se$/, /^avancar$/, /^avançar$/, /^proximo$/, /^próximo$/, /^next$/, /^sign up$/])
      || [...document.querySelectorAll('button, input[type="submit"]')].filter(visible).find((b) => b.type === 'submit' && !b.disabled && b.id !== 'itm-avl-signup' && b.id !== 'itm-avl-next-username')
      || null;
  }
  function usernameTaken() {
    const txt = clean(document.body.innerText);
    if (/nome de usuario nao esta disponivel|username isn't available|username is not available|ja esta em uso|this username/.test(txt)) return true;
    const u = usernameField();
    return Boolean(u && u.getAttribute('aria-invalid') === 'true');
  }

  async function preencherEmail() {
    const field = await waitFor(emailField, 'o campo de email/celular', 10000);
    let email = S.email();
    if (!email) { email = await gmailDisponivel(); S.setEmail(email); }
    await typeInto(field, email);
    toast('info', 'Email preenchido: ' + email);
  }

  async function acionarAVL() {
    const avl = await waitFor(() => document.getElementById('itm-avl-signup'), 'o botão AVL', 10000);
    avl.click();
    // espera o AVL preencher o usuário
    const u = await waitFor(() => { const f = usernameField(); return f && f.value ? f : null; }, 'o usuário preenchido pelo AVL', 10000);
    S.setUser(u.value);
    await sleep(800);
  }

  async function enviarCadastro() {
    // Único "Enviar" da tela de cadastro (controle clicável de verdade).
    const btn = await waitFor(() => findByText([/^enviar$/]) || submitButton(), 'o botão Enviar', 8000);
    robustClick(btn);
    await sleep(1500);
    // Reforço: se ainda estamos na tela de cadastro, tenta submeter o form.
    if (isSignup() && !codeField()) {
      const pass = [...document.querySelectorAll('input[type="password"]')].find(visible);
      const form = pass && pass.form;
      if (form) { try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch { /* ok */ } }
    }
    await sleep(1500);
  }

  async function trocarUsuarioSeEmUso() {
    if (!usernameTaken()) return false;
    toast('info', 'Usuário em uso — gerando outro…');
    const next = document.getElementById('itm-avl-next-username');
    if (next) {
      next.click();
      const u = await waitFor(() => { const f = usernameField(); return f && f.value ? f : null; }, 'novo usuário', 8000);
      S.setUser(u.value);
    }
    await sleep(600);
    await enviarCadastro();
    return true;
  }

  async function preencherCodigo() {
    const field = codeField();
    if (!field) return false; // ainda não é a tela de código
    toast('info', 'Buscando o código na API…');
    const code = await codigoDoEmail(S.email());
    await typeInto(field, code);
    toast('info', 'Código preenchido: ' + code);
    // Único "Continuar" da tela de código.
    const btn = findByText([/^continuar$/]) || submitButton();
    if (btn) { robustClick(btn); await sleep(2500); }
    return true;
  }

  async function fluxoCadastro() {
    toast('info', 'Cadastro carregado. Começando em 2s…');
    await sleep(2000); // delay pedido

    await step('Preencher email', preencherEmail);
    await step('Acionar AVL', acionarAVL);
    await step('Enviar cadastro', enviarCadastro);

    // Reenvia enquanto o usuário estiver em uso (até algumas vezes).
    for (let i = 0; i < 6; i++) {
      await sleep(1500);
      const trocou = await trocarUsuarioSeEmUso();
      if (!trocou) break;
    }

    // Tela de código de confirmação (se aparecer).
    for (let i = 0; i < 30; i++) {
      if (codeField()) { await step('Preencher código', preencherCodigo); break; }
      if (isProfile() || !isSignup()) break; // já saiu do cadastro
      await sleep(2000);
    }

    S.set('ir-perfil');
    toast('ok', 'Cadastro enviado. Indo para o perfil…');
    await irParaPerfil();
  }

  async function irParaPerfil() {
    const user = S.user();
    await sleep(3000);
    if (user) { location.href = 'https://www.instagram.com/' + user + '/'; }
    // No perfil, a extensão "destaque" cria o destaque e abre o Flashpost.
  }

  // ── Consentimento OAuth: clicar "Permitir" ──
  async function fluxoConsent() {
    await step('Permitir consentimento', async () => {
      const btn = await waitFor(() => {
        return [...document.querySelectorAll('button, [role="button"]')].filter(visible)
          .find((b) => /^(permitir|allow|autorizar|authorize|continuar|continue)$/.test(labelOf(b)));
      }, 'o botão Permitir', 12000);
      robustClick(btn);
    });
    toast('ok', 'Consentimento concedido.');
  }

  async function main() {
    if (isConsent()) { await fluxoConsent(); return; }

    if (isSignup()) { S.set('cadastro'); await fluxoCadastro(); return; }

    // Já terminou o cadastro e precisa ir ao perfil.
    if (S.get() === 'ir-perfil' && S.user() && !isProfile()) { await irParaPerfil(); return; }

    // Início: leva o usuário para a tela de cadastro (uma vez por sessão).
    if (S.get() === 'inicio') {
      S.set('ir-cadastro');
      location.href = 'https://www.instagram.com/accounts/emailsignup/';
    }
  }

  // começa depois que a página assenta
  setTimeout(() => { main().catch((e) => toast('err', 'Fluxo: ' + (e?.message || e))); }, 600);
})();
