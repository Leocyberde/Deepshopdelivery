export interface FreightRuleConfig {
  baseDistanceKm: number; // padrão: 4.0
  baseFee: number; // padrão: 7.50
  extraKmFee: number; // padrão: 1.50
}

export interface AddressFreightData {
  id: number;
  city?: string | null;
  deliveryDistanceKm: string | number | null;
  deliveryFee: string | number | null;
  deliveryFeeStatus: string; // 'PENDING' | 'CONFIRMED'
  deliveryFeeSource: string; // 'MANUAL'
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
  deliveryMode: 'DELIVERY' | 'CORREIOS';
  deliveryModeMessage: string;
  customerMessage: string;
}

export function isItatibaCity(city: string | null | undefined): boolean {
  if (!city) return false;
  const normalized = String(city)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'itatiba' || normalized.startsWith('itatiba ');
}

export function resolveAddressFreight(address: AddressFreightData): EvaluatedFreight {
  const isItatiba = isItatibaCity(address.city);
  const deliveryMode: 'DELIVERY' | 'CORREIOS' = isItatiba ? 'DELIVERY' : 'CORREIOS';
  const deliveryModeMessage = isItatiba
    ? 'Temos delivery para Itatiba!'
    : 'Entrega através dos Correios — conferir valor no WhatsApp';

  const isConfirmed =
    address.deliveryFeeStatus === 'CONFIRMED' &&
    address.deliveryFee !== null &&
    address.deliveryFee !== undefined &&
    address.deliveryFee !== '';

  if (!isConfirmed) {
    return {
      status: 'PENDING',
      distanceKm:
        address.deliveryDistanceKm !== null && address.deliveryDistanceKm !== undefined
          ? Number(address.deliveryDistanceKm)
          : null,
      fee: null,
      source: isItatiba ? 'MANUAL' : 'CORREIOS',
      origin: address.deliveryOrigin || null,
      notes: address.deliveryNotes || null,
      isItatiba,
      deliveryMode,
      deliveryModeMessage,
      customerMessage: isItatiba
        ? 'Temos delivery para Itatiba! Frete a combinar. A loja vai informar o valor.'
        : 'Entrega através dos Correios — conferir valor no WhatsApp.',
    };
  }

  const fee = Number(Number(address.deliveryFee).toFixed(2));
  const distanceKm =
    address.deliveryDistanceKm !== null && address.deliveryDistanceKm !== undefined
      ? Number(Number(address.deliveryDistanceKm).toFixed(2))
      : null;

  return {
    status: 'CONFIRMED',
    distanceKm,
    fee,
    source: address.deliveryFeeSource || (isItatiba ? 'MANUAL' : 'CORREIOS'),
    origin: address.deliveryOrigin || null,
    notes: address.deliveryNotes || null,
    isItatiba,
    deliveryMode,
    deliveryModeMessage,
    customerMessage: isItatiba
      ? `Temos delivery (Itatiba) — Frete confirmado: R$ ${fee.toFixed(2).replace('.', ',')}`
      : `Entrega através dos Correios — Valor confirmado: R$ ${fee.toFixed(2).replace('.', ',')}`,
  };
}

export function calculateSuggestedFreight(
  distanceKm: number,
  config: FreightRuleConfig = {
    baseDistanceKm: 4.0,
    baseFee: 7.5,
    extraKmFee: 1.5,
  }
): number {
  if (isNaN(distanceKm) || distanceKm < 0) {
    return 0;
  }
  const baseKm = config.baseDistanceKm > 0 ? config.baseDistanceKm : 4.0;
  const baseFee = config.baseFee >= 0 ? config.baseFee : 7.5;
  const extraFee = config.extraKmFee >= 0 ? config.extraKmFee : 1.5;

  if (distanceKm <= baseKm) {
    return Number(baseFee.toFixed(2));
  }
  const extraKm = distanceKm - baseKm;
  const total = baseFee + extraKm * extraFee;
  return Number(total.toFixed(2));
}

export function didAddressLocationChange(
  oldAddr: {
    zipCode: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state?: string;
  },
  newAddr: {
    zipCode: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state?: string;
  }
): boolean {
  const norm = (v?: string | null) => (v || '').trim().toLowerCase();
  const normZip = (v?: string | null) => (v || '').replace(/\D/g, '');

  if (normZip(oldAddr.zipCode) !== normZip(newAddr.zipCode)) return true;
  if (norm(oldAddr.street) !== norm(newAddr.street)) return true;
  if (norm(oldAddr.number) !== norm(newAddr.number)) return true;
  if (norm(oldAddr.neighborhood) !== norm(newAddr.neighborhood)) return true;
  if (norm(oldAddr.city) !== norm(newAddr.city)) return true;
  if (newAddr.state && oldAddr.state && norm(oldAddr.state) !== norm(newAddr.state)) return true;
  return false;
}
