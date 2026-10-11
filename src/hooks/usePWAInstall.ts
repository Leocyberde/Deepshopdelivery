import { useEffect, useState, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== 'undefined' ? window.__deferredPwaPrompt || null : null)
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    // Remove old simulated flag if present
    localStorage.removeItem('achadinhos_pwa_installed_v1');
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const [isInIframe, setIsInIframe] = useState<boolean>(false);

  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) {
      setIsInstalled(true);
    }

    if (window.__deferredPwaPrompt) {
      setDeferredPrompt(window.__deferredPwaPrompt);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__deferredPwaPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handlePromptAvailable = () => {
      if (window.__deferredPwaPrompt) {
        setDeferredPrompt(window.__deferredPwaPrompt);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      window.__deferredPwaPrompt = null;
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-available', handlePromptAvailable);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-available', handlePromptAvailable);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    let activePrompt = deferredPrompt || window.__deferredPwaPrompt;

    // Wait up to 1.5s if the browser is still finishing Service Worker registration
    if (!activePrompt) {
      activePrompt = await new Promise<BeforeInstallPromptEvent | null>((resolve) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('pwa-prompt-available', onReady);
          resolve(window.__deferredPwaPrompt || null);
        }, 1500);
        function onReady() {
          window.clearTimeout(timeout);
          window.removeEventListener('pwa-prompt-available', onReady);
          resolve(window.__deferredPwaPrompt || null);
        }
        window.addEventListener('pwa-prompt-available', onReady);
      });
    }

    if (!activePrompt) {
      return 'unavailable';
    }

    try {
      await activePrompt.prompt();
      const { outcome } = await activePrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        window.__deferredPwaPrompt = null;
        setDeferredPrompt(null);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    isInstallable: !!(deferredPrompt || (typeof window !== 'undefined' && window.__deferredPwaPrompt)),
    isInstalled,
    isInIframe,
    install,
  };
}
