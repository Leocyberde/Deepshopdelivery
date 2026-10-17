import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link, Navigate } from 'react-router-dom';
import {
  Plus,
  Edit2,
  Trash2,
  ExternalLink,
  Copy,
  ArrowLeft,
  Store,
  Check,
  XCircle,
  Bell,
  X,
  Truck,
  Ticket,
  LogOut,
  LifeBuoy,
} from 'lucide-react';
import {
  useApp,
  isAdminRole,
  formatCurrency,
  formatDateTime,
  formatOrderNumberLabel,
  isItatibaCity,
  ORDER_STATUS_LABELS,
  ProductImage,
  formatCepMask,
  lookupCepAddress,
} from '../context/AppContext.tsx';
import { buildRefundWhatsAppMessage, buildWhatsAppLink } from '../utils/whatsapp.ts';
import { LEGAL_VERSION } from '../config/legal.ts';
import { formatDeliveryDateTime } from '../utils/deliverySchedule.ts';

interface AddressItem {
  id: number;
  label: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  reference: string | null;
  isPrimary?: boolean;
  deliveryDistanceKm: string | null;
  deliveryFee: string | null;
  deliveryFeeStatus: 'PENDING' | 'CONFIRMED';
  freight: {
    status: 'PENDING' | 'CONFIRMED';
    distanceKm: number | null;
    fee: number | null;
    isItatiba?: boolean;
    deliveryMode?: 'DELIVERY' | 'UNAVAILABLE';
    deliveryModeMessage?: string;
    customerMessage: string;
  };
}

interface OrderFulfillmentPart {
  id: number;
  type: 'DELIVERY' | 'PREORDER' | string;
  status: string;
  etaAt?: string | null;
  etaStart?: string | null;
  etaEnd?: string | null;
  deliveredAt?: string | null;
}

const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Aguardando',
  PREPARING: 'Em preparo',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
};

function describeFulfillmentDeadline(part: OrderFulfillmentPart): string | null {
  const tz = 'America/Sao_Paulo';
  const day = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date(value));
  const time = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  if (part.status === 'DELIVERED' && part.deliveredAt) return `Entregue em ${day(part.deliveredAt)} às ${time(part.deliveredAt)}`;
  if (part.status === 'CANCELLED' || part.status === 'REFUNDED') return null;
  if (part.type === 'PREORDER' && part.etaStart && part.etaEnd) return `Chega entre ${day(part.etaStart)} e ${day(part.etaEnd)}`;
  if (part.type !== 'PREORDER' && part.etaAt) return `Previsão: até ${day(part.etaAt)} ${time(part.etaAt)}`;
  return null;
}

interface OrderItem {
  id: number;
  productId: number;
  productName: string;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: string;
  subtotal: string;
}

interface OrderHistoryItem {
  id: number;
  oldStatus: string | null;
  newStatus: string;
  createdAt: string;
}
interface CustomerPaymentSummary {
  provider: string;
  status: string;
  providerStatus: string | null;
  providerPreferenceId: string | null;
  providerPaymentId: string | null;
  amount: string;
  currency: string;
  updatedAt: string;
}
interface CustomerOrder {
  id: number;
  orderNumber: string;
  subtotal: string;
  deliveryFee: string | null;
  deliveryDistanceKm: string | null;
  deliveryFeeSource: string;
  total: string;
  status: string;
  paymentMethod?: string | null;
  payment?: CustomerPaymentSummary | null;
  stockDeducted?: boolean;
  canCustomerCancel?: boolean;
  requiresRefundOnCancel?: boolean;
  refundRequested?: boolean;
  cancellationReason?: string | null;
  refundWhatsappMessage?: string | null;
  refundWhatsappUrl?: string | null;
  notes: string | null;
  createdAt: string;
  deliveryMode?: 'FAST' | 'SCHEDULED' | null;
  deliveryMinutes?: number | null;
  estimatedDeliveryAt?: string | null;
  scheduledDeliveryAt?: string | null;
  addressSnapshot: {
    label: string;
    zipCode: string;
    street: string;
    number: string;
    complement?: string | null;
    neighborhood: string;
    city: string;
    state: string;
    reference?: string | null;
  };
  items: OrderItem[];
  fulfillments?: OrderFulfillmentPart[];
  history: OrderHistoryItem[];
  whatsappMessage: string;
  whatsappUrl: string;
}

const LAST_VIEWED_ORDER_KEY_PREFIX = 'achadinhos_customer_last_viewed_order_v1:';

export const CustomerAccountPage: React.FC = () => {
  const {
    user,
    apiFetch,
    toast,
    refreshUser,
    logout,
    notifications,
    unreadNotificationsCount,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const resolveTabFromPath = (pathname: string) => {
    if (pathname.includes('/notificacoes')) return 'NOTIFICATIONS';
    if (pathname.includes('/pedidos')) return 'ORDERS';
    if (pathname.includes('/perfil')) return 'PROFILE';
    return 'ADDRESSES';
  };

  const [activeTab, setActiveTab] = useState<'ORDERS' | 'ADDRESSES' | 'NOTIFICATIONS' | 'PROFILE'>(
    () => resolveTabFromPath(location.pathname)
  );

  useEffect(() => {
    if (location.pathname.includes('/notificacoes')) {
      setActiveTab('NOTIFICATIONS');
    } else if (location.pathname.includes('/pedidos')) {
      setActiveTab('ORDERS');
    } else if (location.pathname.includes('/perfil')) {
      setActiveTab('PROFILE');
    } else {
      setActiveTab('ADDRESSES');
    }
  }, [location.pathname]);

  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPagination, setOrdersPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1, hasNext: false });
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [paymentActionOrderId, setPaymentActionOrderId] = useState<number | null>(null);
  const paymentKeysRef = useRef<Map<number, string>>(new Map());
  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [delayNotices, setDelayNotices] = useState<any[]>([]);
  const [acceptingLegal, setAcceptingLegal] = useState(false);
  const [requestingDeletion, setRequestingDeletion] = useState(false);

  useEffect(() => {
    if (activeTab !== 'NOTIFICATIONS') return;
    void apiFetch('/api/delay-notices').then((data: any) => setDelayNotices(Array.isArray(data?.notices) ? data.notices : [])).catch(() => setDelayNotices([]));
  }, [activeTab, apiFetch]);

  const answerDelayNotice = async (noticeId: number, choice: 'WAIT' | 'EXCHANGE' | 'REFUND') => {
    try {
      await apiFetch(`/api/delay-notices/${noticeId}/respond`, { method: 'POST', body: JSON.stringify({ choice }) });
      setDelayNotices((current) => current.filter((notice) => notice.id !== noticeId));
      await refreshNotifications();
      toast(choice === 'WAIT' ? 'Novo prazo registrado.' : choice === 'EXCHANGE' ? 'Abrimos um atendimento para a troca.' : 'Reembolso solicitado.', 'success');
    } catch (error: any) { toast(error.message || 'Não foi possível registrar sua escolha.', 'error'); }
  };

  // Cancel Order & Refund Request Modal State
  const [cancellingOrderTarget, setCancellingOrderTarget] = useState<CustomerOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingCancel, setSubmittingCancel] = useState(false);
  const [completedRefundModal, setCompletedRefundModal] = useState<{
    orderNumber: string;
    cancellationReason: string;
    refundWhatsappMessage: string;
    refundWhatsappUrl: string;
  } | null>(null);

  // Address Form Modal/Section
  const [editingAddress, setEditingAddress] = useState<AddressItem | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [label, setLabel] = useState('Casa');
  const [zipCode, setZipCode] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('Itatiba');
  const [state, setState] = useState('SP');
  const [reference, setReference] = useState('');
  const [makePrimary, setMakePrimary] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [cepAutoFilled, setCepAutoFilled] = useState(false);
  const numberInputRef = useRef<HTMLInputElement | null>(null);

  // Profile Form
  const [profName, setProfName] = useState(user?.name || '');
  const [profPhone, setProfPhone] = useState(user?.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [savingProf, setSavingProf] = useState(false);

  useEffect(() => {
    if (user) {
      setProfName(user.name);
      setProfPhone(user.phone);
    }
  }, [user]);

  const loadData = useCallback(async () => {
    if (!user || isAdminRole(user.role)) return;
    setLoading(true);
    try {
      const [ordRes, addrRes] = await Promise.all([
        apiFetch<{ orders: CustomerOrder[]; pagination: typeof ordersPagination }>(`/api/orders?page=${ordersPage}&pageSize=10`),
        apiFetch<AddressItem[]>('/api/addresses'),
      ]);
      setOrders(ordRes?.orders || []);
      setOrdersPagination(ordRes?.pagination || { page: ordersPage, pageSize: 10, total: 0, totalPages: 1, hasNext: false });
      setAddresses(addrRes || []);
      await refreshUser();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user, apiFetch, ordersPage]);

  useEffect(() => {
    if (!user || isAdminRole(user.role) || loading) return;
    try {
      const savedOrderId = Number(
        sessionStorage.getItem(`${LAST_VIEWED_ORDER_KEY_PREFIX}${user.id}`)
      );
      if (!Number.isSafeInteger(savedOrderId) || savedOrderId <= 0) return;
      const savedOrder = orders.find((order) => order.id === savedOrderId);
      if (savedOrder) setSelectedOrder(savedOrder);
    } catch {
      // Armazenamento indisponível: a lista continua funcionando normalmente.
    }
  }, [user, loading, orders]);

  const handleOpenMercadoPagoPayment = async (order: CustomerOrder) => {
    setPaymentActionOrderId(order.id);
    try {
      let idempotencyKey = paymentKeysRef.current.get(order.id);
      if (!idempotencyKey) {
        idempotencyKey = globalThis.crypto?.randomUUID?.() || `mp-${order.id}-${Date.now()}`;
        paymentKeysRef.current.set(order.id, idempotencyKey);
      }
      const result = await apiFetch<{ checkoutUrl: string }>(`/api/orders/${order.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey }),
      });
      const checkout = new URL(result.checkoutUrl);
      if (checkout.protocol !== 'https:' || !/(^|\.)mercadopago\.com(\.br)?$/i.test(checkout.hostname)) {
        throw new Error('O servidor não retornou um endereço seguro de checkout do Mercado Pago.');
      }
      window.location.assign(checkout.toString());
    } catch (err: any) {
      toast(err.message || 'Não foi possível abrir o checkout do Mercado Pago.', 'error');
      setPaymentActionOrderId(null);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (notifications.length > 0) {
      loadData();
    }
  }, [notifications.length, loadData]);

  const openCancelOrderModal = (order: CustomerOrder) => {
    setCancellingOrderTarget(order);
    const isPaid = order.status === 'PAID' || order.status === 'PREPARING';
    setCancelReason(
      isPaid ? 'Desisti da compra antes do envio e solicito o estorno do valor pago.' : ''
    );
  };

  const handleConfirmCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingOrderTarget) return;

    const isPaid =
      cancellingOrderTarget.status === 'PAID' ||
      cancellingOrderTarget.status === 'PREPARING';

    if (isPaid && !cancelReason.trim()) {
      toast('Por favor, informe o motivo do cancelamento para gerar o pedido de estorno.', 'error');
      return;
    }

    setSubmittingCancel(true);
    try {
      const res = await apiFetch<{
        id: number;
        orderNumber: string;
        status: string;
        wasPaid: boolean;
        refundRequested: boolean;
        cancellationReason: string;
        refundWhatsappMessage: string | null;
        refundWhatsappUrl: string | null;
      }>(`/api/orders/${cancellingOrderTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reason:
            cancelReason.trim() ||
            (isPaid
              ? 'Solicitação de cancelamento e estorno pelo cliente antes da entrega.'
              : 'Cancelado pelo cliente antes do pagamento.'),
        }),
      });

      setCancellingOrderTarget(null);
      await loadData();

      if (res.wasPaid && res.refundWhatsappMessage && res.refundWhatsappUrl) {
        setCompletedRefundModal({
          orderNumber: res.orderNumber,
          cancellationReason: res.cancellationReason,
          refundWhatsappMessage: res.refundWhatsappMessage,
          refundWhatsappUrl: res.refundWhatsappUrl,
        });
        toast(
          `Pedido ${res.orderNumber} cancelado! Seu pedido de estorno para o WhatsApp está pronto abaixo.`,
          'success'
        );
      } else {
        toast(
          `Pedido ${res.orderNumber} cancelado com sucesso! A reserva de estoque foi devolvida à vitrine.`,
          'info'
        );
      }
    } catch (err: any) {
      toast(err.message || 'Não foi possível cancelar o pedido.', 'error');
    } finally {
      setSubmittingCancel(false);
    }
  };

  if (!user) {
    return (
      <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-zinc-900">Acesse sua conta</h1>
        <p className="text-sm text-zinc-600">
          Faça login para gerenciar seus endereços, acompanhar pedidos e ver seu perfil.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-zinc-700 bg-stone-100 hover:bg-stone-200 rounded-lg"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar</span>
          </button>
          <Link
            to="/login?redirect=/minha-conta"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 rounded-lg"
          >
            Entrar na Conta
          </Link>
        </div>
      </main>
    );
  }

  if (isAdminRole(user.role)) {
    return <Navigate to="/admin" replace />;
  }

  const openNewAddressForm = () => {
    setEditingAddress(null);
    setLabel('Casa');
    setZipCode('');
    setStreet('');
    setNumber('');
    setComplement('');
    setNeighborhood('');
    setCity('');
    setState('SP');
    setReference('');
    setMakePrimary(addresses.length === 0);
    setCepAutoFilled(false);
    setShowAddressForm(true);
  };

  const openEditAddressForm = (addr: AddressItem) => {
    setEditingAddress(addr);
    setLabel(addr.label);
    setZipCode(addr.zipCode);
    setStreet(addr.street);
    setNumber(addr.number);
    setComplement(addr.complement || '');
    setNeighborhood(addr.neighborhood);
    setCity(addr.city);
    setState(addr.state);
    setReference(addr.reference || '');
    setMakePrimary(Boolean(addr.isPrimary));
    setCepAutoFilled(false);
    setShowAddressForm(true);
  };

  const handleCepChange = async (rawValue: string) => {
    const masked = formatCepMask(rawValue);
    setZipCode(masked);
    const cleanDigits = masked.replace(/\D/g, '');
    if (cleanDigits.length === 8) {
      setLookingUpCep(true);
      try {
        const found = await lookupCepAddress(cleanDigits);
        if (found) {
          if (found.street) setStreet(found.street);
          if (found.neighborhood) setNeighborhood(found.neighborhood);
          if (found.city) setCity(found.city);
          if (found.state) setState(found.state);
          if (!label.trim()) setLabel('Casa');
          setCepAutoFilled(true);
          toast('Endereço preenchido pelo CEP! Informe apenas o número e complemento.', 'success');
          setTimeout(() => {
            numberInputRef.current?.focus();
          }, 50);
        } else {
          setCepAutoFilled(false);
        }
      } finally {
        setLookingUpCep(false);
      }
    } else {
      setCepAutoFilled(false);
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAddr(true);
    try {
      if (editingAddress) {
        const res = await apiFetch<AddressItem & { locationChangedResetFreight?: boolean }>(
          `/api/addresses/${editingAddress.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              label,
              zipCode,
              street,
              number,
              complement,
              neighborhood,
              city,
              state,
              reference,
              isPrimary: makePrimary,
            }),
          }
        );
        if (res.locationChangedResetFreight) {
          toast(
            'Endereço atualizado! A distância será calculada automaticamente.',
            'info'
          );
        } else {
          toast('Apelido/complemento atualizado mantendo o frete atual!', 'success');
        }
      } else {
        const created = await apiFetch<AddressItem>('/api/addresses', {
          method: 'POST',
          body: JSON.stringify({
            label,
            zipCode,
            street,
            number,
            complement,
            neighborhood,
            city,
            state,
            reference,
          }),
        });
        if (isItatibaCity(created.city || city)) {
          toast('Endereço em Itatiba cadastrado! Temos delivery para sua região.', 'success');
        } else {
          toast(
            'Endereço cadastrado! Atendemos apenas Itatiba.',
            'info'
          );
        }
      }
      setShowAddressForm(false);
      setEditingAddress(null);
      await loadData();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSavingAddr(false);
    }
  };

  const handleDeleteAddress = async (id: number) => {
    try {
      await apiFetch(`/api/addresses/${id}`, { method: 'DELETE' });
      toast('Endereço removido. Seus pedidos anteriores permanecem inalterados.', 'info');
      await loadData();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProf(true);
    try {
      const result = await apiFetch<{ sessionInvalidated?: boolean }>('/api/auth/profile', {
        method: 'PUT', body: JSON.stringify({ name: profName, phone: profPhone, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined, confirmNewPassword: confirmNewPassword || undefined }),
      });
      setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('');
      if (result.sessionInvalidated) { logout(); navigate('/login?redirect=/minha-conta/perfil', { replace: true }); return; }
      await refreshUser(); toast('Perfil atualizado com sucesso!', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSavingProf(false);
    }
  };

  const needsLegalAcceptance = Boolean(
    user && user.role === 'CUSTOMER' &&
    (user.privacyVersion !== LEGAL_VERSION || user.termsVersion !== LEGAL_VERSION)
  );

  const handleAcceptLegal = async () => {
    setAcceptingLegal(true);
    try {
      await apiFetch('/api/auth/accept-legal', { method: 'POST' });
      await refreshUser();
      toast('Aceite das informações legais registrado.', 'success');
    } catch (err: any) {
      toast(err.message || 'Não foi possível registrar o aceite.', 'error');
    } finally {
      setAcceptingLegal(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (!window.confirm('Deseja solicitar a exclusão dos seus dados? A loja precisará tratar o pedido antes de excluir dados que tenham obrigação legal de retenção.')) return;
    setRequestingDeletion(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/request-deletion', { method: 'POST' });
      toast(res.message || 'Solicitação registrada.', 'success');
      await refreshUser();
    } catch (err: any) {
      toast(err.message || 'Não foi possível solicitar a exclusão.', 'error');
    } finally {
      setRequestingDeletion(false);
    }
  };

  return (
    <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Top Navigation Bar: Voltar & Ir para a Vitrine */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
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
            <span>Ir para a Vitrine</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
            title="Desconectar e sair da conta"
          >
            <LogOut className="w-3.5 h-3.5 text-red-600" />
            <span>Sair da Conta</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Minha Conta</h1>
          <div className="text-xs text-zinc-500 mt-0.5">
            <span>{user.name}</span>
            <span aria-hidden="true">•</span>
            <span>{user.email}</span>
            <span aria-hidden="true">•</span>
            <span>Tel: {user.phone}</span>
          </div>
        </div>

        {/* Interactive Tab Selector */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-stone-200/60 rounded-lg self-start">
          <button
            type="button"
            onClick={() => {
              setActiveTab('ORDERS');
              navigate('/minha-conta/pedidos', { replace: true });
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'ORDERS'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Meus Pedidos ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ADDRESSES');
              navigate('/minha-conta', { replace: true });
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'ADDRESSES'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Meus Endereços ({addresses.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('NOTIFICATIONS');
              refreshNotifications();
              navigate('/minha-conta/notificacoes', { replace: true });
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'NOTIFICATIONS'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notificações ({notifications.length})</span>
            {unreadNotificationsCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-700 text-white tabular-nums">
                {unreadNotificationsCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('PROFILE');
              navigate('/minha-conta', { replace: true });
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'PROFILE'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Meu Perfil
          </button>
          <button
            type="button"
            onClick={() => navigate('/minha-conta/central-ajuda')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap text-zinc-700 hover:text-zinc-900 hover:bg-white/70"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Central de Ajuda</span>
          </button>
        </div>
      </div>

      {needsLegalAcceptance && (
        <section className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-3">
          <div><h2 className="text-sm font-bold text-amber-950">Atualização dos documentos legais</h2><p className="text-xs text-amber-900 mt-1">A Política de Privacidade e/ou os Termos de Uso foram atualizados. Consulte os documentos e registre seu novo aceite.</p></div>
          <div className="flex flex-wrap gap-3 text-xs font-semibold"><Link to="/privacidade" className="underline">Política de Privacidade</Link><Link to="/termos" className="underline">Termos de Uso</Link><button type="button" onClick={handleAcceptLegal} disabled={acceptingLegal} className="px-3 py-2 rounded-lg bg-zinc-900 text-white disabled:opacity-50">{acceptingLegal ? 'Registrando...' : 'Li e aceito a versão atual'}</button></div>
        </section>
      )}

      {activeTab === 'ORDERS' && (
        <section className="space-y-6">
          {loading ? (
            <div className="text-sm text-zinc-500">Carregando seus pedidos...</div>
          ) : orders.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-base font-semibold text-zinc-900">
                Você ainda não realizou nenhum pedido.
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 rounded-lg"
              >
                Conhecer Produtos na Vitrine
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const isExpanded = selectedOrder?.id === order.id;
                const isFirstOrderFree = Number(order.deliveryFee) === 0;
                const freeDeliveryLabel = order.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD' ? 'Frete grátis (benefício da loja)' : 'Frete grátis';
                const hasConfirmedFreight =
                  isFirstOrderFree ||
                  (order.deliveryFee !== null &&
                    order.deliveryFee !== undefined &&
                    order.deliveryFee !== '');
                const canCustomerCancel = ['NEW', 'AWAITING_PAYMENT', 'PAID', 'PREPARING'].includes(
                  order.status
                );
                const isPaidBeforeDelivery =
                  order.status === 'PAID' || order.status === 'PREPARING';

                return (
                  <div
                    key={order.id}
                    className="bg-white border border-stone-200 rounded-xl overflow-hidden"
                  >
                    <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-2.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span className="font-mono font-bold text-sm text-zinc-900">
                            {formatOrderNumberLabel(order.orderNumber)}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span>{formatDateTime(order.createdAt)}</span>
                          <span aria-hidden="true">•</span>
                          <span
                            className={`font-semibold ${
                              order.status === 'CANCELLED'
                                ? 'text-red-700'
                                : order.status === 'PAID' ||
                                  order.status === 'OUT_FOR_DELIVERY' ||
                                  order.status === 'DELIVERED'
                                ? 'text-emerald-800'
                                : 'text-zinc-900'
                            }`}
                          >
                            Status: {ORDER_STATUS_LABELS[order.status] || order.status}
                          </span>
                          {isFirstOrderFree && (
                            <>
                              <span aria-hidden="true">•</span>
                              <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
                                {freeDeliveryLabel}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Lista de Produtos com Foto */}
                        <div className="space-y-1.5 pt-0.5">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex items-center gap-2.5 text-xs">
                              <div className="w-9 h-9 rounded-md overflow-hidden bg-[#F9F9F8] border border-stone-200 shrink-0">
                                <ProductImage src={item.imageUrl} alt={item.productName} />
                              </div>
                              <span className="text-zinc-800">
                                <strong className="tabular-nums font-semibold">
                                  {item.quantity}x
                                </strong>{' '}
                                {item.productName}{' '}
                                <span className="text-zinc-400 tabular-nums">
                                  ({formatCurrency(item.unitPrice)})
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="text-xs text-zinc-600">
                          Endereço registrado no pedido ({order.addressSnapshot.label}):{' '}
                          {order.addressSnapshot.street}, {order.addressSnapshot.number} —{' '}
                          {order.addressSnapshot.neighborhood}, {order.addressSnapshot.city}/
                          {order.addressSnapshot.state}
                        </div>

                        {order.status === 'CANCELLED' &&
                          order.refundRequested &&
                          order.refundWhatsappUrl && (
                            <div className="mt-2 p-3.5 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                              <div className="text-xs font-bold text-amber-950">
                                Pedido de Estorno Preenchido para o WhatsApp
                              </div>
                              {order.cancellationReason && (
                                <div className="text-xs text-amber-900">
                                  <strong>Motivo informado:</strong> {order.cancellationReason}
                                </div>
                              )}
                              {order.refundWhatsappMessage && (
                                <pre className="p-2.5 rounded bg-white border border-amber-200 text-[11px] font-mono text-zinc-800 whitespace-pre-wrap">
                                  {order.refundWhatsappMessage}
                                </pre>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={order.refundWhatsappUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                                >
                                  <span>Enviar Pedido de Estorno no WhatsApp</span>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                                {order.refundWhatsappMessage && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(
                                        order.refundWhatsappMessage || ''
                                      );
                                      toast('Pedido de estorno copiado!', 'success');
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-amber-300 hover:bg-stone-50 rounded-lg transition-colors"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copiar Pedido de Estorno</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="text-right mr-1">
                          <div className="text-sm font-bold text-zinc-900 tabular-nums">
                            {hasConfirmedFreight
                              ? formatCurrency(order.total)
                              : `${formatCurrency(order.subtotal)} + frete indisponível no histórico`}
                          </div>
                          <div className="text-[11px] text-zinc-500 tabular-nums">
                            {isFirstOrderFree
                              ? `Frete: Grátis (${freeDeliveryLabel})`
                              : hasConfirmedFreight
                              ? `Frete: ${formatCurrency(order.deliveryFee)}`
                              : 'Frete: indisponível no histórico'}
                          </div>
                        </div>

                        {canCustomerCancel && (
                          <button
                            type="button"
                            onClick={() => openCancelOrderModal(order)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>
                              {isPaidBeforeDelivery
                                ? 'Cancelar Pedido (Solicitar Estorno)'
                                : 'Cancelar Pedido'}
                            </span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            const nextOrder = isExpanded ? null : order;
                            setSelectedOrder(nextOrder);
                            try {
                              const key = `${LAST_VIEWED_ORDER_KEY_PREFIX}${user.id}`;
                              if (nextOrder) sessionStorage.setItem(key, String(nextOrder.id));
                              else sessionStorage.removeItem(key);
                            } catch {
                              // A expansão permanece funcional mesmo sem sessionStorage.
                            }
                          }}
                          className="px-3.5 py-2 text-xs font-semibold text-zinc-800 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {isExpanded ? 'Fechar Detalhes' : 'Ver Detalhes'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-stone-200 bg-stone-50/70 p-5 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-700">Dúvidas sobre o pedido?</span>
                          <Link
                            to={order.status === 'DELIVERED'
                              ? `/minha-conta/central-ajuda?orderId=${order.id}&postDelivery=1`
                              : `/minha-conta/central-ajuda?orderId=${order.id}&create=1`}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                          >
                            <LifeBuoy className="w-3.5 h-3.5" />
                            <span>{order.status === 'DELIVERED' ? 'Precisa de ajuda com este pedido?' : 'Falar com a loja sobre este pedido'}</span>
                          </Link>
                        </div>
                        {Array.isArray(order.fulfillments) && order.fulfillments.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-zinc-900">Entrega do pedido</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              {order.fulfillments.map((part) => (
                                <div key={part.id} className="bg-white border border-stone-200 rounded-lg p-3">
                                  <div className="font-semibold text-zinc-900">{part.type === 'PREORDER' ? 'Encomenda' : 'Delivery'}</div>
                                  <div className="text-zinc-600">{FULFILLMENT_STATUS_LABELS[part.status] || part.status}</div>
                                  {describeFulfillmentDeadline(part) && <div className="text-zinc-500">{describeFulfillmentDeadline(part)}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <h3 className="text-xs font-bold text-zinc-900">Itens Comprados</h3>
                            <div className="divide-y divide-stone-200 text-xs bg-white border border-stone-200 rounded-lg p-3">
                              {order.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="py-2.5 flex items-center justify-between gap-3"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-md overflow-hidden bg-[#F9F9F8] border border-stone-200 shrink-0">
                                      <ProductImage src={item.imageUrl} alt={item.productName} />
                                    </div>
                                    <div>
                                      <div className="font-medium text-zinc-900">
                                        <strong className="tabular-nums">{item.quantity}x</strong>{' '}
                                        {item.productName}
                                      </div>
                                      <div className="text-[11px] text-zinc-400 tabular-nums">
                                        Unitário: {formatCurrency(item.unitPrice)}
                                      </div>
                                    </div>
                                  </div>
                                  <span className="font-semibold tabular-nums shrink-0">
                                    {formatCurrency(item.subtotal)}
                                  </span>
                                </div>
                              ))}
                              <div className="pt-2.5 space-y-1">
                                <div className="flex justify-between text-zinc-600">
                                  <span>Subtotal</span>
                                  <span className="tabular-nums">
                                    {formatCurrency(order.subtotal)}
                                  </span>
                                </div>
                                <div className="flex justify-between text-zinc-600">
                                  <span>Frete</span>
                                  <span className="tabular-nums">
                                    {isFirstOrderFree
                                      ? `Grátis (${freeDeliveryLabel})`
                                      : hasConfirmedFreight
                                      ? formatCurrency(order.deliveryFee)
                                      : 'A combinar'}
                                  </span>
                                </div>
                                <div className="flex justify-between font-bold text-zinc-900 pt-1">
                                  <span>
                                    {hasConfirmedFreight ? 'Total' : 'Total (sem o frete)'}
                                  </span>
                                  <span className="tabular-nums">
                                    {formatCurrency(
                                      hasConfirmedFreight ? order.total : order.subtotal
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {String(order.paymentMethod || '').toUpperCase() === 'MERCADOPAGO' &&
                              ['NEW', 'AWAITING_PAYMENT'].includes(order.status) &&
                              order.payment?.status !== 'PAID' && hasConfirmedFreight && (
                                <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleOpenMercadoPagoPayment(order)}
                                    disabled={paymentActionOrderId === order.id}
                                    className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                                  >
                                    {paymentActionOrderId === order.id ? 'Abrindo checkout…' : 'Pagar ou retomar pagamento'}
                                  </button>
                                </div>
                              )}
                          </div>

                          <div className="space-y-3">
                            <h3 className="text-xs font-bold text-zinc-900">
                              Endereço Registrado no Pedido
                            </h3>
                            <div className="p-3.5 bg-white border border-stone-200 rounded-lg text-xs text-zinc-700 space-y-1">
                              <div className="font-semibold text-zinc-900">
                                {order.addressSnapshot.label} — CEP {order.addressSnapshot.zipCode}
                              </div>
                              <div>
                                {order.addressSnapshot.street}, {order.addressSnapshot.number}
                                {order.addressSnapshot.complement
                                  ? ` (${order.addressSnapshot.complement})`
                                  : ''}
                              </div>
                              <div>
                                {order.addressSnapshot.neighborhood} — {order.addressSnapshot.city}/
                                {order.addressSnapshot.state}
                              </div>
                              {order.addressSnapshot.reference && (
                                <div className="text-zinc-500">
                                  Ref: {order.addressSnapshot.reference}
                                </div>
                              )}
                            </div>
                            <div className="p-3.5 bg-white border border-stone-200 rounded-lg text-xs text-zinc-700 space-y-1">
                              <div className="font-semibold text-zinc-900">Prazo de entrega</div>
                              {order.deliveryMode === 'FAST' && order.deliveryMinutes && order.estimatedDeliveryAt ? (
                                <div>Em até {order.deliveryMinutes} minutos — previsão até {formatDeliveryDateTime(order.estimatedDeliveryAt)}</div>
                              ) : order.deliveryMode === 'SCHEDULED' && order.scheduledDeliveryAt ? (
                                <div>Agendado para {formatDeliveryDateTime(order.scheduledDeliveryAt)}</div>
                              ) : (
                                <div className="text-zinc-500">Prazo não informado neste pedido antigo.</div>
                              )}
                            </div>

                            <div className="pt-1 space-y-2">
                              {canCustomerCancel && (
                                <button
                                  type="button"
                                  onClick={() => openCancelOrderModal(order)}
                                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>
                                    {isPaidBeforeDelivery
                                      ? 'Cancelar Pedido e Solicitar Estorno via WhatsApp'
                                      : 'Cancelar Pedido'}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!loading && ordersPagination.totalPages > 1 && <div className="flex items-center justify-between border-t border-stone-200 pt-4 text-xs"><button type="button" disabled={ordersPage <= 1} onClick={() => setOrdersPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-stone-300 px-3 py-2 disabled:opacity-40">Anterior</button><span>Página {ordersPage} de {ordersPagination.totalPages}</span><button type="button" disabled={!ordersPagination.hasNext} onClick={() => setOrdersPage((page) => page + 1)} className="rounded-lg border border-stone-300 px-3 py-2 disabled:opacity-40">Próxima</button></div>}
        </section>
      )}

      {/* TAB 2: MEUS ENDEREÇOS */}
      {activeTab === 'ADDRESSES' && (
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Endereços de Entrega</h2>
              <p className="text-xs text-zinc-500">
                A distância é calculada automaticamente. Alterar CEP ou número atualiza a cotação.
                Alterar apenas o apelido mantém o frete confirmado.
              </p>
            </div>
            {!showAddressForm && (
              <button
                type="button"
                onClick={openNewAddressForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors self-start"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Cadastrar Endereço</span>
              </button>
            )}
          </div>

          {showAddressForm && (
            <form
              onSubmit={handleSaveAddress}
              className="bg-white border border-stone-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                <h3 className="text-sm font-bold text-zinc-900">
                  {editingAddress
                    ? `Editar Endereço (${editingAddress.label})`
                    : 'Novo Endereço de Entrega'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddressForm(false);
                    setEditingAddress(null);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-900"
                >
                  Cancelar
                </button>
              </div>

              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                  <div className="sm:col-span-4 space-y-1">
                    <label className="block text-xs font-bold text-zinc-900">
                      1º Passo — Digite seu CEP
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={9}
                      value={zipCode}
                      onChange={(e) => handleCepChange(e.target.value)}
                      placeholder="Ex: 01310-100"
                      className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div className="sm:col-span-4 space-y-1">
                    <label className="block text-xs font-bold text-zinc-900">
                      Número da Residência/Local
                    </label>
                    <input
                      ref={numberInputRef}
                      type="text"
                      required
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      placeholder="Ex: 120"
                      className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div className="sm:col-span-4 space-y-1">
                    <label className="block text-xs font-semibold text-zinc-700">
                      Complemento (opcional)
                    </label>
                    <input
                      type="text"
                      value={complement}
                      onChange={(e) => setComplement(e.target.value)}
                      placeholder="Ex: Apto 42, Bloco B, Casa 2"
                      className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                    />
                  </div>
                </div>
                {lookingUpCep && (
                  <div className="text-xs font-medium text-zinc-600">
                    Buscando endereço pelo CEP automaticamente...
                  </div>
                )}
                {cepAutoFilled && !lookingUpCep && (
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      Endereço preenchido automaticamente pelo CEP! Confira abaixo e informe apenas o{' '}
                      <strong>Número</strong> e <strong>Complemento</strong>.
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-6 space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Rua / Avenida (preenchido pelo CEP)
                  </label>
                  <input
                    type="text"
                    required
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    placeholder="Preenchido automaticamente ao digitar o CEP"
                    className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-6 space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Bairro (preenchido pelo CEP)
                  </label>
                  <input
                    type="text"
                    required
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    placeholder="Preenchido automaticamente ao digitar o CEP"
                    className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-5 space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Cidade (preenchida pelo CEP)
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">UF</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg uppercase"
                  />
                </div>
                <div className="sm:col-span-5 space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Apelido do Endereço (Casa, Trabalho...)
                  </label>
                  <input
                    type="text"
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ex: Casa"
                    className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                  />
                </div>
              </div>

              {city.trim() !== '' && (
                <div
                  className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 ${
                    isItatibaCity(city)
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <Truck
                    className={`w-4 h-4 shrink-0 ${
                      isItatibaCity(city) ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  />
                  {isItatibaCity(city) ? (
                    <span>
                      Cidade conferida: <strong>{city.trim()}</strong> —{' '}
                      <strong>Temos delivery!</strong> Entrega rápida disponível na região de
                      Itatiba.
                    </span>
                  ) : (
                    <span>
                      Cidade conferida: <strong>{city.trim()}</strong> —{' '}
                      <strong>Atendemos apenas Itatiba</strong>
                    </span>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700"><input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} /> Definir como endereço principal</label>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">
                  Ponto de Referência (opcional)
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ex: Próximo à padaria, portão branco"
                  className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savingAddr}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  {savingAddr ? 'Salvando...' : 'Salvar Endereço'}
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((addr) => {
              const confirmed = addr.freight.status === 'CONFIRMED';
              return (
                <div
                  key={addr.id}
                  className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-bold text-zinc-900">{addr.label}</span>{addr.isPrimary && <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Principal</span>}
                      <span className="text-xs text-zinc-500 tabular-nums">CEP {addr.zipCode}</span>
                    </div>
                    <p className="text-xs text-zinc-700">
                      {addr.street}, {addr.number}
                      {addr.complement ? ` (${addr.complement})` : ''} — {addr.neighborhood},{' '}
                      {addr.city}/{addr.state}
                    </p>
                    {addr.reference && (
                      <p className="text-xs text-zinc-500">Referência: {addr.reference}</p>
                    )}
                    <div className="pt-2 space-y-1.5">
                      {isItatibaCity(addr.city) ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900">
                          <Truck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span>Cidade: Itatiba — Temos delivery</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900">
                          <Truck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                          <span>Atendemos apenas Itatiba</span>
                        </div>
                      )}
                      {confirmed ? (
                        <div className="text-xs font-semibold text-emerald-800 tabular-nums">
                          Frete confirmado: {formatCurrency(addr.freight.fee)}
                        </div>
                      ) : isItatibaCity(addr.city) ? (
                        <div className="text-xs font-medium text-amber-800">
                          Não conseguimos calcular o frete agora
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="border-t border-stone-100 pt-3 flex items-center justify-end gap-3">
                    {!addr.isPrimary && <button type="button" onClick={async () => { try { await apiFetch(`/api/addresses/${addr.id}/primary`, { method: 'POST' }); await loadData(); toast('Endereço principal atualizado.', 'success'); } catch (err: any) { toast(err.message, 'error'); } }} className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">Tornar principal</button>}
                    <button
                      type="button"
                      onClick={() => openEditAddressForm(addr)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 hover:text-zinc-900"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(addr.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === 'NOTIFICATIONS' && (
        <section className="max-w-3xl space-y-3" aria-label="Notificações">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-4">
            <div><h2 className="text-base font-bold text-zinc-900">Notificações</h2><p className="mt-1 text-xs text-zinc-600">Avisos de pedidos e novas mensagens da loja.</p></div>
            {unreadNotificationsCount > 0 && <button type="button" onClick={() => void markAllNotificationsRead()} className="text-xs font-semibold text-emerald-800 underline">Marcar todas como lidas</button>}
          </div>
          {delayNotices.map((notice) => <article key={notice.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="text-sm font-bold text-amber-950">Aviso de atraso</h3><p className="mt-1 text-xs leading-relaxed text-amber-900">{notice.message}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void answerDelayNotice(notice.id, 'WAIT')} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">Aguardar novo prazo</button><button type="button" onClick={() => void answerDelayNotice(notice.id, 'EXCHANGE')} className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-xs font-semibold text-amber-950">Trocar produto</button><button type="button" onClick={() => void answerDelayNotice(notice.id, 'REFUND')} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800">Solicitar reembolso</button></div></article>)}
          {notifications.length === 0 && delayNotices.length === 0 ? <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-zinc-500">Você não tem notificações.</div> : notifications.map((notification) => (
            <article key={notification.id} className={`rounded-xl border p-4 ${notification.isRead ? 'border-stone-200 bg-white' : 'border-emerald-200 bg-emerald-50/50'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-bold text-zinc-900">{notification.title}</h3><time className="text-[11px] text-zinc-500">{formatDateTime(notification.createdAt)}</time></div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700">{notification.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {notification.supportTicketId ? <Link to={`/minha-conta/central-ajuda?ticketId=${notification.supportTicketId}`} onClick={() => void markNotificationRead(notification.id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Abrir conversa #{notification.supportTicketId}</Link> : notification.orderId ? <Link to="/minha-conta/pedidos" onClick={() => void markNotificationRead(notification.id)} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">Ver pedido</Link> : null}
                {!notification.isRead && <button type="button" onClick={() => void markNotificationRead(notification.id)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700">Marcar como lida</button>}
              </div>
            </article>
          ))}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs text-emerald-950">Precisa de ajuda? <Link to="/minha-conta/central-ajuda" className="font-bold underline">Acesse a Central de Ajuda</Link> para ver conversas ativas e encerradas.</p></div>
        </section>
      )}

      {/* TAB 3: MEU PERFIL */}
      {activeTab === 'PROFILE' && (
        <section className="max-w-[520px] bg-white border border-stone-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-bold text-zinc-900">Dados Pessoais</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">E-mail (login)</label>
                <input
                  type="email"
                  disabled
                  value={user.email}
                  className="w-full px-3.5 py-2 text-sm bg-stone-100 border border-stone-200 rounded-lg text-zinc-500"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">CPF cadastrado</label>
                <input
                  type="text"
                  disabled
                  value={user.cpf || 'Não informado'}
                  className="w-full px-3.5 py-2 text-sm bg-stone-100 border border-stone-200 rounded-lg text-zinc-500 font-mono"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">Nome completo</label>
              <input
                type="text"
                required
                value={profName}
                onChange={(e) => setProfName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Telefone / WhatsApp
              </label>
              <input
                type="tel"
                required
                value={profPhone}
                onChange={(e) => setProfPhone(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
              />
            </div>
            <div className="space-y-3 border-t border-stone-200 pt-4">
              <div className="text-xs font-bold text-zinc-900">Trocar senha</div>
              <input type="password" minLength={8} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Senha atual" className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg" />
              <input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha (8 a 128 caracteres)" className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg" />
              <input type="password" minLength={8} value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="Confirme a nova senha" className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg" />
              <p className="text-[11px] text-zinc-500">Ao trocar a senha, todas as outras sessões serão encerradas.</p>
            </div>
            <button
              type="submit"
              disabled={savingProf}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              {savingProf ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </form>

          <div className="pt-5 border-t border-stone-200 space-y-2">
            <div className="text-xs font-bold text-zinc-900">Privacidade e exclusão de dados</div>
            <p className="text-[11px] text-zinc-500">Você pode solicitar a exclusão dos seus dados. A loja avaliará o pedido conforme a LGPD e eventuais obrigações legais de retenção.</p>
            <div className="flex flex-wrap items-center gap-3"><Link to="/privacidade" className="text-xs font-semibold underline">Política de Privacidade</Link><Link to="/termos" className="text-xs font-semibold underline">Termos</Link><button type="button" disabled={requestingDeletion || Boolean(user.deletionRequestedAt)} onClick={handleRequestDeletion} className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-50">{user.deletionRequestedAt ? 'Exclusão já solicitada' : requestingDeletion ? 'Solicitando...' : 'Solicitar exclusão dos meus dados'}</button></div>
          </div>

          {/* Sessão Ativa & Opção de Sair da Conta */}
          <div className="pt-5 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-zinc-900">Sessão da Conta</div>
              <div className="text-[11px] text-zinc-500">Deseja desconectar sua conta deste dispositivo?</div>
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
            >
              <LogOut className="w-3.5 h-3.5 text-red-600" />
              <span>Sair da Conta</span>
            </button>
          </div>
        </section>
      )}

      {/* Modal de Cancelamento de Pedido */}
      {cancellingOrderTarget && (() => {
        const isPaid =
          cancellingOrderTarget.status === 'PAID' ||
          cancellingOrderTarget.status === 'PREPARING';
        const previewRefundMessage = isPaid
          ? buildRefundWhatsAppMessage({
              orderNumber: cancellingOrderTarget.orderNumber,
              customerName: user.name,
              customerPhone: user.phone,
              items: cancellingOrderTarget.items,
              subtotal: cancellingOrderTarget.subtotal,
              deliveryFee: cancellingOrderTarget.deliveryFee,
              total: cancellingOrderTarget.total,
              cancellationReason:
                cancelReason.trim() || 'Solicito o cancelamento e estorno do valor pago.',
            })
          : '';

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
          >
            <form
              onSubmit={handleConfirmCancelOrder}
              className="relative w-full max-w-lg bg-white border border-stone-200 rounded-2xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <button
                type="button"
                onClick={() => setCancellingOrderTarget(null)}
                aria-label="Fechar janela de cancelamento"
                className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-zinc-700 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="space-y-1 pr-8">
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-700">
                  {isPaid ? 'Cancelamento com Pedido de Estorno' : 'Cancelar Pedido'}
                </span>
                <h3 className="text-lg font-bold text-zinc-900">
                  Cancelar {formatOrderNumberLabel(cancellingOrderTarget.orderNumber)}
                </h3>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  {isPaid
                    ? 'Seu pedido já foi pago e ainda não saiu para entrega. Informe o motivo do cancelamento abaixo para gerarmos seu pedido de estorno preenchido para o WhatsApp.'
                    : 'Este pedido ainda não foi marcado como pago, mas os itens já estavam reservados. Ao cancelar, a reserva será devolvida ao estoque da loja.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-900">
                  Motivo do cancelamento {isPaid ? '(obrigatório para o estorno)' : '(opcional)'}
                </label>
                {isPaid && (
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Comprei o produto errado',
                      'Desisti da compra antes do envio',
                      'Vou refazer o pedido com outros itens',
                      'Imprevisto financeiro',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCancelReason(preset)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                          cancelReason === preset
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-stone-100 text-zinc-700 border-stone-200 hover:bg-stone-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  rows={2}
                  required={isPaid}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Digite o motivo do cancelamento..."
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>

              {isPaid && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <div className="text-xs font-bold text-amber-950">
                    Prévia do Pedido de Estorno Preenchido para o WhatsApp:
                  </div>
                  <pre className="p-2.5 rounded-lg bg-white border border-amber-200 text-[11px] font-mono text-zinc-800 whitespace-pre-wrap leading-relaxed">
                    {previewRefundMessage}
                  </pre>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setCancellingOrderTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 bg-stone-100 hover:bg-stone-200 rounded-lg"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={submittingCancel}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors cursor-pointer"
                >
                  {submittingCancel
                    ? 'Cancelando...'
                    : isPaid
                    ? 'Confirmar Cancelamento e Gerar Estorno'
                    : 'Confirmar Cancelamento'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* Modal com Pedido de Estorno Preenchido */}
      {completedRefundModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg bg-white border border-stone-200 rounded-2xl shadow-xl p-6 space-y-4">
            <button
              type="button"
              onClick={() => setCompletedRefundModal(null)}
              aria-label="Fechar pedido de estorno"
              className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-zinc-700 flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="space-y-1 pr-8">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                Pedido Cancelado — Estorno Pronto
              </span>
              <h3 className="text-lg font-bold text-zinc-900">
                Pedido de Estorno ({formatOrderNumberLabel(completedRefundModal.orderNumber)})
              </h3>
              <p className="text-xs text-zinc-600">
                Envie a mensagem abaixo já preenchida com os dados do seu pedido e o motivo do cancelamento para o WhatsApp da loja para receber seu estorno:
              </p>
            </div>
            <pre className="p-3.5 rounded-xl bg-stone-100 border border-stone-200 text-xs font-mono text-zinc-800 whitespace-pre-wrap leading-relaxed">
              {completedRefundModal.refundWhatsappMessage}
            </pre>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <a
                href={completedRefundModal.refundWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
              >
                <span>Enviar Pedido de Estorno para o WhatsApp</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(completedRefundModal.refundWhatsappMessage);
                  toast('Pedido de estorno copiado!', 'success');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-zinc-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
