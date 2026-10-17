import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, LogIn, RefreshCw } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.tsx';

type PaymentSummary = {
  provider: string;
  status: string;
  providerStatus: string | null;
  providerPaymentId: string | null;
  amount: string;
  currency: string;
  updatedAt: string;
};

type OrderSnapshot = {
  id: number;
  status: string;
  paymentMethod: string;
  payment: PaymentSummary | null;
};

type PaymentConfirmation = {
  payment: PaymentSummary | null;
  orderStatus: string;
};

type ReturnKind = 'success' | 'failure' | 'pending';

const KIND_CONFIG: Record<ReturnKind, {
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  iconClass: string;
  panelClass: string;
}> = {
  success: {
    label: 'Retorno de sucesso',
    title: 'Pagamento em verificação',
    description: 'Você retornou do Mercado Pago. O pagamento só é considerado aprovado após a confirmação autenticada do servidor com o provedor.',
    icon: <CheckCircle2 className="h-6 w-6" />,
    iconClass: 'bg-emerald-100 text-emerald-800',
    panelClass: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  },
  failure: {
    label: 'Retorno de falha',
    title: 'Pagamento não concluído',
    description: 'O retorno do Mercado Pago indica que o pagamento não foi concluído. O pedido não foi cancelado automaticamente e o estoque não foi alterado por esta página.',
    icon: <AlertCircle className="h-6 w-6" />,
    iconClass: 'bg-red-100 text-red-800',
    panelClass: 'border-red-200 bg-red-50 text-red-950',
  },
  pending: {
    label: 'Retorno pendente',
    title: 'Pagamento aguardando confirmação',
    description: 'O pagamento ainda aguarda confirmação do Mercado Pago. Consulte seus pedidos novamente mais tarde; esta página não aprova pagamentos.',
    icon: <Clock3 className="h-6 w-6" />,
    iconClass: 'bg-blue-100 text-blue-800',
    panelClass: 'border-blue-200 bg-blue-50 text-blue-950',
  },
};

function kindFromPath(pathname: string): ReturnKind {
  if (pathname === '/pagamento/sucesso') return 'success';
  if (pathname === '/pagamento/falha') return 'failure';
  return 'pending';
}

function paymentLabel(status: string | undefined) {
  switch (status) {
    case 'PAID': return 'Aprovado pelo provedor';
    case 'PENDING': return 'Pendente';
    case 'REJECTED': return 'Recusado';
    case 'CANCELLED': return 'Cancelado pelo provedor';
    case 'REFUNDED': return 'Reembolsado pelo provedor';
    case 'CHARGED_BACK': return 'Contestação recebida';
    case 'CREATING': return 'Checkout sendo preparado';
    case 'CREATION_FAILED': return 'Falha ao preparar checkout';
    default: return 'Ainda não confirmado';
  }
}

export const PaymentReturnPage: React.FC = () => {
  const { user, apiFetch } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const kind = kindFromPath(location.pathname);
  const config = KIND_CONFIG[kind];
  const orderId = Number(searchParams.get('orderId'));
  const paymentId = (searchParams.get('payment_id') || searchParams.get('collection_id') || '').trim();
  const [snapshot, setSnapshot] = useState<OrderSnapshot | null>(null);
  const [confirmation, setConfirmation] = useState<PaymentConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const redirectScheduledRef = useRef(false);

  const verifyPayment = useCallback(async () => {
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      setError('O retorno não contém um pedido válido.');
      return;
    }
    if (!user) {
      setError('Entre na conta do comprador para consultar o pedido com segurança.');
      return;
    }
    if (paymentId && !/^[A-Za-z0-9._:-]{1,128}$/.test(paymentId)) {
      setError('O provedor retornou um identificador de pagamento inválido.');
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const current = await apiFetch<OrderSnapshot>(`/api/orders/${orderId}`);
      setSnapshot(current);

      // A URL pode não trazer payment_id no fluxo Orders API. O backend usa o
      // providerOrderId salvo no pedido e valida propriedade, referência, valor e moeda.
      if (current.payment?.provider === 'MERCADOPAGO') {
        const verified = await apiFetch<PaymentConfirmation>(`/api/orders/${orderId}/payments/confirm`, {
          method: 'POST',
          body: JSON.stringify(paymentId ? { paymentId } : {}),
        });
        setConfirmation(verified);
        if (!redirectScheduledRef.current && (verified.orderStatus === 'PAID' || verified.payment?.status === 'PAID')) {
          redirectScheduledRef.current = true;
          window.setTimeout(() => navigate(`/minha-conta/pedidos?orderId=${orderId}`, { replace: true }), 1200);
        }
      } else {
        setConfirmation(null);
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível consultar o estado real do pedido.');
    } finally {
      setChecking(false);
    }
  }, [apiFetch, navigate, orderId, paymentId, user]);

  useEffect(() => {
    void verifyPayment();
    if (!user || !Number.isSafeInteger(orderId) || orderId <= 0) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= 60_000) {
        window.clearInterval(timer);
        return;
      }
      void verifyPayment();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [verifyPayment]);

  const payment = confirmation?.payment || snapshot?.payment || null;
  const orderStatus = confirmation?.orderStatus || snapshot?.status || '';
  const isApproved = payment?.status === 'PAID' || orderStatus === 'PAID' || ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(orderStatus);
  const canRetry = kind === 'failure' && Boolean(snapshot) && ['NEW', 'AWAITING_PAYMENT'].includes(orderStatus) && !isApproved && snapshot?.paymentMethod === 'MERCADOPAGO';
  const originalReturn = `${location.pathname}${location.search}`;
  const title = isApproved && kind === 'success' ? 'Pagamento confirmado' : config.title;
  const description = isApproved && kind === 'success'
    ? 'O servidor confirmou o pagamento com o Mercado Pago e atualizou o estado real do pedido.'
    : config.description;

  const stateText = useMemo(() => paymentLabel(payment?.status), [payment?.status]);

  return (
    <main className="max-w-[680px] mx-auto px-4 sm:px-6 py-12">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 shadow-sm space-y-5">
        <div className={`h-12 w-12 rounded-full flex items-center justify-center ${isApproved && kind === 'success' ? 'bg-emerald-100 text-emerald-800' : config.iconClass}`}>
          {isApproved && kind === 'success' ? <CheckCircle2 className="h-6 w-6" /> : config.icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{config.label} · Mercado Pago</p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900">{checking ? 'Consultando o pedido…' : title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">{description}</p>
        </div>

        {payment && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Estado confirmado</dt>
              <dd className="mt-0.5 font-semibold text-zinc-900">{stateText}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Estado do pedido</dt>
              <dd className="mt-0.5 font-semibold text-zinc-900">{orderStatus || 'Indisponível'}</dd>
            </div>
          </dl>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
        )}

        <div className={`rounded-lg border px-4 py-3 text-sm ${config.panelClass}`}>
          Nenhum parâmetro recebido na URL é usado como prova financeira. A página não cancela pedidos, não devolve estoque e não cria confirmação fictícia.
        </div>

        {!user && (
          <Link to={`/login?redirect=${encodeURIComponent(originalReturn)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-800 hover:underline">
            <LogIn className="h-4 w-4" /> Entrar na conta para consultar o pedido
          </Link>
        )}

        <div className="flex flex-wrap gap-3 pt-1">
          {canRetry && (
            <Link to="/minha-conta/pedidos" className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">
              Tentar novamente pelo pedido
            </Link>
          )}
          <button type="button" onClick={() => void verifyPayment()} disabled={checking || !user} className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Atualizar situação
          </button>
          <Link to="/minha-conta/pedidos" className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-stone-50">
            <ArrowLeft className="h-4 w-4" /> Meus pedidos
          </Link>
        </div>
      </section>
    </main>
  );
};
