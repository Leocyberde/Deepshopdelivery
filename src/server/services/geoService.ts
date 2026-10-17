import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pgClient } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { calculateSuggestedFreight, computeOrderFreight, isServedAddress, normalizeGeoText, type FreightRuleConfig } from '../../services/freightService.ts';
import { getSettingsMap } from './storeHelpers.ts';
import { getDistanceProvider, validStoreOrigin, type DistanceResult } from './distanceProvider.ts';

import { freightRulesFromSettings } from './freightConfig.ts';
export { GEO_DEFAULTS, freightRulesFromSettings } from './freightConfig.ts';
type Location = { zipCode: string; street: string; number: string; city: string; state: string };
export function geoCacheKey(origin: string, address: Location): string {
  return createHash('sha256').update(normalizeGeoText(origin) + '|' + [address.zipCode.replace(/\D/g, ''), address.number, address.city, address.state].map(normalizeGeoText).join('|')).digest('hex');
}
export class FreightError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function savedDistance(address: typeof schema.addresses.$inferSelect, settings: Record<string, string>): number | null {
  // Origin changes invalidate saved distance too, without ever calling Google from checkout/orders.
  if (!['GOOGLE', 'GOOGLE_CACHE'].includes(address.deliveryFeeSource) || address.deliveryCacheKey !== geoCacheKey(settings.store_origin_address || '', address)) return null;
  return address.deliveryDistanceKm == null ? null : Number(address.deliveryDistanceKm);
}
export function freightForSavedAddress(address: typeof schema.addresses.$inferSelect, settings: Record<string, string>, subtotal: number, until?: Date | null) {
  if (!isServedAddress(address)) throw new FreightError('CITY_NOT_SERVED', 422, 'Atendemos apenas Itatiba');
  return computeOrderFreight({ distanceKm: savedDistance(address, settings), itemsSubtotal: subtotal, rules: freightRulesFromSettings(settings), customerFreeDeliveryUntil: until });
}
export function requireAvailableFreight(result: ReturnType<typeof computeOrderFreight>) {
  if (result.status !== 'OK') throw new FreightError(result.status, result.status === 'OUT_OF_DELIVERY_AREA' ? 422 : 409, result.message!);
  return result;
}
const flights = new Map<string, Promise<DistanceResult & { cacheKey: string; fromCache?: boolean }>>();
async function notifyQuota(executor: any, month: string, kind: string, calls: number, limit: number) {
  const inserted = await executor.query('INSERT INTO admin_event_keys(event_key,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_key', [`geo:${month}:${kind}`, `GEO_${kind}`]);
  if (inserted.rowCount) await executor.query('INSERT INTO admin_notifications(type,title,message) VALUES ($1,$2,$3)', ['GEO_QUOTA', kind === 'WARN' ? 'Aviso de cota geográfica' : 'Cota geográfica esgotada', `${calls} consultas no mês ${month}. Limite: ${limit}.`]);
}
async function reserveCall(userId: number | null, map: Record<string, string>): Promise<DistanceResult | null> {
  const client = await pgClient.connect();
  const month = new Date().toISOString().slice(0, 7);
  const limit = Number(map.geo_monthly_limit || 35000);
  const warnAt = Number(map.geo_warn_at || 25000);
  try {
    await client.query('BEGIN');
    if (userId !== null) {
      await client.query('SELECT pg_advisory_xact_lock(73003, $1)', [userId]);
      const count = await client.query("SELECT count(*)::int AS n FROM geo_lookup_log WHERE user_id=$1 AND created_at > NOW() - INTERVAL '24 hours'", [userId]);
      if (count.rows[0].n >= 15) { await client.query('COMMIT'); return { code: 'DAILY_LIMIT' }; }
    }
    // Serialized atomic monthly reservation, including unsuccessful provider attempts.
    const reserved = await client.query(`INSERT INTO geo_api_usage(month,calls) VALUES ($1,1)
      ON CONFLICT(month) DO UPDATE SET calls=geo_api_usage.calls+1 WHERE geo_api_usage.calls < $2 RETURNING calls`, [month, limit]);
    if (!reserved.rowCount) {
      await notifyQuota(client, month, 'EXHAUSTED', limit, limit); await client.query('COMMIT'); return { code: 'MONTHLY_LIMIT' };
    }
    if (userId !== null) await client.query('INSERT INTO geo_lookup_log(user_id) VALUES ($1)', [userId]);
    const calls = reserved.rows[0].calls;
    if (calls >= warnAt) await notifyQuota(client, month, 'WARN', calls, limit);
    if (calls >= limit) await notifyQuota(client, month, 'EXHAUSTED', calls, limit);
    await client.query('COMMIT');
    return null;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function lookupDistance(address: Location, userId: number | null, force = false, settings?: Record<string, string>) {
  const map = settings || await getSettingsMap();
  const origin = map.store_origin_address || '';
  const key = geoCacheKey(origin, address);
  if (!validStoreOrigin(origin) || !process.env.GOOGLE_MAPS_API_KEY) return { code: 'NOT_CONFIGURED' as const, cacheKey: key };
  if (!force) {
    const cached = await pgClient.query("UPDATE geo_distance_cache SET hit_count=hit_count+1 WHERE cache_key=$1 AND updated_at > NOW() - INTERVAL '365 days' RETURNING *", [key]);
    if (cached.rowCount) return { code: 'OK' as const, cacheKey: key, fromCache: true, distanceMeters: cached.rows[0].distance_meters, durationSeconds: cached.rows[0].duration_seconds, provider: cached.rows[0].provider };
  }
  const existing = flights.get(key);
  if (existing) { const shared = await existing; if (shared.code === 'OK') await pgClient.query('UPDATE geo_distance_cache SET hit_count=hit_count+1 WHERE cache_key=$1', [key]); return { ...shared, fromCache: shared.code === 'OK' }; }
  const operation = (async () => {
    const blocked = await reserveCall(userId, map);
    if (blocked) return { ...blocked, cacheKey: key };
    const destination = `${address.street}, ${address.number}, ${address.city}/${address.state}, ${address.zipCode.replace(/\D/g, '')}, Brasil`;
    const measured = await getDistanceProvider().lookup(origin, destination);
    if (measured.code === 'OK') await pgClient.query(`INSERT INTO geo_distance_cache(cache_key,origin_text,destination_text,distance_meters,duration_seconds,provider)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(cache_key) DO UPDATE SET distance_meters=EXCLUDED.distance_meters,duration_seconds=EXCLUDED.duration_seconds,provider=EXCLUDED.provider,updated_at=NOW()`, [key, normalizeGeoText(origin), [address.zipCode.replace(/\D/g, ''), address.number, address.city, address.state].map(normalizeGeoText).join('|'), measured.distanceMeters, measured.durationSeconds, measured.provider]);
    return { ...measured, cacheKey: key };
  })();
  flights.set(key, operation);
  try { return await operation; } finally { if (flights.get(key) === operation) flights.delete(key); }
}
export async function calculateAddressDistance(id: number, userId: number | null, force = false) {
  const [address] = await db.select().from(schema.addresses).where(eq(schema.addresses.id, id));
  if (!address) throw new FreightError('NOT_FOUND', 404, 'Endereço não encontrado.');
  if (!isServedAddress(address)) throw new FreightError('CITY_NOT_SERVED', 422, 'Atendemos apenas Itatiba');
  const map = await getSettingsMap();
  const geo = await lookupDistance(address, userId, force, map);
  const distanceKm = geo.code === 'OK' ? Math.round(geo.distanceMeters! / 10) / 100 : null;
  const rules = freightRulesFromSettings(map);
  const inArea = distanceKm === null ? null : distanceKm <= rules.maxKm!;
  // Compare location before writing: a slower old request must not override a later address edit.
  const [fresh] = await db.select().from(schema.addresses).where(eq(schema.addresses.id, id));
  if (!fresh || geoCacheKey(map.store_origin_address || '', fresh) !== geo.cacheKey) return { address: fresh || address, geo: { ...geo, code: 'PROVIDER_ERROR' as const } };
  const [updated] = await db.update(schema.addresses).set({
    deliveryDistanceKm: distanceKm === null ? null : distanceKm.toFixed(2),
    deliveryFee: distanceKm === null ? null : calculateSuggestedFreight(distanceKm, rules).toFixed(2),
    deliveryFeeStatus: distanceKm === null ? 'PENDING' : inArea ? 'CONFIRMED' : 'OUT_OF_DELIVERY_AREA',
    deliveryFeeSource: geo.code === 'OK' ? ('fromCache' in geo && geo.fromCache) ? 'GOOGLE_CACHE' : 'GOOGLE' : geo.code,
    deliveryCacheKey: distanceKm === null ? null : geo.cacheKey, deliveryInArea: inArea,
    deliveryOrigin: map.store_origin_address || null, deliveryUpdatedAt: new Date(), updatedAt: new Date(),
  }).where(eq(schema.addresses.id, id)).returning();
  return { address: updated, geo };
}
export async function geoStatus() {
  const map = await getSettingsMap();
  const month = new Date().toISOString().slice(0, 7);
  const usage = await pgClient.query('SELECT calls FROM geo_api_usage WHERE month=$1', [month]);
  const cache = await pgClient.query('SELECT count(*)::int AS entries, COALESCE(sum(hit_count),0)::int AS hits FROM geo_distance_cache');
  const calls = usage.rows[0]?.calls || 0, limit = Number(map.geo_monthly_limit || 35000);
  return { month, calls, limit, warnAt: Number(map.geo_warn_at || 25000), percent: Math.round(calls / limit * 10000) / 100, remaining: Math.max(0, limit - calls), cacheEntries: cache.rows[0].entries, savedHits: cache.rows[0].hits, state: !process.env.GOOGLE_MAPS_API_KEY ? 'NO_KEY' : !validStoreOrigin(map.store_origin_address || '') ? 'NO_ORIGIN' : 'CONFIGURED', provider: getDistanceProvider().name };
}
