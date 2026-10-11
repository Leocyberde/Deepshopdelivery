import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, MapPin, Plus, Search, Shield, Ticket, UserRound, X } from 'lucide-react';
import { useApp, formatCurrency, formatDateTime } from '../../context/AppContext.tsx';

interface AdminCustomersSectionProps {
  customers: any[];
  pendingAddrCount: number;
  customerFilter: 'ALL' | 'PENDING_FREIGHT' | 'WITH_FREE_DELIVERY';
  setCustomerFilter: (val: 'ALL' | 'PENDING_FREIGHT' | 'WITH_FREE_DELIVERY') => void;
  customTicketInputs: Record<number, string>;
  setCustomTicketInputs: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  updatingCustomerTicketId: number | null;
  handleCustomerFreeDeliveryAction: (customerId: number, action: 'GRANT' | 'REMOVE' | 'SET', amount?: number, customerName?: string) => void;
  openAddressFreightModal: (addr: any, customerName?: string) => void;
}

export const AdminCustomersSection: React.FC<AdminCustomersSectionProps> = ({
  pendingAddrCount, customerFilter, setCustomerFilter, customTicketInputs, setCustomTicketInputs,
  updatingCustomerTicketId, handleCustomerFreeDeliveryAction, openAddressFreightModal,
}) => {
  const { apiFetch, toast } = useApp();
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [lgpd, setLgpd] = useState('ALL');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);

  const loadList = useCallback(async () => {
    const sequence = ++listRequestSequence.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25', search: query, status, lgpd, sort, segment: customerFilter });
      const data = await apiFetch(`/api/admin/customers?${params}`);
      if (sequence !== listRequestSequence.current) return;
      setRows(Array.isArray(data?.customers) ? data.customers : []);
      setTotalCount(Number(data?.totalCount || 0)); setTotalPages(Math.max(1, Number(data?.totalPages || 1)));
    } catch (e: any) { if (sequence === listRequestSequence.current) setError(e?.message || 'Não foi possível carregar clientes.'); }
    finally { if (sequence === listRequestSequence.current) setLoading(false); }
  }, [apiFetch, page, query, status, lgpd, sort, customerFilter]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(queryInput.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [queryInput]);
  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = useCallback(async (id: number) => {
    const sequence = ++detailRequestSequence.current;
    setSelectedId(id); setDetailLoading(true); setDetail(null); setOrders([]);
    try {
      const [customer, history] = await Promise.all([
        apiFetch(`/api/admin/customers/${id}`),
        apiFetch(`/api/admin/customers/${id}/orders?limit=10`),
      ]);
      if (sequence !== detailRequestSequence.current) return;
      setDetail(customer); setOrders(Array.isArray(history?.orders) ? history.orders : []);
    } catch (e: any) { if (sequence === detailRequestSequence.current) { toast(e?.message || 'Não foi possível carregar os detalhes.', 'error'); setSelectedId(null); } }
    finally { if (sequence === detailRequestSequence.current) setDetailLoading(false); }
  }, [apiFetch, toast]);

  const changeStatus = async () => {
    if (!detail) return;
    const next = detail.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const label = next === 'ACTIVE' ? 'ativar' : 'desativar';
    if (!window.confirm(`Confirma ${label} a conta de ${detail.name}? O histórico será preservado.`)) return;
    setSavingStatus(true);
    try {
      await apiFetch(`/api/admin/customers/${detail.id}/status`, { method: 'PUT', body: JSON.stringify({ status: next }) });
      toast(`Conta ${next === 'ACTIVE' ? 'ativada' : 'desativada'}; pedidos e histórico preservados.`, 'success');
      await Promise.all([loadList(), loadDetail(detail.id)]);
    } catch (e: any) { toast(e?.message || 'Não foi possível atualizar o status.', 'error'); }
    finally { setSavingStatus(false); }
  };

  const visibleRows = rows;
  const loyalty = detail?.loyalty || {};
  const ticketBalance = Number(loyalty.freeDeliveryTickets ?? detail?.freeDeliveryTickets ?? 0);
  const isNewCustomer = Boolean(loyalty.isFirstOrderEligible ?? Number(detail?.ordersCount || 0) === 0);
  const ticketInput = detail ? customTicketInputs[detail.id] ?? String(ticketBalance) : '0';

  return <div className="space-y-5 min-w-0">
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold text-zinc-900">Clientes & Frete</h1><p className="text-sm text-zinc-500">Busca paginada; endereços e histórico só são carregados quando você abre um cliente. CPF aparece mascarado.</p></div><div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-zinc-600">{pendingAddrCount} endereço(s) aguardando frete</div></header>
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 lg:flex-row">
      <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="Nome, e-mail, telefone ou CPF" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></label>
      <select aria-label="Filtrar clientes por status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="ALL">Todos os status</option><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option><option value="BLOCKED">Bloqueados</option></select>
      <select aria-label="Filtrar clientes por LGPD" value={lgpd} onChange={(e) => { setLgpd(e.target.value); setPage(1); }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="ALL">LGPD: todos</option><option value="PENDING">Solicitação pendente</option><option value="NONE">Sem solicitação</option></select>
      <select aria-label="Ordenar clientes" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="newest">Mais recentes</option><option value="name_asc">Nome A–Z</option><option value="name_desc">Nome Z–A</option></select>
    </div>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setCustomerFilter('ALL')} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${customerFilter === 'ALL' ? 'border-zinc-900 bg-zinc-900 text-white' : 'bg-white'}`}>Todos na página</button><button type="button" onClick={() => setCustomerFilter('PENDING_FREIGHT')} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${customerFilter === 'PENDING_FREIGHT' ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`}>Endereço sem frete ({pendingAddrCount})</button><button type="button" onClick={() => setCustomerFilter('WITH_FREE_DELIVERY')} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${customerFilter === 'WITH_FREE_DELIVERY' ? 'border-emerald-700 bg-emerald-700 text-white' : 'bg-white'}`}>Elegíveis / com tickets</button></div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" onClick={() => void loadList()} className="ml-2 underline">Tentar novamente</button></div>}
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
      {loading ? <div className="flex justify-center gap-2 p-10 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando clientes…</div> : visibleRows.length === 0 ? <div className="p-10 text-center text-sm text-zinc-500">Nenhum cliente corresponde aos filtros nesta página.</div> : visibleRows.map((customer) => <button type="button" key={customer.id} onClick={() => void loadDetail(customer.id)} className={`grid w-full grid-cols-1 gap-2 p-4 text-left hover:bg-stone-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center ${selectedId === customer.id ? 'bg-emerald-50/50' : ''}`}><span className="min-w-0"><strong className="block truncate text-sm">{customer.name}</strong><span className="block truncate text-xs text-zinc-500">{customer.email} · {customer.phone}</span></span><span className="text-xs text-zinc-600">{customer.ordersCount} pedido(s) · {formatCurrency(Number(customer.totalSpent || 0))} · {customer.addressCount} endereço(s)</span><span className="flex flex-wrap gap-2 text-xs"><span className={`rounded-full px-2 py-1 ${customer.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : customer.status === 'BLOCKED' ? 'bg-red-100 text-red-800' : 'bg-stone-100 text-zinc-700'}`}>{customer.status === 'ACTIVE' ? 'Ativo' : customer.status === 'BLOCKED' ? 'Bloqueado' : 'Inativo'}</span>{customer.deletionRequestedAt && <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">LGPD pendente</span>}{customer.pendingAddressCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">{customer.pendingAddressCount} frete pendente</span>}</span></button>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-zinc-500">{totalCount} cliente(s) · página {page} de {totalPages}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Próxima</button></div></div>

    {selectedId !== null && <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4"><div><div className="flex items-center gap-2"><UserRound className="h-5 w-5 text-zinc-500" /><h2 className="text-lg font-bold">Detalhes do cliente</h2></div>{detail && <p className="mt-1 text-xs text-zinc-500">Criado em {formatDateTime(detail.createdAt)} · Último pedido {detail.lastOrderAt ? formatDateTime(detail.lastOrderAt) : '—'} · {detail.ordersCount} pedido(s) · total {formatCurrency(Number(detail.totalSpent || 0))}</p>}</div><button type="button" onClick={() => { setSelectedId(null); setDetail(null); }} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><X className="h-4 w-4" />Fechar</button></div>
      {detailLoading ? <div className="flex justify-center gap-2 p-10 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando endereço, fidelidade e histórico…</div> : detail && <div className="mt-4 space-y-5">
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2"><div><strong>{detail.name}</strong><div className="break-all text-sm text-zinc-600">{detail.email}</div><div className="text-sm text-zinc-600">{detail.phone} · CPF {detail.cpf || 'não informado'}</div></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-stone-200 px-2 py-1 text-xs">{detail.status}</span>{detail.deletionRequestedAt && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Solicitação LGPD em {formatDateTime(detail.deletionRequestedAt)}</span>}<button type="button" disabled={savingStatus} onClick={() => void changeStatus()} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{savingStatus ? 'Salvando…' : detail.status === 'ACTIVE' ? 'Desativar conta' : 'Ativar conta'}</button></div><div className="flex items-center gap-2 text-xs text-zinc-600"><Shield className="h-4 w-4" />Privacidade: {detail.privacyVersion || 'não registrada'} ({detail.privacyAcceptedAt ? formatDateTime(detail.privacyAcceptedAt) : 'sem aceite'})</div><div className="text-xs text-zinc-600">Termos: {detail.termsVersion || 'não registrados'} ({detail.termsAcceptedAt ? formatDateTime(detail.termsAcceptedAt) : 'sem aceite'})</div></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold text-emerald-950"><Ticket className="h-4 w-4" />Fidelidade / entrega grátis</h3><p className="mt-1 text-xs text-emerald-900">Saldo disponível: {ticketBalance} · ciclo: {loyalty.ordersInCurrentCycle ?? 0}/3 · {isNewCustomer ? 'elegível ao primeiro pedido grátis' : `faltam ${loyalty.ordersRemainingForNextTicket ?? 3} pedido(s) para o próximo ticket`}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={updatingCustomerTicketId === detail.id} onClick={() => handleCustomerFreeDeliveryAction(detail.id, 'GRANT', 1, detail.name)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus className="h-3.5 w-3.5" />+1 ticket</button>{ticketBalance > 0 && <button type="button" disabled={updatingCustomerTicketId === detail.id} onClick={() => handleCustomerFreeDeliveryAction(detail.id, 'REMOVE', 1, detail.name)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">−1</button>}<input aria-label="Saldo manual de tickets" type="number" min="0" max="1000" value={ticketInput} onChange={(e) => setCustomTicketInputs((prev) => ({ ...prev, [detail.id]: e.target.value }))} className="w-20 rounded-lg border px-2 py-2 text-center text-xs" /><button type="button" disabled={updatingCustomerTicketId === detail.id} onClick={() => handleCustomerFreeDeliveryAction(detail.id, 'SET', Math.max(0, Math.min(1000, Math.floor(Number(ticketInput) || 0))), detail.name)} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">Definir</button></div></div></div>
        <div><h3 className="mb-2 flex items-center gap-2 font-bold"><MapPin className="h-4 w-4" />Endereços ({detail.addresses?.length || 0})</h3>{!detail.addresses?.length ? <p className="rounded-lg bg-stone-50 p-4 text-sm text-zinc-500">Este cliente ainda não cadastrou endereços.</p> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{detail.addresses.map((address: any) => <article key={address.id} className={`rounded-xl border p-4 ${address.deliveryFeeStatus === 'PENDING' ? 'border-amber-300 bg-amber-50/60' : 'border-stone-200 bg-stone-50/50'}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="break-words text-sm">{address.label}</strong><div className="mt-1 break-words text-sm text-zinc-700">{address.street}, {address.number}{address.complement ? ` — ${address.complement}` : ''}<br />{address.neighborhood}, {address.city}/{address.state} · CEP {address.zipCode}</div></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{address.deliveryFeeStatus === 'PENDING' ? 'Frete pendente' : `R$ ${Number(address.deliveryFee || 0).toFixed(2)}`}</span></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>{address.deliveryDistanceKm ? `${address.deliveryDistanceKm} km` : 'Distância não definida'} · atualizado por {address.updatedByName || '—'}</span><button type="button" onClick={() => openAddressFreightModal({ ...address, customerName: detail.name }, detail.name)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold text-zinc-800">Definir / editar frete</button></div></article>)}</div>}</div>
        <div><h3 className="mb-2 font-bold">Últimos pedidos</h3>{orders.length === 0 ? <p className="rounded-lg bg-stone-50 p-4 text-sm text-zinc-500">Sem pedidos registrados.</p> : <div className="space-y-2">{orders.map((order) => <article key={order.id} className="rounded-lg border border-stone-200 p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>Pedido #{order.orderNumber}</strong><span>{order.status} · {formatCurrency(Number(order.total || 0))} · {formatDateTime(order.createdAt)}</span></div><div className="mt-1 text-xs text-zinc-500">{order.items?.map((item: any) => `${item.quantity}× ${item.productName}`).join(' · ')}</div></article>)}</div>}</div>
      </div>}
    </section>}
  </div>;
};
