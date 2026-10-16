import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Plus, Search, Truck } from 'lucide-react';

interface Props {
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>;
  toast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

type Supplier = { id: number; name: string; contact?: string | null; website?: string | null; notes?: string | null; status: string };
type Purchase = { id: number; supplierId: number; productId?: number | null; itemName: string; unitCost: string; quantity: number; totalCost: string; purchasedAt: string; createdAt: string; productUrl?: string | null; notes?: string | null };

const blankSupplier = { name: '', contact: '', website: '', notes: '' };
const blankPurchase = { itemName: '', unitCost: '', quantity: '1', purchasedAt: new Date().toISOString().slice(0, 10), productUrl: '', notes: '' };
const money = (value: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const date = (value: unknown) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(String(value))) : '—';

export const AdminSuppliersSection: React.FC<Props> = ({ apiFetch, toast }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [totals, setTotals] = useState({ quantity: 0, totalCost: '0.00' });
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplierForm, setSupplierForm] = useState(blankSupplier);
  const [purchaseForm, setPurchaseForm] = useState(blankPurchase);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);

  const loadSuppliers = async () => {
    const data = await apiFetch<{ suppliers: Supplier[] }>('/api/admin/suppliers');
    setSuppliers(Array.isArray(data.suppliers) ? data.suppliers : []);
  };
  const loadPurchases = async (supplier: Supplier, filters = { search, from, to }) => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    const data = await apiFetch<{ purchases: Purchase[]; totals: { quantity: number; totalCost: string } }>(`/api/admin/suppliers/${supplier.id}/purchases?${params}`);
    setPurchases(Array.isArray(data.purchases) ? data.purchases : []);
    setTotals(data.totals || { quantity: 0, totalCost: '0.00' });
  };
  useEffect(() => { void loadSuppliers().catch((err) => toast(err.message, 'error')); }, []);
  useEffect(() => { if (selected) void loadPurchases(selected).catch((err) => toast(err.message, 'error')); }, [selected, search, from, to]);

  const filteredSuppliers = useMemo(() => suppliers.filter((s) => `${s.name} ${s.contact || ''}`.toLowerCase().includes(search.toLowerCase())), [suppliers, search]);
  const openNewSupplier = () => { setSupplierForm(blankSupplier); setShowSupplierForm(true); };
  const openSupplier = (supplier: Supplier) => { setSelected(supplier); setSupplierForm({ name: supplier.name, contact: supplier.contact || '', website: supplier.website || '', notes: supplier.notes || '' }); setShowSupplierForm(false); };
  const saveSupplier = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const data = selected ? await apiFetch<{ supplier: Supplier }>(`/api/admin/suppliers/${selected.id}`, { method: 'PATCH', body: JSON.stringify(supplierForm) }) : await apiFetch<{ supplier: Supplier }>('/api/admin/suppliers', { method: 'POST', body: JSON.stringify(supplierForm) });
      await loadSuppliers();
      const supplier = data.supplier;
      setSelected(supplier);
      setShowSupplierForm(false);
      toast('Fornecedor salvo.', 'success');
    } catch (err: any) { toast(err.message, 'error'); }
  };
  const savePurchase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    try {
      const payload = { ...purchaseForm, supplierId: selected.id, quantity: Number(purchaseForm.quantity), unitCost: purchaseForm.unitCost };
      await apiFetch(editingPurchase ? `/api/admin/supplier-purchases/${editingPurchase.id}` : '/api/admin/supplier-purchases', { method: editingPurchase ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setPurchaseForm(blankPurchase); setEditingPurchase(null); setShowPurchaseForm(false);
      await loadPurchases(selected); toast('Compra salva.', 'success');
    } catch (err: any) { toast(err.message, 'error'); }
  };
  const removePurchase = async (purchase: Purchase) => {
    if (!window.confirm(`Excluir a compra “${purchase.itemName}”?`)) return;
    try { await apiFetch(`/api/admin/supplier-purchases/${purchase.id}`, { method: 'DELETE' }); await loadPurchases(selected!); toast('Compra excluída.', 'success'); } catch (err: any) { toast(err.message, 'error'); }
  };

  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-zinc-900">Fornecedores</h1><p className="text-xs text-zinc-500">Fornecedores, compras e histórico de custos.</p></div><button type="button" onClick={openNewSupplier} className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4" />Novo fornecedor</button></div>
    {!selected && <><div className="rounded-xl border border-stone-200 bg-white p-3"><label className="relative block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input aria-label="Buscar fornecedor" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar fornecedor ou contacto" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></label></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredSuppliers.map((supplier) => <button key={supplier.id} type="button" onClick={() => openSupplier(supplier)} className="rounded-xl border border-stone-200 bg-white p-4 text-left hover:border-zinc-400"><div className="flex items-center gap-2"><Truck className="h-5 w-5 text-zinc-500" /><strong>{supplier.name}</strong></div><div className="mt-2 text-xs text-zinc-500">{supplier.contact || 'Sem contacto'} · {supplier.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</div>{supplier.website && <span className="mt-2 block truncate text-xs text-blue-700">{supplier.website}</span>}</button>)}{filteredSuppliers.length === 0 && <div className="rounded-xl border border-dashed border-stone-300 p-8 text-sm text-zinc-500">Nenhum fornecedor cadastrado.</div>}</div></>}
    {selected && <><button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700"><ArrowLeft className="h-4 w-4" />Voltar aos fornecedores</button><div className="rounded-xl border border-stone-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{selected.name}</h2><p className="text-xs text-zinc-500">{selected.contact || 'Sem contacto'} · {selected.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</p>{selected.website && <a href={selected.website} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700">Abrir link <ExternalLink className="h-3 w-3" /></a>}</div><button type="button" onClick={() => setShowSupplierForm(true)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold">Editar fornecedor</button></div>{showSupplierForm && <form onSubmit={saveSupplier} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 md:grid-cols-2"><input required placeholder="Nome" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Contacto" value={supplierForm.contact} onChange={(e) => setSupplierForm({ ...supplierForm, contact: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Link http(s)" value={supplierForm.website} onChange={(e) => setSupplierForm({ ...supplierForm, website: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Observações" value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} className="rounded-lg border p-2 text-sm" /><button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white md:col-span-2">Salvar fornecedor</button></form>}</div>
    <div className="rounded-xl border border-stone-200 bg-white p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Compras</h3><button type="button" onClick={() => { setPurchaseForm(blankPurchase); setEditingPurchase(null); setShowPurchaseForm(true); }} className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3 w-3" />Nova compra</button></div><div className="mb-4 grid gap-2 md:grid-cols-3"><input aria-label="Buscar compra" placeholder="Buscar item" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border p-2 text-sm" /><input type="date" aria-label="Data inicial" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border p-2 text-sm" /><input type="date" aria-label="Data final" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border p-2 text-sm" /></div>{showPurchaseForm && <form onSubmit={savePurchase} className="mb-4 grid gap-2 border-b border-stone-100 pb-4 md:grid-cols-3"><input required placeholder="Item" value={purchaseForm.itemName} onChange={(e) => setPurchaseForm({ ...purchaseForm, itemName: e.target.value })} className="rounded-lg border p-2 text-sm" /><input required type="number" step="0.000001" min="0" placeholder="Custo unitário" value={purchaseForm.unitCost} onChange={(e) => setPurchaseForm({ ...purchaseForm, unitCost: e.target.value })} className="rounded-lg border p-2 text-sm" /><input required type="number" min="1" step="1" placeholder="Quantidade" value={purchaseForm.quantity} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: e.target.value })} className="rounded-lg border p-2 text-sm" /><input required type="date" value={purchaseForm.purchasedAt} onChange={(e) => setPurchaseForm({ ...purchaseForm, purchasedAt: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Link do item" value={purchaseForm.productUrl} onChange={(e) => setPurchaseForm({ ...purchaseForm, productUrl: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Observações" value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} className="rounded-lg border p-2 text-sm" /><button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white md:col-span-3">Salvar compra</button></form>}<div className="mb-3 flex gap-4 text-xs text-zinc-600"><span>{totals.quantity} unidade(s)</span><strong>{money(totals.totalCost)}</strong></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-zinc-500"><th className="p-2">Item</th><th className="p-2">Custo</th><th className="p-2">Quantidade</th><th className="p-2">Compra</th><th className="p-2">Cadastro</th><th className="p-2">Ações</th></tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id} className="border-b last:border-0"><td className="p-2 font-semibold">{purchase.itemName}{purchase.productUrl && <a href={purchase.productUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-700">link</a>}</td><td className="p-2">{money(purchase.unitCost)}</td><td className="p-2">{purchase.quantity}</td><td className="p-2">{date(purchase.purchasedAt)}</td><td className="p-2">{date(purchase.createdAt)}</td><td className="p-2"><button type="button" className="mr-2 text-blue-700" onClick={() => { setEditingPurchase(purchase); setPurchaseForm({ itemName: purchase.itemName, unitCost: purchase.unitCost, quantity: String(purchase.quantity), purchasedAt: String(purchase.purchasedAt).slice(0, 10), productUrl: purchase.productUrl || '', notes: purchase.notes || '' }); setShowPurchaseForm(true); }}>Editar</button><button type="button" className="text-red-700" onClick={() => void removePurchase(purchase)}>Excluir</button></td></tr>)}</tbody></table></div></div></>}
    {!selected && showSupplierForm && <form onSubmit={saveSupplier} className="rounded-xl border border-stone-200 bg-white p-5 grid gap-3 md:grid-cols-2"><h2 className="font-bold md:col-span-2">Novo fornecedor</h2><input required placeholder="Nome" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Contacto" value={supplierForm.contact} onChange={(e) => setSupplierForm({ ...supplierForm, contact: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Link http(s)" value={supplierForm.website} onChange={(e) => setSupplierForm({ ...supplierForm, website: e.target.value })} className="rounded-lg border p-2 text-sm" /><input placeholder="Observações" value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} className="rounded-lg border p-2 text-sm" /><button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white md:col-span-2">Salvar fornecedor</button></form>}
  </section>;
};
