import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingBag, Minus, Plus, Share2, Copy } from 'lucide-react';
import {
  useApp,
  isAdminRole,
  formatCurrency,
  calculateDiscountPercent,
  calculatePromoLinePricing,
  buildProductShareWhatsAppUrl,
  ProductMediaCarousel,
  ProductMediaItem,
  ExpandableDescription,
  PromoCountdown,
} from '../context/AppContext.tsx';

interface KitComponentInfo {
  id: number;
  componentProductId: number;
  componentCode: string;
  componentName: string;
  quantityPerKit: number;
}

interface ProductDetail {
  id: number;
  categoryId: number;
  categoryName: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  promoPrice: string | null;
  promoActive: boolean;
  promoEndsAt?: string | null;
  promoDurationHours?: number | null;
  promoMaxUnits?: number | null;
  hasPromo: boolean;
  effectivePrice: string;
  discountPercent?: number;
  isKit: boolean;
  kitComponents?: KitComponentInfo[];
  stock: number;
  weight: string;
  status: string;
  imageUrl: string | null;
  images?: ProductMediaItem[];
  viewsCount?: number;
  clicksCount?: number;
  sharesCount?: number;
}

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    apiFetch,
    addToCart,
    toast,
    user,
    freeDeliveryTickets,
    eligibleForFirstOrderFreeDelivery,
    setEligibleForFirstOrderFreeDelivery,
  } = useApp();
  const isAdmin = isAdminRole(user?.role);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    apiFetch<ProductDetail & { eligibleForFirstOrderFreeDelivery?: boolean }>(`/api/products/${id}`)
      .then((data) => {
        if (!mounted) return;
        setProduct(data);
        setQuantity(1);
        if (isAdminRole(user?.role)) {
          setEligibleForFirstOrderFreeDelivery(false);
        } else if (typeof data.eligibleForFirstOrderFreeDelivery === 'boolean') {
          setEligibleForFirstOrderFreeDelivery(data.eligibleForFirstOrderFreeDelivery);
        }
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err.message || 'Produto não encontrado.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id, apiFetch, setEligibleForFirstOrderFreeDelivery, user?.role]);

  if (loading) {
    return (
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 animate-pulse">
          <div className="md:col-span-6 aspect-4/3 bg-stone-200 rounded-xl" />
          <div className="md:col-span-6 space-y-4">
            <div className="h-4 w-32 bg-stone-200 rounded" />
            <div className="h-8 w-3/4 bg-stone-200 rounded" />
            <div className="h-6 w-28 bg-stone-200 rounded" />
            <div className="h-24 w-full bg-stone-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-zinc-900">Produto Indisponível</h1>
        <p className="text-sm text-zinc-600">{error || 'Este produto não está disponível.'}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 rounded-lg hover:bg-zinc-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para a Vitrine</span>
        </Link>
      </div>
    );
  }

  const outOfStock = product.stock <= 0;
  const lowStock = product.stock > 0 && product.stock <= 5;
  const fullTitle = product.code ? `${product.code} - ${product.name}` : product.name;
  const discountPct =
    product.discountPercent ??
    calculateDiscountPercent(product.price, product.promoPrice, product.hasPromo);

  const linePricing = calculatePromoLinePricing({
    normalPrice: product.price,
    promoPrice: product.promoPrice,
    hasPromo: product.hasPromo,
    promoMaxUnits: product.promoMaxUnits,
    quantity,
  });

  const handleAdd = (goToCheckout = false) => {
    if (outOfStock) return;
    apiFetch(`/api/products/${product.id}/interaction`, {
      method: 'POST',
      body: JSON.stringify({ action: 'CLICK' }),
    }).catch(() => {});
    addToCart(
      {
        productId: product.id,
        name: fullTitle,
        price: parseFloat(product.effectivePrice || product.price),
        originalPrice: parseFloat(product.price),
        promoPrice: product.promoPrice ? parseFloat(product.promoPrice) : null,
        hasPromo: Boolean(product.hasPromo),
        promoMaxUnits: product.promoMaxUnits ?? null,
        imageUrl: product.imageUrl,
        categoryName: product.categoryName,
        stock: product.stock,
      },
      quantity
    );
    if (goToCheckout) {
      navigate('/carrinho');
    }
  };

  return (
    <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-6">
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
          <span>Ir para a Vitrine</span>
        </Link>
      </div>

      {/* Contiguous Purchase Module (PDP) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left: Product Media Carousel (Up to 5 Photos and/or 1 Video + Top-Right % Badge) */}
        <div className="md:col-span-6 bg-[#F9F9F8] border border-stone-200 rounded-xl overflow-hidden">
          <ProductMediaCarousel
            images={product.images}
            fallbackImageUrl={product.imageUrl}
            alt={fullTitle}
            discountPercent={discountPct}
            aspectClassName="aspect-4/3"
          />
        </div>

        {/* Right: Contiguous Purchase Module */}
        <div className="md:col-span-6 bg-white border border-stone-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span className="font-mono font-bold text-zinc-800">Cód. {product.code}</span>
              <span aria-hidden="true">·</span>
              <span>{product.categoryName}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {outOfStock ? 'Sem estoque' : `${product.stock} unidades disponíveis`}
              </span>
              {parseFloat(product.weight || '0') > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {Number(product.weight).toFixed(3).replace('.', ',')} kg
                  </span>
                </>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">
              <span className="font-mono text-zinc-800">{product.code}</span> - {product.name}
            </h1>

            <div className="pt-1">
              {product.hasPromo && product.promoPrice ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-sm text-zinc-400 line-through tabular-nums">
                      De {formatCurrency(product.price)}
                    </div>
                    <div className="text-2xl font-bold text-emerald-700 tabular-nums">
                      Por {formatCurrency(product.promoPrice)}
                    </div>
                  </div>
                  {product.promoEndsAt && <PromoCountdown promoEndsAt={product.promoEndsAt} />}
                  {product.promoMaxUnits && product.promoMaxUnits > 0 && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-medium text-amber-950 leading-snug">
                      Só é permitido comprar{' '}
                      <strong>
                        {product.promoMaxUnits} {product.promoMaxUnits === 1 ? 'item' : 'itens'}
                      </strong>{' '}
                      na promoção, acima segue o valor normal do produto (
                      <strong>{formatCurrency(product.price)}</strong>).
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-2xl font-bold text-zinc-900 tabular-nums">
                  {formatCurrency(product.price)}
                </span>
              )}
            </div>
          </div>

          {product.isKit && product.kitComponents && product.kitComponents.length > 0 && (
            <div className="border-t border-stone-100 pt-4 space-y-2">
              <h2 className="text-xs font-semibold text-zinc-800">Itens inclusos neste Kit:</h2>
              <ul className="space-y-1 text-xs text-zinc-600">
                {product.kitComponents.map((comp) => (
                  <li key={comp.id} className="flex items-center gap-2">
                    <span className="font-mono font-bold text-zinc-900">
                      {comp.quantityPerKit}x
                    </span>
                    <span>
                      {comp.componentCode ? `${comp.componentCode} - ` : ''}
                      {comp.componentName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {product.description && (
            <div className="border-t border-stone-200 pt-5 space-y-2">
              <h2 className="text-sm font-bold text-zinc-900">Descrição do Produto</h2>
              <div className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line bg-stone-50 p-4 rounded-xl border border-stone-200">
                {product.description}
              </div>
            </div>
          )}

          <div className="border-t border-stone-100 pt-5 space-y-4">
            {outOfStock ? (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
                Produto com estoque esgotado no momento. Não é possível realizar a compra deste item.
              </div>
            ) : (
              <>
                {lowStock && <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900">Últimas unidades disponíveis: apenas {product.stock} em estoque.</div>}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-700">Quantidade</span>
                  <div className="inline-flex items-center border border-stone-300 rounded-lg bg-stone-50">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="p-2 text-zinc-700 hover:text-zinc-900 disabled:opacity-40"
                      disabled={quantity <= 1}
                      aria-label="Diminuir quantidade"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-4 text-sm font-semibold text-zinc-900 tabular-nums">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
                      className="p-2 text-zinc-700 hover:text-zinc-900 disabled:opacity-40"
                      disabled={quantity >= product.stock}
                      aria-label="Aumentar quantidade"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {linePricing.hasLimitExceeded && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1">
                    <div className="font-bold">
                      Cálculo com limite da promoção ({linePricing.promoMaxUnits}{' '}
                      {linePricing.promoMaxUnits === 1 ? 'item' : 'itens'}):
                    </div>
                    <div className="tabular-nums">
                      • <strong>{linePricing.promoQty}x</strong> na promoção por{' '}
                      {formatCurrency(linePricing.promoUnitPrice)} ={' '}
                      <strong>{formatCurrency(linePricing.promoSubtotal)}</strong>
                    </div>
                    <div className="tabular-nums">
                      • <strong>{linePricing.normalQty}x</strong> no valor normal por{' '}
                      {formatCurrency(linePricing.normalUnitPrice)} ={' '}
                      <strong>{formatCurrency(linePricing.normalSubtotal)}</strong>
                    </div>
                    <div className="pt-1 border-t border-amber-200/80 font-bold text-zinc-900 tabular-nums">
                      Total para {quantity} un.: {formatCurrency(linePricing.subtotal)}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAdd(false)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-zinc-900 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>Adicionar à Sacola</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleAdd(true)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>Comprar Agora</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="border-t border-stone-100 pt-4 space-y-3">
            {/* Indicador de Visualizações e Prova Social */}
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 text-zinc-700 text-[11px] font-medium">
                <span>👁️</span>
                <span>{product.viewsCount || 1} pessoas já viram este produto</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={buildProductShareWhatsAppUrl({
                  id: product.id,
                  code: product.code,
                  name: product.name,
                  price: product.price,
                  promoPrice: product.promoPrice,
                  hasPromo: product.hasPromo,
                })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  apiFetch(`/api/products/${product.id}/interaction`, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'SHARE' }),
                  }).catch(() => {});
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>Compartilhar Oferta no WhatsApp</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  const link = `${window.location.origin}/produto/${product.id}`;
                  navigator.clipboard.writeText(link);
                  toast('Link do produto copiado!', 'success');
                  apiFetch(`/api/products/${product.id}/interaction`, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'SHARE' }),
                  }).catch(() => {});
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-700 bg-white hover:bg-stone-100 border border-stone-300 rounded-lg transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Link</span>
              </button>
            </div>

            <div className="text-xs text-zinc-500 space-y-1.5">
              {!isAdmin && eligibleForFirstOrderFreeDelivery && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
                🎉 Você tem direito a Entrega Grátis no seu 1º Pedido! (2º e 3º pagos e no 4º ganha Entrega Grátis novamente)
              </div>
            )}
            {!isAdmin && !eligibleForFirstOrderFreeDelivery && freeDeliveryTickets > 0 && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
                🎟️ Você tem {freeDeliveryTickets} Ticket(s) de Entrega Grátis disponível(is) para usar no checkout!
              </div>
            )}
              <p>• Pagamento via Pix, Cartão ou Dinheiro na entrega.</p>
              <p>• Frete conforme endereço cadastrado ou combinado pelo WhatsApp da loja.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};
