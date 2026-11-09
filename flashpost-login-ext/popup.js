// Abre a guia do Flashpost com um #afrun novo (reseta o guard do flow-login pra
// conectar de novo sem entrar em loop). O flow-login faz login + Conectar + Permitir.
const FLASHPOST_URL = 'https://flashpost.onrender.com/login';
document.getElementById('abrir').addEventListener('click', async () => {
  const url = FLASHPOST_URL + '#afrun=' + Date.now();
  try {
    await chrome.tabs.create({ url });
    document.getElementById('status').textContent = 'Abrindo o Flashpost…';
    setTimeout(() => window.close(), 400);
  } catch (e) {
    document.getElementById('status').textContent = 'Erro ao abrir: ' + (e && e.message || e);
  }
});
