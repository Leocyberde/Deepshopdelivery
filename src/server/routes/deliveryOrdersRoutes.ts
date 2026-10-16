import type { Express, NextFunction, Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { audit } from './adminPhase3Routes.ts';
import { buildStatusNotificationTexts, deriveOrderStatusFromFulfillments } from '../services/storeHelpers.ts';

const FINAL_STATUSES = ['DELIVERED', 'CANCELLED', 'REFUNDED'];
const FULFILLMENT_STATUSES = ['PENDING', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
const NOTIFICATION_TEMPLATES: Record<string, string> = {
  TOMORROW: 'Seu pedido {order} chegará amanhã.',
  HOURS: 'Seu pedido {order} chegará daqui a {n} horas.',
  TODAY: 'Seu pedido {order} chegará hoje até às {hh}h.',
  OUT_FOR_DELIVERY: 'Seu pedido {order} saiu para entrega.',
};

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function sameOrigin(req: AuthRequest, res: Response, next: NextFunction) {
  const origin = req.get('Origin');
  if (!origin) return res.status(403).json({ error: 'Origem da solicitação ausente.' });
  let actual: string; try { actual = new URL(origin).origin; } catch { return res.status(403).json({ error: 'Origem inválida.' }); }
  let configured: string | null = null; try { configured = process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : null; } catch { configured = null; }
  const expected = configured || (req.get('host') ? `${req.protocol}://${req.get('host')}` : null);
  if (!expected || actual !== expected) return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
  return next();
}
function safeText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}
function addDays(date: Date, days: number): Date { return new Date(date.getTime() + days * 86_400_000); }
function publicFulfillment(row: any) {
  return {
    id: Number(row.id), type: row.type, status: row.status, etaAt: row.eta_at, etaStart: row.eta_start, etaEnd: row.eta_end,
    deliveredAt: row.delivered_at, order: { id: Number(row.order_id), orderNumber: row.order_number, status: row.order_status, total: row.order_total, deliveryFee: row.delivery_fee },
    customer: { id: Number(row.customer_id), name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    supplier: row.supplier_id ? { id: Number(row.supplier_id), name: row.supplier_name, website: row.supplier_website } : null,
    items: row.items || [], values: { subtotal: row.part_subtotal || '0.00', refunded: row.refunded || '0.00' },
    mixed: Boolean(row.mixed), overdue: row.type === 'PREORDER' && row.eta_end ? new Date(row.eta_end).getTime() < Date.now() && !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(row.status) : false,
  };
}
async function enrichedFulfillments(type: string | null, query: any) {
  const filters: any[] = [];
  if (type) filters.push(sql`f.type = ${type}`);
  if (query.status && FULFILLMENT_STATUSES.includes(String(query.status))) filters.push(sql`f.status = ${String(query.status)}`);
  if (query.supplierId && positiveId(query.supplierId)) filters.push(sql`p.supplier_id = ${Number(query.supplierId)}`);
  if (query.overdue === 'true') filters.push(sql`f.type = 'PREORDER' AND f.eta_end < NOW() AND f.status NOT IN ('DELIVERED','CANCELLED','REFUNDED')`);
  const where = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const result = await db.execute(sql`
    SELECT f.*, o.order_number, o.status AS order_status, o.total AS order_total, o.delivery_fee,
      u.id AS customer_id, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
      s.id AS supplier_id, s.name AS supplier_name, s.website AS supplier_website,
      COALESCE((SELECT SUM(oi.subtotal::numeric) FROM order_items oi WHERE oi.order_id=f.order_id AND oi.fulfillment_type=f.type), 0)::text AS part_subtotal,
      COALESCE((SELECT SUM(r.amount::numeric) FROM refunds r WHERE r.fulfillment_id=f.id AND r.status <> 'REJECTED'), 0)::text AS refunded,
      (SELECT COALESCE(json_agg(json_build_object('id',oi.id,'productId',oi.product_id,'name',oi.product_name,'quantity',oi.quantity,'unitPrice',oi.unit_price,'subtotal',oi.subtotal) ORDER BY oi.id), '[]'::json)
       FROM order_items oi WHERE oi.order_id=f.order_id AND oi.fulfillment_type=f.type) AS items,
      ((SELECT COUNT(*) FROM order_fulfillments fx WHERE fx.order_id=f.order_id) > 1) AS mixed
    FROM order_fulfillments f
    JOIN orders o ON o.id=f.order_id
    JOIN users u ON u.id=o.user_id
    LEFT JOIN LATERAL (SELECT p.supplier_id FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=f.order_id AND oi.fulfillment_type=f.type LIMIT 1) p ON TRUE
    LEFT JOIN suppliers s ON s.id=p.supplier_id
    ${where}
    ORDER BY CASE WHEN f.type='PREORDER' AND f.eta_end < NOW() AND f.status NOT IN ('DELIVERED','CANCELLED','REFUNDED') THEN 0 ELSE 1 END, f.eta_end NULLS LAST, f.created_at DESC
    LIMIT 200`);
  return (result.rows as any[]).map(publicFulfillment);
}
function notificationText(body: any, orderNumber: string): { title: string; message: string } {
  const kind = safeText(body?.template, 40).toUpperCase();
  const custom = safeText(body?.message, 1000);
  if (custom) return { title: safeText(body?.title, 160) || `Atualização do pedido ${orderNumber}`, message: custom };
  const raw = NOTIFICATION_TEMPLATES[kind] || NOTIFICATION_TEMPLATES.OUT_FOR_DELIVERY;
  const hours = Math.max(1, Math.min(72, Number(body?.hours) || 2));
  const hh = safeText(body?.hour, 5) || '18';
  return { title: kind === 'OUT_FOR_DELIVERY' ? 'Saiu para entrega' : 'Atualização do pedido', message: raw.replace('{order}', orderNumber).replace('{n}', String(hours)).replace('{hh}', hh) };
}

export function registerDeliveryOrdersRoutes(app: Express) {
  app.get('/api/admin/fulfillments', requireAuth, requireAdmin, async (req, res) => {
    try {
      const type = req.query.type === 'PREORDER' || req.query.type === 'DELIVERY' ? String(req.query.type) : null;
      const fulfillments = await enrichedFulfillments(type, req.query);
      res.json({ fulfillments, pendingCount: fulfillments.filter((f) => ['PENDING', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(f.status)).length });
    } catch { res.status(500).json({ error: 'Não foi possível carregar os pedidos separados.' }); }
  });
  app.patch('/api/admin/fulfillments/:id/status', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); const status = safeText(req.body?.status, 30).toUpperCase();
    if (!id || !FULFILLMENT_STATUSES.includes(status)) return res.status(400).json({ error: 'Fulfillment ou status inválido.' });
    try {
      const result = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT f.*, o.status AS order_status, o.user_id, o.order_number FROM order_fulfillments f JOIN orders o ON o.id=f.order_id WHERE f.id=${id} FOR UPDATE`);
        const current: any = locked.rows[0]; if (!current) return null;
        if (status === 'DELIVERED') {
          const open = await tx.execute(sql`SELECT 1 FROM refunds WHERE fulfillment_id=${id} AND status IN ('REQUESTED','APPROVED') LIMIT 1`);
          if (open.rows[0]) throw new Error('Há um reembolso em andamento para esta parte do pedido; conclua ou recuse o reembolso antes de marcar como entregue.');
        }
        if (['NEW', 'AWAITING_PAYMENT', 'CANCELLED'].includes(current.order_status)) throw new Error('Pedido ainda não está pago ou está cancelado.');
        const allowed: Record<string, string[]> = { PENDING: ['PREPARING', 'CANCELLED'], PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'], OUT_FOR_DELIVERY: ['DELIVERED'], DELIVERED: [] };
        if (current.status !== status && !allowed[current.status]?.includes(status)) throw new Error('Transição de status inválida.');
        const changed = await tx.execute(sql`UPDATE order_fulfillments SET status=${status}, delivered_at=${status === 'DELIVERED' ? new Date() : null}, delivered_by=${status === 'DELIVERED' ? req.user!.id : null} WHERE id=${id} AND status=${current.status} RETURNING *`);
        if (!changed.rows[0]) throw new Error('Fulfillment alterado em simultâneo.');
        const all = await tx.execute(sql`SELECT status FROM order_fulfillments WHERE order_id=${current.order_id}`);
        const nextStatus = deriveOrderStatusFromFulfillments(current.order_status, all.rows as any);
        if (nextStatus !== current.order_status) {
          await tx.execute(sql`UPDATE orders SET status=${nextStatus}, updated_at=NOW(), delivered_at=${nextStatus === 'DELIVERED' ? new Date() : null} WHERE id=${current.order_id}`);
          await tx.insert(schema.orderStatusHistory).values({ orderId: Number(current.order_id), oldStatus: current.order_status, newStatus: nextStatus, changedBy: req.user!.id });
          const statusText = buildStatusNotificationTexts(current.order_number, current.order_status, nextStatus);
          await tx.insert(schema.notifications).values({ userId: Number(current.user_id), orderId: Number(current.order_id), orderNumber: current.order_number, oldStatus: current.order_status, newStatus: nextStatus, title: statusText.title, message: statusText.message, isRead: false, popupDismissed: false });
        }
        return { fulfillment: changed.rows[0], orderStatus: nextStatus };
      });
      if (!result) return res.status(404).json({ error: 'Fulfillment não encontrado.' });
      await audit(req, 'FULFILLMENT_STATUS_UPDATE', 'ORDER_FULFILLMENT', id, { status });
      return res.json(result);
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível alterar o status.' }); }
  });
  app.post('/api/admin/fulfillments/:id/notify', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); if (!id) return res.status(400).json({ error: 'Fulfillment inválido.' });
    try {
      const found = await db.execute(sql`SELECT f.id, f.order_id, o.order_number, o.user_id FROM order_fulfillments f JOIN orders o ON o.id=f.order_id JOIN users u ON u.id=o.user_id WHERE f.id=${id}`);
      const row: any = found.rows[0]; if (!row) return res.status(404).json({ error: 'Fulfillment não encontrado.' });
      const text = notificationText(req.body, row.order_number);
      const [notification] = await db.insert(schema.notifications).values({ userId: Number(row.user_id), orderId: Number(row.order_id), orderNumber: row.order_number, newStatus: null, kind: 'OWNER_MESSAGE', title: text.title, message: text.message, isRead: false, popupDismissed: false }).returning();
      await audit(req, 'CUSTOMER_NOTIFICATION_CREATE', 'NOTIFICATION', notification.id, { orderId: row.order_id, kind: 'OWNER_MESSAGE' });
      return res.status(201).json({ notification });
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível avisar o cliente.' }); }
  });
  app.post('/api/admin/fulfillments/notify-batch', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try {
      const type = req.body?.type === 'PREORDER' || req.body?.type === 'DELIVERY' ? String(req.body.type) : null;
      const rows = await enrichedFulfillments(type, { supplierId: req.body?.supplierId, overdue: req.body?.overdue });
      // Só avisa partes ainda em andamento e no máximo uma vez por pedido.
      const seenOrders = new Set<number>();
      const selected = rows.filter((item) => {
        if (FINAL_STATUSES.includes(item.status) || seenOrders.has(item.order.id)) return false;
        seenOrders.add(item.order.id); return true;
      });
      const skipped = rows.length - selected.length;
      await db.transaction(async (tx) => {
        for (const item of selected) {
          const text = notificationText(req.body, item.order.orderNumber);
          await tx.insert(schema.notifications).values({ userId: item.customer.id, orderId: item.order.id, orderNumber: item.order.orderNumber, newStatus: null, kind: 'OWNER_MESSAGE', title: text.title, message: text.message, isRead: false, popupDismissed: false });
        }
      });
      await audit(req, 'CUSTOMER_NOTIFICATION_BATCH', 'NOTIFICATION', null, { count: selected.length, skipped, type });
      return res.status(201).json({ sent: selected.length, skipped, truncated: rows.length >= 200 });
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível enviar em lote.' }); }
  });
  app.post('/api/admin/fulfillments/:id/delay-notice', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); if (!id) return res.status(400).json({ error: 'Fulfillment inválido.' });
    const waitDays = Math.max(1, Math.min(30, Number(req.body?.waitDays) || 2));
    const message = safeText(req.body?.message, 1000) || 'Houve um atraso na sua encomenda. Escolha uma opção para continuarmos.';
    try {
      const outcome = await db.transaction(async (tx) => {
        const linked = await tx.execute(sql`SELECT f.order_id, f.type, f.status, o.user_id, o.order_number FROM order_fulfillments f JOIN orders o ON o.id=f.order_id WHERE f.id=${id} FOR UPDATE OF f`);
        const row: any = linked.rows[0]; if (!row) return { code: 404, error: 'Fulfillment não encontrado.' };
        if (row.type !== 'PREORDER') return { code: 400, error: 'Aviso de atraso só vale para encomendas.' };
        if (FINAL_STATUSES.includes(row.status)) return { code: 409, error: 'Esta encomenda já foi finalizada.' };
        const pending = await tx.execute(sql`SELECT 1 FROM delay_notices WHERE fulfillment_id=${id} AND status='PENDING' LIMIT 1`);
        if (pending.rows[0]) return { code: 409, error: 'Já existe um aviso de atraso aguardando resposta para esta encomenda.' };
        const refunded = await tx.execute(sql`SELECT 1 FROM refunds WHERE fulfillment_id=${id} AND status <> 'REJECTED' LIMIT 1`);
        if (refunded.rows[0]) return { code: 409, error: 'Esta encomenda já tem reembolso solicitado.' };
        const orderId = Number(row.order_id);
        const [notice] = await tx.insert(schema.delayNotices).values({ fulfillmentId: id, orderId, message, waitDays, options: { WAIT: true, EXCHANGE: true, REFUND: true }, createdBy: req.user!.id }).returning();
        await tx.insert(schema.notifications).values({ userId: Number(row.user_id), orderId, orderNumber: row.order_number, newStatus: null, kind: 'DELAY_NOTICE', title: 'Sua encomenda está atrasada', message: `${message} Escolha: aguardar, trocar por outro produto ou solicitar reembolso.`, isRead: false, popupDismissed: false });
        return { code: 201, notice };
      });
      if (outcome.code !== 201) return res.status(outcome.code).json({ error: (outcome as any).error });
      await audit(req, 'DELAY_NOTICE_CREATE', 'DELAY_NOTICE', (outcome as any).notice.id, { fulfillmentId: id, waitDays });
      return res.status(201).json({ notice: (outcome as any).notice });
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível criar o aviso de atraso.' }); }
  });
  app.get('/api/admin/delay-notices', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await db.execute(sql`SELECT d.id, d.order_id, d.fulfillment_id, d.message, d.wait_days, d.created_at, o.order_number, u.name AS customer_name, f.eta_end,
        COALESCE((SELECT string_agg(oi.product_name || ' x' || oi.quantity, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id=d.order_id AND oi.fulfillment_type='PREORDER'), '') AS items
        FROM delay_notices d JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=o.user_id JOIN order_fulfillments f ON f.id=d.fulfillment_id
        WHERE d.status='PENDING' ORDER BY d.created_at DESC LIMIT 200`);
      res.json({ notices: (result.rows as any[]).map((r) => ({ id: Number(r.id), orderId: Number(r.order_id), fulfillmentId: Number(r.fulfillment_id), orderNumber: r.order_number, customerName: r.customer_name, items: r.items, message: r.message, waitDays: Number(r.wait_days), etaEnd: r.eta_end, createdAt: r.created_at })) });
    } catch { res.status(500).json({ error: 'Não foi possível carregar os avisos pendentes.' }); }
  });
  app.get('/api/delay-notices', requireAuth, async (req: AuthRequest, res) => {
    const notices = await db.execute(sql`SELECT d.* FROM delay_notices d JOIN orders o ON o.id=d.order_id WHERE o.user_id=${req.user!.id} AND d.status='PENDING' ORDER BY d.created_at DESC`);
    res.json({ notices: notices.rows });
  });
  app.post('/api/delay-notices/:id/respond', requireAuth, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); const choice = safeText(req.body?.choice, 20).toUpperCase();
    if (!id || !['WAIT', 'EXCHANGE', 'REFUND'].includes(choice)) return res.status(400).json({ error: 'Resposta inválida.' });
    try {
      const result = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT d.*, f.eta_end, f.status AS fulfillment_status, o.order_number, o.user_id, o.total, u.phone FROM delay_notices d JOIN order_fulfillments f ON f.id=d.fulfillment_id JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=o.user_id WHERE d.id=${id} AND o.user_id=${req.user!.id} FOR UPDATE`);
        const notice: any = locked.rows[0]; if (!notice) throw new Error('Aviso não encontrado.');
        if (notice.status !== 'PENDING') return { duplicate: true, choice: notice.choice };
        if (FINAL_STATUSES.includes(notice.fulfillment_status)) {
          await tx.update(schema.delayNotices).set({ status: 'CANCELLED', answeredAt: new Date() }).where(eq(schema.delayNotices.id, id));
          return { expired: true };
        }
        let ticketId: number | null = null; let refundId: number | null = null;
        if (choice === 'WAIT') {
          const base = notice.eta_end ? new Date(notice.eta_end) : new Date();
          const next = addDays(base > new Date() ? base : new Date(), Number(notice.wait_days));
          await tx.execute(sql`UPDATE order_fulfillments SET eta_end=${next} WHERE id=${notice.fulfillment_id}`);
          await tx.insert(schema.notifications).values({ userId: req.user!.id, orderId: notice.order_id, orderNumber: notice.order_number, newStatus: null, kind: 'DELAY_RESPONSE', title: 'Novo prazo da encomenda', message: `Registramos sua escolha. A nova previsão é ${next.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, isRead: false, popupDismissed: false });
        } else if (choice === 'EXCHANGE') {
          const [ticket] = await tx.insert(schema.supportTickets).values({ userId: req.user!.id, orderId: notice.order_id, subject: 'AJUDA_COM_PEDIDO', status: 'OPEN', supportReason: 'DELAY_EXCHANGE', postDelivery: false, initiatedByUserId: req.user!.id }).returning();
          ticketId = ticket.id;
          await tx.insert(schema.supportMessages).values({ ticketId: ticket.id, authorUserId: req.user!.id, body: 'Cliente solicitou troca de produto devido a atraso.', createdAt: new Date() });
          await tx.insert(schema.notifications).values({ userId: req.user!.id, orderId: notice.order_id, supportTicketId: ticket.id, orderNumber: notice.order_number, newStatus: null, kind: 'DELAY_RESPONSE', title: 'Troca solicitada', message: 'Abrimos um atendimento para escolher outro produto da loja.', isRead: false, popupDismissed: false });
        } else {
          const calc = await tx.execute(sql`SELECT
            GREATEST(COALESCE((SELECT SUM(subtotal::numeric) FROM order_items WHERE order_id=${notice.order_id} AND fulfillment_type='PREORDER'),0)
              - COALESCE((SELECT SUM(amount::numeric) FROM refunds WHERE fulfillment_id=${notice.fulfillment_id} AND status <> 'REJECTED'),0), 0)::numeric(12,2)::text AS amount,
            EXISTS(SELECT 1 FROM refunds WHERE fulfillment_id=${notice.fulfillment_id} AND status <> 'REJECTED') AS has_refund`);
          const calcRow: any = calc.rows[0];
          if (calcRow?.has_refund) throw new Error('Já existe um reembolso solicitado para esta encomenda.');
          const amount = String(calcRow?.amount || '0.00');
          if (Number(amount) <= 0) throw new Error('Não há valor de encomenda a reembolsar.');
          const [refund] = await tx.insert(schema.refunds).values({ orderId: notice.order_id, fulfillmentId: notice.fulfillment_id, amount, scope: 'PREORDER_PART', reason: 'Atraso da encomenda', requestedBy: 'DELAY_NOTICE', status: 'REQUESTED', dueAt: new Date(Date.now() + 24 * 3_600_000) }).returning();
          refundId = refund.id;
          await tx.insert(schema.notifications).values({ userId: req.user!.id, orderId: notice.order_id, orderNumber: notice.order_number, newStatus: null, kind: 'DELAY_RESPONSE', title: 'Reembolso solicitado', message: 'Sua solicitação de reembolso foi registrada e será analisada pela loja em até 24 horas.', isRead: false, popupDismissed: false });
        }
        await tx.update(schema.delayNotices).set({ status: 'ANSWERED', choice, answeredAt: new Date() }).where(and(eq(schema.delayNotices.id, id), eq(schema.delayNotices.status, 'PENDING')));
        return { duplicate: false, choice, ticketId, refundId };
      });
      if ((result as any).expired) return res.status(409).json({ error: 'Esta encomenda já foi finalizada; o aviso foi encerrado.' });
      if (!(result as any).duplicate) await audit(req, 'DELAY_NOTICE_RESPOND', 'DELAY_NOTICE', id, { choice });
      return res.json(result);
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível registrar a resposta.' }); }
  });
}
