// Montagem do payload do story — o MESMO que src/lib/story.ts faz no painel,
// aqui de novo porque o service worker não importa TypeScript. Módulo puro (sem
// chrome.*), para o background importar e o teste travar byte a byte contra a
// requisição que sabidamente publicou.
//
// Se algum campo mudar, muda-se AQUI e em src/lib/story.ts — os dois têm o mesmo
// teste de referência, então a divergência é pega na hora.

export const UPLOAD_HOST = 'https://i.instagram.com';
/**
 * Host do upload no fluxo do NAVEGADOR. Postar pela aba (content script) exige
 * mesma origem — `i.instagram.com`  seria cross-origin e cairia no CORS; `www` é
 * a origem da própria aba, então a requisição sai como XHR de primeira parte,
 * com `Origin`/`Referer` reais e a pegada de rede da página. É o que tira a
 * assinatura de "app de celular batendo com credencial de web".
 */
export const WEB_UPLOAD_HOST = 'https://www.instagram.com';
/**
 * Rota de publicação do criador do WEB — o fluxo novo de postar story pelo
 * instagram.com. É a que sempre publicou aqui e a que passou a devolver 404 em
 * HTML. Fica na lista como ÚLTIMO candidato, caso o Instagram a devolva ao ar.
 */
export const CONFIGURE_URL =
  'https://www.instagram.com/api/v1/web/create/configure_to_story/';

/**
 * A rota de publicação da API privada, montada no host do web. `www` serve
 * `/api/v1/…` para várias chamadas (é por onde `web_profile_info` responde), e
 * ela é de MESMA ORIGEM para a aba — a única família de rota que a aba alcança
 * sem cair no CORS.
 */
export const WEB_MEDIA_CONFIGURE_URL =
  'https://www.instagram.com/api/v1/media/configure_to_story/';

/**
 * A mesma rota no host do app — a que as bibliotecas de API privada usam há
 * anos, enquanto `/api/v1/web/create/` é recente. Só o service worker a alcança.
 */
export const APP_MEDIA_CONFIGURE_URL =
  'https://i.instagram.com/api/v1/media/configure_to_story/';

export const IG_APP_ID = '936619743392459';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/**
 * Onde o adesivo de link fica no quadro, em fração de 0 a 1: `x`/`y` são o
 * **centro**. Estas são as medidas da requisição que funcionou — valem para quem
 * nunca mexeu no editor de posição do painel.
 */
export const LINK_STICKER_LAYOUT = Object.freeze({
  x: 0.5,
  y: 0.5, // centralizado: a figurinha desenhada (pílula) também está no centro do quadro
  width: 0.72,
  height: 0.092,
  rotation: 0,
});

export const STICKER_MIN_WIDTH = 0.25;
export const STICKER_MAX_WIDTH = 0.95;
export const STICKER_RATIO = LINK_STICKER_LAYOUT.height / LINK_STICKER_LAYOUT.width;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Espelho de `normalizeLayout` do painel: campo ausente volta ao padrão, medida
 * fora de escala é aparada e o centro é puxado para dentro do quadro. A config
 * guardada em chrome.storage pode ser antiga (sem posição) ou ter vindo de uma
 * versão anterior do painel — aqui ela vira sempre um layout desenhável.
 *
 * A ordem das chaves é a da requisição capturada: é ela que sai no JSON.
 */
export function normalizeLayout(value) {
  const raw = value || {};
  const width = clamp(
    numberOr(raw.width, LINK_STICKER_LAYOUT.width),
    STICKER_MIN_WIDTH,
    STICKER_MAX_WIDTH,
  );
  const height = clamp(
    numberOr(raw.height, LINK_STICKER_LAYOUT.height),
    STICKER_MIN_WIDTH * STICKER_RATIO,
    STICKER_MAX_WIDTH * STICKER_RATIO,
  );
  return {
    x: clamp(numberOr(raw.x, LINK_STICKER_LAYOUT.x), width / 2, 1 - width / 2),
    y: clamp(numberOr(raw.y, LINK_STICKER_LAYOUT.y), height / 2, 1 - height / 2),
    width,
    height,
    rotation: clamp(numberOr(raw.rotation, LINK_STICKER_LAYOUT.rotation), -Math.PI, Math.PI),
  };
}

/** `upload_id` do Instagram: milissegundos, como texto. */
export function makeUploadId(now = Date.now()) {
  return String(now);
}

/**
 * Prefixo do nome da entidade, por host. O uploader do app (`i.instagram.com`)
 * aceita o nome do fluxo de story; o uploader do web (`www`) nomeia a entidade
 * com o prefixo do seu próprio uploader. O nome faz parte do caminho, então
 * trocar de host sem trocar o prefixo cai numa rota que não existe — e rota que
 * não existe no Instagram devolve a *página* HTML de 404, não um JSON de erro.
 */
export const APP_ENTITY_PREFIX = 'story_';
export const WEB_ENTITY_PREFIX = 'fb_uploader_';

/** Nome da entidade no upload. É também o fim do caminho — os dois têm de bater. */
export function entityName(uploadId, host = UPLOAD_HOST) {
  const prefix = host === WEB_UPLOAD_HOST ? WEB_ENTITY_PREFIX : APP_ENTITY_PREFIX;
  return `${prefix}${uploadId}`;
}

export function uploadUrl(uploadId, host = UPLOAD_HOST) {
  return `${host}/rupload_igphoto/${entityName(uploadId, host)}`;
}

/**
 * Rotas de upload a tentar, na ordem, para o MESMO `upload_id`.
 *
 * Só o upload tem host e nome variáveis; o `configure_to_story` é um só. Como o
 * `upload_id` é o mesmo em todas as tentativas, o configure que vem depois não
 * muda — qualquer candidato que aceite os bytes serve.
 *
 * A ordem depende de quem chama: da aba só dá para tentar `www` (mesma origem);
 * do service worker o host do app vem primeiro, que é o que sempre publicou.
 */
export function uploadCandidates(uploadId, host = UPLOAD_HOST) {
  const hosts =
    host === WEB_UPLOAD_HOST
      ? [WEB_UPLOAD_HOST, WEB_UPLOAD_HOST]
      : [UPLOAD_HOST, WEB_UPLOAD_HOST, WEB_UPLOAD_HOST];
  const prefixes =
    host === WEB_UPLOAD_HOST
      ? [WEB_ENTITY_PREFIX, APP_ENTITY_PREFIX]
      : [APP_ENTITY_PREFIX, WEB_ENTITY_PREFIX, APP_ENTITY_PREFIX];
  return hosts.map((h, i) => {
    const name = `${prefixes[i]}${uploadId}`;
    return {
      host: h,
      entityName: name,
      url: `${h}/rupload_igphoto/${name}`,
      ruploadParams: ruploadParams(uploadId),
      sameOrigin: h === WEB_UPLOAD_HOST,
    };
  });
}

/**
 * A resposta é a página do Instagram, não a API?
 *
 * Rota inexistente cai no catch-all e volta como HTML (`<!DOCTYPE html>`, com
 * `not-logged-in` na tag `<html>` porque o 404 não resolve o espectador). Sem
 * isto o erro chega ao operador como um bloco de HTML cru e parece "sessão
 * caiu", quando é o endpoint que mudou de endereço.
 */
export function looksLikeHtml(text) {
  return /^\s*<(!doctype html|html[\s>])/i.test(String(text || ''));
}

/** Conteúdo do header `x-instagram-rupload-params`. `media_type: 1` = foto. */
export function ruploadParams(uploadId) {
  return JSON.stringify({
    upload_id: uploadId,
    media_type: 1,
    upload_media_width: STORY_WIDTH,
    upload_media_height: STORY_HEIGHT,
  });
}

/** O domínio, sem esquema — é o que o Instagram mostra abaixo do título. */
export function displayUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Normaliza o que o operador digitou. Aceita `exemplo.com` e devolve
 * `https://exemplo.com/`. Devolve `null` quando não dá para formar uma URL.
 */
export function normalizeLink(raw, title) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.')) return null;
    return { url: url.toString(), title: String(title || '').trim() };
  } catch {
    return null;
  }
}

/**
 * Corpo do `configure_to_story`, form-encoded — o passo que de fato publica.
 * `story_link_stickers` desenha o adesivo e `story_cta` registra o clique; o
 * Instagram exige os dois. Sem link, ambos saem e o story sobe só com a imagem.
 *
 * `layout` é onde o adesivo cai no quadro, escolhido no editor do painel.
 */
export function configureBody(uploadId, link, layout) {
  const params = new URLSearchParams();
  params.set('upload_id', uploadId);
  params.set('reel_mentions', '[]');

  if (link && link.url) {
    params.set(
      'story_link_stickers',
      JSON.stringify([
        {
          ...normalizeLayout(layout),
          display_url: displayUrl(link.url),
          link_title: link.title || '',
          link_type: 'web',
          link_type_v2: 'external',
          url: link.url,
        },
      ]),
    );
    params.set('story_cta', JSON.stringify([{ links: [{ webUri: link.url }] }]));
  }

  return params.toString();
}

/**
 * Corpo para as rotas `media/configure_to_story/`.
 *
 * O corpo do criador do web é o mínimo (`upload_id` + adesivos); a rota da API
 * privada espera também quem está publicando e de onde veio a mídia. Campo
 * extra que ela ignora custa bytes; campo que falta custa a publicação — então
 * eles vão.
 *
 * `source_type: 4` é mídia vinda da galeria, que é o que um `rupload_igphoto`
 * acabou de ser; `configure_mode: 1` é "compartilhar no story".
 */
export function appConfigureBody(uploadId, link, layout, identity = {}, now = Date.now()) {
  const params = new URLSearchParams(configureBody(uploadId, link, layout));
  const seconds = Math.floor(now / 1000);
  params.set('source_type', '4');
  params.set('configure_mode', '1');
  params.set('caption', '');
  params.set('_uid', String(identity.dsUserId || ''));
  params.set('_uuid', String(identity.uuid || ''));
  params.set('device_id', String(identity.uuid || ''));
  params.set('client_shared_at', String(seconds));
  params.set('client_timestamp', String(seconds));
  return params.toString();
}

/**
 * Rotas de publicação a tentar, na ordem, para o MESMO `upload_id` — os bytes já
 * estão no servidor, então cada tentativa custa só o formulário de novo.
 *
 * Ordem: a rota de mídia no host do web primeiro (mesma origem, alcançável pela
 * aba), depois a mesma rota no host do app (pelo worker), e por último a rota do
 * criador do web, que é a que morreu.
 */
export function configureCandidates(uploadId, link, layout, identity = {}, now = Date.now()) {
  const app = appConfigureBody(uploadId, link, layout, identity, now);
  return [
    { url: WEB_MEDIA_CONFIGURE_URL, body: app, sameOrigin: true, flavor: 'media' },
    { url: APP_MEDIA_CONFIGURE_URL, body: app, sameOrigin: false, flavor: 'media' },
    {
      url: CONFIGURE_URL,
      body: configureBody(uploadId, link, layout),
      sameOrigin: true,
      flavor: 'web',
    },
  ];
}

/**
 * O Instagram respondeu sobre a CONTA, e não sobre a rota?
 *
 * Veredito de conta encerra a cadeia: tentar a mesma coisa em outro host não
 * muda a resposta e cada repetição é mais uma batida registrada na conta. O
 * resto — 404, HTML, 5xx, campo faltando — é endereço ou formulário, e vale o
 * próximo candidato.
 */
export function isAccountVerdict(message) {
  return ['login_required', 'checkpoint_required', 'feedback_required', 'spam'].includes(
    String(message || ''),
  );
}

// ─────────────────────────────────────────────────────── destaque

export const HIGHLIGHT_CREATE_URL =
  'https://i.instagram.com/api/v1/highlights/create_reel/';

/**
 * Recorte da capa do destaque, em fração de 0 a 1 (topo/base cortados para caber
 * no círculo). É o valor que o app manda ao criar um destaque a partir de um
 * story 9:16.
 */
export const HIGHLIGHT_COVER_CROP = [0.0, 0.21763848, 1.0, 0.78236157];

/**
 * Corpo do `highlights/create_reel/`, form-encoded.
 *
 * **Por que criar o destaque pela API em vez de esperar o arquivo.** O story só
 * entra em `/archive/stories/` quando **expira** — é assim que o Instagram
 * funciona, não é defeito da publicação. Mas destaque não precisa do arquivo:
 * aceita um story **ativo** pelo `media_id`, que é justamente o que o
 * `configure_to_story` acabou de devolver. Por isso dá para publicar e destacar
 * no mesmo clique, sem esperar 24h.
 *
 * `cover.crop_rect` vai como string de JSON dentro do JSON — é aninhado mesmo.
 */
export function highlightBody(mediaId, title, dsUserId, uuid, now = Date.now()) {
  const id = String(mediaId);
  const params = new URLSearchParams();
  params.set('source', 'self_profile');
  params.set('creation_id', String(now));
  params.set('_uid', String(dsUserId || ''));
  params.set('_uuid', String(uuid || ''));
  params.set(
    'cover',
    JSON.stringify({ media_id: id, crop_rect: JSON.stringify(HIGHLIGHT_COVER_CROP) }),
  );
  params.set('media_ids', JSON.stringify([id]));
  params.set('title', String(title || '').slice(0, 16));
  return params.toString();
}

/**
 * URLs, headers e corpos prontos. A imagem (bytes) viaja à parte — quem chama já
 * a tem. `link` pode ser null; `layout` ausente cai na posição padrão.
 */
export function buildStoryRequest(
  link,
  layout,
  now = Date.now(),
  uploadHost = UPLOAD_HOST,
  identity = {},
) {
  const uploadId = makeUploadId(now);
  return {
    uploadId,
    uploadUrl: uploadUrl(uploadId, uploadHost),
    entityName: entityName(uploadId, uploadHost),
    uploadCandidates: uploadCandidates(uploadId, uploadHost),
    ruploadParams: ruploadParams(uploadId),
    configureUrl: CONFIGURE_URL,
    configureBody: configureBody(uploadId, link, layout),
    configureCandidates: configureCandidates(uploadId, link, layout, identity, now),
    appId: IG_APP_ID,
  };
}
