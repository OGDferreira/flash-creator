// Intercepta SOMENTE a abertura do seletor temporário de foto em Editar perfil.
// Executado no contexto da página para acompanhar inputs criados com JS pelo Instagram.
// Não lê nem altera cookies, credenciais ou requisições; usa o campo nativo do site.
(() => {
  if (window.__storyLocalPhotoHook121) return;
  window.__storyLocalPhotoHook121 = true;
  const ARM='storylocal-121-arm-photo';
  const REPORT='storylocal-121-photo-report';
  let cancelActive=null;
  const report=(id,status,reason='')=>window.dispatchEvent(new CustomEvent(REPORT,{detail:JSON.stringify({id,status,reason})}));
  const looksLikePhotoInput=el=>el instanceof HTMLInputElement && el.type==='file' && (!el.accept || /image|\.jpe?g|\.png|\.webp/i.test(el.accept));
  const fromBase64=base64=>{
    if(typeof base64!=='string'||base64.length<100||base64.length>6*1024*1024) throw Error('Tamanho da foto inválido');
    const raw=atob(base64), bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    return new File([bytes],'perfil-padrao.jpg',{type:'image/jpeg',lastModified:Date.now()});
  };
  window.addEventListener(ARM,event=>{
    // O Instagram pode navegar para Editar perfil sem recarregar a aba (SPA).
    if (!/^\/accounts\/edit\/?$/.test(location.pathname)) return;
    let message;
    try {message=JSON.parse(event.detail);}
    catch {return;}
    if(typeof message?.id!=='string'||message.id.length>100)return;
    if(cancelActive)cancelActive();
    let file;
    try {file=fromBase64(message.base64);}
    catch(e){report(message.id,'error',e.message);return;}
    let active=true;
    const originalClick=HTMLInputElement.prototype.click;
    const originalShowPicker=HTMLInputElement.prototype.showPicker;
    const cleanup=()=>{
      if(!active)return;
      active=false;
      clearTimeout(timeout);
      if(HTMLInputElement.prototype.click===patchedClick)HTMLInputElement.prototype.click=originalClick;
      if(originalShowPicker&&HTMLInputElement.prototype.showPicker===patchedPicker)HTMLInputElement.prototype.showPicker=originalShowPicker;
      document.removeEventListener('click',onClickCapture,true);
      if(cancelActive===cleanup)cancelActive=null;
    };
    const attach=(input)=>{
      if(!active||!looksLikePhotoInput(input))return false;
      try {
        const transfer=new DataTransfer(); transfer.items.add(file);
        input.files=transfer.files;
        if(input.files?.length!==1)throw Error('O navegador não aceitou o arquivo');
        cleanup();
        // Esperar o handler de upload do Instagram estar conectado após abrir o seletor.
        queueMicrotask(()=>{
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
          report(message.id,'attached');
        });
        return true;
      } catch(e){cleanup();report(message.id,'error',e.message);return false;}
    };
    function patchedClick(...args){
      if(looksLikePhotoInput(this)&&active){attach(this);return;}
      return Reflect.apply(originalClick,this,args);
    }
    function patchedPicker(...args){
      if(looksLikePhotoInput(this)&&active){attach(this);return;}
      return Reflect.apply(originalShowPicker,this,args);
    }
    // Segunda via: input presente na página acionado por um label ou por evento nativo.
    function onClickCapture(e){
      const target=e.target;
      if(active&&looksLikePhotoInput(target)){
        e.preventDefault();
        if(attach(target))e.stopImmediatePropagation();
      }
    }
    HTMLInputElement.prototype.click=patchedClick;
    if(originalShowPicker)HTMLInputElement.prototype.showPicker=patchedPicker;
    document.addEventListener('click',onClickCapture,true);
    const timeout=setTimeout(()=>{cleanup();report(message.id,'timeout');},10000);
    cancelActive=cleanup;
    report(message.id,'armed');
  });
})();
