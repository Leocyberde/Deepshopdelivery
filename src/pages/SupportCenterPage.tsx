import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, LifeBuoy, MessageCircle, Package, Plus, Send } from 'lucide-react';
import { formatDateTime, formatOrderNumberLabel, isAdminRole, ORDER_STATUS_LABELS, useApp } from '../context/AppContext.tsx';

type ReasonCode = 'ORDER_PROBLEM' | 'WRONG_ORDER' | 'MISSING_ITEM' | 'DAMAGED_PRODUCT' | 'NOT_DELIVERED' | 'OTHER';
const REASONS: Array<{ code: ReasonCode; label: string }> = [
  { code: 'ORDER_PROBLEM', label: 'Pedido com problema' },
  { code: 'WRONG_ORDER', label: 'Pedido errado' },
  { code: 'MISSING_ITEM', label: 'Item faltando ou incompleto' },
  { code: 'DAMAGED_PRODUCT', label: 'Produto danificado' },
  { code: 'NOT_DELIVERED', label: 'Pedido não chegou (apesar de marcado como entregue)' },
  { code: 'OTHER', label: 'Outro' },
];
type Message = { id: number; body: string; createdAt: string; authorRole: 'ADMIN' | 'CUSTOMER'; authorLabel: string };
type Order = { id: number; orderNumber: string; status: string; deliveredAt?: string | null };
type Ticket = {
  id: number; subject: string; status: string; orderId: number | null; order: Order | null;
  productId: number | null; productNameSnapshot: string | null; productSlugSnapshot: string | null; productLinkSnapshot: string | null;
  supportReason: ReasonCode | null; postDelivery: boolean; createdAt: string; updatedAt: string; closedAt: string | null; closedReason?: string | null;
  canCustomerCancel?: boolean; unreadForCustomer?: boolean; lastAuthorRole?: string | null; lastMessageId?: number | null; messages: Message[];
};
type ApiFetch = <T = any>(url: string, options?: RequestInit) => Promise<T>;
const SUBJECTS = [
  { value: 'AJUDA_COM_PEDIDO', label: 'Ajuda com pedido' }, { value: 'PAGAMENTO', label: 'Pagamento' },
  { value: 'PRODUTO', label: 'Produto' }, { value: 'DUVIDA', label: 'Dúvida' }, { value: 'OUTRO', label: 'Outro' },
];
const STATUS_LABELS: Record<string, string> = { OPEN: 'Aberto', IN_PROGRESS: 'Em atendimento', WAITING_CUSTOMER: 'Aguardando você', RESOLVED: 'Resolvido', CLOSED: 'Encerrado' };
const STATUS_TONES: Record<string, string> = { OPEN: 'bg-sky-100 text-sky-900', IN_PROGRESS: 'bg-amber-100 text-amber-900', WAITING_CUSTOMER: 'bg-blue-100 text-blue-900', RESOLVED: 'bg-emerald-100 text-emerald-900', CLOSED: 'bg-stone-100 text-zinc-700' };
function reasonLabel(code?: string | null) { return REASONS.find((item) => item.code === code)?.label || ''; }
function mergeMessages(current: Message[], incoming: Message[]) {
  const map = new Map<number, Message>();
  [...current, ...incoming].forEach((message) => map.set(message.id, message));
  return [...map.values()].sort((a, b) => a.id - b.id);
}
function isWithinPostDeliveryWindow(order: Order | null | undefined, days: number) {
  if (!order || order.status !== 'DELIVERED' || !order.deliveredAt) return false;
  const deliveredAt = new Date(order.deliveredAt).getTime();
  return Number.isFinite(deliveredAt) && Date.now() <= deliveredAt + days * 86_400_000;
}

export const SupportCenterPage: React.FC = () => {
  const { user, apiFetch, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [pageError, setPageError] = useState('');
  const [reply, setReply] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [subject, setSubject] = useState('DUVIDA');
  const [relatedOrderId, setRelatedOrderId] = useState('');
  const [relatedProductId, setRelatedProductId] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [postDeliveryOrderId, setPostDeliveryOrderId] = useState('');
  const [reasonCode, setReasonCode] = useState<ReasonCode>('ORDER_PROBLEM');
  const [description, setDescription] = useState('');
  const [postDeliveryDays, setPostDeliveryDays] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<'ACTIVE' | 'CLOSED'>('ACTIVE');
  const selectedRef = useRef<Ticket | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const loadTickets = useCallback(async () => {
    const result = await apiFetch<{ tickets: Ticket[] }>('/api/support/tickets');
    setTickets(result.tickets || []);
  }, [apiFetch]);
  const loadDetail = useCallback(async (id: number, sinceId?: number | null, merge = false) => {
    setLoadingDetail(true);
    try {
      const suffix = sinceId ? `?since=${encodeURIComponent(String(sinceId))}` : '';
      const result = await apiFetch<{ ticket: Ticket }>(`/api/support/tickets/${id}${suffix}`);
      setSelected((previous) => {
        if (merge && previous?.id === id) {
          const messages = mergeMessages(previous.messages || [], result.ticket.messages || []);
          return { ...result.ticket, messages, lastAuthorRole: messages.at(-1)?.authorRole || null };
        }
        return result.ticket;
      });
      return result.ticket;
    } finally { setLoadingDetail(false); }
  }, [apiFetch]);

  useEffect(() => {
    if (!user || isAdminRole(user.role)) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch<{ tickets: Ticket[] }>('/api/support/tickets'),
      apiFetch<{ orders: Order[] }>('/api/orders?page=1&pageSize=50'),
      apiFetch<{ postDeliveryDays: number }>('/api/support/config'),
    ]).then(([ticketResult, orderResult, config]) => {
      if (cancelled) return;
      setTickets(ticketResult.tickets || []);
      setOrders(orderResult.orders || []);
      setPostDeliveryDays(Number(config.postDeliveryDays) || 30);
      setPageError(''); setOrdersLoaded(true);
    }).catch((error: any) => { if (!cancelled) setPageError(error?.message || 'Não foi possível carregar a Central de Ajuda.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, user]);

  useEffect(() => {
    if (!ordersLoaded || !user || isAdminRole(user.role)) return;
    const params = new URLSearchParams(location.search);
    const ticketId = Number(params.get('ticketId'));
    if (Number.isSafeInteger(ticketId) && ticketId > 0) {
      void loadDetail(ticketId).catch((error: any) => setPageError(error?.message || 'Não foi possível abrir a conversa.'));
      return;
    }
    const orderId = params.get('orderId') || '';
    const productId = params.get('productId') || '';
    if (params.get('postDelivery') === '1' && orderId) {
      setPostDeliveryOrderId(orderId); setShowNew(false); setRelatedOrderId(''); setSelected(null); return;
    }
    if (params.get('create') === '1' || orderId || productId) {
      const order = orders.find((item) => String(item.id) === orderId);
      if (order?.status === 'DELIVERED') { setPostDeliveryOrderId(orderId); setShowNew(false); }
      else { setPostDeliveryOrderId(''); setShowNew(true); setRelatedOrderId(orderId); }
      setRelatedProductId(productId);
      if (productId) setSubject('PRODUTO'); else if (orderId) setSubject('AJUDA_COM_PEDIDO');
    }
  }, [location.search, loadDetail, orders, ordersLoaded, user]);

  // Atualização incremental a cada 15 s; a aba oculta não gera consultas.
  useEffect(() => {
    const ticketId = selected?.id;
    if (!ticketId) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = selectedRef.current;
      if (!current || current.id !== ticketId) return;
      const lastId = current.messages?.at(-1)?.id || null;
      try { await loadDetail(ticketId, lastId, true); } catch { /* próxima rodada pode recuperar */ }
    };
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [selected?.id, loadDetail]);

  const activeTickets = useMemo(() => tickets.filter((ticket) => ticket.status !== 'CLOSED'), [tickets]);
  const closedTickets = useMemo(() => tickets.filter((ticket) => ticket.status === 'CLOSED'), [tickets]);
  const visibleTickets = tab === 'ACTIVE' ? activeTickets : closedTickets;
  const postDeliveryOrder = orders.find((order) => String(order.id) === postDeliveryOrderId) || selected?.order || null;
  const canStartPostDelivery = isWithinPostDeliveryWindow(postDeliveryOrder, postDeliveryDays);

  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (isAdminRole(user.role)) return <Navigate to="/admin/central-ajuda" replace />;

  const openNewTicket = () => {
    setSelected(null); setSubject('DUVIDA'); setRelatedOrderId(''); setRelatedProductId('');
    setInitialMessage(''); setPageError(''); setPostDeliveryOrderId(''); setShowNew(true);
  };
  const openTicket = (ticket: Ticket) => {
    setShowNew(false); setPostDeliveryOrderId(''); setPageError('');
    void loadDetail(ticket.id).catch((error: any) => setPageError(error?.message || 'Não foi possível abrir a conversa.'));
  };
  const submitNewTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!initialMessage.trim()) { setPageError('Escreva uma mensagem para iniciar o atendimento.'); return; }
    setSubmitting(true); setPageError('');
    try {
      const result = await apiFetch<{ ticket: Ticket }>('/api/support/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, orderId: relatedOrderId ? Number(relatedOrderId) : null, productId: relatedProductId ? Number(relatedProductId) : null, body: initialMessage }),
      });
      await loadTickets(); setSelected(result.ticket); setShowNew(false); setInitialMessage('');
      navigate(`/minha-conta/central-ajuda?ticketId=${result.ticket.id}`, { replace: true });
      toast('Conversa iniciada. Você pode continuar pela Central de Ajuda.', 'success');
    } catch (error: any) { setPageError(error?.message || 'Não foi possível abrir o atendimento.'); }
    finally { setSubmitting(false); }
  };
  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setSubmitting(true); setPageError('');
    try {
      const result = await apiFetch<{ ticket: Ticket }>(`/api/support/tickets/${selected.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }),
      });
      setSelected(result.ticket); setReply(''); await loadTickets(); toast('Mensagem enviada à loja.', 'success');
    } catch (error: any) { setPageError(error?.message || 'Não foi possível enviar a mensagem.'); }
    finally { setSubmitting(false); }
  };
  const closeTicket = async () => {
    if (!selected) return;
    setSubmitting(true); setPageError('');
    try {
      const result = await apiFetch<{ ticket: Ticket }>(`/api/support/tickets/${selected.id}/close`, { method: 'POST' });
      setSelected(result.ticket); await loadTickets(); setTab('CLOSED'); toast('Atendimento encerrado.', 'success');
    } catch (error: any) { setPageError(error?.message || 'Não foi possível encerrar o atendimento.'); }
    finally { setSubmitting(false); }
  };
  const submitPostDelivery = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!postDeliveryOrder || !canStartPostDelivery) { setPageError('O prazo para solicitar suporte pós-entrega terminou.'); return; }
    setSubmitting(true); setPageError('');
    try {
      const result = await apiFetch<{ ticket: Ticket; reused: boolean }>(`/api/support/orders/${postDeliveryOrder.id}/post-delivery-tickets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reasonCode, description }),
      });
      await loadTickets(); setSelected(result.ticket); setPostDeliveryOrderId(''); setDescription(''); setTab('ACTIVE');
      navigate(`/minha-conta/central-ajuda?ticketId=${result.ticket.id}`, { replace: true });
      toast(result.reused ? 'Você já tinha um chamado aberto para esse motivo. Abrimos a conversa existente.' : 'Chamado pós-entrega criado.', 'success');
    } catch (error: any) { setPageError(error?.message || 'Não foi possível abrir o chamado pós-entrega.'); }
    finally { setSubmitting(false); }
  };

  const subjectLabel = SUBJECTS.find((item) => item.value === selected?.subject)?.label || selected?.subject;
  const canReply = Boolean(selected && selected.status !== 'RESOLVED' && selected.status !== 'CLOSED');
  const orderOptionDisabled = (order: Order) => order.status === 'DELIVERED';
  return (
    <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center"><LifeBuoy className="w-5 h-5" /></div>
          <div><h1 className="text-2xl font-bold text-zinc-900">Central de Ajuda</h1><p className="text-sm text-zinc-600">Converse com a loja sobre produtos, pedidos ou outras dúvidas.</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/minha-conta/pedidos" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50"><ArrowLeft className="w-3.5 h-3.5" /> Meus pedidos</Link>
          <button type="button" onClick={openNewTicket} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"><Plus className="w-4 h-4" /> Falar com a loja</button>
        </div>
      </header>
      {pageError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><AlertCircle className="inline w-4 h-4 mr-1" />{pageError}</div>}
      {loading ? <div className="rounded-xl border border-stone-200 bg-white p-8 text-sm text-zinc-500">Carregando seus atendimentos…</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(270px,0.8fr)_minmax(0,1.6fr)] gap-5 items-start">
          <section className={`${selected || showNew || postDeliveryOrderId ? 'hidden lg:block' : ''} rounded-xl border border-stone-200 bg-white overflow-hidden`} aria-label="Meus atendimentos">
            <div className="px-4 py-3 border-b border-stone-200 space-y-3">
              <div className="flex items-center justify-between"><h2 className="text-sm font-bold">Meus atendimentos</h2><span className="text-xs text-zinc-500">{tickets.length}</span></div>
              <div className="grid grid-cols-2 rounded-lg bg-stone-100 p-1" role="tablist" aria-label="Filtro de atendimentos">
                <button type="button" role="tab" aria-selected={tab === 'ACTIVE'} onClick={() => setTab('ACTIVE')} className={`rounded-md px-3 py-2 text-xs font-semibold ${tab === 'ACTIVE' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'}`}>Ativas ({activeTickets.length})</button>
                <button type="button" role="tab" aria-selected={tab === 'CLOSED'} onClick={() => setTab('CLOSED')} className={`rounded-md px-3 py-2 text-xs font-semibold ${tab === 'CLOSED' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'}`}>Encerradas ({closedTickets.length})</button>
              </div>
            </div>
            {visibleTickets.length === 0 ? <p className="px-4 py-8 text-sm text-zinc-500 text-center">{tab === 'ACTIVE' ? 'Você não tem atendimentos ativos.' : 'Você ainda não tem atendimentos encerrados.'}</p> : (
              <div className="divide-y divide-stone-100 max-h-[70vh] overflow-y-auto">
                {visibleTickets.map((ticket) => (
                  <button key={ticket.id} type="button" onClick={() => openTicket(ticket)} className={`w-full text-left p-4 hover:bg-stone-50 ${selected?.id === ticket.id ? 'bg-emerald-50/60' : ''}`}>
                    <div className="flex items-start justify-between gap-2"><span className="text-xs font-bold text-zinc-900">Atendimento #{ticket.id}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONES[ticket.status] || ''}`}>{STATUS_LABELS[ticket.status] || ticket.status}</span></div>
                    <div className="mt-1 text-xs text-zinc-700">{SUBJECTS.find((item) => item.value === ticket.subject)?.label || ticket.subject}</div>
                    {ticket.supportReason && <div className="mt-1 text-[11px] text-emerald-800">{reasonLabel(ticket.supportReason)}</div>}
                    {ticket.order && <div className="mt-1 text-[11px] text-zinc-500">Pedido {formatOrderNumberLabel(ticket.order.orderNumber)}</div>}
                    {ticket.productNameSnapshot && <div className="mt-1 text-[11px] text-zinc-500">Produto: {ticket.productNameSnapshot}</div>}
                    {ticket.unreadForCustomer && <span className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">Nova mensagem da loja</span>}
                    <div className="mt-2 text-[11px] text-zinc-500">Atualizado {formatDateTime(ticket.updatedAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className={`${selected || showNew || postDeliveryOrderId ? '' : 'hidden lg:block'} min-w-0 rounded-xl border border-stone-200 bg-white overflow-hidden`} aria-label={showNew ? 'Nova conversa' : postDeliveryOrderId ? 'Suporte pós-entrega' : 'Conversa'}>
            {showNew ? (
              <form onSubmit={(event) => void submitNewTicket(event)} className="p-4 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Falar com a loja</h2><p className="mt-1 text-xs text-zinc-600">Você pode iniciar uma conversa sem pedido. Não envie senhas nem dados de pagamento.</p></div><button type="button" onClick={() => setShowNew(false)} className="lg:hidden text-xs font-semibold text-emerald-800">Voltar</button></div>
                <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Assunto</span><select value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">{SUBJECTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Pedido relacionado (opcional)</span><select value={relatedOrderId} onChange={(event) => setRelatedOrderId(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm"><option value="">Nenhum pedido</option>{orders.filter((order) => !orderOptionDisabled(order)).map((order) => <option key={order.id} value={order.id}>{formatOrderNumberLabel(order.orderNumber)} — {ORDER_STATUS_LABELS[order.status] || order.status}</option>)}</select><span className="text-[11px] text-zinc-500">Pedidos entregues têm um fluxo específico de suporte pós-entrega.</span></label>
                {relatedProductId && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">Pergunta associada ao produto #{relatedProductId}. A loja verá o produto selecionado.</div>}
                <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Sua mensagem</span><textarea value={initialMessage} onChange={(event) => setInitialMessage(event.target.value)} maxLength={4000} rows={6} required placeholder="Escreva sua pergunta…" className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm leading-relaxed focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100" /><span className="block text-right text-[11px] text-zinc-500">{initialMessage.length}/4000</span></label>
                <div className="flex flex-wrap gap-2"><button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><MessageCircle className="w-4 h-4" /> {submitting ? 'Enviando…' : 'Iniciar conversa'}</button><button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-stone-50">Cancelar</button></div>
              </form>
            ) : postDeliveryOrderId ? (
              <form onSubmit={(event) => void submitPostDelivery(event)} className="p-4 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Suporte pós-entrega</h2><p className="mt-1 text-xs text-zinc-600">Pedido {postDeliveryOrder ? formatOrderNumberLabel(postDeliveryOrder.orderNumber) : `#${postDeliveryOrderId}`}</p></div><button type="button" onClick={() => setPostDeliveryOrderId('')} className="lg:hidden text-xs font-semibold text-emerald-800">Voltar</button></div>
                {canStartPostDelivery ? <>
                  <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">Escolha o motivo. É permitido abrir o chamado até {postDeliveryDays} dias após a entrega; a loja poderá acompanhar a conversa por aqui.</p>
                  <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Motivo</span><select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as ReasonCode)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">{REASONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
                  <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Detalhes (opcional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={4} placeholder="Conte mais, se desejar…" className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm" /></label>
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><MessageCircle className="w-4 h-4" />{submitting ? 'Abrindo…' : 'Abrir chamado'}</button>
                </> : <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">O prazo para abrir suporte pós-entrega já terminou. O histórico das conversas anteriores continua disponível.</div>}
              </form>
            ) : selected ? (
              <>
                <div className="border-b border-stone-200 p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><button type="button" onClick={() => { setSelected(null); setPageError(''); }} className="lg:hidden mb-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><ArrowLeft className="w-3.5 h-3.5" /> Voltar à lista</button><h2 className="text-lg font-bold">Atendimento #{selected.id}</h2><p className="mt-0.5 text-sm text-zinc-700">{subjectLabel}</p></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_TONES[selected.status] || ''}`}>{STATUS_LABELS[selected.status] || selected.status}</span></div>
                  {selected.supportReason && <div className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">{reasonLabel(selected.supportReason)}</div>}
                  {selected.order && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3"><div className="flex items-center gap-2 text-xs text-zinc-800"><Package className="w-4 h-4 text-emerald-700" /><span>Pedido <strong>{formatOrderNumberLabel(selected.order.orderNumber)}</strong> · {ORDER_STATUS_LABELS[selected.order.status] || selected.order.status}</span></div><Link to={`/minha-conta/pedidos?orderId=${selected.order.id}`} className="text-xs font-semibold text-emerald-800 underline underline-offset-2">Ver pedido</Link></div>}
                  {selected.productNameSnapshot && <Link to={selected.productLinkSnapshot || `/produto/${selected.productId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 underline"><Package className="w-3.5 h-3.5" />Produto: {selected.productNameSnapshot}</Link>}
                  {selected.lastAuthorRole === 'ADMIN' && selected.status !== 'CLOSED' && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-950">A loja enviou uma nova resposta.</div>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500"><span>Criado {formatDateTime(selected.createdAt)}</span><span>Última atualização {formatDateTime(selected.updatedAt)}</span>{selected.closedAt && <span>Encerrado {formatDateTime(selected.closedAt)}</span>}</div>
                </div>
                <div className="p-4 sm:p-5 space-y-4 max-h-[55vh] overflow-y-auto" aria-live="polite" aria-label="Mensagens do atendimento">
                  {loadingDetail && <p className="text-xs text-zinc-500">Atualizando conversa…</p>}
                  {selected.messages?.map((message) => <article key={message.id} className={`max-w-[92%] rounded-xl border p-3 sm:p-4 ${message.authorRole === 'ADMIN' ? 'mr-auto border-blue-200 bg-blue-50' : 'ml-auto border-emerald-200 bg-emerald-50'}`}><div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-zinc-700"><span>{message.authorRole === 'ADMIN' ? 'Loja DeepShop' : 'Você'}</span><time className="font-normal text-zinc-500">{formatDateTime(message.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900">{message.body}</p></article>)}
                </div>
                {selected.status === 'CLOSED' ? <div className="border-t border-stone-200 p-4 sm:p-5 space-y-3"><p className="rounded-lg bg-stone-50 p-3 text-xs text-zinc-700">Esta conversa está encerrada e pode ser consultada, mas não aceita novas mensagens.</p>{selected.order?.status === 'DELIVERED' && canStartPostDelivery && <button type="button" onClick={() => setPostDeliveryOrderId(String(selected.orderId))} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900"><MessageCircle className="w-4 h-4" />Precisa de ajuda com este pedido?</button>}</div> : (
                  <div className="border-t border-stone-200 p-4 sm:p-5 space-y-3">
                    {selected.order?.status === 'DELIVERED' && canStartPostDelivery && <button type="button" onClick={() => setPostDeliveryOrderId(String(selected.orderId))} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900"><MessageCircle className="w-4 h-4" />Precisa de ajuda com este pedido?</button>}
                    {canReply ? <form onSubmit={(event) => void sendReply(event)} className="space-y-2"><label htmlFor="support-reply" className="block text-xs font-semibold text-zinc-800">Sua mensagem</label><textarea id="support-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000} rows={3} placeholder="Escreva uma mensagem…" className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100" /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-zinc-500">{reply.length}/4000</span><button type="submit" disabled={submitting || !reply.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><Send className="w-4 h-4" />{submitting ? 'Enviando…' : 'Enviar mensagem'}</button></div></form> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50 p-3 text-xs text-zinc-700"><span>{selected.status === 'RESOLVED' ? 'A loja marcou a conversa como resolvida. Se estiver tudo certo, encerre-a.' : 'A loja está acompanhando o atendimento.'}</span>{(selected.status === 'RESOLVED' || selected.canCustomerCancel) && <button type="button" onClick={() => void closeTicket()} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><CheckCircle2 className="w-4 h-4" />{selected.canCustomerCancel ? 'Cancelar conversa' : 'Encerrar atendimento'}</button>}</div>}
                  </div>
                )}
              </>
            ) : (
              <div className="min-h-64 p-8 flex flex-col items-center justify-center text-center"><Clock3 className="w-8 h-8 text-zinc-300" /><h2 className="mt-3 text-sm font-bold text-zinc-800">Selecione uma conversa</h2><p className="mt-1 max-w-sm text-xs text-zinc-500">Escolha uma conversa para continuar ou fale com a loja para iniciar uma nova.</p><button type="button" onClick={openNewTicket} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="w-4 h-4" />Falar com a loja</button></div>
            )}
          </section>
        </div>
      )}
    </main>
  );
};
