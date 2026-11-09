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
    stage: () => sessionStorage.getItem('itm_af_etapa') || 'cadastro-aberto',
    setStage: (v) => sessionStorage.setItem('itm_af_etapa', v),
    user: () => sessionStorage.getItem('itm_af_user') || '',
    setUser: (u) => sessionStorage.setItem('itm_af_user', u),
    email: () => sessionStorage.getItem('itm_af_email') || '',
    setEmail: (e) => sessionStorage.setItem('itm_af_email', e),
  };
  const STAGE_ORDER = ['cadastro-aberto', 'email-preenchido', 'avl-preenchido', 'cadastro-enviado', 'codigo-preenchido', 'continuar-clicado', 'concluido'];
  function stageAtLeast(name) { return STAGE_ORDER.indexOf(S.stage()) >= STAGE_ORDER.indexOf(name); }

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
    // target.click() já dispara o evento click. Não emitir um segundo MouseEvent:
    // no cadastro do Instagram isso pode enviar o formulário duas vezes e gerar
    // dois códigos de confirmação para o mesmo endereço.
    try { target.click(); } catch { /* ok */ }
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
  // Sufixo aleatório pro "+" do Gmail (alias). Só NÚMEROS, no máximo 3 dígitos.
  // Ex.: 7 / 48 / 629 → exemplo+629@gmail.com.
  function sufixoAleatorio(len) {
    const chars = '0123456789';
    const rndInt = (max) => (globalThis.crypto && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint32Array(1))[0] % max
      : Math.floor(Math.random() * max);
    const tamanho = len ? Math.min(len, 3) : (1 + rndInt(3)); // 1 a 3 dígitos
    let out = '';
    for (let i = 0; i < tamanho; i++) out += chars[rndInt(chars.length)];
    return out;
  }
  // exemplo@gmail.com → exemplo+<aleatorio>@gmail.com. Só mexe em e-mail (tem @),
  // só se a parte local ainda não tiver "+", pra não empilhar alias a cada reenvio.
  function comAliasMais(valor) {
    const email = String(valor || '').trim();
    const at = email.indexOf('@');
    if (at <= 0) return email;                 // telefone ou vazio: não mexe
    const local = email.slice(0, at);
    const dominio = email.slice(at);           // inclui o @
    if (local.includes('+')) return email;     // já tem alias: mantém
    return `${local}+${sufixoAleatorio()}${dominio}`;
  }

  // Pop-up pedindo QUAL e-mail a extensão deve preencher. O usuário NÃO digita no
  // campo do IG — ele responde aqui e a extensão preenche. Guarda a base na sessão
  // pra reusar (a cada preenchimento gera um +alias novo em cima dela).
  const EMAIL_BASE_KEY = 'itm_af_email_base';
  function pedirEmailPopup() {
    return new Promise((resolve) => {
      const antigo = document.getElementById('itm-af-email-modal');
      if (antigo) antigo.remove();
      const overlay = document.createElement('div');
      overlay.id = 'itm-af-email-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;font:400 14px/1.4 system-ui';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#111;max-width:360px;width:calc(100vw - 48px);padding:18px;border-radius:12px;box-shadow:0 12px 40px #0007';
      box.innerHTML = '<div style="font:700 15px/1.3 system-ui;margin-bottom:6px">E-mail do cadastro</div>'
        + '<div style="color:#555;margin-bottom:12px">Qual e-mail a extensão deve preencher no formulário? Vou adicionar <b>+aleatório</b> antes do @ automaticamente.</div>';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'exemplo@gmail.com';
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font:400 14px system-ui;margin-bottom:12px';
      const erro = document.createElement('div');
      erro.style.cssText = 'color:#c0392b;font:600 12px system-ui;margin:-6px 0 10px;min-height:14px';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'Preencher';
      ok.style.cssText = 'width:100%;border:0;border-radius:8px;padding:11px;background:#1f6feb;color:#fff;cursor:pointer;font:700 14px system-ui';
      box.appendChild(input); box.appendChild(erro); box.appendChild(ok);
      overlay.appendChild(box);
      document.documentElement.appendChild(overlay);
      setTimeout(() => input.focus(), 50);
      const confirmar = () => {
        const v = String(input.value || '').trim();
        // aceita e-mail (tem @) ou telefone (só dígitos/+)
        const ehEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        const ehTel = /^[+\d][\d\s()-]{5,}$/.test(v);
        if (!ehEmail && !ehTel) { erro.textContent = 'Digite um e-mail ou telefone válido.'; return; }
        overlay.remove();
        resolve(v);
      };
      ok.addEventListener('click', confirmar);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } });
    });
  }
  async function pedirEmailBase() {
    const cache = String(sessionStorage.getItem(EMAIL_BASE_KEY) || '').trim();
    if (cache) return cache;
    toast('info', 'Responda no pop-up qual e-mail usar no cadastro.');
    const base = await pedirEmailPopup();
    sessionStorage.setItem(EMAIL_BASE_KEY, base);
    return base;
  }

  // Pergunta o e-mail no pop-up, aplica "+<aleatorio>" (se for e-mail) e a própria
  // extensão preenche o campo do formulário. Retorna o valor final preenchido.
  async function gmailDisponivel() {
    const field = await waitFor(emailField, 'o campo de email/celular', 15000);
    const base = await pedirEmailBase();
    const final = comAliasMais(base);           // +alias novo a cada preenchimento
    await typeInto(field, final);
    toast('info', 'Preenchido: ' + final);
    await sleep(200);
    return String(field.value || final).trim();
  }
  // (API do Gmail removida) Espera VOCÊ digitar o código no campo e usa o valor.
  async function codigoDoEmail() {
    const field = await waitFor(
      () => { const f = codeField(); return f && String(f.value || '').trim() ? f : null; },
      'você digitar o código de confirmação', 600000
    );
    return String(field.value).trim();
  }

  // ── Página de cadastro ──
  function isSignup() { return /^\/(?:accounts\/(?:emailsignup|signup)|signup)\/?$/.test(location.pathname); }
  function isConsent() { return /\/consent\//.test(location.pathname) || /\/oauth\//.test(location.pathname); }
  function isSuspended() {
    return /\/accounts\/suspended\/?(?:$|[?#])/i.test(location.pathname + location.search + location.hash)
      || /suspended/i.test(location.href);
  }
  function isActivityRestricted() {
    return /we restrict certain activity to protect our community[.!]?\s*let us know if you think we made a mistake/i
      .test(String(document.body?.innerText || ''));
  }
  function confirmationCodeInvalid() {
    return /codigo de confirmacao inserido e invalido ou expirou|confirmation code.*invalid|code.*expired/i.test(clean(document.body?.innerText || ''));
  }
  async function restartAfterActivityRestriction() {
    // Sem API de Gmail: reinicia o cadastro e você informa outro e-mail na tela.
    toast('info', 'Instagram restringiu esta atividade. Reiniciando o cadastro — use outro e-mail.');
    S.setEmail('');
    S.set('ir-cadastro');
    S.setStage('cadastro-aberto');
    location.href = 'https://www.instagram.com/accounts/emailsignup/';
  }
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
  function findEnviarButton() {
    const controls = visibleControls();
    const exact = controls.filter((el) => {
      const value = clean([el.textContent, el.value, el.getAttribute('aria-label'), el.getAttribute('data-testid')].filter(Boolean).join(' '));
      return /^enviar$/.test(value) || /(^|\s)enviar(\s|$)/.test(value);
    });
    const preferred = exact.find((el) => el.matches('button, [role="button"], input[type="submit"]'));
    if (preferred) return preferred;
    return exact[0] || null;
  }
  async function clickEnviarOnce() {
    const btn = await waitFor(() => findEnviarButton() || submitButton(), 'o botão Enviar', 8000);
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') throw new Error('o botão Enviar ainda está desabilitado');
    try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ok */ }
    await sleep(350);
    // O React pode substituir o nó depois do scroll; localizar novamente antes de clicar.
    const current = findEnviarButton() || btn;
    robustClick(current);
    await sleep(1200);
    return true;
  }
  function submitButton() {
    return findByText([/^enviar$/, /(^|\s)enviar(\s|$)/, /^continuar$/, /^confirmar$/, /^cadastre-se$/, /^inscreva-se$/, /^avancar$/, /^avançar$/, /^proximo$/, /^próximo$/, /^next$/, /^sign up$/])
      || [...document.querySelectorAll('button, input[type="submit"]')].filter(visible).find((b) => b.type === 'submit' && !b.disabled && b.id !== 'itm-avl-signup' && b.id !== 'itm-avl-next-username')
      || null;
  }
  function findContinueButton() {
    const controls = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    const exact = controls.find((el) => {
      const value = clean([
        el.textContent, el.value, el.getAttribute('aria-label'),
        el.getAttribute('title'), el.getAttribute('data-testid'),
        el.getAttribute('name')
      ].filter(Boolean).join(' '));
      return /^(continuar|continue|confirmar|confirm|avancar|avançar|next|enviar|submit)$/.test(value)
        || /(^|\s)(continuar|continue|confirmar|confirm|avancar|avançar|next)(\s|$)/.test(value);
    });
    if (exact) return exact;
    const field = codeField();
    const form = field?.form;
    if (form) {
      const submit = [...form.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
      if (submit) return submit;
    }
    return null;
  }
  async function clickContinueOnce() {
    const btn = await waitFor(findContinueButton, 'o botão Continuar', 15000);
    try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ok */ }
    await sleep(350);
    const current = findContinueButton() || btn;
    if (!current || current.disabled || current.getAttribute('aria-disabled') === 'true') {
      throw new Error('o botão Continuar está desabilitado');
    }
    if (!robustClick(current)) throw new Error('não foi possível clicar em Continuar');
    return true;
  }
  function usernameTaken() {
    const txt = clean(document.body.innerText);
    if (/nome de usuario nao esta disponivel|username isn't available|username is not available|ja esta em uso|this username/.test(txt)) return true;
    const u = usernameField();
    return Boolean(u && u.getAttribute('aria-invalid') === 'true');
  }

  async function preencherEmail() {
    const field = await waitFor(emailField, 'o campo de email/celular', 10000);
    if (stageAtLeast('email-preenchido') && String(field.value || '').trim()) return;
    // Conta nova começando: zera o guard do auto-config (instagram-overlay) pra
    // que o fluxo de arquivamento→edição→config rode UMA vez pra esta conta.
    // (mesma origem instagram.com → sessionStorage é compartilhado entre os scripts)
    try { sessionStorage.removeItem('extensionsIG.avl.autoFlow.v2'); } catch (_) {}
    // A extensão pergunta o e-mail no pop-up e preenche o campo sozinha.
    const email = await gmailDisponivel();
    S.setEmail(email);
    S.setStage('email-preenchido');
    toast('info', 'E-mail preenchido: ' + email);
  }

  async function acionarAVL() {
    const existingUser = usernameField();
    if (stageAtLeast('avl-preenchido') && existingUser?.value) return;
    const avl = await waitFor(() => {
      const button = document.getElementById('itm-avl-signup');
      return button && visible(button) && !button.disabled ? button : null;
    }, 'o botão AVL', 20000);
    if (!robustClick(avl)) throw new Error('não foi possível clicar no botão AVL');
    // espera o AVL preencher o usuário
    const u = await waitFor(() => { const f = usernameField(); return f && f.value ? f : null; }, 'o usuário preenchido pelo AVL', 10000);
    S.setUser(u.value);
    S.setStage('avl-preenchido');
    await sleep(800);
  }

  async function enviarCadastro() {
    if (stageAtLeast('cadastro-enviado') && codeField()) return true;
    // O Instagram pode re-renderizar o botão após a última alteração do React.
    // Relocaliza e aciona até três vezes, sempre aguardando o estado habilitado.
    await step('acionar Enviar', clickEnviarOnce, 3);
    // Não usar requestSubmit como reforço: a navegação do Instagram pode levar
    // alguns segundos e uma segunda submissão gera outro código de confirmação.
    await sleep(1500);
    S.setStage('cadastro-enviado');
  }

  async function trocarUsuarioSeEmUso() {
    if (!usernameTaken()) return false;
    toast('info', 'Usuário em uso — gerando outro…');
    const next = document.getElementById('itm-avl-next-username');
    if (next) {
      next.click();
      const u = await waitFor(() => { const f = usernameField(); return f && f.value ? f : null; }, 'novo usuário', 8000);
      S.setUser(u.value);
      S.setStage('avl-preenchido');
    }
    await sleep(600);
    await enviarCadastro();
    return true;
  }

  async function preencherCodigo() {
    const field = codeField();
    if (!field) return false; // ainda não é a tela de código
    // Sem API: você digita o código no campo; o fluxo clica em Continuar sozinho.
    if (!String(field.value || '').trim()) toast('info', 'Digite o código de confirmação — eu clico em Continuar.');
    const code = await codigoDoEmail();
    S.setStage('codigo-preenchido');
    toast('info', 'Código detectado: ' + code);
    // O botão pode aparecer desabilitado por alguns instantes após a digitação.
    // Nunca considerar a etapa concluída sem confirmar que o clique aconteceu.
    await step('Clicar em Continuar', clickContinueOnce, 3);
    S.setStage('continuar-clicado');
    await sleep(3000);
    if (isActivityRestricted()) {
      await restartAfterActivityRestriction();
      return 'restarted-after-restriction';
    }
    if (confirmationCodeInvalid()) {
      // Sem API pra comprar outro Gmail: pede a correção manual e tenta de novo.
      toast('erro', 'Código rejeitado ou expirado. Corrija o código no campo que eu clico em Continuar de novo.');
      await waitFor(() => {
        const f = codeField();
        return f && String(f.value || '').trim() && String(f.value).trim() !== code && !confirmationCodeInvalid() ? f : null;
      }, 'um novo código', 600000);
      S.setStage('codigo-preenchido');
      await step('Clicar em Continuar novamente', clickContinueOnce, 3);
      S.setStage('continuar-clicado');
      await sleep(3000);
    }
    return true;
  }

  async function fluxoCadastro() {
    if (!S.stage()) S.setStage('cadastro-aberto');
    toast('info', 'Cadastro carregado. Começando em 2s…');
    await sleep(2000); // delay pedido

    await step('Preencher email', preencherEmail);
    await step('Acionar AVL', acionarAVL);
    const submitResult = await step('Enviar cadastro', enviarCadastro);
    if (submitResult === 'restarted-after-restriction') return;

    // Reenvia enquanto o usuário estiver em uso (até algumas vezes).
    for (let i = 0; i < 6; i++) {
      await sleep(1500);
      const trocou = await trocarUsuarioSeEmUso();
      if (!trocou) break;
    }

    // Tela de código de confirmação (se aparecer).
    for (let i = 0; i < 30; i++) {
      if (isActivityRestricted()) { await restartAfterActivityRestriction(); return; }
      if (codeField()) {
        const codeResult = await step('Preencher código', () => preencherCodigo());
        if (codeResult === 'restarted-with-new-email') return;
        break;
      }
      if (isProfile() || !isSignup()) break; // já saiu do cadastro
      await sleep(2000);
    }

    S.set('ir-perfil');
    S.setStage('concluido');
    toast('ok', 'Cadastro enviado. Indo para o perfil…');
    await irParaPerfil();
  }

  async function irParaPerfil() {
    // Depois de confirmar o código, o Instagram já decide a rota correta.
    // Nunca montar ou sobrescrever uma URL de perfil aqui: a próxima página
    // será detectada naturalmente pelo carregamento do content script.
    await sleep(1000);
    if (isProfile()) toast('ok', 'Perfil detectado. Continuando o fluxo…');
    else toast('info', 'Cadastro confirmado. Aguardando o redirecionamento do Instagram…');
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
    if (isActivityRestricted()) { await restartAfterActivityRestriction(); return; }
    if (isSuspended()) {
      toast('err', 'Conta suspensa. Saindo da conta (apagando cookies) e recomeçando…');
      // Zera os checkpoints do fluxo pra conta nova começar do zero.
      try { sessionStorage.clear(); } catch { /* ok */ }
      await sleep(500);
      // O background apaga os cookies do Instagram (desloga) e manda esta aba
      // de volta pro cadastro. Fallback: se não voltar, fecha a aba.
      try {
        const r = await new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: 'afLogoutAndRestart' }, (resp) => resolve(chrome.runtime.lastError ? null : resp)); } catch { resolve(null); } });
        if (!r || !r.ok) { try { chrome.runtime.sendMessage({ type: 'afCloseSuspendedTab' }); } catch { /* ok */ } }
      } catch { /* aba pode já estar navegando */ }
      return;
    }
    if (isConsent()) { await fluxoConsent(); return; }

    if (isSignup()) { S.set('cadastro'); await fluxoCadastro(); return; }

    // Cadastro concluído: não mexe no perfil e NÃO abre o Flashpost sozinho.
    // O Flashpost só abre quando o usuário clicar no botão "🔗 Flashpost".
    if (S.get() === 'ir-perfil') {
      return;
    }

    // Início: leva o usuário para a tela de cadastro (uma vez por sessão).
    if (S.get() === 'inicio') {
      S.set('ir-cadastro');
      location.href = 'https://www.instagram.com/accounts/emailsignup/';
    }
  }

  // começa depois que a página assenta
  setTimeout(() => { main().catch((e) => toast('err', 'Fluxo: ' + (e?.message || e))); }, 600);
})();
