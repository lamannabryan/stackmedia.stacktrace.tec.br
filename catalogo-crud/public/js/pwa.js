const installButton = document.querySelector('[data-pwa-install]');
const installHelp = document.querySelector('[data-pwa-help]');
const standaloneMode = window.matchMedia('(display-mode: standalone)');
const isStandalone = () => standaloneMode.matches || navigator.standalone === true;
const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;
let installed = isStandalone();

function updateInstallButton() {
  if (!installButton) return;
  installButton.hidden = installed || isStandalone() || !window.isSecureContext
    || (!installPrompt && !isAppleMobile);
  if ((installed || isStandalone()) && installHelp) installHelp.hidden = true;
}

window.addEventListener('beforeinstallprompt', (event) => {
  if (!installButton) return;
  event.preventDefault();
  installPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  installed = true;
  installPrompt = null;
  updateInstallButton();
});
standaloneMode.addEventListener('change', updateInstallButton);

installButton?.addEventListener('click', async () => {
  if (!installPrompt) {
    if (installHelp) {
      installHelp.textContent = 'No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início. Ative Abrir como App, se essa opção aparecer, e confirme em Adicionar.';
      installHelp.hidden = false;
    }
    return;
  }

  const prompt = installPrompt;
  installPrompt = null;
  installButton.disabled = true;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') installed = true;
  } catch (error) {
    console.warn('Não foi possível abrir a instalação do _stackmedia.', error);
    if (installHelp) {
      installHelp.textContent = 'Abra o menu do navegador e procure a opção de instalar o aplicativo.';
      installHelp.hidden = false;
    }
  } finally {
    installButton.disabled = false;
    updateInstallButton();
  }
});

document.querySelector('[data-pwa-retry]')?.addEventListener('click', () => window.location.reload());
updateInstallButton();

if ('serviceWorker' in navigator && window.isSecureContext) {
  const register = () => navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).catch((error) => console.warn('Não foi possível iniciar o PWA do _stackmedia.', error));

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
