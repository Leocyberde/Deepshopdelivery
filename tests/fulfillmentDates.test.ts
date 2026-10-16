import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFulfillmentSplit, calculateOrderPartTotals, calculatePreorderWindow, refundAmountForPart, formatPreorderWindow, formatDeliveryPromise, getDeliveryEta } from '../src/utils/fulfillmentDates.ts';
import { getFastDeliveryEstimate, type DeliveryStoreHours } from '../src/utils/deliverySchedule.ts';

const hours = {
  sun: { enabled: true, open: '08:00', close: '23:59' }, mon: { enabled: true, open: '08:00', close: '23:59' },
  tue: { enabled: true, open: '08:00', close: '23:59' }, wed: { enabled: true, open: '08:00', close: '23:59' },
  thu: { enabled: true, open: '08:00', close: '23:59' }, fri: { enabled: true, open: '08:00', close: '23:59' }, sat: { enabled: true, open: '08:00', close: '23:59' },
};

test('split delivery/encomenda respeita estoque e a opção de receber tudo como encomenda', () => {
  assert.deepEqual(calculateFulfillmentSplit(10, 4), { deliveryQty: 4, preorderQty: 6 });
  assert.deepEqual(calculateFulfillmentSplit(3, 4), { deliveryQty: 3, preorderQty: 0 });
  assert.deepEqual(calculateFulfillmentSplit(10, 0), { deliveryQty: 0, preorderQty: 10 });
  assert.deepEqual(calculateFulfillmentSplit(10, 4, true), { deliveryQty: 0, preorderQty: 10 });
});

test('janela de encomenda usa data local e atravessa mês/ano', () => {
  const october = calculatePreorderWindow(new Date('2026-10-14T02:30:00.000Z'));
  assert.equal(october.start.toISOString(), '2026-10-14T03:00:00.000Z');
  assert.equal(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(october.end), '21/10');
  const year = calculatePreorderWindow(new Date('2026-12-31T23:30:00.000Z'));
  assert.equal(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(year.start), '01/01');
});

test('totais cobram frete uma única vez e reembolso aplica regra de entrega', () => {
  const totals = calculateOrderPartTotals(40, 60, 12.5);
  assert.deepEqual(totals, { deliverySubtotal: 40, preorderSubtotal: 60, subtotal: 100, deliveryFee: 12.5, total: 112.5 });
  assert.equal(refundAmountForPart('PREORDER_PART', totals, false), 60);
  assert.equal(refundAmountForPart('DELIVERY_PART', totals, false), 40);
  assert.equal(refundAmountForPart('FULL_ORDER', totals, false), 112.5);
  assert.equal(refundAmountForPart('FULL_ORDER', totals, true), 100);
});


const allDayHours: DeliveryStoreHours = Object.fromEntries(Object.entries(hours).map(([day, rule]) => [day, { ...rule, open: '00:00', close: '23:59' }])) as DeliveryStoreHours;
test('formatos de janela e promessa não usam contagem fixa de dias', () => {
  const window = calculatePreorderWindow(new Date('2026-10-13T15:00:00.000Z'));
  assert.equal(formatPreorderWindow(window), '14/10 a 21/10');
  const eta = new Date('2026-10-13T22:00:00.000Z');
  assert.equal(formatDeliveryPromise(eta, new Date('2026-10-13T19:00:00.000Z')), 'Chega até às 19h');
});
test('delivery rápido calcula 19:00→22h e 19:20→22h20 no fuso local', () => {
  const at19 = new Date('2026-10-13T22:00:00.000Z');
  const at1920 = new Date('2026-10-13T22:20:00.000Z');
  assert.equal(formatDeliveryPromise(getDeliveryEta(at19, 180, hours), at19), 'Chega até às 22h');
  assert.equal(formatDeliveryPromise(getDeliveryEta(at1920, 180, hours), at1920), 'Chega até às 22h20');
});
test('delivery fora do horário passa para abertura do dia seguinte mais o prazo', () => {
  const shortHours: DeliveryStoreHours = Object.fromEntries(Object.entries(hours).map(([day, rule]) => [day, { ...rule, open: '08:00', close: '20:00' }])) as DeliveryStoreHours;
  const now = new Date('2026-10-13T22:00:00.000Z');
  const eta = getFastDeliveryEstimate(now, 180, shortHours, 'America/Sao_Paulo');
  assert.equal(formatDeliveryPromise(eta, now), 'Entrega amanhã até às 11h');
});
test('borda 23:30 BRT usa data local e horário do servidor', () => {
  const now = new Date('2026-10-14T02:30:00.000Z');
  const eta = getFastDeliveryEstimate(now, 180, allDayHours, 'America/Sao_Paulo');
  assert.equal(formatDeliveryPromise(eta, now), 'Chega até às 02h30');
});
