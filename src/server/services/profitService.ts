import { simulateProfit } from '../../utils/profitSimulation.ts';

export function calculateStockProfitScenarios(product: {
  price: string | number;
  promoPrice?: string | number | null;
  promoActive?: boolean;
  promoMaxUnits?: string | number | null;
  cost?: string | number | null;
  costUnitPrecise?: string | number | null;
  stock: string | number;
}) {
  const result = simulateProfit({
    normalPrice: product.price,
    promoPrice: product.promoPrice,
    hasPromo: product.promoActive,
    promoMaxUnits: product.promoMaxUnits,
    cost: product.costUnitPrecise ?? product.cost,
    stock: product.stock,
  });
  return {
    hasCost: result.hasCost,
    normalStockProfit: result.hasCost ? result.normal.stockProfit : null,
    promoStockProfit: result.hasCost && result.promo ? result.promo.stockProfit : null,
    normalStockRevenue: result.normal.stockRevenue,
    promoStockRevenue: result.promo?.stockRevenue ?? null,
  };
}
