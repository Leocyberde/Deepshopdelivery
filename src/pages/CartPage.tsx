import { useFreightQuote, FreightQuoteSummary } from '../components/FreightQuoteSummary.tsx';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, Minus, Plus, ArrowRight, ShoppingBag, ArrowLeft, Store } from 'lucide-react';
import { useApp, formatCurrency, calculatePromoLinePricing, ProductImage } from '../context/AppContext.tsx';
import { FulfillmentSummary } from '../components/FulfillmentSummary.tsx';

export const CartPage: React.FC = () => {
  const {
    cart,
    updateCartQuantity,
    toggleCartItemSelected,
    removeFromCart,
    clearCart,
    cartSubtotal,
    user,
    apiFetch,
    toast,
  } = useApp();
  const navigate = useNavigate();
  const selectedCount = cart.filter((item) => item.selected !== false).length;
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState<number | null>(null);
  const { quote, loading: quoteLoading, error: quoteError, refresh } = useFreightQuote(cart.filter((item) => item.selected !== false), addressId);
  useEffect(() => { if (user) apiFetch<any[]>('/api/addresses').then((rows) => { setAddresses(rows); setAddressId(rows.find((row) => row.isPrimary)?.id || rows[0]?.id || null); }).catch(() => {}); }, [user?.id, apiFetch]);
  const [storeClosed, setStoreClosed] = useState(false);
  const [storeClosedMessage, setStoreClosedMessage] = useState('A loja está fechada no momento.');

  useEffect(() => {
    apiFetch('/api/storefront').then((data) => {
      setStoreClosed(!Boolean(data?.settings?.store?.isOpen));
      setStoreClosedMessage(data?.settings?.store?.closedMessage || 'A loja está fechada no momento.');
    }).catch(() => {});
  }, [apiFetch]);

  if (cart.length === 0) {
    return (
      <main className="max-w-[900px] mx-auto px-4 sm:px-6 py-16 text-center space-y-5">
        <div className="w-12 h-12 rounded-full bg-stone-200/70 flex items-center justify-center mx-auto">
          <ShoppingBag className="w-6 h-6 text-zinc-600" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-zinc-900">Sua sacola está vazia</h1>
          <p className="text-sm text-zinc-600">
            Explore a vitrine da DeepShop e adicione seus produtos favoritos.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-zinc-700 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar</span>
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <span>Ir para a Vitrine</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 pb-28 lg:pb-8 space-y-6">
      {storeClosed && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950">
          <div className="font-bold text-sm">Loja fechada no momento</div>
          <p className="text-xs mt-1">{storeClosedMessage}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar à tela anterior</span>
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
        >
          <Store className="w-3.5 h-3.5" />
          <span>Continuar na Vitrine</span>
        </Link>
      </div>

      <div className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Carrinho de Compras</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            O estoque e os preços reais são revalidados automaticamente no checkout.
          </p>
        </div>
        <button
          type="button"
          onClick={clearCart}
          className="text-xs font-medium text-zinc-500 hover:text-red-700 transition-colors"
        >
          Esvaziar sacola
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Itemized List */}
        <div className="lg:col-span-8 bg-white border border-stone-200 rounded-xl divide-y divide-stone-200">
          {cart.map((item) => (
            (() => {
              const pricing = calculatePromoLinePricing({
                normalPrice: item.originalPrice ?? item.price,
                promoPrice: item.promoPrice ?? item.price,
                hasPromo: item.hasPromo,
                promoMaxUnits: item.promoMaxUnits,
                quantity: item.quantity,
              });
              return (
            <div
              key={item.productId}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <input type="checkbox" aria-label={`Selecionar ${item.name}`} checked={item.selected !== false} onChange={(e) => toggleCartItemSelected(item.productId, e.target.checked)} className="h-4 w-4 accent-zinc-900" />
                <Link
                  to={`/produto/${item.productId}`}
                  className="w-20 h-16 rounded-lg overflow-hidden bg-[#F9F9F8] border border-stone-200 shrink-0"
                >
                  <ProductImage src={item.imageUrl} alt={item.name} />
                </Link>
                <div className="space-y-1">
                  <Link
                    to={`/produto/${item.productId}`}
                    className="text-sm font-semibold text-zinc-900 hover:underline"
                  >
                    {item.name}
                  </Link>
                  <div className="text-xs text-zinc-500 tabular-nums">
                  Unitário: {formatCurrency(pricing.hasPromo ? pricing.promoUnitPrice : pricing.normalUnitPrice)} • Limite por item: 20 unidades
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4">
                <div className="inline-flex items-center border border-stone-300 rounded-lg bg-stone-50">
                  <button
                    type="button"
                    onClick={() => updateCartQuantity(item.productId, item.quantity - 1)}
                    className="p-1.5 text-zinc-700 hover:text-zinc-900"
                    aria-label="Diminuir"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-3 text-xs font-semibold text-zinc-900 tabular-nums">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (pricing.hasLimit && item.promoMaxUnits && item.quantity === item.promoMaxUnits) {
                        toast(`Atenção: a oferta vale só para ${item.promoMaxUnits} un. A partir da unidade ${item.promoMaxUnits + 1}, o valor é normal (${formatCurrency(pricing.normalUnitPrice)}).`, 'info');
                      }
                      updateCartQuantity(item.productId, item.quantity + 1);
                    }}
                    disabled={item.quantity >= 20}
                    className="p-1.5 text-zinc-700 hover:text-zinc-900 disabled:opacity-40"
                    aria-label="Aumentar"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="w-40 text-right text-sm font-semibold text-zinc-900 tabular-nums">
                  {pricing.hasLimit && pricing.normalQty > 0 ? (
                    <div className="space-y-1 text-xs">
                      <div>{pricing.promoQty} un. em oferta × {formatCurrency(pricing.promoUnitPrice)} = {formatCurrency(pricing.promoSubtotal)}</div>
                      <div>{pricing.normalQty} un. preço normal × {formatCurrency(pricing.normalUnitPrice)} = {formatCurrency(pricing.normalSubtotal)}</div>
                      <div className="font-bold">Total {formatCurrency(pricing.subtotal)}</div>
                      <div className="text-[10px] font-medium text-amber-800">Oferta limitada a {pricing.promoMaxUnits} un. por pedido — as demais saem pelo preço normal.</div>
                    </div>
                  ) : formatCurrency(pricing.subtotal)}
                </div>

                <button
                  type="button"
                  onClick={() => removeFromCart(item.productId)}
                  className="p-1.5 text-zinc-400 hover:text-red-600 transition-colors"
                  aria-label="Remover item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
              );
            })()
          ))}
          <div className="p-4 sm:p-5">
            <FulfillmentSummary items={cart.filter((i) => i.selected !== false)} />
          </div>
        </div>

        {/* Summary Box */}
        <div className="block lg:col-span-4 bg-white border border-stone-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-bold text-zinc-900">Resumo do Pedido</h2>

          <div className="space-y-2.5 text-sm border-b border-stone-200 pb-4">
            <div className="flex items-center justify-between text-zinc-600">
              <span>Subtotal dos produtos</span>
              <span className="font-semibold text-zinc-900 tabular-nums">
                {formatCurrency(quote?.totals.subtotal ?? cartSubtotal)}
              </span>
            </div>
            {user && <label className="block text-xs">Endereço para cotação<select aria-label="Endereço para cotação" value={addressId || ''} onChange={(e) => setAddressId(Number(e.target.value) || null)} className="mt-1 w-full rounded-lg border p-2"><option value="">Selecione um endereço</option>{addresses.map((address) => <option key={address.id} value={address.id}>{address.label} — {address.street}, {address.number} — {address.neighborhood}, {address.city}/{address.state}</option>)}</select></label>}
            <FreightQuoteSummary quote={quote} loading={quoteLoading} error={quoteError} onRetry={async () => { if (addressId) { try { await apiFetch(`/api/addresses/${addressId}/recalculate`, { method: 'POST' }); } catch (error: any) { toast(error.message, 'error'); } } refresh(); }} />
          </div>

          <div className="flex items-center justify-between text-base font-bold text-zinc-900">
            <span>{quote?.freight?.status === 'OK' ? 'Total' : 'Subtotal'}</span>
            <span className="tabular-nums">{formatCurrency(quote?.totals.total ?? cartSubtotal)}</span>
          </div>

          <button
            type="button"
            disabled={storeClosed || selectedCount === 0}
            onClick={() => navigate(user ? '/checkout' : '/login?redirect=/checkout')}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <span>{storeClosed ? 'Checkout indisponível — loja fechada' : selectedCount === 0 ? 'Selecione ao menos um item' : user ? 'Comprar agora' : 'Entrar para comprar'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <Link
            to="/"
            className="block text-center text-xs font-medium text-zinc-600 hover:text-zinc-900"
          >
            Continuar comprando
          </Link>
        </div>
      </div>
    </main>
  );
};
