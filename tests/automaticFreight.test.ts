import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderFreight, calculateSuggestedFreight, didAddressLocationChange, isServedAddress } from '../src/services/freightService.ts';
import { validateFreightSettings } from '../src/server/services/freightSettingsValidation.ts';
const base = { baseDistanceKm: 4, baseFee: 7.5, extraKmFee: 1.5, maxKm: 20 };
const now = new Date('2026-10-16T12:00:00Z');
for (const [km, expected] of [[0,7.5],[3,7.5],[4,7.5],[5,9],[6.5,11.25],[10,16.5],[15.01,24.02],[20,31.5]]) {
  test(`frete normal ${km} km = ${expected}`, () => assert.equal(calculateSuggestedFreight(km, base), expected));
}
for (const [km, subtotal, source] of [[2,50,'AUTO'],[3,120,'AUTO'],[3.01,89.99,'AUTO'],[3.1,89,'AUTO'],[3.1,90,'FREE_BAND_2'],[10,120,'FREE_BAND_2'],[15,90,'FREE_BAND_2'],[15.01,120,'AUTO'],[20,1000,'AUTO']] as const) {
  test(`faixa 1 desligada + faixa 2 ligada: ${km}km/${subtotal} = ${source}`, () => {
    const result = computeOrderFreight({ distanceKm: km, itemsSubtotal: subtotal, rules: { ...base, band2Enabled: true, band2MinValue: 90 }, now });
    assert.equal(result.status, 'OK'); assert.equal(result.source, source);
  });
}
for (const band1 of [false,true]) for (const band2 of [false,true]) {
  test(`faixas independentes: 1=${band1}, 2=${band2}`, () => {
    const rules = { ...base, band1Enabled: band1, band2Enabled: band2, band2MinValue: 90 };
    assert.equal(computeOrderFreight({ distanceKm: 3, itemsSubtotal: 120, rules, now }).source, band1 ? 'FREE_BAND_1' : 'AUTO');
    assert.equal(computeOrderFreight({ distanceKm: 3.01, itemsSubtotal: 120, rules, now }).source, band2 ? 'FREE_BAND_2' : 'AUTO');
  });
}
for (const [subtotal, expected] of [[89.99,'AUTO'],[90,'FREE_BAND_1'],[90.01,'FREE_BAND_1']] as const) {
  test(`faixa 1 mínimo inclusivo, subtotal ${subtotal}`, () => {
    const result = computeOrderFreight({ distanceKm: 2, itemsSubtotal: subtotal, rules: { ...base, band1Enabled: true, band1MinRequired: true, band1MinValue: 90 }, now });
    assert.equal(result.source, expected); if (subtotal < 90) { assert.equal(result.minimumRequired,90); assert.equal(result.missingAmount,0.01); }
  });
}
test('sem mínimo faixa 1; km arredondados a duas casas', () => {
  assert.equal(computeOrderFreight({ distanceKm: 3.004, itemsSubtotal: 0, rules: { ...base, band1Enabled: true }, now }).source,'FREE_BAND_1');
  assert.equal(computeOrderFreight({ distanceKm: 3.006, itemsSubtotal: 0, rules: { ...base, band1Enabled: true }, now }).source,'AUTO');
});
test('benefício tem prioridade, mas não autoriza distância ausente ou acima do máximo', () => {
  const future = '2026-10-17T00:00:00Z';
  assert.equal(computeOrderFreight({ distanceKm: 10, itemsSubtotal: 0, rules: { ...base, band2Enabled:true, band2MinValue:90 }, customerFreeDeliveryUntil:future, now }).source,'MANUAL_FREE_DELIVERY_PERIOD');
  assert.equal(computeOrderFreight({ distanceKm: null, itemsSubtotal: 100, rules:base, customerFreeDeliveryUntil:future, now }).status,'DISTANCE_UNAVAILABLE');
  assert.equal(computeOrderFreight({ distanceKm: 20.01, itemsSubtotal: 100, rules:base, customerFreeDeliveryUntil:future, now }).status,'OUT_OF_DELIVERY_AREA');
  assert.equal(computeOrderFreight({ distanceKm: 5, itemsSubtotal: 100, rules:base, customerFreeDeliveryUntil:now, now }).source,'AUTO');
});
test('mínimo não inclui frete: 85+frete >90 não concede; encomenda e promoção já entram no subtotal', () => {
  const result = computeOrderFreight({ distanceKm:10,itemsSubtotal:85,rules:{...base,band2Enabled:true,band2MinValue:90},now });
  assert.equal(result.finalFee,16.5); assert.equal(result.missingAmount,5);
});
test('distância ausente/NaN/infinita/negativa nunca concede frete', () => {
  for (const distanceKm of [null,undefined,NaN,Infinity,-1]) assert.equal(computeOrderFreight({ distanceKm,itemsSubtotal:1000,rules:{...base,band1Enabled:true},now }).status,'DISTANCE_UNAVAILABLE');
});
test('limite máximo configurável; mensagem e telefone configuráveis', () => {
  assert.equal(computeOrderFreight({ distanceKm:21,itemsSubtotal:0,rules:{...base,maxKm:25},now }).status,'OK');
  assert.equal(computeOrderFreight({ distanceKm:21,itemsSubtotal:0,rules:base,now }).message,'Não entregamos nessa região. Entre em contato através do WhatsApp: 11910509385');
});
test('cidade restrita com UF e sem aceitar nomes semelhantes; rua/bairro não criam nova chave', () => {
  assert.ok(isServedAddress({city:' ITATIBA ',state:'SP'})); assert.ok(!isServedAddress({city:'Itatiba do Sul',state:'RS'})); assert.ok(!isServedAddress({city:'Jundiaí',state:'SP'}));
  const a={zipCode:'13250-000',number:'1',street:'Rua A',neighborhood:'Centro',city:'Itatiba',state:'SP'};
  assert.equal(didAddressLocationChange(a,{...a,street:'R. A',neighborhood:'Outro',zipCode:'13250000'}),false);
  assert.equal(didAddressLocationChange(a,{...a,number:'2'}),true);
});
test('settings rejeitam strings numéricas, negativos, NaN e faixa 2 ativa sem mínimo', () => {
  for (const payload of [{geo_monthly_limit:2},{geo_monthly_limit:'100'},{freight_base_fee:-1},{freight_base_fee:NaN},{freight_free_band2_enabled:true,freight_free_band2_min_value:0},{freight_max_km:14},{geo_warn_at:0}]) assert.ok(validateFreightSettings(payload,{}));
  assert.equal(validateFreightSettings({geo_monthly_limit:100,geo_warn_at:1,freight_max_km:20,freight_free_band2_enabled:true,freight_free_band2_min_value:90},{}),null);
});
