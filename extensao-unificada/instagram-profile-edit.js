// Perfil pela interface normal do Instagram. Sem requisições diretas, sem alterar cookies.
// A extensão só executa a tarefa na aba que ela própria criou para esta conta.
(() => {
  if (window.__storyLocalProfileEditor) return;
  window.__storyLocalProfileEditor = true;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const textOf = el => normalize([el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'), el?.getAttribute?.('value')].filter(Boolean).join(' '));
  const visible = el => Boolean(el && el.isConnected && !el.disabled && el.getClientRects().length);
  const bioLabel = /\b(bio|biography|biografia|biographie)\b/;
  const confirmLabel = /^(confirmar|confirm|apply|aplicar|save|salvar|done|concluir|enviar|submit|guardar|ok|next|avancar)$/;
  const photoLabel = /(alterar foto|trocar foto|mudar foto|editar foto|alterar imagem|foto do perfil|foto de perfil|imagem do perfil|change photo|change profile photo|change profile picture|edit photo|edit profile photo|edit picture|profile picture|edit picture or avatar|editar imagem ou avatar)/;
  const uploadLabel = /^(carregar foto|carregar imagem|enviar foto|upload photo|upload picture|upload a photo|choose photo|escolher foto|selecionar foto|importar foto|importar imagem)$/;

  function ask(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response || {ok:false, error:'A extensão não respondeu'});
      });
    });
  }

  async function waitFor(check, ms=12000) {
    const start=Date.now();
    while (Date.now()-start<ms) {
      const found=check();
      if (found) return found;
      await delay(220);
    }
    return null;
  }

  function buttons(root=document) {
    return [...root.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter(el => visible(el) && !el.closest('#storylocal-edit-progress'));
  }
  function labelOf(el) {
    if (el.labels?.length) return [...el.labels].map(l=>l.textContent).join(' ');
    const id=el.id;
    const labeled=id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return labeled?.textContent || el.closest('label')?.textContent || '';
  }
  function fieldInfo(el) {
    const nearby=el.parentElement?.parentElement;
    return normalize([el.name,el.id,el.getAttribute('aria-label'),el.placeholder,labelOf(el),nearby?.textContent?.slice(0,100)].filter(Boolean).join(' '));
  }
  function findBio() {
    const nodes=[...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')]
      .filter(el => visible(el) && !el.closest('#storylocal-edit-progress'));
    const explicit=nodes.filter(el => bioLabel.test(fieldInfo(el)));
    if (explicit.length===1) return explicit[0];
    if (explicit.length>1) {
      const text=explicit.filter(el=>el.tagName==='TEXTAREA');
      return text.length===1 ? text[0]:null;
    }
    // Usar único textarea da tela de edição é seguro; nunca escolher entre múltiplos.
    if (/\/accounts\/edit\/?/.test(location.pathname)) {
      const text=nodes.filter(el=>el.tagName==='TEXTAREA');
      if (text.length===1) return text[0];
    }
    return null;
  }
  function getFieldValue(el) { return el?.isContentEditable ? el.textContent : el?.value; }
  function changeReactField(el,value) {
    if (el.isContentEditable) { el.focus(); el.textContent=value; }
    else {
      const proto=el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if (!setter) throw new Error('Campo de biografia não é editável');
      setter.call(el,value); el.focus();
    }
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.blur();
  }
  function findSave(bio) {
    const inside=bio?.closest('form');
    const order=inside ? [inside,document] : [document];
    for (const root of order) {
      const exact=buttons(root).filter(b=>confirmLabel.test(normalize(b.getAttribute('aria-label')||b.value||b.textContent)));
      if (exact.length===1) return exact[0];
      const formSubmits=buttons(root).filter(b=>b.tagName==='INPUT' && b.type==='submit' || b.tagName==='BUTTON' && b.type==='submit');
      if (formSubmits.length===1) return formSubmits[0];
    }
    return null;
  }
  function imageInputs() {
    return [...document.querySelectorAll('input[type="file"]')].filter(el => !el.accept || /image|\.png|\.jpe?g/i.test(el.accept));
  }
  function findPhotoInput() {
    const inputs=imageInputs();
    if (inputs.length===1) return inputs[0];
    if (!inputs.length) return null;
    const named=inputs.filter(el=>/(avatar|profile|photo|foto|picture)/.test(fieldInfo(el)));
    return named.length===1 ? named[0] : null;
  }
  function findPhotoButton() {
    return buttons().find(b=>photoLabel.test(textOf(b)) && !/remove|remover|excluir|delete/.test(textOf(b)))||null;
  }
  function findUploadOption() {
    const controls=[...document.querySelectorAll('button, [role="button"], label')].filter(visible);
    const matches=controls.filter(el=>uploadLabel.test(textOf(el)));
    return matches.length===1 ? matches[0] : null;
  }
  function makeFile(base64) {
    const raw=atob(base64), bytes=new Uint8Array(raw.length);
    for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    if (!bytes.length || bytes.length>4*1024*1024) throw new Error('Imagem embutida inválida ou grande demais');
    return new File([bytes], 'perfil-padrao.jpg', {type:'image/jpeg',lastModified:Date.now()});
  }
  function setInputFile(el,file) {
    const data=new DataTransfer(); data.items.add(file);
    el.files=data.files;
    if (el.files.length!==1) throw new Error('Seleção de arquivo foi recusada');
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  // Uma mudança efetiva na miniatura permite evitar esperar 11 s por um diálogo
  // que não aparece nessa versão da interface. Nunca confundir o seletor com o save.
  function profilePicture() {
    const button = findPhotoButton();
    if (!button) return null;
    let container = button.parentElement;
    for (let depth = 0; depth < 4 && container; depth++, container = container.parentElement) {
      const imgs = [...container.querySelectorAll('img')].filter(visible);
      if (imgs.length === 1) return imgs[0];
    }
    return null;
  }
  async function waitForPhotoConfirmation(previousAvatar = '') {
    const start = Date.now();
    let changedAt = null;
    while (Date.now() - start < 11000) {
      const confirm = findPhotoConfirm();
      if (confirm) return { confirm };
      const avatar = profilePicture();
      const nowSrc = avatar?.currentSrc || avatar?.src || '';
      // Aguarda 1.2 s depois da atualização visual para dar chance a um popup.
      // Uma conta sem foto começa com avatar genérico (sem <img> válido).
      // A foto nova conta como mudança mesmo quando previousAvatar é vazio.
      if (nowSrc && nowSrc !== previousAvatar && avatar.complete && avatar.naturalWidth > 0) {
        if (changedAt === null) changedAt = Date.now();
        if (Date.now() - changedAt >= 1200) return { avatarUpdated: true };
      }
      await delay(180);
    }
    return {};
  }

  function findPhotoConfirm() {
    // Confirmar SOMENTE em diálogo de foto. Não clicar em botões genéricos da página.
    const dialogs=[...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible);
    for (const d of dialogs) {
      const matches=buttons(d).filter(b=>confirmLabel.test(normalize(b.textContent||b.getAttribute('aria-label'))));
      if (matches.length===1) return matches[0];
    }
    return null;
  }
  function makePanel() {
    // Aviso curto, 2 linhas e 3 segundos. O botão azul já mostra o progresso.
    let holder = null;
    function show(title, detail) {
      if (!holder) {
        holder = document.createElement('div');
        holder.id = 'storylocal-edit-progress';
        holder.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(290px,calc(100vw - 32px));background:#182633;color:white;padding:9px 12px;border-radius:9px;box-shadow:0 6px 20px #0007;font:12px/1.45 system-ui,sans-serif;white-space:pre-line;';
        document.documentElement.appendChild(holder);
      }
      holder.textContent = `${title}\n${detail}`;
      clearTimeout(holder._remove);
      holder._remove = setTimeout(() => { holder?.remove(); holder = null; }, 3000);
    }
    return {
      // Nada de avisos longos durante a operação: o botão principal informa.
      note(_text) {},
      finish(text) { show(text, text === 'Edição incompleta' ? 'Veja o botão vermelho para tentar novamente.' : 'Confira as alterações no perfil.'); },
    };
  }

  async function applyBio(bio,ui) {
    if (!bio) return 'ignorada (bio vazia)';
    ui.note('Procurando o campo da biografia…');
    const input=await waitFor(findBio,25000);
    if (!input) return 'campo de bio não identificado';
    if (getFieldValue(input)===bio) return 'já estava correta';
    changeReactField(input,bio);
    await delay(400);
    const save=await waitFor(()=>findSave(input),10000);
    if (!save) return 'preenchida, mas Salvar não identificado';
    save.click();
    await delay(1200);
    // Não afirmar que o servidor aceitou sem ter confirmação explícita.
    return 'Salvar acionado — confira no perfil';
  }

  // Arma a captura na página real antes de clicar em Mudar foto. O Instagram às
  // vezes cria <input type=file> fora do DOM e chama .click() diretamente.
  function armTemporaryPhoto(base64) {
    const id='photo-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const eventName='storylocal-121-photo-report';
    const statuses=[];
    let onReport;
    let notify;
    const promise=new Promise(resolve=>{notify=resolve;});
    onReport=e=>{
      let data;
      try {data=JSON.parse(e.detail);}catch{return;}
      if(data?.id!==id)return;
      statuses.push(data);
      if(['attached','timeout','error'].includes(data.status)) {
        window.removeEventListener(eventName,onReport);
        notify(data);
      }
    };
    window.addEventListener(eventName,onReport);
    window.dispatchEvent(new CustomEvent('storylocal-121-arm-photo',{
      detail:JSON.stringify({id,base64})
    }));
    return {
      armed:statuses.some(s=>s.status==='armed'),
      completion:promise,
      cancel(){window.removeEventListener(eventName,onReport);}
    };
  }
  async function applyPhoto(base64,ui) {
    ui.note('Procurando o seletor da foto no Instagram…');
    const previousAvatar = profilePicture()?.currentSrc || profilePicture()?.src || '';
    let fileInput=await waitFor(findPhotoInput,1200);
    if(fileInput) {
      setInputFile(fileInput,makeFile(base64));
    } else {
      const change=await waitFor(findPhotoButton,22000);
      if(!change)return 'botão Mudar foto não identificado';
      // Preparar o seletor criado temporariamente antes de clicar no botão.
      const hook=armTemporaryPhoto(base64);
      if(!hook.armed) {
        hook.cancel();
        return 'seletor automático não carregou; não abri a janela de arquivos';
      }
      ui.note('Selecionando a foto fixa pelo botão Mudar foto…');
      change.click();
      let result=await Promise.race([
        hook.completion,
        new Promise(resolve=>setTimeout(()=>resolve({status:'waiting'}),2000))
      ]);
      if(result.status==='waiting') {
        // Algumas versões primeiro abrem um menu "Carregar foto".
        const option=await waitFor(findUploadOption,5500);
        if(option){
          option.click();
        }
        result=await Promise.race([
          hook.completion,
          new Promise(resolve=>setTimeout(()=>resolve({status:'waiting'}),5500))
        ]);
      }
      if(result.status!=='attached') {
        fileInput=findPhotoInput();
        if(fileInput) {
          setInputFile(fileInput,makeFile(base64));
        } else {
          hook.cancel();
          return result.status==='error'?'erro no seletor: '+result.reason
            :'o Instagram não disponibilizou o seletor automático; foto não alterada';
        }
      }
      hook.cancel();
    }
    ui.note('Foto entregue ao Instagram. Verificando se há confirmação…');
    const completion = await waitForPhotoConfirmation(previousAvatar);
    if (completion.confirm) {
      completion.confirm.click();
      await delay(1100);
      return 'foto selecionada e confirmação acionada — confira no perfil';
    }
    if (completion.avatarUpdated) return 'foto enviada ao seletor; miniatura atualizada — confira no perfil';
    return 'foto enviada ao seletor — confira se o Instagram salvou';
  }
  async function run(job,ui) {
    const r={bio:'não tentada',photo:'não tentada'};
    try {r.bio=job.skipBio ? 'ignorada (já concluída)' : await applyBio(job.bio,ui);} catch(e){r.bio='erro: '+e.message;}
    try {r.photo=job.skipPhoto ? 'ignorada (já concluída)' : await applyPhoto(job.imageBase64,ui);} catch(e){r.photo='erro: '+e.message;}
    const ok = !/(erro|não identificado|não alterada|não disponibilizou|não carregou|não confirmado|preenchida, mas)/i.test(r.bio+' '+r.photo);
    ui.finish(ok ? 'Foto e bio processadas' : 'Edição incompleta');
    return r;
  }

  let inlineRunning = false;
  async function processInline() {
    if (inlineRunning || !/^\/accounts\/edit\/?$/.test(location.pathname)) return;
    inlineRunning = true;
    try {
      const claim = await ask({type:'claimProfileEdit'});
      if (!claim?.ok) return;
      const ui = makePanel();
      const result = await run(claim,ui);
      try { await ask({type:'completeProfileEdit',jobId:claim.jobId,...result}); }
      catch(e) { ui.note('Não foi possível registrar o resultado: '+e.message); }
    } finally { inlineRunning = false; }
  }

  // Somente um clique explícito no botão roxo cria a tarefa que habilita isto.
  chrome.runtime.onMessage.addListener((message,_sender,reply) => {
    if (message?.type !== 'runProfileEditHere') return false;
    if (!/^\/accounts\/edit\/?$/.test(location.pathname)) {
      reply({ok:false,error:'Aba atual não é Editar perfil.'});
      return false;
    }
    if (inlineRunning) {
      reply({ok:false,error:'Edição em andamento. Aguarde terminar.'});
      return false;
    }
    reply({ok:true});
    void processInline().catch(()=>{inlineRunning=false;});
    return false;
  });

  (async()=>{
    let claim=null;
    for(let i=0;i<8;i++){
      claim=await ask({type:'claimProfileEdit'});
      if(claim?.ok || (claim?.error&&!claim?.skipped))break;
      await delay(350);
    }
    if(!claim?.ok)return;
    const ui=makePanel();
    const result=await run(claim,ui);
    try {await ask({type:'completeProfileEdit',jobId:claim.jobId,...result});}
    catch(e){ui.note('Não foi possível registrar o resultado: '+e.message);}
  })().catch(()=>{});
})();
