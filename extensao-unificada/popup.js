import {
  LINK_STICKER_LAYOUT,
  normalizeLayout,
  normalizeLink,
} from './story-payload.js';

const fullPage = new URLSearchParams(location.search).has('full');
if (fullPage) {
  document.body.classList.add('full-page');
} else if (window.innerHeight < 420 && chrome.tabs?.create) {
  chrome.tabs.create({ url: `${chrome.runtime.getURL('popup.html')}?full=1` });
}

const STORY_CONFIG_KEY = 'storyConfigAmandaV3';
const PROFILE_PHOTO_KEY = 'profilePhotoConfigAmandaV2';
const PRESET_BIO = '21 | BR';
const PRESET_PROFILE_FILE = 'perfil-padrao.jpg';
const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1920;
const STORY_LINK_URL = 'https://t.me/amandagfbot?start=init';
const STORY_LINK_TITLE = 'CLICA AQUI 🎁🔞';
const STORY_HIGHLIGHT_TITLE = '🎁🔞';
const STANDARD_IMAGE_FILE = 'story-pronto.jpg';

const fileInput = document.getElementById('image-file');
const chooseButton = document.getElementById('choose-image');
const fitMode = document.getElementById('fit-mode');
const preview = document.getElementById('preview');
const emptyPreview = document.getElementById('empty-preview');
const stickerPreview = document.getElementById('sticker-preview');
const stickerLinkTitle = document.getElementById('sticker-link-title');
const linkUrlInput = document.getElementById('link-url');
const linkTitleInput = document.getElementById('link-title');
const highlightTitleInput = document.getElementById('highlight-title');
const bioInput = document.getElementById('profile-bio');
const saveButton = document.getElementById('save-config');
const publishButton = document.getElementById('publish');
const statusElement = document.getElementById('status');
const profileFileInput = document.getElementById('profile-file');
const profileChooseButton = document.getElementById('choose-profile');
const profilePreview = document.getElementById('profile-preview');
const profileEmpty = document.getElementById('profile-empty');
const profileNote = document.getElementById('profile-note');
const runAllButton = document.getElementById('run-all');
const editProfileOnlyButton = document.getElementById('edit-profile-only');

let imageBase64 = '';
let rawImageBase64 = '';
let baseCanvas = null;
let sourceFile = null;
let linkLayout = normalizeLayout(LINK_STICKER_LAYOUT);
let busy = false;
let profileImageBase64 = '';
let previousStoryConfig = {};

function setStatus(message, kind = 'success') {
  statusElement.textContent = message;
  statusElement.className = `status visible${kind === 'success' ? '' : ` ${kind}`}`;
}

function setBusy(value) {
  busy = value;
  chooseButton.disabled = value;
  profileChooseButton.disabled = value;
  fitMode.disabled = value;
  saveButton.disabled = value || !imageBase64;
  publishButton.disabled = value || !imageBase64;
  runAllButton.disabled = value || !imageBase64;
  editProfileOnlyButton.disabled = value;
  saveButton.textContent = value ? 'Aguarde…' : 'Salvar';
  publishButton.textContent = value ? 'Publicando…' : 'Só story + destaque';
  runAllButton.textContent = value ? 'Publicando…' : 'Fazer tudo (1 clique)';
}

function configFromForm() {
  const link = normalizeLink(linkUrlInput.value.trim(), linkTitleInput.value.trim());
  return {
    ...previousStoryConfig,
    imageBase64,
    rawImageBase64,
    link,
    highlightTitle: highlightTitleInput.value.trim().slice(0, 50),
    bio: bioInput.value.slice(0, 150),
    linkLayout: normalizeLayout(linkLayout),
  };
}

function paintSticker() {
  const link = normalizeLink(linkUrlInput.value.trim(), linkTitleInput.value.trim());
  const showSticker = Boolean(link && imageBase64);
  stickerPreview.hidden = !showSticker;
  if (!showSticker) {
    updateComposedImage();
    return;
  }

  linkLayout = normalizeLayout(linkLayout);
  stickerPreview.style.left = `${linkLayout.x * 100}%`;
  stickerPreview.style.top = `${linkLayout.y * 100}%`;
  stickerPreview.style.width = `${linkLayout.width * 100}%`;
  stickerPreview.style.height = `${linkLayout.height * 100}%`;
  stickerPreview.style.transform = `translate(-50%, -50%) rotate(${linkLayout.rotation}rad)`;
  const stickerPixels = linkLayout.width * document.getElementById('preview-frame').clientWidth;
  stickerPreview.style.setProperty('--sticker-font-size', `${Math.max(6, stickerPixels * 0.065)}px`);
  stickerLinkTitle.textContent = linkTitleInput.value.trim() || 'LINK';
  updateComposedImage();
}

function updateComposedImage() {
  if (!baseCanvas) return;
  // A arte pronta já contém o CTA visual “CLICA AQUI”. O link continua sendo
  // enviado como adesivo interativo no payload, mas nunca é desenhado uma
  // segunda vez dentro dos pixels do Story.
  imageBase64 = rawImageBase64;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response) reject(new Error('A extensão não respondeu. Recarregue-a e tente de novo.'));
      else resolve(response);
    });
  });
}

async function saveConfig() {
  const config = configFromForm();
  if (!config.imageBase64) throw new Error('Escolha uma imagem antes de salvar.');
  const response = await sendMessage({ type: 'setStoryConfig', config });
  if (!response.ok) throw new Error(response.error || 'Não foi possível salvar a configuração.');
  previousStoryConfig = config;
  return config;
}

async function imageToStory(file) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  if (file.size > 25 * 1024 * 1024) throw new Error('A imagem deve ter até 25 MB.');

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#111';
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  const scale = fitMode.value === 'contain'
    ? Math.min(IMAGE_WIDTH / bitmap.width, IMAGE_HEIGHT / bitmap.height)
    : Math.max(IMAGE_WIDTH / bitmap.width, IMAGE_HEIGHT / bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, (IMAGE_WIDTH - width) / 2, (IMAGE_HEIGHT - height) / 2, width, height);
  bitmap.close();

  return canvas;
}

async function loadBaseImage(base64) {
  const response = await fetch(`data:image/jpeg;base64,${base64}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  bitmap.close();
  return canvas;
}

async function processSelectedFile(file) {
  setBusy(true);
  setStatus('Preparando imagem…', 'info');
  try {
    const canvas = await imageToStory(file);
    sourceFile = file;
    baseCanvas = canvas;
    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    rawImageBase64 = rawDataUrl.slice(rawDataUrl.indexOf(',') + 1);
    imageBase64 = rawImageBase64;
    preview.src = rawDataUrl;
    preview.hidden = false;
    emptyPreview.hidden = true;
    saveButton.disabled = false;
    publishButton.disabled = false;
    paintSticker();
    setStatus('Imagem pronta para o story.');
  } catch (error) {
    setStatus(error.message || 'Não foi possível abrir essa imagem.', 'error');
  } finally {
    setBusy(false);
  }
}

/** Quadrado 640px, sem nenhuma edição/recorte posterior do usuário. */
async function imageToProfilePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma imagem para o perfil.');
  if (file.size > 25 * 1024 * 1024) throw new Error('A foto deve ter até 25 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const ctx = canvas.getContext('2d', { alpha: false });
    const size = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2,
      size, size, 0, 0, 640, 640);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    bitmap.close();
  }
}

function showSavedProfilePhoto() {
  profilePreview.src = profileImageBase64
    ? `data:image/jpeg;base64,${profileImageBase64}`
    : chrome.runtime.getURL(PRESET_PROFILE_FILE);
  profilePreview.hidden = false;
  profileEmpty.hidden = true;
  profileNote.textContent = profileImageBase64
    ? 'Foto personalizada salva. Pode trocar quando quiser.'
    : 'Foto padrão inclusa. Nenhuma seleção necessária.';
  runAllButton.disabled = busy || !imageBase64;
}

async function loadProfilePhotoConfig() {
  try {
    const stored = await chrome.storage.local.get(PROFILE_PHOTO_KEY);
    profileImageBase64 = stored[PROFILE_PHOTO_KEY]?.imageBase64 || '';
    showSavedProfilePhoto();
  } catch {
    showSavedProfilePhoto();
    setStatus('Não foi possível ler a foto personalizada; será usada a foto padrão.', 'error');
  }
}

async function setProfilePhoto(file) {
  setBusy(true);
  setStatus('Preparando foto de perfil…', 'info');
  try {
    const imageData = await imageToProfilePhoto(file);
    const newBase64 = imageData.slice(imageData.indexOf(',') + 1);
    await chrome.storage.local.set({ [PROFILE_PHOTO_KEY]: { imageBase64: newBase64 } });
    profileImageBase64 = newBase64;
    showSavedProfilePhoto();
    setStatus('Foto de perfil salva para os próximos usos.');
  } catch (error) {
    setStatus(error.message || 'Não foi possível salvar essa foto.', 'error');
  } finally {
    setBusy(false);
  }
}

function describeRunAll(result) {
  if (!result.ok) throw new Error(result.error || 'Falha na publicação.');
  const story = result.story;
  const photo = result.profilePhoto;
  const bio = result.bio;
  const messages = ['✅ Story publicado.'];
  let failed = false;
  if (story.highlight) {
    if (story.highlight.ok) messages.push(`✅ Destaque "${story.highlight.title}" criado.`);
    else { messages.push(`⚠️ Destaque não criado: ${story.highlight.error}`); failed = true; }
  } else if (highlightTitleInput.value.trim()) {
    messages.push('⚠️ Destaque não confirmado: Instagram não informou o ID do Story.');
    failed = true;
  }
  if (photo?.skipped && bio?.skipped) messages.push('ℹ️ Story concluído; a edição de foto e bio será aberta em outra aba.');
  else {
    if (photo?.ok) messages.push('✅ Foto de perfil alterada.');
    else { messages.push(`⚠️ Foto de perfil não alterada: ${photo?.error || 'sem confirmação'}`); failed = true; }
    if (bio?.ok) messages.push(bio.skipped ? 'Bio ignorada (campo vazio).' : `✅ Bio "${bio.bio}" alterada.`);
    else { messages.push(`⚠️ Bio não alterada: ${bio?.error || 'sem confirmação'}`); failed = true; }
  }
  setStatus(messages.join('\n'), failed ? 'error' : 'success');
}

async function loadSavedConfig() {
  try {
    const stored = await chrome.storage.local.get(STORY_CONFIG_KEY);
    const config = stored[STORY_CONFIG_KEY] || {};
    previousStoryConfig = config;
    linkUrlInput.value = config.link?.url || STORY_LINK_URL;
    linkTitleInput.value = config.link?.title || STORY_LINK_TITLE;
    highlightTitleInput.value = config.highlightTitle === undefined
      ? STORY_HIGHLIGHT_TITLE : config.highlightTitle;
    bioInput.value = config.bio === undefined ? PRESET_BIO : config.bio;
    linkLayout = normalizeLayout(config.linkLayout || LINK_STICKER_LAYOUT);

    // Primeiro a configuração salva; o story-pronto.jpg incluso é o padrão inicial.
    if (config.imageBase64) {
      imageBase64 = config.imageBase64;
      rawImageBase64 = config.rawImageBase64 || config.imageBase64;
      baseCanvas = await loadBaseImage(rawImageBase64);
      preview.src = `data:image/jpeg;base64,${rawImageBase64}`;
      preview.hidden = false;
      emptyPreview.hidden = true;
    } else {
      const response = await fetch(chrome.runtime.getURL(STANDARD_IMAGE_FILE));
      if (response.ok) {
        const blob = await response.blob();
        const canvas = await imageToStory(new File([blob], STANDARD_IMAGE_FILE, { type: blob.type }));
        baseCanvas = canvas;
        rawImageBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
        imageBase64 = rawImageBase64;
        preview.src = `data:image/jpeg;base64,${rawImageBase64}`;
        preview.hidden = false;
        emptyPreview.hidden = true;
      }
    }
    paintSticker();
    setBusy(false);
  } catch (error) {
    setStatus(`Não foi possível carregar a configuração: ${error.message}`, 'error');
  }
}

chooseButton.addEventListener('click', () => fileInput.click());
profileChooseButton.addEventListener('click', () => profileFileInput.click());
profileFileInput.addEventListener('change', () => {
  const [file] = profileFileInput.files || [];
  if (file) void setProfilePhoto(file);
});
linkUrlInput.addEventListener('input', paintSticker);
linkTitleInput.addEventListener('input', paintSticker);

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files || [];
  if (file) void processSelectedFile(file);
});

fitMode.addEventListener('change', () => {
  if (sourceFile) void processSelectedFile(sourceFile);
});

saveButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    await saveConfig();
    setStatus('Configuração salva neste navegador.');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

publishButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    await saveConfig();
    setStatus('Enviando para a conta aberta no Instagram…', 'info');
    const result = await sendMessage({ type: 'publishLive' });
    if (!result.ok) throw new Error(result.error || 'Não foi possível publicar o story.');

    if (result.highlight?.ok) {
      setStatus(`Story publicado e destaque "${result.highlight.title || highlightTitleInput.value.trim()}" criado.`);
    } else if (result.highlight && !result.highlight.ok) {
      setStatus(`Story publicado, mas o destaque falhou: ${result.highlight.error}`, 'error');
    } else {
      setStatus('Story publicado na conta aberta no Instagram.');
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

runAllButton.addEventListener('click', async () => {
  if (busy || !imageBase64) return;
  setBusy(true);
  try {
    await saveConfig();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?instagram\.com\/accounts\/edit\/?(?:[?#].*)?$/.test(tab.url || '')) {
      throw new Error('Abra Instagram → Editar perfil e clique no botão azul da página ou volte aqui. Não abri nenhuma aba.');
    }
    const accepted = await chrome.tabs.sendMessage(tab.id, { type: 'runAllOnEditPage' }, { frameId: 0 });
    if (!accepted?.ok) throw new Error(accepted?.error || 'A extensão não iniciou. Atualize Editar perfil e tente novamente.');
    setStatus('Iniciado na aba Editar perfil já aberta. Aguarde o resultado naquela página. Nenhuma aba foi criada.', 'info');
  } catch (error) {
    setStatus(error.message || 'Não foi possível iniciar.', 'error');
  } finally {
    setBusy(false);
  }
});

// Teste separado: não posta Story nem duplica o destaque.
editProfileOnlyButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    if (imageBase64) await saveConfig();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?instagram\.com\/accounts\/edit\/?(?:[?#].*)?$/.test(tab.url || '')) {
      throw new Error('Abra Editar perfil antes de testar a foto e a bio. Nenhuma aba foi aberta.');
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'runProfileEditFromPopup' }, { frameId: 0 });
    if (!res?.ok) throw new Error(res?.error || 'Não foi possível iniciar a edição.');
    setStatus('Edição da foto e bio iniciada na aba atual, sem publicar Story ou criar outra aba.', 'info');
  } catch (error) {
    setStatus(error.message || 'Não foi possível editar o perfil.', 'error');
  } finally {
    setBusy(false);
  }
});

void loadProfilePhotoConfig();
void loadSavedConfig();
