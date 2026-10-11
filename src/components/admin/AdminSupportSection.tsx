import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { formatDateTime, formatOrderNumberLabel, ORDER_STATUS_LABELS } from '../../context/AppContext.tsx';

const STATUSES = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OPEN', label: 'Novos' },
  { value: 'IN_PROGRESS', label: 'Em atendimento' },
  { value: 'WAITING_CUSTOMER', label: 'Aguardando cliente' },
  { value: 'RESOLVED', label: 'Resolvidos' },
  { value: 'CLOSED', label: 'Encerrados' },
] as const;
const SUBJECTS = [
  { value: 'ALL', label: 'Todos os assuntos' },
  { value: 'AJUDA_COM_PEDIDO', label: 'Ajuda com pedido' },
  { value: 'PAGAMENTO', label: 'Pagamento' },
  { value: 'PRODUTO', label: 'Produto' },
  { value: 'DUVIDA', label: 'Dúvida' },
  { value: 'OUTRO', label: 'Outro' },
] as const;
const STATUS_TONES: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-900', IN_PROGRESS: 'bg-amber-100 text-amber-900', WAITING_CUSTOMER: 'bg-sky-100 text-sky-900', RESOLVED: 'bg-emerald-100 text-emerald-900', CLOSED: 'bg-stone-100 text-zinc-700',
};

type SupportMessage = { id: number; body: string; createdAt: string; authorRole: 'ADMIN' | 'CUSTOMER'; authorLabel: string };
type SupportTicket = {
  id: number; userId: number; orderId: number | null; subject: string; status: string;
  createdAt: string; updatedAt: string; closedAt: string | null;
  customerName: string; customerEmail: string;
  order: { id: number; orderNumber: string; status: string } | null;
  messages?: SupportMessage[];
};
type ApiFetch = <T = any>(url: string, options?: RequestInit) => Promise<T>;

function subjectLabel(subject: string) { return SUBJECTS.find((item) => item.value === subject)?.label || subject; }
function statusLabel(status: string) { return STATUSES.find((item) => item.value === status)?.label || status; }

export const AdminSupportSection: React.FC<{ apiFetch: ApiFetch; toast: (text: string, type?: 'success' | 'error' | 'info') => void }> = ({ apiFetch, toast }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter, subject: subjectFilter, q: search.trim(), page: '1', pageSize: '50' });
    const result = await apiFetch<{ tickets: SupportTicket[] }>(`/api/admin/support/tickets?${params.toString()}`);
    setTickets(result.tickets || []);
  }, [apiFetch, search, statusFilter, subjectFilter]);

  const loadDetail = useCallback(async (ticketId: number) => {
    const result = await apiFetch<{ ticket: SupportTicket }>(`/api/admin/support/tickets/${ticketId}`);
    setSelected(result.ticket);
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadTickets().catch((err: any) => { if (!cancelled) setError(err?.message || 'Não foi possível carregar os atendimentos.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadTickets]);

  const refresh = async () => {
    setBusy(true); setError('');
    try { await loadTickets(); if (selected) await loadDetail(selected.id); }
    catch (err: any) { setError(err?.message || 'Não foi possível atualizar a Central de Ajuda.'); }
    finally { setBusy(false); }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/admin/support/tickets/${selected.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }) });
      setReply('');
      await Promise.all([loadDetail(selected.id), loadTickets()]);
      toast('Resposta enviada à Central de Ajuda.', 'success');
    } catch (err: any) { setError(err?.message || 'Não foi possível enviar a resposta.'); }
    finally { setBusy(false); }
  };

  const updateStatus = async (nextStatus: string) => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/admin/support/tickets/${selected.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
      await Promise.all([loadDetail(selected.id), loadTickets()]);
      toast('Status do atendimento atualizado.', 'success');
    } catch (err: any) { setError(err?.message || 'Não foi possível alterar o status.'); }
    finally { setBusy(false); }
  };

  const [pendingStatus, setPendingStatus] = useState('');
  useEffect(() => { setPendingStatus(selected?.status || ''); }, [selected?.id, selected?.status]);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center"><LifeBuoy className="w-5 h-5" /></div><div><h1 className="text-xl font-bold text-zinc-900">Central de Ajuda</h1><p className="text-xs text-zinc-600">Atendimentos enviados pelos clientes dentro da loja.</p></div></div>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-stone-50 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Atualizar</button>
      </header>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)] gap-5 items-start">
        <section className="min-w-0 rounded-xl border border-stone-200 bg-white overflow-hidden" aria-label="Lista de atendimentos">
          <div className="p-3.5 border-b border-stone-200 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><label className="text-[11px] font-semibold text-zinc-600">Status<select aria-label="Filtrar por status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs">{STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-[11px] font-semibold text-zinc-600">Assunto<select aria-label="Filtrar por assunto" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs">{SUBJECTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
            <label className="block text-[11px] font-semibold text-zinc-600">Pesquisar<input aria-label="Pesquisar atendimentos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, e-mail ou número" className="mt-1 block w-full rounded-lg border border-stone-300 px-2.5 py-2 text-xs" /></label>
          </div>
          {loading ? <p className="p-6 text-sm text-zinc-500">Carregando atendimentos…</p> : tickets.length === 0 ? <p className="p-8 text-center text-sm text-zinc-500">Nenhum atendimento corresponde aos filtros.</p> : (
            <div className="divide-y divide-stone-100 max-h-[68vh] overflow-y-auto">{tickets.map((ticket) => <button key={ticket.id} type="button" aria-label={`Atendimento #${ticket.id}`} onClick={() => void loadDetail(ticket.id).catch((err: any) => setError(err?.message || 'Falha ao abrir atendimento.'))} className={`w-full p-3.5 text-left hover:bg-stone-50 ${selected?.id === ticket.id ? 'bg-emerald-50/60' : ''}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-xs font-bold text-zinc-900">#{ticket.id} · {ticket.customerName}</div><div className="mt-1 text-xs text-zinc-700 truncate">{subjectLabel(ticket.subject)}</div></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONES[ticket.status] || 'bg-stone-100 text-zinc-700'}`}>{statusLabel(ticket.status)}</span></div>{ticket.order && <div className="mt-1 text-[11px] text-zinc-600">Pedido {formatOrderNumberLabel(ticket.order.orderNumber)}</div>}<div className="mt-1.5 text-[10px] text-zinc-500">Atualizado {formatDateTime(ticket.updatedAt)}</div></button>)}</div>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-stone-200 bg-white overflow-hidden" aria-label="Detalhes do atendimento">
          {!selected ? <div className="min-h-64 p-8 flex flex-col items-center justify-center text-center"><MessageCircle className="w-8 h-8 text-zinc-300" /><h2 className="mt-3 text-sm font-bold">Abra um atendimento</h2><p className="mt-1 text-xs text-zinc-500">Selecione um item da lista para visualizar e responder.</p></div> : <>
            <div className="p-4 sm:p-5 border-b border-stone-200 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-bold">Atendimento #{selected.id}</h2><p className="mt-0.5 text-sm text-zinc-700">{subjectLabel(selected.subject)} · {selected.customerName}</p><p className="text-xs text-zinc-500">{selected.customerEmail}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONES[selected.status] || ''}`}>{statusLabel(selected.status)}</span></div>
              {selected.order && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs"><span>Pedido <strong>{formatOrderNumberLabel(selected.order.orderNumber)}</strong> · {ORDER_STATUS_LABELS[selected.order.status] || selected.order.status}</span><Link to="/admin/pedidos" className="font-semibold text-emerald-800 underline underline-offset-2">Ver pedidos</Link></div>}
              <div className="flex flex-wrap items-end gap-2"><label className="text-[11px] font-semibold text-zinc-600">Alterar status<select aria-label="Novo status do atendimento" value={pendingStatus} onChange={(event) => setPendingStatus(event.target.value)} className="mt-1 block rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs">{STATUSES.filter((item) => item.value !== 'ALL').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button type="button" onClick={() => void updateStatus(pendingStatus)} disabled={busy || pendingStatus === selected.status} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-stone-50 disabled:opacity-50">Salvar status</button></div>
              <p className="text-[11px] text-zinc-500">Criado {formatDateTime(selected.createdAt)} · Atualizado {formatDateTime(selected.updatedAt)}</p>
            </div>
            <div className="p-4 sm:p-5 space-y-4 max-h-[48vh] overflow-y-auto" aria-live="polite" aria-label="Conversa com cliente">{selected.messages?.map((message) => <article key={message.id} className={`max-w-[94%] rounded-xl border p-3 sm:p-4 ${message.authorRole === 'ADMIN' ? 'ml-auto border-emerald-200 bg-emerald-50' : 'mr-auto border-stone-200 bg-stone-50'}`}><div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-zinc-700"><span>{message.authorRole === 'ADMIN' ? 'Loja · ' + message.authorLabel : selected.customerName}</span><time className="font-normal text-zinc-500">{formatDateTime(message.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900">{message.body}</p></article>)}</div>
            <form onSubmit={(event) => void sendReply(event)} className="border-t border-stone-200 p-4 sm:p-5 space-y-2"><label htmlFor="admin-support-reply" className="block text-xs font-semibold text-zinc-800">Resposta ao cliente</label><textarea id="admin-support-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000} rows={3} placeholder="Escreva uma resposta…" disabled={selected.status === 'CLOSED'} className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm disabled:bg-stone-100" /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-zinc-500">Máximo de 4000 caracteres. O conteúdo não é copiado para a notificação administrativa.</span><button type="submit" disabled={busy || !reply.trim() || selected.status === 'CLOSED'} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><Send className="w-4 h-4" /> {busy ? 'Enviando…' : 'Enviar resposta'}</button></div></form>
          </>}
        </section>
      </div>
    </section>
  );
};
