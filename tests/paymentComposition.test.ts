import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderItems, pickProviderTransaction, validateOrderComposition } from '../src/server/services/paymentComposition.ts';

const order = (subtotal: string, fee: string | null, total: string) => ({ subtotal, deliveryFee: fee, total });

test('preço misto (promoção parcial) não é rejeitado por arredondamento do unitário', () => {
  for (const [sub, unit, qty] of [['19.99', '9.99', 2], ['1.99', '0.99', 2], ['6.67', '3.33', 2]] as const) {
    const r = validateOrderComposition([{ quantity: qty, unitPrice: unit, subtotal: sub }], order(sub, '5.00', (Number(sub) + 5).toFixed(2)));
    assert.equal(r.ok, true, `${sub}/${unit}/${qty}`);
  }
});

test('frete normal e frete grátis (0.00) fecham matematicamente', () => {
  const items = [{ quantity: 2, unitPrice: '10.00', subtotal: '20.00' }];
  assert.equal(validateOrderComposition(items, order('20.00', '7.50', '27.50')).ok, true);
  const free = validateOrderComposition(items, order('20.00', '0.00', '20.00'));
  assert.equal(free.ok, true);
  assert.equal(free.ok && free.shippingCents, 0);
});

test('composição inconsistente é bloqueada', () => {
  const items = [{ quantity: 2, unitPrice: '10.00', subtotal: '20.00' }];
  assert.deepEqual(validateOrderComposition(items, order('19.99', '0.00', '19.99')), { ok: false, reason: 'items_vs_order_subtotal' });
  assert.deepEqual(validateOrderComposition(items, order('20.00', '0.00', '19.99')), { ok: false, reason: 'total_vs_subtotal_plus_fee' });
  assert.equal(validateOrderComposition([], order('0.00', '0.00', '0.00')).ok, false);
  assert.equal(validateOrderComposition([{ quantity: 1, unitPrice: '10.00', subtotal: '30.00' }], order('30.00', '0.00', '30.00')).ok, false);
  assert.equal(validateOrderComposition([{ quantity: 0, unitPrice: '10.00', subtotal: '10.00' }], order('10.00', '0.00', '10.00')).ok, false);
});

test('frete nulo legado é tratado como zero, não como ausência', () => {
  const items = [{ quantity: 1, unitPrice: '20.00', subtotal: '20.00' }];
  assert.equal(validateOrderComposition(items, order('20.00', null, '20.00')).ok, true);
});

test('transação: prioriza a aprovada; id auxiliar divergente não bloqueia', () => {
  const txs = [{ id: 'PAY1', status: 'rejected' }, { id: 'PAY2', status: 'processed' }];
  assert.equal(pickProviderTransaction(txs)?.id, 'PAY2');
  assert.equal(pickProviderTransaction(txs, 'ID_DE_OUTRO_FLUXO')?.id, 'PAY2');
  assert.equal(pickProviderTransaction([{ id: 'A', status: 'pending' }, { id: 'B', status: 'pending' }], 'A')?.id, 'A');
  assert.equal(pickProviderTransaction([{ id: 'A', status: 'pending' }], 'ZZZ')?.id, 'A');
  assert.equal(pickProviderTransaction([]), undefined);
});

const sumItems = (items: { quantity: number; unit_price: string }[]) => items.reduce((a, i) => a + Math.round(Number(i.unit_price) * 100) * i.quantity, 0);

test('itens reais ao Mercado Pago: agrupados por produto, frete como "Entrega", soma = total', () => {
  const lines = [
    { productId: 1, productName: 'A104 - Garrafa térmica', quantity: 2, subtotal: '50.00' },
    { productId: 2, productName: 'B021 - Caneca', quantity: 1, subtotal: '20.00' },
  ];
  const items = buildProviderItems(lines, 7750, 750, '00658', 731)!;
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { external_code: 'order-731-1', title: 'A104 - Garrafa térmica', quantity: 2, unit_price: '25.00' });
  assert.equal(items[2].title, 'Entrega');
  assert.equal(sumItems(items), 7750);
});

test('mesmo produto em entrega + encomenda vira uma linha só', () => {
  const lines = [
    { productId: 1, productName: 'A104 - Garrafa', quantity: 1, subtotal: '25.00' },
    { productId: 1, productName: 'A104 - Garrafa', quantity: 2, subtotal: '50.00' },
  ];
  const items = buildProviderItems(lines, 7500, 0, '1', 1)!;
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 3);
  assert.equal(items[0].unit_price, '25.00');
});

test('promoção parcial: subtotal não divisível usa quantidade 1 e soma exata; frete grátis sem linha', () => {
  const items = buildProviderItems([{ productId: 1, productName: 'Caneca', quantity: 2, subtotal: '19.99' }], 1999, 0, '1', 1)!;
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '2x Caneca');
  assert.equal(items[0].quantity, 1);
  assert.equal(sumItems(items), 1999);
});

test('soma que não fecha com o total devolve null (fallback de item único)', () => {
  assert.equal(buildProviderItems([{ productId: 1, productName: 'X', quantity: 1, subtotal: '10.00' }], 1500, 0, '1', 1), null);
});
