import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Store,
  Bell,
  ShieldCheck,
  Volume2,
  VolumeX,
  LogOut,
} from 'lucide-react';
import {
  useApp,
  isAdminRole,
  ORDER_STATUS_LABELS,
  ProductMediaItem,
} from '../context/AppContext.tsx';
import { playAdminAlertSound } from '../utils/soundAlert.ts';
import { AdminSidebar, AdminSection } from '../components/admin/AdminSidebar.tsx';
import { AdminNewCustomerAlert } from '../components/admin/AdminNewCustomerAlert.tsx';
import { AdminDashboardSection } from '../components/admin/AdminDashboardSection.tsx';
import { AdminProductsSection } from '../components/admin/AdminProductsSection.tsx';
import { AdminCategoriesSection } from '../components/admin/AdminCategoriesSection.tsx';
import { AdminOrdersSection } from '../components/admin/AdminOrdersSection.tsx';
import { AdminCustomersSection } from '../components/admin/AdminCustomersSection.tsx';
import { AdminSettingsSection } from '../components/admin/AdminSettingsSection.tsx';
import { AdminProfitRankingSection } from '../components/admin/AdminProfitRankingSection.tsx';
import { AdminInventorySection } from '../components/admin/AdminInventorySection.tsx';
import { AdminFreightModal } from '../components/admin/AdminFreightModal.tsx';
import { AdminPhase3Section } from '../components/admin/AdminPhase3Section.tsx';
import { AdminSupportSection } from '../components/admin/AdminSupportSection.tsx';

function resolveSectionFromPath(pathname: string): AdminSection {
  if (pathname.includes('/admin/estoque')) return 'STOCK';
  if (pathname.includes('/admin/produtos-inativos')) return 'INACTIVE_PRODUCTS';
  if (pathname.includes('/admin/produtos')) return 'PRODUCTS';
  if (pathname.includes('/admin/categorias')) return 'CATEGORIES';
  if (pathname.includes('/admin/pedidos')) return 'ORDERS';
  if (pathname.includes('/admin/central-ajuda')) return 'SUPPORT';
  if (pathname.includes('/admin/clientes')) return 'CUSTOMERS';
  if (pathname.includes('/admin/lucro') || pathname.includes('/admin/ranking')) return 'PROFIT_RANKING';
  if (pathname.includes('/admin/configuracoes')) return 'SETTINGS';
  if (pathname.includes('/admin/fase-3')) return 'PHASE3';
  return 'DASHBOARD';
}

import { ForcePasswordChange } from '../components/admin/ForcePasswordChange.tsx';

export const AdminPanelPage: React.FC = () => {
  const { user, apiFetch, toast, logout } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const section = resolveSectionFromPath(location.pathname);

  const openProductsForCategory = (categoryId: number) => {
    setProductPage(1);
    navigate(`/admin/produtos?categoryId=${encodeURIComponent(String(categoryId))}`);
  };

  const setProductCategoryFilter = (categoryId: string) => {
    setProductPage(1);
    const params = new URLSearchParams(location.search);
    if (categoryId) params.set('categoryId', categoryId);
    else params.delete('categoryId');
    navigate(`/admin/produtos${params.size ? `?${params.toString()}` : ''}`);
  };

  const goToSection = (target: AdminSection) => {
    const routes: Record<AdminSection, string> = {
      DASHBOARD: '/admin',
      PRODUCTS: '/admin/produtos',
      INACTIVE_PRODUCTS: '/admin/produtos-inativos',
      STOCK: '/admin/estoque',
      CATEGORIES: '/admin/categorias',
      ORDERS: '/admin/pedidos',
      SUPPORT: '/admin/central-ajuda',
      CUSTOMERS: '/admin/clientes',
      PROFIT_RANKING: '/admin/lucro-ranking',
      SETTINGS: '/admin/configuracoes',
      PHASE3: '/admin/fase-3',
    };
    navigate(routes[target]);
  };

  // State for Dashboard
  const [dashboardData, setDashboardData] = useState<any>(null);
  // State for Categories
  const [categories, setCategories] = useState<any[]>([]);
  // State for Products
  const [products, setProducts] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [productSort, setProductSort] = useState('newest');
  const [productPageMeta, setProductPageMeta] = useState({ totalCount: 0, totalPages: 1 });
  const adminLoadSequence = useRef(0);
  const [prodStockMinimum, setProdStockMinimum] = useState('5');
  // State for Orders
  const [ordersData, setOrdersData] = useState<{
    orders: any[];
    paymentDeadlineHours: number;
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  }>({
    orders: [],
    paymentDeadlineHours: 1,
    page: 1,
    pageSize: 25,
    totalCount: 0,
    totalPages: 0,
  });
  // State for Customers & Addresses
  const [customersData, setCustomersData] = useState<{
    customers: any[];
    freightRule: { baseDistanceKm: number; baseFee: number; extraKmFee: number };
    defaultOrigin: string;
  }>({
    customers: [],
    freightRule: { baseDistanceKm: 4, baseFee: 7.5, extraKmFee: 1.5 },
    defaultOrigin: 'Matriz DeepShop',
  });
  // State for Settings
  const [settingsForm, setSettingsForm] = useState({
    whatsapp_number: '',
    pix_key: '',
    pix_instructions: '',
    freight_base_km: '4.0',
    freight_base_fee: '7.50',
    freight_extra_km_fee: '1.50',
    store_origin_address: '',
    payment_deadline_hours: '0.5',
    cpf_strict_validation_enabled: 'false',
    store_timezone: 'America/Sao_Paulo',
    packaging_cost_per_order: '0.00',
    delivery_cost_per_order: '0.00',
    monthly_fixed_costs: '0.00',
    store_status: 'OPEN',
    store_closed_message: 'A loja está fechada no momento. Volte durante nosso horário de atendimento.',
    accept_orders_when_closed: 'false',
    store_hours: JSON.stringify({
      mon: { enabled: true, open: '09:00', close: '18:00' },
      tue: { enabled: true, open: '09:00', close: '18:00' },
      wed: { enabled: true, open: '09:00', close: '18:00' },
      thu: { enabled: true, open: '09:00', close: '18:00' },
      fri: { enabled: true, open: '09:00', close: '18:00' },
      sat: { enabled: true, open: '09:00', close: '13:00' },
      sun: { enabled: false, open: '09:00', close: '13:00' },
    }),
    company_name: 'DeepShop Delivery',
    company_cnpj: '',
    company_address: '',
    company_email: '',
    company_phone: '',
    privacy_content: '',
    terms_content: '',
    exchange_content: '',
    callmebot_enabled: 'false',
    callmebot_last_sent_at: '',
  });

  // State for Admin New Customer Notifications (Requisito 3)
  const [adminNotifsData, setAdminNotifsData] = useState<{
    notifications: any[];
    unreadCount: number;
    activePopups: any[];
  }>({
    notifications: [],
    unreadCount: 0,
    activePopups: [],
  });
  const [showAdminNotifsDrawer, setShowAdminNotifsDrawer] = useState(false);
  const [notifFreightKmMap, setNotifFreightKmMap] = useState<Record<number, string>>({});
  const [notifFreightFeeMap, setNotifFreightFeeMap] = useState<Record<number, string>>({});
  const [savingNotifFreightId, setSavingNotifFreightId] = useState<number | null>(null);

  // Alerta Sonoro de Novos Pedidos e Novos Clientes (Item 3.3)
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('achadinhos_admin_sound_enabled_v1');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const soundEnabledRef = useRef<boolean>(soundAlertsEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundAlertsEnabled;
  }, [soundAlertsEnabled]);

  const lastSeenMaxOrderIdRef = useRef<number | null>(null);
  const lastSeenMaxNotifIdRef = useRef<number | null>(null);

  const handleToggleSoundAlerts = () => {
    setSoundAlertsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('achadinhos_admin_sound_enabled_v1', String(next));
      } catch {
        // ignore
      }
      if (next) {
        playAdminAlertSound('TEST');
        toast('Alerta sonoro ativado! Você ouvirá um aviso quando chegarem novos pedidos ou clientes.', 'success');
      } else {
        toast('Alerta sonoro silenciado.', 'info');
      }
      return next;
    });
  };

  const [loading, setLoading] = useState(true);

  // Category Form State
  const [showCatForm, setShowCatForm] = useState(false);
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catStatus, setCatStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // Product & Kit Form State
  const [showProdForm, setShowProdForm] = useState(false);
  const [formMode, setFormMode] = useState<'PRODUCT' | 'KIT'>('PRODUCT');
  const [editingProd, setEditingProd] = useState<any | null>(null);
  const [prodCategoryId, setProdCategoryId] = useState<number | ''>('');
  const [prodCode, setProdCode] = useState('A001');
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodPromoPrice, setProdPromoPrice] = useState('');
  const [prodPromoActive, setProdPromoActive] = useState(false);
  const [prodPromoDays, setProdPromoDays] = useState('1');
  const [prodPromoHours, setProdPromoHours] = useState('0');
  const [prodPromoMinutes, setProdPromoMinutes] = useState('0');
  const [prodPromoLimitEnabled, setProdPromoLimitEnabled] = useState(false);
  const [prodPromoMaxUnits, setProdPromoMaxUnits] = useState('5');
  const [prodCost, setProdCost] = useState('');
  const [prodStock, setProdStock] = useState('10');
  const [prodWeight, setProdWeight] = useState('0.200');
  const [prodStatus, setProdStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [prodMediaItems, setProdMediaItems] = useState<ProductMediaItem[]>([]);
  const [newMediaType, setNewMediaType] = useState<'IMAGE' | 'VIDEO'>('IMAGE');
  const [newVideoDuration, setNewVideoDuration] = useState('15');
  const [uploadingImage, setUploadingImage] = useState(false);

  // Kit Assembly State
  const [kitQuantityToBuild, setKitQuantityToBuild] = useState('1');
  const [selectedKitItems, setSelectedKitItems] = useState<Record<number, number>>({});

  // Quick stock reactivation in Inactive Products tab
  const [reactivateStockInputs, setReactivateStockInputs] = useState<Record<number, string>>({});
  const [activatingProductId, setActivatingProductId] = useState<number | null>(null);

  // Address Freight Modal State
  const [freightModalAddr, setFreightModalAddr] = useState<any | null>(null);
  const [freightKmInput, setFreightKmInput] = useState('');
  const [freightFeeInput, setFreightFeeInput] = useState('');
  const [freightOriginInput, setFreightOriginInput] = useState('');
  const [freightNotesInput, setFreightNotesInput] = useState('');
  const [suggestedFeePreview, setSuggestedFeePreview] = useState<number | null>(null);
  const [customerFilter, setCustomerFilter] = useState<
    'ALL' | 'PENDING_FREIGHT' | 'WITH_FREE_DELIVERY'
  >('ALL');

  // Order Detail & Order Freight Edit State
  const [selectedAdminOrder, setSelectedAdminOrder] = useState<any | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderSort, setOrderSort] = useState<'priority' | 'oldest' | 'newest'>('newest');
  const [orderPage, setOrderPage] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);
  const [orderActionPendingId, setOrderActionPendingId] = useState<number | null>(null);
  const orderActionPendingRef = useRef<number | null>(null);
  const [adminLoadError, setAdminLoadError] = useState('');
  const [editingOrderFreight, setEditingOrderFreight] = useState(false);
  const [orderFreightKm, setOrderFreightKm] = useState('');
  const [orderFreightFee, setOrderFreightFee] = useState('');
  const [orderAlsoUpdateAddress, setOrderAlsoUpdateAddress] = useState(true);

  const userId = user?.id;
  const userRole = user?.role;

  const loadOrdersPage = useCallback(async () => {
    if (!userId || !isAdminRole(userRole)) return;
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const params = new URLSearchParams({
        page: String(orderPage),
        pageSize: '25',
        status: orderStatusFilter,
        search: orderSearch.trim(),
        from: orderDateFrom,
        to: orderDateTo,
        sort: orderSort,
      });
      const data = await apiFetch(`/api/admin/orders?${params.toString()}`);
      setOrdersData({
        orders: Array.isArray(data?.orders) ? data.orders : [],
        paymentDeadlineHours: Number(data?.paymentDeadlineHours || 1),
        page: Number(data?.page || orderPage),
        pageSize: Number(data?.pageSize || 25),
        totalCount: Number(data?.totalCount || 0),
        totalPages: Number(data?.totalPages || 0),
      });
    } catch (err: any) {
      const message = err?.message || 'Não foi possível carregar os pedidos.';
      setOrdersError(message);
    } finally {
      setOrdersLoading(false);
    }
  }, [
    userId,
    userRole,
    apiFetch,
    orderPage,
    orderStatusFilter,
    orderSearch,
    orderDateFrom,
    orderDateTo,
    orderSort,
  ]);

  const loadAdminData = useCallback(async () => {
    if (!userId || !isAdminRole(userRole)) return;
    const requestSequence = ++adminLoadSequence.current;
    setLoading(true);
    setAdminLoadError('');
    try {
      const needsDashboard = section === 'DASHBOARD';
      const needsCategories = ['CATEGORIES', 'PRODUCTS', 'INACTIVE_PRODUCTS'].includes(section);
      const needsProducts = ['PRODUCTS', 'INACTIVE_PRODUCTS'].includes(section);
      const needsCustomers = section === 'CUSTOMERS';
      const categoryIdFromUrl = new URLSearchParams(location.search).get('categoryId') || '';
      const productParams = new URLSearchParams({ page: String(productPage), pageSize: '25', search: productSearch, status: section === 'INACTIVE_PRODUCTS' ? 'NON_ACTIVE' : 'ACTIVE', sort: productSort });
      if (categoryIdFromUrl && section === 'PRODUCTS') productParams.set('categoryId', categoryIdFromUrl);
      const [summary, dash, cats, prods, custs, sets, notifs] = await Promise.all([
        apiFetch('/api/admin/dashboard/summary'),
        needsDashboard ? apiFetch('/api/admin/dashboard') : Promise.resolve(null),
        needsCategories ? apiFetch('/api/admin/categories?page=1&pageSize=100') : Promise.resolve(null),
        needsProducts ? apiFetch(`/api/admin/products?${productParams}`) : Promise.resolve(null),
        needsCustomers ? apiFetch('/api/admin/customers?page=1&pageSize=25') : Promise.resolve(null),
        apiFetch('/api/admin/settings'),
        apiFetch('/api/admin/notifications').catch(() => ({
          notifications: [],
          unreadCount: 0,
          activePopups: [],
        })),
      ]);
      if (requestSequence !== adminLoadSequence.current) return;

      if (needsCategories) setCategories(Array.isArray(cats?.categories) ? cats.categories : []);
      if (needsProducts) {
        setProducts(Array.isArray(prods?.products) ? prods.products : []);
        setProductPageMeta({ totalCount: Number(prods?.totalCount || 0), totalPages: Math.max(1, Number(prods?.totalPages || 1)) });
      }
      if (custs) {
        setCustomersData({
          customers: Array.isArray(custs.customers) ? custs.customers : [],
          freightRule: custs.freightRule || { baseDistanceKm: 4, baseFee: 7.5, extraKmFee: 1.5 },
          defaultOrigin: custs.defaultOrigin || 'Matriz DeepShop',
        });
      } else if (sets && typeof sets === 'object') {
        setCustomersData((prev) => ({
          ...prev,
          freightRule: {
            baseDistanceKm: Number(sets.freight_base_km) || 4,
            baseFee: Number(sets.freight_base_fee) || 7.5,
            extraKmFee: Number(sets.freight_extra_km_fee) || 1.5,
          },
          defaultOrigin: sets.store_origin_address || prev.defaultOrigin,
        }));
      }
      if (sets && typeof sets === 'object') {
        setSettingsForm((prev) => ({
          ...prev,
          ...sets,
          cpf_strict_validation_enabled: sets.cpf_strict_validation_enabled || 'false',
        }));
      }

      const maxOrderId = Number(summary?.maxOrderId || 0);
      if (lastSeenMaxOrderIdRef.current === null || maxOrderId > lastSeenMaxOrderIdRef.current) {
        lastSeenMaxOrderIdRef.current = maxOrderId;
      }
      setDashboardData((prev: any) => {
        const base = dash || prev || {};
        return {
          ...base,
          metrics: {
            ...(prev?.metrics || {}),
            ...(dash?.metrics || {}),
            ...(summary?.metrics || {}),
            statusCounts: summary?.statusCounts || dash?.metrics?.statusCounts || {},
          },
          operations: summary,
          alerts: {
            ...(prev?.alerts || {}),
            ...(dash?.alerts || {}),
            ...(summary?.alerts || {}),
          },
          pendingDeliveryOrders: summary?.pendingDeliveryOrders || dash?.pendingDeliveryOrders || [],
          storeState: summary?.storeState || dash?.storeState,
          storeTimezone: summary?.storeTimezone || dash?.storeTimezone || base.storeTimezone,
        };
      });

      if (notifs && typeof notifs === 'object') {
        const loadedNotifs = Array.isArray(notifs.notifications) ? notifs.notifications : [];
        setAdminNotifsData({
          notifications: loadedNotifs,
          unreadCount: Number(notifs.unreadCount || 0),
          activePopups: Array.isArray(notifs.activePopups) ? notifs.activePopups : [],
        });
        const maxNotifId = loadedNotifs.reduce(
          (max: number, n: any) => (n.id > max ? n.id : max),
          0
        );
        if (lastSeenMaxNotifIdRef.current === null || maxNotifId > lastSeenMaxNotifIdRef.current) {
          lastSeenMaxNotifIdRef.current = maxNotifId;
        }
      }
    } catch (err: any) {
      const message = err?.message || 'Não foi possível carregar os dados administrativos.';
      if (requestSequence === adminLoadSequence.current) setAdminLoadError(message);
    } finally {
      if (requestSequence === adminLoadSequence.current) setLoading(false);
    }
  }, [userId, userRole, apiFetch, section, productPage, productSearch, productSort, location.search]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  useEffect(() => {
    if (section !== 'ORDERS' || !userId || !isAdminRole(userRole)) return;
    const timeout = setTimeout(() => {
      void loadOrdersPage();
    }, 250);
    return () => clearTimeout(timeout);
  }, [section, userId, userRole, loadOrdersPage]);

  // Polling limitado: contadores e fila curta no dashboard, sem baixar todas as linhas de pedidos.
  useEffect(() => {
    if (!userId || !isAdminRole(userRole)) return;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [summary, notifs] = await Promise.all([
          apiFetch('/api/admin/dashboard/summary').catch(() => null),
          apiFetch('/api/admin/notifications').catch(() => null),
        ]);
        if (summary && typeof summary === 'object') {
          setDashboardData((prev: any) => ({
            ...(prev || {}),
            operations: summary,
            alerts: {
              ...(prev?.alerts || {}),
              ...(summary.alerts || {}),
            },
            metrics: {
              ...(prev?.metrics || {}),
              ...(summary.metrics || {}),
              statusCounts: summary.statusCounts || {},
            },
            pendingDeliveryOrders: summary.pendingDeliveryOrders || [],
            storeState: summary.storeState,
            storeTimezone: summary.storeTimezone || prev?.storeTimezone,
          }));
          const maxOrderId = Number(summary.maxOrderId || 0);
          if (lastSeenMaxOrderIdRef.current === null) {
            lastSeenMaxOrderIdRef.current = maxOrderId;
          } else if (maxOrderId > lastSeenMaxOrderIdRef.current) {
            lastSeenMaxOrderIdRef.current = maxOrderId;
            if (soundEnabledRef.current) playAdminAlertSound('NEW_ORDER');
            toast(
              `Novo pedido recebido: #${summary.newestOrder?.orderNumber || maxOrderId} (${summary.newestOrder?.customerName || 'Cliente'}).`,
              'success'
            );
          }
        }

        if (section === 'ORDERS') void loadOrdersPage();
        if (notifs && Array.isArray(notifs.notifications)) {
          const maxNotifId = notifs.notifications.reduce(
            (max: number, notification: any) => (notification.id > max ? notification.id : max),
            0
          );
          if (lastSeenMaxNotifIdRef.current !== null && maxNotifId > lastSeenMaxNotifIdRef.current) {
            lastSeenMaxNotifIdRef.current = maxNotifId;
            const newestNotif = notifs.notifications.find((notification: any) => notification.id === maxNotifId);
            if (soundEnabledRef.current) {
              playAdminAlertSound(newestNotif?.type === 'NEW_ORDER' ? 'NEW_ORDER' : 'NEW_CUSTOMER');
            }
            if (newestNotif?.type === 'NEW_ORDER') {
              toast(`Novo pedido recebido: ${newestNotif.title || ''}`, 'success');
            } else if (newestNotif?.type === 'DATA_DELETION_REQUEST') {
              toast('Solicitação de exclusão de dados pendente.', 'error');
            } else {
              toast('Novo cliente cadastrado aguardando definição de frete.', 'info');
            }
          } else if (lastSeenMaxNotifIdRef.current === null) {
            lastSeenMaxNotifIdRef.current = maxNotifId;
          }
          setAdminNotifsData({
            notifications: notifs.notifications || [],
            unreadCount: notifs.unreadCount || 0,
            activePopups: notifs.activePopups || [],
          });
        }
      } catch {
        // Uma falha transitória de polling não interrompe o painel; a lista mostra erros no carregamento solicitado.
      } finally {
        inFlight = false;
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [userId, userRole, apiFetch, toast, section, loadOrdersPage]);

  // Calculate arithmetic freight suggestion locally whenever distance changes
  useEffect(() => {
    const raw = parseFloat(freightKmInput.replace(',', '.'));
    if (isNaN(raw) || raw < 0) {
      setSuggestedFeePreview(null);
      return;
    }
    const baseKm = customersData.freightRule.baseDistanceKm || 4;
    const baseFee = customersData.freightRule.baseFee || 7.5;
    const extraFee = customersData.freightRule.extraKmFee || 1.5;

    if (raw <= baseKm) {
      setSuggestedFeePreview(Number(baseFee.toFixed(2)));
    } else {
      const extra = raw - baseKm;
      setSuggestedFeePreview(Number((baseFee + extra * extraFee).toFixed(2)));
    }
  }, [freightKmInput, customersData.freightRule]);

  if (!user) {
    return (
      <main className="max-w-[560px] mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-zinc-900">Painel Administrativo</h1>
        <p className="text-sm text-zinc-600">
          Faça login com uma conta de perfil ADMIN para gerenciar a loja DeepShop.
        </p>
        <Link
          to="/login?redirect=/admin"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 rounded-lg"
        >
          Entrar como Administrador
        </Link>
      </main>
    );
  }

  // Proteção rigorosa contra acesso de CUSTOMER
  if (!isAdminRole(user.role)) {
    return (
      <main className="max-w-[560px] mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-100 text-red-800 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900">Acesso Restrito ao Administrador</h1>
        <p className="text-sm text-zinc-600">
          Sua conta possui perfil de <strong>CLIENTE</strong>. Apenas usuários com permissão{' '}
          <strong>ADMIN</strong> podem acessar o painel de gestão da loja.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 rounded-lg"
        >
          Voltar para a Vitrine
        </Link>
      </main>
    );
  }

  if (user.mustChangePassword) {
    return <ForcePasswordChange />;
  }

  // Handlers for Categories
  const openNewCategory = () => {
    setEditingCat(null);
    setCatName('');
    setCatDesc('');
    setCatStatus('ACTIVE');
    setShowCatForm(true);
  };

  const openEditCategory = (cat: any) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatDesc(cat.description || '');
    setCatStatus(cat.status);
    setShowCatForm(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCat) {
        await apiFetch(`/api/admin/categories/${editingCat.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: catName, description: catDesc, status: catStatus }),
        });
        toast('Categoria atualizada!', 'success');
      } else {
        await apiFetch('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify({ name: catName, description: catDesc, status: catStatus }),
        });
        toast('Categoria criada!', 'success');
      }
      setShowCatForm(false);
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  // Helpers to suggest next product/kit code (1 letter + 3 digits)
  const suggestNextCode = (prefixLetter: string) => {
    const used = new Set(products.map((p) => String(p.code || '').toUpperCase()));
    for (let i = 1; i <= 999; i++) {
      const candidate = `${prefixLetter.toUpperCase()}${String(i).padStart(3, '0')}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${prefixLetter.toUpperCase()}999`;
  };

  // Handlers for Products & Kits
  const openNewProduct = () => {
    setEditingProd(null);
    setFormMode('PRODUCT');
    setProdCategoryId(categories[0]?.id || '');
    setProdCode(suggestNextCode('P'));
    setProdName('');
    setProdDesc('');
    setProdPrice('');
    setProdPromoPrice('');
    setProdPromoActive(false);
    setProdPromoDays('1');
    setProdPromoHours('0');
    setProdPromoMinutes('0');
    setProdPromoLimitEnabled(false);
    setProdPromoMaxUnits('5');
    setProdCost('');
    setProdStock('10');
    setProdStockMinimum('5');
    setProdWeight('0.200');
    setProdStatus('ACTIVE');
    setProdImageUrl('');
    setProdMediaItems([]);
    setNewMediaType('IMAGE');
    setNewVideoDuration('15');
    setKitQuantityToBuild('1');
    setSelectedKitItems({});
    setShowProdForm(true);
  };

  const openNewKit = () => {
    setEditingProd(null);
    setFormMode('KIT');
    setProdCategoryId(categories[0]?.id || '');
    setProdCode(suggestNextCode('K'));
    setProdName('');
    setProdDesc('');
    setProdPrice('');
    setProdPromoPrice('');
    setProdPromoActive(false);
    setProdPromoDays('1');
    setProdPromoHours('0');
    setProdPromoMinutes('0');
    setProdPromoLimitEnabled(false);
    setProdPromoMaxUnits('5');
    setProdCost('');
    setProdStock('1');
    setProdStockMinimum('5');
    setProdWeight('0.200');
    setProdStatus('ACTIVE');
    setProdImageUrl('');
    setProdMediaItems([]);
    setNewMediaType('IMAGE');
    setNewVideoDuration('15');
    setKitQuantityToBuild('1');
    setSelectedKitItems({});
    setShowProdForm(true);
  };

  const openEditProduct = (prod: any) => {
    setEditingProd(prod);
    setFormMode(prod.isKit ? 'KIT' : 'PRODUCT');
    setSelectedKitItems(Object.fromEntries((prod.kitComponents || []).map((item: any) => [Number(item.componentProductId), Number(item.quantityPerKit)])));
    setProdCategoryId(prod.categoryId);
    setProdCode(prod.code || 'A001');
    setProdName(prod.name);
    setProdDesc(prod.description || '');
    setProdPrice(prod.price);
    setProdPromoPrice(prod.promoPrice ? String(prod.promoPrice) : '');
    setProdPromoActive(Boolean(prod.promoActive));
    if (prod.promoMaxUnits && Number(prod.promoMaxUnits) > 0) {
      setProdPromoLimitEnabled(true);
      setProdPromoMaxUnits(String(prod.promoMaxUnits));
    } else {
      setProdPromoLimitEnabled(false);
      setProdPromoMaxUnits('5');
    }
    if (prod.promoEndsAt && new Date(prod.promoEndsAt).getTime() > Date.now()) {
      const totalMin = Math.max(
        1,
        Math.round((new Date(prod.promoEndsAt).getTime() - Date.now()) / 60000)
      );
      const d = Math.floor(totalMin / 1440);
      const h = Math.floor((totalMin % 1440) / 60);
      const m = totalMin % 60;
      setProdPromoDays(String(d));
      setProdPromoHours(String(h));
      setProdPromoMinutes(String(m));
    } else {
      setProdPromoDays('1');
      setProdPromoHours('0');
      setProdPromoMinutes('0');
    }
    setProdCost(prod.cost !== undefined && prod.cost !== null ? String(prod.cost) : '');
    setProdStock(String(prod.stock ?? 0));
    setProdStockMinimum(String(prod.stockMinimum ?? 5));
    setProdWeight(prod.weight || '0.000');
    setProdStatus(prod.status === 'ARCHIVED' ? 'INACTIVE' : prod.status);
    setProdImageUrl('');
    setNewMediaType('IMAGE');
    setNewVideoDuration('15');
    if (Array.isArray(prod.images) && prod.images.length > 0) {
      setProdMediaItems(
        prod.images.map((m: any, idx: number) => ({
          id: m.id,
          imageUrl: m.imageUrl,
          mediaType: m.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
          durationSeconds: m.durationSeconds ?? null,
          isPrimary: idx === 0,
        }))
      );
    } else if (prod.imageUrl) {
      setProdMediaItems([
        {
          imageUrl: prod.imageUrl,
          mediaType: 'IMAGE',
          durationSeconds: null,
          isPrimary: true,
        },
      ]);
    } else {
      setProdMediaItems([]);
    }
    setShowProdForm(true);
  };

  const toggleKitComponent = (productId: number, defaultQty = 10) => {
    setSelectedKitItems((prev) => {
      const next = { ...prev };
      if (next[productId] !== undefined) {
        delete next[productId];
      } else {
        const prod = products.find((p) => p.id === productId);
        const maxAvail = prod ? Math.max(1, prod.stock) : 1;
        next[productId] = Math.min(defaultQty, maxAvail);
      }
      return next;
    });
  };

  const updateKitComponentQty = (productId: number, qty: number) => {
    setSelectedKitItems((prev) => ({
      ...prev,
      [productId]: Math.max(1, Math.floor(qty || 1)),
    }));
  };

  const currentPhotosCount = prodMediaItems.filter((m) => m.mediaType !== 'VIDEO').length;
  const currentVideosCount = prodMediaItems.filter((m) => m.mediaType === 'VIDEO').length;

  const addMediaByUrl = () => {
    const url = prodImageUrl.trim();
    if (!url) {
      toast('Informe o caminho da foto ou vídeo para adicionar.', 'error');
      return;
    }
    if (!/^\/api\/storage\/[A-Za-z0-9._-]+$/.test(url)) {
      toast('Use apenas mídia enviada pelo painel (/api/storage/...). URLs externas não são permitidas.', 'error');
      return;
    }
    if (newMediaType === 'IMAGE') {
      if (currentPhotosCount >= 5) {
        toast('Limite atingido: cada produto pode ter até 5 fotos.', 'error');
        return;
      }
      setProdMediaItems((prev) => [
        ...prev,
        {
          imageUrl: url,
          mediaType: 'IMAGE',
          durationSeconds: null,
          isPrimary: prev.length === 0,
        },
      ]);
      setProdImageUrl('');
      toast(`Foto adicionada (${currentPhotosCount + 1}/5).`, 'success');
    } else {
      if (currentVideosCount >= 1) {
        toast('Limite atingido: cada produto pode ter no máximo 1 vídeo.', 'error');
        return;
      }
      const dur = Number(newVideoDuration);
      if (isNaN(dur) || dur <= 0 || dur > 30) {
        toast('O vídeo do produto deve ter no máximo 30 segundos.', 'error');
        return;
      }
      setProdMediaItems((prev) => [
        ...prev,
        {
          imageUrl: url,
          mediaType: 'VIDEO',
          durationSeconds: Math.round(dur),
          isPrimary: prev.length === 0,
        },
      ]);
      setProdImageUrl('');
      toast(`Vídeo de ${Math.round(dur)}s adicionado (1/1).`, 'success');
    }
  };

  const removeMediaItem = (index: number) => {
    setProdMediaItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.map((item, idx) => ({ ...item, isPrimary: idx === 0 }));
    });
  };

  const setPrimaryMediaItem = (index: number) => {
    setProdMediaItems((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const chosen = prev[index];
      const rest = prev.filter((_, idx) => idx !== index);
      return [chosen, ...rest].map((item, idx) => ({ ...item, isPrimary: idx === 0 }));
    });
  };

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = 5 - currentPhotosCount;
    if (remainingSlots <= 0) {
      toast('Este produto já possui o limite máximo de 5 fotos.', 'error');
      e.target.value = '';
      return;
    }

    const filesToUpload = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      toast(
        `Apenas ${remainingSlots} foto(s) serão enviadas para respeitar o limite de 5 fotos.`,
        'info'
      );
    }

    setUploadingImage(true);
    try {
      for (const file of filesToUpload) {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
          reader.readAsDataURL(file);
        });

        const res = await apiFetch<{ url: string }>('/api/admin/upload-image', {
          method: 'POST',
          body: JSON.stringify({
            mimeType: file.type || 'image/jpeg',
            dataBase64,
            filename: file.name,
          }),
        });

        setProdMediaItems((prev) => [
          ...prev,
          {
            imageUrl: res.url,
            mediaType: 'IMAGE',
            durationSeconds: null,
            isPrimary: prev.length === 0,
          },
        ]);
      }
      toast('Foto(s) enviada(s) com sucesso!', 'success');
    } catch (err: any) {
      toast(err.message || 'Erro ao enviar imagem.', 'error');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleVideoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (currentVideosCount >= 1) {
      toast(
        'Cada produto pode ter no máximo 1 vídeo (até 30 segundos). Remova o vídeo atual antes de enviar outro.',
        'error'
      );
      e.target.value = '';
      return;
    }

    setUploadingImage(true);
    try {
      const detectedDuration = await new Promise<number>((resolve, reject) => {
        const videoEl = document.createElement('video');
        videoEl.preload = 'metadata';
        const objectUrl = URL.createObjectURL(file);
        videoEl.onloadedmetadata = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(videoEl.duration || 10);
        };
        videoEl.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Não foi possível validar o arquivo de vídeo selecionado.'));
        };
        videoEl.src = objectUrl;
      });

      if (detectedDuration > 30.5) {
        toast(
          `O vídeo selecionado tem ${Math.round(detectedDuration)} segundos. O limite máximo permitido é de 30 segundos.`,
          'error'
        );
        setUploadingImage(false);
        e.target.value = '';
        return;
      }

      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo de vídeo.'));
        reader.readAsDataURL(file);
      });

      const res = await apiFetch<{ url: string }>('/api/admin/upload-image', {
        method: 'POST',
        body: JSON.stringify({
          mimeType: file.type || 'video/mp4',
          dataBase64,
          filename: file.name,
        }),
      });

      const finalDuration = Math.min(30, Math.max(1, Math.round(detectedDuration)));
      setProdMediaItems((prev) => [
        ...prev,
        {
          imageUrl: res.url,
          mediaType: 'VIDEO',
          durationSeconds: finalDuration,
          isPrimary: prev.length === 0,
        },
      ]);
      toast(`Vídeo (${finalDuration}s) enviado com sucesso!`, 'success');
    } catch (err: any) {
      toast(err.message || 'Erro ao enviar vídeo.', 'error');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedCode = prodCode.trim().toUpperCase();
    if (!/^[A-Za-z][0-9]{1,3}$/.test(cleanedCode)) {
      toast(
        'O código do produto deve ter até 4 dígitos: 1 letra e até 3 números (ex: A001, E12, K100).',
        'error'
      );
      return;
    }

    const finalMediaItems: ProductMediaItem[] = [...prodMediaItems];
    if (prodImageUrl.trim() !== '') {
      if (newMediaType === 'VIDEO') {
        const dur = Number(newVideoDuration) || 15;
        if (dur > 30) {
          toast('O vídeo do produto deve ter até 30 segundos.', 'error');
          return;
        }
        if (finalMediaItems.filter((m) => m.mediaType === 'VIDEO').length >= 1) {
          toast('Cada produto pode ter no máximo 1 vídeo de até 30 segundos.', 'error');
          return;
        }
        finalMediaItems.push({
          imageUrl: prodImageUrl.trim(),
          mediaType: 'VIDEO',
          durationSeconds: dur,
          isPrimary: finalMediaItems.length === 0,
        });
      } else {
        if (finalMediaItems.filter((m) => m.mediaType !== 'VIDEO').length >= 5) {
          toast('Cada produto pode ter até 5 fotos.', 'error');
          return;
        }
        finalMediaItems.push({
          imageUrl: prodImageUrl.trim(),
          mediaType: 'IMAGE',
          durationSeconds: null,
          isPrimary: finalMediaItems.length === 0,
        });
      }
    }

    const primaryImageUrl = finalMediaItems[0]?.imageUrl || '';
    const totalPromoMinutes =
      Math.max(0, Math.floor(Number(prodPromoDays) || 0)) * 1440 +
      Math.max(0, Math.floor(Number(prodPromoHours) || 0)) * 60 +
      Math.max(0, Math.floor(Number(prodPromoMinutes) || 0));
    const effectivePromoMinutes = totalPromoMinutes > 0 ? totalPromoMinutes : 1440;
    const isPromoEnabled = prodPromoActive && prodPromoPrice.trim() !== '';
    const parsedPromoMaxUnits =
      isPromoEnabled && prodPromoLimitEnabled
        ? Math.max(1, Math.floor(Number(prodPromoMaxUnits) || 5))
        : null;

    try {
      if (!editingProd && formMode === 'KIT') {
        const componentsArray = Object.entries(selectedKitItems).map(([pid, qty]) => ({
          productId: Number(pid),
          quantityPerKit: Number(qty),
        }));

        if (componentsArray.length === 0) {
          toast(
            'Selecione pelo menos um produto da loja e a quantidade para montar o Kit.',
            'error'
          );
          return;
        }

        await apiFetch('/api/admin/kits', {
          method: 'POST',
          body: JSON.stringify({
            categoryId: Number(prodCategoryId),
            code: cleanedCode,
            name: prodName,
            description: prodDesc,
            price: prodPrice,
            promoPrice: prodPromoPrice.trim() !== '' ? prodPromoPrice : null,
            promoActive: isPromoEnabled,
            promoDurationMinutes: effectivePromoMinutes,
            promoLimitEnabled: prodPromoLimitEnabled,
            promoMaxUnits: parsedPromoMaxUnits,
            cost: prodCost,
            kitsQuantity: Number(kitQuantityToBuild) || 1,
            weight: prodWeight,
            imageUrl: primaryImageUrl,
            mediaItems: finalMediaItems,
            components: componentsArray,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        toast(
          'Kit montado com sucesso! As quantidades foram descontadas do estoque dos produtos originais.',
          'success'
        );
      } else {
        const payload = {
          categoryId: Number(prodCategoryId),
          code: cleanedCode,
          name: prodName,
          description: prodDesc,
          price: prodPrice,
          promoPrice: prodPromoPrice.trim() !== '' ? prodPromoPrice : null,
          promoActive: isPromoEnabled,
          promoDurationMinutes: effectivePromoMinutes,
          promoLimitEnabled: prodPromoLimitEnabled,
          promoMaxUnits: parsedPromoMaxUnits,
          cost: prodCost || '0.00',
          stock: Number(prodStock),
          stockMinimum: Number(prodStockMinimum),
          weight: prodWeight,
          status: prodStatus,
          imageUrl: primaryImageUrl,
          mediaItems: finalMediaItems,
        };
        if (editingProd?.isKit) {
          const componentsArray = Object.entries(selectedKitItems).map(([pid, qty]) => ({ productId: Number(pid), quantityPerKit: Number(qty) }));
          await apiFetch(`/api/admin/kits/${editingProd.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, components: componentsArray, idempotencyKey: crypto.randomUUID() }) });
          toast('Kit e composição atualizados; os componentes foram reconciliados no estoque.', 'success');
        } else if (editingProd) {
          await apiFetch(`/api/admin/products/${editingProd.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Produto atualizado com sucesso!', 'success');
        } else {
          await apiFetch('/api/admin/products', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          toast('Produto cadastrado com sucesso!', 'success');
        }
      }
      setShowProdForm(false);
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleDisassembleKit = async (kitProd: any) => {
    const reason = window.prompt(`Motivo para desmontar o kit ${kitProd.code} - ${kitProd.name}:`, 'Desmontagem de kit pelo painel administrativo');
    if (reason === null || !reason.trim()) return;
    if (!window.confirm(`Desmontar o kit e devolver os componentes ao estoque? A operação ficará registrada.

${kitProd.code} - ${kitProd.name}`)) return;
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/kits/${kitProd.id}/disassemble`, { method: 'POST', body: JSON.stringify({ reason: reason.trim(), idempotencyKey: crypto.randomUUID() }) });
      toast(
        res.message || 'Kit desfeito! Os saldos voltaram para os produtos na vitrine.',
        'success'
      );
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleActivateProductStock = async (prod: any) => {
    const rawVal = reactivateStockInputs[prod.id] ?? (prod.stock > 0 ? String(prod.stock) : '10');
    const stockNum = Math.floor(Number(rawVal));
    if (isNaN(stockNum) || stockNum <= 0) {
      toast('Informe uma quantidade de estoque maior que zero para ativar o produto.', 'error');
      return;
    }

    const reason = window.prompt(`Informe o motivo para ajustar o estoque de ${prod.code} - ${prod.name}:`, 'Reposição conferida pelo administrador');
    if (reason === null || !reason.trim()) return;
    setActivatingProductId(prod.id);
    try {
      await apiFetch('/api/admin/inventory/movements', { method: 'POST', body: JSON.stringify({ productId: prod.id, direction: prod.stock > 0 ? 'SET' : 'IN', quantity: stockNum, reason: reason.trim(), idempotencyKey: crypto.randomUUID() }) });
      if (prod.status !== 'ARCHIVED') await apiFetch(`/api/admin/products/${prod.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'ACTIVE' }) });
      toast(`Ajuste de estoque registrado para ${prod.code} - ${prod.name}.`, 'success');
      await loadAdminData();
    } catch (err: any) {
      toast(err.message || 'Erro ao ativar produto.', 'error');
    } finally {
      setActivatingProductId(null);
    }
  };

  const handleProductStatusChange = async (prod: any, status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED') => {
    if (status === 'ARCHIVED' && !window.confirm(`Arquivar ${prod.code} - ${prod.name}? O histórico será preservado e o registro não será excluído.`)) return;
    try {
      await apiFetch(`/api/admin/products/${prod.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      toast(status === 'ARCHIVED' ? 'Produto arquivado sem apagar o histórico.' : status === 'INACTIVE' ? 'Produto inativado e ocultado da vitrine.' : 'Produto restaurado na vitrine.', 'success');
      await loadAdminData();
    } catch (err: any) { toast(err?.message || 'Não foi possível mudar o status.', 'error'); }
  };

  // Handlers for Address Freight
  const openAddressFreightModal = (addr: any, customerName?: string) => {
    setFreightModalAddr({ ...addr, customerName: customerName || addr.customerName });
    setFreightKmInput(addr.deliveryDistanceKm ? String(addr.deliveryDistanceKm) : '');
    setFreightFeeInput(addr.deliveryFee ? String(addr.deliveryFee) : '');
    setFreightOriginInput(addr.deliveryOrigin || customersData.defaultOrigin);
    setFreightNotesInput(addr.deliveryNotes || '');
  };

  const handleSaveAddressFreight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!freightModalAddr) return;
    try {
      await apiFetch(`/api/admin/addresses/${freightModalAddr.id}/freight`, {
        method: 'PUT',
        body: JSON.stringify({
          distanceKm: freightKmInput,
          deliveryFee: freightFeeInput,
          deliveryOrigin: freightOriginInput,
          deliveryNotes: freightNotesInput,
        }),
      });
      toast('Frete do endereço confirmado e salvo!', 'success');
      setFreightModalAddr(null);
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  // Detalhe carregado só quando solicitado, para não trafegar itens/histórico de toda a lista.
  const handleOpenAdminOrder = async (order: any, editFreight = false) => {
    setSelectedAdminOrder(order);
    setEditingOrderFreight(editFreight);
    setOrdersError('');
    setOrderDetailsLoading(true);
    if (editFreight) {
      setOrderFreightFee('');
      setOrderFreightKm('');
    }
    goToSection('ORDERS');
    try {
      const details = await apiFetch(`/api/admin/orders/${order.id}`);
      setSelectedAdminOrder({ ...order, ...details });
    } catch (err: any) {
      toast(err.message || 'Não foi possível abrir os detalhes do pedido.', 'error');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  // Handlers for Order Status & Order Freight
  const handleChangeOrderStatus = async (orderId: number, newStatus: string, reason?: string) => {
    if (orderActionPendingRef.current !== null) return false;
    orderActionPendingRef.current = orderId;
    setOrderActionPendingId(orderId);
    try {
      await apiFetch(`/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus, ...(reason ? { reason } : {}) }),
      });
      if (newStatus === 'PAID') {
        toast(
          'Status alterado para Pago! Pagamento confirmado, reserva de estoque efetivada e cliente notificado.',
          'success'
        );
      } else if (newStatus === 'CANCELLED') {
        toast(
          'Pedido cancelado! Os produtos reservados foram devolvidos ao estoque da vitrine e o cliente foi notificado.',
          'success'
        );
      } else {
        toast(
          `Status alterado para ${
            ORDER_STATUS_LABELS[newStatus] || newStatus
          } e notificação enviada ao cliente!`,
          'success'
        );
      }
      await Promise.all([loadOrdersPage(), loadAdminData()]);
      if (selectedAdminOrder && selectedAdminOrder.id === orderId) {
        const refreshed = await apiFetch(`/api/admin/orders/${orderId}`);
        setSelectedAdminOrder((prev: any) => (prev ? { ...prev, ...refreshed } : null));
      }
      return true;
    } catch (err: any) {
      toast(err.message, 'error');
      return false;
    } finally {
      orderActionPendingRef.current = null;
      setOrderActionPendingId(null);
    }
  };

  const handleSaveOrderFreight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdminOrder) return;
    try {
      await apiFetch(`/api/admin/orders/${selectedAdminOrder.id}/freight`, {
        method: 'PUT',
        body: JSON.stringify({
          deliveryFee: orderFreightFee,
          deliveryDistanceKm: orderFreightKm,
          alsoUpdateAddress: orderAlsoUpdateAddress,
        }),
      });
      toast(
        'Frete definido! Pagamento liberado para o cliente com prazo de 1h iniciado.',
        'success'
      );
      setEditingOrderFreight(false);
      await Promise.all([loadOrdersPage(), loadAdminData()]);
      const refreshed = await apiFetch(`/api/admin/orders/${selectedAdminOrder.id}`);
      setSelectedAdminOrder((prev: any) => (prev ? { ...prev, ...refreshed } : null));
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleSetOrderManualFreeDelivery = async (orderId: number) => {
    try {
      await apiFetch(`/api/admin/orders/${orderId}/freight`, {
        method: 'PUT',
        body: JSON.stringify({
          deliveryFee: '0.00',
          isManualFreeDelivery: true,
          alsoUpdateAddress: false,
        }),
      });
      toast(
        'Entrega Grátis (R$ 0,00) aplicada! Pagamento liberado ao cliente com prazo de 1h.',
        'success'
      );
      setEditingOrderFreight(false);
      await Promise.all([loadOrdersPage(), loadAdminData()]);
      const refreshed = await apiFetch(`/api/admin/orders/${orderId}`);
      setSelectedAdminOrder((prev: any) => (prev ? { ...prev, ...refreshed } : null));
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  // Handler for Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settingsForm),
      });
      toast('Configurações salvas com sucesso!', 'success');
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleToggleStoreStatus = async () => {
    const nextStatus = settingsForm.store_status === 'OPEN' ? 'CLOSED' : 'OPEN';
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ store_status: nextStatus }),
      });
      setSettingsForm((prev) => ({ ...prev, store_status: nextStatus }));
      toast(nextStatus === 'OPEN' ? 'Loja aberta.' : 'Loja fechada. Novos pedidos foram bloqueados.', 'success');
      if (res) await loadAdminData();
    } catch (err: any) {
      toast(err.message || 'Não foi possível alterar o status da loja.', 'error');
    }
  };

  const handleToggleCpfStrictValidation = async () => {
    const nextValue = settingsForm.cpf_strict_validation_enabled === 'true' ? 'false' : 'true';
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...settingsForm,
          cpf_strict_validation_enabled: nextValue,
        }),
      });
      setSettingsForm((prev) => ({
        ...prev,
        cpf_strict_validation_enabled: nextValue,
      }));
      toast(
        nextValue === 'true'
          ? 'Validação de CPF Real ATIVADA para Produção!'
          : 'Validação de CPF Real INATIVADA para Modo de Teste!',
        'success'
      );
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  // Handlers para Notificações de Novo Cliente no Painel Admin
  const handleNotifKmChange = (notifId: number, rawKm: string) => {
    setNotifFreightKmMap((prev) => ({ ...prev, [notifId]: rawKm }));
    const parsedKm = parseFloat(rawKm.replace(',', '.'));
    if (!isNaN(parsedKm) && parsedKm >= 0) {
      const rule = customersData.freightRule;
      const suggested =
        parsedKm <= rule.baseDistanceKm
          ? rule.baseFee
          : rule.baseFee + (parsedKm - rule.baseDistanceKm) * rule.extraKmFee;
      setNotifFreightFeeMap((prev) => ({ ...prev, [notifId]: suggested.toFixed(2) }));
    }
  };

  const handleSaveFreightFromNotification = async (notif: any) => {
    if (!notif.address?.id) {
      toast('Este cliente não possui endereço vinculado na notificação.', 'error');
      return;
    }
    const kmVal =
      notifFreightKmMap[notif.id] ??
      (notif.address.deliveryDistanceKm ? String(notif.address.deliveryDistanceKm) : '');
    const feeVal =
      notifFreightFeeMap[notif.id] ??
      (notif.address.deliveryFee ? String(notif.address.deliveryFee) : '');

    if (!kmVal || !feeVal) {
      toast('Informe a distância (km) e o valor do frete (R$) para salvar.', 'error');
      return;
    }

    setSavingNotifFreightId(notif.id);
    try {
      await apiFetch(`/api/admin/addresses/${notif.address.id}/freight`, {
        method: 'PUT',
        body: JSON.stringify({
          distanceKm: kmVal,
          deliveryFee: feeVal,
          deliveryOrigin: customersData.defaultOrigin || 'Matriz DeepShop',
          deliveryNotes: 'Cadastrado via notificação de novo cliente',
        }),
      });
      toast(
        `Frete e distância de ${notif.customer?.name || 'cliente'} cadastrados e confirmados!`,
        'success'
      );
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSavingNotifFreightId(null);
    }
  };

  const handleDismissAdminNotifPopup = async (notifId: number) => {
    try {
      await apiFetch(`/api/admin/notifications/${notifId}/dismiss-popup`, { method: 'PUT' });
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleMarkAdminNotifRead = async (notifId: number) => {
    try {
      await apiFetch(`/api/admin/notifications/${notifId}/read`, { method: 'PUT' });
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleMarkAllAdminNotifsRead = async () => {
    try {
      await apiFetch('/api/admin/notifications/read-all', { method: 'PUT' });
      toast('Todas as notificações administrativas foram marcadas como lidas.', 'success');
      await loadAdminData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const pendingAddrCount = Number(
    dashboardData?.alerts?.pendingFreightAddressesCount ?? dashboardData?.alerts?.pendingFreightAddresses?.length ?? 0
  );
  const pendingOrdCount = Number(
    dashboardData?.alerts?.pendingFreightOrdersCount ?? dashboardData?.alerts?.pendingFreightOrders?.length ?? 0
  );
  const activeProductsList = products.filter((p) => p.status === 'ACTIVE');
  const inactiveProductsList = products.filter((p) => p.status !== 'ACTIVE');
  const isStoreActuallyOpen = Boolean(
    dashboardData?.storeState?.isOpen ?? settingsForm.store_status === 'OPEN'
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-[1360px] mx-auto px-4 sm:px-6 py-6 flex flex-col lg:flex-row gap-6 items-start">
      {/* Sidebar Navigation */}
      <AdminSidebar
        section={section}
        goToSection={goToSection}
        pendingAddrCount={pendingAddrCount}
        pendingOrdCount={pendingOrdCount}
        activeProductsCount={Number(dashboardData?.metrics?.activeProductsCount ?? activeProductsList.length)}
        inactiveProductsCount={Number(dashboardData?.metrics?.inactiveProductsCount ?? inactiveProductsList.length)}
        categoriesCount={Number(dashboardData?.metrics?.categoriesCount ?? categories.length)}
        ordersCount={Number(dashboardData?.metrics?.totalOrdersCount ?? ordersData.totalCount)}
      />

      {/* Main Content Area */}
      <main className="min-w-0 w-full flex-1 space-y-6 lg:w-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar à tela anterior</span>
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <Store className="w-3.5 h-3.5" />
              <span>Ver Vitrine da Loja</span>
            </Link>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-600 bg-stone-100 border border-stone-200 rounded-lg" title={user.email}>
              <span className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold">
                {(user.name || 'A').slice(0, 1).toUpperCase()}
              </span>
              {user.name || 'Administrador'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleToggleStoreStatus}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                isStoreActuallyOpen
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
              title={`Estado efetivo da loja. O horário configurado também se aplica; status manual: ${settingsForm.store_status === 'OPEN' ? 'aberto' : 'fechado'}.`}
            >
              <span className={`w-2 h-2 rounded-full ${isStoreActuallyOpen ? 'bg-emerald-600' : 'bg-amber-600'}`} />
              <span>{isStoreActuallyOpen ? 'Loja Aberta' : dashboardData?.storeState?.status === 'OPEN' && !dashboardData?.storeState?.insideHours ? 'Fora do Horário' : 'Loja Fechada'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleSoundAlerts}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                soundAlertsEnabled
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-stone-100 text-zinc-600 border-stone-300 hover:bg-stone-200'
              }`}
              title="Ativar ou silenciar aviso sonoro quando chegarem novos pedidos ou clientes"
            >
              {soundAlertsEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-zinc-500" />
              )}
              <span>Som de Alerta: {soundAlertsEnabled ? 'Ativo' : 'Silenciado'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleCpfStrictValidation}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                settingsForm.cpf_strict_validation_enabled === 'true'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
              title="Alternar validação de CPF real no cadastro de clientes"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                Validação CPF Real:{' '}
                {settingsForm.cpf_strict_validation_enabled === 'true'
                  ? 'Ativa (Produção)'
                  : 'Inativa (Modo Teste)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowAdminNotifsDrawer((prev) => !prev)}
              className="relative inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-zinc-900 bg-white border border-stone-300 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Notificações Admin</span>
              {adminNotifsData.unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-600 text-white rounded-full tabular-nums">
                  {adminNotifsData.unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
              title="Sair da conta de administrador"
            >
              <LogOut className="w-3.5 h-3.5 text-red-600" />
              <span>Sair da Conta</span>
            </button>
          </div>
        </div>

        {/* Alerta em Tempo Real / Pop-up de Novo Cliente Cadastrado */}
        <AdminNewCustomerAlert
          adminNotifsData={adminNotifsData}
          showAdminNotifsDrawer={showAdminNotifsDrawer}
          setShowAdminNotifsDrawer={setShowAdminNotifsDrawer}
          notifFreightKmMap={notifFreightKmMap}
          notifFreightFeeMap={notifFreightFeeMap}
          setNotifFreightFeeMap={setNotifFreightFeeMap}
          savingNotifFreightId={savingNotifFreightId}
          handleMarkAllAdminNotifsRead={handleMarkAllAdminNotifsRead}
          handleMarkAdminNotifRead={handleMarkAdminNotifRead}
          handleDismissAdminNotifPopup={handleDismissAdminNotifPopup}
          handleNotifKmChange={handleNotifKmChange}
          handleSaveFreightFromNotification={handleSaveFreightFromNotification}
          openAddressFreightModal={openAddressFreightModal}
        />

        {adminLoadError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <span>{adminLoadError}</span>
            <button type="button" onClick={() => void loadAdminData()} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-red-100">
              Tentar novamente
            </button>
          </div>
        )}

        {loading && !dashboardData ? (
          <div className="bg-white border border-stone-200 rounded-xl p-8 text-sm text-zinc-500">
            Carregando dados do painel administrativo...
          </div>
        ) : (
          <>
            {/* 1. DASHBOARD */}
            {section === 'DASHBOARD' && dashboardData && (
              <AdminDashboardSection
                dashboardData={dashboardData}
                pendingAddrCount={pendingAddrCount}
                pendingOrdCount={pendingOrdCount}
                orders={ordersData.orders}
                setCustomerFilter={setCustomerFilter}
                setOrderStatusFilter={(value) => {
                  setOrderStatusFilter(value);
                  setOrderPage(1);
                }}
                goToSection={goToSection}
                openAddressFreightModal={openAddressFreightModal}
                openOrderFreightFromAlert={(ord) => void handleOpenAdminOrder(ord, true)}
                openEditProduct={openEditProduct}
                onOpenOrder={(ord) => void handleOpenAdminOrder(ord)}
              />
            )}

            {/* 2. PRODUTOS & KITS E ABA DE PRODUTOS INATIVOS */}
            {(section === 'PRODUCTS' || section === 'INACTIVE_PRODUCTS') && (
              <AdminProductsSection
                section={section}
                goToSection={goToSection}
                products={products}
                productSearch={productSearch}
                setProductSearch={setProductSearch}
                productPage={productPage}
                setProductPage={setProductPage}
                productSort={productSort}
                setProductSort={(value) => { setProductSort(value); setProductPage(1); }}
                productCategoryId={new URLSearchParams(location.search).get('categoryId') || ''}
                onProductCategoryChange={setProductCategoryFilter}
                productTotalCount={productPageMeta.totalCount}
                productTotalPages={productPageMeta.totalPages}
                activeProductCount={Number(dashboardData?.metrics?.activeProductsCount ?? (section === 'PRODUCTS' ? productPageMeta.totalCount : activeProductsList.length))}
                inactiveProductCount={Number(dashboardData?.metrics?.inactiveProductsCount ?? (section === 'INACTIVE_PRODUCTS' ? productPageMeta.totalCount : inactiveProductsList.length))}
                stockMinimum={prodStockMinimum}
                setStockMinimum={setProdStockMinimum}
                onProductStatusChange={handleProductStatusChange}
                activeProductsList={activeProductsList}
                inactiveProductsList={inactiveProductsList}
                categories={categories}
                showProdForm={showProdForm}
                setShowProdForm={setShowProdForm}
                formMode={formMode}
                setFormMode={setFormMode}
                editingProd={editingProd}
                prodCategoryId={prodCategoryId}
                setProdCategoryId={setProdCategoryId}
                prodCode={prodCode}
                setProdCode={setProdCode}
                prodName={prodName}
                setProdName={setProdName}
                prodDesc={prodDesc}
                setProdDesc={setProdDesc}
                prodPrice={prodPrice}
                setProdPrice={setProdPrice}
                prodPromoPrice={prodPromoPrice}
                setProdPromoPrice={setProdPromoPrice}
                prodPromoActive={prodPromoActive}
                setProdPromoActive={setProdPromoActive}
                prodPromoDays={prodPromoDays}
                setProdPromoDays={setProdPromoDays}
                prodPromoHours={prodPromoHours}
                setProdPromoHours={setProdPromoHours}
                prodPromoMinutes={prodPromoMinutes}
                setProdPromoMinutes={setProdPromoMinutes}
                prodPromoLimitEnabled={prodPromoLimitEnabled}
                setProdPromoLimitEnabled={setProdPromoLimitEnabled}
                prodPromoMaxUnits={prodPromoMaxUnits}
                setProdPromoMaxUnits={setProdPromoMaxUnits}
                prodCost={prodCost}
                setProdCost={setProdCost}
                prodStock={prodStock}
                setProdStock={setProdStock}
                prodWeight={prodWeight}
                setProdWeight={setProdWeight}
                prodStatus={prodStatus}
                setProdStatus={setProdStatus}
                prodImageUrl={prodImageUrl}
                setProdImageUrl={setProdImageUrl}
                prodMediaItems={prodMediaItems}
                newMediaType={newMediaType}
                setNewMediaType={setNewMediaType}
                newVideoDuration={newVideoDuration}
                setNewVideoDuration={setNewVideoDuration}
                uploadingImage={uploadingImage}
                kitQuantityToBuild={kitQuantityToBuild}
                setKitQuantityToBuild={setKitQuantityToBuild}
                selectedKitItems={selectedKitItems}
                reactivateStockInputs={reactivateStockInputs}
                setReactivateStockInputs={setReactivateStockInputs}
                activatingProductId={activatingProductId}
                suggestNextCode={suggestNextCode}
                openNewProduct={openNewProduct}
                openNewKit={openNewKit}
                openEditProduct={openEditProduct}
                toggleKitComponent={toggleKitComponent}
                updateKitComponentQty={updateKitComponentQty}
                addMediaByUrl={addMediaByUrl}
                removeMediaItem={removeMediaItem}
                setPrimaryMediaItem={setPrimaryMediaItem}
                handleImageFileUpload={handleImageFileUpload}
                handleVideoFileUpload={handleVideoFileUpload}
                handleSaveProduct={handleSaveProduct}
                handleDisassembleKit={handleDisassembleKit}
                handleActivateProductStock={handleActivateProductStock}
              />
            )}

            {section === 'STOCK' && <AdminInventorySection />}
            {section === 'PHASE3' && <AdminPhase3Section apiFetch={apiFetch} toast={toast} />}
            {section === 'SUPPORT' && <AdminSupportSection apiFetch={apiFetch} toast={toast} />}

            {/* 3. CATEGORIAS */}
            {section === 'CATEGORIES' && (
              <AdminCategoriesSection
                categories={categories}
                showCatForm={showCatForm}
                setShowCatForm={setShowCatForm}
                editingCat={editingCat}
                catName={catName}
                setCatName={setCatName}
                catDesc={catDesc}
                setCatDesc={setCatDesc}
                catStatus={catStatus}
                setCatStatus={setCatStatus}
                openNewCategory={openNewCategory}
                openEditCategory={openEditCategory}
                handleSaveCategory={handleSaveCategory}
                onOpenProducts={openProductsForCategory}
              />
            )}

            {/* 4. PEDIDOS */}
            {section === 'ORDERS' && (
              <AdminOrdersSection
                ordersData={ordersData}
                orderSearch={orderSearch}
                setOrderSearch={(value) => {
                  setOrderSearch(value);
                  setOrderPage(1);
                }}
                orderStatusFilter={orderStatusFilter}
                setOrderStatusFilter={(value) => {
                  setOrderStatusFilter(value);
                  setOrderPage(1);
                }}
                orderDateFrom={orderDateFrom}
                setOrderDateFrom={(value) => {
                  setOrderDateFrom(value);
                  setOrderPage(1);
                }}
                orderDateTo={orderDateTo}
                setOrderDateTo={(value) => {
                  setOrderDateTo(value);
                  setOrderPage(1);
                }}
                orderSort={orderSort}
                setOrderSort={(value) => {
                  setOrderSort(value);
                  setOrderPage(1);
                }}
                onPageChange={setOrderPage}
                ordersLoading={ordersLoading}
                ordersError={ordersError}
                orderDetailsLoading={orderDetailsLoading}
                orderActionPendingId={orderActionPendingId}
                onOpenOrder={(order) => void handleOpenAdminOrder(order)}
                selectedAdminOrder={selectedAdminOrder}
                setSelectedAdminOrder={setSelectedAdminOrder}
                editingOrderFreight={editingOrderFreight}
                setEditingOrderFreight={setEditingOrderFreight}
                orderFreightKm={orderFreightKm}
                setOrderFreightKm={setOrderFreightKm}
                orderFreightFee={orderFreightFee}
                setOrderFreightFee={setOrderFreightFee}
                orderAlsoUpdateAddress={orderAlsoUpdateAddress}
                setOrderAlsoUpdateAddress={setOrderAlsoUpdateAddress}
                freightRule={customersData.freightRule}
                handleSaveOrderFreight={handleSaveOrderFreight}
                handleSetOrderManualFreeDelivery={handleSetOrderManualFreeDelivery}
                handleChangeOrderStatus={handleChangeOrderStatus}
                onRefreshOrders={loadOrdersPage}
              />
            )}

            {/* 5. CLIENTES & FRETE MANUAL */}
            {section === 'CUSTOMERS' && (
              <AdminCustomersSection
                customers={customersData.customers}
                pendingAddrCount={pendingAddrCount}
                customerFilter={customerFilter}
                setCustomerFilter={setCustomerFilter}
                openAddressFreightModal={openAddressFreightModal}
              />
            )}

            {/* 6. LUCRO & RANKING DE PRODUTOS */}
            {section === 'PROFIT_RANKING' && (
              <AdminProfitRankingSection />
            )}

            {/* 7. CONFIGURAÇÕES */}
            {section === 'SETTINGS' && (
              <AdminSettingsSection
                settingsForm={settingsForm}
                setSettingsForm={setSettingsForm}
                handleSaveSettings={handleSaveSettings}
              />
            )}
          </>
        )}
      </main>

      {/* Modal de Definição Manual de Frete por Endereço */}
      <AdminFreightModal
        freightModalAddr={freightModalAddr}
        setFreightModalAddr={setFreightModalAddr}
        freightKmInput={freightKmInput}
        setFreightKmInput={setFreightKmInput}
        freightFeeInput={freightFeeInput}
        setFreightFeeInput={setFreightFeeInput}
        freightOriginInput={freightOriginInput}
        setFreightOriginInput={setFreightOriginInput}
        freightNotesInput={freightNotesInput}
        setFreightNotesInput={setFreightNotesInput}
        suggestedFeePreview={suggestedFeePreview}
        freightRule={customersData.freightRule}
        handleSaveAddressFreight={handleSaveAddressFreight}
      />
    </div>
  );
};
