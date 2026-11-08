(() => {
  if (window.__jeniDestaqueStory) return;
  window.__jeniDestaqueStory = true;

  const BUTTON_ID = 'jeni-destaque-story-button';
  const TOAST_ID = 'jeni-destaque-story-toast';
  const STYLE_ID = 'jeni-destaque-story-style';
  const HIGHLIGHT_NAME = '🎁🔥';
  const AUTO_KEY = 'jeniDestaqueAutoClickPending';
  const FLASHPOST_URL = 'https://flashpost.onrender.com/login';

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      border: 0; border-radius: 10px; padding: 12px 15px;
      background: #1f6feb; color: #fff; cursor: pointer;
      font: 700 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 5px 18px #0005;
    }
    #${BUTTON_ID}:hover { filter: brightness(1.1); }
    #${BUTTON_ID}:disabled { opacity: .65; cursor: wait; }
    #${TOAST_ID} {
      position: fixed; right: 18px; bottom: 78px; z-index: 2147483647;
      max-width: 360px; padding: 10px 13px; border-radius: 9px;
      color: #fff; white-space: pre-line; word-break: break-word;
      font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 5px 18px #0005;
    }
    #${TOAST_ID}.info { background: #34506b; }
    #${TOAST_ID}.ok { background: #248a52; }
    #${TOAST_ID}.err { background: #c0392b; }
  `;
  document.documentElement.appendChild(style);

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Criar destaque do Story';
  document.documentElement.appendChild(button);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const clean = (value) => String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // Rótulo do elemento SEM o role/data-testid — o antigo textOf juntava o
  // atributo role="button" ao texto, então "Avançar" virava "avancar button"
  // e as expressões ancoradas (/^avancar$/) nunca casavam. Esse era o motivo
  // do "Não encontrei o botão Avançar após o nome".
  const labelOf = (element) => clean([
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
  ].filter(Boolean).join(' '));
  const textOf = (element) => clean([
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('data-testid'),
  ].filter(Boolean).join(' '));

  function toast(kind, message, duration = 7000) {
    let node = document.getElementById(TOAST_ID);
    if (!node) {
      node = document.createElement('div');
      node.id = TOAST_ID;
      document.documentElement.appendChild(node);
    }
    node.className = kind;
    node.textContent = String(message);
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.remove(), duration);
  }

  function isProfilePage() {
    const path = location.pathname.replace(/\/$/, '');
    return /^\/[^/]+$/i.test(path) &&
      !/^\/(accounts|explore|direct|reels|stories|about|web|emailsignup|login)$/i.test(path);
  }

  function isReelsPage() {
    return /^\/reels(?:\/|$)/i.test(location.pathname);
  }

  function findProfileLink() {
    return [...document.querySelectorAll('a[href]')].filter(visible).find(link => {
      try {
        const path = new URL(link.href, location.origin).pathname.replace(/\/$/, '');
        return /^\/[^/]+$/i.test(path) &&
          !/^\/(accounts|explore|direct|reels|stories|about|web|emailsignup|login)$/i.test(path);
      } catch (_) { return false; }
    });
  }

  function clickable(element) {
    if (!element || !element.isConnected) return null;
    return element.closest('button, [role="button"], a') || element;
  }

  // Clique robusto: o .click() nativo + eventos de ponteiro, porque o Instagram
  // às vezes escuta pointerdown/pointerup em vez de click.
  function robustClick(element) {
    const target = clickable(element);
    if (!target) return false;
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } catch (_) { /* segue com o click */ }
    target.click();
    return true;
  }

  function findNewHighlightButton() {
    const plusHint = [...document.querySelectorAll('[title], [aria-label], [data-testid]')]
      .find((element) => /icone de mais|ícone de mais|adicionar destaque|novo destaque|new highlight/i
        .test(`${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-testid') || ''}`));
    if (plusHint) return clickable(plusHint);

    const newLabel = [...document.querySelectorAll('span, div, p, a')]
      .find((element) => clean(element.textContent) === 'novo' || clean(element.textContent) === 'new');
    if (newLabel) {
      const parent = newLabel.closest('button, [role="button"], a') || newLabel.parentElement;
      if (parent) return parent;
    }

    const candidates = [...document.querySelectorAll('button, [role="button"], a')];
    const direct = candidates.find((element) => {
      const text = textOf(element);
      return /novo destaque|new highlight|criar destaque|create highlight/.test(text);
    });
    if (direct) return direct;

    const circles = candidates.filter((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.width > 180 || rect.height > 180) return false;
      const label = textOf(element);
      const aria = clean(element.getAttribute('aria-label'));
      return /highlight|destaque|add|adicionar|new|novo/.test(label + ' ' + aria) ||
        Boolean(element.querySelector('svg circle, svg path'));
    });
    return circles.find((element) => /highlight|destaque|add|adicionar|new|novo/.test(textOf(element))) || null;
  }

  function dialogRoot() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter(element => element.getBoundingClientRect().width > 0);
    return dialogs[dialogs.length - 1] || null;
  }

  function findNameInput() {
    const root = dialogRoot() || document;
    const inputs = [...root.querySelectorAll('input, textarea')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !element.disabled && element.type !== 'file';
    });
    return inputs.find((element) => {
      const text = textOf(element) + ' ' + clean(element.getAttribute('placeholder'));
      return /nome|name|destaque|highlight/.test(text);
    }) || inputs.find((element) => element.type === 'text' || element.tagName === 'TEXTAREA');
  }

  // Procura botão pelo RÓTULO (texto/aria-label), ignorando role/data-testid.
  function findButtonByText(patterns) {
    const root = dialogRoot() || document;
    return [...root.querySelectorAll('button, [role="button"], a')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return false;
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
        return patterns.some(pattern => pattern.test(labelOf(element)));
      })
      .sort((a, b) => labelOf(a).length - labelOf(b).length)[0] || null;
  }

  const AVANCAR = [/^avancar$/, /^avançar$/, /^next$/, /^proximo$/, /^próximo$/, /^continuar$/];
  const CONCLUIR = [/^concluir$/, /^finish$/, /^done$/, /^adicionar$/, /^add$/, /^pronto$/];

  // Digita o nome caractere a caractere (não cola) em um campo React.
  async function typeInto(input, value) {
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) throw new Error('Não consegui preencher o nome do destaque.');
    input.focus();
    setter.call(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    let acc = '';
    for (const ch of Array.from(value)) {
      acc += ch;
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      setter.call(input, acc);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await sleep(110);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Candidatos de Story na tela de seleção ("Stories").
  function storyChoices() {
    const root = dialogRoot() || document;
    const media = [...root.querySelectorAll('img, video')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 35 && rect.height >= 35;
    });
    const choices = media.map((element) => {
      const candidate = element.closest('button, [role="button"], [role="checkbox"], [role="radio"], label, li, div');
      return candidate || element;
    }).filter((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.width > 360 || rect.height > 420 || element.disabled) return false;
      return rect.width >= 45 && rect.height >= 45;
    });
    return choices.filter((element, index) => !choices.some((other, otherIndex) =>
      otherIndex < index && other.contains(element)));
  }

  async function waitFor(find, label, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = find();
      if (result) return result;
      await sleep(300);
    }
    throw new Error(`Não encontrei ${label}.`);
  }

  // Executa um passo; se falhar, espera 3s e tenta de novo (até `tries` vezes).
  async function step(label, fn, tries = 4) {
    let lastError;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < tries) {
          toast('info', `${label}: falhou, repetindo em 3s… (${attempt}/${tries - 1})`, 4000);
          await sleep(3000);
        }
      }
    }
    throw lastError || new Error(`Falha em: ${label}`);
  }

  async function abrirFlashpost() {
    try {
      const win = window.open(FLASHPOST_URL, '_blank');
      if (!win) throw new Error('popup bloqueado');
    } catch (_) {
      location.href = FLASHPOST_URL;
    }
  }

  // Ordem REAL do Instagram (confirmada pelas telas):
  // 1) nome do destaque + Avançar
  // 2) tela "Stories": seleciona o story + Avançar
  // 3) tela "Selecionar capa": Concluir
  async function createHighlight() {
    if (!isProfilePage()) throw new Error('Abra a página do perfil do Instagram antes de iniciar.');

    toast('info', 'Procurando o círculo para criar um destaque…', 4000);
    await step('Abrir Novo destaque', async () => {
      const open = await waitFor(findNewHighlightButton, 'o botão de novo destaque', 8000);
      robustClick(open);
      await waitFor(() => dialogRoot(), 'a janela de criação do destaque', 6000);
    });

    // 1) Nome do destaque (digitado) + Avançar.
    await step('Nome do destaque', async () => {
      const input = await waitFor(findNameInput, 'o campo do nome do destaque', 8000);
      await typeInto(input, HIGHLIGHT_NAME);
    });
    toast('info', 'Nome preenchido. Avançando…', 4000);
    await step('Avançar após o nome', async () => {
      const next = await waitFor(() => findButtonByText(AVANCAR), 'o botão Avançar após o nome', 6000);
      robustClick(next);
      await sleep(1000);
    });

    // 2) Seleciona o Story e Avança.
    await step('Selecionar Story', async () => {
      const choice = await waitFor(() => storyChoices()[0], 'o Story publicado', 8000);
      robustClick(choice);
      await sleep(600);
    });
    toast('info', 'Story selecionado. Avançando…', 4000);
    await step('Avançar após o Story', async () => {
      // O Avançar fica desativado até o Story ser marcado; esperamos ele habilitar.
      const next = await waitFor(() => findButtonByText(AVANCAR), 'o botão Avançar após o Story', 8000);
      robustClick(next);
      await sleep(1000);
    });

    // 3) Tela "Selecionar capa": Concluir (a capa padrão já serve).
    await step('Concluir', async () => {
      const done = await waitFor(() => findButtonByText(CONCLUIR), 'o botão Concluir', 8000);
      robustClick(done);
      await sleep(1500);
    });

    toast('ok', `Destaque “${HIGHLIGHT_NAME}” criado. Abrindo o Flashpost…`, 9000);
    await sleep(1200);
    await abrirFlashpost();
  }

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await createHighlight();
    } catch (error) {
      toast('err', `Não foi possível criar o destaque:\n${error?.message || error}`, 12000);
    } finally {
      button.disabled = false;
    }
  });

  // Abre o perfil e dispara o botão. O fluxo de criação roda pelo próprio botão.
  function autoClickOnProfile() {
    if (!isProfilePage() || sessionStorage.getItem(AUTO_KEY) !== '1') return;
    if (visible(button)) {
      sessionStorage.removeItem(AUTO_KEY);
      setTimeout(() => button.click(), 700);
    } else {
      setTimeout(autoClickOnProfile, 300);
    }
  }

  if (isReelsPage()) {
    sessionStorage.setItem(AUTO_KEY, '1');
    const profileLink = findProfileLink();
    if (profileLink) profileLink.click();
  } else {
    autoClickOnProfile();
  }
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isReelsPage()) sessionStorage.setItem(AUTO_KEY, '1');
    }
    if (isReelsPage() && sessionStorage.getItem(AUTO_KEY) === '1') {
      const profileLink = findProfileLink();
      if (profileLink) profileLink.click();
    } else {
      autoClickOnProfile();
    }
  }, 500);
})();
