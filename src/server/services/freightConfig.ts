import type { FreightRuleConfig } from '../../services/freightService.ts';
export const GEO_DEFAULTS: Record<string, string> = {
  freight_free_band1_enabled: 'false', freight_free_band1_min_required: 'false', freight_free_band1_min_value: '0',
  freight_free_band2_enabled: 'false', freight_free_band2_min_value: '90', geo_monthly_limit: '35000', geo_warn_at: '25000', freight_max_km: '20', freight_out_of_area_whatsapp: '11910509385',
};
export function freightRulesFromSettings(map: Record<string, string>): FreightRuleConfig {
  const value = (key: string, fallback: number) => Number.isFinite(Number(map[key])) && map[key] !== '' && map[key] !== undefined ? Number(map[key]) : fallback;
  return { baseDistanceKm: value('freight_base_km', 4), baseFee: value('freight_base_fee', 7.5), extraKmFee: value('freight_extra_km_fee', 1.5), maxKm: value('freight_max_km', 20), outOfAreaWhatsapp: map.freight_out_of_area_whatsapp || '11910509385', band1Enabled: map.freight_free_band1_enabled === 'true', band1MinRequired: map.freight_free_band1_min_required === 'true', band1MinValue: value('freight_free_band1_min_value', 0), band2Enabled: map.freight_free_band2_enabled === 'true', band2MinValue: value('freight_free_band2_min_value', 90) };
}
