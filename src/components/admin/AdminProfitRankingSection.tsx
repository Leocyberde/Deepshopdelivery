import { simulateProfit } from '../../utils/profitSimulation.ts';
import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  DollarSign,
  Package,
  Award,
  Search,
  BarChart3,
  Percent,
  Eye,
  MousePointerClick,
  Share2,
  Sparkles,
} from 'lucide-react';
import { useApp, formatCurrency, ProductImage } from '../../context/AppContext.tsx';

interface AnalyzedProduct {
  id: number;
  code: string;
  name: string;
  categoryName: string;
  imageUrl: string | null;
  status: string;
  stock: number;
  isKit: boolean;
  cost: number;
  price: number;
  promoPrice: number | null;
  promoMaxUnits?: number | null;
  hasPromo: boolean;
  effectivePrice: number;
  hasCostDefined?: boolean;
  marginStatus?: 'NO_COST' | 'ZERO_PROFIT' | 'PROFITABLE' | 'LOSS';
  markupPercent?: number;
  unitProfit: number;
  unitMarginPercent: number;
  potentialStockProfit: number;
  normalStockProfit?: number | null;
  promoStockProfit?: number | null;
  viewsCount: number;
  clicksCount: number;
  sharesCount: number;
  conversionRatePercent: number | null;
  hasEnoughConversionData?: boolean;
  unitsSold: number;
  revenue: number;
  realizedProfit: number;
  ordersCount: number;
}

interface AnalyticsData {
  summary: {
    totalProducts: number;
    totalProductsWithCost?: number;
    totalStockUnits: number;
    totalStockCost: number;
    totalStockSaleValue: number;
    potentialInventoryProfit: number;
    potentialInventoryPromoProfit?: number;
    totalStockPromoSaleValue?: number;
    averageMarginPercent?: number;
    totalRealizedProfitAll: number;
    totalDeliveredUnitsAll: number;
    totalViewsAll: number;
    totalClicksAll: number;
    totalSharesAll: number;
  };
  products: AnalyzedProduct[];
  rankingBestSellers: AnalyzedProduct[];
  rankingMostProfitable: AnalyzedProduct[];
  rankingHighestMargin: AnalyzedProduct[];
  rankingMostViewed: AnalyzedProduct[];
  rankingMostClicked: AnalyzedProduct[];
  rankingMostShared: AnalyzedProduct[];
}

export const AdminProfitRankingSection: React.FC = () => {
  const { apiFetch, toast } = useApp();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal para ajuste rápido de custo e preço
  const [editingCostProd, setEditingCostProd] = useState<AnalyzedProduct | null>(null);
  const [modalCost, setModalCost] = useState('');
  const [modalPrice, setModalPrice] = useState('');
  const [savingCost, setSavingCost] = useState(false);

  const [rankingCategory, setRankingCategory] = useState<
    'SALES_PROFIT' | 'INTERACTIONS'
  >('SALES_PROFIT');

  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('all');

  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<
    | 'realizedProfit'
    | 'unitsSold'
    | 'unitProfit'
    | 'unitMarginPercent'
    | 'viewsCount'
    | 'clicksCount'
    | 'sharesCount'
    | 'conversionRatePercent'
    | 'potentialStockProfit'
    | 'stock'
  >('realizedProfit');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const loadAnalytics = async (selectedPeriod = period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<AnalyticsData>(
        `/api/admin/analytics/products?period=${selectedPeriod}`
      );
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar análise de lucros.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics(period);
  }, [period]);

  const openQuickCostModal = (prod: AnalyzedProduct) => {
    setEditingCostProd(prod);
    setModalCost(prod.cost > 0 ? String(prod.cost) : '');
    setModalPrice(String(prod.price));
  };

  const handleSaveCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCostProd) return;
    setSavingCost(true);
    try {
      await apiFetch(`/api/admin/products/${editingCostProd.id}/cost`, {
        method: 'PATCH',
        body: JSON.stringify({
          cost: modalCost,
          price: modalPrice,
        }),
      });
      toast('Custo e margem de lucro atualizados com sucesso!', 'success');
      setEditingCostProd(null);
      await loadAnalytics();
    } catch (err: any) {
      toast(err.message || 'Erro ao salvar custo do produto.', 'error');
    } finally {
      setSavingCost(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-sm text-zinc-500">
        Carregando análise de lucros, visualizações e rankings dos produtos...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-red-900">{error || 'Não foi possível carregar os dados.'}</p>
        <button
          type="button"
          onClick={() => loadAnalytics()}
          className="px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  const {
    summary,
    products,
    rankingBestSellers,
    rankingMostProfitable,
    rankingHighestMargin,
    rankingMostViewed,
    rankingMostClicked,
    rankingMostShared,
  } = data;

  // Filtragem e ordenação dos produtos
  const filteredProducts = products.filter((p) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      p.categoryName.toLowerCase().includes(q)
    );
  });

  filteredProducts.sort((a, b) => {
    const valA = a[sortBy] ?? 0;
    const valB = b[sortBy] ?? 0;
    if (sortOrder === 'desc') {
      return (valB as number) - (valA as number);
    }
    return (valA as number) - (valB as number);
  });

  const bestSeller = rankingBestSellers[0];
  const mostProfitable = rankingMostProfitable[0];
  const mostViewed = rankingMostViewed[0];
  const mostShared = rankingMostShared[0];

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            Análise de Lucro, Visualizações & Ranking dos Produtos
          </h1>
          <p className="text-xs text-zinc-500">
            Métricas exclusivas para o administrador: veja quais produtos mais saem, quais dão mais lucro, quantas visualizações, cliques e compartilhamentos cada item teve na loja.
          </p>
        </div>

        {/* Seletor de Período Canônico */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 border border-stone-200 rounded-xl self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setPeriod('7d')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              period === '7d'
                ? 'bg-white text-[#087BFF] shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Últimos 7 dias
          </button>
          <button
            type="button"
            onClick={() => setPeriod('30d')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              period === '30d'
                ? 'bg-white text-[#087BFF] shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Últimos 30 dias
          </button>
          <button
            type="button"
            onClick={() => setPeriod('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              period === 'all'
                ? 'bg-[#087BFF] text-white shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Todo o período
          </button>
        </div>
      </div>

      {/* 4 Cards de Destaque / Troféus com Métricas Operacionais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Campeão de Vendas */}
        <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-xl p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between text-xs text-amber-900 font-bold">
            <span className="flex items-center gap-1.5">
              <Award className="w-4 h-4 text-amber-600" />
              O Que Mais Sai (Vendas)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
              Top 1
            </span>
          </div>
          {bestSeller ? (
            <div className="flex items-center gap-3 pt-1">
              <div className="w-12 h-12 rounded-lg bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                <ProductImage src={bestSeller.imageUrl} alt={bestSeller.name} className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-mono font-bold text-amber-900">{bestSeller.code}</div>
                <div className="text-sm font-bold text-zinc-900 truncate">{bestSeller.name}</div>
                <div className="text-xs font-extrabold text-amber-800 tabular-nums">
                  {bestSeller.unitsSold} un. vendidas
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Nenhum pedido entregue ainda.</p>
          )}
        </div>

        {/* Campeão de Lucro Real */}
        <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 rounded-xl p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between text-xs text-emerald-900 font-bold">
            <span className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-700" />
              O Que Mais Dá Lucro
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-extrabold">
              Maior Ganho
            </span>
          </div>
          {mostProfitable ? (
            <div className="flex items-center gap-3 pt-1">
              <div className="w-12 h-12 rounded-lg bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                <ProductImage src={mostProfitable.imageUrl} alt={mostProfitable.name} className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-mono font-bold text-emerald-900">{mostProfitable.code}</div>
                <div className="text-sm font-bold text-zinc-900 truncate">{mostProfitable.name}</div>
                <div className="text-xs font-extrabold text-emerald-700 tabular-nums">
                  + {formatCurrency(mostProfitable.realizedProfit)} lucro real
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Nenhum pedido entregue ainda.</p>
          )}
        </div>

        {/* Campeão de Visualizações */}
        <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-200 rounded-xl p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between text-xs text-blue-900 font-bold">
            <span className="flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-blue-600" />
              Mais Visualizado
            </span>
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-extrabold">
              Mais Visto
            </span>
          </div>
          {mostViewed ? (
            <div className="flex items-center gap-3 pt-1">
              <div className="w-12 h-12 rounded-lg bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                <ProductImage src={mostViewed.imageUrl} alt={mostViewed.name} className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-mono font-bold text-blue-900">{mostViewed.code}</div>
                <div className="text-sm font-bold text-zinc-900 truncate">{mostViewed.name}</div>
                <div className="text-xs font-extrabold text-blue-700 tabular-nums">
                  👁️ {mostViewed.viewsCount} visualizações
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Nenhum produto cadastrado.</p>
          )}
        </div>

        {/* Campeão de Compartilhamentos */}
        <div className="bg-gradient-to-br from-sky-50 to-white border border-sky-200 rounded-xl p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between text-xs text-sky-900 font-bold">
            <span className="flex items-center gap-1.5">
              <Share2 className="w-4 h-4 text-[#087BFF]" />
              Mais Compartilhado
            </span>
            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 text-[10px] font-extrabold">
              Mais Viral
            </span>
          </div>
          {mostShared ? (
            <div className="flex items-center gap-3 pt-1">
              <div className="w-12 h-12 rounded-lg bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                <ProductImage src={mostShared.imageUrl} alt={mostShared.name} className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-mono font-bold text-sky-900">{mostShared.code}</div>
                <div className="text-sm font-bold text-zinc-900 truncate">{mostShared.name}</div>
                <div className="text-xs font-extrabold text-[#087BFF] tabular-nums">
                  📢 {mostShared.sharesCount} compartilhamentos
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Nenhum produto compartilhado ainda.</p>
          )}
        </div>
      </div>

      {/* Guia Didático de Margem de Lucro & Balanço do Estoque */}
      <div className="bg-gradient-to-r from-sky-50 via-white to-emerald-50 border border-sky-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-[#087BFF] text-white">
                <BarChart3 className="w-4 h-4" />
              </span>
              <h2 className="text-sm font-extrabold text-zinc-900">
                Como Funciona a Análise de Lucro & Crescimento do Seu Negócio
              </h2>
            </div>
            <p className="text-xs text-zinc-600">
              O sistema calcula o lucro e a margem de cada produto com base no <strong>Custo Unitário de Compra</strong> e no <strong>Preço de Venda</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-white border border-sky-200 text-sky-900 font-bold">
              Lucro / Un. = Preço de Venda − Custo Unitário
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-900 font-bold">
              Margem (%) = (Lucro ÷ Preço de Venda) × 100
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-900 font-bold">
              Lucro no Estoque = Lucro / Un. × Estoque
            </span>
          </div>
        </div>
      </div>

      {/* Resumo do Capital em Estoque e Total de Interações */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Estoque e Lucro Projetado */}
        <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#087BFF]" />
              <h2 className="text-sm font-bold text-zinc-900">
                Balanço de Estoque & Lucro Esperado na Prateleira
              </h2>
            </div>
            <span className="text-[11px] font-bold text-sky-900 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
              Margem Média: {summary.averageMarginPercent || 0}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
              <div className="text-[11px] font-medium text-zinc-500">Custo Total</div>
              <div className="text-sm sm:text-base font-bold text-zinc-900 tabular-nums">
                {formatCurrency(summary.totalStockCost)}
              </div>
              <div className="text-[10px] text-zinc-400">{summary.totalStockUnits} un. em estoque</div>
            </div>
            <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200">
              <div className="text-[11px] font-bold text-blue-900">Valor de Venda</div>
              <div className="text-sm sm:text-base font-extrabold text-blue-800 tabular-nums">
                {formatCurrency(summary.totalStockSaleValue)}
              </div>
              <div className="text-[10px] text-blue-700">Se vender tudo</div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-[11px] font-bold text-emerald-900">Lucro Projetado</div>
              <div className="text-xs sm:text-sm font-extrabold text-emerald-700 tabular-nums">Normal: {formatCurrency(summary.potentialInventoryProfit)}</div>
              {summary.potentialInventoryPromoProfit !== undefined && <div className="text-xs sm:text-sm font-extrabold text-emerald-700 tabular-nums">Promo: {formatCurrency(summary.potentialInventoryPromoProfit)}</div>}
              <div className="text-[10px] text-emerald-800">Cenários de venda de todo o estoque</div>
            </div>
          </div>
        </div>

        {/* Total de Interações da Loja */}
        <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 border-b border-stone-100 pb-2.5">
            <MousePointerClick className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-zinc-900">
              Total de Interações dos Clientes na Loja
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200 text-center">
              <div className="text-base font-extrabold text-blue-700 tabular-nums">
                {summary.totalViewsAll}
              </div>
              <div className="text-[10px] font-bold text-blue-900 uppercase">Visualizações</div>
            </div>
            <div className="p-3 rounded-lg bg-sky-50/60 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#087BFF] tabular-nums">
                {summary.totalClicksAll}
              </div>
              <div className="text-[10px] font-bold text-sky-900 uppercase">Cliques</div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200 text-center">
              <div className="text-base font-extrabold text-emerald-700 tabular-nums">
                {summary.totalSharesAll}
              </div>
              <div className="text-[10px] font-bold text-emerald-900 uppercase">Shares (Zap)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Seletor de Tipo de Ranking (Vendas/Lucro vs. Interações/Cliques) */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Rankings de Performance</h2>
            <p className="text-[11px] text-zinc-500">
              Alterne entre rankings financeiros e rankings de engajamento dos produtos.
            </p>
          </div>

          <div className="inline-flex items-center p-1 bg-stone-100 border border-stone-200 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setRankingCategory('SALES_PROFIT')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                rankingCategory === 'SALES_PROFIT'
                  ? 'bg-zinc-900 text-white shadow-2xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              🏆 Mais Vendidos & Mais Lucro
            </button>
            <button
              type="button"
              onClick={() => setRankingCategory('INTERACTIONS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                rankingCategory === 'INTERACTIONS'
                  ? 'bg-zinc-900 text-white shadow-2xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              👁️ Visualizações, Cliques & Shares
            </button>
          </div>
        </div>

        {rankingCategory === 'SALES_PROFIT' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Ranking: O que mais sai */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-800">
                <Package className="w-4 h-4 text-amber-600" />
                <span>Top 5: O Que Mais Sai (Unidades)</span>
              </div>
              {rankingBestSellers.slice(0, 5).map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-stone-50/60 border border-stone-200/80">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      idx === 0 ? 'bg-amber-400 text-amber-950 font-extrabold' : 'bg-stone-200 text-zinc-700'
                    }`}>
                      {idx + 1}
                    </span>
                    <div className="w-8 h-8 rounded bg-white border border-stone-200 overflow-hidden shrink-0">
                      <ProductImage src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-zinc-900 truncate">{p.name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">{p.code} · {p.categoryName}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-zinc-900 tabular-nums">{p.unitsSold} un.</div>
                    <div className="text-[10px] text-emerald-800 font-semibold tabular-nums">{formatCurrency(p.revenue)}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Ranking: O que mais dá lucro */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-800">
                <TrendingUp className="w-4 h-4 text-emerald-700" />
                <span>Top 5: O Que Traz Mais Lucro (R$)</span>
              </div>
              {rankingMostProfitable.slice(0, 5).map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-emerald-50/40 border border-emerald-200/80">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      idx === 0 ? 'bg-emerald-700 text-white font-extrabold' : 'bg-stone-200 text-zinc-700'
                    }`}>
                      {idx + 1}
                    </span>
                    <div className="w-8 h-8 rounded bg-white border border-stone-200 overflow-hidden shrink-0">
                      <ProductImage src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-zinc-900 truncate">{p.name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">{p.code} · Margem: {p.unitMarginPercent}%</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-extrabold text-emerald-700 tabular-nums">
                      + {formatCurrency(p.realizedProfit)}
                    </div>
                    <div className="text-[10px] text-zinc-500 tabular-nums">{p.unitsSold} un. vendidas</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Top Mais Visualizados */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                <Eye className="w-4 h-4 text-blue-600" />
                <span>Top Visualizados</span>
              </div>
              {rankingMostViewed.slice(0, 4).map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-blue-50/40 border border-blue-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-blue-700">#{idx + 1}</span>
                    <span className="text-xs font-semibold text-zinc-900 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs font-bold text-blue-700 shrink-0 font-mono">
                    {p.viewsCount} views
                  </span>
                </div>
              ))}
            </div>

            {/* Top Mais Clicados */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-900">
                <MousePointerClick className="w-4 h-4 text-[#087BFF]" />
                <span>Top Clicados na Vitrine</span>
              </div>
              {rankingMostClicked.slice(0, 4).map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-sky-50/40 border border-sky-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-sky-700">#{idx + 1}</span>
                    <span className="text-xs font-semibold text-zinc-900 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs font-bold text-[#087BFF] shrink-0 font-mono">
                    {p.clicksCount} cliques
                  </span>
                </div>
              ))}
            </div>

            {/* Top Mais Compartilhados */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                <Share2 className="w-4 h-4 text-emerald-700" />
                <span>Top Compartilhados</span>
              </div>
              {rankingMostShared.slice(0, 4).map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/40 border border-emerald-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-emerald-800">#{idx + 1}</span>
                    <span className="text-xs font-semibold text-zinc-900 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs font-bold text-emerald-800 shrink-0 font-mono">
                    {p.sharesCount} shares
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabela Completa de Análise de Lucro de Cada Produto */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              Tabela de Produtos: Lucro, Estoque & Interações ({filteredProducts.length} itens)
            </h2>
            <p className="text-[11px] text-zinc-500">
              Compare custos, margens e quantas visualizações, cliques e compartilhamentos cada item gerou.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar produto ou código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs text-zinc-600">
              <span className="text-[11px] font-semibold text-zinc-500">Ordenar por:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-stone-50 border border-stone-300 rounded-lg focus:outline-none font-semibold text-zinc-800"
              >
                <option value="realizedProfit">Maior Lucro Já Realizado (R$)</option>
                <option value="unitsSold">Mais Vendidos (Qtd)</option>
                <option value="viewsCount">Mais Visualizados (👁️)</option>
                <option value="clicksCount">Mais Clicados (👆)</option>
                <option value="sharesCount">Mais Compartilhados (📢)</option>
                <option value="conversionRatePercent">Maior Taxa de Conversão (%)</option>
                <option value="unitProfit">Maior Lucro por Unidade (R$)</option>
                <option value="unitMarginPercent">Maior Margem (%)</option>
                <option value="potentialStockProfit">Maior Lucro Projetado no Estoque (R$)</option>
                <option value="stock">Maior Estoque</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-stone-200 text-zinc-500 text-[11px] uppercase tracking-wider bg-stone-50/50">
                <th className="py-2.5 px-3 font-semibold">Produto</th>
                <th className="py-2.5 px-3 font-semibold text-right">Custo Unitário</th>
                <th className="py-2.5 px-3 font-semibold text-right">Preço Venda</th>
                <th className="py-2.5 px-3 font-semibold text-right text-emerald-800">Lucro / Un.</th>
                <th className="py-2.5 px-3 font-semibold text-right text-emerald-800">Margem (%)</th>
                <th className="py-2.5 px-3 font-semibold text-center">Interações</th>
                <th className="py-2.5 px-3 font-semibold text-center">Conversão</th>
                <th className="py-2.5 px-3 font-semibold text-center">Estoque</th>
                <th className="py-2.5 px-3 font-semibold text-right text-sky-900">Lucro no Estoque</th>
                <th className="py-2.5 px-3 font-semibold text-right text-zinc-900">Vendas</th>
                <th className="py-2.5 px-3 font-semibold text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-xs text-zinc-500">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const hasCost = p.hasCostDefined ?? p.cost > 0;
                  const isZeroProfit = hasCost && p.cost === p.effectivePrice;
                  const isLoss = hasCost && p.cost > p.effectivePrice;
                  return (
                    <tr key={p.id} className="hover:bg-stone-50/50 transition-colors">
                      {/* Produto */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                            <ProductImage src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-zinc-900">{p.code}</span>
                              {p.isKit && (
                                <span className="px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 text-[9px] font-bold">
                                  KIT
                                </span>
                              )}
                              {p.hasPromo && (
                                <span className="px-1.5 py-0.2 rounded bg-red-100 text-red-800 text-[9px] font-bold">
                                  PROMO
                                </span>
                              )}
                            </div>
                            <div className="font-semibold text-zinc-800 truncate max-w-[180px]">{p.name}</div>
                            <div className="text-[10px] text-zinc-400">{p.categoryName}</div>
                          </div>
                        </div>
                      </td>

                      {/* Custo */}
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {hasCost ? (
                          <span className="text-zinc-600 font-mono font-semibold">
                            {formatCurrency(p.cost)}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
                            Sem custo
                          </span>
                        )}
                      </td>

                      {/* Preço de Venda */}
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-zinc-900 tabular-nums">
                        {formatCurrency(p.effectivePrice)}
                        {p.hasPromo && (
                          <div className="text-[10px] text-zinc-400 line-through">
                            {formatCurrency(p.price)}
                          </div>
                        )}
                      </td>

                      {/* Lucro Unitário */}
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {!hasCost ? (
                          <span className="text-zinc-400 text-[11px]">Defina o custo</span>
                        ) : isZeroProfit ? (
                          <span className="text-red-700 font-bold text-xs" title="Custo igual ou maior que o preço de venda">
                            R$ 0,00
                          </span>
                        ) : (
                          <span className={`font-bold ${isLoss ? 'text-red-700' : 'text-emerald-700'}`}>
                            {p.unitProfit < 0 ? '' : '+ '}{formatCurrency(p.unitProfit)}{isLoss ? ' · Prejuízo' : ''}
                          </span>
                        )}
                      </td>

                      {/* Margem Unitária */}
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {!hasCost ? (
                          <span className="text-zinc-400 text-[11px]">-</span>
                        ) : isZeroProfit ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800" title="Sem lucro: custo igual ou maior que venda">
                            0% margem
                          </span>
                        ) : (
                          <div>
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              p.unitMarginPercent >= 50
                                ? 'bg-emerald-100 text-emerald-800'
                                : p.unitMarginPercent >= 30
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-stone-100 text-zinc-700'
                            }`}>
                              {p.unitMarginPercent}%
                            </span>
                            {p.markupPercent !== undefined && p.markupPercent > 0 && (
                              <div className="text-[9px] text-zinc-400 mt-0.5 font-sans">
                                Markup: +{p.markupPercent}%
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Interações (Views · Cliques · Shares) */}
                      <td className="py-2.5 px-3 text-center tabular-nums">
                        <div className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                          <span title="Visualizações" className="text-zinc-700">
                            👁️ {p.viewsCount || 0}
                          </span>
                          <span className="text-zinc-300">·</span>
                          <span title="Cliques" className="text-blue-700 font-semibold">
                            👆 {p.clicksCount || 0}
                          </span>
                          <span className="text-zinc-300">·</span>
                          <span title="Compartilhamentos" className="text-emerald-800 font-semibold">
                            📢 {p.sharesCount || 0}
                          </span>
                        </div>
                      </td>

                      {/* Taxa de Conversão */}
                      <td className="py-2.5 px-3 text-center tabular-nums">
                        {p.conversionRatePercent !== null && p.conversionRatePercent !== undefined ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              p.conversionRatePercent >= 10
                                ? 'bg-emerald-100 text-emerald-800'
                                : p.conversionRatePercent > 0
                                ? 'bg-blue-100 text-blue-900'
                                : 'bg-stone-100 text-zinc-600'
                            }`}
                          >
                            {p.conversionRatePercent}%
                          </span>
                        ) : (
                          <span
                            className="text-zinc-400 text-xs font-mono cursor-help"
                            title="Aguardando mais dados para calcular conversão com precisão (mínimo de 10 visitantes no período)"
                          >
                            —
                          </span>
                        )}
                      </td>

                      {/* Estoque */}
                      <td className="py-2.5 px-3 text-center tabular-nums">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          p.stock <= 0
                            ? 'bg-red-100 text-red-800'
                            : p.stock <= 5
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-stone-100 text-zinc-700'
                        }`}>
                          {p.stock} un.
                        </span>
                      </td>

                      {/* Lucro no Estoque */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-sky-900 tabular-nums">
                        {!hasCost ? (
                          <span className="text-zinc-400 text-[11px] font-normal font-sans">Defina o custo</span>
                        ) : p.stock > 0 ? (
                          <div className="space-y-0.5">
                            <div className={Number(p.normalStockProfit ?? p.potentialStockProfit) < 0 ? 'text-red-700' : 'text-sky-900'}>Normal: {formatCurrency(Number(p.normalStockProfit ?? p.potentialStockProfit))}</div>
                            {p.promoStockProfit !== null && p.promoStockProfit !== undefined && <div className={p.promoStockProfit < 0 ? 'text-red-700' : 'text-sky-900'}>Promo: {formatCurrency(p.promoStockProfit)}</div>}
                          </div>
                        ) : (
                          'R$ 0,00'
                        )}
                      </td>

                      {/* Vendas (Entregues) */}
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <div className="font-bold text-zinc-900">{p.unitsSold} un.</div>
                        {p.realizedProfit > 0 && (
                          <div className="text-[10px] text-emerald-800 font-bold">
                            +{formatCurrency(p.realizedProfit)} lucro
                          </div>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => openQuickCostModal(p)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors cursor-pointer"
                          title="Ajustar custo e margem deste produto"
                        >
                          ✏️ Ajustar Custo
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Rápido de Ajuste de Custo, Preço & Margem */}
      {editingCostProd && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-xl border border-stone-200 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-stone-100 text-zinc-700 rounded mr-2">
                  {editingCostProd.code}
                </span>
                <h3 className="text-sm font-bold text-zinc-900 inline">
                  Ajustar Custo & Margem de Lucro
                </h3>
                <div className="text-xs text-zinc-500 truncate max-w-[340px] mt-0.5">
                  {editingCostProd.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCostProd(null)}
                className="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCost} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Preço normal (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={modalPrice}
                    onChange={(e) => setModalPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-300 rounded-lg font-mono font-bold"
                  />
                  <span className="text-[10px] text-zinc-400">Valor cobrado do cliente</span>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700">
                    Custo de Compra (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={modalCost}
                    onChange={(e) => setModalCost(e.target.value)}
                    placeholder="Ex: 6.50"
                    className="w-full px-3 py-2 text-sm bg-sky-50/50 border border-sky-300 rounded-lg font-mono font-bold text-sky-950 focus:ring-2 focus:ring-[#087BFF]"
                  />
                  <span className="text-[10px] text-zinc-500">Quanto você pagou por 1 un.</span>
                </div>
              </div>

              {/* Simulador de Lucro em Tempo Real */}
              {(() => {
                const simulation = simulateProfit({ normalPrice: modalPrice, promoPrice: editingCostProd.promoPrice, hasPromo: editingCostProd.hasPromo, cost: modalCost, stock: editingCostProd.stock, promoMaxUnits: editingCostProd.promoMaxUnits });
                const sPrice = simulation.promo?.salePrice ?? simulation.normal.salePrice;
                const cPrice = simulation.costUnitPrecise;
                const hasCost = simulation.hasCost;
                const profit = simulation.promo?.unitProfit ?? simulation.normal.unitProfit;
                const margin = simulation.promo?.marginPercent ?? simulation.normal.marginPercent;
                const markup = simulation.promo?.markupPercent ?? simulation.normal.markupPercent;
                const stockProfit = simulation.promo?.stockProfit ?? simulation.normal.stockProfit;

                return (
                  <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2.5">
                    <div className="text-[11px] font-bold text-zinc-800 uppercase tracking-wide flex items-center justify-between">
                      <span>Resultado Calculado Automaticamente:</span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {editingCostProd.stock} un. em estoque
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-white border border-stone-200">
                        <div className="text-[10px] text-zinc-500 font-medium">Lucro / Unidade</div>
                        <div className={`text-sm font-bold font-mono ${profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-zinc-800'}`}>
                          {formatCurrency(profit)}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-stone-200">
                        <div className="text-[10px] text-zinc-500 font-medium">Margem de Lucro</div>
                        <div className={`text-sm font-bold font-mono ${margin >= 30 ? 'text-emerald-700' : margin > 0 ? 'text-amber-700' : 'text-red-600'}`}>
                          {margin.toFixed(1)}%
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-stone-200">
                        <div className="text-[10px] text-sky-900 font-medium">Lucro no Estoque</div>
                        <div className="text-sm font-bold font-mono text-sky-900">
                          {formatCurrency(stockProfit)}
                        </div>
                      </div>
                    </div>

                    {cPrice >= sPrice && sPrice > 0 && (
                      <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 font-medium">
                        ⚠️ Atenção: O custo de compra é maior ou igual ao preço de venda. Sua margem de lucro será 0% ou haverá prejuízo.
                      </div>
                    )}

                    {cPrice > 0 && profit > 0 && (
                      <div className="text-[11px] text-zinc-500 text-center font-mono">
                        Markup sobre custo: +{markup.toFixed(1)}% | A cada 1 venda você ganha {formatCurrency(profit)}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setEditingCostProd(null)}
                  className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingCost}
                  className="px-5 py-2 text-xs font-bold text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shadow-xs"
                >
                  {savingCost ? 'Salvando...' : 'Salvar Custo & Lucro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
