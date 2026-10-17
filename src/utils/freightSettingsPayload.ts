export function serializeFreightSettings(form: Record<string, unknown>): Record<string, unknown> {
  const numbers = ['freight_base_km','freight_base_fee','freight_extra_km_fee','freight_free_band1_min_value','freight_free_band2_min_value','geo_monthly_limit','geo_warn_at','freight_max_km'];
  const booleans = ['freight_free_band1_enabled','freight_free_band1_min_required','freight_free_band2_enabled'];
  return Object.fromEntries(Object.entries(form).map(([key, value]) => [key, numbers.includes(key) ? (value === '' ? null : Number(value)) : booleans.includes(key) ? value === 'true' || value === true : value]));
}
