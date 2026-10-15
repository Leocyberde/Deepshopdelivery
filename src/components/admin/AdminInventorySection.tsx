import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, History, Loader2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';

const PAGE_SIZE = 25;
const movementLabel: Record<string, string> = {
  OPENING_BALANCE: 'Saldo inicial migrado', INITIAL_STOCK: 'Saldo inicial', MANUAL_ENTRY: 'Entrada manual',
  MANUAL_EXIT: 'Saída manual', MANUAL_CORRECTION: 'Correção manual', ORDER_RESERVATION: 'Reserva de pedido',
  ORDER_STATUS_RESERVATION: 'Reserva por alteração do pedido', ORDER_CANCELLATION_RETURN: 'Devolução por cancelamento',
  ORDER_EXPIRATION_RETURN: 'Devolução por expiração', ORDER_STATUS_RETURN: 'Devolução por alteração do pedido',
  KIT_ASSEMBLY_COMPONENT_OUT: 'Componente usado na montagem', KIT_DISASSEMBLY_COMPONENT_IN: 'Componente devolvido',
  KIT_RECONFIGURE_COMPONENT_IN: 'Componente devolvido ao reconfigurar', KIT_RECONFIGURE_COMPONENT_OUT: 'Componente reservado ao reconfigurar',
};

export const AdminInventorySection: React.FC = () => {
  const { apiFetch, toast } = useApp();
  const [search, setSearch] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [movementPage, setMovementPage] = useState(1);
  const [direction, setDirection] = useState<'IN' | 'OUT' | 'SET'>('IN');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [purchaseCostMode, setPurchaseCostMode] = useState<'same' | 'unit' | 'lot'>('same');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [purchaseLotUnits, setPurchaseLotUnits] = useState('1');
  const [saving, setSaving] = useState(false);
  const listRequestSequence = useRef(0);
  const historyRequestSequence = useRef(0);
  const savingRef = useRef(false);
  const movementKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async () => {
    const sequence = ++listRequestSequence.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search, lowStock: String(lowOnly) });
      const result = await apiFetch(`/api/admin/inventory/products?${params}`);
      if (sequence !== listRequestSequence.current) return;
      setProducts(Array.isArray(result?.products) ? result.products : []);
      setTotalCount(Number(result?.totalCount || 0)); setTotalPages(Number(result?.totalPages || 0)); setLowStockCount(Number(result?.lowStockCount || 0));
    } catch (e: any) { if (sequence === listRequestSequence.current) setError(e?.message || 'Não foi possível carregar o estoque.'); }
    finally { if (sequence === listRequestSequence.current) setLoading(false); }
  }, [apiFetch, page, search, lowOnly]);

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchValue.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [searchValue]);
  useEffect(() => { void load(); }, [load]);

  const loadHistory = useCallback(async (product: any, requestedPage = 1) => {
    const sequence = ++historyRequestSequence.current;
    setSelected(product); setMovementPage(requestedPage); setHistoryLoading(true);
    try {
      const data = await apiFetch(`/api/admin/inventory/products/${product.id}/movements?page=${requestedPage}&pageSize=20`);
      if (sequence !== historyRequestSequence.current) return;
      setSelected(data?.product || product); setHistory(Array.isArray(data?.movements) ? data.movements : []);
    } catch (e: any) { if (sequence === historyRequestSequence.current) { toast(e?.message || 'Não foi possível carregar o histórico.', 'error'); setHistory([]); } }
    finally { if (sequence === historyRequestSequence.current) setHistoryLoading(false); }
  }, [apiFetch, toast]);

  const submitMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (savingRef.current) return;
    const n = Number(quantity);
    if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000 || !reason.trim() || reason.trim().length > 500) {
      toast('Informe uma quantidade inteira válida e um motivo com até 500 caracteres.', 'error'); return;
    }
    savingRef.current = true; setSaving(true);
    try {
      const fingerprint = JSON.stringify({ productId: selected.id, direction, quantity: n, reason: reason.trim(), purchaseCostMode, purchaseCost, purchaseLotUnits });
      if (movementKey.current?.fingerprint !== fingerprint) movementKey.current = { fingerprint, key: crypto.randomUUID() };
      await apiFetch('/api/admin/inventory/movements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selected.id, direction, quantity: n, reason: reason.trim(), purchaseCostMode: direction === 'IN' ? purchaseCostMode : 'same', purchaseCost: direction === 'IN' && purchaseCostMode !== 'same' ? purchaseCost : null, purchaseLotUnits: direction === 'IN' && purchaseCostMode === 'lot' ? n : n, idempotencyKey: movementKey.current.key }),
      });
      toast('Movimentação registrada com sucesso.', 'success'); setReason(''); setQuantity('1'); setPurchaseCostMode('same'); setPurchaseCost(''); setPurchaseLotUnits('1');
      await Promise.all([load(), loadHistory(selected, 1)]);
    } catch (e: any) { toast(e?.message || 'Não foi possível registrar a movimentação.', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return <div className="space-y-5 min-w-0">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold text-zinc-900">Estoque & Movimentações</h1><p className="text-sm text-zinc-500">Ajustes sempre ficam vinculados a um motivo, administrador e saldo anterior/posterior.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button>
    </header>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-stone-200 bg-white p-4"><div className="text-xs text-zinc-500">Produtos controlados</div><div className="mt-1 text-2xl font-bold">{totalCount}</div></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-xs text-amber-900"><AlertTriangle className="h-4 w-4" />Abaixo do mínimo</div><div className="mt-1 text-2xl font-bold">{lowStockCount}</div><div className="text-xs text-amber-900">saldo igual ou inferior ao mínimo cadastrado</div></div>
      <div className="rounded-xl border border-stone-200 bg-white p-4"><div className="text-xs text-zinc-500">Regra</div><div className="mt-1 text-sm font-semibold">Kits são montados e desmontados; não recebem ajuste manual.</div></div>
    </div>
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 sm:flex-row sm:items-center">
      <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={searchValue} onChange={(e) => setSearchValue(e.target.value)} placeholder="Buscar por nome ou código" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></label>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} /><SlidersHorizontal className="h-4 w-4" />Somente no mínimo ou abaixo</label>
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" onClick={() => void load()} className="ml-3 underline">Tentar novamente</button></div>}
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(70px,0.7fr)_minmax(90px,0.8fr)_auto] gap-3 border-b bg-stone-50 px-4 py-3 text-xs font-bold text-zinc-600 md:grid"><span>Produto</span><span>Saldo</span><span>Mínimo</span><span>Ações</span></div>
      {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando saldos…</div> : products.length === 0 ? <div className="p-10 text-center text-sm text-zinc-500">Nenhum produto encontrado para este filtro.</div> : products.map((product) => {
        const low = product.stock <= product.stockMinimum;
        return <article key={product.id} className="grid grid-cols-1 gap-2 border-b border-stone-100 p-4 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(70px,0.7fr)_minmax(90px,0.8fr)_auto] md:items-center md:gap-3">
          <div className="min-w-0"><div className="truncate text-sm font-semibold text-zinc-900">{product.code} — {product.name}</div><div className="text-xs text-zinc-500">{product.status === 'ARCHIVED' ? 'Arquivado' : product.status === 'INACTIVE' ? 'Inativo' : 'Ativo'}</div></div>
          <div className={`text-sm font-bold tabular-nums ${low ? 'text-amber-800' : 'text-zinc-900'}`}>{product.stock} un. {low && <span className="text-xs">(baixo)</span>}</div>
          <div className="text-sm text-zinc-700">{product.stockMinimum} un.{product.isKit && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-800">Kit</span>}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setDirection('IN'); setQuantity('1'); void loadHistory(product, 1); }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"><ArrowDownToLine className="h-4 w-4" />Movimentar</button>
            <button type="button" onClick={() => void loadHistory(product, 1)} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-50"><History className="h-4 w-4" />Histórico</button>
          </div>
        </article>;
      })}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-zinc-500">{totalCount} produto(s) · página {page} de {Math.max(totalPages, 1)}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Próxima</button></div></div>

    {selected && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="inventory-title" className="mx-auto my-4 w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="inventory-title" className="truncate text-lg font-bold">{selected.code} — {selected.name}</h2><p className="text-sm text-zinc-500">Saldo atual: <strong>{selected.stock}</strong> · mínimo: {selected.stockMinimum}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg border px-3 py-1.5 text-sm">Fechar</button></div>
        {selected.isKit ? <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Ajuste manual bloqueado para kits. Use montagem/desmontagem para alterar o saldo; o histórico abaixo registra os componentes e a operação.</div> : <form onSubmit={submitMovement} className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-4">
          <label className="text-xs font-semibold">Operação<select value={direction} onChange={(e) => setDirection(e.target.value as any)} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm"><option value="IN">Entrada</option><option value="OUT">Saída</option><option value="SET">Corrigir saldo para (sem compra)</option></select></label>
          <label className="text-xs font-semibold">{direction === 'SET' ? 'Novo saldo' : 'Quantidade'}<input type="number" min="0" max="1000000" step="1" value={quantity} onChange={(e) => { setQuantity(e.target.value); if (purchaseCostMode === 'lot') setPurchaseLotUnits(e.target.value); }} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm" required /></label>
          <label className="text-xs font-semibold sm:col-span-2">Motivo obrigatório<input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: recebimento de fornecedor, avaria, inventário…" className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm" required /></label>
          {direction === 'IN' && <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 sm:col-span-4"><p className="text-xs font-bold text-sky-950">Essas {quantity || 0} unidades novas foram compradas por quanto? (opcional)</p><div className="mt-2 flex flex-wrap gap-3 text-xs"><label className="inline-flex items-center gap-1.5"><input type="radio" checked={purchaseCostMode === 'same'} onChange={() => setPurchaseCostMode('same')} />Mesmo custo atual por unidade</label><label className="inline-flex items-center gap-1.5"><input type="radio" checked={purchaseCostMode === 'unit'} onChange={() => setPurchaseCostMode('unit')} />Outro custo por unidade</label><label className="inline-flex items-center gap-1.5"><input type="radio" checked={purchaseCostMode === 'lot'} onChange={() => { setPurchaseCostMode('lot'); setPurchaseLotUnits(quantity); }} />Total desta compra</label></div>{purchaseCostMode !== 'same' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">{purchaseCostMode === 'lot' ? 'Total pago no lote (R$)' : 'Custo por unidade (R$)'}<input type="number" min="0" step="0.01" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm" required /></label>{purchaseCostMode === 'lot' && <div className="self-end text-xs text-sky-900">Unidades recebidas neste movimento: <strong>{quantity}</strong></div>}<p className="self-end text-[11px] text-sky-900">O custo médio ponderado será recalculado na mesma transação do movimento.</p></div>}</div>}
          <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-4">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : direction === 'OUT' ? <ArrowUpFromLine className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}Registrar movimentação</button>
        </form>}
        <div className="mt-5"><h3 className="mb-2 text-sm font-bold">Histórico de movimentações</h3>{historyLoading ? <div className="p-6 text-center text-sm text-zinc-500">Carregando…</div> : history.length === 0 ? <div className="rounded-lg bg-stone-50 p-4 text-sm text-zinc-500">Ainda não há movimentos neste produto.</div> : <div className="space-y-2">{history.map((item) => <article key={item.id} className="rounded-lg border border-stone-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{movementLabel[item.movementType] || item.movementType}</strong><span className={`text-sm font-bold tabular-nums ${item.delta > 0 ? 'text-emerald-700' : item.delta < 0 ? 'text-red-700' : 'text-zinc-500'}`}>{item.delta > 0 ? '+' : ''}{item.delta}</span></div><p className="mt-1 break-words text-sm text-zinc-700">{item.reason}</p><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500"><span>{item.beforeStock} → {item.afterStock}</span><span>{item.actorName}</span>{item.orderNumber && <span>Pedido #{item.orderNumber}</span>}<span>{new Date(item.createdAt).toLocaleString('pt-BR')}</span></div></article>)}</div>}
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={movementPage <= 1 || historyLoading} onClick={() => void loadHistory(selected, movementPage - 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Mais recentes</button><button type="button" disabled={history.length < 20 || historyLoading} onClick={() => void loadHistory(selected, movementPage + 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Mais antigos</button></div>
      </section>
    </div>}
  </div>;
};
