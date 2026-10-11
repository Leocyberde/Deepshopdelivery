import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, Minus, Plus, ArrowRight, ShoppingBag, ArrowLeft, Store } from 'lucide-react';
import { useApp, isAdminRole, formatCurrency, ProductImage } from '../context/AppContext.tsx';

export const CartPage: React.FC = () => {
  const {
    cart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    cartSubtotal,
    user,
    eligibleForFirstOrderFreeDelivery,
    freeDeliveryTickets,
    apiFetch,
  } = useApp();
  const navigate = useNavigate();
  const isAdmin = isAdminRole(user?.role);
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
    <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-6">
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
            <div
              key={item.productId}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4">
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
                    Unitário: {formatCurrency(item.price)} • Máx: {item.stock} un.
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
                    onClick={() => updateCartQuantity(item.productId, item.quantity + 1)}
                    disabled={item.quantity >= item.stock}
                    className="p-1.5 text-zinc-700 hover:text-zinc-900 disabled:opacity-40"
                    aria-label="Aumentar"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="w-24 text-right text-sm font-semibold text-zinc-900 tabular-nums">
                  {formatCurrency(item.price * item.quantity)}
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
          ))}
        </div>

        {/* Summary Box */}
        <div className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-bold text-zinc-900">Resumo do Pedido</h2>

          {!isAdmin && eligibleForFirstOrderFreeDelivery && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <div className="font-bold text-emerald-950">
                🎉 Entrega Grátis para o seu 1º Pedido!
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                Seu 1º pedido tem entrega grátis garantida! O 2º e 3º pedidos têm frete normal e, no 4º pedido, você ganha mais 1 Ticket de Entrega Grátis!
              </p>
            </div>
          )}

          {!isAdmin && !eligibleForFirstOrderFreeDelivery && freeDeliveryTickets > 0 && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <div className="font-bold text-emerald-950">
                🎟️ Você tem {freeDeliveryTickets} Ticket(s) de Entrega Grátis!
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                Você pode usar seu ticket acumulativo agora mesmo na tela de checkout.
              </p>
            </div>
          )}

          <div className="space-y-2.5 text-sm border-b border-stone-200 pb-4">
            <div className="flex items-center justify-between text-zinc-600">
              <span>Subtotal dos produtos</span>
              <span className="font-semibold text-zinc-900 tabular-nums">
                {formatCurrency(cartSubtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Entrega</span>
              {!isAdmin && eligibleForFirstOrderFreeDelivery ? (
                <span className="font-semibold text-emerald-700">
                  Entrega grátis para o 1º pedido
                </span>
              ) : !isAdmin && freeDeliveryTickets > 0 ? (
                <span className="font-semibold text-emerald-700">
                  Ticket de Entrega Grátis disponível ({freeDeliveryTickets})
                </span>
              ) : (
                <span>Definida pelo endereço no checkout</span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-base font-bold text-zinc-900">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(cartSubtotal)}</span>
          </div>

          <button
            type="button"
            disabled={storeClosed}
            onClick={() => navigate(user ? '/checkout' : '/login?redirect=/checkout')}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <span>{storeClosed ? 'Checkout indisponível — loja fechada' : user ? 'Avançar para o Checkout' : 'Entrar para Finalizar Pedido'}</span>
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
