import React, { useEffect, useState } from 'react';
import { useApp, formatCurrency } from '../context/AppContext.tsx';
import type { CartItem } from '../types/app.ts';
import type { OrderFreightResult } from '../services/freightService.ts';
export interface FreightQuote { freight: OrderFreightResult | null; totals: { subtotal: number; total: number; deliveryFee: number }; quoteToken?: string }
export function useFreightQuote(items: CartItem[], addressId?: number | null) {
  const { apiFetch, user } = useApp();
  const [quote, setQuote] = useState<FreightQuote | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(items.map((item) => ({ productId: item.productId, quantity: item.quantity, receiveAllAsPreorder: Boolean(item.receiveAllAsPreorder) })));
  useEffect(() => {
    let cancelled = false;
    setQuote(null); setError('');
    if (!user || !items.length) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch<FreightQuote>('/api/cart/quote', { method: 'POST', body: JSON.stringify({ items: JSON.parse(key), ...(addressId ? { addressId } : {}) }) })
        .then((result) => { if (!cancelled) setQuote(result); })
        .catch((e) => { if (!cancelled) setError(e.message || 'Erro ao cotar o frete.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, addressId, revision, user?.id, apiFetch]);
  return { quote, error, loading, refresh: () => setRevision((value) => value + 1) };
}
export const FreightQuoteSummary: React.FC<{ quote: FreightQuote | null; error?: string; loading?: boolean; onRetry?: () => void }> = ({ quote, error, loading, onRetry }) => {
  const freight = quote?.freight;
  if (loading) return <p className="text-xs text-zinc-500">Calculando cotação…</p>;
  if (error || (freight && freight.status !== 'OK')) return <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><p>{error || freight?.message || 'Não conseguimos calcular o frete agora'}</p>{onRetry && freight?.status !== 'OUT_OF_DELIVERY_AREA' && <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">Tentar novamente</button>}</div>;
  if (!freight) return <p className="text-xs text-zinc-500">Selecione um endereço para consultar o frete.</p>;
  return <div className="space-y-2 text-xs" data-testid="freight-summary">
    <div className="flex justify-between"><span>Frete normal ({freight.distanceKm?.toFixed(2)} km)</span><span>{formatCurrency(freight.normalFee!)}</span></div>
    <div className="flex justify-between font-semibold"><span>{freight.source === 'MANUAL_FREE_DELIVERY_PERIOD' ? 'Frete grátis (benefício da loja)' : freight.finalFee === 0 ? 'Frete grátis' : 'Frete'}</span><span>{formatCurrency(freight.finalFee!)}</span></div>
    {!!freight.missingAmount && <p className="rounded-lg bg-emerald-50 p-2 text-emerald-900">Faltam {formatCurrency(freight.missingAmount)} para frete grátis</p>}
  </div>;
};
