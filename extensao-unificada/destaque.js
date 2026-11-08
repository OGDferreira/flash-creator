(() => {
  if (window.__jeniDestaqueStory) return;
  window.__jeniDestaqueStory = true;

  const BUTTON_ID = 'jeni-destaque-story-button';
  const TOAST_ID = 'jeni-destaque-story-toast';
  const STYLE_ID = 'jeni-destaque-story-style';
  const HIGHLIGHT_NAME = '🎁🔥';
  const AUTO_KEY = 'jeniDestaqueAutoClickPending';
  const UNIFIED_PENDING_KEY = 'extensionsIG.avl.unified.highlightPending';
  const UNIFIED_STAGE_PREFIX = 'extensionsIG.avl.unifiedFlow.v1.';

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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const textOf = (element) => clean([
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('role'),
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

  function findNewHighlightButton() {
    const plusHint = [...document.querySelectorAll('[title], [aria-label], [data-testid]')]
      .find((element) => /icone de mais|ícone de mais|adicionar destaque|novo destaque|new highlight/i
        .test(`${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-testid') || ''}`));
    if (plusHint) return clickable(plusHint);

    // No perfil mostrado pelo Instagram, o texto “Novo” fica abaixo do
    // círculo e o tooltip do ícone é “Ícone de mais”; o elemento com o texto
    // nem sempre é o próprio botão.
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

    // O círculo de adicionar destaque geralmente é um botão sem texto.
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

  function findNameInput() {
    const inputs = [...document.querySelectorAll('input, textarea')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !element.disabled;
    });
    return inputs.find((element) => {
      const text = textOf(element) + ' ' + clean(element.getAttribute('placeholder'));
      return /nome|name|destaque|highlight/.test(text);
    }) || inputs.find((element) => element.type === 'text' || element.tagName === 'TEXTAREA');
  }

  function findButtonByText(patterns) {
    return [...document.querySelectorAll('button, [role="button"], a')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && patterns.some(pattern => pattern.test(textOf(element)));
      })
      .sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
  }

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) throw new Error('Não consegui preencher o nome do destaque.');
    setter.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function storyChoices() {
    const providedRoot = document.querySelector(
      'div.x1ey2m1c.x78zum5.xdt5ytf.xtijo5x.x1o0tod',
    );
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter(element => element.getBoundingClientRect().width > 0);
    const root = providedRoot || dialogs[dialogs.length - 1] || document;
    const media = [...root.querySelectorAll('img, video')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 35 && rect.height >= 35 && rect.width > 0 && rect.height > 0;
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

  function lastStoryChoice() {
    const choices = storyChoices();
    return choices[choices.length - 1] || null;
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

  async function createHighlight() {
    if (!isProfilePage()) throw new Error('Abra a página do perfil do Instagram antes de iniciar.');

    toast('info', 'Procurando o círculo para criar um destaque…');
    const open = await waitFor(findNewHighlightButton, 'o botão de novo destaque');
    clickable(open).click();

    const input = await waitFor(findNameInput, 'o campo do nome do destaque');
    input.focus();
    setNativeValue(input, HIGHLIGHT_NAME);
    toast('info', 'Nome preenchido. Avançando…');

    const firstNext = await waitFor(
      () => findButtonByText([/^avancar$/, /^avançar$/, /^next$/, /^proximo$/, /^próximo$/]),
      'o botão Avançar após o nome',
    );
    clickable(firstNext).click();
    await sleep(900);

    const lastStory = await waitFor(lastStoryChoice, 'o último Story publicado');
    clickable(lastStory).click();
    toast('info', 'Último Story selecionado. Avançando…');

    const secondNext = await waitFor(
      () => findButtonByText([/^avancar$/, /^avançar$/, /^next$/, /^proximo$/, /^próximo$/]),
      'o botão Avançar após selecionar o Story',
    );
    clickable(secondNext).click();
    await sleep(900);
    const conclude = await waitFor(
      () => findButtonByText([/^concluir$/, /^finish$/, /^done$/]),
      'o botão Concluir após selecionar o Story',
    );
    clickable(conclude).click();
    await sleep(1200);
    toast('ok', `Destaque “${HIGHLIGHT_NAME}” enviado pela interface do Instagram.`, 9000);
  }

  async function finishUnifiedStage() {
    sessionStorage.removeItem(UNIFIED_PENDING_KEY);
    sessionStorage.removeItem('extensionsIG.avl.unified.active');
    const live = await new Promise(resolve => {
      try { chrome.runtime.sendMessage({ type: 'liveSession' }, response => resolve(chrome.runtime.lastError ? null : response)); }
      catch { resolve(null); }
    });
    if (!live?.userId) return;
    const key = UNIFIED_STAGE_PREFIX + String(live.userId);
    const stored = (await chrome.storage.local.get(key))[key] || { userId: String(live.userId) };
    await chrome.storage.local.set({ [key]: { ...stored, stage: 'done', updatedAt: Date.now(), lastUrl: location.href } });
  }

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await createHighlight();
      await finishUnifiedStage();
    } catch (error) {
      toast('err', `Não foi possível criar o destaque:\n${error?.message || error}`, 12000);
    } finally {
      button.disabled = false;
    }
  });

  // A automação termina aqui: abre o perfil e dispara o botão anexado.
  // O fluxo de criação continua sendo executado pelo próprio botão.
  function autoClickOnProfile() {
    if (!isProfilePage() || sessionStorage.getItem(AUTO_KEY) !== '1' || sessionStorage.getItem(UNIFIED_PENDING_KEY) !== '1') return;
    if (visible(button)) {
      sessionStorage.removeItem(AUTO_KEY);
      setTimeout(() => button.click(), 700);
    } else {
      setTimeout(autoClickOnProfile, 300);
    }
  }

  if (isReelsPage() && sessionStorage.getItem(UNIFIED_PENDING_KEY) === '1') {
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
      if (isReelsPage() && sessionStorage.getItem(UNIFIED_PENDING_KEY) === '1') sessionStorage.setItem(AUTO_KEY, '1');
    }
    if (isReelsPage() && sessionStorage.getItem(AUTO_KEY) === '1' && sessionStorage.getItem(UNIFIED_PENDING_KEY) === '1') {
      const profileLink = findProfileLink();
      if (profileLink) profileLink.click();
    } else {
      autoClickOnProfile();
    }
  }, 500);
})();
