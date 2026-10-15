import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeightedAverageUnitCost, simulateProfit } from '../src/utils/profitSimulation.ts';
import { calculatePromoLinePricing } from '../src/utils/formatters.ts';

test('custo por lote preserva precisão e calcula o lucro líquido com total original', () => {
  const result = simulateProfit({ normalPrice: 8.9, promoPrice: 7.49, hasPromo: true, cost: 19.99, costMode: 'lot', lotUnits: 12, stock: 12 });
  assert.equal(result.costUnitDisplay, 1.67);
  assert.equal(result.normal.unitProfit, 7.23);
  assert.equal(result.normal.marginPercent, 81.3);
  assert.equal(result.normal.stockProfit, 86.81);
  assert.equal(result.promo?.unitProfit, 5.82);
  assert.equal(result.promo?.marginPercent, 77.8);
  assert.equal(result.promo?.stockProfit, 69.89);
});

test('prejuízo por unidade não é limitado a zero', () => {
  const result = simulateProfit({ normalPrice: 7.49, cost: 19.99, stock: 10 });
  assert.equal(result.normal.unitProfit, -12.5);
  assert.equal(result.normal.stockProfit, -125);
});

test('cenário sem promoção exibe apenas lucro normal', () => {
  const result = simulateProfit({ normalPrice: 10, cost: 5, stock: 10 });
  assert.equal(result.normal.unitProfit, 5);
  assert.equal(result.normal.marginPercent, 50);
  assert.equal(result.normal.stockProfit, 50);
  assert.equal(result.promo, null);
});

test('simula cenários distintos mesmo quando a oferta dá prejuízo', () => {
  const result = simulateProfit({ normalPrice: 19.99, promoPrice: 7.49, hasPromo: true, cost: 5, stock: 10, promoMaxUnits: 1 });
  assert.equal(result.normal.stockProfit, 149.9);
  assert.equal(result.promo?.stockProfit, 24.9);
  assert.equal(result.promoMaxUnits, 1);
});

test('promoção limitada divide 3 unidades em uma promocional e duas normais', () => {
  const result = calculatePromoLinePricing({ normalPrice: 19.99, promoPrice: 7.49, hasPromo: true, promoMaxUnits: 1, quantity: 3 });
  assert.equal(result.promoSubtotal, 7.49);
  assert.equal(result.normalSubtotal, 39.98);
  assert.equal(result.subtotal, 47.47);
});

test('entrada de novo lote calcula custo médio ponderado com precisão e lucro total esperado', () => {
  const average = calculateWeightedAverageUnitCost(12, 1.665833, 12, 2);
  assert.equal(average, 1.832917);
  const result = simulateProfit({ normalPrice: 8.9, promoPrice: 7.49, hasPromo: true, cost: average, stock: 24 });
  assert.equal(result.normal.stockCost, 43.99);
  assert.equal(result.normal.stockProfit, 169.61);
  assert.equal(result.promo?.stockProfit, 135.77);
});

test('promoção com preço igual/superior ao normal é ignorada', () => {
  for (const invalidPromo of [19.99, 20]) {
    const result = calculatePromoLinePricing({ normalPrice: 19.99, promoPrice: invalidPromo, hasPromo: true, promoMaxUnits: 1, quantity: 3 });
    assert.equal(result.hasPromo, false);
    assert.equal(result.subtotal, 59.97);
  }
});

test('arredonda promoções com limite corretamente para 3, 7 e 11 unidades', () => {
  const expected = new Map([[3, 47.47], [7, 127.43], [11, 207.39]]);
  for (const [quantity, subtotal] of expected) {
    const result = calculatePromoLinePricing({ normalPrice: 19.99, promoPrice: 7.49, hasPromo: true, promoMaxUnits: 1, quantity });
    assert.equal(result.subtotal, subtotal);
  }
});

test('custo médio com estoque zero usa integralmente o custo da entrada', () => {
  assert.equal(calculateWeightedAverageUnitCost(0, 9.99, 12, 2), 2);
});

test('custo por lote aceita quantidade do lote diferente do estoque atual', () => {
  const result = simulateProfit({ normalPrice: 8.9, cost: 24, costMode: 'lot', lotUnits: 12, stock: 7 });
  assert.equal(result.costUnitPrecise, 2);
  assert.equal(result.normal.stockCost, 14);
  assert.equal(result.normal.stockProfit, 48.3);
});

test('promoção abaixo do custo conserva prejuízo e preço normal lucrativo', () => {
  const result = simulateProfit({ normalPrice: 8.9, promoPrice: 1.5, hasPromo: true, cost: 2, stock: 10 });
  assert.equal(result.normal.unitProfit, 6.9);
  assert.equal(result.normal.stockProfit, 69);
  assert.equal(result.promo?.unitProfit, -0.5);
  assert.equal(result.promo?.stockProfit, -5);
});
