import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        void registration.update();
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
