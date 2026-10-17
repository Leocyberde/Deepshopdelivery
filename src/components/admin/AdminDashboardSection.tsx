import React, { useState } from 'react';
import {
  AlertTriangle,
  Package,
  ShoppingBag,
  Users,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageCircle,
  Truck,
  TrendingUp,
  DollarSign,
  Calculator,
  ShieldAlert,
  Info,
  Layers,
  Settings,
} from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  formatOrderNumberLabel,
  ORDER_STATUS_LABELS,
} from '../../context/AppContext.tsx';
import { AdminSection } from './AdminSidebar.tsx';

interface AdminDashboardSectionProps {
  dashboardData: any;
  pendingAddrCount: number;
  pendingOrdCount: number;
  orders: any[];
  setCustomerFilter: (val: 'ALL' | 'WITH_FREE_DELIVERY') => void;
  setOrderStatusFilter: (val: string) => void;
  goToSection: (target: AdminSection) => void;
  recalculateAddressDistance: (addr: any, customerName?: string) => void;
  openOrderFreightFromAlert: (ord: any) => void;
  openEditProduct: (prod: any) => void;
  onOpenOrder: (ord: any) => void;
}

export const AdminDashboardSection: React.FC<AdminDashboardSectionProps> = ({
  dashboardData,
  pendingAddrCount,
  pendingOrdCount,
  orders,
  setCustomerFilter,
  setOrderStatusFilter,
  goToSection,
  recalculateAddressDistance,
  openOrderFreightFromAlert,
  openEditProduct,
  onOpenOrder,
}) => {
  const metrics = dashboardData?.metrics || {};
  const statusCounts = dashboardData?.operations?.statusCounts || metrics.statusCounts || {};
  const operationsMetrics = dashboardData?.operations?.metrics || metrics;
  const pendingOrdersCount = Number(operationsMetrics.pendingOrdersCount ?? metrics.pendingOrdersCount ?? 0);
  const [financialTab, setFinancialTab] = useState<'today' | 'month' | 'allTime'>('month');
  const financials = dashboardData?.financials || {};
  const activeFin = financials[financialTab] || financials.month || {};
  const inventory = financials.inventory || {};
  const storeTz = dashboardData?.storeTimezone || 'America/Sao_Paulo';

  // Pedidos pendentes de entrega (visão principal solicitada pelo usuário)
  // Inclui todos os pedidos que não foram cancelados e nem entregues ainda
  const pendingDeliveryOrders = Array.isArray(dashboardData?.pendingDeliveryOrders)
    ? dashboardData.pendingDeliveryOrders
    : orders.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED');

  const pendingAddresses = Array.isArray(dashboardData?.alerts?.pendingFreightAddresses)
    ? dashboardData.alerts.pendingFreightAddresses
    : [];

  const lowStockList = Array.isArray(dashboardData?.lowStockProducts)
    ? dashboardData.lowStockProducts
    : [];

  const handleOpenOrder = (ord: any) => {
    setOrderStatusFilter('ALL');
    goToSection('ORDERS');
    onOpenOrder(ord);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NEW':
        return {
          label: 'Novo Pedido',
          className: 'bg-blue-100 text-blue-900 border border-blue-200',
        };
      case 'AWAITING_PAYMENT':
        return {
          label: 'Aguardando Pagamento',
          className: 'bg-amber-100 text-amber-900 border border-amber-200',
        };
      case 'PAID':
        return {
          label: 'Pago / Confirmado',
          className: 'bg-emerald-100 text-emerald-900 border border-emerald-200',
        };
      case 'PREPARING':
        return {
          label: 'Em Separação',
          className: 'bg-sky-100 text-sky-900 border border-sky-200',
        };
      case 'OUT_FOR_DELIVERY':
        return {
          label: 'Saiu para Entrega 🛵',
          className: 'bg-orange-100 text-orange-900 border border-orange-200 animate-pulse',
        };
      default:
        return {
          label: ORDER_STATUS_LABELS[status] || status,
          className: 'bg-stone-100 text-zinc-800 border border-stone-200',
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Painel Operacional</h1>
          <p className="text-xs text-zinc-500">
            Acompanhe os pedidos que precisam de atendimento, envio e entrega em tempo real.
          </p>
        </div>

        <button
          type="button"
          onClick={() => goToSection('PROFIT_RANKING')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-[#087BFF] text-xs font-bold transition-colors cursor-pointer self-start sm:self-auto"
        >
          <TrendingUp className="w-4 h-4" />
          <span>Ver Análise de Lucro & Ranking dos Produtos →</span>
        </button>
      </div>

      <section aria-labelledby="admin-operations-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="admin-operations-heading" className="text-sm font-bold text-zinc-900">Visão operacional</h2>
          {dashboardData?.storeState && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${dashboardData.storeState.isOpen ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${dashboardData.storeState.isOpen ? 'bg-emerald-600' : 'bg-amber-600'}`} />
              {dashboardData.storeState.isOpen ? 'Loja aberta' : dashboardData.storeState.status === 'OPEN' && !dashboardData.storeState.insideHours ? 'Fora do horário' : 'Loja fechada'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <OperationalCountCard label="Pedidos hoje" value={operationsMetrics.todayOrdersCount || 0} tone="blue" />
          <OperationalCountCard label="Novos clientes hoje" value={operationsMetrics.newCustomersCount || 0} tone="blue" />
          <OperationalCountCard label="Novos" value={statusCounts.NEW || 0} tone="blue" />
          <OperationalCountCard label="Aguardando pagamento" value={statusCounts.AWAITING_PAYMENT || 0} tone="amber" />
          <OperationalCountCard label="Pagos" value={statusCounts.PAID || 0} tone="green" />
          <OperationalCountCard label="Em separação" value={statusCounts.PREPARING || 0} tone="blue" />
          <OperationalCountCard label="Saiu para entrega" value={statusCounts.OUT_FOR_DELIVERY || 0} tone="orange" />
          <OperationalCountCard label="Entregues" value={statusCounts.DELIVERED || 0} tone="green" />
          <OperationalCountCard label="Cancelados" value={statusCounts.CANCELLED || 0} tone="red" />
        </div>
      </section>

      {/* KPIs Operacionais Limpos (Sem misturar custos/lucros na tela inicial) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Pedidos Pendentes de Entrega */}
        <div className="bg-sky-50/80 border-2 border-[#087BFF]/40 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-sky-900 font-bold">
            <span>Pendentes de Entrega</span>
            <Clock className="w-4 h-4 text-[#087BFF]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0666D6] tabular-nums">
            {pendingOrdersCount}
          </div>
          <div className="text-[11px] text-sky-800 font-semibold">
            {pendingOrdersCount === 1 ? '1 pedido precisa de ação' : `${pendingOrdersCount} pedidos precisam de ação`}
          </div>
        </div>

        {/* Vendas Concluídas Hoje (Apenas pedidos entregues!) */}
        <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Entregues Hoje</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-bold text-zinc-900 tabular-nums">
            {formatCurrency(metrics.salesTodayTotal || 0)}
          </div>
          <div className="text-[11px] text-emerald-800 font-semibold tabular-nums">
            {metrics.ordersTodayCount || 0} pedido(s) entregue(s)
          </div>
        </div>

        {/* Vendas Concluídas no Mês (Apenas pedidos entregues!) */}
        <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Entregues no Mês</span>
            <ShoppingBag className="w-4 h-4 text-zinc-700" />
          </div>
          <div className="text-xl font-bold text-zinc-900 tabular-nums">
            {formatCurrency(metrics.salesMonthTotal || 0)}
          </div>
          <div className="text-[11px] text-zinc-600 font-semibold tabular-nums">
            Total realizado no mês
          </div>
        </div>

        {/* Clientes Cadastrados */}
        <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Clientes</span>
            <Users className="w-4 h-4 text-zinc-700" />
          </div>
          <div className="text-xl font-bold text-zinc-900 tabular-nums">
            {metrics.customersCount || 0}
          </div>
          <div className="text-[11px] text-zinc-500 tabular-nums">
            {pendingAddrCount > 0 ? (
              <span className="text-amber-800 font-bold">{pendingAddrCount} sem frete</span>
            ) : (
              'Todos com frete definido'
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* VISÃO PRINCIPAL: PEDIDOS PENDENTES DE ENTREGA (REQUISITO 1)           */}
      {/* ===================================================================== */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-100 border border-sky-200 flex items-center justify-center text-[#087BFF]">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-900">
                  Pedidos Pendentes de Entrega
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-sky-100 text-[#0666D6] text-xs font-extrabold tabular-nums">
                  {pendingOrdersCount}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Pedidos em andamento aguardando confirmação, separação ou envio para entrega.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setOrderStatusFilter('ALL');
              goToSection('ORDERS');
            }}
            className="text-xs font-semibold text-[#087BFF] hover:underline self-start sm:self-auto"
          >
            Abrir Todos os Pedidos →
          </button>
        </div>

        {pendingOrdersCount === 0 ? (
          <div className="p-10 text-center space-y-2 border border-dashed border-stone-200 rounded-xl bg-stone-50/50">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <h3 className="text-sm font-bold text-zinc-900">
              Nenhum pedido pendente no momento!
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              Todos os pedidos já foram entregues aos clientes ou cancelados. Quando um novo pedido chegar, ele aparecerá em destaque aqui.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingOrdersCount > pendingDeliveryOrders.length && (
              <p className="text-[11px] text-zinc-500">Exibindo os {pendingDeliveryOrders.length} pedidos mais recentes de {pendingOrdersCount}; abra todos para consultar o restante.</p>
            )}
            {pendingDeliveryOrders.map((ord: any) => {
              const badge = getStatusBadge(ord.status);
              const itemsList = Array.isArray(ord.items) ? ord.items : [];

              return (
                <div
                  key={ord.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a, input')) return;
                    handleOpenOrder(ord);
                  }}
                  className="p-4 rounded-xl border border-stone-200 hover:border-sky-400 transition-all bg-stone-50/40 hover:bg-white space-y-3.5 cursor-pointer shadow-2xs hover:shadow-xs"
                >
                  {/* Cabeçalho do Card */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-stone-100 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-extrabold text-sm text-zinc-900">
                        {formatOrderNumberLabel(ord.orderNumber)}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <span className="text-zinc-400 text-xs">·</span>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {formatDateTime(ord.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <span className="text-xs text-zinc-500">Total:</span>
                      <span className="font-mono font-extrabold text-base text-zinc-900 tabular-nums">
                        {formatCurrency(ord.total)}
                      </span>
                    </div>
                  </div>

                  {/* Informações do Cliente, Endereço e Ações */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    {/* Cliente e Endereço */}
                    <div className="md:col-span-5 space-y-1">
                      <div className="text-xs font-bold text-zinc-900">
                        Cliente: <span className="font-semibold text-zinc-800">{ord.customerName}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500">Endereço e contato aparecem somente ao abrir os detalhes do pedido.</div>
                    </div>

                    {/* Resumo de Itens do Pedido */}
                    <div className="md:col-span-4 min-w-0">
                      <div className="text-[11px] font-bold text-zinc-600 uppercase mb-1">
                        Itens ({itemsList.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0)} un.):
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {itemsList.slice(0, 3).map((it: any, iIdx: number) => (
                          <div
                            key={iIdx}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-stone-200 text-[11px] text-zinc-800 font-medium max-w-[170px] truncate"
                            title={`${it.quantity}x ${it.productName}`}
                          >
                            <span className="font-bold text-[#087BFF] font-mono">{it.quantity}x</span>
                            <span className="truncate">{it.productName}</span>
                          </div>
                        ))}
                        {itemsList.length > 3 && (
                          <span className="text-[10px] text-zinc-400 font-bold">
                            +{itemsList.length - 3} mais
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Botões de Ação Imediata (Responder no WhatsApp e Abrir Pedido) */}
                    <div className="md:col-span-3 flex flex-wrap sm:flex-nowrap md:flex-col lg:flex-row items-center gap-2 justify-end">
                      {ord.customerWhatsappUrl && (
                        <a
                          href={ord.customerWhatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors"
                          title="Abrir conversa no WhatsApp com mensagem sobre o pedido"
                        >
                          <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>WhatsApp</span>
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenOrder(ord)}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        <span>Gerenciar</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* DEMONSTRATIVO DE RESULTADO & APURAÇÃO DE LUCRO (ITEM 4 & ITEM 5)       */}
      {/* ===================================================================== */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-5 shadow-xs">
        {/* Cabeçalho da DRE com Abas de Período */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-800">
                <Calculator className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-zinc-900">
                Demonstrativo de Resultado & Apuração de Lucro (DRE)
              </h2>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Cálculo real auditável baseado na data de entrega, custo unitário histórico de cada item e custos operacionais.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-stone-100 border border-stone-200 rounded-xl self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setFinancialTab('today')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                financialTab === 'today'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Hoje (Entregues)
            </button>
            <button
              type="button"
              onClick={() => setFinancialTab('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                financialTab === 'month'
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Mês Atual
            </button>
            <button
              type="button"
              onClick={() => setFinancialTab('allTime')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                financialTab === 'allTime'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Histórico Geral
            </button>
          </div>
        </div>

        {/* Sequência Exata de Apuração Financeira (Item 4) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Coluna 1 & 2: A cascata da DRE passo a passo */}
          <div className="lg:col-span-2 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-zinc-500 px-3 pb-1 border-b border-stone-100 font-semibold">
              <span>Etapa da Apuração ({financialTab === 'today' ? 'Hoje' : financialTab === 'month' ? 'Mês Atual' : 'Todo o Histórico'})</span>
              <span>Valor (R$)</span>
            </div>

            {/* 1. Vendas Totais */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-zinc-900 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-900 font-extrabold flex items-center justify-center text-[10px]">
                    1
                  </span>
                  <span>Vendas Totais Realizadas</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Produtos: {formatCurrency(activeFin.productsRevenue || 0)} + Frete Cobrado: {formatCurrency(activeFin.freightRevenue || 0)} ({activeFin.ordersCount || 0} pedidos entregues)
                </div>
              </div>
              <div className="text-sm font-extrabold text-zinc-900 tabular-nums font-mono">
                {formatCurrency(activeFin.salesTotal || 0)}
              </div>
            </div>

            {/* 2. Custo dos Produtos (CMV) */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-zinc-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-red-100 text-red-800 font-extrabold flex items-center justify-center text-[10px]">
                    2
                  </span>
                  <span>(−) Custo dos Produtos Vendidos (CMV)</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Baseado no custo unitário congelado de compra de cada produto no momento do pedido ({activeFin.itemsSoldCount || 0} un. vendidas)
                </div>
              </div>
              <div className="text-sm font-bold text-red-700 tabular-nums font-mono">
                − {activeFin.productsCost === null ? 'Desconhecido' : formatCurrency(activeFin.productsCost || 0)}
              </div>
            </div>

            {/* 3. Lucro Bruto dos Produtos */}
            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-200 text-emerald-950 font-extrabold flex items-center justify-center text-[10px]">
                    3
                  </span>
                  <span>(=) Lucro Bruto dos Produtos</span>
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5">
                  Subtotal dos produtos vendido − Custo de compra dos produtos (Margem Bruta: {activeFin.profitMarginPercent === null ? 'desconhecida' : `${activeFin.profitMarginPercent || 0}%`})
                </div>
              </div>
              <div className="text-sm font-extrabold text-emerald-800 tabular-nums font-mono">
                + {activeFin.grossProductProfit === null ? 'Desconhecido' : formatCurrency(activeFin.grossProductProfit || 0)}
              </div>
            </div>

            {/* 4. Embalagens */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-zinc-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-stone-200 text-zinc-700 font-extrabold flex items-center justify-center text-[10px]">
                    4
                  </span>
                  <span>(−) Custo com Embalagens</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {activeFin.ordersCount || 0} pedidos entregues × {formatCurrency(activeFin.packagingCostPerOrder || 0)} por pedido
                </div>
              </div>
              <div className="text-sm font-bold text-zinc-700 tabular-nums font-mono">
                − {formatCurrency(activeFin.packagingTotal || 0)}
              </div>
            </div>

            {/* 5. Custo de Entrega da Loja */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-zinc-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-stone-200 text-zinc-700 font-extrabold flex items-center justify-center text-[10px]">
                    5
                  </span>
                  <span>(−) Custo Operacional de Entrega da Loja</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {activeFin.ordersCount || 0} pedidos entregues × {formatCurrency(activeFin.deliveryCostPerOrder || 0)} (frete da loja/motoboy)
                </div>
              </div>
              <div className="text-sm font-bold text-zinc-700 tabular-nums font-mono">
                − {formatCurrency(activeFin.deliveryTotal || 0)}
              </div>
            </div>

            {/* 6. Lucro Estimado antes dos Custos Fixos */}
            <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-200 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-sky-950 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-sky-200 text-sky-950 font-extrabold flex items-center justify-center text-[10px]">
                    6
                  </span>
                  <span>(=) Lucro Estimado antes dos Custos Fixos</span>
                </div>
                <div className="text-[11px] text-sky-800 mt-0.5">
                  Vendas totais − Custo dos produtos − Embalagens − Custo de entrega
                </div>
              </div>
              <div className="text-sm font-extrabold text-[#087BFF] tabular-nums font-mono">
                + {activeFin.estimatedProfitBeforeFixed === null ? 'Desconhecido' : formatCurrency(activeFin.estimatedProfitBeforeFixed || 0)}
              </div>
            </div>

            {/* 7. Custos Fixos do Mês */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-zinc-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-stone-200 text-zinc-700 font-extrabold flex items-center justify-center text-[10px]">
                    7
                  </span>
                  <span>(−) Custos Fixos Mensais</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {financialTab === 'month'
                    ? 'Aluguel, luz, sistemas e custos fixos configurados na loja'
                    : 'Custos fixos mensais entram na apuração do mês para não distorcer o resultado diário'}
                </div>
              </div>
              <div className="text-sm font-bold text-zinc-700 tabular-nums font-mono">
                {financialTab === 'month'
                  ? `− ${formatCurrency(activeFin.monthlyFixedCosts || 0)}`
                  : '—'}
              </div>
            </div>

            {/* 8. Lucro Estimado do Período */}
            <div className="p-4 rounded-xl bg-emerald-600 text-white shadow-xs flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase font-extrabold tracking-wider text-emerald-100 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-white text-emerald-700 font-extrabold flex items-center justify-center text-[10px]">
                    8
                  </span>
                  <span>(=) Lucro Líquido Estimado do Período</span>
                </div>
                <div className="text-xs text-emerald-100 mt-0.5">
                  {activeFin.costStatus === 'INCOMPLETE' ? 'Custo histórico incompleto; lucro não calculado' : 'Resultado financeiro líquido real obtido com os pedidos entregues'}
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black tabular-nums font-mono">
                {activeFin.estimatedProfit === null ? 'Desconhecido' : formatCurrency(activeFin.estimatedProfit || 0)}
              </div>
            </div>
          </div>

          {/* Coluna 3: Auditoria do Programa de Entrega Grátis & Balanço do Estoque */}
          <div className="space-y-4">
            {/* Auditoria de Entrega Grátis */}
            <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-amber-950">
                <span className="flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-amber-700" />
                  Auditoria de Fretes Grátis
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                  {activeFin.freeDeliveriesCount || 0} pedidos
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center text-zinc-600">
                  <span>Fretes grátis concedidos:</span>
                  <span className="font-bold text-zinc-900 font-mono">
                    {activeFin.freeDeliveriesCount || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center text-zinc-600">
                  <span>Custo total assumido pela loja:</span>
                  <span className="font-bold text-amber-900 font-mono">
                    {formatCurrency(activeFin.freeDeliveryCost || 0)}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 pt-1 border-t border-amber-200/60">
                  Inclui apenas pedidos com cortesia de frete registrada pela loja.
                </div>
              </div>
            </div>

            {/* Balanço de Estoque Atual (Item 5) */}
            <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-zinc-900 border-b border-stone-100 pb-2">
                <span className="flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-[#087BFF]" />
                  Balanço do Estoque Atual
                </span>
                <button
                  type="button"
                  onClick={() => goToSection('PROFIT_RANKING')}
                  className="text-[11px] text-[#087BFF] hover:underline font-semibold"
                >
                  Ver Ranking →
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-600">Peças na prateleira:</span>
                  <span className="font-bold text-zinc-900 font-mono">
                    {inventory.totalStockUnits || 0} un.
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-600">Custo Total de Compra:</span>
                  <span className="font-bold text-zinc-900 font-mono">
                    {formatCurrency(inventory.totalInventoryCost || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-600">Valor de Venda Total:</span>
                  <span className="font-bold text-blue-700 font-mono">
                    {formatCurrency(inventory.totalInventorySaleValue || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-stone-100">
                  <span className="font-bold text-emerald-950">Lucro Projetado no Estoque:</span>
                  <span className="font-extrabold text-emerald-700 font-mono text-sm">
                    + {formatCurrency(inventory.projectedInventoryProfit || 0)}
                  </span>
                </div>
              </div>

              {/* Alerta de Produtos Sem Custo Cadastrado */}
              {inventory.productsWithoutCostCount > 0 ? (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-amber-900 font-bold text-[11px]">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span>{inventory.productsWithoutCostCount} produto(s) sem custo de compra</span>
                  </div>
                  <p className="text-[10px] text-amber-800">
                    Estes itens foram excluídos do lucro projetado para não distorcer as contas. Cadastre os custos para ter 100% de precisão.
                  </p>
                  <button
                    type="button"
                    onClick={() => goToSection('PROFIT_RANKING')}
                    className="w-full py-1 text-[11px] font-bold text-amber-950 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors cursor-pointer"
                  >
                    Cadastrar Custos Agora →
                  </button>
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Todos os produtos com custo cadastrado.</span>
                </div>
              )}
            </div>

            {/* Atalho para Configurações Operacionais */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs flex items-center justify-between gap-2">
              <div className="text-[11px] text-zinc-500">
                Fuso: <strong className="text-zinc-800 font-mono">{storeTz}</strong> · Custos operacionais editáveis
              </div>
              <button
                type="button"
                onClick={() => goToSection('SETTINGS')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-zinc-800 bg-white hover:bg-stone-100 border border-stone-300 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <Settings className="w-3 h-3 text-zinc-600" />
                <span>Configurar</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alerta de Endereços Aguardando Frete */}
        {pendingAddrCount > 0 && (
          <div className="bg-amber-50/90 border border-amber-300 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Endereços de Clientes Sem Frete ({pendingAddrCount})</span>
              </div>
              <button
                type="button"
                onClick={() => goToSection('CUSTOMERS')}
                className="text-xs font-semibold text-amber-950 underline"
              >
                Ver clientes
              </button>
            </div>
            <div className="space-y-2">
              {pendingAddresses.slice(0, 3).map((addr: any) => (
                <div
                  key={addr.id}
                  className="p-3 bg-white rounded-lg border border-amber-200 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-zinc-900 truncate">
                      {addr.customerName} ({addr.label})
                    </div>
                    <div className="text-zinc-600 text-[11px] truncate">
                      {addr.street}, {addr.number} — {addr.neighborhood}, {addr.city}/{addr.state}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => recalculateAddressDistance(addr, addr.customerName)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg shrink-0"
                  >
                    Recalcular distância
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alerta de Produtos com Estoque Baixo */}
        {lowStockList.length > 0 && (
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
                <Package className="w-4 h-4 text-amber-600" />
                <span>Estoque Baixo (≤ 5 un.) ({lowStockList.length})</span>
              </div>
              <button
                type="button"
                onClick={() => goToSection('PRODUCTS')}
                className="text-xs font-semibold text-zinc-700 hover:text-zinc-900 underline"
              >
                Ver Produtos
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              {lowStockList.slice(0, 3).map((prod: any) => (
                <div
                  key={prod.id}
                  className="p-2 rounded-lg bg-stone-50 border border-stone-200 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-mono font-bold text-zinc-800">{prod.code}</span> — {prod.name}
                  </div>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-xs shrink-0 tabular-nums">
                    {prod.stock} un.
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const OPERATIONAL_TONES: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-950',
  amber: 'border-amber-200 bg-amber-50 text-amber-950',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  orange: 'border-orange-200 bg-orange-50 text-orange-950',
  red: 'border-red-200 bg-red-50 text-red-950',
};

function OperationalCountCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`min-h-[86px] rounded-xl border p-3 ${OPERATIONAL_TONES[tone] || OPERATIONAL_TONES.blue}`}>
      <div className="text-[11px] font-semibold leading-snug opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums" aria-label={`${label}: ${value}`}>
        {Number(value || 0)}
      </div>
    </div>
  );
}
