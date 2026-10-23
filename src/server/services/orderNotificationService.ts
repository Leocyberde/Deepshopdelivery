import { logServerError } from '../logger.ts';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
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
}
