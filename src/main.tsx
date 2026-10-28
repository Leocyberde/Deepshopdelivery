import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;

  // Se já havia um service worker controlando a página e outro assume, existe versão nova.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.dispatchEvent(new CustomEvent('pwa-update-available'));
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        void registration.update();
        // PWA instalado quase nunca recarrega: verifica atualização sempre que o app volta para a tela.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
        });
        window.setInterval(() => void registration.update().catch(() => undefined), 30 * 60 * 1000);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('pwa-update-available'));
            }
          });
        });
      })
      .catch(() => {
        // PWA é progressivo: falha de registro não impede o uso no navegador.
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
registerPwaServiceWorker();
