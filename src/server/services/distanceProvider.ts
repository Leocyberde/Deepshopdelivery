export type GeoCode = 'OK' | 'NOT_CONFIGURED' | 'DAILY_LIMIT' | 'MONTHLY_LIMIT' | 'PROVIDER_FORBIDDEN' | 'PROVIDER_RATE_LIMIT' | 'ZERO_RESULTS' | 'TIMEOUT' | 'PROVIDER_ERROR';
export interface DistanceResult { code: GeoCode; distanceMeters?: number; durationSeconds?: number; provider?: string }
export interface DistanceProvider { name: string; lookup(origin: string, destination: string): Promise<DistanceResult> }
export function validStoreOrigin(value: string): boolean {
  return value.trim().length >= 15 && !/matriz deepshop|placeholder/i.test(value) && /\d/.test(value) && /itatiba/i.test(value);
}
function endpoint(envKey: string, productionUrl: string): string {
  return process.env.NODE_ENV !== 'production' && process.env[envKey] ? process.env[envKey]! : productionUrl;
}
async function safeFetch(url: string, init: RequestInit, parse: (body: any) => DistanceResult): Promise<DistanceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (response.status === 403) return { code: 'PROVIDER_FORBIDDEN' };
    if (response.status === 429) return { code: 'PROVIDER_RATE_LIMIT' };
    if (!response.ok) return { code: 'PROVIDER_ERROR' };
    return parse(await response.json());
  } catch {
    // Never propagate fetch errors/URLs: the matrix key lives in its query string.
    return { code: controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_ERROR' };
  } finally { clearTimeout(timeout); }
}
function result(meters: unknown, seconds: unknown): DistanceResult {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0 || meters > 2147483647 || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return { code: 'PROVIDER_ERROR' };
  return { code: 'OK', distanceMeters: Math.round(meters), durationSeconds: Math.round(seconds) };
}
export class GoogleRoutesProvider implements DistanceProvider {
  name = 'routes';
  async lookup(origin: string, destination: string): Promise<DistanceResult> {
    return { ...await safeFetch(endpoint('GOOGLE_ROUTES_BASE_URL', 'https://routes.googleapis.com/directions/v2:computeRoutes'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY || '', 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
      body: JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: 'DRIVE', regionCode: 'BR', languageCode: 'pt-BR' }),
    }, (body) => {
      const route = body?.routes?.[0];
      if (!route) return { code: 'ZERO_RESULTS' };
      return result(route.distanceMeters, typeof route.duration === 'string' && /^\d+(\.\d+)?s$/.test(route.duration) ? parseFloat(route.duration) : NaN);
    }), provider: this.name };
  }
}
export class GoogleDistanceMatrixProvider implements DistanceProvider {
  name = 'distance_matrix';
  async lookup(origin: string, destination: string): Promise<DistanceResult> {
    const url = new URL(endpoint('GOOGLE_DISTANCE_MATRIX_BASE_URL', 'https://maps.googleapis.com/maps/api/distancematrix/json'));
    url.search = new URLSearchParams({ origins: origin, destinations: destination, mode: 'driving', region: 'br', language: 'pt-BR', key: process.env.GOOGLE_MAPS_API_KEY || '' }).toString();
    return { ...await safeFetch(url.toString(), {}, (body) => {
      if (body?.status === 'REQUEST_DENIED') return { code: 'PROVIDER_FORBIDDEN' };
      if (body?.status === 'OVER_QUERY_LIMIT') return { code: 'PROVIDER_RATE_LIMIT' };
      const element = body?.rows?.[0]?.elements?.[0];
      if (element?.status === 'ZERO_RESULTS' || element?.status === 'NOT_FOUND') return { code: 'ZERO_RESULTS' };
      if (body?.status !== 'OK' || element?.status !== 'OK') return { code: 'PROVIDER_ERROR' };
      return result(element.distance?.value, element.duration?.value);
    }), provider: this.name };
  }
}
export function getDistanceProvider(): DistanceProvider {
  return process.env.GOOGLE_DISTANCE_PROVIDER === 'distance_matrix' ? new GoogleDistanceMatrixProvider() : new GoogleRoutesProvider();
}
