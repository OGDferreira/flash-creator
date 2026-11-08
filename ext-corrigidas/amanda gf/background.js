// extensionsIG.avl: operacoes na conta ja logada. Nao altera, apaga,
// exporta ou importa cookies. Publicacao e destaque usam rotas nao oficiais
// do Instagram e podem ser recusados. Respeita limites e evita repeticao
// quando a confirmacao da publicacao e incerta.

import {
  HIGHLIGHT_CREATE_URL,
  LINK_STICKER_LAYOUT,
  IG_APP_ID,
  UPLOAD_HOST,
  WEB_UPLOAD_HOST,
  buildStoryRequest,
  highlightBody,
  configureCandidates,
  isAccountVerdict,
  looksLikeHtml,
  uploadCandidates,
} from './story-payload.js';

const IG_ORIGIN = 'https://www.instagram.com';

/** Onde a config de story (mídia + link) fica, compartilhada entre painel e aba. */
const STORY_CONFIG_KEY = 'storyConfigAmandaV3';
const PROFILE_PHOTO_KEY = 'profilePhotoConfigAmandaV2';
// Lembra só qual endereço de upload/publicação funcionou (não guarda cookies).
// Se o Instagram mudar o endereço, os demais continuam disponíveis como fallback.
const WORKING_ROUTES_KEY = 'storyWorkingRoutesV124';
const ROUTE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
async function preferredRoutes() {
  const entry = (await chrome.storage.local.get(WORKING_ROUTES_KEY))[WORKING_ROUTES_KEY];
  if (!entry || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > ROUTE_CACHE_TTL) return {};
  return {
    uploadIndex: Number.isInteger(entry.uploadIndex) ? entry.uploadIndex : -1,
    configureIndex: Number.isInteger(entry.configureIndex) ? entry.configureIndex : -1,
  };
}
async function rememberRoutes(uploadIndex, configureIndex) {
  try {
    await chrome.storage.local.set({ [WORKING_ROUTES_KEY]: { uploadIndex, configureIndex, savedAt: Date.now() } });
  } catch { /* cache opcional: não comprometer a publicação */ }
}
function candidateOrder(length, preferred) {
  const indices = Array.from({ length }, (_, i) => i);
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < length) {
    return [preferred, ...indices.filter(i => i !== preferred)];
  }
  return indices;
}

// Padrões incluídos na instalação; nada precisa ser configurado manualmente.
const PRESET_BIO = '21 | BR';
const PRESET_LINK = Object.freeze({ url: 'https://t.me/amandagfbot?start=init', title: 'CLICA AQUI 🎁🔞' });
const PRESET_HIGHLIGHT = '🎁🔞';
const bundledImages = new Map();

async function bundledImageBase64(filename) {
  if (!bundledImages.has(filename)) {
    bundledImages.set(filename, (async () => {
      const response = await fetch(chrome.runtime.getURL(filename));
      if (!response.ok) throw new Error(`Mídia padrão não encontrada: ${filename}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Uint8Array pode exceder limite de argumentos do btoa; faça em partes.
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      }
      return btoa(binary);
    })());
  }
  return bundledImages.get(filename);
}

function mergedConfig(saved = {}) {
  return {
    ...saved,
    link: saved.link === undefined ? { ...PRESET_LINK } : saved.link,
    linkLayout: saved.linkLayout ?? LINK_STICKER_LAYOUT,
    highlightTitle: saved.highlightTitle === undefined ? PRESET_HIGHLIGHT : saved.highlightTitle,
    bio: saved.bio === undefined ? PRESET_BIO : saved.bio,
  };
}

async function liveStoryConfig() {
  const result = await chrome.storage.local.get(STORY_CONFIG_KEY);
  const config = mergedConfig(result[STORY_CONFIG_KEY] || {});
  if (!config.imageBase64) {
    config.imageBase64 = await bundledImageBase64('story-pronto.jpg');
  }
  return config;
}


// O botao principal somente LE os sinais da sessao existente. Nunca grava,
// remove, exporta ou importa cookies e nunca troca a conta logada.
async function liveCookie(name) {
  for (const url of ['https://www.instagram.com/', 'https://i.instagram.com/']) {
    try {
      const cookie = await chrome.cookies.get({ url, name });
      if (cookie?.value) return cookie.value;
    } catch { /* apenas leitura; pode nao haver cookie neste host */ }
  }
  return '';
}
async function readLiveSession() {
  const userId = await liveCookie('ds_user_id');
  const sessionid = await liveCookie('sessionid');
  return { ok: true, userId: userId || undefined, hasSession: Boolean(userId && sessionid) };
}
async function handleLiveSession() { return readLiveSession(); }

// Pausa por conta APOS resposta explicita de limite/verificacao do Instagram.
// Nao varia IP, cabecalhos ou identidade para contornar bloqueios.
const ACTION_PAUSE_PREFIX = 'extensionsIG.avl.actionPause.';
const LIMITS = { rate: 30*60*1000, blocked: 60*60*1000, challenge: 60*60*1000 };
function restrictionKind(status, data) {
  const msg = String(data?.message || data?.error_type || data?.error || '').toLowerCase();
  if (/checkpoint|challenge/.test(msg)) return 'challenge';
  if (/feedback_required|spam|temporarily_blocked|action_blocked/.test(msg)) return 'blocked';
  if (status === 429 || /rate_limit|too many requests|please wait/.test(msg)) return 'rate';
  if (status === 403) return 'blocked';
  return '';
}
async function getPublishingPause() {
  const userId = await liveCookie('ds_user_id');
  if (!userId) return {ok: false, error: 'Entre no Instagram antes de publicar.'};
  const item = (await chrome.storage.local.get(ACTION_PAUSE_PREFIX+userId))[ACTION_PAUSE_PREFIX+userId];
  const remainingMs = Number(item?.until || 0) - Date.now();
  if (remainingMs > 0) {
    const minutes = Math.max(1, Math.ceil(remainingMs/60000));
    return {ok: false, paused: true, remainingMs, error: `O Instagram recusou uma acao. Aguarde cerca de ${minutes} min antes de tentar novamente.`};
  }
  return {ok: true};
}
async function notePublishingResponse(status, data) {
  const kind = restrictionKind(status, data);
  if (!kind) return {ok: true, blocked: false};
  const userId = await liveCookie('ds_user_id');
  if (!userId) return {ok: false, blocked: true};
  const key = ACTION_PAUSE_PREFIX+userId;
  const prev = (await chrome.storage.local.get(key))[key];
  const until = Math.max(Date.now()+LIMITS[kind], Number(prev?.until || 0));
  await chrome.storage.local.set({[key]:{until,kind,updatedAt:Date.now()}});
  return {ok: false, blocked: true, until, kind};
}

// ───────────────────────────────────────────────── postar story

/** base64 → bytes crus. O JPEG viaja como texto porque a ponte é JSON. */
function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Lê a resposta como JSON; se não for JSON, devolve o texto para o erro. */
async function readReply(response) {
  const text = await response.text();
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

/** Mensagem legível a partir do que o Instagram devolveu. */
function replyError(response, data, text, url) {
  const message = data && (data.message || data.error_type);
  if (message === 'checkpoint_required') {
    return 'Instagram pediu verificação (checkpoint) nesta conta. Resolva o desafio no app e tente de novo.';
  }
  if (message === 'login_required') {
    return 'Sessão expirada — faça login de novo nesta conta.';
  }
  if (message === 'feedback_required') {
    return 'Instagram bloqueou a ação (feedback_required) — a conta está limitada.';
  }
  if (message) return String(message);
  // HTML no lugar de JSON = rota que não existe nesse host. Dizer isto evita o
  // diagnóstico errado de "sessão expirada" (a página de 404 vem com a classe
  // `not-logged-in` mesmo numa aba logada).
  if (looksLikeHtml(text)) {
    return (
      `HTTP ${response.status} com página HTML no lugar de JSON` +
      `${url ? ` em ${url}` : ''} — essa rota não existe nesse host.`
    );
  }
  return `HTTP ${response.status}: ${String(text).slice(0, 200) || 'resposta vazia'}`;
}

/**
 * Sobe os bytes numa rota candidata.
 *
 * `retriable` separa "a rota está errada" de "a conta está barrada": 404 ou HTML
 * é endereço, e vale tentar o próximo candidato; `login_required`,
 * `feedback_required` e afins são a sessão, e repetir em três hosts só repete a
 * mesma recusa — e cada repetição é mais uma batida registrada na conta.
 */
async function uploadBytes(candidate, bytes, appId) {
  let reply;
  try {
    reply = await fetch(candidate.url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'content-type': 'image/jpeg',
        offset: '0',
        'x-entity-length': String(bytes.length),
        'x-entity-name': candidate.entityName,
        'x-entity-type': 'image/jpeg',
        'x-ig-app-id': appId,
        'x-instagram-rupload-params': candidate.ruploadParams,
      },
      body: bytes,
    });
  } catch (cause) {
    return { ok: false, retriable: false, error: `falha de rede: ${cause.message}` };
  }
  const { data, text } = await readReply(reply);
  if (!reply.ok || !data || data.status === 'fail') {
    await notePublishingResponse(reply.status, data);
    return {
      ok: false,
      // So tentar um segundo endereco se a rota claramente nao existe.
      retriable: [404,405].includes(reply.status) && looksLikeHtml(text),
      status: reply.status,
      error: replyError(reply, data, text, candidate.url),
    };
  }
  return { ok: true };
}

/** Tenta os candidatos em ordem; devolve o que aceitou ou o relato de cada recusa. */
async function uploadFirstThatAccepts(candidates, bytes, appId, preferredIndex = -1) {
  const recusas = [];
  for (const index of candidateOrder(candidates.length, preferredIndex).slice(0, 2)) {
    const candidate = candidates[index];
    const attempt = await uploadBytes(candidate, bytes, appId);
    if (attempt.ok) return { ok: true, uploadedVia: candidate.url, selectedIndex: index, recusas };
    recusas.push(`${candidate.url} → ${attempt.error}`);
    if (!attempt.retriable) break;
  }
  return { ok: false, recusas };
}

/**
 * O transporte dos dois passos, comum aos dois fluxos. `request` traz URLs,
 * headers e corpos prontos (montados por story-payload.js ou pelo painel); os
 * bytes e o csrftoken vêm à parte. Não decide nada de formato.
 *
 * A sessão que autentica é a que estiver gravada em instagram.com no momento —
 * quem chama garante que é a conta certa (trocando antes, ou usando a viva).
 */
async function postStoryRequest(request, bytes, csrfToken, routePreference = {}) {
  const tUpload = Date.now();
  // ── 1. sobe os bytes (primeira rota que aceitar; o `upload_id` é o mesmo)
  // O fluxo antigo (payload montado no painel) não traz candidatos: monta-os
  // aqui a partir do `upload_id`, para ele ganhar a mesma resiliência de rota.
  const candidates =
    request.uploadCandidates && request.uploadCandidates.length
      ? request.uploadCandidates
      : request.uploadId
        ? uploadCandidates(String(request.uploadId), UPLOAD_HOST)
        : [
            {
              url: request.uploadUrl,
              entityName: request.entityName,
              ruploadParams: request.ruploadParams,
            },
          ];
  const subida = await uploadFirstThatAccepts(candidates, bytes, request.appId, routePreference.uploadIndex);
  const uploadMs = Date.now() - tUpload;
  if (!subida.ok) {
    return {
      ok: false,
      step: 'upload',
      error: `Upload recusado em ${subida.recusas.length} rota(s):\n${subida.recusas.join('\n')}`,
    };
  }

  // ── 2. publica (primeira rota que aceitar o formulário)
  const rotas =
    request.configureCandidates && request.configureCandidates.length
      ? request.configureCandidates
      : [{ url: request.configureUrl, body: request.configureBody, flavor: 'web' }];
  const tConfigure = Date.now();
  const publicacao = await configureFirstThatPublishes(rotas, csrfToken, request.appId, routePreference.configureIndex);
  const configureMs = Date.now() - tConfigure;
  if (!publicacao.ok) {
    return {
      ok: false,
      step: 'configure',
      uploadedVia: subida.uploadedVia,
      error:
        `Imagem subiu em ${subida.uploadedVia}, mas a publicação foi recusada em ` +
        `${publicacao.recusas.length} rota(s):\n${publicacao.recusas.join('\n')}`,
    };
  }
  const data = publicacao.data;
  return {
    ok: true,
    uploadId: request.uploadId,
    uploadedVia: subida.uploadedVia,
    publishedVia: publicacao.publishedVia,
    selectedConfigureIndex: publicacao.selectedIndex,
    mediaId: data.media && data.media.pk ? String(data.media.pk) : undefined,
    // Também nas publicações de sessão viva: sem isto, medir o destaque
    // causava TypeError DEPOIS de o Story já estar publicado.
    timings: { uploadMs, configureMs },
  };
}

/**
 * Manda o formulário numa rota candidata de publicação.
 *
 * Os bytes já estão no servidor: trocar de rota aqui custa só o formulário de
 * novo, com o mesmo `upload_id`. O que encerra a cadeia é veredito de conta.
 */
async function configureStory(candidate, csrfToken, appId) {
  let reply;
  try {
    reply = await fetch(candidate.url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrftoken': csrfToken,
        'x-ig-app-id': appId,
        'x-requested-with': 'XMLHttpRequest',
      },
      body: candidate.body,
    });
  } catch (cause) {
    return { ok: false, retriable: false, error: `falha de rede: ${cause.message}` };
  }
  const { data, text } = await readReply(reply);
  if (!reply.ok || !data || data.status === 'fail') {
    await notePublishingResponse(reply.status, data);
    return {
      ok: false,
      // So tentar um segundo endereco se a rota claramente nao existe.
      retriable: [404,405].includes(reply.status) && looksLikeHtml(text),
      status: reply.status,
      error: replyError(reply, data, text, candidate.url),
    };
  }
  return { ok: true, data };
}

/** Tenta as rotas de publicação em ordem; devolve a que publicou. */
async function configureFirstThatPublishes(candidates, csrfToken, appId, preferredIndex = -1) {
  const recusas = [];
  for (const index of candidateOrder(candidates.length, preferredIndex).slice(0, 2)) {
    const candidate = candidates[index];
    const attempt = await configureStory(candidate, csrfToken, appId);
    if (attempt.ok) return { ok: true, publishedVia: candidate.url, selectedIndex: index, data: attempt.data, recusas };
    recusas.push(`${candidate.url} → ${attempt.error}`);
    if (!attempt.retriable) break;
  }
  return { ok: false, recusas };
}

/**
 * Cria um destaque com o story recém-publicado.
 *
 * O story só entra em `/archive/stories/` quando **expira** (24h) — é assim que
 * o Instagram funciona. Destaque, porém, aceita story **ativo** pelo `media_id`,
 * que o `configure_to_story` acabou de devolver. Por isso publicar e destacar
 * cabem no mesmo clique, sem esperar o arquivo.
 */
async function createHighlight(mediaId, title, csrfToken, dsUserId, appId) {
  const body = highlightBody(mediaId, title, dsUserId, crypto.randomUUID());
  // Sem limite a chamada podia ficar esperando por minutos em proxy/rede lenta.
  // Uma requisição cancelada pode TER SIDO processada pelo Instagram:
  // portanto sempre marcar como incerta e NUNCA reenviar automaticamente.
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeoutId = setTimeout(() => controller.abort(), 35000);
  let reply;
  let parsed;
  try {
    reply = await fetch(HIGHLIGHT_CREATE_URL, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrftoken': csrfToken,
        'x-ig-app-id': appId,
      },
      body,
    });
    parsed = await readReply(reply); // limite cobre também a leitura do corpo da resposta
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      uncertain: true,
      durationMs: Date.now() - startedAt,
      error: timedOut
        ? 'O destaque demorou mais de 35 segundos para responder. Confira no perfil antes de tentar novamente; ele pode ter sido criado.'
        : `Falha de rede ao criar destaque: ${cause.message}. Confira no perfil antes de tentar novamente.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const { data, text } = parsed;
  const durationMs = Date.now() - startedAt;
  if (!reply.ok || !data || data.status === 'fail') {
    await notePublishingResponse(reply.status, data);
    return { ok: false, httpStatus: reply.status, durationMs, uncertain: reply.status >= 500 || (reply.ok && !data),
      error: replyError(reply, data, text, HIGHLIGHT_CREATE_URL) };
  }
  // Um HTTP 200 não é prova de que o destaque ficou salvo. Aceitar a mesma
  // requisição da v1.37, mas distinguir a confirmação da mera recepção.
  const confirmedId = data.reel?.id || data.reel?.pk || data.highlight?.id;
  if (!confirmedId) {
    return { ok: false, uncertain: true, httpStatus: reply.status, durationMs,
      error: 'Instagram respondeu, mas não confirmou o identificador do destaque.' };
  }
  return { ok: true, highlightId: String(confirmedId), durationMs };
}

/**
 * Fluxo novo: publica na sessão QUE JÁ ESTÁ LOGADA nesta aba — nenhum cookie é
 * importado nem trocado. A mídia e o link vêm da config que o painel deixou em
 * chrome.storage; o csrftoken sai da própria sessão viva.
 */
let publishLock = false;
async function handlePublishLive() {
  const pause = await getPublishingPause();
  if (!pause.ok) return {...pause, step: 'upload'};
  if (publishLock) return { ok: false, error: 'Já existe uma publicação em andamento. Não clique novamente.' };
  publishLock = true;
  try {
    return await handlePublishLiveUnlocked();
  } finally {
    publishLock = false;
  }
}

async function handlePublishLiveUnlocked() {
  const config = await liveStoryConfig();

  const csrfToken = await liveCookie('csrftoken');
  if (!csrfToken) {
    return {
      ok: false,
      error: 'Você não está logado no Instagram neste navegador. Faça login e tente de novo.',
    };
  }

  let bytes;
  try {
    bytes = bytesFromBase64(config.imageBase64);
  } catch {
    return { ok: false, error: 'A imagem guardada está corrompida — reenvie no painel.' };
  }

  // `linkLayout` é onde o painel largou o adesivo no editor. Config gravada por
  // uma versão anterior não tem a chave — o payload cai na posição padrão.
  const request = buildStoryRequest(
    config.link || null,
    config.linkLayout,
    Date.now(),
    UPLOAD_HOST,
    { dsUserId: await liveCookie('ds_user_id'), uuid: crypto.randomUUID() },
  );
  // A partir da segunda publicação, tentar primeiro os endereços que funcionaram.
  const routePreference = await preferredRoutes();
  const result = await postStoryRequest(request, bytes, csrfToken, routePreference);
  if (!result.ok) return result;
  // IMPORTANTE: guarde o ID ANTES de cache/etapas opcionais. Mesmo que a aba
  // seja recarregada agora, a próxima execução sabe que já existe um Story.
  try {
    const uid = await liveCookie('ds_user_id');
    if (uid && result.mediaId) {
      const key = `extensionsIG.avl.progress.v128.${uid}`;
      const previous = (await chrome.storage.local.get(key))[key];
      if (previous && ['inflight', 'unknown'].includes(previous.story)) {
        await chrome.storage.local.set({ [key]: {
          ...previous, story: 'done', mediaId: String(result.mediaId),
          highlight: false, highlightAttempted: false, updatedAt: Date.now(),
        } });
      }
    }
  } catch {
    // Se o armazenamento falhar, não perder a resposta de publicação.
    // A aba salvará o mesmo ID assim que receber o resultado.
  }
  try { await rememberRoutes(result.selectedUploadIndex, result.selectedConfigureIndex); }
  catch { /* cache de rotas nunca bloqueia o resultado do Story */ }

  result.dsUserId = await liveCookie('ds_user_id');

  // v1.32: não criar destaque antes de devolver o ID do Story. A aba salva
  // primeiro o progresso confirmado; somente depois solicita o destaque.
  // Se a segunda etapa falhar, ela pode ser retomada sem republicar.
  return result;
}

// ───────────────────────────── foto de perfil na sessão já logada

/**
 * A alteração de avatar usa uma rota INTERNA do Instagram Web. Não é uma API
 * oficial nem estável: caso o Instagram a rejeite, retornamos erro claramente.
 * Nunca importa, envia ou substitui cookies de outro usuário.
 */
// As rotas antigas web_change_profile_picture e set_biography foram removidas.
// Esta versão usa exclusivamente a interface web para alterar a bio e foto.

const PROFILE_EDIT_JOB_KEY = 'profileEditJob';
const PROFILE_EDIT_WINDOW_MS = 3 * 60 * 1000;

/** Tarefa explícita em Editar perfil, sem navegação adicional.
 * Instagram é uma SPA: tabs.get() e sender.url podem estar defasados após
 * clicar em Editar perfil. O content script observa location.pathname atual.
 * Exigimos um content script do Instagram no frame principal E o caminho
 * /accounts/edit/ observado por ele, antes de iniciar qualquer tarefa.
 * Não grava ou remove cookies, nem abre novas abas. */
async function handleStartProfileEditHere(sender, msg) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId) || (sender?.frameId != null && sender.frameId !== 0)) {
    return { ok: false, error: 'Não identifiquei a aba principal do Instagram.' };
  }
  const isIG = url => url && url.protocol === 'https:' &&
    ['instagram.com', 'www.instagram.com'].includes(url.hostname);
  let source, observed;
  try {
    source = new URL(sender.url || sender.tab?.url || '');
    observed = new URL(msg?.pageUrl || '');
  } catch {
    return { ok: false, error: 'Não consegui identificar a página do Instagram. Atualize e tente novamente.' };
  }
  if (!isIG(source) || !isIG(observed) ||
      !/^\/accounts\/edit\/?$/.test(observed.pathname)) {
    return { ok: false, error: 'Abra Editar perfil do Instagram nesta aba antes de usar o botão.' };
  }
  // Defesa adicional: se o Chrome informar o domínio da aba, ele deve ser IG.
  // Não rejeitar diferença de CAMINHO: em navegação interna o endereço da aba
  // pode ficar temporariamente antigo mesmo com o editor já aberto.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && !isIG(new URL(tab.url))) {
      return { ok: false, error: 'A aba mudou de site. Reabra Editar perfil.' };
    }
  } catch {
    // sender.url e pageUrl acima já confirmaram o domínio.
  }
  const accountId = await liveCookie('ds_user_id');
  if (!accountId) return { ok: false, error: 'É necessário estar logado no Instagram.' };
  const stored = await chrome.storage.local.get(PROFILE_EDIT_JOB_KEY);
  const previous = stored[PROFILE_EDIT_JOB_KEY];
  if (previous?.status === 'running' && Date.now()-previous.createdAt < PROFILE_EDIT_WINDOW_MS) {
    return { ok: false, error: 'Já existe uma tentativa em andamento. Aguarde terminar.' };
  }
  const job = { id: crypto.randomUUID(), tabId, accountId, createdAt: Date.now(), status: 'pending', skipBio: Boolean(msg?.skipBio), skipPhoto: Boolean(msg?.skipPhoto) };
  await chrome.storage.local.set({ [PROFILE_EDIT_JOB_KEY]: job });
  try {
    const sent = await chrome.tabs.sendMessage(tabId, { type: 'runProfileEditHere' }, { frameId: 0 });
    if (!sent?.ok) throw new Error(sent?.error || 'O editor não respondeu. Atualize Editar perfil e tente novamente.');
    return { ok: true, jobId: job.id, info: 'Edição solicitada nesta mesma aba.' };
  } catch (error) {
    const active = (await chrome.storage.local.get(PROFILE_EDIT_JOB_KEY))[PROFILE_EDIT_JOB_KEY];
    if (active?.id === job.id && active.status === 'pending') await chrome.storage.local.remove(PROFILE_EDIT_JOB_KEY);
    return { ok: false, error: error.message };
  }
}

/** Somente a aba aberta pelo clique consegue consumir a configuração da edição. */
async function handleClaimProfileEdit(sender) {
  const tabId = sender?.tab?.id;
  const stored = await chrome.storage.local.get(PROFILE_EDIT_JOB_KEY);
  const job = stored[PROFILE_EDIT_JOB_KEY];
  if (!job || job.tabId !== tabId || job.status !== 'pending') {
    return { ok: false, skipped: true };
  }
  if (Date.now() - job.createdAt > PROFILE_EDIT_WINDOW_MS) {
    await chrome.storage.local.remove(PROFILE_EDIT_JOB_KEY);
    return { ok: false, error: 'A operação expirou. Use o botão Testar foto + bio novamente.' };
  }
  const currentId = await liveCookie('ds_user_id');
  if (!currentId || currentId !== job.accountId) {
    await chrome.storage.local.set({ [PROFILE_EDIT_JOB_KEY]: { ...job, status: 'aborted', error: 'A conta mudou; nenhuma alteração será feita.' } });
    return { ok: false, error: 'Conta diferente da que iniciou a edição. Operação cancelada.' };
  }
  if (job.status === 'pending') {
    await chrome.storage.local.set({ [PROFILE_EDIT_JOB_KEY]: { ...job, status: 'running' } });
  }
  const config = await liveStoryConfig();
  const photoConfig = await chrome.storage.local.get(PROFILE_PHOTO_KEY);
  const imageBase64 = photoConfig[PROFILE_PHOTO_KEY]?.imageBase64 || await bundledImageBase64('perfil-padrao.jpg');
  return { ok: true, jobId: job.id, bio: typeof config.bio === 'string' ? config.bio : PRESET_BIO, imageBase64, skipBio: Boolean(job.skipBio), skipPhoto: Boolean(job.skipPhoto) };
}

async function handleCompleteProfileEdit(sender, msg) {
  const stored = await chrome.storage.local.get(PROFILE_EDIT_JOB_KEY);
  const job = stored[PROFILE_EDIT_JOB_KEY];
  if (!job || job.id !== msg.jobId || job.tabId !== sender?.tab?.id) {
    return { ok: false, error: 'A tarefa não corresponde à aba iniciada.' };
  }
  // Resumo retido para consultas no popup; não contém bytes nem cookies.
  await chrome.storage.local.set({ [PROFILE_EDIT_JOB_KEY]: {
    ...job, status: 'complete', completedAt: Date.now(),
    results: { bio: msg.bio || 'não confirmado', photo: msg.photo || 'não confirmado' },
  } });
  return { ok: true };
}

async function handleProfileEditStatus() {
  const result = await chrome.storage.local.get(PROFILE_EDIT_JOB_KEY);
  const job = result[PROFILE_EDIT_JOB_KEY];
  if (!job) return { ok: true, status: 'none' };
  return { ok: true, jobId: job.id, status: job.status, results: job.results, error: job.error };
}

// ───────────────────────────── postar pela ABA (content script, origem real)

/**
 * Modo página: o service worker NÃO faz fetch. Só monta o pedido pronto e o
 * devolve para a aba do Instagram publicar por conta própria — com `Origin`/
 * `Referer` reais e a pegada de rede da página, sem a origem forjada do worker.
 *
 * O upload aponta para `www.instagram.com` (mesma origem da aba); em
 * `i.instagram.com` a aba cairia no CORS. O `csrftoken` a aba lê sozinha do
 * `document.cookie` (não é httpOnly) — não precisa vir daqui.
 */
async function handlePreparePost() {
  const pause = await getPublishingPause();
  if (!pause.ok) return pause;
  const config = await liveStoryConfig();
  const request = buildStoryRequest(
    config.link || null,
    config.linkLayout,
    Date.now(),
    WEB_UPLOAD_HOST,
    { dsUserId: await liveCookie('ds_user_id'), uuid: crypto.randomUUID() },
  );
  return { ok: true, request, imageBase64: config.imageBase64, highlightTitle: config.highlightTitle || '' };
}

/**
 * Sobe os bytes pelo worker a pedido da aba, quando nenhuma rota de mesma origem
 * aceitou. O worker alcança `i.instagram.com` (a aba não: CORS), e o
 * `upload_id` é o que a aba já tem no corpo do configure — ela publica depois.
 *
 * É o degrau que mantém o botão funcionando quando o uploader do `www` muda de
 * endereço: só o upload sai pelo worker, o configure continua de primeira parte.
 */
async function handleUploadLive(uploadId) {
  const pause = await getPublishingPause();
  if (!pause.ok) return pause;
  if (!uploadId) return { ok: false, error: 'Sem upload_id para subir a imagem.' };
  const config = await liveStoryConfig();
  let bytes;
  try {
    bytes = bytesFromBase64(config.imageBase64);
  } catch {
    return { ok: false, error: 'A imagem guardada está corrompida — reenvie no painel.' };
  }
  const subida = await uploadFirstThatAccepts(
    uploadCandidates(String(uploadId), UPLOAD_HOST),
    bytes,
    IG_APP_ID,
  );
  return subida.ok
    ? { ok: true, uploadedVia: subida.uploadedVia }
    : { ok: false, error: `Upload recusado em ${subida.recusas.length} rota(s):\n${subida.recusas.join('\n')}` };
}

/**
 * Publica pelo worker a pedido da aba, quando nenhuma rota de mesma origem
 * aceitou o formulário. O worker alcança `i.instagram.com`, a aba não (CORS).
 * Os bytes já estão no servidor — aqui só vai o formulário.
 */
async function handleConfigureLive(candidates) {
  const pause = await getPublishingPause();
  if (!pause.ok) return pause;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, error: 'Sem rota de publicação para tentar.' };
  }
  const csrfToken = await liveCookie('csrftoken');
  if (!csrfToken) return { ok: false, error: 'Sessão sem csrftoken para publicar.' };
  const publicacao = await configureFirstThatPublishes(candidates, csrfToken, IG_APP_ID);
  if (!publicacao.ok) {
    return {
      ok: false,
      error: `Publicação recusada em ${publicacao.recusas.length} rota(s):\n${publicacao.recusas.join('\n')}`,
    };
  }
  const data = publicacao.data;
  return {
    ok: true,
    publishedVia: publicacao.publishedVia,
    selectedConfigureIndex: publicacao.selectedIndex,
    mediaId: data.media && data.media.pk ? String(data.media.pk) : undefined,
  };
}

/**
 * Cria o destaque na sessão viva a pedido da aba (depois que ela publicou o
 * story e tem o `mediaId`). O destaque ainda sai por `i.instagram.com` — não há
 * rota de primeira parte no web — então ele fica no service worker, que é quem
 * pode reescrever a origem. É o tell residual do modo página: se o flag continuar
 * mesmo assim, o próximo passo é o destaque, não o story.
 */
async function handleHighlightLive(mediaId, title) {
  const pause = await getPublishingPause();
  if (!pause.ok) return pause;
  if (!mediaId || !title) return { ok: false, error: 'Sem mediaId ou título para o destaque.' };
  const csrfToken = await liveCookie('csrftoken');
  const dsUserId = await liveCookie('ds_user_id');
  if (!csrfToken) return { ok: false, error: 'Sessão sem csrftoken para criar o destaque.' };
  const highlight = await createHighlight(mediaId, title, csrfToken, dsUserId, IG_APP_ID);
  return highlight.ok
    ? { ok: true, id: highlight.highlightId, title, durationMs: highlight.durationMs }
    : { ok: false, error: highlight.error, uncertain: Boolean(highlight.uncertain), httpStatus: highlight.httpStatus, durationMs: highlight.durationMs };
}

// ───────────────────────────────────────────────── config compartilhada

/**
 * Guarda a montagem do lote.
 *
 * Bio sem imagem também é montagem: quem ainda não escolheu a foto do story
 * precisa do "Copiar bio" na aba do Instagram do mesmo jeito. Antes a condição
 * era só a imagem, e uma bio sozinha nunca chegava aqui.
 */
async function handleSetStoryConfig(config) {
  if (config && (config.imageBase64 || config.bio)) {
    await chrome.storage.local.set({ [STORY_CONFIG_KEY]: config });
    return { ok: true, stored: true };
  }
  await chrome.storage.local.remove(STORY_CONFIG_KEY);
  return { ok: true, stored: false };
}

async function handleGetStoryConfig() {
  const stored = await chrome.storage.local.get([STORY_CONFIG_KEY, PROFILE_PHOTO_KEY]);
  const config = mergedConfig(stored[STORY_CONFIG_KEY] || {});
  return {
    ok: true,
    hasProfilePhoto: true, // foto embutida na extensão, mesmo sem configuração prévia
    hasImage: true, // story-pronto.jpg embutido na extensão
    hasLink: Boolean(config && config.link && config.link.url),
    linkTitle: config && config.link ? config.link.title : undefined,
    highlightTitle: config ? config.highlightTitle : undefined,
    // A bio vai inteira: o botão flutuante a copia para a área de transferência,
    // e não há nada a esconder num texto que vai virar público no perfil.
    bio: config && config.bio ? config.bio : '',
  };
}

// ───────────────────────────────────────────────── Origin / Referer

/**
 * `fetch` não pode definir `Origin`/`Referer` — são headers proibidos. Sem eles
 * a requisição sai com origem `chrome-extension://…`. Esta regra os reescreve
 * para `instagram.com`, restrita a requisições sem aba (`tabIds:[-1]`), ou seja,
 * só às do service worker — a navegação normal do operador não é tocada.
 */
const HEADER_RULE_ID = 1;

async function installHeaderRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [HEADER_RULE_ID],
      addRules: [
        {
          id: HEADER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'origin', operation: 'set', value: IG_ORIGIN },
              { header: 'referer', operation: 'set', value: `${IG_ORIGIN}/` },
            ],
          },
          condition: {
            // Os dois passos: `i.instagram.com` sobe, `www.instagram.com` publica.
            urlFilter: '||instagram.com/',
            resourceTypes: ['xmlhttprequest', 'other'],
            tabIds: [-1],
          },
        },
      ],
    });
  } catch {
    // Sem a regra o upload ainda pode passar; falhar aqui não impede o resto.
  }
}

// v1.37: reinjeta apenas os botões nas abas que já estavam abertas.
// Manifest content_scripts cobre novas navegações, mas não páginas abertas
// ANTES de instalar/recarregar a extensão. Não navega nem dá F5 nas abas.
const autoButtonInjection = new Set();

function targetForButtons(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'instagram.com' || parsed.hostname.endsWith('.instagram.com')) return 'instagram';
    if (parsed.hostname === 'ebooksucessodigital.online') return 'flow';
  } catch { /* URL não é injetável */ }
  return null;
}

async function injectButtons(tab) {
  if (!tab || !Number.isInteger(tab.id) || autoButtonInjection.has(tab.id)) return;
  const target = targetForButtons(tab.url || tab.pendingUrl);
  if (!target) return;
  autoButtonInjection.add(tab.id);
  try {
    // Content scripts são idempotentes. No Instagram, reinstalamos também
    // as rotinas da foto/bio nas abas já existentes, sem executá-las.
    if (target === 'instagram') {
      // O hook principal usa mundo MAIN, exatamente como no manifest.
      if (tab.url && /https:\/\/(?:www\.)?instagram\.com\//i.test(tab.url)) {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['instagram-photo-hook.js'], world: 'MAIN'});
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['instagram-profile-edit.js']});
      }
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['instagram-overlay.js']});
    } else {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['flow-login.js']});
    }
  } catch {
    // Navegação concorrente, aba fechada, permissões negadas ou pagina especial.
    // O manifest tentará de novo no próximo carregamento normal.
  } finally {
    autoButtonInjection.delete(tab.id);
  }
}

async function ensureButtonsInOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({url: [
      'https://instagram.com/*', 'https://*.instagram.com/*',
      'https://ebooksucessodigital.online/*',
    ]});
    await Promise.all(tabs.map(injectButtons));
  } catch { /* Apenas botões: nunca bloqueia a publicação */ }
}

// Recarregar a extensão enquanto as abas estão abertas não exige mais F5.
chrome.runtime.onInstalled.addListener(() => void ensureButtonsInOpenTabs());
chrome.runtime.onStartup.addListener(() => void ensureButtonsInOpenTabs());
// Também funciona após reativar a extensão ou reiniciar o service worker.
void ensureButtonsInOpenTabs();

// Ao mudar de perfil/aba ou navegar numa SPA, verifique sem recarregar.
chrome.tabs.onActivated.addListener(async ({tabId}) => {
  try { await injectButtons(await chrome.tabs.get(tabId)); } catch { /* aba removida */ }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) void injectButtons(tab || {id: tabId, url: changeInfo.url});
});

chrome.runtime.onStartup.addListener(() => void installHeaderRule());
chrome.runtime.onInstalled.addListener(() => void installHeaderRule());
void installHeaderRule();

// ───────────────────────────────────────────────── mensagens

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  const async = {
    liveSession: () => handleLiveSession(),
    publishLive: () => handlePublishLive(),
    changeProfilePhotoLive: async () => ({ ok: false, skipped: true, error: 'Recurso suspenso no modo seguro: rota do Instagram indisponível.' }),
    changeBioLive: async () => ({ ok: false, skipped: true, error: 'Recurso suspenso no modo seguro: rota do Instagram indisponível.' }),
    startProfileEditHere: () => handleStartProfileEditHere(sender, msg),
    claimProfileEdit: () => handleClaimProfileEdit(sender),
    completeProfileEdit: () => handleCompleteProfileEdit(sender, msg),
    profileEditStatus: () => handleProfileEditStatus(),
    preparePost: () => handlePreparePost(),
    uploadLive: () => handleUploadLive(msg.uploadId),
    configureLive: () => handleConfigureLive(msg.candidates),
    highlightLive: () => handleHighlightLive(msg.mediaId, msg.title),
    publishingPause: () => getPublishingPause(),
    notePublishingResponse: () => notePublishingResponse(msg.status, msg.data),
    setStoryConfig: () => handleSetStoryConfig(msg.config),
    getStoryConfig: () => handleGetStoryConfig(),
    afEmail: () => afEmail(),
    afCode: () => afCode(msg.email),
  };

  const handler = async[msg.type];
  if (!handler) return false;

  handler()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // resposta assíncrona
});

// ───────────────────────────── abrir o cadastro ao carregar no Chrome
// Content script só roda em páginas do Instagram; se o navegador abre vazio ou
// em outra URL, nada dispara. Aqui o próprio background leva a aba ATUAL para a
// tela de cadastro assim que a extensão carrega (startup/instalação/reload),
// independente da URL em que ela esteja.
const SIGNUP_URL = 'https://www.instagram.com/accounts/emailsignup/';
let abriuCadastroUmaVez = false;
async function abrirCadastro() {
  if (abriuCadastroUmaVez) return;
  abriuCadastroUmaVez = true;
  // Se já existe uma aba de cadastro aberta, foca nela.
  try {
    const abertas = await chrome.tabs.query({ url: 'https://*.instagram.com/accounts/emailsignup/*' });
    if (abertas && abertas.length) {
      await chrome.tabs.update(abertas[0].id, { active: true });
      if (abertas[0].windowId != null) { try { await chrome.windows.update(abertas[0].windowId, { focused: true }); } catch { /* ok */ } }
      return;
    }
  } catch { /* segue para converter/abrir */ }
  // Converte a aba ativa (vazia ou com outra URL) para o cadastro.
  try {
    const ativas = await chrome.tabs.query({ active: true, currentWindow: true });
    const ativa = ativas && ativas[0];
    if (ativa && ativa.id != null && !/instagram\.com\/accounts\/emailsignup/.test(ativa.url || '')) {
      await chrome.tabs.update(ativa.id, { url: SIGNUP_URL, active: true });
      return;
    }
    if (!ativa) await chrome.tabs.create({ url: SIGNUP_URL, active: true });
  } catch {
    try { await chrome.tabs.create({ url: SIGNUP_URL, active: true }); } catch { /* sem tabs */ }
  }
}
chrome.runtime.onStartup.addListener(() => void abrirCadastro());
chrome.runtime.onInstalled.addListener(() => void abrirCadastro());
// Ao reativar/reiniciar o service worker (reload da extensão), abre também.
void abrirCadastro();

// ───────────────────────────── ponte com a API local do Flash Creator
// Feito AQUI no background (não no content script) para não disparar o aviso de
// "acessar dispositivos da rede local" (Private Network) no instagram.com.
// A extensão tem host_permission para 127.0.0.1:8777, então o fetch sai direto,
// sem pop-up. Cada chamada é curta (uma verificação); o content script repete.
const AF_BASE = 'http://127.0.0.1:8777';
const AF_TOKEN = 'a998ba0720f3d5a960874e7099cef74b';
// Id único deste perfil/extensão: o servidor usa pra medir quantos pedidos
// simultâneos existem e comprar Gmail na medida da demanda.
const AF_CLIENT = 'c-' + Math.random().toString(36).slice(2, 10);
async function afApi(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(AF_BASE + path + sep + 'token=' + AF_TOKEN, opts);
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}
// Pede 1 Gmail ao servidor. O SERVIDOR escolhe e marca "em uso" na hora, então
// pedidos simultâneos (vários perfis) recebem Gmails diferentes — nunca o mesmo.
// Sem Gmail livre, o servidor compra sozinho e devolve waiting (o content script
// repete). Guarda o e-mail entregue pra buscar o código certo depois.
let afEmailAtual = '';
async function afEmail() {
  try {
    const r = await afApi('/api/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: AF_CLIENT }) });
    if (r && r.ok && r.email) { afEmailAtual = r.email; return { ok: true, email: r.email }; }
    return { ok: false, waiting: true };
  } catch (e) { return { ok: false, error: 'pedido de Gmail falhou: ' + e.message }; }
}
// Código de confirmação do Gmail usado. Procura nos dois pools: comprado
// (FlowOTP) e normal (cadastrado à mão). Ao chegar, o servidor libera o Gmail.
async function afCode(email) {
  const alvo = email || afEmailAtual;
  // comprado (FlowOTP)
  try {
    const { latest } = await afApi('/api/flow/latest');
    if (latest && latest.code && (!alvo || !latest.email || latest.email === alvo)) return { ok: true, code: String(latest.code) };
  } catch { /* segue */ }
  try {
    const { flow } = await afApi('/api/flow');
    const hit = (flow || []).find((g) => g.email === alvo && g.code);
    if (hit && hit.code) return { ok: true, code: String(hit.code) };
  } catch { /* segue */ }
  // normal (manual) — códigos que vão pra aba "Códigos"
  if (alvo) {
    try {
      const { latest } = await afApi('/api/latest?email=' + encodeURIComponent(alvo));
      if (latest && latest.code) return { ok: true, code: String(latest.code) };
    } catch { /* segue */ }
  }
  return { ok: false, waiting: true };
}
