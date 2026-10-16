import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Undo2 } from 'lucide-react';

type Props = { isOwner: boolean; apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>; toast: (text: string, type?: 'success' | 'error' | 'info') => void };

const TABS: Array<{ id: string; label: string }> = [
  { id: 'REQUESTED', label: 'Aguardando decisão' },
  { id: 'APPROVED', label: 'Aprovados (devolver)' },
  { id: 'PROCESSED', label: 'Devolvidos' },
  { id: 'REJECTED', label: 'Recusados' },
  { id: 'ALL', label: 'Todos' },
];
const STATUS_LABEL: Record<string, string> = { REQUESTED: 'Aguardando decisão', APPROVED: 'Aprovado — devolver', PROCESSED: 'Devolvido', REJECTED: 'Recusado' };
const money = (value: unknown) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
const dateTime = (value: unknown) => (value ? new Date(String(value)).toLocaleString('pt-BR') : '—');

export const AdminRefundsSection: React.FC<Props> = ({ isOwner, apiFetch, toast }) => {
  const [tab, setTab] = useState('REQUESTED');
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState({ pending: 0, overdue: 0, toRefund: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!isOwner) { setLoading(false); return; }
    setLoading(true);
    try {
      const data: any = await apiFetch(`/api/admin/refunds${tab !== 'ALL' ? `?status=${tab}` : ''}`);
      setRows(data.refunds || []);
      setCounts({ pending: data.pendingCount || 0, overdue: data.overdueCount || 0, toRefund: data.awaitingPaymentCount || 0 });
    } catch (error: any) { toast(error.message || 'Não foi possível carregar os reembolsos.', 'error'); } finally { setLoading(false); }
  }, [apiFetch, isOwner, tab, toast]);
  useEffect(() => { void load(); }, [load]);

  const act = async (row: any, action: 'approve' | 'reject' | 'mark-refunded') => {
    const note = (notes[row.id] || '').trim();
    if (action === 'reject' && note.length < 3) { toast('Informe o motivo da recusa no campo de observação.', 'error'); return; }
    setBusy(row.id);
    try {
      const body = action === 'approve' ? { amount: amounts[row.id] || undefined, note: note || undefined } : action === 'reject' ? { reason: note } : { note: note || undefined };
      await apiFetch(`/api/admin/refunds/${row.id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      toast(action === 'approve' ? 'Reembolso aprovado e cliente avisado.' : action === 'reject' ? 'Reembolso recusado e cliente avisado.' : 'Devolução registrada e cliente avisado.', 'success');
      setNotes((current) => ({ ...current, [row.id]: '' }));
      await load();
    } catch (error: any) { toast(error.message || 'Não foi possível concluir a ação.', 'error'); } finally { setBusy(null); }
  };

  if (!isOwner) {
    return <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"><h1 className="text-lg font-bold">Reembolsos</h1><p className="mt-2">Somente o dono da loja pode ver e decidir reembolsos.</p></section>;
  }

  return <section className="space-y-4">
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">Reembolsos</h1>
      <p className="mt-1 text-sm text-zinc-500">Decida em até 24 horas. A devolução do dinheiro é feita por você, fora do sistema; aqui você registra a decisão e o cliente é avisado. O frete (corrida) nunca entra no valor.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-stone-200 bg-white p-3"><div className="text-xs text-zinc-500">Aguardando decisão</div><div className="text-2xl font-bold">{counts.pending}</div></div>
      <div className={`rounded-xl border p-3 ${counts.overdue > 0 ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white'}`}><div className="text-xs text-zinc-500">Fora do prazo de 24h</div><div className="text-2xl font-bold">{counts.overdue}</div></div>
      <div className="rounded-xl border border-stone-200 bg-white p-3"><div className="text-xs text-zinc-500">Aprovados, falta devolver</div><div className="text-2xl font-bold">{counts.toRefund}</div></div>
    </div>
    <div className="flex flex-wrap gap-2">{TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tab === item.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-stone-300 bg-white text-zinc-700'}`}>{item.label}</button>)}</div>
    {loading ? <div className="rounded-xl border bg-white p-8 text-sm text-zinc-500">Carregando…</div> : rows.length === 0 ? <div className="rounded-xl border bg-white p-8 text-sm text-zinc-500">Nenhum reembolso nesta lista.</div> : <div className="grid gap-3">{rows.map((row) => (
      <article key={row.id} className={`rounded-xl border bg-white p-4 shadow-sm ${row.overdue ? 'border-red-400 bg-red-50/50' : 'border-stone-200'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2"><Undo2 className="h-4 w-4 text-emerald-700" /><h2 className="font-bold">Pedido {row.order.orderNumber}</h2>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700">{STATUS_LABEL[row.status] || row.status}</span>
              {row.overdue && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800"><AlertTriangle className="h-3 w-3" />Fora do prazo</span>}
            </div>
            <p className="mt-1 text-xs text-zinc-600">{row.customer.name} · {row.customer.email}{row.customer.phone ? ` · ${row.customer.phone}` : ''}</p>
            <p className="mt-1 text-xs text-zinc-600">Motivo: {row.reason}</p>
            {row.items?.length > 0 && <p className="mt-1 text-xs text-zinc-600">Itens da encomenda: {row.items.map((item: any) => `${item.name} x${item.quantity}`).join(', ')}</p>}
            {row.payment && <p className="mt-1 text-[11px] text-zinc-500">Pagamento no Mercado Pago — pedido {row.payment.providerOrderId || '—'} · pagamento {row.payment.providerPaymentId || '—'} · {row.payment.status}</p>}
          </div>
          <div className="text-right text-xs text-zinc-600">
            <div>Pedido: {dateTime(row.createdAt)}</div>
            {row.status === 'REQUESTED' && <div className={row.overdue ? 'font-bold text-red-700' : ''}><Clock3 className="mr-1 inline h-3 w-3" />{row.overdue ? `Venceu em ${dateTime(row.dueAt)}` : `Decidir até ${dateTime(row.dueAt)} (${row.hoursLeft}h)`}</div>}
            <div className="mt-1 text-base font-bold text-zinc-900">{money(row.approvedAmount ?? row.requestedAmount)}</div>
            <div className="text-[11px] text-zinc-500">Máximo (só itens, sem frete): {money(row.maxAmount)}</div>
          </div>
        </div>
        {(row.status === 'REQUESTED' || row.status === 'APPROVED') && <div className="mt-3 flex flex-wrap items-end gap-2">
          {row.status === 'REQUESTED' && <label className="text-xs text-zinc-600">Valor a devolver (R$)<input inputMode="decimal" value={amounts[row.id] ?? String(row.requestedAmount).replace('.', ',')} onChange={(e) => setAmounts((current) => ({ ...current, [row.id]: e.target.value }))} className="mt-1 block w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-sm" /></label>}
          <label className="min-w-[14rem] flex-1 text-xs text-zinc-600">{row.status === 'REQUESTED' ? 'Observação (obrigatória para recusar)' : 'Observação (ex.: como foi devolvido)'}<input value={notes[row.id] || ''} onChange={(e) => setNotes((current) => ({ ...current, [row.id]: e.target.value }))} className="mt-1 block w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" /></label>
          {row.status === 'REQUESTED' && <>
            <button type="button" disabled={busy === row.id} onClick={() => void act(row, 'approve')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Aprovar</button>
            <button type="button" disabled={busy === row.id} onClick={() => void act(row, 'reject')} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Recusar</button>
          </>}
          {row.status === 'APPROVED' && <button type="button" disabled={busy === row.id} onClick={() => void act(row, 'mark-refunded')} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Marcar como devolvido</button>}
        </div>}
        {row.decisionReason && <p className="mt-2 text-xs text-zinc-600">Observação da decisão: {row.decisionReason}</p>}
        {row.notes && <p className="mt-1 text-xs text-zinc-600">Devolução: {row.notes}</p>}
      </article>
    ))}</div>}
  </section>;
};
