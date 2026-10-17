import { useFreightQuote, FreightQuoteSummary } from '../components/FreightQuoteSummary.tsx';
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Check,
  ArrowRight,
  ArrowLeft,
  Store,
  XCircle,
  Truck,
} from 'lucide-react';
import {
  useApp,
  isAdminRole,
  formatCurrency,
  formatOrderNumberLabel,
  isItatibaCity,
  ORDER_STATUS_LABELS,
  ProductImage,
  calculatePromoLinePricing,
  formatCepMask,
  lookupCepAddress,
} from '../context/AppContext.tsx';
import { FulfillmentSummary } from '../components/FulfillmentSummary.tsx';

interface CustomerAddress {
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

interface CreatedOrderResponse {
  id: number;
  orderNumber: string;
  subtotal: string;
  deliveryFee: string | null;
  deliveryFeeSource?: string;
  paymentMethod?: string;
  deliveryDistanceKm: string | null;
  total: string;
  status: string;
  items?: Array<{
    productId: number;
    productName: string;
    imageUrl?: string | null;
    quantity: number;
    unitPrice: string;
    subtotal: string;
  }>;
}

export const CheckoutPage: React.FC = () => {
  const {
    user,
    cart,
    cartSubtotal,
    removePurchasedCartItems,
    apiFetch,
    toast,
  } = useApp();
  const navigate = useNavigate();
  const isAdmin = isAdminRole(user?.role);
  const selectedCartItems = cart.filter((item) => item.selected !== false);

  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [notes, setNotes] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrderResponse | null>(null);
  const [cancellingCreatedOrder, setCancellingCreatedOrder] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  const [storeClosed, setStoreClosed] = useState(false);
  const [storeClosedMessage, setStoreClosedMessage] = useState('A loja está fechada no momento.');
  const { quote: freightQuote, loading: quoteLoading, error: quoteError, refresh: refreshQuote } = useFreightQuote(selectedCartItems, selectedAddressId);
  const orderIdempotencyKeyRef = useRef<string | null>(null);
  const paymentIdempotencyKeyRef = useRef<string | null>(null);

  // New Address Form State
  const [label, setLabel] = useState('Casa');
  const [zipCode, setZipCode] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('Itatiba');
  const [state, setState] = useState('SP');
  const [reference, setReference] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [cepAutoFilled, setCepAutoFilled] = useState(false);
  const numberInputRef = useRef<HTMLInputElement | null>(null);

  const handleCheckoutCepChange = async (rawValue: string) => {
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

  useEffect(() => {
    if (!user) return;
    setLoadingAddresses(true);
    Promise.all([apiFetch<CustomerAddress[]>('/api/addresses'), apiFetch('/api/storefront')])
      .then(([addrList, storefront]) => {
        setAddresses(addrList || []);
        if (addrList && addrList.length > 0) {
          setSelectedAddressId(addrList.find((address) => Boolean((address as CustomerAddress & { isPrimary?: boolean }).isPrimary))?.id || addrList[0].id);
        } else {
          setShowNewAddressForm(true);
        }
        if (storefront?.settings) {
          setStoreClosed(!Boolean(storefront.settings.store?.isOpen));
          setStoreClosedMessage(storefront.settings.store?.closedMessage || 'A loja está fechada no momento.');
        }

      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        setLoadingAddresses(false);
      });
  }, [user, apiFetch]);

  const handleStartPayment = async () => {
    if (!createdOrder || createdOrder.status === 'CANCELLED') return;
    setStartingPayment(true);
    try {
      const idempotencyKey = paymentIdempotencyKeyRef.current ||
        globalThis.crypto?.randomUUID?.() || `mp-${createdOrder.id}-${Date.now()}`;
      paymentIdempotencyKeyRef.current = idempotencyKey;
      const result = await apiFetch<{ checkoutUrl: string }>(`/api/orders/${createdOrder.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey }),
      });
      const checkout = new URL(result.checkoutUrl);
      if (checkout.protocol !== 'https:' || !/(^|\.)mercadopago\.com(\.br)?$/i.test(checkout.hostname)) {
        throw new Error('O servidor não retornou um endereço seguro de checkout do Mercado Pago.');
      }
      window.location.assign(checkout.toString());
    } catch (err: any) {
      toast(err.message || 'Não foi possível iniciar o pagamento pelo Mercado Pago.', 'error');
      setStartingPayment(false);
    }
  };

  if (!user) {
    return (
      <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-zinc-900">Identifique-se para finalizar</h1>
        <p className="text-sm text-zinc-600">
          Para escolher seu endereço de entrega e pagar online pelo Mercado Pago, acesse sua conta
          ou cadastre-se rapidamente.
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
            to="/login?redirect=/checkout"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <span>Entrar ou Criar Conta</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>
    );
  }

  if (createdOrder) {
    const isFreeDeliveryOrder = createdOrder.deliveryFee !== null && Number(createdOrder.deliveryFee) === 0;
    const hasConfirmedFreight =
      isFreeDeliveryOrder ||
      (createdOrder.deliveryFee !== null &&
        createdOrder.deliveryFee !== undefined &&
        createdOrder.deliveryFee !== '');
    const canCancelCreated = ['NEW', 'AWAITING_PAYMENT', 'PAID', 'PREPARING'].includes(
      createdOrder.status
    );

    const handleCancelJustCreatedOrder = async () => {
      setCancellingCreatedOrder(true);
      try {
        const res = await apiFetch<any>(`/api/orders/${createdOrder.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({
            reason: 'Cancelado pelo cliente logo após a realização do pedido.',
          }),
        });
        setCreatedOrder((prev) =>
          prev
            ? {
                ...prev,
                status: res.status || 'CANCELLED',
              }
            : null
        );
        toast(
          'Pedido cancelado com sucesso! A reserva de estoque foi devolvida à vitrine.',
          'info'
        );
      } catch (err: any) {
        toast(err.message || 'Erro ao cancelar pedido.', 'error');
      } finally {
        setCancellingCreatedOrder(false);
      }
    };

    return (
      <main className="max-w-[720px] mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
          >
            <Store className="w-3.5 h-3.5" />
            <span>Voltar para a Vitrine</span>
          </Link>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2 border-b border-stone-200 pb-5">
            <div
              className={`text-xs font-medium ${
                createdOrder.status === 'CANCELLED' ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {createdOrder.status === 'CANCELLED'
                ? 'Pedido cancelado pelo cliente'
                : 'Pedido registrado com sucesso'}{' '}
              — Status: {ORDER_STATUS_LABELS[createdOrder.status] || createdOrder.status}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">
              {createdOrder.status === 'CANCELLED'
                ? `${formatOrderNumberLabel(createdOrder.orderNumber)} cancelado`
                : `${formatOrderNumberLabel(createdOrder.orderNumber)} criado!`}
            </h1>
            <p className="text-sm text-zinc-600">
              {createdOrder.status === 'CANCELLED'
                ? 'Este pedido foi cancelado antes do pagamento e os itens reservados foram devolvidos ao estoque da loja.'
                : 'Seu pedido já está salvo e os itens foram reservados. Finalize o pagamento no ambiente seguro do Mercado Pago.'}
            </p>

          </div>

          {createdOrder.paymentMethod === 'MERCADOPAGO' && createdOrder.status !== 'CANCELLED' && (
            <section className="rounded-xl border border-blue-300 bg-blue-50 p-4 sm:p-5 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-blue-950">Pagamento online</h2>
                <p className="mt-1 text-xs leading-relaxed text-blue-900">
                  Você será direcionado ao checkout hospedado do Mercado Pago para concluir o pagamento.
                </p>
              </div>
              {hasConfirmedFreight ? (
                <button
                  type="button"
                  onClick={handleStartPayment}
                  disabled={startingPayment}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                >
                  <span>{startingPayment ? 'Preparando checkout…' : 'Pagar com Mercado Pago'}</span>
                  {!startingPayment && <ArrowRight className="h-4 w-4" />}
                </button>
              ) : null}
            </section>
          )}

          {/* Valores e Itens do Pedido */}
          <div className="border-t border-stone-200 pt-4 space-y-3 text-sm">
            {createdOrder.items && createdOrder.items.length > 0 && (
              <div className="divide-y divide-stone-100 border-b border-stone-200 pb-3 space-y-2">
                {createdOrder.items.map((it, idx) => (
                  <div key={idx} className="pt-2 first:pt-0 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-[#F9F9F8] border border-stone-200 shrink-0">
                        <ProductImage src={it.imageUrl} alt={it.productName} />
                      </div>
                      <span className="text-zinc-800">
                        <strong className="tabular-nums font-semibold">{it.quantity}x</strong>{' '}
                        {it.productName}
                      </span>
                    </div>
                    <span className="font-semibold text-zinc-900 tabular-nums shrink-0">
                      {formatCurrency(it.subtotal)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between text-zinc-600">
              <span>Subtotal dos produtos</span>
              <span className="font-semibold text-zinc-900 tabular-nums">
                {formatCurrency(createdOrder.subtotal)}
              </span>
            </div>

            {isFreeDeliveryOrder ? (
              <>
                <div className="flex justify-between items-center text-emerald-800">
                  <span>Frete</span>
                  <span className="font-semibold inline-flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5" />
                    <span>
                      {(createdOrder.deliveryFeeSource === 'MANUAL_FREE_DELIVERY' || createdOrder.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD')
                        ? 'Frete grátis (benefício da loja)'
                        : 'Frete grátis'}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold text-zinc-900 pt-1">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(createdOrder.total)}</span>
                </div>
              </>
            ) : hasConfirmedFreight ? (
              <>
                <div className="flex justify-between text-zinc-600">
                  <span>Frete</span>
                  <span className="font-semibold text-zinc-900 tabular-nums">
                    {formatCurrency(createdOrder.deliveryFee)}
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold text-zinc-900 pt-1">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(createdOrder.total)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-amber-800">
                  <span>Frete</span>
                  <span className="font-medium">A confirmar antes do pagamento</span>
                </div>
                <div className="flex justify-between text-base font-bold text-zinc-900 pt-1">
                  <span>Total (sem o frete)</span>
                  <span className="tabular-nums">{formatCurrency(createdOrder.subtotal)}</span>
                </div>
              </>
            )}
          </div>


          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to="/minha-conta/pedidos"
                className="px-4 py-2.5 text-xs font-semibold text-zinc-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
              >
                Acompanhar em Meus Pedidos
              </Link>
              <Link
                to={`/minha-conta/central-ajuda?orderId=${createdOrder.id}&create=1`}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
              >
                Falar com a loja sobre este pedido
              </Link>
              {canCancelCreated && (
                <button
                  type="button"
                  disabled={cancellingCreatedOrder}
                  onClick={handleCancelJustCreatedOrder}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>{cancellingCreatedOrder ? 'Cancelando...' : 'Cancelar Pedido'}</span>
                </button>
              )}
            </div>
            <Link
              to="/"
              className="px-4 py-2.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              Voltar para a Vitrine
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (cart.length === 0) {
    return (
      <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-zinc-900">Sua sacola está vazia</h1>
        <p className="text-sm text-zinc-600">
          Adicione produtos antes de prosseguir para o checkout.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 rounded-lg"
        >
          Ir para a Vitrine
        </Link>
      </main>
    );
  }

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) || null;
  const isConfirmedFreight = freightQuote?.freight?.status === 'OK';
  const finalTotal = freightQuote?.totals.total ?? cartSubtotal;
  const handleSaveNewAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAddress(true);
    try {
      const created = await apiFetch<CustomerAddress>('/api/addresses', {
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
      setAddresses((prev) => [created, ...prev]);
      setSelectedAddressId(created.id);
      setShowNewAddressForm(false);
      setStreet('');
      setNumber('');
      setComplement('');
      setNeighborhood('');
      setZipCode('');
      setReference('');
      if (isItatibaCity(created.city || city)) {
        toast('Endereço em Itatiba cadastrado! Temos delivery para sua região.', 'success');
      } else {
        toast(
          'Endereço cadastrado! Atendemos apenas Itatiba.',
          'info'
        );
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSavingAddress(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (selectedCartItems.length === 0) {
      toast('Selecione ao menos um item na sacola antes de fazer o pedido.', 'error');
      navigate('/carrinho');
      return;
    }
    if (storeClosed) {
      toast(storeClosedMessage, 'error');
      return;
    }
    if (!selectedAddressId) {
      toast('Selecione ou cadastre um endereço de entrega.', 'error');
      return;
    }
    if (quoteLoading || !isConfirmedFreight) { toast(quoteError || 'Não conseguimos calcular o frete agora', 'error'); return; }
    setOrderError(null);
    setSubmittingOrder(true);
    try {
      const idempotencyKey =
        orderIdempotencyKeyRef.current ||
        (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      orderIdempotencyKeyRef.current = idempotencyKey;
      const res = await apiFetch<CreatedOrderResponse>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          addressId: selectedAddressId,
          quoteToken: freightQuote?.quoteToken,
          paymentMethod: 'MERCADOPAGO',
          notes,
          items: selectedCartItems.map((i) => ({
            productId: i.productId,
            productName: i.name,
            quantity: i.quantity,
            receiveAllAsPreorder: Boolean(i.receiveAllAsPreorder),
          })),
        }),
      });
      removePurchasedCartItems();
      setCreatedOrder(res);
      toast(
        res.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD'
          ? `Pedido ${res.orderNumber} criado com frete grátis concedido pela loja.`
          : `Pedido ${res.orderNumber} criado com sucesso!`,
        'success'
      );
    } catch (err: any) {
      setOrderError(err.message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  return (
    <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Top Navigation Bar: Voltar & Ir para a Vitrine */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/carrinho')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar ao Carrinho</span>
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
        >
          <Store className="w-3.5 h-3.5" />
          <span>Ir para a Vitrine</span>
        </Link>
      </div>

      <div className="border-b border-stone-200 pb-4">
        <h1 className="text-2xl font-bold text-zinc-900">Finalizar Pedido</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Escolha seu endereço de entrega e confira os itens antes de gerar o pedido.
        </p>
      </div>

      {storeClosed && !createdOrder && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950">
          <div className="font-bold text-sm">Loja fechada no momento</div>
          <p className="text-xs mt-1">{storeClosedMessage}</p>
        </div>
      )}

      {orderError && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
          {orderError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Address Selection & Notes */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">1. Endereço de Entrega</h2>
                <p className="text-xs text-zinc-500">
                  O valor do frete é lido diretamente do seu endereço cadastrado.
                </p>
              </div>
              {!showNewAddressForm && (
                <button
                  type="button"
                  onClick={() => setShowNewAddressForm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo Endereço</span>
                </button>
              )}
            </div>

            {loadingAddresses ? (
              <div className="p-6 text-xs text-zinc-500">Carregando seus endereços...</div>
            ) : (
              <div className="space-y-3">
                {addresses.map((addr) => {
                  const selected = addr.id === selectedAddressId;
                  const confirmed = addr.freight.status === 'CONFIRMED';
                  return (
                    <div
                      key={addr.id}
                      onClick={() => setSelectedAddressId(addr.id)}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selected
                          ? 'border-zinc-900 bg-stone-50'
                          : 'border-stone-200 hover:border-stone-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-zinc-900">{addr.label}</span>
                            <span className="text-xs text-stone-400">•</span>
                            <span className="text-xs text-zinc-600">CEP {addr.zipCode}</span>
                          </div>
                          <p className="text-xs text-zinc-700">
                            {addr.street}, {addr.number}
                            {addr.complement ? ` (${addr.complement})` : ''} — {addr.neighborhood},{' '}
                            {addr.city}/{addr.state}
                          </p>
                          {addr.reference && (
                            <p className="text-xs text-zinc-500">Referência: {addr.reference}</p>
                          )}
                          <div className="pt-1.5 space-y-1">
                            {isItatibaCity(addr.city) ? (
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900">
                                <Truck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                <span>Cidade: Itatiba — Temos delivery</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900">
                                <Truck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                <span>Atendemos apenas Itatiba</span>
                              </div>
                            )}
                            <div>
                              {confirmed ? (
                                <span className="text-xs font-semibold text-emerald-800 tabular-nums">
                                  Frete confirmado: {formatCurrency(addr.freight.fee)}
                                </span>
                              ) : isItatibaCity(addr.city) ? (
                                <span className="text-xs font-medium text-amber-800">
                                  Não conseguimos calcular o frete agora
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                            selected
                              ? 'border-zinc-900 bg-zinc-900 text-white'
                              : 'border-stone-300'
                          }`}
                        >
                          {selected && <Check className="w-3 h-3" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {showNewAddressForm && (
              <form
                onSubmit={handleSaveNewAddress}
                className="border-t border-stone-200 pt-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-zinc-900">Cadastrar Novo Endereço</h3>
                  {addresses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowNewAddressForm(false)}
                      className="text-xs text-zinc-500 hover:text-zinc-900"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-4 space-y-1">
                      <label className="block text-xs font-bold text-zinc-900">
                        1º Passo — CEP
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={9}
                        value={zipCode}
                        onChange={(e) => handleCheckoutCepChange(e.target.value)}
                        placeholder="00000-000"
                        className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-stone-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-4 space-y-1">
                      <label className="block text-xs font-bold text-zinc-900">Número</label>
                      <input
                        ref={numberInputRef}
                        type="text"
                        required
                        value={number}
                        onChange={(e) => setNumber(e.target.value)}
                        placeholder="Ex: 123"
                        className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
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
                        placeholder="Apto, Bloco..."
                        className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                      />
                    </div>
                  </div>
                  {lookingUpCep && (
                    <div className="text-xs text-zinc-600">
                      Buscando endereço pelo CEP automaticamente...
                    </div>
                  )}
                  {cepAutoFilled && !lookingUpCep && (
                    <div className="text-xs font-semibold text-emerald-800">
                      ✓ Endereço preenchido pelo CEP! Informe apenas o número e complemento.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-zinc-700">
                      Rua / Avenida (preenchido pelo CEP)
                    </label>
                    <input
                      type="text"
                      required
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder="Preenchido pelo CEP"
                      className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-zinc-700">
                      Bairro (preenchido pelo CEP)
                    </label>
                    <input
                      type="text"
                      required
                      value={neighborhood}
                      onChange={(e) => setNeighborhood(e.target.value)}
                      placeholder="Preenchido pelo CEP"
                      className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5 space-y-1">
                    <label className="block text-xs font-semibold text-zinc-700">Cidade</label>
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
                      Apelido (Casa, Trabalho...)
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
                    className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
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
                        <strong>Temos delivery!</strong>
                      </span>
                    ) : (
                      <span>
                        Cidade conferida: <strong>{city.trim()}</strong> —{' '}
                        <strong>Atendemos apenas Itatiba</strong>
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Ponto de referência (opcional)
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Próximo à padaria, portão branco..."
                    className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingAddress}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  {savingAddress ? 'Salvando...' : 'Salvar e Usar Este Endereço'}
                </button>
              </form>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-zinc-900">2. Observações do Pedido</h2>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Alguma observação para entrega ou horário preferencial? (opcional)"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        </div>

        {/* Right Column: Order Review & Submit */}
        <div className="lg:col-span-5 bg-white border border-stone-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-bold text-zinc-900">Resumo da Compra</h2>
          <div className="divide-y divide-stone-100 text-xs max-h-64 overflow-y-auto pr-1">
            {selectedCartItems.map((item) => {
              const pricing = calculatePromoLinePricing({ normalPrice: item.originalPrice ?? item.price, promoPrice: item.promoPrice ?? item.price, hasPromo: item.hasPromo, promoMaxUnits: item.promoMaxUnits, quantity: item.quantity });
              return <div key={item.productId} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-md overflow-hidden bg-[#F9F9F8] border border-stone-200 shrink-0">
                    <ProductImage src={item.imageUrl} alt={item.name} />
                  </div>
                  <span className="text-zinc-700">
                    <strong className="font-semibold text-zinc-900 tabular-nums">
                      {item.quantity}x
                    </strong>{' '}
                    {item.name}
                  </span>
                </div>
                <span className="font-semibold text-zinc-900 tabular-nums shrink-0">
                  {formatCurrency(pricing.subtotal)}
                </span>
              </div>;
            })}
          </div>

          <FulfillmentSummary items={selectedCartItems} />

          <div className="border-t border-stone-200 pt-4 space-y-2 text-sm">
            <div className="flex justify-between text-zinc-600">
              <span>Subtotal</span>
              <span className="font-semibold text-zinc-900 tabular-nums">
                {formatCurrency(freightQuote?.totals.subtotal ?? cartSubtotal)}
              </span>
            </div>

            {selectedAddress && (
              <div
                className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center gap-2 ${
                  isItatibaCity(selectedAddress.city)
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50/90 border-amber-200 text-amber-900'
                }`}
              >
                <Truck className="w-3.5 h-3.5 shrink-0" />
                {isItatibaCity(selectedAddress.city) ? (
                  <span>Cidade: Itatiba — Temos delivery</span>
                ) : (
                  <span>Atendemos apenas Itatiba</span>
                )}
              </div>
            )}

            <FreightQuoteSummary quote={freightQuote} loading={quoteLoading} error={quoteError} onRetry={async () => {
              if (selectedAddressId) {
                try { await apiFetch(`/api/addresses/${selectedAddressId}/recalculate`, { method: 'POST' }); }
                catch (error: any) { toast(error.message, 'error'); }
              }
              refreshQuote();
            }} />
          </div>

          <div className="border-t border-stone-200 pt-4 flex items-center justify-between">
            <span className="text-base font-bold text-zinc-900">
              {isConfirmedFreight ? 'Total do Pedido' : 'Total (sem o frete)'}
            </span>
            <span className="text-lg font-bold text-zinc-900 tabular-nums">
              {formatCurrency(finalTotal)}
            </span>
          </div>

          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3.5 space-y-3 text-xs">
            <div>
              <div className="font-bold text-zinc-900">Endereço de entrega</div>
              {selectedAddress ? (
                <div className="mt-1 text-zinc-700 leading-relaxed">
                  {selectedAddress.street}, {selectedAddress.number}{selectedAddress.complement ? ` — ${selectedAddress.complement}` : ''}<br />
                  {selectedAddress.neighborhood}<br />
                  {selectedAddress.city} - {selectedAddress.state}
                </div>
              ) : <div className="mt-1 text-amber-800">Selecione um endereço válido.</div>}
            </div>
          </div>

          <button
            type="button"
            disabled={submittingOrder || !selectedAddressId || storeClosed || quoteLoading || !isConfirmedFreight}
            onClick={handlePlaceOrder}
            className="w-full py-3.5 px-5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            {submittingOrder ? 'Registrando Pedido...' : storeClosed ? 'Loja Fechada' : 'Confirmar Pedido'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/carrinho')}
            className="w-full text-center text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            Voltar ao carrinho
          </button>
        </div>
      </div>
    </main>
  );
};
