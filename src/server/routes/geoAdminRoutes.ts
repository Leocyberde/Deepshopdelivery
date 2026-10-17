import type { Express, Response, NextFunction } from 'express';
import { sql, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAuth, requireAdmin } from '../middleware/auth.ts';
import { logServerError } from '../logger.ts';
import { calculateAddressDistance, geoStatus, lookupDistance, FreightError } from '../services/geoService.ts';
import { getSettingsMap } from '../services/storeHelpers.ts';
import { resolveAddressFreight, outOfAreaMessage } from '../../services/freightService.ts';
import { dryRunLegacyFreight, executeLegacyFreight } from '../services/legacyFreightService.ts';
import { updateFreeDeliveryBenefits } from '../services/freeDeliveryBenefits.ts';

/** Bearer API may omit Origin; browser mutations must match SITE_URL or local request origin. */
export function sameOrigin(req: AuthRequest, res: Response, next: NextFunction) {
  const origin = req.get('Origin');
  const expected = process.env.SITE_URL;
  const local = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expected && !(process.env.NODE_ENV !== 'production' && origin === local)) { res.status(403).json({ error: 'Origem não permitida.' }); return; }
  if (req.get('Sec-Fetch-Site') === 'cross-site') { res.status(403).json({ error: 'Origem não permitida.' }); return; }
  next();
}
function geoManager(req: AuthRequest, res: Response, next: NextFunction) {
  if (!['SUPER_ADMIN', 'GERENTE', 'ADMIN'].includes(req.user!.role)) { res.status(403).json({ error: 'Recálculo restrito a SUPER_ADMIN ou GERENTE.' }); return; } next();
}
function failed(res: Response, error: unknown) {
  if (error instanceof FreightError) res.status(error.status).json({ error: error.message, code: error.code });
  else { logServerError('geo.admin.failed', error); res.status(500).json({ error: 'Não foi possível concluir a operação de frete.' }); }
}
export function registerGeoAdminRoutes(app: Express) {
  app.get('/api/admin/geo/status', requireAuth, requireAdmin, async (_req, res) => {
    try { res.json(await geoStatus()); } catch (error) { failed(res, error); }
  });
  app.post('/api/admin/geo/test-origin', requireAuth, requireAdmin, sameOrigin, geoManager, async (req: AuthRequest, res) => {
    try {
      // Tests only the saved origin, never an arbitrary URL/address provided by the browser.
      const map = await getSettingsMap();
      const result = await lookupDistance({ zipCode: '13250000', street: map.store_origin_address || '', number: 'origem', city: 'Itatiba', state: 'SP' }, null, true, map);
      await db.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'GEO_ORIGIN_TEST', entityType: 'settings', details: { code: result.code, provider: result.provider || null } });
      res.json({ code: result.code, provider: result.provider || null, ok: result.code === 'OK' });
    } catch (error) { failed(res, error); }
  });
  app.post('/api/admin/addresses/:id/recalculate', requireAuth, requireAdmin, sameOrigin, geoManager, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new FreightError('INVALID_ID', 400, 'Endereço inválido.');
      const result = await calculateAddressDistance(id, null, true);
      await db.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'GEO_ADDRESS_RECALCULATED', entityType: 'address', entityId: String(id), details: { code: result.geo.code, distanceKm: result.address.deliveryDistanceKm } });
      res.status(result.address.deliveryInArea === false ? 422 : 200).json({ ...result.address, geo: result.geo, freight: resolveAddressFreight(result.address), ...(result.address.deliveryInArea === false ? { code: 'OUT_OF_DELIVERY_AREA', error: outOfAreaMessage((await getSettingsMap()).freight_out_of_area_whatsapp) } : {}) });
    } catch (error) { failed(res, error); }
  });
  app.post('/api/admin/geo/calculate-pending', requireAuth, requireAdmin, sameOrigin, geoManager, async (req: AuthRequest, res) => {
    try {
      const map = await getSettingsMap();
      const rows = await db.select().from(schema.addresses).where(sql`lower(trim(${schema.addresses.city}))='itatiba' AND upper(trim(${schema.addresses.state}))='SP' AND (${schema.addresses.deliveryDistanceKm} IS NULL OR ${schema.addresses.deliveryOrigin} IS DISTINCT FROM ${map.store_origin_address || ''} OR ${schema.addresses.deliveryFeeSource} NOT IN ('GOOGLE','GOOGLE_CACHE'))`).orderBy(schema.addresses.id).limit(50);
      const summary = { calculated: 0, fromCache: 0, failures: 0, outOfArea: 0, remainingQuota: 0 };
      for (const address of rows) {
        const result = await calculateAddressDistance(address.id, null);
        if (result.geo.code === 'OK') { summary.calculated++; if ('fromCache' in result.geo && result.geo.fromCache) summary.fromCache++; if (result.address.deliveryInArea === false) summary.outOfArea++; } else summary.failures++;
        if (result.geo.code === 'MONTHLY_LIMIT') break;
      }
      summary.remainingQuota = (await geoStatus()).remaining;
      await db.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'GEO_PENDING_BATCH', entityType: 'addresses', details: summary });
      res.json(summary);
    } catch (error) { failed(res, error); }
  });
  app.put('/api/admin/customers/free-delivery-period', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (!Array.isArray(req.body?.customerIds)) throw new FreightError('INVALID_CUSTOMERS', 400, 'Selecione os clientes.');
      res.json(await updateFreeDeliveryBenefits(req, req.body.customerIds));
    } catch (error) { failed(res, error); }
  });
  app.put('/api/admin/customers/:id/free-delivery-period', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try { res.json(await updateFreeDeliveryBenefits(req, [Number(req.params.id)])); } catch (error) { failed(res, error); }
  });
  app.post('/api/admin/orders/legacy-freight/dry-run', requireAuth, requireAdmin, sameOrigin, geoManager, async (req: AuthRequest, res) => {
    try { res.json(await dryRunLegacyFreight(req)); } catch (error) { failed(res, error); }
  });
  app.post('/api/admin/orders/legacy-freight/execute', requireAuth, requireAdmin, sameOrigin, geoManager, async (req: AuthRequest, res) => {
    try { res.json(await executeLegacyFreight(req)); } catch (error) { failed(res, error); }
  });
}
