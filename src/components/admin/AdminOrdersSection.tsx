import React, { useState } from 'react';
import { Search, ExternalLink, Truck, ArrowUpDown } from 'lucide-react';
import {
  formatCurrency,
  formatPaymentMethodDisplay,
  formatDistance,
  formatDateTime,
  formatOrderNumberLabel,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_LIST,
  ProductImage,
  PaymentTimerBadge,
} from '../../context/AppContext.tsx';

interface AdminOrdersSectionProps {
  ordersData: {
    orders: any[];
    paymentDeadlineHours: number;
    page?: number;
    pageSize?: number;
    totalCount?: number;
    totalPages?: number;
  };
  orderSearch: string;
  setOrderSearch: (val: string) => void;
  orderStatusFilter: string;
  setOrderStatusFilter: (val: string) => void;
  orderDateFrom: string;
  setOrderDateFrom: (val: string) => void;
  orderDateTo: string;
  setOrderDateTo: (val: string) => void;
  orderSort: 'priority' | 'oldest' | 'newest';
  setOrderSort: (val: 'priority' | 'oldest' | 'newest') => void;
  onPageChange: (page: number) => void;
  ordersLoading: boolean;
  ordersError: string;
  orderDetailsLoading: boolean;
  orderActionPendingId: number | null;
  onOpenOrder: (order: any) => void;
  selectedAdminOrder: any | null;
  setSelectedAdminOrder: (ord: any | null) => void;
  handleChangeOrderStatus: (orderId: number, newStatus: string, reason?: string) => void | boolean | Promise<void | boolean>;
  onRefreshOrders?: () => void;
}

const ADMIN_ORDER_TRANSITIONS: Record<string, string[]> = {
  NEW: ['AWAITING_PAYMENT', 'PAID', 'PREPARING', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'PREPARING', 'CANCELLED'],
  PAID: ['PREPARING', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const AdminOrdersSection: React.FC<AdminOrdersSectionProps> = ({
  ordersData,
  orderSearch,
  setOrderSearch,
  orderStatusFilter,
  setOrderStatusFilter,
  orderDateFrom,
  setOrderDateFrom,
  orderDateTo,
  setOrderDateTo,
  orderSort,
  setOrderSort,
  onPageChange,
  ordersLoading,
  ordersError,
  orderDetailsLoading,
  orderActionPendingId,
  onOpenOrder,
  selectedAdminOrder,
  setSelectedAdminOrder,
  handleChangeOrderStatus,
  onRefreshOrders,
}) => {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState('');
  const filteredOrders = ordersData.orders;

  const requestStatusChange = (orderId: number, status: string) => {
    if (status === 'CANCELLED') {
      setCancelReason('');
      setCancelReasonError('');
      setCancelDialogOpen(true);
      return;
    }
    void handleChangeOrderStatus(orderId, status);
  };

  const confirmCancellation = async (event: React.FormEvent) => {
    event.preventDefault();
    const reason = cancelReason.trim();
    if (reason.length < 5 || reason.length > 500) {
      setCancelReasonError('Informe um motivo entre 5 e 500 caracteres.');
      return;
    }
    if (!selectedAdminOrder) return;
    const saved = await handleChangeOrderStatus(selectedAdminOrder.id, 'CANCELLED', reason);
    if (saved !== false) {
      setCancelDialogOpen(false);
      setCancelReason('');
    }
  };

  const paymentDeadlineMinutes = Math.max(1, Math.round(Number(ordersData.paymentDeadlineHours || 0.5) * 60));
  const paymentDeadlineLabel = paymentDeadlineMinutes % 60 === 0 ? `${paymentDeadlineMinutes / 60}h` : `${paymentDeadlineMinutes} min`;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Gestão de Pedidos</h1>
          <p className="text-xs text-zinc-500">
            Estoque reservado no ato do pedido (por ordem de chegada) com prazo automático de {paymentDeadlineLabel} para pagamento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOrderSort(orderSort === 'priority' ? 'oldest' : orderSort === 'oldest' ? 'newest' : 'priority')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              orderSort !== 'priority'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-700 border-stone-300 hover:bg-stone-50'
            }`}
            title="Alternar prioridade de atendimento, ordem de chegada e mais recentes"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>
              {orderSort === 'priority' ? 'Priorizar pedidos que precisam de ação' : orderSort === 'oldest' ? 'Ordem de chegada' : 'Mais recentes'}
            </span>
          </button>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Buscar por nº do pedido, cliente ou telefone"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-3">
        <div className="space-y-1">
          <label htmlFor="orders-from" className="block text-[11px] font-semibold text-zinc-600">De</label>
          <input id="orders-from" type="date" value={orderDateFrom} onChange={(e) => setOrderDateFrom(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs" />
        </div>
        <div className="space-y-1">
          <label htmlFor="orders-to" className="block text-[11px] font-semibold text-zinc-600">Até</label>
          <input id="orders-to" type="date" value={orderDateTo} onChange={(e) => setOrderDateTo(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs" />
        </div>
        {(orderDateFrom || orderDateTo) && (
          <button type="button" onClick={() => { setOrderDateFrom(''); setOrderDateTo(''); }} className="px-3 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900">Limpar período</button>
        )}
        <span className="ml-auto text-xs text-zinc-500" aria-live="polite">{Number(ordersData.totalCount || 0)} pedido(s) encontrados</span>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-stone-200/60 rounded-lg overflow-x-auto">
        <button
          type="button"
          onClick={() => setOrderStatusFilter('ALL')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
            orderStatusFilter === 'ALL'
              ? 'bg-white text-zinc-900 shadow-xs'
              : 'text-zinc-600'
          }`}
        >
          Todos ({Number(ordersData.totalCount || 0)})
        </button>
        {ORDER_STATUS_LIST.map((st) => (
          <button
            key={st.value}
            type="button"
            onClick={() => setOrderStatusFilter(st.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              orderStatusFilter === st.value
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* Selected Order Detail Drawer/Card */}
      {selectedAdminOrder && (
        <div className="bg-white border-2 border-zinc-900 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-bold text-zinc-900">
                  {formatOrderNumberLabel(selectedAdminOrder.orderNumber)}
                </span>
                <span className="text-xs text-zinc-400">·</span>
                <span className="text-xs font-semibold text-zinc-800">
                  {ORDER_STATUS_LABELS[selectedAdminOrder.status] || selectedAdminOrder.status}
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                    selectedAdminOrder.stockDeducted
                      ? selectedAdminOrder.status === 'NEW' ||
                        selectedAdminOrder.status === 'AWAITING_PAYMENT'
                        ? 'bg-amber-50 text-amber-900 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-stone-100 text-zinc-600 border border-stone-200'
                  }`}
                >
                  {selectedAdminOrder.stockDeducted
                    ? selectedAdminOrder.status === 'NEW' ||
                      selectedAdminOrder.status === 'AWAITING_PAYMENT'
                      ? 'Estoque reservado (Aguardando pagamento)'
                      : 'Estoque descontado (Pago)'
                    : selectedAdminOrder.status === 'CANCELLED'
                    ? 'Estoque devolvido à vitrine (Cancelado)'
                    : 'Estoque não reservado'}
                </span>
                {selectedAdminOrder.isFreeDelivery && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
                    <Truck className="w-3 h-3" />
                    <span>
                      {(selectedAdminOrder.deliveryFeeSource === 'MANUAL_FREE_DELIVERY' || selectedAdminOrder.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD')
                        ? 'Frete grátis (cortesia da loja)'
                        : 'Frete grátis'}
                    </span>
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500">
                Criado em {formatDateTime(selectedAdminOrder.createdAt)} · Cliente:{' '}
                <strong className="text-zinc-800">{selectedAdminOrder.customerName}</strong> (
                {selectedAdminOrder.customerPhone})
              </div>

              {(selectedAdminOrder.status === 'NEW' ||
                selectedAdminOrder.status === 'AWAITING_PAYMENT') && (
                <div className="pt-1">
                  <PaymentTimerBadge
                    paymentExpiresAt={selectedAdminOrder.paymentExpiresAt}
                    status={selectedAdminOrder.status}
                    paymentReleased={selectedAdminOrder.paymentReleased}
                    onExpired={onRefreshOrders}
                  />
                </div>
              )}

              {selectedAdminOrder.cancellationReason && (
                <div className="mt-1.5 text-xs text-red-700 font-medium">
                  Motivo do cancelamento: {selectedAdminOrder.cancellationReason}
                  {selectedAdminOrder.refundRequested
                    ? ' · (Cliente solicitou estorno de pedido pago)'
                    : ''}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedAdminOrder.customerWhatsappUrl && (
                <a
                  href={selectedAdminOrder.customerWhatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  <span>WhatsApp do Cliente</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setSelectedAdminOrder(null)}
                className="px-3 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 bg-stone-100 rounded-lg"
              >
                Fechar
              </button>
            </div>
          </div>

          {orderDetailsLoading && (
            <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              Carregando itens, endereço e histórico do pedido…
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Items & Freight Controls */}
            <div className="lg:col-span-7 space-y-5">
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-900">Itens do Pedido</h3>
                <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 divide-y divide-stone-200 text-xs">
                  {selectedAdminOrder.items?.map((item: any) => (
                    <div key={item.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-md bg-white border border-stone-200 overflow-hidden shrink-0">
                          <ProductImage
                            src={item.imageUrl}
                            alt={item.productName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span className="truncate">
                          <strong className="tabular-nums">{item.quantity}x</strong>{' '}
                          {item.productName}{' '}
                          <span className="text-zinc-400">
                            ({formatCurrency(item.unitPrice)})
                          </span>
                        </span>
                      </div>
                      <span className="font-semibold tabular-nums shrink-0">
                        {formatCurrency(item.subtotal)}
                      </span>
                    </div>
                  ))}

                  <div className="pt-3 space-y-1.5">
                    <div className="flex justify-between text-zinc-600">
                      <span>Forma de Pagamento</span>
                      <span className="font-semibold text-zinc-900">
                        {formatPaymentMethodDisplay(
                          selectedAdminOrder.paymentMethod,
                          selectedAdminOrder.changeFor
                        )}
                      </span>
                    </div>
                    {String(selectedAdminOrder.paymentMethod || '').toUpperCase() === 'MERCADOPAGO' && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 space-y-1.5">
                        <div className="font-bold">Pagamento Mercado Pago</div>
                        <div>
                          Situação financeira: <strong>{selectedAdminOrder.payment?.status || 'NOT_STARTED'}</strong>
                          {selectedAdminOrder.payment?.providerStatus ? ` · provedor: ${selectedAdminOrder.payment.providerStatus}` : ''}
                        </div>
                        {selectedAdminOrder.payment?.providerPaymentId && (
                          <div className="break-all font-mono text-[10px]">
                            ID da transação: {selectedAdminOrder.payment.providerPaymentId}
                          </div>
                        )}
                        {selectedAdminOrder.payment?.amount && (
                          <div>Valor consultado: {formatCurrency(selectedAdminOrder.payment.amount)}</div>
                        )}
                        <p className="text-[11px] leading-relaxed">
                          Consulta somente para leitura; aprovação financeira vem da confirmação server-side do provedor.
                        </p>
                      </div>
                    )}
                    <div className="flex justify-between text-zinc-600">
                      <span>Subtotal</span>
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(selectedAdminOrder.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>
                        Frete (
                        {selectedAdminOrder.isFreeDelivery
                          ? (selectedAdminOrder.deliveryFeeSource === 'MANUAL_FREE_DELIVERY' || selectedAdminOrder.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD')
                            ? 'Frete grátis (cortesia da loja)'
                            : 'Frete grátis'
                          : `Origem: ${selectedAdminOrder.deliveryFeeSource || 'MANUAL'}${
                              selectedAdminOrder.deliveryDistanceKm
                                ? ` · ${formatDistance(selectedAdminOrder.deliveryDistanceKm)}`
                                : ''
                            }`}
                        )
                      </span>
                      <span className="font-semibold tabular-nums">
                        {selectedAdminOrder.isFreeDelivery
                          ? 'Grátis (R$ 0,00)'
                          : selectedAdminOrder.deliveryFee !== null
                          ? formatCurrency(selectedAdminOrder.deliveryFee)
                          : 'Legado sem frete'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-zinc-900 pt-1">
                      <span>Total do Pedido</span>
                      <span className="tabular-nums">
                        {formatCurrency(selectedAdminOrder.total)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4 text-xs text-zinc-600">Distância: {selectedAdminOrder.deliveryDistanceKm ?? 'indisponível'} km · Origem: {selectedAdminOrder.deliveryFeeSource || 'histórico'}<br />Frete somente leitura. Pedidos antigos sem frete são tratados pela ação com dry-run em Configurações → Frete.</div>
            </div>

            {/* Right: Status Control, Snapshot & History */}
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-900">Alterar Status do Pedido</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {ORDER_STATUS_LIST.map((st) => {
                    const active = selectedAdminOrder.status === st.value;
                    return (
                      <button
                        key={st.value}
                        type="button"
                        onClick={() => requestStatusChange(selectedAdminOrder.id, st.value)}
                        disabled={active || orderDetailsLoading || orderActionPendingId === selectedAdminOrder.id ||
                          !ADMIN_ORDER_TRANSITIONS[selectedAdminOrder.status]?.includes(st.value) ||
                          (st.value === 'PAID' && ['CASH', 'CASH_ON_DELIVERY', 'DINHEIRO'].includes(String(selectedAdminOrder.paymentMethod || '').toUpperCase())) ||
                          (['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(st.value) &&
                            String(selectedAdminOrder.paymentMethod || '').toUpperCase() === 'MERCADOPAGO' &&
                            selectedAdminOrder.payment?.status !== 'PAID')}
                        title={st.value === 'PAID' && String(selectedAdminOrder.paymentMethod || '').toUpperCase() === 'CASH'
                          ? 'Pagamento na entrega só é confirmado ao concluir a entrega.'
                          : ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(st.value) &&
                            String(selectedAdminOrder.paymentMethod || '').toUpperCase() === 'MERCADOPAGO' &&
                            selectedAdminOrder.payment?.status !== 'PAID'
                          ? 'O pedido só pode avançar após confirmação server-side do Mercado Pago.'
                          : undefined}
                        className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                          active
                            ? 'bg-zinc-900 text-white border-zinc-900 font-semibold'
                            : 'bg-white text-zinc-700 border-stone-200 hover:bg-stone-50'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>

                {/* Botão de 1 clique para cancelar pedido aguardando pagamento devolvendo estoque (Seção 12) */}
                {(selectedAdminOrder.status === 'AWAITING_PAYMENT' ||
                  selectedAdminOrder.status === 'NEW') && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => requestStatusChange(selectedAdminOrder.id, 'CANCELLED')}
                      disabled={orderDetailsLoading || orderActionPendingId === selectedAdminOrder.id}
                      className="w-full py-2 px-3 text-xs font-semibold text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                    >
                      Cancelar pedido e devolver estoque à vitrine
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-zinc-900">
                  Endereço Snapshot (Gravado no Pedido)
                </h3>
                <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-zinc-700 space-y-1">
                  <div className="font-semibold text-zinc-900">
                    {selectedAdminOrder.addressSnapshot?.label} — CEP{' '}
                    {selectedAdminOrder.addressSnapshot?.zipCode}
                  </div>
                  <div>
                    {selectedAdminOrder.addressSnapshot?.street},{' '}
                    {selectedAdminOrder.addressSnapshot?.number}
                    {selectedAdminOrder.addressSnapshot?.complement
                      ? ` (${selectedAdminOrder.addressSnapshot.complement})`
                      : ''}
                  </div>
                  <div>
                    {selectedAdminOrder.addressSnapshot?.neighborhood} —{' '}
                    {selectedAdminOrder.addressSnapshot?.city}/
                    {selectedAdminOrder.addressSnapshot?.state}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-zinc-900">
                  Histórico de Alterações (order_status_history)
                </h3>
                <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs space-y-1.5 max-h-36 overflow-y-auto">
                  {selectedAdminOrder.history?.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between gap-2">
                      <span className="text-zinc-700">
                        {h.oldStatus
                          ? `${ORDER_STATUS_LABELS[h.oldStatus] || h.oldStatus} → `
                          : ''}
                        <strong className="text-zinc-900">
                          {ORDER_STATUS_LABELS[h.newStatus] || h.newStatus}
                        </strong>
                      </span>
                      <span className="text-[11px] text-zinc-400 tabular-nums">
                        {formatDateTime(h.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-stone-200 text-zinc-500 bg-stone-50">
              <th className="py-3 px-4 font-semibold">Pedido</th>
              <th className="py-3 px-4 font-semibold">Cliente / WhatsApp</th>
              <th className="py-3 px-4 font-semibold text-right">Subtotal</th>
              <th className="py-3 px-4 font-semibold text-right">Frete / Dist.</th>
              <th className="py-3 px-4 font-semibold text-right">Total</th>
              <th className="py-3 px-4 font-semibold">Status & Prazo ({paymentDeadlineLabel})</th>
              <th className="py-3 px-4 font-semibold">Data</th>
              <th className="py-3 px-4 font-semibold text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {ordersLoading && filteredOrders.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-zinc-500" role="status">Carregando pedidos…</td></tr>
            )}
            {!ordersLoading && ordersError && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-red-800" role="alert">
                <div>{ordersError}</div>
                <button type="button" onClick={onRefreshOrders} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-red-50">Tentar novamente</button>
              </td></tr>
            )}
            {!ordersLoading && !ordersError && filteredOrders.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-zinc-500">
                {orderSearch || orderDateFrom || orderDateTo || orderStatusFilter !== 'ALL'
                  ? 'Nenhum pedido corresponde aos filtros selecionados.'
                  : 'Ainda não há pedidos cadastrados.'}
              </td></tr>
            )}
            {filteredOrders.map((o, idx) => (
              <tr key={o.id} className="hover:bg-stone-50/70">
                <td className="py-3 px-4 font-mono font-bold text-zinc-900">
                  <div className="flex items-center gap-1.5">
                    <span>{formatOrderNumberLabel(o.orderNumber)}</span>
                    {orderSort === 'oldest' && o.status !== 'CANCELLED' && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-white font-sans text-[10px] font-bold">
                        {(Number(ordersData.page || 1) - 1) * Number(ordersData.pageSize || 25) + idx + 1}º da fila
                      </span>
                    )}
                  </div>
                  {o.isFreeDelivery && (
                    <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 font-sans text-[10px] font-semibold text-emerald-800">
                      {(o.deliveryFeeSource === 'MANUAL_FREE_DELIVERY' || o.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD')
                        ? 'Frete grátis (cortesia da loja)'
                        : 'Frete grátis'}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="font-semibold text-zinc-900">{o.customerName}</div>
                  <div className="text-[11px] text-zinc-500 tabular-nums">{o.customerPhone}</div>
                </td>
                <td className="py-3 px-4 text-right tabular-nums text-zinc-700">
                  {formatCurrency(o.subtotal)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums">
                  {o.isFreeDelivery ? (
                    <div>
                      <div className="font-semibold text-emerald-800">Grátis (R$ 0,00)</div>
                      <div className="text-[11px] font-medium text-emerald-700">
                        {(o.deliveryFeeSource === 'MANUAL_FREE_DELIVERY' || o.deliveryFeeSource === 'MANUAL_FREE_DELIVERY_PERIOD')
                          ? 'Cortesia da loja'
                          : 'Cortesia'}
                      </div>
                    </div>
                  ) : o.deliveryFee !== null ? (
                    <div>
                      <div className="font-semibold text-zinc-900">
                        {formatCurrency(o.deliveryFee)}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {formatDistance(o.deliveryDistanceKm)} ({o.deliveryFeeSource})
                      </div>
                    </div>
                  ) : (
                    <span className="font-medium text-amber-800">A combinar</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right font-bold text-zinc-900 tabular-nums">
                  <div>{formatCurrency(o.total)}</div>
                  <div className="text-[11px] font-medium text-zinc-500 font-sans">
                    {formatPaymentMethodDisplay(o.paymentMethod, o.changeFor)}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="space-y-1">
                    <span
                      className={`font-semibold block ${
                        o.status === 'CANCELLED'
                          ? 'text-red-700'
                          : o.status === 'PAID' || o.status === 'DELIVERED'
                          ? 'text-emerald-800'
                          : 'text-zinc-800'
                      }`}
                    >
                      {ORDER_STATUS_LABELS[o.status] || o.status}
                    </span>
                    {(o.status === 'NEW' || o.status === 'AWAITING_PAYMENT') && (
                      <PaymentTimerBadge
                        paymentExpiresAt={o.paymentExpiresAt}
                        status={o.status}
                        paymentReleased={o.paymentReleased}
                        onExpired={onRefreshOrders}
                        compact={true}
                      />
                    )}
                  </div>
                </td>
                <td className="py-3 px-4 text-zinc-500 tabular-nums">
                  {formatDateTime(o.createdAt)}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => onOpenOrder(o)}
                    disabled={orderDetailsLoading}
                    className="px-3 py-1.5 text-xs font-semibold text-zinc-900 bg-stone-100 hover:bg-stone-200 rounded-lg"
                  >
                    Abrir Pedido
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-zinc-500">
          {Number(ordersData.totalCount || 0) === 0
            ? '0 resultados'
            : `Mostrando ${(Number(ordersData.page || 1) - 1) * Number(ordersData.pageSize || 25) + 1}–${Math.min(Number(ordersData.page || 1) * Number(ordersData.pageSize || 25), Number(ordersData.totalCount || 0))} de ${Number(ordersData.totalCount || 0)}`}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={ordersLoading || Number(ordersData.page || 1) <= 1} onClick={() => onPageChange(Number(ordersData.page || 1) - 1)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 disabled:opacity-40">Anterior</button>
          <span className="text-xs text-zinc-600">Página {Number(ordersData.page || 1)} de {Math.max(1, Number(ordersData.totalPages || 0))}</span>
          <button type="button" disabled={ordersLoading || Number(ordersData.page || 1) >= Number(ordersData.totalPages || 0)} onClick={() => onPageChange(Number(ordersData.page || 1) + 1)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 disabled:opacity-40">Próxima</button>
        </div>
      </div>

      {cancelDialogOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <form onSubmit={confirmCancellation} role="dialog" aria-modal="true" aria-labelledby="cancel-order-title" className="w-full max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
            <div>
              <h2 id="cancel-order-title" className="text-base font-bold text-zinc-900">Confirmar cancelamento</h2>
              <p className="mt-1 text-xs text-zinc-600">O status será terminal e o estoque reservado será devolvido uma única vez. Esta ação será registrada no histórico.</p>
            </div>
            <label htmlFor="cancel-reason" className="block text-xs font-semibold text-zinc-700">Motivo do cancelamento (obrigatório)</label>
            <textarea id="cancel-reason" required minLength={5} maxLength={500} rows={3} value={cancelReason} onChange={(event) => { setCancelReason(event.target.value); setCancelReasonError(''); }} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" placeholder="Descreva brevemente o motivo" />
            <div className="flex items-center justify-between text-[11px] text-zinc-500"><span>{cancelReason.length}/500 caracteres</span>{cancelReasonError && <span role="alert" className="text-red-700">{cancelReasonError}</span>}</div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCancelDialogOpen(false)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-zinc-700">Voltar</button>
              <button type="submit" disabled={orderActionPendingId !== null} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{orderActionPendingId !== null ? 'Cancelando…' : 'Confirmar cancelamento'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
