import React, { useEffect, useState } from 'react';
import { PackageCheck, Truck } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import type { CartItem } from '../types/app.ts';

interface QuoteLine {
  productId: number;
  variantId?: number | null;
  quantity: number;
  deliveryQty: number;
  preorderQty: number;
}

interface QuoteResponse {
  lines: QuoteLine[];
  promises?: { deliveryPromise: string | null; preorderWindow: string };
}

/**
 * Mostra ao cliente como o pedido será dividido: parte Delivery (em estoque) e parte Encomenda,
 * com os prazos calculados pelo servidor. Um pedido, um pagamento, frete uma vez.
 * O estoque nunca é exibido; só a divisão da quantidade pedida.
 */
export const FulfillmentSummary: React.FC<{ items: CartItem[] }> = ({ items }) => {
  const { apiFetch, user, setCartItemPreorder } = useApp();
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const key = items.map((i) => `${i.productId}:${i.variantId ?? 'base'}:${i.quantity}:${i.receiveAllAsPreorder ? 1 : 0}`).join('|');

  useEffect(() => {
    if (!user || items.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<QuoteResponse>('/api/cart/quote', {
          method: 'POST',
          body: JSON.stringify({
            items: items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
              receiveAllAsPreorder: Boolean(i.receiveAllAsPreorder),
            })),
          }),
        });
        if (!cancelled) setQuote(res);
      } catch {
        if (!cancelled) setQuote(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, user?.id]);

  if (!quote || !Array.isArray(quote.lines) || quote.lines.length === 0) return null;

  // Cada modelo (variação) é uma linha própria: mostra o nome do produto com o modelo escolhido.
  const sameLine = (i: CartItem, l: QuoteLine) => i.productId === l.productId && (i.variantId ?? null) === (l.variantId ?? null);
  const itemOf = (l: QuoteLine) => items.find((i) => sameLine(i, l));
  const nameOf = (l: QuoteLine) => itemOf(l)?.name || 'Produto';
  const lineKey = (l: QuoteLine) => `${l.productId}-${l.variantId ?? 'base'}`;
  const deliveryLines = quote.lines.filter((l) => l.deliveryQty > 0);
  const preorderLines = quote.lines.filter((l) => l.preorderQty > 0);
  const hasMixed = deliveryLines.length > 0 && preorderLines.length > 0;
  const togglable = quote.lines.filter((l) => l.deliveryQty > 0 || items.find((i) => i.productId === l.productId)?.receiveAllAsPreorder);

  return (
    <div className="space-y-3 text-sm">
      {deliveryLines.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="flex items-center gap-2 font-semibold text-emerald-800">
            <Truck className="w-4 h-4" />
            <span>Delivery{quote.promises?.deliveryPromise ? ` — ${quote.promises.deliveryPromise}` : ''}</span>
          </div>
          <ul className="mt-1 text-zinc-700">
            {deliveryLines.map((l) => (
              <li key={`d-${lineKey(l)}`}>{l.deliveryQty}x {nameOf(l)}</li>
            ))}
          </ul>
        </div>
      )}
      {preorderLines.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <PackageCheck className="w-4 h-4" />
            <span>{quote.promises?.preorderWindow ? `Chegará em ${quote.promises.preorderWindow}` : 'Encomenda'}</span>
          </div>
          <ul className="mt-1 text-zinc-700">
            {preorderLines.map((l) => (
              <li key={`p-${lineKey(l)}`}>{l.preorderQty}x {nameOf(l)}</li>
            ))}
          </ul>
        </div>
      )}
      {hasMixed && (
        <p className="text-xs text-zinc-500">Um único pedido e um único pagamento. O frete é cobrado uma só vez.</p>
      )}
      {togglable.map((l) => {
        const checked = Boolean(itemOf(l)?.receiveAllAsPreorder);
        return (
          <label key={`t-${lineKey(l)}`} className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={checked}
              onChange={(e) => setCartItemPreorder(l.productId, e.target.checked, l.variantId ?? undefined)}
            />
            <span>Receber tudo como encomenda: {nameOf(l)}</span>
          </label>
        );
      })}
    </div>
  );
};
