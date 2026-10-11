import { logServerError, logServerEvent } from '../logger.ts';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { sendCallMeBotMessage } from './callmebotService.ts';
let notificationWatcherStarted = false;

function brl(value: string | number | null | undefined): string {
  const n = Number(value || 0);
  return n.toFixed(2).replace('.', ',');
}

export function buildNewOrderAdminMessage(order: any, itemCount: number): string {
  return `🔔 Novo pedido #${order.orderNumber}. Total: R$ ${brl(order.total)}. Itens: ${itemCount}. Verifique o pedido no painel DeepShop.`;
}

export async function notifyNewOrder(orderId: number, itemCount: number): Promise<void> {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!order) return;

  const [existing] = await db
    .select({ id: schema.adminNotifications.id })
    .from(schema.adminNotifications)
    .where(and(eq(schema.adminNotifications.type, 'NEW_ORDER'), eq(schema.adminNotifications.orderId, orderId)))
    .limit(1);

  if (!existing) {
    await db.insert(schema.adminNotifications).values({
      type: 'NEW_ORDER',
      customerId: order.userId,
      orderId: order.id,
      addressId: null,
      title: `🔔 Novo pedido #${order.orderNumber}`,
      message: `Novo pedido recebido. Total: R$ ${brl(order.total)} · ${itemCount} item(ns).`,
      isRead: false,
      popupDismissed: false,
    });
  }

  const result = await sendCallMeBotMessage(buildNewOrderAdminMessage(order, itemCount));
  if (!result.sent && result.reason !== 'disabled' && result.reason !== 'not_configured') {
    logServerEvent('notification.callmebot.failed', 'warn', {
      orderId: order.id,
      action: 'new_order',
      result: 'failed',
      reason: result.reason,
    });
  }
}

export async function sendDueOrderReminders(): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const candidates = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.status, ['NEW', 'AWAITING_PAYMENT']), lte(schema.orders.createdAt, cutoff), isNull(schema.orders.reminderSentAt)));

  let sent = 0;
  for (const order of candidates) {
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    const result = await sendCallMeBotMessage(
      `⏰ Lembrete: o pedido #${order.orderNumber} ainda aguarda pagamento/ação. Total: R$ ${brl(order.total)}. Itens: ${items.reduce((sum, i) => sum + i.quantity, 0)}.`
    );
    if (result.sent) {
      await db.update(schema.orders).set({ reminderSentAt: new Date(), updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      sent += 1;
    } else if (result.reason === 'disabled' || result.reason === 'not_configured') {
      // Sem configuração não marcamos como enviado: quando o CallMeBot for configurado, o lembrete ainda poderá ser entregue.
      break;
    } else {
      logServerEvent('notification.callmebot.failed', 'warn', {
        orderId: order.id,
        action: 'reminder',
        result: 'failed',
        reason: result.reason,
      });
    }
  }
  return sent;
}

export function startOrderNotificationWatcher() {
  if (notificationWatcherStarted) return;
  notificationWatcherStarted = true;
  sendDueOrderReminders().catch((err) => logServerError('server_operation_failed', err));
  const timer = setInterval(() => {
    sendDueOrderReminders().catch((err) => logServerError('server_operation_failed', err));
  }, 60_000);
  timer.unref();
}
