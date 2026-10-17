import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  UserProfile,
  CartItem,
  ToastMessage,
  CustomerNotification,
} from '../types/app.ts';
import { calculatePromoLinePricing } from '../utils/formatters.ts';
import {
  CustomerNotificationPopupModal,
  ToastStack,
} from '../components/ui/NotificationOverlays.tsx';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendNativeNotification,
} from '../utils/nativeNotifications.ts';

// Re-export modular types, formatters, validators, and UI components for full compatibility
export * from '../types/app.ts';
export * from '../utils/formatters.ts';
export * from '../utils/validators.ts';
export * from '../components/ui/AchadinhosLogo.tsx';
export * from '../components/ui/ProductMedia.tsx';
export * from '../components/ui/PaymentTimerBadge.tsx';

export interface AppContextType {
  user: UserProfile | null;
  token: string | null;
  authLoading: boolean;
  loginWithToken: (token: string, user: UserProfile) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  updateCartQuantity: (productId: number, quantity: number) => void;
  toggleCartItemSelected: (productId: number, selected: boolean) => void;
  setCartItemPreorder: (productId: number, receiveAllAsPreorder: boolean) => void;
  removePurchasedCartItems: () => void;
  removeFromCart: (productId: number) => void;
  clearCart: () => void;
  syncCartWithStorefront: (silent?: boolean) => Promise<void>;
  cartSyncing: boolean;
  cartCount: number;
  cartSubtotal: number;
  notifications: CustomerNotification[];
  unreadNotificationsCount: number;
  activeNotificationPopups: CustomerNotification[];
  refreshNotifications: () => Promise<void>;
  dismissNotificationPopup: (id: number) => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  toast: (text: string, type?: 'success' | 'error' | 'info') => void;
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>;
  nativeNotificationPermission: NotificationPermission;
  requestNativeNotificationPermission: () => Promise<NotificationPermission>;
  testNativeNotification: () => Promise<boolean>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'achadinhos_auth_token_v1';
const USER_STORAGE_KEY = 'achadinhos_auth_user_v1';
const CART_STORAGE_KEY = 'achadinhos_cart_v1';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => {
    try {
      const savedUserRaw = localStorage.getItem(USER_STORAGE_KEY);
      if (savedUserRaw) {
        const parsed = JSON.parse(savedUserRaw);
        if (
          parsed?.email === 'cliente@achadinhos.com.br' ||
          parsed?.email === 'carlos@exemplo.com.br'
        ) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          localStorage.removeItem(USER_STORAGE_KEY);
          localStorage.removeItem(CART_STORAGE_KEY);
          return null;
        }
      }
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem(USER_STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (
        parsed?.email === 'cliente@achadinhos.com.br' ||
        parsed?.email === 'carlos@exemplo.com.br'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const [authLoading, setAuthLoading] = useState<boolean>(!!token);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.map(({ stock: _legacyStock, ...item }: any) => item) : [];
    } catch {
      return [];
    }
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // ignore storage errors
    }
  }, [cart]);

  const loginWithToken = useCallback((newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
    } catch {
      // ignore
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
      const lastViewedOrderPrefix = 'achadinhos_customer_last_viewed_order_v1:';
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(lastViewedOrderPrefix)) sessionStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }, []);

  const apiFetch = useCallback(
    async <T = any>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(url, {
        ...options,
        headers,
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        if (response.status === 401 && token) {
          logout();
        }
        const errorMsg =
          typeof data === 'object' && data !== null && 'error' in data
            ? (data as any).error
            : 'Ocorreu um erro na requisição.';
        throw new Error(errorMsg);
      }

      if (url.startsWith('/api/') && !isJson) {
        throw new Error('Servidor atualizando. Tente novamente em instantes.');
      }

      return data as T;
    },
    [token, logout]
  );

  const userId = user?.id;
  const userRole = user?.role;

  const refreshUser = useCallback(async () => {
    if (!token) {
      setAuthLoading(false);
      return;
    }
    try {
      const profile = await apiFetch<UserProfile>('/api/auth/me');
      setUser((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(profile)) {
          return prev;
        }
        return profile;
      });
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      logout();
    } finally {
      setAuthLoading(false);
    }
  }, [token, apiFetch, logout]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Customer Notifications State & Polling (Requisito 3: Pop-up com botão X + Aba de Notificações)
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);

  const [nativeNotificationPermission, setNativeNotificationPermission] =
    useState<NotificationPermission>(() => getNotificationPermission());

  const requestNativeNotificationPermission = useCallback(async () => {
    const perm = await requestNotificationPermission();
    setNativeNotificationPermission(perm);
    if (perm === 'granted') {
      toast('🔔 Notificações no celular ativadas com sucesso!', 'success');
      sendNativeNotification('DeepShop Delivery 🛵', {
        body: 'Notificações no celular ativadas! Você receberá atualizações dos seus pedidos e promoções.',
        url: '/minha-conta/notificacoes',
      });
    } else if (perm === 'denied') {
      toast('Notificações bloqueadas nas configurações do navegador/celular.', 'info');
    }
    return perm;
  }, [toast]);

  const testNativeNotification = useCallback(async () => {
    const perm = getNotificationPermission();
    if (perm !== 'granted') {
      const requested = await requestNotificationPermission();
      setNativeNotificationPermission(requested);
      if (requested !== 'granted') {
        toast('Por favor, autorize as notificações para receber alertas no celular.', 'info');
        return false;
      }
    }
    const sent = await sendNativeNotification('🛵 DeepShop Delivery (Teste)', {
      body: 'Seu pedido #000123 saiu para entrega! O motoboy está a caminho do seu endereço.',
      url: '/minha-conta/pedidos',
      tag: 'test-order-notif',
    });
    if (sent) {
      toast('Notificação enviada! Confira a barra superior do seu celular.', 'success');
    } else {
      toast('Não foi possível disparar a notificação. Verifique a permissão do seu aparelho.', 'error');
    }
    return sent;
  }, [toast]);

  const refreshNotifications = useCallback(async () => {
    if (!token || !userId || userRole !== 'CUSTOMER') {
      setNotifications([]);
      return;
    }
    try {
      const res = await apiFetch<{
        notifications: CustomerNotification[];
        unreadCount: number;
        activePopups: CustomerNotification[];
      }>('/api/notifications');
      if (res && Array.isArray(res.notifications)) {
        setNotifications(res.notifications);

        // Dispara notificação nativa no celular (Android / PWA / Navegador) para novidades não lidas
        try {
          const pushedRaw = localStorage.getItem('achadinhos_pushed_notif_ids');
          const pushedIds: number[] = pushedRaw ? JSON.parse(pushedRaw) : [];
          const newUnread = res.notifications.filter(
            (n) => !n.isRead && !pushedIds.includes(n.id)
          );
          if (newUnread.length > 0) {
            for (const notif of newUnread) {
              sendNativeNotification(notif.title, {
                body: notif.message,
                url:
                  notif.orderNumber && notif.orderNumber !== 'PROMO' && notif.orderNumber !== 'TICKET'
                    ? '/minha-conta/pedidos'
                    : '/minha-conta/notificacoes',
                tag: `notif-${notif.id}`,
              });
              pushedIds.push(notif.id);
            }
            localStorage.setItem(
              'achadinhos_pushed_notif_ids',
              JSON.stringify(pushedIds.slice(-100))
            );
          }
        } catch {
          // ignore notification trigger errors
        }
      }
    } catch {
      // Ignore background poll error
    }
  }, [token, userId, userRole, apiFetch]);

  useEffect(() => {
    if (!token || !userId || userRole !== 'CUSTOMER') {
      setNotifications([]);
      return;
    }
    refreshNotifications();
    const interval = setInterval(() => {
      refreshNotifications();
    }, 3500);
    const onFocus = () => refreshNotifications();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, userId, userRole, refreshNotifications]);

  const dismissNotificationPopup = useCallback(
    async (id: number) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, popupDismissed: true } : n))
      );
      try {
        await apiFetch(`/api/notifications/${id}/dismiss-popup`, { method: 'PUT' });
      } catch {
        // Ignore
      }
    },
    [apiFetch]
  );

  const markNotificationRead = useCallback(
    async (id: number) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true, popupDismissed: true } : n))
      );
      try {
        await apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' });
      } catch {
        // Ignore
      }
    },
    [apiFetch]
  );

  const markAllNotificationsRead = useCallback(async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, isRead: true, popupDismissed: true }))
    );
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PUT' });
    } catch {
      // Ignore
    }
  }, [apiFetch]);

  const unreadNotificationsCount = notifications.filter((n) => !n.isRead).length;
  const activeNotificationPopups = notifications.filter((n) => !n.popupDismissed);
  const currentPopupNotification =
    user?.role === 'CUSTOMER' && activeNotificationPopups.length > 0
      ? activeNotificationPopups[0]
      : null;

  const addToCart = useCallback(
    (item: Omit<CartItem, 'quantity'>, quantity = 1) => {
      setCart((prev) => {
        const existingIndex = prev.findIndex((i) => i.productId === item.productId);
        if (existingIndex > -1) {
          const current = prev[existingIndex];
          const nextQty = Math.min(20, current.quantity + quantity);
          const updated = [...prev];
          updated[existingIndex] = { ...current, ...item, quantity: nextQty, selected: true };
          return updated;
        }
        return [...prev, { ...item, quantity: Math.min(20, quantity), selected: true }];
      });

      toast(`"${item.name}" adicionado à sacola.`, 'success');
    },
    [toast]
  );

  const updateCartQuantity = useCallback((productId: number, quantity: number) => {
    setCart((prev) => {
      if (quantity <= 0) {
        return prev.filter((i) => i.productId !== productId);
      }
      return prev.map((i) =>
        i.productId === productId
          ? { ...i, quantity: Math.min(Math.max(1, quantity), 20) }
          : i
      );
    });
  }, []);

  const toggleCartItemSelected = useCallback((productId: number, selected: boolean) => {
    setCart((prev) => prev.map((item) => item.productId === productId ? { ...item, selected } : item));
  }, []);

  const setCartItemPreorder = useCallback((productId: number, receiveAllAsPreorder: boolean) => {
    setCart((prev) => prev.map((item) => item.productId === productId ? { ...item, receiveAllAsPreorder } : item));
  }, []);

  const removePurchasedCartItems = useCallback(() => {
    setCart((prev) => prev.filter((item) => item.selected === false));
  }, []);

  const removeFromCart = useCallback((productId: number) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const [cartSyncing, setCartSyncing] = useState(false);

  const syncCartWithStorefront = useCallback(
    async (silent = true) => {
      setCartSyncing(true);
      try {
        const res = await apiFetch<{
          products: Array<{
            id: number;
            code: string;
            name: string;
            price: string;
            promoPrice: string | null;
            hasPromo: boolean;
            promoMaxUnits?: number | null;
            effectivePrice: string;
            imageUrl: string | null;
            categoryName: string;
          }>;
        }>('/api/storefront');

        if (!res || !Array.isArray(res.products)) return;
        const liveMap = new Map(res.products.map((p) => [p.id, p]));

        const notices: string[] = [];

        setCart((prev) => {
          if (prev.length === 0) return prev;
          let changed = false;
          const nextCart: CartItem[] = [];

          for (const item of prev) {
            const live = liveMap.get(item.productId);
            if (!live) { changed = true; notices.push(`"${item.name}" não está mais disponível.`); continue; }

            const fullTitle = live.code ? `${live.code} - ${live.name}` : live.name;
            const liveEffectivePrice = parseFloat(live.effectivePrice || live.price);
            const liveOriginalPrice = parseFloat(live.price);
            const livePromoPrice = live.promoPrice ? parseFloat(live.promoPrice) : null;
            const liveHasPromo = Boolean(live.hasPromo);
            const livePromoMaxUnits = live.promoMaxUnits ?? null;
            const nextQty = Math.min(item.quantity, 20);

            if (nextQty < item.quantity) {
              changed = true;
              notices.push(
                `Quantidade de "${fullTitle}" ajustada para ${nextQty} un. (estoque disponível).`
              );
            }

            const priceChanged =
              Math.abs((item.price || 0) - liveEffectivePrice) > 0.009 ||
              Math.abs((item.originalPrice ?? item.price) - liveOriginalPrice) > 0.009 ||
              Boolean(item.hasPromo) !== liveHasPromo ||
              (item.promoMaxUnits ?? null) !== livePromoMaxUnits;

            if (priceChanged) {
              changed = true;
              notices.push(`Preço/promoção de "${fullTitle}" atualizado em tempo real.`);
            }

            if (
              changed ||
              item.name !== fullTitle ||
              item.imageUrl !== live.imageUrl
            ) {
              changed = true;
              nextCart.push({
                ...item,
                name: fullTitle,
                price: liveEffectivePrice,
                originalPrice: liveOriginalPrice,
                promoPrice: livePromoPrice,
                hasPromo: liveHasPromo,
                promoMaxUnits: livePromoMaxUnits,
                imageUrl: live.imageUrl,
                categoryName: live.categoryName,
                quantity: nextQty,
              });
            } else {
              nextCart.push(item);
            }
          }

          return changed ? nextCart : prev;
        });

        setTimeout(() => {
          if (notices.length > 0) {
            toast(notices[0], 'info');
          } else if (!silent) {
            toast('Sacola sincronizada com os preços e estoques atuais!', 'success');
          }
        }, 50);
      } catch {
        // Ignore silent network errors during background sync
      } finally {
        setCartSyncing(false);
      }
    },
    [apiFetch, toast]
  );

  useEffect(() => {
    syncCartWithStorefront(true);
    const onFocus = () => syncCartWithStorefront(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [syncCartWithStorefront]);

  // O indicador da sacola representa produtos distintos; a quantidade continua
  // sendo usada separadamente no subtotal e no checkout.
  const cartCount = cart.length;
  const cartSubtotal = Number((cart.reduce((acc, item) => {
    if (item.selected === false) return acc;
    const pricing = calculatePromoLinePricing({
      normalPrice: item.originalPrice ?? item.price,
      promoPrice: item.promoPrice ?? item.price,
      hasPromo: item.hasPromo,
      promoMaxUnits: item.promoMaxUnits,
      quantity: item.quantity,
    });
    return acc + Math.round(pricing.subtotal * 100);
  }, 0) / 100).toFixed(2));

  return (
    <AppContext.Provider
      value={{
        user,
        token,
        authLoading,
        loginWithToken,
        logout,
        refreshUser,
        cart,
        addToCart,
        updateCartQuantity,
        toggleCartItemSelected,
        setCartItemPreorder,
        removePurchasedCartItems,
        removeFromCart,
        clearCart,
        syncCartWithStorefront,
        cartSyncing,
        cartCount,
        cartSubtotal,
        notifications,
        unreadNotificationsCount,
        activeNotificationPopups,
        refreshNotifications,
        dismissNotificationPopup,
        markNotificationRead,
        markAllNotificationsRead,
        toast,
        apiFetch,
        nativeNotificationPermission,
        requestNativeNotificationPermission,
        testNativeNotification,
        searchQuery,
        setSearchQuery,
      }}
    >
      {children}

      {/* Requisito 3: Pop-up de Notificação de Mudança de Status do Pedido com Botão X para Fechar */}
      <CustomerNotificationPopupModal
        notification={currentPopupNotification}
        totalActivePopupsCount={activeNotificationPopups.length}
        onDismiss={dismissNotificationPopup}
        onMarkRead={markNotificationRead}
      />

      {/* Clean Toast Stack */}
      <ToastStack toasts={toasts} />
    </AppContext.Provider>
  );
};

export function useAppOptional(): AppContextType | undefined {
  return useContext(AppContext);
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp deve ser usado dentro de AppProvider');
  return ctx;
}
