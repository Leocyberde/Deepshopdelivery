// Gerenciador de Notificações Nativas do Sistema (Android / Celular / Navegador)
// Totalmente gratuito, utiliza a Notification API padrão W3C e Service Worker

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (err) {
    console.warn('Erro ao solicitar permissão de notificação:', err);
    return 'denied';
  }
}

export async function sendNativeNotification(
  title: string,
  options: {
    body: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
  }
): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  const iconUrl = options.icon || '/pwa-192x192.png';
  const badgeUrl = options.badge || '/icon.svg';
  const targetUrl = options.url || '/minha-conta/pedidos';

  // 1. Tenta disparar via Service Worker (Método padrão para Android / PWA com o app aberto ou em segundo plano)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body: options.body,
          icon: iconUrl,
          badge: badgeUrl,
          vibrate: [200, 100, 200, 100, 300],
          data: { url: targetUrl },
          tag: options.tag || `achadinhos-${Date.now()}`,
          requireInteraction: false,
        } as NotificationOptions);
        return true;
      }
    } catch (swErr) {
      console.warn('Falha no envio via Service Worker, tentando fallback:', swErr);
    }
  }

  // 2. Fallback via Notification API padrão
  try {
    const notif = new Notification(title, {
      body: options.body,
      icon: iconUrl,
      badge: badgeUrl,
      tag: options.tag || `achadinhos-${Date.now()}`,
    });

    notif.onclick = () => {
      window.focus();
      if (targetUrl) {
        window.location.href = targetUrl;
      }
      notif.close();
    };

    return true;
  } catch (err) {
    console.warn('Falha no envio de notificação nativa:', err);
    return false;
  }
}
