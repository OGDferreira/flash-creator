(() => {
  if (window.__extensionsIGUnifiedTrigger) return;
  window.__extensionsIGUnifiedTrigger = true;

  const ARCHIVE_URL = 'https://www.instagram.com/accounts/settings/v2/archiving_and_downloading/';
  const EDIT_URL = 'https://www.instagram.com/accounts/edit/';
  const STATE_KEY = 'extensionsIG.avl.unified.trigger.v1';
  const TRIGGERED_KEY = 'extensionsIG.avl.storyPronto.triggered';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const path = () => location.pathname.replace(/\/$/, '') || '/';
  const isInstagram = () => /^(?:www\.)?instagram\.com$/i.test(location.hostname);
  const isArchive = () => isInstagram() && path() === '/accounts/settings/v2/archiving_and_downloading';
  const isEdit = () => isInstagram() && path() === '/accounts/edit';

  function ask(message) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage(message, response => resolve(chrome.runtime.lastError ? null : response)); }
      catch { resolve(null); }
    });
  }
  function toast(message, error = false) {
    let node = document.getElementById('extensionsIG-unified-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'extensionsIG-unified-toast';
      node.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:390px;padding:10px 13px;border-radius:9px;color:#fff;font:600 13px/1.35 system-ui;box-shadow:0 5px 18px #0005;white-space:pre-line';
      document.documentElement.appendChild(node);
    }
    node.style.background = error ? '#b83232' : '#34506b';
    node.textContent = message;
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.remove(), 7000);
  }
  function paused() { return sessionStorage.getItem('extensionsIG.avl.unified.paused') === '1'; }
  function addPauseButton() {
    let button = document.getElementById('extensionsIG-unified-pause');
    if (!button) {
      button = document.createElement('button');
      button.id = 'extensionsIG-unified-pause';
      button.type = 'button';
      button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;border:0;border-radius:9px;padding:10px 13px;color:#fff;cursor:pointer;font:700 13px/1.2 system-ui;box-shadow:0 4px 15px #0005';
      document.documentElement.appendChild(button);
      button.addEventListener('click', () => {
        const next = !paused();
        sessionStorage.setItem('extensionsIG.avl.unified.paused', next ? '1' : '0');
        updatePauseButton(button);
        toast(next ? 'Fluxo pausado.' : 'Fluxo retomado.');
        if (!next) kick();
      });
    }
    updatePauseButton(button);
  }
  function updatePauseButton(button) {
    const value = paused();
    button.textContent = value ? '▶ Retomar fluxo' : 'Ⅱ Pausar fluxo';
    button.style.background = value ? '#238636' : '#59636e';
    button.title = value ? 'Retomar o fluxo' : 'Pausar o fluxo';
  }
  function waitForButton(timeout = 45000) {
    return new Promise(resolve => {
      const end = Date.now() + timeout;
      const check = () => {
        const button = document.getElementById('itm-publicar-stories');
        if (button && !button.disabled) return resolve(button);
        if (Date.now() >= end) return resolve(null);
        setTimeout(check, 350);
      };
      check();
    });
  }
  function saveStage(stage) { sessionStorage.setItem(STATE_KEY, stage); }
  function stage() { return sessionStorage.getItem(STATE_KEY) || 'awaiting-home'; }
  function signupDone() {
    return sessionStorage.getItem('itm_af_etapa') === 'concluido' || sessionStorage.getItem('itm_af_estado') === 'ir-perfil';
  }
  function isAlreadyTriggered() { return sessionStorage.getItem(TRIGGERED_KEY) === '1'; }
  function clickInstagramPermission() {
    if (sessionStorage.getItem('extensionsIG.avl.flashpost.permissionClicked') === '1') return false;
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const button = [...document.querySelectorAll('button,[role="button"],input[type="submit"]')]
      .find(el => el.getClientRects().length && !el.disabled && /^(permitir|allow|autorizar|authorize)$/.test(normalize(el.textContent || el.value || el.getAttribute('aria-label'))));
    if (!button) return false;
    button.click();
    sessionStorage.setItem('extensionsIG.avl.flashpost.permissionClicked', '1');
    toast('Permissão do Flashpost confirmada.');
    return true;
  }

  async function enableArchive() {
    const text = el => String([el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')].filter(Boolean).join(' ')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const find = () => [...document.querySelectorAll('input[type="checkbox"],[role="switch"],[role="checkbox"],button,label,li,section,div')]
      .find(el => /salvar (?:o )?story|salvar stories/.test(text(el)) && /itens arquivados|arquivado/.test(text(el)));
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (paused()) return false;
      const control = find();
      if (control) { control.click(); await sleep(900); return true; }
      await sleep(400);
    }
    throw new Error('Opção de arquivamento não encontrada.');
  }

  async function run() {
    if (!isInstagram()) return;
    // Auto-config pós-cadastro DESLIGADO (pedido do Guilherme): a extensão NÃO
    // força mais ir pra arquivamento nem pra "Editar perfil". Depois do cadastro
    // o usuário fica livre pra usar a conta — se ele sair da página, fica quieta.
    // Mantém só o clique de "Permitir" do Flashpost quando a tela de consentimento
    // aparece (não navega pra lugar nenhum).
    clickInstagramPermission();
  }
  const kick = () => run().catch(error => toast(String(error?.message || error), true));
  setTimeout(kick, 1200);
  window.addEventListener('pageshow', kick);
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; kick(); } }, 800);
})();
