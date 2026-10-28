const CACHE_NAME = 'deepshop-pwa-v9';
// Arquivos de /assets/ têm hash no nome (nunca mudam), então ficam num cache próprio que
// sobrevive às atualizações: abas abertas com a versão antiga ainda acham seus arquivos.
const ASSET_CACHE = 'deepshop-pwa-assets';
const CACHE_PREFIX = 'deepshop-pwa-';
const MAX_ASSET_ENTRIES = 200;
const NETWORK_TIMEOUT_MS = 4000;
const APP_SHELL = ['/', '/manifest.json', '/icon.svg', '/pwa-192x192.png', '/pwa-512x512.png', '/pwa-maskable-512x512.png'];

// Rede primeiro, mas sem esperar para sempre: se a conexão estiver lenta/travada
// (comum ao voltar de outro app), usa a cópia guardada em vez de ficar carregando.
function networkFirst(request, cacheName, cacheKey) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(cacheKey || request);
    const timer = setTimeout(() => {
      fallback().then((cached) => { if (cached && !settled) { settled = true; resolve(cached); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(request).then((response) => {
      clearTimeout(timer);
      if (response.ok) {
        const copy = response.clone();
        void caches.open(cacheName).then((cache) => cache.put(cacheKey || request, copy));
      }
      if (!settled) { settled = true; resolve(response); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then((cached) => { if (!settled) { settled = true; resolve(cached || Response.error()); } });
    });
  });
}

async function trimAssetCache() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_ASSET_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ASSET_ENTRIES).map((key) => cache.delete(key)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Um arquivo que falhar não pode derrubar a atualização inteira (rede ruim).
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));

    const shellResponse = await cache.match('/');
    if (shellResponse) {
      const html = await shellResponse.text();
      const appAssets = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
        .map((match) => {
          try { return new URL(match[1], self.location.origin); }
          catch { return null; }
        })
        .filter((url) => url && url.origin === self.location.origin && url.pathname.startsWith('/assets/') && /\.(?:js|css)$/i.test(url.pathname))
        .map((url) => url.href);
      const assets = await caches.open(ASSET_CACHE);
      await Promise.allSettled([...new Set(appAssets)].map((url) => assets.add(url)));
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== ASSET_CACHE).map((key) => caches.delete(key))
    )).then(() => trimAssetCache()).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas: sempre tenta a versão nova, mas cai para a guardada se a rede demorar.
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, CACHE_NAME, '/'));
    return;
  }

  // Arquivos com hash: cache primeiro (instantâneo); se não tiver, busca e guarda.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })));
    return;
  }

  // Demais arquivos (ícones, manifest, imagens): rede com limite de tempo.
  if (['script', 'style', 'image', 'font', 'manifest'].includes(event.request.destination)) {
    event.respondWith(networkFirst(event.request, CACHE_NAME));
  }
});

// Manipulador de clique na notificação nativa do celular / navegador
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/minha-conta/pedidos';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(self.registration.scope)) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Manipulador de evento Push (Web Push padrão)
self.addEventListener('push', (event) => {
  let data = {
    title: 'DeepShop Delivery 🛵',
    body: 'Atualização no seu pedido!',
    url: '/minha-conta/pedidos',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/pwa-192x192.png',
    badge: '/icon.svg',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/minha-conta/pedidos' },
    tag: data.tag || 'deepshop-alert',
  };

  event.waitUntil(self.registration.showNotification(data.title || 'DeepShop Delivery 🛵', options));
});
