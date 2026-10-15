export type ProfitCostMode = 'unit' | 'lot';

export interface ProfitSimulationInput {
  normalPrice: string | number;
  promoPrice?: string | number | null;
  hasPromo?: boolean;
  cost: string | number | null | undefined;
  costMode?: ProfitCostMode;
  lotUnits?: string | number | null;
  stock: string | number;
  promoMaxUnits?: string | number | null;
}

export interface ProfitScenario {
  salePrice: number;
  unitCost: number;
  unitProfit: number;
  marginPercent: number;
  markupPercent: number;
  stockRevenue: number;
  stockCost: number;
  stockProfit: number;
  stockUnits: number;
}

export interface ProfitSimulationResult {
  hasCost: boolean;
  hasPromo: boolean;
  costUnitPrecise: number;
  costUnitDisplay: number;
  costLotTotal: number | null;
  costLotUnits: number | null;
  normal: ProfitScenario;
  promo: ProfitScenario | null;
  promoMaxUnits: number | null;
}

function numberFrom(value: string | number | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function currency(centsValue: number): number {
  return centsValue / 100;
}

/** Custo médio ponderado arredondado apenas à precisão persistida (6 casas). */
export function calculateWeightedAverageUnitCost(
  stockBefore: number,
  unitCostBefore: number,
  stockAdded: number,
  incomingUnitCost: number,
): number {
  const totalUnits = stockBefore + stockAdded;
  if (totalUnits <= 0) return 0;
  const average = stockBefore > 0
    ? (stockBefore * unitCostBefore + stockAdded * incomingUnitCost) / totalUnits
    : incomingUnitCost;
  return Math.round((average + Number.EPSILON * Math.abs(average)) * 1_000_000) / 1_000_000;
}

function scenario(salePrice: number, unitCost: number, stock: number, lotTotalCents: number | null): ProfitScenario {
  const saleCents = cents(salePrice);
  const unitProfitMicros = Math.round((salePrice - unitCost) * 1_000_000);
  const profitCents = Math.round(unitProfitMicros * stock / 10_000);
  const revenueCents = saleCents * stock;
  const costCents = stock === 0 ? 0 : lotTotalCents !== null ? lotTotalCents : Math.round(unitCost * stock * 100);
  const stockProfitCents = revenueCents - costCents;
  const unitProfit = unitProfitMicros / 1_000_000;
  return {
    salePrice: currency(saleCents),
    unitCost,
    unitProfit: currency(Math.round(unitProfit * 100)),
    marginPercent: salePrice > 0 ? Number(((unitProfit / salePrice) * 100).toFixed(1)) : 0,
    markupPercent: unitCost > 0 ? Number(((unitProfit / unitCost) * 100).toFixed(1)) : 0,
    stockRevenue: currency(revenueCents),
    stockCost: currency(costCents),
    stockProfit: currency(profitCents),
    stockUnits: stock,
  };
}

/** Calcula dois cenários de venda total do estoque; não mascara prejuízos. */
export function simulateProfit(input: ProfitSimulationInput): ProfitSimulationResult {
  const stock = Math.max(0, Math.floor(numberFrom(input.stock)));
  const rawCost = Math.max(0, numberFrom(input.cost));
  const lotUnitsRaw = Math.floor(numberFrom(input.lotUnits));
  const isLot = input.costMode === 'lot';
  const lotUnits = isLot && lotUnitsRaw > 0 ? lotUnitsRaw : null;
  const costUnitPrecise = isLot && lotUnits ? rawCost / lotUnits : rawCost;
  const costUnit = Math.round(costUnitPrecise * 1_000_000) / 1_000_000;
  const hasCost = rawCost > 0 && (!isLot || Boolean(lotUnits));
  const lotTotalCents = isLot && lotUnits === stock && stock > 0 ? cents(rawCost) : null;
  const normalPrice = Math.max(0, numberFrom(input.normalPrice));
  const promoPrice = Math.max(0, numberFrom(input.promoPrice));
  const hasPromo = Boolean(input.hasPromo && promoPrice > 0 && promoPrice < normalPrice);
  const limit = Math.floor(numberFrom(input.promoMaxUnits));

  return {
    hasCost,
    hasPromo,
    costUnitPrecise: costUnit,
    costUnitDisplay: currency(cents(costUnit)),
    costLotTotal: isLot ? rawCost : null,
    costLotUnits: lotUnits,
    normal: scenario(normalPrice, costUnit, stock, hasCost ? lotTotalCents : null),
    promo: hasPromo ? scenario(promoPrice, costUnit, stock, hasCost ? lotTotalCents : null) : null,
    promoMaxUnits: hasPromo && limit > 0 ? limit : null,
  };
}
