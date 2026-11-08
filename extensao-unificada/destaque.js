(() => {
  if (window.__jeniDestaqueStory) return;
  window.__jeniDestaqueStory = true;

  const BUTTON_ID = 'jeni-destaque-story-button';
  const TOAST_ID = 'jeni-destaque-story-toast';
  const STYLE_ID = 'jeni-destaque-story-style';
  const HIGHLIGHT_NAME = '🎁🔥';
  // Flag compartilhada (chrome.storage.local): o flow-login do Flashpost grava
  // quando a conta é conectada. O destaque só é criado depois disso, no perfil.
  const GATE_KEY = 'itm_destaque_liberado';

  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Botão/toast afastados do botão "Flashpost" (que fica em right:16;bottom:16),
  // pra não sobrepor: ficam empilhados acima dele.
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed; right: 16px; bottom: 76px; z-index: 2147483647;
      border: 0; border-radius: 10px; padding: 12px 15px;
      background: #1f6feb; color: #fff; cursor: pointer;
      font: 700 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 5px 18px #0005;
    }
    #${BUTTON_ID}:hover { filter: brightness(1.1); }
    #${BUTTON_ID}:disabled { opacity: .65; cursor: wait; }
    #${TOAST_ID} {
      position: fixed; right: 16px; bottom: 136px; z-index: 2147483647;
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
  button.style.display = 'none'; // só aparece na página do perfil
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

  // Texto "humano" de um controle: só o que o usuário lê (conteúdo,
  // aria-label, title). NÃO inclui role/data-testid, senão um
  // <div role="button">Avançar</div> vira "avancar button" e quebra
  // o match ancorado /^avancar$/ — era essa a causa do travamento.
  const labelOf = (element) => clean([
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
  ].filter(Boolean).join(' '));

  // Texto amplo, usado só para heurísticas de descoberta (achar o "+").
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

  function clickable(element) {
    if (!element || !element.isConnected) return null;
    return element.closest('button, [role="button"], a') || element;
  }

  // Clique "de verdade": pointer/mouse down+up e UM único click.
  function realClick(element) {
    const target = clickable(element);
    if (!target || !target.isConnected) return false;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try { target.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, opts)); } catch (_) {}
    }
    try { target.click(); } catch (_) {}
    return true;
  }

  // Espera o botão clicado sumir/mudar, pra não clicar no mesmo
  // "Avançar" de novo enquanto o pop-up troca de etapa.
  async function waitGone(element, timeout = 6000) {
    const before = labelOf(element);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (!element.isConnected || !visible(element) || labelOf(element) !== before) return;
      await sleep(150);
    }
  }

  function dialogOpen() {
    return [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some(visible);
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

  // Procura o botão azul (Avançar / Concluir) comparando só o texto humano.
  function findButtonByText(patterns) {
    const matches = [...currentDialog().querySelectorAll('button, [role="button"], a')]
      .filter(visible)
      .map((element) => ({ element, label: labelOf(element) }))
      .filter(({ label }) => patterns.some(pattern => pattern.test(label)));
    // Prefere o rótulo mais curto (o próprio botão, não um contêiner pai).
    matches.sort((a, b) => a.label.length - b.label.length);
    return matches.length ? clickable(matches[0].element) : null;
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

  function currentDialog() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter(visible);
    return dialogs[dialogs.length - 1] || document;
  }

  // Seleciona o Story no pop-up "Stories". Prioriza marcar o checkbox;
  // se não houver, clica no próprio thumbnail (que marca o checkbox).
  function findStoryToSelect() {
    const root = currentDialog();

    // 1) checkbox explícito ainda não marcado
    const checkbox = [...root.querySelectorAll('[role="checkbox"], input[type="checkbox"]')]
      .filter(visible)
      .find((el) => el.getAttribute('aria-checked') !== 'true' && !el.checked);
    if (checkbox) return checkbox;

    // 2) thumbnail do Story: contêiner clicável com imagem/vídeo
    const media = [...root.querySelectorAll('img, video')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 60 && rect.height >= 80;
    });
    const choice = media
      .map((element) => element.closest('button, [role="button"], [role="checkbox"], label, li, div') || element)
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 60 && rect.height >= 80 && rect.width <= 400 && rect.height <= 520;
      });
    if (choice) return choice;

    // 3) fallback: qualquer bloco clicável grande dentro do diálogo
    const blocks = [...root.querySelectorAll('div, li, label, [role="button"]')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 90 && rect.width <= 400 && rect.height >= 120 && rect.height <= 520;
    });
    blocks.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    });
    return blocks[0] || null;
  }

  function storyIsSelected() {
    const root = currentDialog();
    return [...root.querySelectorAll('[role="checkbox"], input[type="checkbox"]')]
      .some((el) => el.getAttribute('aria-checked') === 'true' || el.checked);
  }

  async function waitFor(find, label, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      let result = null;
      try { result = find(); } catch (_) {}
      if (result) return result;
      await sleep(300);
    }
    throw new Error(`Não encontrei ${label}.`);
  }

  const NEXT_PATTERNS = [/^avancar$/, /^next$/, /^proximo$/, /^continuar$/];
  const DONE_PATTERNS = [/^concluir$/, /^finish$/, /^done$/, /^pronto$/];

  async function createHighlight() {
    if (!isProfilePage()) throw new Error('Abra a página do perfil do Instagram antes de iniciar.');

    // Se o pop-up de criação já estiver aberto, não clica no "Novo" de novo.
    if (!dialogOpen()) {
      toast('info', 'Procurando o círculo para criar um destaque…');
      const open = await waitFor(findNewHighlightButton, 'o botão de novo destaque');
      realClick(open);
      await waitFor(dialogOpen, 'o pop-up de novo destaque', 8000);
    }

    const input = await waitFor(findNameInput, 'o campo do nome do destaque');
    input.focus();
    // Só preenche se ainda estiver vazio (o usuário pode já ter digitado).
    if (!clean(input.value)) setNativeValue(input, HIGHLIGHT_NAME);
    toast('info', 'Nome pronto. Avançando…');

    // Etapa 1 → Avançar (tela "Novo destaque")
    const firstNext = await waitFor(
      () => findButtonByText(NEXT_PATTERNS),
      'o botão Avançar após o nome',
    );
    realClick(firstNext);
    await waitGone(firstNext);
    await sleep(600);

    // Etapa 2 → pop-up "Stories": marcar o único Story disponível
    // (só clica se ainda não estiver marcado, senão desmarcaria)
    if (!storyIsSelected()) {
      const story = await waitFor(findStoryToSelect, 'o Story para selecionar');
      realClick(story);
      await waitFor(storyIsSelected, 'a confirmação de seleção do Story', 4000)
        .catch(() => { /* alguns layouts não expõem aria-checked; segue mesmo assim */ });
    }
    toast('info', 'Story selecionado. Avançando…');

    // Etapa 2 → Avançar (dentro do pop-up Stories)
    const secondNext = await waitFor(
      () => findButtonByText(NEXT_PATTERNS),
      'o botão Avançar após selecionar o Story',
    );
    realClick(secondNext);
    await waitGone(secondNext);
    await sleep(600);

    // Etapa 3 → tela "Selecionar capa": Concluir
    const conclude = await waitFor(
      () => findButtonByText(DONE_PATTERNS),
      'o botão Concluir na tela de capa',
    );
    realClick(conclude);
    await sleep(1200);
    toast('ok', `Destaque “${HIGHLIGHT_NAME}” criado pela interface do Instagram.`, 9000);
  }

  let running = false;
  async function runOnce() {
    if (running) return;
    running = true;
    button.disabled = true;
    try {
      await createHighlight();
    } catch (error) {
      toast('err', `Não foi possível criar o destaque:\n${error?.message || error}`, 12000);
    } finally {
      running = false;
      button.disabled = false;
    }
  }
  button.addEventListener('click', runOnce);

  // ─────────────────────────── gate: só cria depois do Flashpost ───────────────
  // O destaque NÃO é mais disparado por Reels nem logo após o cadastro. Ele só
  // roda quando a conta já foi conectada no Flashpost (o flow-login grava
  // chrome.storage.local[GATE_KEY]) E estando na página do perfil.
  let jaCriou = false;

  function mostrarBotao() { button.style.display = isProfilePage() ? '' : 'none'; }

  async function checarGate() {
    if (running || jaCriou || !isProfilePage()) return;
    let liberado = false;
    try { const o = await chrome.storage.local.get(GATE_KEY); liberado = Boolean(o && o[GATE_KEY]); } catch (_) {}
    if (!liberado) return;
    jaCriou = true;
    try { await chrome.storage.local.remove(GATE_KEY); } catch (_) {}
    setTimeout(runOnce, 800);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[GATE_KEY] && changes[GATE_KEY].newValue) checarGate();
    });
  } catch (_) {}

  mostrarBotao();
  checarGate();
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; jaCriou = false; }
    mostrarBotao();
    checarGate();
  }, 800);
})();
