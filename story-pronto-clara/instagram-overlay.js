// Botão principal do Instagram e atalhos compactos AVL para o cadastro.
//
// Não sabem nada de cookies nem de payload: só pedem ao background para publicar
// na sessão logada agora (publishLive) e mostram o resultado. A mídia, o link e
// a bio vêm da montagem que o painel deixou em chrome.storage.
//
// O clique tenta foto, bio, Story e destaque, sem abrir outra aba.

(() => {
  // Idempotente quando o Chrome injeta outra vez sem recarregar a página.
  // Se a SPA retirou os controles, uma nova injeção pode reconstruí-los.
  if (window.__itmStoryOverlay && document.getElementById('itm-story-toolbar')) return;
  window.__itmStoryOverlay = true;

  const BTN_ID = 'itm-publicar-stories';
  const AVL_ID = 'itm-avl-signup';
  const NEXT_ID = 'itm-avl-next-username';
  const SIGNUP_TOOLS_ID = 'itm-avl-signup-tools';
  const TOOLS_ID = 'itm-story-toolbar';
  const AUTO_FLOW_KEY = 'extensionsIG.avl.autoFlow.v2';
  const ARCHIVE_URL = 'https://www.instagram.com/accounts/settings/v2/archiving_and_downloading/';
  const EDIT_PROFILE_URL = 'https://www.instagram.com/accounts/edit/';
  const PROFESSIONAL_URL = 'https://www.instagram.com/accounts/convert_to_professional_account/';
  const PROFESSIONAL_FLOW_KEY = 'extensionsIG.avl.professionalFlow.v1';
  // Remove botão órfão de uma versão anterior (listeners com contexto inválido).
  document.getElementById(TOOLS_ID)?.remove();
  document.getElementById(BTN_ID)?.remove();
  document.getElementById('itm-copiar-alice')?.remove();
  document.getElementById(AVL_ID)?.remove();
  document.getElementById(NEXT_ID)?.remove();
  document.getElementById(SIGNUP_TOOLS_ID)?.remove();
  document.getElementById('itm-story-toast')?.remove();
  document.getElementById('itm-story-overlay-style')?.remove();

  // ── estilos, escopados por id para não colidir com o CSS do Instagram
  const style = document.createElement('style');
  style.id = 'itm-story-overlay-style';
  style.textContent = `
    #${TOOLS_ID} {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    }
    #${SIGNUP_TOOLS_ID} { display: none; flex-direction: row; align-items: center; gap: 6px; }
    #${AVL_ID}, #${NEXT_ID} {
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255,255,255,.17); border-radius: 8px;
      background: #293141; color: #fff; cursor: pointer;
      padding: 6px 9px; font: 600 12px/1.15 -apple-system, Segoe UI, Roboto, sans-serif;
      box-shadow: 0 3px 12px rgba(0,0,0,.2);
      transition: background .15s ease;
    }
    #${AVL_ID}:hover, #${NEXT_ID}:hover { background: #374357; }
    #${AVL_ID}:active, #${NEXT_ID}:active { background: #1e293b; }
    #${AVL_ID}[disabled], #${NEXT_ID}[disabled] { opacity: .65; cursor: wait; }
    #${BTN_ID} {
      position: relative; left: auto; bottom: auto; z-index: 1;
      display: flex; align-items: center; gap: 8px;
      padding: 11px 15px; border: none; border-radius: 10px;
      background: #1f6feb; color: #fff; cursor: pointer;
      font: 600 14px/1.1 -apple-system, Segoe UI, Roboto, sans-serif;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
      transition: transform .06s ease, background .15s ease, opacity .15s ease;
    }
    #${BTN_ID}:hover { filter: brightness(1.12); }
    #${BTN_ID}[data-state="running"] { background: #475569; }
    #${BTN_ID}[data-state="success"] { background: #169b52; }
    #${BTN_ID}[data-state="error"] { background: #ce3636; }
    #${BTN_ID}[data-state="warning"] { background: #c28a19; }
    #${BTN_ID}[data-state="idle"] { background: #1f6feb; }
    #${BTN_ID} .itm-col { max-width: 420px; }
    #${BTN_ID}:active { transform: translateY(1px); }
    #${BTN_ID}[disabled] { opacity: .6; cursor: default; }
    #${BTN_ID} .itm-sub {
      font-weight: 400; font-size: 11px; opacity: .85; margin-top: 1px;
    }
    #${BTN_ID} .itm-col { display: flex; flex-direction: column; align-items: flex-start; }
    #itm-story-toast {
      position: fixed; left: 16px; bottom: 122px; z-index: 2147483647;
      max-width: 300px; padding: 9px 12px; border-radius: 9px;
      font: 500 13px/1.35 -apple-system, Segoe UI, Roboto, sans-serif;
      color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.35);
      white-space: pre-line; word-break: break-word;
    }
    #itm-story-toast.ok  { background: #2f9e5f; }
    #itm-story-toast.err { background: #c0392b; }
    #itm-story-toast.info{ background: #34506b; }
  `;
  document.documentElement.appendChild(style);

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.innerHTML =
    '<span>📤</span><span class="itm-col"><span>Publicar stories</span>' +
    '<span class="itm-sub">tokenizador</span></span>';
  // Atalhos opcionais para a TELA DE CADASTRO; não enviam formulário,
  // não verificam nomes em lote nem tocam nas funções de Story/perfil.
  const toolbar = document.createElement('div');
  toolbar.id = TOOLS_ID;
  const signupTools = document.createElement('div');
  signupTools.id = SIGNUP_TOOLS_ID;
  const avlBtn = document.createElement('button');
  avlBtn.id = AVL_ID;
  avlBtn.type = 'button';
  avlBtn.textContent = '⚡ AVL';
  avlBtn.title = 'Preencher nome, senha e gerar 1 usuário';
  const nextBtn = document.createElement('button');
  nextBtn.id = NEXT_ID;
  nextBtn.type = 'button';
  nextBtn.textContent = '↻ Outro usuário';
  nextBtn.title = 'Gerar outro nome de usuário, sem enviar o cadastro';
  signupTools.append(avlBtn, nextBtn);
  toolbar.append(signupTools, btn);
  document.documentElement.appendChild(toolbar);

  // Só apresenta os atalhos de cadastro nas páginas oficiais de cadastro.
  function isSignupPage() {
    return /^\/(?:accounts\/(?:emailsignup|signup)|signup)\/?$/.test(location.pathname);
  }
  function updateSignupTools() {
    signupTools.style.display = isSignupPage() ? 'flex' : 'none';
  }
  updateSignupTools();

  // O site usa campos React controlados. O setter nativo seguido de um evento
  // de input faz o próprio formulário receber cada mudança (1 vez por clique).
  function setReactInput(input, value) {
    if (!input || !input.isConnected) return false;
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!nativeSet) return false;
    input.focus();
    nativeSet.call(input, value);
    try {
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function cleanName(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  // Não procurar campos fora da área de cadastro nem preencher outros sites.
  function findSignupField(field) {
    if (!isSignupPage()) return null;
    const candidates = [...document.querySelectorAll('input')].filter((el) => {
      if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'email') return false;
      if (field === 'password') return el.type === 'password';
      return ['text', 'search', ''].includes(el.type);
    });
    const names = {
      password: /^(?:password|passwd|senha)$/,
      fullName: /^(?:fullname|full_name|full-name|name|nome|nome completo|full name)$/,
      username: /^(?:username|user_name|user-name|nome de usuario|usuario|user name)$/,
    };
    const semanticAttrs = {
      password: ['password', 'new-password'],
      fullName: ['fullname', 'full_name', 'name'],
      username: ['username', 'user_name'],
    };
    const attrs = semanticAttrs[field];
    const semantic = candidates.find((el) => {
      const name = cleanName(el.getAttribute('name')).replace(/\s/g, '');
      const auto = cleanName(el.getAttribute('autocomplete')).replace(/\s/g, '');
      return attrs.includes(name) || attrs.includes(auto);
    });
    if (semantic) return semantic;
    for (const el of candidates) {
      const labels = [...(el.labels || [])].map((node) => node.textContent);
      const ariaIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      for (const id of ariaIds) labels.push(document.getElementById(id)?.textContent || '');
      labels.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '');
      // Páginas do Instagram frequentemente usam um div ao redor do input e
      // um rótulo em negrito como irmão anterior desse contêiner.
      const parent = el.parentElement;
      for (const block of [parent, parent?.parentElement]) {
        if (!block) continue;
        labels.push(...[...block.querySelectorAll('label')].map((label) => label.textContent));
        if (block.previousElementSibling && block.previousElementSibling.children.length <= 2) {
          labels.push(block.previousElementSibling.textContent || '');
        }
      }
      if (labels.some((label) => names[field].test(cleanName(label)))) return el;
    }
    return null;
  }
  // A lentidão da página pode atrasar os campos. Aguarda o DOM, nunca clica
  // em enviar e nunca gera várias sugestões por tentativa.
  async function waitSignupFields(fields, maxMs = 6000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline && isSignupPage()) {
      const found = Object.fromEntries(fields.map((name) => [name, findSignupField(name)]));
      if (fields.every((name) => found[name])) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return Object.fromEntries(fields.map((name) => [name, findSignupField(name)]));
  }
  const usedNames = new Set();
  function nextSignupUsername() {
    // 6 caracteres alfanuméricos; geração local, sem consulta à rede.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let attempt = 0; attempt < 12; attempt++) {
      const values = new Uint32Array(6);
      crypto.getRandomValues(values);
      const name = 'clara.gf' + [...values].map((value) => alphabet[value % alphabet.length]).join('');
      if (!usedNames.has(name)) { usedNames.add(name); return name; }
    }
    return 'clara.gf' + String(Date.now()).slice(-9);
  }
  // Preenche somente os seletores de nascimento já exibidos no cadastro.
  // Não envia o formulário nem faz chamadas extras ao Instagram.
  const monthsPt = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const monthsEn = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  function randomIntegerInclusive(min, max) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return min + (array[0] % (max - min + 1));
  }
  function randomValidBirthdate() {
    const year = randomIntegerInclusive(1985, 2008);
    const month = randomIntegerInclusive(1, 12);
    // Teste de preenchimento: limitar dias a 1–28 em qualquer mês.
    return { day: randomIntegerInclusive(1, 28), month, year };
  }
  function isDateValue(label, field, target) {
    const value = cleanName(label).replace(/\s+/g, ' ');
    if (field === 'month') {
      const numeric = /^\d{1,2}$/.test(value) && Number(value) === target;
      return numeric || value === monthsPt[target - 1] || value === monthsEn[target - 1]
        || value === monthsEn[target - 1].slice(0, 3) || value === monthsPt[target - 1].slice(0, 3);
    }
    return /^\d{1,4}$/.test(value) && Number(value) === target;
  }
  function dateElementKind(element) {
    // Identifica primeiro pelo próprio elemento; incluir texto do botão anterior
    // confundiria os três seletores vizinhos (Dia, Mês e Ano).
    const ownInfo = cleanName([
      element.getAttribute('name'), element.getAttribute('id'),
      element.getAttribute('aria-label'), element.getAttribute('title'),
      element.getAttribute('data-testid'), element.getAttribute('data-placeholder'),
      element.textContent?.slice(0, 80)
    ].filter(Boolean).join(' '));
    function kindOf(text) {
      if (/(?:^|\W)(?:dia|day)(?:\W|$)/.test(text)) return 'day';
      if (/(?:^|\W)(?:mes|month)(?:\W|$)/.test(text)) return 'month';
      if (/(?:^|\W)(?:ano|year)(?:\W|$)/.test(text)) return 'year';
      return null;
    }
    const direct = kindOf(ownInfo);
    if (direct) return direct;
    const adjacent = cleanName([
      element.parentElement?.querySelector('label')?.textContent,
      element.previousElementSibling?.textContent?.slice(0, 35)
    ].filter(Boolean).join(' '));
    const indirect = kindOf(adjacent);
    if (indirect) return indirect;
    if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.options, (option) => cleanName(option.textContent));
      if (options.some((value) => value === '1985' || value === '2008')) return 'year';
      if (options.some((value) => monthsPt.includes(value) || monthsEn.includes(value))) return 'month';
      if (options.includes('31') && options.includes('1')) return 'day';
    }
    return null;
  }
  // Identifique os três seletores também pela mesma linha visual abaixo de
  // “Data de nascimento”. Os textos Dia/Mês/Ano desaparecem depois de escolher
  // uma opção e menus abertos podem poluir o textContent dos seletores.
  function visualBirthdateRow() {
    const headings = [...document.querySelectorAll('label,h2,h3,h4,p,span,strong,div')]
      .filter(el => {
        const text = cleanName(el.textContent || '').replace(/\s+/g,' ');
        const r = el.getBoundingClientRect();
        return text.startsWith('data de nascimento') && text.length <= 34
          && r.width > 0 && r.height > 0 && r.height < 75;
      }).sort((a,b) => a.textContent.length - b.textContent.length);
    for (const heading of headings.slice(0,3)) {
      const hr = heading.getBoundingClientRect();
      const matches = [...document.querySelectorAll('button,select,[role="combobox"],[role="button"],[aria-haspopup="listbox"],div')]
        .filter(el => {
          if (!(el instanceof HTMLElement) || !el.isConnected) return false;
          if (el.closest(`#${TOOLS_ID}`)) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 110 && r.width <= 260 && r.height >= 38 && r.height <= 85
            && r.top >= hr.bottom - 8 && r.top <= hr.bottom + 125
            && r.left >= hr.left - 35 && r.left <= hr.left + 640;
        });
      // Há vários elementos aninhados por coluna: agrupe por posição horizontal
      // e escolha o controle mais semelhante ao retângulo do seletor.
      const rows = [];
      for (const el of matches) {
        const r = el.getBoundingClientRect();
        let row = rows.find(group => Math.abs(group.top - r.top) < 12);
        if (!row) { row = {top:r.top, items:[]}; rows.push(row); }
        row.items.push(el);
      }
      rows.sort((a,b) => a.top-b.top);
      for (const row of rows) {
        const columns = [];
        for (const el of row.items.sort((a,b) => a.getBoundingClientRect().left-b.getBoundingClientRect().left)) {
          const x = el.getBoundingClientRect().left;
          const col = columns.find(c => Math.abs(c.x - x) < 23);
          if (col) col.nodes.push(el);
          else columns.push({x,nodes:[el]});
        }
        if (columns.length !== 3) continue;
        const picked = columns.map(c => c.nodes.sort((a,b) => {
          const score = el => {
            const r=el.getBoundingClientRect();
            const tag=el.tagName.toLowerCase();
            return Math.abs(r.width-176)*.2 + Math.abs(r.height-60)
              - (tag==='button'||tag==='select'?30:0)
              - (el.getAttribute('role')==='combobox'?30:0);
          };
          return score(a)-score(b);
        })[0]);
        return {day:picked[0],month:picked[1],year:picked[2]};
      }
    }
    return null;
  }
  function findBirthdateControls() {
    const visual = visualBirthdateRow();
    if (visual) return visual;
    const candidates = [...document.querySelectorAll(
      'select,button,[role="combobox"],[aria-haspopup="listbox"],[role="button"]'
    )].filter((el) => el.isConnected && !el.disabled && !el.hasAttribute('aria-disabled'));
    const result = {};
    // Elementos com nome/rotulo Dia, Mês e Ano — sem clicar em "Enviar".
    for (const el of candidates) {
      const kind = dateElementKind(el);
      if (kind && !result[kind]) result[kind] = el;
    }
    // Após escolher um ano, o botão pode exibir só "1998", sem mais conter
    // o texto "Ano". Reencontre os três controles pela MESMA linha da data.
    // Isso também funciona quando o React reconstrói os botões após o clique.
    if (['day', 'month', 'year'].some((key) => !result[key])) {
      const anchor = result.day || result.month || result.year;
      if (anchor && anchor.getBoundingClientRect().width > 0) {
        const base = anchor.getBoundingClientRect();
        const row = candidates.filter((el) => {
          if (!(el instanceof HTMLElement)) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 90 && r.width <= 280 && r.height >= 25 && r.height <= 95
            && Math.abs(r.top - base.top) <= 18 && Math.abs(r.left - base.left) <= 570;
        }).sort((a,b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const columns = [];
        for (const el of row) {
          const x = el.getBoundingClientRect().left;
          if (!columns.some((known) => Math.abs(known.getBoundingClientRect().left - x) < 15)) columns.push(el);
        }
        if (columns.length === 3) {
          for (let index = 0; index < 3; index++) {
            const key = ['day', 'month', 'year'][index];
            result[key] ||= columns[index];
          }
        }
      }
      const selects = candidates.filter((el) => el instanceof HTMLSelectElement);
      if (selects.length === 3) {
        for (let index = 0; index < 3; index++) {
          const key = ['day', 'month', 'year'][index];
          result[key] ||= selects[index];
        }
      }
    }
    // Se todos já exibem números/meses, os rótulos "Dia/Mês/Ano" desaparecem.
    // Buscar a linha de três botões imediatamente ABAIXO de "Data de nascimento".
    // Não depende de nomes/classes internas do Instagram e evita falso negativo
    // quando o React substitui todos os controles após cada seleção.
    if (['day', 'month', 'year'].some((key) => !result[key])) {
      const headings = [...document.querySelectorAll('label,h1,h2,h3,h4,h5,strong,p,span,div')]
        .filter((el) => {
          const title = cleanName(el.textContent).replace(/\s+/g, ' ');
          const r = el.getBoundingClientRect();
          return title.startsWith('data de nascimento') && title.length <= 38 && r.width > 0 && r.height > 0;
        }).sort((a,b) => a.textContent.length-b.textContent.length);
      for (const heading of headings.slice(0, 4)) {
        const hr = heading.getBoundingClientRect();
        const near = candidates.filter(el => {
          if (!(el instanceof HTMLElement)) return false;
          const r = el.getBoundingClientRect();
          return r.width>=90 && r.width<=285 && r.height>=26 && r.height<=95
            && r.top>=hr.bottom-12 && r.top<=hr.bottom+175
            && r.left>=hr.left-28 && r.left<=hr.left+725;
        }).sort((a,b) => a.getBoundingClientRect().top-b.getBoundingClientRect().top || a.getBoundingClientRect().left-b.getBoundingClientRect().left);
        const tops = [...new Set(near.map(el => Math.round(el.getBoundingClientRect().top/15)))];
        let found = false;
        for (const t of tops) {
          const line = near.filter(el => Math.abs(el.getBoundingClientRect().top-t*15)<=16)
            .sort((a,b) => a.getBoundingClientRect().left-b.getBoundingClientRect().left);
          const unique = [];
          for (const el of line) {
            if (!unique.some(prev=>Math.abs(prev.getBoundingClientRect().left-el.getBoundingClientRect().left)<20)) unique.push(el);
          }
          if (unique.length!==3) continue;
          for (let i=0;i<3;i++) result[['day','month','year'][i]] ||= unique[i];
          found = true;
          break;
        }
        if (found) break;
      }
    }
    return result;
  }
  const shortPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function isVisibleDateItem(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected) return false;
    if (node.closest(`#${TOOLS_ID}, #itm-story-toast`)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const css = getComputedStyle(node);
    return css.display !== 'none' && css.visibility !== 'hidden'
      && node.getAttribute('aria-hidden') !== 'true';
  }
  // O Instagram pode renderizar os menus como portais de divs (sem role) e manter
  // o texto de todas as opcoes no DOM. Nunca use o texto de um menu aberto como
  // comprovante de que o campo recebeu a data.
  function selectedDateLabel(trigger) {
    if (!trigger?.isConnected) return '';
    if (trigger instanceof HTMLSelectElement) return cleanName(trigger.selectedOptions[0]?.textContent || '');
    const explicit = trigger.getAttribute('aria-valuetext') || trigger.getAttribute('data-selected-value');
    if (explicit) return cleanName(explicit);
    const copy = trigger.cloneNode(true);
    copy.querySelectorAll('[role="listbox"], [role="menu"], [role="option"], [data-date-menu], ul').forEach((el) => el.remove());
    const text = (copy.innerText || copy.textContent || '').trim().split(/\n/)[0];
    return cleanName(text);
  }
  function isSelectedDate(trigger, field, target) {
    if (!trigger?.isConnected) return false;
    const label = selectedDateLabel(trigger);
    if (!label || ['dia','mes','ano','day','month','year'].includes(label)) return false;
    if (field === 'month') {
      return [monthsPt[target - 1], monthsEn[target - 1],
        String(target), String(target).padStart(2, '0')].some((term) =>
          label === term || label.endsWith(' ' + term));
    }
    const digits = label.match(/\b\d{1,4}\b/g) || [];
    return digits.length === 1 && Number(digits[0]) === target;
  }
  // Popup mais proximo HORIZONTALMENTE do seletor; evita clicar no dia
  // quando tres listas estao abertas ao mesmo tempo.
  function optionDropdown(trigger) {
    const tr = trigger.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('[role="listbox"], [role="menu"], [data-date-menu], div, ul')];
    const candidates = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isVisibleDateItem(node) || node === trigger || node.contains(trigger)) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 85 || r.width > 440 || r.height < 85 || r.height > 680) continue;
      if (Math.abs(r.left - tr.left) > 105 || Math.abs(r.top - tr.bottom) > 180) continue;
      const items = [...node.children].filter(c => c instanceof HTMLElement && c.getBoundingClientRect().height >= 18);
      if (items.length < 3) continue;
      const css = getComputedStyle(node);
      const scrolls = /auto|scroll|overlay/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 10;
      const isList = node.matches('[role="listbox"],[role="menu"],[data-date-menu]');
      if (!scrolls && !isList && items.length < 7) continue;
      candidates.push({node,score:Math.abs(r.left-tr.left)*4 + Math.abs(r.top-tr.bottom)
        + (scrolls ? -40 : 0) + (isList ? -20 : 0) });
    }
    candidates.sort((a,b)=>a.score-b.score);
    if (candidates.length) return candidates[0].node;
    // Um único menu com semântica explícita também pode estar num portal
    // distante do botão (algumas versões móveis do formulário).
    const semantic = [...document.querySelectorAll('[role="listbox"],[role="menu"]')]
      .filter(node => isVisibleDateItem(node) && node.querySelectorAll('[role="option"],div,li').length >= 3);
    return semantic.length === 1 ? semantic[0] : null;
  }
  // Algumas versões do cadastro exibem listas em três portais sem role.
  // Encontrar a opção na MESMA coluna do seletor evita clicar em outra lista.
  function dateOptionInColumn(trigger, field, target) {
    if (!trigger?.isConnected) return null;
    const tr = trigger.getBoundingClientRect();
    const matches = [...document.querySelectorAll('[role="option"],[role="menuitem"],button,li,div,span')]
      .filter(node => {
        if (!(node instanceof HTMLElement) || !isVisibleDateItem(node)) return false;
        if (!isDateValue(node.textContent || '',field,target)) return false;
        const r = node.getBoundingClientRect();
        // A lista começa logo abaixo do botão; itens podem estar além da
        // região visível até que a lista correspondente seja rolada.
        return r.width >= 10 && r.width <= 265 && r.height >= 10 && r.height <= 95
          && Math.abs(r.left-tr.left) <= 100
          && r.top >= tr.bottom - 15 && r.top <= tr.bottom + 1800;
      });
    matches.sort((a,b) => {
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      return Math.abs(ar.left-tr.left)-Math.abs(br.left-tr.left)
        || Math.abs(ar.top-tr.bottom)-Math.abs(br.top-tr.bottom);
    });
    const item=matches[0];
    if (!item) return null;
    let clickable=item;
    while (clickable.parentElement && clickable.parentElement!==document.body) {
      const parent=clickable.parentElement;
      const r=parent.getBoundingClientRect();
      if (r.height>95 || r.width>280 || !isDateValue(parent.textContent||'',field,target)) break;
      clickable=parent;
    }
    return clickable;
  }
  function dateOptionInMenu(menu, field, target) {
    if (!menu) return null;
    const matches = [...menu.querySelectorAll('[role="option"], [role="menuitem"], button, li, div, span')]
      .filter(node => node instanceof HTMLElement && isDateValue(node.textContent || '', field, target));
    const nearestRow = (node) => {
      let candidate = node;
      // O manipulador de clique muitas vezes fica no div pai do span.
      while (candidate.parentElement && candidate.parentElement !== menu &&
          isDateValue(candidate.parentElement.textContent || '', field, target) &&
          candidate.parentElement.getBoundingClientRect().height <= 90) {
        candidate = candidate.parentElement;
      }
      return candidate;
    };
    return matches.map(nearestRow).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0] || null;
  }
  function dropdownScroller(menu) {
    if (!menu) return null;
    const nodes = [menu,...menu.querySelectorAll('div,ul')];
    return nodes.find(node => {
      const css = getComputedStyle(node);
      return /auto|scroll|overlay/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 15;
    }) || (menu.scrollHeight>menu.clientHeight+15 ? menu : null);
  }
  function isInsideClippedScroll(node, scroller) {
    if (!scroller) return true;
    const a = node.getBoundingClientRect(), b = scroller.getBoundingClientRect();
    return a.top >= b.top-2 && a.bottom <= b.bottom+2;
  }
  async function clickDateOption(trigger, field, target, popup) {
    // Se a estrutura do menu mudar, procure o item pela coluna visível.
    const option = dateOptionInColumn(trigger, field, target)
      || dateOptionInMenu(popup, field, target);
    if (!option) return false;
    option.scrollIntoView({block:'nearest',inline:'nearest'});
    await shortPause(90);
    const scroller = dropdownScroller(popup);
    if (scroller && scroller.contains(option) && !isInsideClippedScroll(option, scroller)) return false;
    // Alguns seletores usam onPointerDown/onMouseDown, outros onClick.
    // Eventos são usados apenas no elemento da opção, jamais em Enviar.
    try { option.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,pointerType:'mouse'})); } catch {}
    option.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
    option.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    option.click();
    await shortPause(220);
    // Em React o botão pode ter sido substituído por outro elemento.
    // Não cheque apenas a referência antiga, que pode estar desconectada.
    const freshTrigger = findBirthdateControls()[field] || trigger;
    return isSelectedDate(freshTrigger, field, target);
  }
  async function chooseBirthdateControl(el, field, target) {
    if (!el?.isConnected) return false;
    if (el instanceof HTMLSelectElement) {
      const option = [...el.options].find(opt => isDateValue(opt.textContent, field, target) || isDateValue(opt.value, field, target));
      if (!option) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter.call(el, option.value);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return isSelectedDate(el, field, target);
    }
    if (isSelectedDate(el, field, target)) return true;
    // Fechar outros menus antes de escolher um valor; paginas SPA podem
    // manter todos abertos se o clique anterior nao foi aceito.
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    el.click();
    await shortPause(160);
    let popup = optionDropdown(el);
    if (await clickDateOption(el,field,target,popup)) return true;
    if (!popup) return false;
    // Anos antigos ficam fora da janela visivel. Localizar a lista
    // associada ao ano e rolar apenas ela, nunca as listas vizinhas.
    const scroll = dropdownScroller(popup);
    if (scroll) {
      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event('scroll',{bubbles:true}));
      await shortPause(80);
      for (let i=0; i<35; i++) {
        popup = optionDropdown(el) || popup;
        if (await clickDateOption(el,field,target,popup)) return true;
        const area = dropdownScroller(popup);
        if (!area) break;
        const before = area.scrollTop;
        area.scrollTop = Math.min(area.scrollHeight-area.clientHeight, before + Math.max(90,area.clientHeight*.72));
        area.dispatchEvent(new Event('scroll',{bubbles:true}));
        await shortPause(65);
        if (area.scrollTop <= before + 1) break;
      }
    }
    // Em vez de mentir "Data preenchida", avisar quando o React nao
    // confirmou a selecao. Esc desfaz o menu aberto sem tocar no cadastro.
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    return false;
  }
  async function tryFillRandomBirthdate() {
    if (!isSignupPage()) return { complete:false, failed:'página de cadastro' };
    const date = randomValidBirthdate();
    const fields = [['year',date.year], ['month',date.month], ['day',date.day]];
    const attempted = {};
    // A v1.43 interrompia aqui quando o ano ERA selecionado, mas seu
    // botão antigo deixava de existir após o React atualizar a página.
    // Agora cada campo é tentado independentemente, sem abortar os demais.
    for (const [field,value] of fields) {
      let el = null;
      for (let t=0; t<12; t++) {
        el=findBirthdateControls()[field];
        if (el?.isConnected) break;
        await shortPause(120);
      }
      if (el) {
        try { attempted[field] = await chooseBirthdateControl(el,field,value); }
        catch { attempted[field] = false; }
      } else attempted[field] = false;
      await shortPause(110);
    }
    // O valor pode só aparecer após a atualização assíncrona do React.
    // Verificar os três botões já re-renderizados antes de dar o resultado.
    const confirmed = {};
    for (let t=0; t<6; t++) {
      const controls=findBirthdateControls();
      for (const [field,value] of fields) {
        confirmed[field] = isSelectedDate(controls[field],field,value);
      }
      if (fields.every(([field])=>confirmed[field])) break;
      await shortPause(150);
    }
    const complete=fields.every(([field])=>confirmed[field]);
    const missing=fields.filter(([field])=>!confirmed[field]).map(([field])=>({year:'ano',month:'mês',day:'dia'})[field]);
    return { complete,date,failed:complete?null:missing.join(', '),attempted,confirmed };
  }
  let fillingSignup = false;
  function signupFeedback(message, positive = true) {
    toast(positive ? 'ok' : 'err', message);
  }
  async function handleSignupClick(allFields) {
    if (fillingSignup) return;
    if (!isSignupPage()) {
      signupFeedback('Abra a página de cadastro do Instagram.', false);
      return;
    }
    fillingSignup = true;
    avlBtn.disabled = nextBtn.disabled = true;
    const currentButton = allFields ? avlBtn : nextBtn;
    const oldLabel = currentButton.textContent;
    currentButton.textContent = 'Aguardando…';
    try {
      const required = allFields ? ['password', 'fullName', 'username'] : ['username'];
      const fields = await waitSignupFields(required);
      const missing = required.filter((key) => !fields[key]);
      if (missing.length) {
        signupFeedback('Campos não encontrados. Aguarde o cadastro carregar e tente novamente.', false);
        return;
      }
      if (allFields) {
        setReactInput(fields.password, 'senhaforte');
        setReactInput(fields.fullName, 'Clara🌸');
      }
      const suggestion = nextSignupUsername();
      setReactInput(fields.username, suggestion);
      fields.username.blur(); // Dispara a validação normal do Instagram.
      if (allFields) {
        const birthdate = await tryFillRandomBirthdate();
        if (birthdate.complete) {
          signupFeedback(`AVL preenchido: ${suggestion}\nData: ${String(birthdate.date.day).padStart(2, '0')}/${String(birthdate.date.month).padStart(2, '0')}/${birthdate.date.year}`);
        } else {
          // O React pode atualizar visualmente os seletores mesmo quando a
          // rotina de leitura não reconhece o rótulo novo. Não afirmar erro.
          toast('info', `AVL: nome, senha e usuário preenchidos.\nConfira a data (validação inconclusiva: ${birthdate.failed || 'seletor'}).`);
        }
      } else {
        signupFeedback(`Usuário alterado: ${suggestion}\nO Instagram verificará a disponibilidade.`);
      }
    } catch (error) {
      signupFeedback('Não foi possível preencher. Tente novamente depois que a página carregar.', false);
    } finally {
      currentButton.textContent = oldLabel;
      avlBtn.disabled = nextBtn.disabled = false;
      fillingSignup = false;
    }
  }
  avlBtn.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    void handleSignupClick(true);
  });
  nextBtn.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    void handleSignupClick(false);
  });

  function toast(kind, text, ms = 3000) {
    let el = document.getElementById('itm-story-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'itm-story-toast';
      document.documentElement.appendChild(el);
    }
    el.className = kind;
    // Um aviso de, no máximo, duas linhas; desaparece após 3 segundos.
    el.textContent = String(text || '').split('\n').slice(0, 2).join('\n');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 3000);
  }

  const sub = btn.querySelector('.itm-sub');
  const mainText = btn.querySelector('.itm-col > span:first-child');
  const statusIcon = btn.querySelector('span:first-child');

  // Última config conhecida — para o clique já dizer o que vai fazer.
  let lastConfig = { hasImage: false, hasLink: false, hasProfilePhoto: false, highlightTitle: '', bio: '' };

  /** Atualiza o subtítulo com o que está pré-configurado no painel. */
  function refreshConfig() {
    try {
      chrome.runtime.sendMessage({ type: 'getStoryConfig' }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        lastConfig = resp;
        if (!runningAll && visualState === 'idle') mainText.textContent = 'Configurar perfil';
        if (visualState !== 'idle' || runningAll) return;
        if (!resp.hasImage) {
          sub.textContent = 'configure no popup da extensão';
          return;
        }
        sub.textContent = 'Foto · bio · Story · destaque';
      });
    } catch {
      // extensão recarregando; tenta de novo no próximo foco
    }
  }

  // A operação separada continua disponível no painel da extensão para teste,
  // mas não cria outro botão flutuante na página do Instagram.
  let profileOnlyRunning = false;
  async function runProfileOnlyOnEditPage() {
    if (!/^\/accounts\/edit\/?$/.test(location.pathname)) {
      toast('info', 'Abra Configurações → Editar perfil antes de testar foto + bio.', 9000);
      return;
    }
    if (profileOnlyRunning || runningAll) return;
    profileOnlyRunning = true;
    toast('info', 'Tentando foto e bio nesta mesma aba, sem publicar Story.', 9000);
    try {
      const resp = await ask({ type: 'startProfileEditHere', pageUrl: location.href });
      if (!resp?.ok) throw new Error(resp?.error || 'Falha ao iniciar a edição');
      toast('info', 'Edição iniciada. Aguarde o painel de resultado.', 10000);
      for (let i = 0; i < 120; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 800));
        const status = await ask({ type: 'profileEditStatus' });
        if (status?.status === 'complete') break;
        if (status?.status === 'aborted') throw new Error(status?.error || 'Edição cancelada');
      }
    } catch (e) {
      toast('err', 'Não foi possível começar: ' + e.message, 12000);
    } finally {
      profileOnlyRunning = false;
    }
  }

  // ── modo página (teste): publica o story pela PRÓPRIA aba, não pelo service
  // worker. Do worker a requisição sai com origem forjada e host de app
  // (`i.instagram.com`) — a assinatura de automação. Pela aba ela é um XHR de
  // primeira parte, `Origin`/`Referer` reais, upload em `www` (mesma origem).
  // Fica atrás deste botão para ligar numa conta só e comparar antes de virar o
  // padrão do lote. O destaque continua saindo pelo worker (o web não tem rota
  // de destaque de primeira parte) — é o tell residual do modo.
  let pageMode = false;
  // Lê a preferência de publicação da versão anterior sem mostrar o botão
  // de modo de teste. Somente o botão azul fica visível nesta página.
  try {
    chrome.storage.local.get('postFromPage', (r) => {
      pageMode = Boolean(r && r.postFromPage);
    });
  } catch {
    // Sem storage: mantém a configuração padrão.
  }

  /** base64 → bytes. O JPEG vem do painel como texto (a ponte é JSON). */
  function bytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** Lê um cookie legível da aba — `csrftoken` não é httpOnly. */
  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function readReply(res) {
    const text = await res.text();
    try {
      return { data: JSON.parse(text), text };
    } catch {
      return { data: null, text };
    }
  }

  /**
   * Veredito sobre a CONTA encerra a cadeia de rotas: tentar de novo em outro
   * host não muda a resposta e soma batida na conta. O resto é rota ou
   * formulário, e vale o próximo candidato.
   */
  function isAccountVerdict(message) {
    return ['login_required', 'checkpoint_required', 'feedback_required', 'spam'].includes(
      String(message || ''),
    );
  }

  /** Página do Instagram no lugar da API — rota inexistente nesse host. */
  function looksLikeHtml(text) {
    return /^\s*<(!doctype html|html[\s>])/i.test(String(text || ''));
  }

  function replyError(res, data, text, url) {
    const message = data && (data.message || data.error_type);
    if (message === 'login_required') return 'Sessão expirada — faça login de novo nesta conta.';
    if (message === 'checkpoint_required') return 'Instagram pediu verificação (checkpoint).';
    if (message === 'feedback_required') return 'Instagram bloqueou a ação — a conta está limitada.';
    if (message) return String(message);
    // O 404 do Instagram é uma PÁGINA, e ela vem com `not-logged-in` na tag
    // `<html>` mesmo numa aba logada. Sem esta linha o operador lê o HTML cru e
    // conclui que caiu a sessão, quando é o endereço que mudou.
    if (looksLikeHtml(text)) {
      return (
        `HTTP ${res.status} com página HTML no lugar de JSON` +
        `${url ? ` em ${url}` : ''} — essa rota não existe nesse host.`
      );
    }
    return `HTTP ${res.status}: ${String(text).slice(0, 200) || 'resposta vazia'}`;
  }

  function ask(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) =>
          resolve(chrome.runtime.lastError ? null : r),
        );
      } catch {
        resolve(null);
      }
    });
  }

  /** Publica o story pela aba: upload (www) + configure, com origem real. */
  async function publishFromPage() {
    const prep = await ask({ type: 'preparePost' });
    if (!prep) return { ok: false, error: 'A extensão não respondeu. Recarregue a página.' };
    if (!prep.ok) return prep;

    const csrf = readCookie('csrftoken');
    if (!csrf) return { ok: false, error: 'Você não está logado no Instagram nesta aba.' };

    let bytes;
    try {
      bytes = bytesFromBase64(prep.imageBase64);
    } catch {
      return { ok: false, error: 'A imagem guardada está corrompida — reenvie no painel.' };
    }

    const { request } = prep;
    // Tenta cada rota de mesma origem para o MESMO `upload_id`; 404/HTML é
    // endereço errado e vale o próximo, recusa nomeada é a conta e para aqui.
    const candidates =
      request.uploadCandidates && request.uploadCandidates.length
        ? request.uploadCandidates
        : [
            {
              url: request.uploadUrl,
              entityName: request.entityName,
              ruploadParams: request.ruploadParams,
            },
          ];
    const recusas = [];
    let uploadedVia = '';
    for (const candidate of candidates.slice(0, 2)) {
      let up;
      try {
        up = await fetch(candidate.url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: '*/*',
            'content-type': 'image/jpeg',
            offset: '0',
            'x-entity-length': String(bytes.length),
            'x-entity-name': candidate.entityName,
            'x-entity-type': 'image/jpeg',
            'x-ig-app-id': request.appId,
            'x-instagram-rupload-params': candidate.ruploadParams,
          },
          body: bytes,
        });
      } catch (e) {
        // Rede instavel nao e prova de endpoint ausente: nao repetir uploads.
        return {ok:false,step:'upload',error:`Falha de rede no upload: ${e.message}`};
      }
      const { data, text } = await readReply(up);
      if (up.ok && data && data.status !== 'fail') {
        uploadedVia = candidate.url;
        break;
      }
      recusas.push(`${candidate.url} → ${replyError(up, data, text, candidate.url)}`);
      await ask({ type: 'notePublishingResponse', status: up.status, data });
      if (!([404, 405].includes(up.status) && looksLikeHtml(text))) {
        return { ok: false, step: 'upload', error: recusas.join('\n') };
      }
    }

    // Nenhuma rota de `www` aceitou: o worker alcança `i.instagram.com`, que a
    // aba não alcança (CORS). Só o upload sai por lá; o configure continua aqui.
    if (!uploadedVia) {
      const viaWorker = await ask({ type: 'uploadLive', uploadId: request.uploadId });
      if (!viaWorker || !viaWorker.ok) {
        const doWorker = viaWorker && viaWorker.error ? `\nworker: ${viaWorker.error}` : '';
        return { ok: false, step: 'upload', error: `${recusas.join('\n')}${doWorker}` };
      }
      uploadedVia = viaWorker.uploadedVia || 'worker';
    }

    // ── publica. Os bytes já estão no servidor: trocar de rota aqui custa só o
    // formulário de novo, com o mesmo `upload_id`. A aba tenta as rotas de mesma
    // origem; o host do app fica com o worker.
    const rotas =
      request.configureCandidates && request.configureCandidates.length
        ? request.configureCandidates
        : [{ url: request.configureUrl, body: request.configureBody, sameOrigin: true }];
    const recusadas = [];
    let publishedVia = '';
    let publicado = null;
    // A ordem da lista é a ordem das tentativas, sem furar fila: rota de mesma
    // origem sai da aba, rota do host do app sai do worker (a aba não a alcança,
    // CORS). A rota do criador do web é a última justamente por ser a que morreu
    // — tentá-la antes gastaria uma batida num 404 já conhecido.
    for (const rota of rotas) {
      if (rota.sameOrigin === false) {
        const viaWorker = await ask({ type: 'configureLive', candidates: [rota] });
        if (viaWorker && viaWorker.ok) {
          publicado = { media: viaWorker.mediaId ? { pk: viaWorker.mediaId } : undefined };
          publishedVia = viaWorker.publishedVia || rota.url;
          break;
        }
        recusadas.push(`${rota.url} (worker) → ${(viaWorker && viaWorker.error) || 'sem resposta'}`);
        // Nao enviar a mesma publicacao novamente apos resposta incerta.
        break;
      }
      let cfg;
      try {
        cfg = await fetch(rota.url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: '*/*',
            'content-type': 'application/x-www-form-urlencoded',
            'x-csrftoken': csrf,
            'x-ig-app-id': request.appId,
            'x-requested-with': 'XMLHttpRequest',
          },
          body: rota.body,
        });
      } catch (e) {
        // Falha de rede DEPOIS do configure é ambígua: o Story pode ter ido ao ar.
        // Nunca faça outro POST de publicação às cegas.
        recusadas.push(`${rota.url} → resposta perdida: ${e.message}`);
        break;
      }
      const { data, text } = await readReply(cfg);
      if (cfg.ok && data && data.status !== 'fail') {
        publicado = data;
        publishedVia = rota.url;
        break;
      }
      recusadas.push(`${rota.url} → ${replyError(cfg, data, text, rota.url)}`);
      await ask({ type: 'notePublishingResponse', status: cfg.status, data });
      // Nao repetir em caso de bloqueio, erro de autenticacao, rede ou 400.
      if (!([404, 405].includes(cfg.status) && looksLikeHtml(text))) break;
    }

    if (!publicado) {
      return {
        ok: false,
        step: 'configure',
        error:
          `Imagem subiu em ${uploadedVia}, mas a publicação foi recusada em ` +
          `${recusadas.length} rota(s):\n${recusadas.join('\n')}`,
      };
    }

    const data = publicado;
    const mediaId = data.media && data.media.pk ? String(data.media.pk) : undefined;
    const result = { ok: true, mediaId, uploadedVia, publishedVia };

    // Destaque é solicitado PELO FLUXO DE CONTROLE depois que o mediaId
    // já estiver salvo no chrome.storage. Assim erro no destaque não perde Story.
    return result;
  }

  /** Caminho antigo: publica pelo service worker (publishLive). */
  function publishViaBackground() {
    return new Promise((resolve) => {
      let settled = false;
      try {
        chrome.runtime.sendMessage({ type: 'publishLive' }, (resp) => {
          settled = true;
          resolve(
            chrome.runtime.lastError || !resp
              ? { ok: false, error: 'A extensão não respondeu. Recarregue a página.' }
              : resp,
          );
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
      setTimeout(() => {
        if (!settled) resolve({ ok: false, error: 'Sem resposta do Instagram (timeout).' });
      }, 60000);
    });
  }

  // Fluxo único, com retomada por CONTA (não guarda cookies). Um Story publicado
  // nunca volta para a fila só porque o destaque ou o perfil falhou.
  let runningAll = false;
  let visualState = 'idle';
  let clockId = null;
  const VERSION = 139;
  const defaultProgress = () => ({ version: VERSION, bio: false, photo: false, photoSent: false,
    story: 'none', mediaId: '', highlight: false, highlightError: '', elapsedMs: null, updatedAt: Date.now() });

  function setButtonState(state, title, detail = '') {
    visualState = state;
    btn.dataset.state = state;
    if (state !== 'error') btn.removeAttribute('title');
    mainText.textContent = title;
    sub.textContent = detail;
    sub.style.display = detail ? '' : 'none';
    statusIcon.textContent = ({idle:'📤',running:'⏳',success:'✅',warning:'⚠️',error:'❌'})[state] || '📤';
    btn.disabled = state === 'running';
    btn.setAttribute('aria-busy', String(state === 'running'));
  }
  function seconds(ms) {
    return (ms / 1000).toFixed(2).replace('.', ',') + 's';
  }
  function stopClock() {
    if (clockId) clearInterval(clockId);
    clockId = null;
  }
  function startClock(startedAt) {
    stopClock();
    clockId = setInterval(() => {
      if (visualState === 'running') sub.textContent = `Aguarde · ${seconds(Date.now() - startedAt)}`;
    }, 250);
  }
  function resultOfProfile(result) {
    const bio = String(result?.bio || '');
    const photo = String(result?.photo || '');
    const photoSent = photo.startsWith('foto selecionada') || photo.startsWith('foto enviada ao seletor');
    return {
      bioOk: bio === 'já estava correta' || bio.startsWith('Salvar acionado') || bio.startsWith('ignorada'),
      photoSent,
      // Aceite do seletor não significa confirmação do Instagram.
      photoConfirmed: photo.startsWith('foto selecionada e confirmação acionada') ||
        photo.includes('miniatura atualizada'),
      bio, photo,
    };
  }
  async function waitForProfileJob(jobId) {
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 800));
      const status = await ask({ type: 'profileEditStatus' });
      if (!status?.ok) continue;
      if (status.jobId !== jobId) throw new Error('Outra edição foi iniciada. Story não publicado.');
      if (status.status === 'complete') return status.results || {};
      if (status.status === 'aborted') throw new Error(status.error || 'Edição interrompida.');
    }
    throw new Error('Tempo esgotado na edição. Nenhum Story novo foi iniciado.');
  }
  function workflowKey(accountId) {
    // userId vem da sessão viva, sem expor sessionid nem token.
    return `extensionsIG.avl.progress.v128.${String(accountId)}`;
  }
  async function accountAndRecord() {
    const config = await ask({ type: 'getStoryConfig' });
    if (config?.ok) lastConfig = config;
    const live = await ask({ type: 'liveSession' });
    if (!live?.hasSession || !live.userId) throw new Error('Entre na conta do Instagram para continuar.');
    const key = workflowKey(live.userId);
    const stored = (await chrome.storage.local.get(key))[key];
    // Reaproveita progresso da v1.28 para nunca repostar um Story já confirmado.
    // Preserve histórico da v1.29 e da v1.28: não republicar após atualização.
    const old = stored && [128, 129, 130, 131, 132, 133, 137, 138, VERSION].includes(stored.version) ? stored : null;
    return { key, userId: live.userId, progress: old ? { ...defaultProgress(), ...old, version: VERSION } : defaultProgress() };
  }
  async function saveProgress(key, progress) {
    progress.updatedAt = Date.now();
    await chrome.storage.local.set({ [key]: progress });
  }
  async function assertSameAccount(expected) {
    const live = await ask({ type: 'liveSession' });
    if (!live?.hasSession || live.userId !== expected) throw new Error('A conta mudou durante a operação; parei para proteger o perfil.');
  }
  const profileDone = p => Boolean(p.bio && p.photo);
  const highlightNeeded = p => Boolean(lastConfig.highlightTitle) && !p.highlight;
  const fullyDone = p => profileDone(p) && p.story === 'done' && !highlightNeeded(p);

  // Corrige a retomada após recarregar a aba, inclusive para contas diferentes.
  async function restoreButton() {
    if (runningAll) return;
    if (!/^\/accounts\/edit\/?$/.test(location.pathname)) {
      setButtonState('idle', 'Configurar perfil', 'Abra Editar perfil');
      return;
    }
    try {
      const { progress } = await accountAndRecord();
      if (fullyDone(progress)) {
        setButtonState('success', `Perfil configurado (${seconds(progress.elapsedMs || 0)})`);
      } else if (progress.story === 'inflight' || progress.story === 'unknown') {
        setButtonState('warning', 'Verifique o Story', 'Publicação sem confirmação · não repostar');
      } else if (progress.story === 'done' && highlightNeeded(progress)) {
        const explanation = progress.highlightError || 'Story enviado · destaque não confirmado';
        setButtonState('warning', 'Confira o destaque', explanation.slice(0, 85));
        btn.title = explanation;
      } else if (progress.story === 'done' && progress.photoSent && !progress.photo) {
        setButtonState('warning', 'Confira a foto', 'Story já publicado · foto sem confirmação');
      } else if (progress.story === 'done' || progress.bio || progress.photo) {
        setButtonState('error', 'Configuração incompleta', 'Clique para continuar etapas pendentes');
      } else {
        setButtonState('idle', 'Configurar perfil', 'Foto · bio · Story · destaque');
      }
    } catch {
      setButtonState('idle', 'Configurar perfil', 'Foto · bio · Story · destaque');
    }
  }

  async function runAllOnEditPage() {
    if (runningAll) return { ok: false, error: 'Já existe uma configuração em andamento.' };
    if (!/^\/accounts\/edit\/?$/.test(location.pathname)) {
      toast('err', 'Abra Editar perfil antes de clicar.');
      return { ok: false, error: 'Abra Editar perfil.' };
    }
    runningAll = true;
    const startedAt = Date.now();
    let key, progress, userId;
    try {
      ({ key, progress, userId } = await accountAndRecord());
      if (fullyDone(progress)) {
        setButtonState('success', `Perfil configurado (${seconds(progress.elapsedMs || 0)})`);
        return { ok: true, alreadyDone: true };
      }
      if (progress.story === 'inflight' || progress.story === 'unknown') {
        // Nunca agir no escuro. Confirmação explícita do operador para permitir
        // uma nova publicação após falha/recarregamento em momento incerto.
        const checked = confirm('A última publicação ficou sem confirmação.\n\nSe o Story EXISTE, clique CANCELAR e coloque-o no destaque pelo Instagram; não publique de novo.\n\nSomente se você verificou que o Story NÃO existe, clique OK para tentar publicá-lo.');
        if (!checked) {
          setButtonState('warning', 'Verifique o Story', 'Não republique sem conferir');
          return { ok: false, error: 'Publicação anterior precisa ser verificada.' };
        }
        progress.story = 'none';
        progress.mediaId = '';
        await saveProgress(key, progress);
      }
      setButtonState('idle', 'Configurar perfil', 'Retomando as etapas pendentes…');
      setButtonState('running', 'Configurando perfil…', 'Iniciando');
      startClock(startedAt);
      await assertSameAccount(userId);
      if (!profileDone(progress)) {
        setButtonState('running', 'Configurando foto e bio…', 'Aguarde o Instagram carregar');
        const started = await ask({ type: 'startProfileEditHere', pageUrl: location.href,
          skipBio: progress.bio, skipPhoto: progress.photo });
        if (!started?.ok || !started.jobId) throw new Error(started?.error || 'Editor não respondeu.');
        const results = await waitForProfileJob(started.jobId);
        const check = resultOfProfile(results);
        if (!progress.bio) progress.bio = check.bioOk;
        if (!progress.photo) progress.photo = check.photoConfirmed;
        if (check.photoSent) progress.photoSent = true;
        await saveProgress(key, progress);
        // Bloqueia a publicação se não houve entrega da foto ao seletor;
        // não a bloqueia somente porque a miniatura do Instagram demorou.
        if (!progress.bio || (!progress.photo && !progress.photoSent)) {
          throw new Error(`Edição incompleta: ${!progress.bio ? 'bio' : 'foto não enviada'}. Story não publicado.`);
        }
      }
      await assertSameAccount(userId);
      if (progress.story !== 'done' || highlightNeeded(progress)) {
        const pause = await ask({type:'publishingPause'});
        if (pause && !pause.ok) {
          setButtonState('warning', 'Aguarde o Instagram', 'Publicacao pausada para respeitar limite');
          toast('info', 'O Instagram limitou a acao.\nNao tente novamente agora.');
          return {ok:false,pending:true,reason:'ig_pause'};
        }
      }
      if (progress.story !== 'done') {
        setButtonState('running', 'Publicando Story…', 'Aguarde a confirmação');
        progress.story = 'inflight';
        await saveProgress(key, progress);
        const resp = await (pageMode ? publishFromPage() : publishViaBackground());
        if (!resp?.ok) {
          // Se o serviço já confirmou a publicação antes da falha de conexão,
          // recupere o checkpoint e NÃO apague o mediaId nem tente postar de novo.
          const saved = (await chrome.storage.local.get(key))[key];
          if (saved?.story === 'done' && saved?.mediaId) {
            progress = { ...progress, ...saved };
            setButtonState('warning', 'Story já publicado', 'Retome somente o destaque');
            toast('info', 'Story confirmado.\nClique novamente para retomar o destaque.');
            return { ok: false, pending: true, storyDone: true, reason: 'resume_highlight' };
          }
          // Upload recusado antes do configure é seguro repetir; resposta
          // ambígua após a tentativa de publicação nunca é repetida às cegas.
          progress.story = resp?.step === 'upload' && !resp?.paused ? 'none' : 'unknown';
          await saveProgress(key, progress);
          if (/publicaç[aã]o em andamento/i.test(String(resp?.error || ''))) {
            setButtonState('warning', 'Publicação em andamento', 'Aguarde e confira o Story');
            toast('info', 'Outra publicação está ativa.\nAguarde e confira o Instagram.');
            return { ok: false, pending: true, reason: 'publish_busy' };
          }
          throw new Error(`Story não confirmado: ${resp?.error || 'sem resposta'}`);
        }
        progress.story = 'done';
        progress.mediaId = String(resp.mediaId || '');
        if (highlightNeeded(progress)) {
          // Na v1.32 o Story NÃO tenta criar destaque no próprio post: salvamos
          // o ID e seguimos abaixo para criar o destaque separadamente.
          progress.highlightAttempted = Boolean(resp.highlight);
          progress.highlight = Boolean(resp.highlight?.ok);
        } else progress.highlight = true;
        await saveProgress(key, progress);
        // Compatibilidade com resultados antigos que já tentavam destacar.
        if (highlightNeeded(progress) && progress.highlightAttempted) {
          setButtonState('warning', 'Confira o destaque', 'Story publicado · sem confirmação do destaque');
          toast('info', 'Story publicado.\nConfira se o destaque apareceu.');
          return { ok: false, pending: true, storyDone: true, reason: 'highlight_unconfirmed' };
        }
      }
      // Quando só o destaque falhar, NUNCA publicar novo Story.
      if (highlightNeeded(progress)) {
        if (!progress.mediaId) throw new Error('Story publicado, mas o ID não foi retornado. Confira o destaque; não republique.');
        if (progress.highlightAttempted) {
          const checked = confirm('O Instagram não confirmou o destaque anterior. Verifique se ele já existe.\n\nVocê conferiu e tem certeza de que o destaque ainda NÃO foi criado?');
          if (!checked) {
            setButtonState('warning', 'Confira o destaque', 'Nenhuma publicação foi repetida');
            return { ok: false, pending: true, reason: 'highlight_needs_check' };
          }
        }
        progress.highlightAttempted = true;
        await saveProgress(key, progress);
        setButtonState('running', 'Criando destaque…', 'Story já publicado · não será repetido');
        const hl = await ask({ type: 'highlightLive', mediaId: progress.mediaId, title: lastConfig.highlightTitle });
        if (!hl?.ok) {
          // Story já foi confirmado: registrar a falha do DESTAQUE sem refazer o Story.
          const elapsed = Number.isFinite(hl?.durationMs) ? ` [${(hl.durationMs/1000).toFixed(1)}s]` : '';
          const explanation = (String(hl?.error || 'Destaque não confirmado pelo Instagram') + elapsed).slice(0, 280);
          progress.highlightError = explanation;
          await saveProgress(key, progress);
          setButtonState('warning', 'Confira o destaque', explanation.slice(0, 85));
          btn.title = explanation;
          toast('info', 'Story publicado.\nDestaque sem confirmação.');
          void startProfessionalConversion();
          return { ok: false, pending: true, storyDone: true, reason: 'highlight_unconfirmed', highlightError: explanation };
        }
        progress.highlight = true;
        progress.highlightError = '';
        await saveProgress(key, progress);
      }
      await assertSameAccount(userId);
      const elapsedMs = Date.now() - startedAt;
      progress.elapsedMs = elapsedMs;
      await saveProgress(key, progress);
      if (!progress.photo) {
        setButtonState('warning', 'Confira a foto', 'Story/destaque enviados · foto sem confirmação');
        toast('info', 'Story e destaque concluídos.\nFoto enviada; confira se foi salva.');
        return { ok: false, pending: true, profilePending: true, storyDone: true, elapsedMs };
      }
      setButtonState('success', `Perfil configurado (${seconds(elapsedMs)})`);
      void startProfessionalConversion();
      return { ok: true, elapsedMs };
    } catch (e) {
      const message = String(e?.message || e || 'Erro desconhecido');
      setButtonState('error', 'Erro ao configurar · tentar de novo', message.slice(0, 75));
      btn.title = message;
      toast('err', 'Não foi possível concluir.\n' + message.replace(/\s+/g, ' ').slice(0, 105));
      return { ok: false, error: message };
    } finally {
      stopClock();
      runningAll = false;
    }
  }

  function autoText(element) {
    return String([
      element?.textContent,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' '))
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function professionalText(element) {
    return autoText(element).replace(/[\u200b\u200c\u200d]/g, '');
  }
  function isProfessionalPage() {
    return /^(?:www\.)?instagram\.com$/i.test(location.hostname) &&
      /^\/accounts\/convert_to_professional_account\/?$/.test(location.pathname);
  }
  function visibleControls() {
    return [...document.querySelectorAll('button, [role="button"], [role="radio"], label, a')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.disabled;
      });
  }
  function professionalChoice(pattern) {
    return visibleControls()
      .filter(element => pattern.test(professionalText(element)))
      .sort((a, b) => professionalText(a).length - professionalText(b).length)[0] || null;
  }
  function professionalNext() {
    return professionalChoice(/^(?:avancar|avançar|next|proximo|próximo)$/) ||
      professionalChoice(/\b(?:avancar|avançar|next|proximo|próximo)\b/);
  }
  function profileUrlFromPage() {
    const links = [...document.querySelectorAll('a[href]')]
      .map(anchor => anchor.href)
      .filter(href => /^https:\/\/(?:www\.)?instagram\.com\/[^/?#]+\/?(?:[?#].*)?$/i.test(href))
      .filter(href => !/\/accounts\//i.test(href));
    return links[0] || 'https://www.instagram.com/';
  }
  async function waitProfessional(find, label, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = find();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw new Error(`Não encontrei ${label}.`);
  }
  async function finishProfessionalConversion() {
    if (sessionStorage.getItem(PROFESSIONAL_FLOW_KEY) !== 'pending') return;
    const changeButton = professionalChoice(/^mudar$|^change$/);
    if (changeButton) {
      changeButton.click();
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    const creator = await waitProfessional(
      () => professionalChoice(/criador de conteudo|content creator/),
      'a opção “Criador de conteúdo”',
    );
    creator.click();
    (await waitProfessional(professionalNext, 'o primeiro botão Avançar')).click();
    await new Promise(resolve => setTimeout(resolve, 700));
    (await waitProfessional(professionalNext, 'o segundo botão Avançar')).click();
    await new Promise(resolve => setTimeout(resolve, 700));
    const personalBlog = await waitProfessional(
      () => professionalChoice(/blog pessoal|personal blog/),
      'a opção “Blog pessoal”',
    );
    personalBlog.click();
    await new Promise(resolve => setTimeout(resolve, 500));
    const finishButton = await waitProfessional(
      () => professionalChoice(/^concluir$|^finish$|^done$/),
      'o botão azul “Concluir”',
    );
    finishButton.click();
    await new Promise(resolve => setTimeout(resolve, 900));
    const continueButton = await waitProfessional(
      () => professionalChoice(/^continuar$|\bcontinuar\b|continue/),
      'o botão “Continuar”',
    );
    continueButton.click();
    sessionStorage.removeItem(PROFESSIONAL_FLOW_KEY);
    await new Promise(resolve => setTimeout(resolve, 1200));
    location.assign(sessionStorage.getItem('extensionsIG.avl.returnProfile') || 'https://www.instagram.com/');
  }
  async function startProfessionalConversion() {
    if (sessionStorage.getItem(PROFESSIONAL_FLOW_KEY) === 'pending') return;
    sessionStorage.setItem(PROFESSIONAL_FLOW_KEY, 'pending');
    sessionStorage.setItem('extensionsIG.avl.returnProfile', profileUrlFromPage());
    location.assign(PROFESSIONAL_URL);
  }
  function isInstagramRoot() {
    return /^(?:www\.)?instagram\.com$/i.test(location.hostname) && /^\/$/.test(location.pathname);
  }
  function isArchivePage() {
    return /^(?:www\.)?instagram\.com$/i.test(location.hostname) &&
      /^\/accounts\/settings\/v2\/archiving_and_downloading\/?$/.test(location.pathname);
  }
  function isEditPage() {
    return /^(?:www\.)?instagram\.com$/i.test(location.hostname) &&
      /^\/accounts\/edit\/?$/.test(location.pathname);
  }
  function archiveControl() {
    const phrase = (element) => {
      const text = autoText(element);
      return /salvar (?:o )?story|salvar stories/.test(text) && /itens arquivados|arquivado/.test(text);
    };
    const direct = [...document.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"], button')]
      .find(phrase);
    if (direct) return direct;
    const row = [...document.querySelectorAll('label, li, section, [role="button"], div')]
      .filter(phrase)
      .sort((a, b) => autoText(a).length - autoText(b).length)[0];
    if (!row) return null;
    return row.querySelector('input[type="checkbox"], [role="switch"], [role="checkbox"], button') ||
      row.closest('label, [role="button"], li') || row;
  }
  function toggleIsOn(control) {
    if (!control) return false;
    const input = control.matches?.('input[type="checkbox"]')
      ? control : control.querySelector?.('input[type="checkbox"]');
    if (input) return Boolean(input.checked);
    const aria = control.getAttribute?.('aria-checked');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    const text = autoText(control);
    return /\b(ativado|ativada|on|enabled)\b/.test(text) &&
      !/\b(desativado|desativada|off|disabled)\b/.test(text);
  }
  async function enableArchivedStories() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const control = archiveControl();
      if (control) {
        const explicitState = Boolean(
          control.matches?.('input[type="checkbox"], [role="switch"], [role="checkbox"]') ||
          control.querySelector?.('input[type="checkbox"], [role="switch"], [role="checkbox"]') ||
          control.hasAttribute?.('aria-checked')
        );
        if (!toggleIsOn(control)) {
          control.click();
          await new Promise(resolve => setTimeout(resolve, 700));
          if (!explicitState) return true;
        }
        const after = archiveControl();
        if (toggleIsOn(after || control) || !after) return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Não encontrei a opção “Salvar story em Itens Arquivados”.');
  }
  async function runAutomaticFlow() {
    try {
      if (isProfessionalPage()) {
        await finishProfessionalConversion();
        return;
      }
      const flow = sessionStorage.getItem(AUTO_FLOW_KEY);
      if (isInstagramRoot()) {
        sessionStorage.setItem(AUTO_FLOW_KEY, 'archive_pending');
        location.replace(ARCHIVE_URL);
        return;
      }
      if (isArchivePage() && flow === 'archive_pending') {
        await enableArchivedStories();
        sessionStorage.setItem(AUTO_FLOW_KEY, 'edit_pending');
        await new Promise(resolve => setTimeout(resolve, 500));
        location.replace(EDIT_PROFILE_URL);
        return;
      }
      if (isEditPage() && flow === 'edit_pending') {
        sessionStorage.setItem(AUTO_FLOW_KEY, 'edit_running');
        await new Promise(resolve => setTimeout(resolve, 1200));
        const result = await runAllOnEditPage();
        if (result?.ok) sessionStorage.setItem(AUTO_FLOW_KEY, 'done');
        else throw new Error(result?.error || 'A configuração automática não foi concluída.');
      }
    } catch (error) {
      sessionStorage.setItem(AUTO_FLOW_KEY, 'error');
      toast('err', 'Fluxo automático interrompido:\n' + String(error?.message || error).slice(0, 180), 12000);
    }
  }
  btn.addEventListener('click', () => { void runAllOnEditPage(); });
  // O botão Fazer tudo do popup reutiliza este MESMO fluxo, sem abrir outra aba.
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'runProfileEditFromPopup') {
      if (!/^\/accounts\/edit\/?$/.test(location.pathname)) {
        respond({ok:false,error:'Abra Editar perfil antes de testar.'});
        return false;
      }
      if (runningAll || profileOnlyRunning) {
        respond({ok:false,error:'Aguarde a operação em andamento.'});
        return false;
      }
      respond({ok:true});
      void runProfileOnlyOnEditPage();
      return false;
    }
    if (msg?.type !== 'runAllOnEditPage') return false;
    if (!/^\/accounts\/edit\/?$/.test(location.pathname)) {
      respond({ ok: false, error: 'Abra Instagram → Editar perfil nesta aba antes de usar Fazer tudo.' });
      return false;
    }
    if (runningAll) {
      respond({ ok: false, error: 'Já há uma execução em andamento nesta aba.' });
      return false;
    }
    respond({ ok: true, info: 'Iniciado na mesma aba. Acompanhe o resultado no Instagram.' });
    void runAllOnEditPage();
    return false;
  });

  refreshConfig();
  void restoreButton();
  // Recupera os botões caso uma transição SPA os remova, sem cliques extras.
  const restoreVisibleControls = () => {
    if (!style.isConnected) document.documentElement.appendChild(style);
    if (!toolbar.isConnected) document.documentElement.appendChild(toolbar);
    updateSignupTools();
  };
  new MutationObserver(restoreVisibleControls).observe(document.documentElement, {childList: true});
  window.addEventListener('pageshow', restoreVisibleControls);
  // Navegação SPA pode trocar de perfil/rota sem recarregar o documento.
  window.addEventListener('focus', () => { restoreVisibleControls(); refreshConfig(); void restoreButton(); });
  let lastPath = location.pathname;
  setInterval(() => {
    restoreVisibleControls();
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      updateSignupTools(); refreshConfig(); void restoreButton(); void runAutomaticFlow();
    }
  }, 650);
  void runAutomaticFlow();
})();
