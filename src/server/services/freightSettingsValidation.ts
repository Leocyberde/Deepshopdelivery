import { GEO_DEFAULTS } from './freightConfig.ts';
export const FREIGHT_BOOLEAN_KEYS = ['freight_free_band1_enabled', 'freight_free_band1_min_required', 'freight_free_band2_enabled'];
export const FREIGHT_NUMBER_KEYS = ['freight_base_km', 'freight_base_fee', 'freight_extra_km_fee', 'freight_free_band1_min_value', 'freight_free_band2_min_value', 'geo_monthly_limit', 'geo_warn_at', 'freight_max_km'];
export function validateFreightSettings(body: Record<string, unknown>, previous: Record<string, string>): string | null {
  for (const key of FREIGHT_BOOLEAN_KEYS) if (body[key] !== undefined && typeof body[key] !== 'boolean') return `${key}: informe verdadeiro ou falso.`;
  for (const key of FREIGHT_NUMBER_KEYS) {
    const val = body[key];
    if (val === undefined) continue;
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100000) return `${key}: informe um número não negativo válido.`;
    if (key === 'geo_monthly_limit' && (!Number.isInteger(val) || val < 100 || val > 40000)) return 'geo_monthly_limit: inteiro de 100 a 40000.';
    if (key === 'geo_warn_at' && (!Number.isInteger(val) || val < 1 || val > 40000)) return 'geo_warn_at: inteiro de 1 a 40000.';
    if (key === 'freight_max_km' && (val < 15 || val > 1000)) return 'freight_max_km: informe de 15 a 1000 km.';
    if (key === 'freight_base_km' && val <= 0) return 'A distância base deve ser maior que zero.';
  }
  if (body.freight_out_of_area_whatsapp !== undefined && (typeof body.freight_out_of_area_whatsapp !== 'string' || !/^\d{10,15}$/.test(body.freight_out_of_area_whatsapp))) return 'WhatsApp da região: informe somente 10 a 15 dígitos.';
  if (body.store_origin_address !== undefined && (typeof body.store_origin_address !== 'string' || body.store_origin_address.length > 500)) return 'Endereço da loja inválido.';
  const merged = { ...GEO_DEFAULTS, ...previous, ...Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)])) };
  if (merged.freight_free_band2_enabled === 'true' && Number(merged.freight_free_band2_min_value) <= 0) return 'A faixa 2 ativa exige mínimo maior que zero.';
  return null;
}
