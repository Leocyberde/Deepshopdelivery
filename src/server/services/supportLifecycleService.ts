import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { logServerError, logServerEvent } from '../logger.ts';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function getDays(key: string, fallback: number) {
  const [row] = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, key));
  const value = Number(row?.value);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}

export async function closeInactiveSupportTickets() {
  if (running) return;
  running = true;
  try {
    const [postDeliveryDays, generalDays] = await Promise.all([
      getDays('support_post_delivery_auto_close_days', 15),
      getDays('support_general_auto_close_days', 30),
    ]);
    const postDeliveryCutoff = sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - (${postDeliveryDays} * INTERVAL '1 day')`;
    const generalCutoff = sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - (${generalDays} * INTERVAL '1 day')`;
    const candidates = await db.select().from(schema.supportTickets).where(and(
      ne(schema.supportTickets.status, 'CLOSED'),
      inArray(schema.supportTickets.status, ['WAITING_CUSTOMER', 'RESOLVED']),
      sql`${schema.supportTickets.createdAt} >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '730 days'`,
      or(
        and(eq(schema.supportTickets.postDelivery, true), sql`${schema.supportTickets.lastStoreMessageAt} <= ${postDeliveryCutoff}`),
        and(eq(schema.supportTickets.postDelivery, false), isNull(schema.supportTickets.orderId), sql`${schema.supportTickets.lastStoreMessageAt} <= ${generalCutoff}`),
      ),
    )).orderBy(desc(schema.supportTickets.updatedAt)).limit(500);
    let closedCount = 0;
    for (const candidate of candidates) {
      const cutoff = candidate.postDelivery ? postDeliveryCutoff : generalCutoff;
      await db.transaction(async (tx) => {
        const [closed] = await tx.update(schema.supportTickets).set({
          status: 'CLOSED', closedAt: sql`CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`, closedByUserId: null,
          closedReason: candidate.postDelivery ? 'AUTO_POST_DELIVERY_TIMEOUT' : 'AUTO_GENERAL_TIMEOUT',
          updatedAt: sql`CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`,
        }).where(and(
          eq(schema.supportTickets.id, candidate.id),
          eq(schema.supportTickets.status, candidate.status),
          sql`${schema.supportTickets.lastStoreMessageAt} <= ${cutoff}`,
        )).returning();
        if (!closed) return;
        let orderNumber = `CHAT-${candidate.id}`;
        if (candidate.orderId) {
          const [order] = await tx.select({ orderNumber: schema.orders.orderNumber }).from(schema.orders).where(eq(schema.orders.id, candidate.orderId));
          if (order?.orderNumber) orderNumber = order.orderNumber;
        }
        await tx.insert(schema.notifications).values({
          userId: candidate.userId, orderId: candidate.orderId, supportTicketId: candidate.id,
          orderNumber, oldStatus: candidate.status, newStatus: 'SUPPORT_CLOSED',
          title: `Atendimento #${candidate.id} encerrado`,
          message: 'O atendimento foi encerrado automaticamente por falta de resposta. O histórico continua disponível na Central de Ajuda.',
          isRead: false, popupDismissed: false, createdAt: sql`CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`,
        });
        closedCount += 1;
      });
    }
    if (closedCount) logServerEvent('support.tickets.auto_closed', 'info', { count: closedCount, postDeliveryDays, generalDays, result: 'committed' });
  } catch (error) {
    logServerError('support.tickets.auto_close.failed', error);
  } finally {
    running = false;
  }
}

export function startSupportLifecycleWatcher() {
  if (timer) return;
  void closeInactiveSupportTickets();
  timer = setInterval(() => void closeInactiveSupportTickets(), 5 * 60 * 1000);
  timer.unref?.();
}
