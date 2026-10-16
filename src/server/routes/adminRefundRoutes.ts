import type { Express, NextFunction, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { audit } from './adminPhase3Routes.ts';
import { deriveOrderStatusFromFulfillments } from '../services/storeHelpers.ts';

/**
 * Etapa 2C — fila de reembolsos.
 * - Somente o dono (SUPER_ADMIN) decide.
 * - Valor aprovado editável, limitado ao valor dos itens da encomenda ainda não reembolsados (frete/corrida nunca entra).
 * - Prazo de análise de 24h: ao vencer, apenas sinaliza (tela + aviso interno); nunca aprova sozinho.
 * - A devolução do dinheiro é feita manualmente pelo dono, fora do sistema; aqui só se registra.
 * - Sem chamadas externas (Mercado Pago, WhatsApp etc.).
 */
const REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED'];
const DAY_MS = 86_400_000;
export const REFUND_REVIEW_HOURS = 24;

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function safeText(value: unknown, max: number): string { return String(value ?? '').trim().slice(0, max); }
/** Aceita 8, "8.5", "8,50"; devolve string com 2 casas ou null. */
export function parseMoney(value: unknown): string | null {
  const raw = String(value ?? '').trim().replace(/^R\$\s*/i, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return cents > 0 ? (cents / 100).toFixed(2) : null;
}
export function formatBRL(value: string | number): string { return `R$ ${Number(value).toFixed(2).replace('.', ',')}`; }

async function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const found = await db.execute(sql`SELECT role FROM users WHERE id=${req.user!.id}`);
    if ((found.rows[0] as any)?.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Somente o dono da loja pode decidir reembolsos.', code: 'OWNER_REQUIRED' });
    return next();
  } catch { return res.status(500).json({ error: 'Erro interno do servidor.' }); }
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

/** Valor máximo reembolsável: itens da encomenda do pedido − outros reembolsos ativos da mesma entrega. */
const MAX_AMOUNT_SQL = (refundAlias = 'r') => sql.raw(`GREATEST(
  COALESCE((SELECT SUM(oi.subtotal::numeric) FROM order_items oi WHERE oi.order_id=${refundAlias}.order_id AND oi.fulfillment_type='PREORDER'),0)
  - COALESCE((SELECT SUM(COALESCE(x.approved_amount, x.amount)::numeric) FROM refunds x WHERE x.fulfillment_id=${refundAlias}.fulfillment_id AND x.id <> ${refundAlias}.id AND x.status <> 'REJECTED'),0), 0)`);

function publicRefund(row: any) {
  const due = row.due_at ? new Date(row.due_at) : null;
  const open = row.status === 'REQUESTED';
  return {
    id: Number(row.id), status: row.status, scope: row.scope, reason: row.reason, requestedBy: row.requested_by,
    requestedAmount: String(row.amount), approvedAmount: row.approved_amount == null ? null : String(row.approved_amount),
    maxAmount: String(row.max_amount ?? row.amount), createdAt: row.created_at, dueAt: row.due_at,
    overdue: Boolean(open && due && due.getTime() < Date.now()),
    hoursLeft: open && due ? Math.round(((due.getTime() - Date.now()) / 3_600_000) * 10) / 10 : null,
    decidedAt: row.decided_at, decisionReason: row.decision_reason, processedAt: row.processed_at, notes: row.notes,
    order: { id: Number(row.order_id), orderNumber: row.order_number, deliveryFee: row.delivery_fee },
    customer: { id: Number(row.customer_id), name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    payment: row.provider_payment_id || row.provider_order_id ? { providerOrderId: row.provider_order_id, providerPaymentId: row.provider_payment_id, status: row.payment_status, amount: row.payment_amount } : null,
    fulfillmentId: row.fulfillment_id ? Number(row.fulfillment_id) : null, items: row.items || [],
  };
}

async function listRefunds(status: string | null) {
  const where = status ? sql`WHERE r.status = ${status}` : sql``;
  const result = await db.execute(sql`
    SELECT r.*, o.order_number, o.delivery_fee, u.id AS customer_id, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
      pay.provider_order_id, pay.provider_payment_id, pay.status AS payment_status, pay.amount::text AS payment_amount,
      (${MAX_AMOUNT_SQL()})::numeric(14,2)::text AS max_amount,
      (SELECT COALESCE(json_agg(json_build_object('name',oi.product_name,'quantity',oi.quantity,'subtotal',oi.subtotal) ORDER BY oi.id), '[]'::json)
         FROM order_items oi WHERE oi.order_id=r.order_id AND oi.fulfillment_type='PREORDER') AS items
    FROM refunds r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=o.user_id LEFT JOIN payments pay ON pay.order_id=r.order_id
    ${where}
    ORDER BY CASE r.status WHEN 'REQUESTED' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, r.due_at NULLS LAST, r.created_at DESC
    LIMIT 300`);
  return (result.rows as any[]).map(publicRefund);
}

/** Cria um único aviso interno por reembolso vencido (idempotente via admin_event_keys). */
export async function flagOverdueRefunds(): Promise<number> {
  const due = await db.execute(sql`SELECT r.id, r.order_id, o.order_number FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.status='REQUESTED' AND r.due_at IS NOT NULL AND r.due_at < NOW()`);
  let created = 0;
  for (const row of due.rows as any[]) {
    await db.transaction(async (tx) => {
      const [key] = await tx.insert(schema.adminEventKeys).values({ eventKey: `refund-overdue:${row.id}`, eventType: 'REFUND_OVERDUE' }).onConflictDoNothing().returning();
      if (!key) return;
      await tx.insert(schema.adminNotifications).values({ type: 'REFUND_OVERDUE', orderId: Number(row.order_id), title: 'Reembolso aguardando decisão há mais de 24h', message: `O pedido ${row.order_number} tem um reembolso pendente fora do prazo de 24 horas.` });
      created += 1;
    });
  }
  return created;
}

export function registerAdminRefundRoutes(app: Express) {
  const guard = [requireAuth, requireAdmin, requireOwner];

  app.get('/api/admin/refunds', ...guard, async (req, res) => {
    try {
      const status = REFUND_STATUSES.includes(String(req.query.status)) ? String(req.query.status) : null;
      await flagOverdueRefunds().catch(() => 0);
      const refunds = await listRefunds(status);
      res.json({
        refunds,
        pendingCount: refunds.filter((r) => r.status === 'REQUESTED').length,
        overdueCount: refunds.filter((r) => r.overdue).length,
        awaitingPaymentCount: refunds.filter((r) => r.status === 'APPROVED').length,
      });
    } catch { res.status(500).json({ error: 'Não foi possível carregar os reembolsos.' }); }
  });

  // Aprovar (com valor opcionalmente ajustado)
  app.post('/api/admin/refunds/:id/approve', ...guard, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); if (!id) return res.status(400).json({ error: 'Reembolso inválido.' });
    const requested = req.body?.amount;
    const adjusted = requested === undefined || requested === null || requested === '' ? null : parseMoney(requested);
    if (requested !== undefined && requested !== null && requested !== '' && !adjusted) return res.status(400).json({ error: 'Valor inválido. Use um valor maior que zero, por exemplo 8,50.' });
    try {
      const out = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT r.*, o.order_number, o.user_id, (${MAX_AMOUNT_SQL()})::numeric(14,2)::text AS max_amount FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.id=${id} FOR UPDATE OF r`);
        const row: any = locked.rows[0]; if (!row) return { code: 404, error: 'Reembolso não encontrado.' };
        if (row.status !== 'REQUESTED') return { code: 409, error: 'Este reembolso já foi decidido.' };
        const amount = adjusted || String(row.amount);
        if (Number(amount) > Number(row.max_amount) + 1e-9) return { code: 400, error: `O valor não pode passar de ${formatBRL(row.max_amount)} (itens da encomenda ainda não reembolsados; o frete não entra).` };
        if (Number(row.max_amount) <= 0) return { code: 400, error: 'Não há valor de itens a reembolsar nesta encomenda.' };
        const note = safeText(req.body?.note, 500) || null;
        await tx.execute(sql`UPDATE refunds SET status='APPROVED', approved_amount=${amount}, decided_by=${req.user!.id}, decided_at=NOW(), decision_reason=${note} WHERE id=${id}`);
        await tx.insert(schema.notifications).values({ userId: Number(row.user_id), orderId: Number(row.order_id), orderNumber: row.order_number, newStatus: null, kind: 'REFUND_DECISION', title: 'Reembolso aprovado', message: `Seu reembolso de ${formatBRL(amount)} foi aprovado. A loja fará a devolução e você será avisado quando for concluída.`, isRead: false, popupDismissed: false });
        return { code: 200, id, status: 'APPROVED', approvedAmount: amount };
      });
      if (out.code !== 200) return res.status((out as any).code).json({ error: (out as any).error });
      await audit(req, 'REFUND_APPROVE', 'REFUND', id, { amount: (out as any).approvedAmount });
      return res.json(out);
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível aprovar o reembolso.' }); }
  });

  // Recusar (motivo obrigatório)
  app.post('/api/admin/refunds/:id/reject', ...guard, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); if (!id) return res.status(400).json({ error: 'Reembolso inválido.' });
    const reason = safeText(req.body?.reason, 500);
    if (reason.length < 3) return res.status(400).json({ error: 'Informe o motivo da recusa.' });
    try {
      const out = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT r.*, o.order_number, o.user_id FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.id=${id} FOR UPDATE OF r`);
        const row: any = locked.rows[0]; if (!row) return { code: 404, error: 'Reembolso não encontrado.' };
        if (row.status !== 'REQUESTED') return { code: 409, error: 'Este reembolso já foi decidido.' };
        await tx.execute(sql`UPDATE refunds SET status='REJECTED', decided_by=${req.user!.id}, decided_at=NOW(), decision_reason=${reason} WHERE id=${id}`);
        await tx.insert(schema.notifications).values({ userId: Number(row.user_id), orderId: Number(row.order_id), orderNumber: row.order_number, newStatus: null, kind: 'REFUND_DECISION', title: 'Reembolso não aprovado', message: `Seu pedido de reembolso não foi aprovado. Motivo: ${reason}`, isRead: false, popupDismissed: false });
        return { code: 200, id, status: 'REJECTED' };
      });
      if (out.code !== 200) return res.status((out as any).code).json({ error: (out as any).error });
      await audit(req, 'REFUND_REJECT', 'REFUND', id, { reason });
      return res.json(out);
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível recusar o reembolso.' }); }
  });

  // Registrar que o dono já devolveu o dinheiro por fora
  app.post('/api/admin/refunds/:id/mark-refunded', ...guard, sameOrigin, async (req: AuthRequest, res) => {
    const id = positiveId(req.params.id); if (!id) return res.status(400).json({ error: 'Reembolso inválido.' });
    const note = safeText(req.body?.note, 500) || null;
    try {
      const out = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT r.*, o.order_number, o.user_id, o.status AS order_status, (${MAX_AMOUNT_SQL()})::numeric(14,2)::text AS max_amount FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.id=${id} FOR UPDATE OF r`);
        const row: any = locked.rows[0]; if (!row) return { code: 404, error: 'Reembolso não encontrado.' };
        if (row.status !== 'APPROVED') return { code: 409, error: row.status === 'PROCESSED' ? 'Este reembolso já foi marcado como devolvido.' : 'Aprove o reembolso antes de marcar como devolvido.' };
        await tx.execute(sql`UPDATE refunds SET status='PROCESSED', processed_by=${req.user!.id}, processed_at=NOW(), notes=${note} WHERE id=${id}`);
        // Devolução total da parte encomenda => a entrega passa a REFUNDED e o status do pedido é recalculado.
        let fulfillmentRefunded = false; let orderStatus = row.order_status;
        if (row.fulfillment_id && Number(row.approved_amount) + 1e-9 >= Number(row.max_amount)) {
          const changed = await tx.execute(sql`UPDATE order_fulfillments SET status='REFUNDED' WHERE id=${row.fulfillment_id} AND status NOT IN ('DELIVERED','CANCELLED','REFUNDED') RETURNING id`);
          if (changed.rows[0]) {
            fulfillmentRefunded = true;
            const all = await tx.execute(sql`SELECT status FROM order_fulfillments WHERE order_id=${row.order_id}`);
            const next = deriveOrderStatusFromFulfillments(row.order_status, all.rows as any);
            if (next !== row.order_status) {
              await tx.execute(sql`UPDATE orders SET status=${next}, updated_at=NOW(), delivered_at=${next === 'DELIVERED' ? new Date() : null} WHERE id=${row.order_id}`);
              await tx.insert(schema.orderStatusHistory).values({ orderId: Number(row.order_id), oldStatus: row.order_status, newStatus: next, changedBy: req.user!.id });
              orderStatus = next;
            }
          }
        }
        await tx.insert(schema.notifications).values({ userId: Number(row.user_id), orderId: Number(row.order_id), orderNumber: row.order_number, newStatus: null, kind: 'REFUND_DECISION', title: 'Reembolso concluído', message: `A devolução de ${formatBRL(row.approved_amount)} do pedido ${row.order_number} foi realizada pela loja.`, isRead: false, popupDismissed: false });
        return { code: 200, id, status: 'PROCESSED', fulfillmentRefunded, orderStatus };
      });
      if (out.code !== 200) return res.status((out as any).code).json({ error: (out as any).error });
      await audit(req, 'REFUND_MARK_REFUNDED', 'REFUND', id, { fulfillmentRefunded: (out as any).fulfillmentRefunded });
      return res.json(out);
    } catch (error: any) { return res.status(400).json({ error: error?.message || 'Não foi possível registrar a devolução.' }); }
  });

  // Alerta interno de reembolsos vencidos (a cada 10 min); não decide nada sozinho.
  if (process.env.NODE_ENV !== 'test') {
    const timer = setInterval(() => { void flagOverdueRefunds().catch(() => undefined); }, 10 * 60_000);
    timer.unref?.();
  }
}
