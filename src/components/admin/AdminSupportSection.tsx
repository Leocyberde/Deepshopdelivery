import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LifeBuoy, MessageCircle, Plus, RefreshCw, Search, Send, Settings, UserRound } from 'lucide-react';
import { formatDateTime, formatOrderNumberLabel, ORDER_STATUS_LABELS } from '../../context/AppContext.tsx';

type SupportMessage = { id: number; body: string; createdAt: string; authorRole: 'ADMIN' | 'CUSTOMER'; authorLabel: string };
type OrderOption = { id: number; orderNumber: string; status: string; deliveredAt?: string | null };
type CustomerOption = { id: number; name: string; email: string };
type ProductOption = { id: number; name: string; code: string };
type SupportTicket = {
  id: number; userId: number; orderId: number | null; subject: string; status: string;
  createdAt: string; updatedAt: string; closedAt: string | null; closedReason?: string | null;
  customerName: string; customerEmail: string; order: OrderOption | null;
  productId: number | null; productNameSnapshot: string | null; productLinkSnapshot: string | null;
  supportReason: string | null; postDelivery: boolean; lastMessageId?: number | null;
  lastAuthorRole?: 'ADMIN' | 'CUSTOMER' | null; unreadForStore?: boolean; messages?: SupportMessage[];
};
type SupportSettings = {
  postDeliveryDays: number; postDeliveryAutoCloseDays: number; generalAutoCloseDays: number;
  retentionMonths: number; maxOpenPerCustomer: number; ticketsPerHour: number; postDeliveryPerOrder: number;
};
type ApiFetch = <T = any>(url: string, options?: RequestInit) => Promise<T>;
type Props = { apiFetch: ApiFetch; toast: (text: string, type?: 'success' | 'error' | 'info') => void };
const STATUSES = [
  { value: 'ALL', label: 'Todos' }, { value: 'OPEN', label: 'Novos' }, { value: 'IN_PROGRESS', label: 'Em atendimento' },
  { value: 'WAITING_CUSTOMER', label: 'Aguardando cliente' }, { value: 'RESOLVED', label: 'Resolvidos' }, { value: 'CLOSED', label: 'Encerrados' },
] as const;
const SUBJECTS = [
  { value: 'ALL', label: 'Todos os assuntos' }, { value: 'AJUDA_COM_PEDIDO', label: 'Ajuda com pedido' },
  { value: 'PAGAMENTO', label: 'Pagamento' }, { value: 'PRODUTO', label: 'Produto' }, { value: 'DUVIDA', label: 'Dúvida' }, { value: 'OUTRO', label: 'Outro' },
] as const;
const REASONS = [
  { value: 'ALL', label: 'Todos os motivos' }, { value: 'ORDER_PROBLEM', label: 'Pedido com problema' },
  { value: 'WRONG_ORDER', label: 'Pedido errado' }, { value: 'MISSING_ITEM', label: 'Item faltando/incompleto' },
  { value: 'DAMAGED_PRODUCT', label: 'Produto danificado' }, { value: 'NOT_DELIVERED', label: 'Não chegou (marcado entregue)' }, { value: 'OTHER', label: 'Outro' },
] as const;
const STATUS_TONES: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-900', IN_PROGRESS: 'bg-amber-100 text-amber-900', WAITING_CUSTOMER: 'bg-blue-100 text-blue-900',
  RESOLVED: 'bg-emerald-100 text-emerald-900', CLOSED: 'bg-stone-100 text-zinc-700',
};
const DEFAULT_SETTINGS: SupportSettings = {
  postDeliveryDays: 30, postDeliveryAutoCloseDays: 15, generalAutoCloseDays: 30,
  retentionMonths: 12, maxOpenPerCustomer: 10, ticketsPerHour: 5, postDeliveryPerOrder: 5,
};
function subjectLabel(subject: string) { return SUBJECTS.find((item) => item.value === subject)?.label || subject; }
function reasonLabel(reason: string | null | undefined) { return REASONS.find((item) => item.value === reason)?.label || ''; }
function mergeMessages(current: SupportMessage[], incoming: SupportMessage[]) {
  const map = new Map<number, SupportMessage>(); [...current, ...incoming].forEach((message) => map.set(message.id, message));
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export const AdminSupportSection: React.FC<Props> = ({ apiFetch, toast }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const selectedRef = useRef<SupportTicket | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [reasonFilter, setReasonFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [panel, setPanel] = useState<'INBOX' | 'SETTINGS'>('INBOX');
  const [showNew, setShowNew] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerOrders, setCustomerOrders] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [newSubject, setNewSubject] = useState('DUVIDA');
  const [initialMessage, setInitialMessage] = useState('');
  const [settings, setSettings] = useState<SupportSettings>(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter, subject: subjectFilter, reason: reasonFilter, q: search.trim(), page: '1', pageSize: '50' });
    const result = await apiFetch<{ tickets: SupportTicket[]; unreadCount?: number }>(`/api/admin/support/tickets?${params.toString()}`);
    setTickets(result.tickets || []); setUnreadCount(Number(result.unreadCount || 0));
  }, [apiFetch, reasonFilter, search, statusFilter, subjectFilter]);
  const loadDetail = useCallback(async (id: number, sinceId?: number | null, merge = false) => {
    setLoadingDetail(true);
    try {
      const suffix = sinceId ? `?since=${encodeURIComponent(String(sinceId))}` : '';
      const result = await apiFetch<{ ticket: SupportTicket }>(`/api/admin/support/tickets/${id}${suffix}`);
      setSelected((previous) => {
        if (!merge || previous?.id !== id) return result.ticket;
        const messages = mergeMessages(previous.messages || [], result.ticket.messages || []);
        return { ...previous, ...result.ticket, messages, lastAuthorRole: messages.at(-1)?.authorRole || null, unreadForStore: false };
      });
      return result.ticket;
    } finally { setLoadingDetail(false); }
  }, [apiFetch]);
  useEffect(() => {
    let cancelled = false; setLoading(true);
    const timer = window.setTimeout(() => {
      loadTickets().catch((err: any) => { if (!cancelled) setError(err?.message || 'Não foi possível carregar os atendimentos.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadTickets]);
  useEffect(() => {
    if (panel !== 'SETTINGS') return;
    let cancelled = false; setSettingsLoading(true);
    apiFetch<SupportSettings>('/api/admin/support/settings').then((data) => { if (!cancelled) setSettings({ ...DEFAULT_SETTINGS, ...data }); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Não foi possível carregar os prazos.'); })
      .finally(() => { if (!cancelled) setSettingsLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, panel]);
  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2 || !showNew) { setCustomerOptions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => apiFetch<{ customers: CustomerOption[] }>(`/api/admin/support/customers?q=${encodeURIComponent(q)}`)
      .then((result) => { if (!cancelled) setCustomerOptions(result.customers || []); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Não foi possível buscar clientes.'); }), 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [apiFetch, customerQuery, showNew]);
  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 2 || !showNew) { setProductOptions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => apiFetch<{ products: ProductOption[] }>(`/api/admin/support/products?q=${encodeURIComponent(q)}`)
      .then((result) => { if (!cancelled) setProductOptions(result.products || []); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Não foi possível buscar produtos.'); }), 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [apiFetch, productQuery, showNew]);
  useEffect(() => {
    if (!selectedCustomer) { setCustomerOrders([]); setOrderId(''); return; }
    let cancelled = false;
    apiFetch<{ orders: OrderOption[] }>(`/api/admin/support/customers/${selectedCustomer.id}/orders`)
      .then((result) => { if (!cancelled) setCustomerOrders(result.orders || []); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Não foi possível carregar pedidos do cliente.'); });
    return () => { cancelled = true; };
  }, [apiFetch, selectedCustomer]);
  // Polling incremental da conversa aberta, pausado enquanto a aba do navegador estiver oculta.
  useEffect(() => {
    const ticketId = selected?.id; if (!ticketId) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = selectedRef.current; if (!current || current.id !== ticketId) return;
      try { await loadDetail(ticketId, current.messages?.at(-1)?.id || null, true); await loadTickets(); } catch { /* a próxima rodada recupera */ }
    };
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadDetail, loadTickets, selected?.id]);

  const selectTicket = (ticket: SupportTicket) => { setShowNew(false); setError(''); void loadDetail(ticket.id).catch((err: any) => setError(err?.message || 'Não foi possível abrir o atendimento.')); };
  const startNew = () => {
    setSelected(null); setShowNew(true); setSelectedCustomer(null); setCustomerQuery(''); setCustomerOrders([]); setOrderId('');
    setSelectedProduct(null); setProductQuery(''); setNewSubject('DUVIDA'); setInitialMessage(''); setError('');
  };
  const submitNew = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedCustomer) { setError('Selecione um cliente.'); return; }
    if (!initialMessage.trim()) { setError('Escreva a mensagem inicial.'); return; }
    setBusy(true); setError('');
    try {
      const result = await apiFetch<{ ticket: SupportTicket }>('/api/admin/support/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: selectedCustomer.id, orderId: orderId ? Number(orderId) : null, productId: selectedProduct?.id ?? null, subject: newSubject, body: initialMessage }),
      });
      setShowNew(false); setInitialMessage(''); setSelectedCustomer(null); setSelectedProduct(null);
      await loadTickets(); await loadDetail(result.ticket.id); toast('Conversa iniciada e cliente notificado.', 'success');
    } catch (err: any) { setError(err?.message || 'Não foi possível iniciar a conversa.'); }
    finally { setBusy(false); }
  };
  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected || !reply.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await apiFetch<{ ticket: SupportTicket }>(`/api/admin/support/tickets/${selected.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }),
      });
      setSelected({ ...selected, ...result.ticket, customerName: selected.customerName, customerEmail: selected.customerEmail });
      setReply(''); await loadTickets(); toast('Resposta enviada e cliente notificado.', 'success');
    } catch (err: any) { setError(err?.message || 'Não foi possível enviar a resposta.'); }
    finally { setBusy(false); }
  };
  const changeStatus = async (status: string) => {
    if (!selected) return; setBusy(true); setError('');
    try {
      const result = await apiFetch<{ ticket: SupportTicket }>(`/api/admin/support/tickets/${selected.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      setSelected({ ...selected, ...result.ticket, customerName: selected.customerName, customerEmail: selected.customerEmail });
      await loadTickets(); toast(`Status alterado para ${STATUSES.find((item) => item.value === status)?.label || status}.`, 'success');
    } catch (err: any) { setError(err?.message || 'Não foi possível alterar o status.'); }
    finally { setBusy(false); }
  };
  const refresh = async () => { setLoading(true); try { await loadTickets(); if (selected) await loadDetail(selected.id); } catch (err: any) { setError(err?.message || 'Não foi possível atualizar.'); } finally { setLoading(false); } };
  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault(); setSettingsSaving(true); setError('');
    try {
      const updated = await apiFetch<SupportSettings>('/api/admin/support/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
      });
      setSettings({ ...DEFAULT_SETTINGS, ...updated }); toast('Prazos e limites salvos.', 'success');
    } catch (err: any) { setError(err?.message || 'Não foi possível salvar os prazos.'); }
    finally { setSettingsSaving(false); }
  };
  const field = (key: keyof SupportSettings, label: string, min: number, max: number, helper: string) => (
    <label key={key} className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">{label}</span><input type="number" min={min} max={max} step={1} required value={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: Number(event.target.value) }))} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" /><span className="block text-[11px] text-zinc-500">{helper}</span></label>
  );
  const selectedHasDeliveryLock = selected?.closedReason === 'ORDER_DELIVERED';
  const lastMessageId = selected?.messages?.at(-1)?.id || null;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><LifeBuoy className="w-5 h-5 text-emerald-700" /><div><h2 className="text-lg font-bold text-zinc-900">Central de Ajuda</h2><p className="text-xs text-zinc-600">{unreadCount ? `${unreadCount} conversa(s) com mensagem não lida` : 'Atendimentos de clientes e conversas iniciadas pela loja'}</p></div></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setPanel('INBOX')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${panel === 'INBOX' ? 'bg-zinc-900 text-white' : 'border border-stone-300 bg-white text-zinc-700'}`}><MessageCircle className="w-3.5 h-3.5" /> Caixa</button><button type="button" onClick={() => setPanel('SETTINGS')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${panel === 'SETTINGS' ? 'bg-zinc-900 text-white' : 'border border-stone-300 bg-white text-zinc-700'}`}><Settings className="w-3.5 h-3.5" /> Prazos e limites</button><button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar</button>{panel === 'INBOX' && <button type="button" onClick={startNew} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="w-4 h-4" /> Nova conversa</button>}</div>
      </header>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><AlertCircle className="mr-1 inline h-4 w-4" />{error}<button type="button" onClick={() => setError('')} className="ml-3 underline">Fechar</button></div>}
      {panel === 'SETTINGS' ? (
        <form onSubmit={(event) => void saveSettings(event)} className="rounded-xl border border-stone-200 bg-white p-4 sm:p-6 space-y-5">
          <div><h3 className="text-base font-bold">Política da Central de Ajuda</h3><p className="mt-1 text-xs text-zinc-600">Os prazos são configuráveis. A política de retenção fica registrada, mas não há exclusão automática do histórico.</p></div>
          {settingsLoading ? <p className="text-sm text-zinc-500">Carregando configurações…</p> : <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {field('postDeliveryDays', 'Prazo para abrir suporte após a entrega (dias)', 1, 365, 'Padrão: 30 dias contados da entrega.')}
              {field('postDeliveryAutoCloseDays', 'Inatividade em ticket pós-entrega (dias)', 1, 180, 'Após a loja marcar “Resolvido” ou “Aguardando cliente”. Padrão: 15 dias.')}
              {field('generalAutoCloseDays', 'Inatividade em conversa geral sem pedido (dias)', 1, 365, 'Conta a partir da última mensagem da loja. Padrão: 30 dias.')}
              {field('retentionMonths', 'Retenção de histórico após encerramento (meses)', 1, 120, 'Padrão: 12 meses. Apenas política registrada; não apaga mensagens.')}
              {field('maxOpenPerCustomer', 'Máximo de atendimentos ativos por cliente', 1, 50, 'Evita acúmulo de conversas simultâneas.')}
              {field('ticketsPerHour', 'Novos atendimentos por cliente por hora', 1, 100, 'Limite contra criação automatizada ou flood.')}
              {field('postDeliveryPerOrder', 'Chamados pós-entrega por pedido no período', 1, 30, 'Aplica-se ao período pós-entrega configurado.')}
            </div>
            <button type="submit" disabled={settingsSaving} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{settingsSaving ? 'Salvando…' : 'Salvar política'}</button>
          </>}
        </form>
      ) : showNew ? (
        <form onSubmit={(event) => void submitNew(event)} className="rounded-xl border border-stone-200 bg-white p-4 sm:p-6 space-y-4">
          <div><h3 className="text-base font-bold">Iniciar conversa com um cliente</h3><p className="mt-1 text-xs text-zinc-600">A mensagem será registrada com sua autoria e o cliente receberá uma notificação dentro do site.</p></div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2"><label className="block text-xs font-semibold text-zinc-800">Buscar cliente por nome ou e-mail</label><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" /><input value={customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomer(null); }} placeholder="Digite pelo menos 2 caracteres" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></div>{selectedCustomer && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><UserRound className="mr-1 inline h-4 w-4" /><strong>{selectedCustomer.name}</strong> · {selectedCustomer.email}<button type="button" onClick={() => { setSelectedCustomer(null); setCustomerQuery(''); }} className="ml-2 underline">Trocar</button></div>}{!selectedCustomer && customerOptions.length > 0 && <div className="max-h-40 overflow-y-auto rounded-lg border border-stone-200">{customerOptions.map((customer) => <button type="button" key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerQuery(`${customer.name} — ${customer.email}`); setCustomerOptions([]); }} className="block w-full border-b border-stone-100 px-3 py-2 text-left text-xs hover:bg-stone-50"><strong>{customer.name}</strong><span className="ml-2 text-zinc-500">{customer.email}</span></button>)}</div>}</div>
            <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Assunto</span><select value={newSubject} onChange={(event) => setNewSubject(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">{SUBJECTS.filter((item) => item.value !== 'ALL').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Pedido relacionado (opcional)</span><select disabled={!selectedCustomer} value={orderId} onChange={(event) => setOrderId(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm"><option value="">Nenhum pedido</option>{customerOrders.filter((order) => order.status !== 'DELIVERED').map((order) => <option key={order.id} value={order.id}>{formatOrderNumberLabel(order.orderNumber)} — {ORDER_STATUS_LABELS[order.status] || order.status}</option>)}</select></label>
            <div className="space-y-2"><label className="block text-xs font-semibold text-zinc-800">Produto relacionado (opcional)</label>{selectedProduct ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{selectedProduct.code} — {selectedProduct.name}<button type="button" onClick={() => setSelectedProduct(null)} className="ml-2 underline">Remover</button></div> : <><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" /><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Buscar produto por nome ou código" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></div>{productOptions.length > 0 && <div className="max-h-36 overflow-y-auto rounded-lg border border-stone-200">{productOptions.map((product) => <button type="button" key={product.id} onClick={() => { setSelectedProduct(product); setProductOptions([]); setProductQuery(''); }} className="block w-full border-b border-stone-100 px-3 py-2 text-left text-xs hover:bg-stone-50">{product.code} — {product.name}</button>)}</div>}</>}</div>
          </div>
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-zinc-800">Mensagem inicial da loja</span><textarea value={initialMessage} onChange={(event) => setInitialMessage(event.target.value)} maxLength={4000} rows={5} required placeholder="Escreva a primeira mensagem…" className="w-full resize-y rounded-lg border border-stone-300 px-3 py-2.5 text-sm" /><span className="block text-right text-[11px] text-zinc-500">{initialMessage.length}/4000</span></label>
          <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !selectedCustomer} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><MessageCircle className="w-4 h-4" />{busy ? 'Iniciando…' : 'Iniciar e notificar'}</button><button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700">Cancelar</button></div>
        </form>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.6fr)] items-start">
          <section className="rounded-xl border border-stone-200 bg-white overflow-hidden" aria-label="Lista de atendimentos">
            <div className="grid grid-cols-1 gap-2 border-b border-stone-200 p-3 sm:grid-cols-2">
              <div className="relative sm:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, e-mail ou nº de atendimento" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs">{STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs">{SUBJECTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs sm:col-span-2">{REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </div>
            {loading ? <p className="p-6 text-sm text-zinc-500">Carregando atendimentos…</p> : tickets.length === 0 ? <p className="p-6 text-sm text-zinc-500">Nenhum atendimento encontrado.</p> : <div className="max-h-[72vh] divide-y divide-stone-100 overflow-y-auto">{tickets.map((ticket) => <button type="button" key={ticket.id} onClick={() => selectTicket(ticket)} className={`w-full p-3.5 text-left hover:bg-stone-50 ${selected?.id === ticket.id ? 'bg-emerald-50/60' : ''}`}><div className="flex items-start justify-between gap-2"><div><span className="text-xs font-bold text-zinc-900">#{ticket.id} · {ticket.customerName}</span><p className="mt-0.5 text-[11px] text-zinc-500">{ticket.customerEmail}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONES[ticket.status] || ''}`}>{STATUSES.find((item) => item.value === ticket.status)?.label || ticket.status}</span></div><div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600"><span>{subjectLabel(ticket.subject)}</span>{ticket.supportReason && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">{reasonLabel(ticket.supportReason)}</span>}{ticket.postDelivery && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-900">Pós-entrega</span>}</div>{ticket.order && <p className="mt-1 text-[11px] text-zinc-500">Pedido {formatOrderNumberLabel(ticket.order.orderNumber)}</p>}{ticket.productNameSnapshot && <p className="mt-1 text-[11px] text-zinc-500">Produto: {ticket.productNameSnapshot}</p>}{ticket.unreadForStore && <span className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">Nova mensagem do cliente</span>}<div className="mt-1.5 text-[10px] text-zinc-500">Atividade {formatDateTime(ticket.updatedAt)}</div></button>)}</div>}
          </section>
          <section className="min-w-0 rounded-xl border border-stone-200 bg-white overflow-hidden" aria-label="Detalhe do atendimento">
            {selected ? <>
              <div className="space-y-3 border-b border-stone-200 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-bold">Atendimento #{selected.id}</h3><p className="mt-0.5 text-sm text-zinc-700">{selected.customerName} · {selected.customerEmail}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONES[selected.status] || ''}`}>{STATUSES.find((item) => item.value === selected.status)?.label || selected.status}</span></div><div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600"><span>{subjectLabel(selected.subject)}</span>{selected.supportReason && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">{reasonLabel(selected.supportReason)}</span>}{selected.postDelivery && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-900">Pós-entrega</span>}{selected.order && <span>Pedido {formatOrderNumberLabel(selected.order.orderNumber)} ({ORDER_STATUS_LABELS[selected.order.status] || selected.order.status})</span>}{selected.productNameSnapshot && selected.productLinkSnapshot && <a href={selected.productLinkSnapshot} className="font-semibold text-emerald-800 underline">Produto: {selected.productNameSnapshot}</a>}</div><div className="flex flex-wrap items-center gap-2"><label className="text-[11px] font-semibold text-zinc-600">Alterar status</label><select value={selected.status} disabled={busy || (selected.status === 'CLOSED' && selectedHasDeliveryLock)} onChange={(event) => void changeStatus(event.target.value)} className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs">{STATUSES.filter((item) => !selectedHasDeliveryLock || item.value === 'CLOSED').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{selected.closedReason === 'ORDER_DELIVERED' && <span className="text-[11px] text-amber-800">Fechado definitivamente pela entrega do pedido.</span>}</div><div className="text-[10px] text-zinc-500">Criado {formatDateTime(selected.createdAt)} · Atualizado {formatDateTime(selected.updatedAt)}{selected.closedAt ? ` · Encerrado ${formatDateTime(selected.closedAt)}` : ''}</div></div>
              <div className="max-h-[55vh] space-y-3 overflow-y-auto p-4 sm:p-5" aria-live="polite">{loadingDetail && <p className="text-xs text-zinc-500">Atualizando…</p>}{selected.messages?.map((message) => <article key={message.id} className={`max-w-[92%] rounded-xl border p-3 ${message.authorRole === 'ADMIN' ? 'ml-auto border-emerald-200 bg-emerald-50' : 'mr-auto border-blue-200 bg-blue-50'}`}><div className="flex flex-wrap justify-between gap-2 text-[11px] font-bold text-zinc-700"><span>{message.authorRole === 'ADMIN' ? 'Loja' : selected.customerName}</span><time className="font-normal text-zinc-500">{formatDateTime(message.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-900">{message.body}</p></article>)}</div>
              {selected.status !== 'CLOSED' ? <form onSubmit={(event) => void sendReply(event)} className="space-y-2 border-t border-stone-200 p-4"><label htmlFor="admin-support-reply" className="block text-xs font-semibold text-zinc-800">Responder</label><textarea id="admin-support-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000} rows={3} placeholder="Escreva uma mensagem…" className="w-full resize-y rounded-lg border border-stone-300 px-3 py-2.5 text-sm" /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-zinc-500">{reply.length}/4000</span><button type="submit" disabled={busy || !reply.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"><Send className="w-4 h-4" />{busy ? 'Enviando…' : 'Enviar resposta'}</button></div></form> : <p className="border-t border-stone-200 bg-stone-50 p-4 text-xs text-zinc-600">Conversa encerrada; histórico somente leitura. Se não foi fechada pela entrega do pedido, o admin pode reabrir pelo seletor de status.</p>}
            </> : <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center"><MessageCircle className="h-8 w-8 text-zinc-300" /><h3 className="mt-3 text-sm font-bold">Selecione um atendimento</h3><p className="mt-1 max-w-sm text-xs text-zinc-500">As mensagens mais recentes aparecem primeiro na lista; conversas não lidas ficam destacadas.</p>{lastMessageId && <span className="sr-only">Última mensagem {lastMessageId}</span>}</div>}
          </section>
        </div>
      )}
    </div>
  );
};
