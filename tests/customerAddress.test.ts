import test from 'node:test';
import assert from 'node:assert/strict';
import { toCustomerAddress, toCustomerFreight } from '../src/server/services/customerAddress.ts';

const row = {
  id: 1, userId: 9, label: 'Casa', zipCode: '13250-000', street: 'Rua A', number: '10', complement: null,
  neighborhood: 'Centro', city: 'Itatiba', state: 'SP', reference: null, isPrimary: true,
  deliveryDistanceKm: '3.20', deliveryFee: '9.00', deliveryFeeStatus: 'CONFIRMED', deliveryFeeSource: 'GOOGLE',
  deliveryCacheKey: 'k', deliveryUpdatedBy: 3, deliveryOrigin: 'Matriz', latitude: '1', longitude: '2',
};

test('endereço do cliente não expõe distância, frete nem dados internos', () => {
  const out = toCustomerAddress(row) as unknown as Record<string, unknown>;
  for (const k of ['deliveryDistanceKm', 'deliveryFee', 'deliveryFeeStatus', 'deliveryFeeSource', 'deliveryCacheKey', 'deliveryUpdatedBy', 'deliveryOrigin', 'latitude', 'longitude', 'userId', 'freight']) {
    assert.equal(k in out, false, k);
  }
  assert.equal(out.served, true);
  assert.equal(out.label, 'Casa');
  assert.equal(toCustomerAddress({ ...row, city: 'Campinas' }).served, false);
});

test('cotação do cliente não expõe distância, faixa, origem nem frete normal', () => {
  const out = toCustomerFreight({ status: 'OK', distanceKm: 3.2, normalFee: 9, finalFee: 0, source: 'FREE_BAND_1', appliedBand: 1, minimumRequired: null, missingAmount: null }) as Record<string, unknown>;
  for (const k of ['distanceKm', 'normalFee', 'source', 'appliedBand']) assert.equal(k in out, false, k);
  assert.equal(out.isFree, true);
  assert.equal(out.finalFee, 0);
  assert.equal(toCustomerFreight(null), null);
});
