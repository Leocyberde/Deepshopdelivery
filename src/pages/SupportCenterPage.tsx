import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock3, LifeBuoy, MessageCircle, Package, Plus, Send } from 'lucide-react';
import { useApp, formatDateTime, formatOrderNumberLabel, isAdminRole, ORDER_STATUS_LABELS } from '../context/AppContext.tsx';

const SUBJECTS = [
  { value: 'AJUDA_COM_PEDIDO', label: 'Ajuda com pedido' },
  { value: 'PAGAMENTO', label: 'Pagamento' },
  { value: 'PRODUTO', label: 'Produto' },
  { value: 'DUVIDA', label: 'Dúvida' },
  { value: 'OUTRO', label: 'Outro' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Novo', IN_PROGRESS: 'Em atendimento', WAITING_CUSTOMER: 'Aguardando você', RESOLVED: 'Resolvido', CLOSED: 'Encerrado',
};
const STATUS_TONES: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-900 border-sky-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-900 border-amber-200',
  WAITING_CUSTOMER: 'bg-sky-100 text-sky-900 border-sky-200',
  RESOLVED: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  CLOSED: 'bg-stone-100 text-zinc-700 border-stone-200',
};

type OrderOption = { id: number; orderNumber: string; status: string };
type TicketSummary = {
  id: number; subject: string; status: string; orderId: number | null; order: OrderOption | null;
  createdAt: string; updatedAt: string; closedAt: string | null; lastAuthorRole: 'ADMIN' | 'CUSTOMER' | null;
};
type TicketDetail = TicketSummary & {
  messages: Array<{ id: number; body: string; createdAt: string; authorRole: 'ADMIN' | 'CUSTOMER'; authorLabel: string }>;
};

function statusLabel(status: string) { return STATUS_LABELS[status] || status; }
function subjectLabel(subject: string) { return SUBJECTS.find((item) => item.value === subject)?.label || subject; }

export const SupportCenterPage: React.FC = () => {
  const { user, apiFetch, toast } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]['value']>('AJUDA_COM_PEDIDO');
  const [relatedOrderId, setRelatedOrderId] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');

  const loadTickets = useCallback(async () => {
    const result = await apiFetch<{ tickets: TicketSummary[] }>('/api/support/tickets');
    setTickets(result.tickets || []);
  }, [apiFetch]);

  const loadDetail = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const result = await apiFetch<{ ticket: TicketDetail }>(`/api/support/tickets/${id}`);
      setSelected(result.ticket);
      setShowNew(false);
    } finally {
      setLoadingDetail(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!user || isAdminRole(user.role)) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch<{ tickets: TicketSummary[] }>('/api/support/tickets'),
      apiFetch<{ orders: Array<{ id: number; orderNumber: string; status: string }> }>('/api/orders?page=1&pageSize=50'),
    ]).then(([ticketResult, orderResult]) => {
      if (cancelled) return;
      setTickets(ticketResult.tickets || []);
      setOrders((orderResult.orders || []).map((order) => ({ id: order.id, orderNumber: order.orderNumber, status: order.status })));
      setPageError('');
      const rawOrderId = new URLSearchParams(location.search).get('orderId');
      if (rawOrderId) {
        const orderId = Number(rawOrderId);
        if (Number.isSafeInteger(orderId) && orderResult.orders?.some((order) => order.id === orderId)) {
          setRelatedOrderId(String(orderId));
          setShowNew(true);
          setSelected(null);
        }
      }
    }).catch((error: any) => {
      if (!cancelled) setPageError(error?.message || 'Não foi possível carregar a Central de Ajuda.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, location.search, user]);

  const sortedMessages = useMemo(() => selected?.messages || [], [selected]);

  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (isAdminRole(user.role)) return <Navigate to="/admin/central-ajuda" replace />;

  const openNewTicket = () => {
    setSelected(null);
    setSubject('AJUDA_COM_PEDIDO');
    setInitialMessage('');
    setPageError('');
    setShowNew(true);
  };

  const submitNewTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!initialMessage.trim()) { setPageError('Escreva uma mensagem para iniciar o atendimento.'); return; }
    setSubmitting(true);
    setPageError('');
    try {
      const result = await apiFetch<{ ticket: TicketDetail }>('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, orderId: relatedOrderId ? Number(relatedOrderId) : null, body: initialMessage }),
      });
      await loadTickets();
      setSelected(result.ticket);
      setShowNew(false);
      setInitialMessage('');
      navigate('/minha-conta/central-ajuda', { replace: true });
      toast('Atendimento aberto com sucesso.', 'success');
    } catch (error: any) {
      setPageError(error?.message || 'Não foi possível abrir o atendimento.');
    } finally { setSubmitting(false); }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setSubmitting(true);
    setPageError('');
    try {
      const result = await apiFetch<{ ticket: TicketDetail }>(`/api/support/tickets/${selected.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }),
      });
      setSelected(result.ticket);
      setReply('');
      await loadTickets();
      toast('Mensagem enviada.', 'success');
    } catch (error: any) { setPageError(error?.message || 'Não foi possível enviar a mensagem.'); }
    finally { setSubmitting(false); }
  };

  const closeTicket = async () => {
    if (!selected) return;
    setSubmitting(true);
    setPageError('');
    try {
      const result = await apiFetch<{ ticket: TicketDetail }>(`/api/support/tickets/${selected.id}/close`, { method: 'POST' });
      setSelected(result.ticket);
      await loadTickets();
      toast('Atendimento encerrado.', 'success');
    } catch (error: any) { setPageError(error?.message || 'Não foi possível encerrar o atendimento.'); }
    finally { setSubmitting(false); }
  };

  const selectedOrder = selected?.order;
  const canReply = Boolean(selected && selected.status !== 'RESOLVED' && selected.status !== 'CLOSED');

  return (
    <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center"><LifeBuoy className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Central de Ajuda</h1>
            <p className="text-sm text-zinc-600">Converse diretamente com a equipe DeepShop dentro da sua conta.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/minha-conta/pedidos" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50"><ArrowLeft className="w-3.5 h-3.5" /> Meus Pedidos</Link>
          <button type="button" onClick={openNewTicket} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"><Plus className="w-4 h-4" /> Novo atendimento</button>
        </div>
      </header>

      {pageError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{pageError}</div>}
      {loading ? <div className="rounded-xl border border-stone-200 bg-white p-8 text-sm text-zinc-500">Carregando seus atendimentos…</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(270px,0.8fr)_minmax(0,1.6fr)] gap-5 items-start">
          <section className={`${selected || showNew ? 'hidden lg:block' : ''} rounded-xl border border-stone-200 bg-white overflow-hidden`} aria-label="Meus atendimentos">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-sm font-bold">Meus atendimentos</h2><span className="text-xs text-zinc-500">{tickets.length}</span>
            </div>
            {tickets.length === 0 ? <p className="px-4 py-8 text-sm text-zinc-500 text-center">Você ainda não abriu atendimentos.</p> : (
              <div className="divide-y divide-stone-100 max-h-[70vh] overflow-y-auto">
                {tickets.map((ticket) => (
                  <button key={ticket.id} type="button" onClick={() => void loadDetail(ticket.id)} className={`w-full text-left p-4 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-emerald-700 ${selected?.id === ticket.id ? 'bg-emerald-50/70' : ''}`} aria-label={`Atendimento #${ticket.id}`}>
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-xs font-bold text-zinc-900">Atendimento #{ticket.id}</div><div className="text-sm font-semibold text-zinc-800 mt-1 truncate">{subjectLabel(ticket.subject)}</div></div><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONES[ticket.status] || ''}`}>{statusLabel(ticket.status)}</span></div>
                    {ticket.order && <div className="mt-1 text-xs text-zinc-600">Pedido {formatOrderNumberLabel(ticket.order.orderNumber)}</div>}
                    {ticket.lastAuthorRole === 'ADMIN' && ticket.status !== 'CLOSED' && <div className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">Nova resposta da loja</div>}
                    <div className="mt-2 text-[11px] text-zinc-500">Atualizado {formatDateTime(ticket.updatedAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className={`${selected || showNew ? '' : 'hidden lg:block'} min-w-0 rounded-xl border border-stone-200 bg-white overflow-hidden`} aria-label={showNew ? 'Novo atendimento' : 'Conversa do atendimento'}>
            {showNew ? (
              <form onSubmit={(event) => void submitNewTicket(event)} className="p-4 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Novo atendimento</h2><p className="mt-1 text-xs text-zinc-600">Conte como podemos ajudar. Não inclua senhas ou dados de pagamento sensíveis.</p></div><button type="button" onClick={() => setShowNew(false)} className="lg:hidden text-xs font-semibold text-emerald-800">Voltar à lista</button></div>
                <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Assunto</span><select value={subject} onChange={(event) => setSubject(event.target.value as typeof subject)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm"><option value="AJUDA_COM_PEDIDO">Ajuda com pedido</option><option value="PAGAMENTO">Pagamento</option><option value="PRODUTO">Produto</option><option value="DUVIDA">Dúvida</option><option value="OUTRO">Outro</option></select></label>
                <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Pedido relacionado (opcional)</span><select value={relatedOrderId} onChange={(event) => setRelatedOrderId(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm"><option value="">Nenhum pedido</option>{orders.map((order) => <option key={order.id} value={order.id}>{formatOrderNumberLabel(order.orderNumber)} — {ORDER_STATUS_LABELS[order.status] || order.status}</option>)}</select></label>
                <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Mensagem inicial</span><textarea value={initialMessage} onChange={(event) => setInitialMessage(event.target.value)} maxLength={4000} rows={6} required placeholder="Escreva sua mensagem…" className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm leading-relaxed focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100" /><span className="block text-right text-[11px] text-zinc-500">{initialMessage.length}/4000</span></label>
                <div className="flex flex-wrap gap-2"><button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><MessageCircle className="w-4 h-4" /> {submitting ? 'Abrindo…' : 'Abrir atendimento'}</button><button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-stone-50">Cancelar</button></div>
              </form>
            ) : selected ? (
              <>
                <div className="border-b border-stone-200 p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><button type="button" onClick={() => { setSelected(null); setPageError(''); }} className="lg:hidden mb-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><ArrowLeft className="w-3.5 h-3.5" /> Voltar à lista</button><h2 className="text-lg font-bold">Atendimento #{selected.id}</h2><p className="mt-0.5 text-sm text-zinc-700">{subjectLabel(selected.subject)}</p></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_TONES[selected.status] || ''}`}>{statusLabel(selected.status)}</span></div>
                  {selectedOrder && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3"><div className="flex items-center gap-2 text-xs text-zinc-800"><Package className="w-4 h-4 text-emerald-700" /><span>Pedido <strong>{formatOrderNumberLabel(selectedOrder.orderNumber)}</strong> · {ORDER_STATUS_LABELS[selectedOrder.status] || selectedOrder.status}</span></div><Link to={`/minha-conta/pedidos?orderId=${selectedOrder.id}`} className="text-xs font-semibold text-emerald-800 underline underline-offset-2">Ver pedido</Link></div>}
                  {selected.messages.at(-1)?.authorRole === 'ADMIN' && selected.status !== 'CLOSED' && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-950">A equipe DeepShop enviou uma nova resposta.</div>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500"><span>Criado {formatDateTime(selected.createdAt)}</span><span>Última atualização {formatDateTime(selected.updatedAt)}</span>{selected.closedAt && <span>Encerrado {formatDateTime(selected.closedAt)}</span>}</div>
                </div>
                <div className="p-4 sm:p-5 space-y-4 max-h-[55vh] overflow-y-auto" aria-live="polite" aria-label="Mensagens do atendimento">
                  {loadingDetail && <p className="text-xs text-zinc-500">Atualizando conversa…</p>}
                  {sortedMessages.map((message) => <article key={message.id} className={`max-w-[92%] rounded-xl border p-3 sm:p-4 ${message.authorRole === 'ADMIN' ? 'mr-auto border-blue-200 bg-blue-50' : 'ml-auto border-emerald-200 bg-emerald-50'}`}><div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-zinc-700"><span>{message.authorRole === 'ADMIN' ? 'Loja DeepShop' : 'Você'}</span><time className="font-normal text-zinc-500">{formatDateTime(message.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900">{message.body}</p></article>)}
                </div>
                <div className="border-t border-stone-200 p-4 sm:p-5 space-y-3">
                  {canReply ? <form onSubmit={(event) => void sendReply(event)} className="space-y-2"><label htmlFor="support-reply" className="block text-xs font-semibold text-zinc-800">Sua mensagem</label><textarea id="support-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000} rows={3} placeholder="Escreva uma mensagem…" className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100" /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-zinc-500">{reply.length}/4000</span><button type="submit" disabled={submitting || !reply.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><Send className="w-4 h-4" /> {submitting ? 'Enviando…' : 'Enviar mensagem'}</button></div></form> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50 p-3 text-xs text-zinc-700"><span>{selected.status === 'RESOLVED' ? 'O atendimento foi resolvido. Se estiver tudo certo, você pode encerrá-lo.' : 'Este atendimento está encerrado.'}</span>{selected.status === 'RESOLVED' && <button type="button" onClick={() => void closeTicket()} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><CheckCircle2 className="w-4 h-4" /> Encerrar atendimento</button>}</div>}
                </div>
              </>
            ) : (
              <div className="min-h-64 p-8 flex flex-col items-center justify-center text-center"><Clock3 className="w-8 h-8 text-zinc-300" /><h2 className="mt-3 text-sm font-bold text-zinc-800">Selecione um atendimento</h2><p className="mt-1 max-w-sm text-xs text-zinc-500">Escolha um item da lista ou abra um novo atendimento para conversar com a loja.</p></div>
            )}
          </section>
        </div>
      )}
    </main>
  );
};
