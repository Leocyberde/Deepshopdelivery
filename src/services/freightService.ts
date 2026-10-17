export interface FreightRuleConfig {
  baseDistanceKm: number;
  baseFee: number;
  extraKmFee: number;
  maxKm?: number;
  outOfAreaWhatsapp?: string;
  band1Enabled?: boolean;
  band1MinRequired?: boolean;
  band1MinValue?: number;
  band2Enabled?: boolean;
  band2MinValue?: number;
}

export const OUT_OF_AREA_MESSAGE = 'Não entregamos nessa região. Entre em contato através do WhatsApp: 11910509385';
export function outOfAreaMessage(phone = '11910509385'): string {
  return `Não entregamos nessa região. Entre em contato através do WhatsApp: ${phone}`;
}
export function normalizeGeoText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
export function isItatibaCity(city: string | null | undefined): boolean {
  return normalizeGeoText(city) === 'itatiba';
}
export function isServedAddress(address: { city?: string | null; state?: string | null }): boolean {
  return isItatibaCity(address.city) && (!address.state || normalizeGeoText(address.state) === 'sp');
}
export interface OrderFreightResult {
  status: 'OK' | 'DISTANCE_UNAVAILABLE' | 'OUT_OF_DELIVERY_AREA';
  distanceKm: number | null;
  normalFee: number | null;
  finalFee: number | null;
  source: string;
  appliedBand: 1 | 2 | null;
  minimumRequired: number | null;
  missingAmount: number | null;
  message?: string;
}

/** Only product subtotal (including preorders/promotional prices) participates in the minimum. */
export function computeOrderFreight({ distanceKm, itemsSubtotal, rules, customerFreeDeliveryUntil, now = new Date() }: {
  distanceKm: number | null | undefined;
  itemsSubtotal: number;
  rules: FreightRuleConfig;
  customerFreeDeliveryUntil?: Date | string | null;
  now?: Date;
}): OrderFreightResult {
  const empty: OrderFreightResult = { status: 'DISTANCE_UNAVAILABLE', distanceKm: null, normalFee: null, finalFee: null, source: 'DISTANCE_UNAVAILABLE', appliedBand: null, minimumRequired: null, missingAmount: null, message: 'Não conseguimos calcular o frete agora' };
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm < 0) return empty;
  const km = Math.round(distanceKm * 100) / 100;
  if (km > (rules.maxKm ?? 20)) return { ...empty, status: 'OUT_OF_DELIVERY_AREA', source: 'OUT_OF_DELIVERY_AREA', distanceKm: km, message: outOfAreaMessage(rules.outOfAreaWhatsapp) };
  if (!Number.isFinite(itemsSubtotal) || itemsSubtotal < 0) throw new Error('Subtotal inválido.');
  const subtotalCents = Math.round(itemsSubtotal * 100);
  const normalCents = Math.round(calculateSuggestedFreight(km, rules) * 100);
  const result: OrderFreightResult = { status: 'OK', distanceKm: km, normalFee: normalCents / 100, finalFee: normalCents / 100, source: 'AUTO', appliedBand: null, minimumRequired: null, missingAmount: null };
  if (customerFreeDeliveryUntil && new Date(customerFreeDeliveryUntil).getTime() > now.getTime()) return { ...result, finalFee: 0, source: 'MANUAL_FREE_DELIVERY_PERIOD' };
  const band = km <= 3 ? (rules.band1Enabled ? 1 : null) : km <= 15 && rules.band2Enabled ? 2 : null;
  if (!band) return result;
  const minimumCents = Math.round((band === 1 ? (rules.band1MinRequired ? rules.band1MinValue ?? 0 : 0) : rules.band2MinValue ?? 0) * 100);
  if (subtotalCents >= minimumCents) return { ...result, finalFee: 0, appliedBand: band, source: `FREE_BAND_${band}` };
  return { ...result, minimumRequired: minimumCents / 100, missingAmount: (minimumCents - subtotalCents) / 100 };
}

export interface AddressFreightData {
  id: number;
  city?: string | null;
  state?: string | null;
  deliveryDistanceKm: string | number | null;
  deliveryFee: string | number | null;
  deliveryFeeStatus: string;
  deliveryFeeSource: string;
  deliveryInArea?: boolean | null;
  deliveryOrigin?: string | null;
  deliveryNotes?: string | null;
}
export interface EvaluatedFreight {
  status: 'PENDING' | 'CONFIRMED';
  distanceKm: number | null;
  fee: number | null;
  source: string;
  origin: string | null;
  notes: string | null;
  isItatiba: boolean;
  deliveryMode: 'DELIVERY' | 'UNAVAILABLE';
  deliveryModeMessage: string;
  customerMessage: string;
}
/** Read-only presentation; orders always ignore the old manual address fee. */
export function resolveAddressFreight(address: AddressFreightData): EvaluatedFreight {
  const isItatiba = isServedAddress(address);
  const distance = address.deliveryDistanceKm == null ? null : Number(address.deliveryDistanceKm);
  const confirmed = isItatiba && address.deliveryInArea !== false && distance !== null && Number.isFinite(distance) && ['GOOGLE', 'GOOGLE_CACHE'].includes(address.deliveryFeeSource);
  return {
    status: confirmed ? 'CONFIRMED' : 'PENDING', distanceKm: distance, fee: confirmed && address.deliveryFee !== null ? Number(address.deliveryFee) : null,
    source: address.deliveryFeeSource, origin: address.deliveryOrigin || null, notes: address.deliveryNotes || null,
    isItatiba, deliveryMode: isItatiba ? 'DELIVERY' : 'UNAVAILABLE', deliveryModeMessage: isItatiba ? 'Atendemos apenas Itatiba' : 'Atendemos apenas Itatiba',
    customerMessage: !isItatiba ? 'Atendemos apenas Itatiba' : address.deliveryInArea === false ? OUT_OF_AREA_MESSAGE : confirmed ? 'Frete automático por distância; valor final na cotação.' : 'Não conseguimos calcular o frete agora',
  };
}
export function calculateSuggestedFreight(distanceKm: number, config: FreightRuleConfig = { baseDistanceKm: 4, baseFee: 7.5, extraKmFee: 1.5 }): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const baseKm = config.baseDistanceKm > 0 ? config.baseDistanceKm : 4;
  const baseCents = Math.round((config.baseFee >= 0 ? config.baseFee : 7.5) * 100);
  const extraCents = Math.round((config.extraKmFee >= 0 ? config.extraKmFee : 1.5) * 100);
  return Math.round(baseCents + Math.max(0, distanceKm - baseKm) * extraCents) / 100;
}
export function didAddressLocationChange(oldAddr: { zipCode: string; street: string; number: string; neighborhood: string; city: string; state?: string }, newAddr: { zipCode: string; street: string; number: string; neighborhood: string; city: string; state?: string }): boolean {
  // CEP + number identifies the location; street spelling, neighborhood and complement do not make new keys.
  return oldAddr.zipCode.replace(/\D/g, '') !== newAddr.zipCode.replace(/\D/g, '') || ['number', 'city', 'state'].some((field) => normalizeGeoText((oldAddr as any)[field]) !== normalizeGeoText((newAddr as any)[field]));
}
