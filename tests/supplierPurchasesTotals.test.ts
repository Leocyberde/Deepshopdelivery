import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSupplierPurchases } from '../src/server/routes/fulfillmentRoutes.ts';

test('totais de compras somam quantidade e custo NUMERIC em centavos', () => {
  assert.deepEqual(summarizeSupplierPurchases([
    { quantity: 3, totalCost: '10.005' },
    { quantity: 2, totalCost: '4.99' },
    { quantity: 1, totalCost: 0.01 },
  ]), { quantity: 6, totalCost: '15.01' });
});

test('total de compras vazio é zero formatado', () => {
  assert.deepEqual(summarizeSupplierPurchases([]), { quantity: 0, totalCost: '0.00' });
});
