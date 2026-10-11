import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Edit2, Loader2, Plus, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';

interface AdminCategoriesSectionProps {
  categories: any[];
  showCatForm: boolean;
  setShowCatForm: (val: boolean) => void;
  editingCat: any | null;
  catName: string;
  setCatName: (val: string) => void;
  catDesc: string;
  setCatDesc: (val: string) => void;
  catStatus: 'ACTIVE' | 'INACTIVE';
  setCatStatus: (val: 'ACTIVE' | 'INACTIVE') => void;
  openNewCategory: () => void;
  openEditCategory: (cat: any) => void;
  handleSaveCategory: (e: React.FormEvent) => void;
  onOpenProducts: (categoryId: number) => void;
}

export const AdminCategoriesSection: React.FC<AdminCategoriesSectionProps> = (props) => {
  const { apiFetch } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>(props.categories || []);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', search: query.trim(), status, sort });
      const data = await apiFetch(`/api/admin/categories?${params}`);
      if (sequence !== requestSequence.current) return;
      setRows(Array.isArray(data?.categories) ? data.categories : []);
      setTotalCount(Number(data?.totalCount || 0)); setTotalPages(Math.max(1, Number(data?.totalPages || 1)));
    } catch (e: any) { if (sequence === requestSequence.current) setError(e?.message || 'Não foi possível carregar categorias.'); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [apiFetch, page, query, status, sort]);
  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-5 min-w-0">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold text-zinc-900">Categorias da Vitrine</h1><p className="text-sm text-zinc-500">Categorias com produtos associados não são excluídas; podem ser inativadas sem perder o histórico.</p></div><button type="button" onClick={props.openNewCategory} className="inline-flex items-center gap-2 self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Nova categoria</button></header>
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 sm:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Buscar categoria" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></label><select aria-label="Filtrar categorias por status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="ALL">Todas</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option></select><select aria-label="Ordenar categorias" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="newest">Mais recentes</option><option value="name_asc">Nome A–Z</option><option value="name_desc">Nome Z–A</option></select></div>
    {props.showCatForm && <form onSubmit={props.handleSaveCategory} className="space-y-4 rounded-xl border border-stone-200 bg-white p-5"><div className="flex items-center justify-between border-b border-stone-100 pb-3"><h2 className="font-bold">{props.editingCat ? `Editar: ${props.editingCat.name}` : 'Nova categoria'}</h2><button type="button" onClick={() => props.setShowCatForm(false)} className="text-sm text-zinc-500">Cancelar</button></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="text-xs font-semibold sm:col-span-1">Nome<input maxLength={100} required value={props.catName} onChange={(e) => props.setCatName(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold sm:col-span-1">Descrição<input maxLength={1000} value={props.catDesc} onChange={(e) => props.setCatDesc(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold">Status<select value={props.catStatus} onChange={(e) => props.setCatStatus(e.target.value as any)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option></select></label></div><div className="flex justify-end"><button className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Salvar categoria</button></div></form>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button onClick={() => void load()} className="ml-2 underline">Tentar novamente</button></div>}
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">{loading ? <div className="flex justify-center gap-2 p-8 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div> : rows.length === 0 ? <div className="p-8 text-center text-sm text-zinc-500">Nenhuma categoria encontrada.</div> : rows.map((cat) => <article key={cat.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{cat.name}</strong><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${cat.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-stone-100 text-zinc-600'}`}>{cat.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</span><span className="text-xs text-zinc-500">{cat.productCount || 0} produto(s)</span></div>{cat.description && <p className="mt-1 break-words text-xs text-zinc-500">{cat.description}</p>}</div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => props.onOpenProducts(cat.id)} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-50">Ver produtos<ArrowRight className="h-3.5 w-3.5" /></button><button type="button" onClick={() => props.openEditCategory(cat)} className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-3 py-2 text-xs font-semibold hover:bg-stone-200"><Edit2 className="h-3.5 w-3.5" />Editar</button></div></article>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-zinc-500">{totalCount} categoria(s) · página {page} de {totalPages}</span><div className="flex gap-2"><button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button><button disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Próxima</button></div></div>
  </div>;
};
