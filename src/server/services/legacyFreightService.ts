import { randomUUID, createHash } from 'node:crypto';
import { and, eq, inArray, sql, isNull } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import type { AuthRequest } from '../middleware/auth.ts';
import { computeOrderFreight, isServedAddress } from '../../services/freightService.ts';
import { getSettingsMap, computePaymentExpiresAt } from './storeHelpers.ts';
import { FreightError, lookupDistance, freightRulesFromSettings } from './geoService.ts';
import { recordInventoryMovement } from './inventoryService.ts';

type Order = typeof schema.orders.$inferSelect;
const pending = () => and(inArray(schema.orders.status, ['NEW', 'AWAITING_PAYMENT']), isNull(schema.orders.deliveryFee));
const fingerprint = (order: Order) => createHash('sha256').update(JSON.stringify({ status: order.status, subtotal: order.subtotal, fee: order.deliveryFee, address: order.addressSnapshot, updated: order.updatedAt })).digest('hex');
const settingsHash = (settings: Record<string, string>) => createHash('sha256').update(JSON.stringify(Object.entries(settings).filter(([key]) => key.startsWith('freight_') || key === 'store_origin_address' || key === 'payment_deadline_hours').sort())).digest('hex');
export async function dryRunLegacyFreight(req: AuthRequest) {
  const settings = await getSettingsMap(), rules = freightRulesFromSettings(settings);
  const orders = await db.select().from(schema.orders).where(pending()).orderBy(schema.orders.id).limit(50);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.orders).where(pending());
  const entries = orders.map((order) => {
    const outsideCity = !isServedAddress(order.addressSnapshot);
    const km = order.deliveryDistanceKm === null ? null : Number(order.deliveryDistanceKm);
    return { orderId: order.id, fingerprint: fingerprint(order), action: outsideCity || (km !== null && km > rules.maxKm!) ? 'CANCEL' : 'CALCULATE_AND_RELEASE', reason: outsideCity ? 'CITY_NOT_SERVED' : km !== null && km > rules.maxKm! ? 'OUT_OF_DELIVERY_AREA' : null };
  });
  const id = randomUUID();
  const plan = { settingsHash: settingsHash(settings), entries, totalEligible: total, counts: { calculateAndRelease: entries.filter((e) => e.action !== 'CANCEL').length, cancel: entries.filter((e) => e.action === 'CANCEL').length } };
  await db.transaction(async (tx) => {
    await tx.insert(schema.freightLegacyRuns).values({ id, actorUserId: req.user!.id, plan });
    await tx.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'LEGACY_FREIGHT_DRY_RUN', entityType: 'freight_run', entityId: id, details: plan });
  });
  return { dryRunId: id, dryRun: true, ...plan, message: 'Nenhum pedido, estoque, pagamento ou cota foi alterado. Execute com dryRunId e confirm: true em até 30 minutos.' };
}
/** Same cancellation transition used by unpaid-order expiry: compare-and-set, inventory return,
 * fulfillment cancellation, history and notification, all in the transaction. Never issues refunds. */
async function cancelUnpaidLegacy(tx: any, order: Order, reason: string, actor: number) {
  const [cancelled] = await tx.update(schema.orders).set({ status: 'CANCELLED', stockDeducted: false, paymentExpiresAt: null, cancellationReason: reason, updatedAt: new Date() }).where(and(eq(schema.orders.id, order.id), pending())).returning();
  if (!cancelled) return false;
  if (order.stockDeducted) {
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    const returns = new Map<number, number>();
    for (const item of items) if (item.fulfillmentType === 'DELIVERY') returns.set(item.productId, (returns.get(item.productId) || 0) + item.quantity);
    for (const [productId, quantity] of returns) {
      const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).for('update');
      if (!product) throw new Error('Produto associado não encontrado.');
      const [restored] = await tx.update(schema.products).set({ stock: sql`${schema.products.stock} + ${quantity}`, updatedAt: new Date() }).where(eq(schema.products.id, productId)).returning();
      await recordInventoryMovement(tx, { productId, delta: quantity, beforeStock: product.stock, afterStock: restored.stock, movementType: 'ORDER_CANCELLATION_RETURN', reason, actorUserId: actor, orderId: order.id, idempotencyKey: `legacy-freight-cancel:${order.id}:${productId}` });
    }
  }
  await tx.update(schema.orderFulfillments).set({ status: 'CANCELLED' }).where(and(eq(schema.orderFulfillments.orderId, order.id), sql`${schema.orderFulfillments.status} NOT IN ('DELIVERED','REFUNDED')`));
  await tx.insert(schema.orderStatusHistory).values({ orderId: order.id, oldStatus: order.status, newStatus: 'CANCELLED', changedBy: actor });
  await tx.insert(schema.notifications).values({ userId: order.userId, orderId: order.id, orderNumber: order.orderNumber, oldStatus: order.status, newStatus: 'CANCELLED', title: 'Pedido cancelado: região não atendida', message: reason });
  return true;
}
export async function executeLegacyFreight(req: AuthRequest) {
  const id = req.body?.dryRunId;
  if (typeof id !== 'string' || req.body?.confirm !== true) throw new FreightError('DRY_RUN_REQUIRED', 400, 'Faça o dry-run e envie dryRunId com confirm: true.');
  const settings = await getSettingsMap();
  // Row lock serializes execution of the same plan; per-order locks guard payment transitions.
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(schema.freightLegacyRuns).where(eq(schema.freightLegacyRuns.id, id)).for('update');
    if (!run || run.actorUserId !== req.user!.id) throw new FreightError('NOT_FOUND', 404, 'Dry-run não encontrado.');
    if (run.executedAt) return { dryRunId: id, idempotentReplay: true, ...(run.result as any) };
    if (Date.now() - run.createdAt.getTime() > 30 * 60 * 1000 || (run.plan as any).settingsHash !== settingsHash(settings)) throw new FreightError('DRY_RUN_STALE', 409, 'Dry-run expirou ou as regras mudaram. Execute um novo dry-run.');
    const counts = { released: 0, cancelled: 0, failed: 0, skipped: 0 };
    const entries: any[] = [];
    for (const entry of (run.plan as any).entries) {
      const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, entry.orderId)).for('update');
      const paid = order && await tx.select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.orderId, order.id), sql`${schema.payments.status} IN ('APPROVED','PAID')`));
      if (!order || !['NEW', 'AWAITING_PAYMENT'].includes(order.status) || order.deliveryFee !== null || fingerprint(order) !== entry.fingerprint || paid?.length) { counts.skipped++; entries.push({ orderId: entry.orderId, action: 'SKIPPED' }); continue; }
      let result: any;
      if (entry.action !== 'CANCEL') {
        // Administrative execution only; uses the original order address snapshot, not an edited address.
        const geo = await lookupDistance(order.addressSnapshot, null, false, settings);
        const [customer] = await tx.select({ until: schema.users.freeDeliveryUntil }).from(schema.users).where(eq(schema.users.id, order.userId));
        result = computeOrderFreight({ distanceKm: geo.code === 'OK' ? Math.round(geo.distanceMeters! / 10) / 100 : null, itemsSubtotal: Number(order.subtotal), rules: freightRulesFromSettings(settings), customerFreeDeliveryUntil: customer?.until });
      }
      if (entry.action === 'CANCEL' || result?.status === 'OUT_OF_DELIVERY_AREA') {
        const reason = entry.reason === 'CITY_NOT_SERVED' ? 'Atendemos apenas Itatiba' : result?.message || 'Não entregamos nessa região.';
        if (await cancelUnpaidLegacy(tx, order, reason, req.user!.id)) counts.cancelled++; else counts.skipped++;
        entries.push({ orderId: order.id, action: 'CANCELLED', reason });
      } else if (result.status === 'OK') {
        await tx.update(schema.orders).set({ deliveryFee: result.finalFee.toFixed(2), deliveryDistanceKm: result.distanceKm.toFixed(2), deliveryFeeSource: result.source, total: (Number(order.subtotal) + result.finalFee).toFixed(2), paymentExpiresAt: computePaymentExpiresAt(Number(settings.payment_deadline_hours || 0.5)), updatedAt: new Date() }).where(and(eq(schema.orders.id, order.id), pending()));
        await tx.insert(schema.notifications).values({ userId: order.userId, orderId: order.id, orderNumber: order.orderNumber, oldStatus: order.status, newStatus: order.status, title: 'Frete calculado: pagamento liberado', message: 'O frete foi calculado automaticamente. O pagamento está liberado.' });
        counts.released++; entries.push({ orderId: order.id, action: 'RELEASED', deliveryFee: result.finalFee, distanceKm: result.distanceKm });
      } else { counts.failed++; entries.push({ orderId: order.id, action: 'FAILED', code: result.status }); }
      await tx.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'LEGACY_FREIGHT_ORDER', entityType: 'order', entityId: String(order.id), details: { dryRunId: id, ...entries[entries.length - 1] } });
    }
    const result = { counts, entries };
    await tx.update(schema.freightLegacyRuns).set({ executedAt: new Date(), result }).where(eq(schema.freightLegacyRuns.id, id));
    await tx.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'LEGACY_FREIGHT_EXECUTED', entityType: 'freight_run', entityId: id, details: counts });
    return { dryRunId: id, ...result };
  });
}
