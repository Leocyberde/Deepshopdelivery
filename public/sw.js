const CACHE_NAME = 'deepshop-pwa-v7';
const CACHE_PREFIX = 'deepshop-pwa-';
const APP_SHELL = ['/', '/manifest.json', '/icon.svg', '/pwa-192x192.png', '/pwa-512x512.png', '/pwa-maskable-512x512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Pre-cache apenas os bundles same-origin do build corrente. Sem eles, o HTML offline
    // abre, mas o React fica em branco após a ativação eliminar o cache da versão anterior.
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
      if (appAssets.length) await cache.addAll([...new Set(appAssets)]);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))));
    return;
  }

  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && ['script', 'style', 'image', 'font', 'manifest'].includes(event.request.destination)) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
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
