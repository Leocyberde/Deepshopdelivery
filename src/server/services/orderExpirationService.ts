import { logServerError } from '../logger.ts';
import { eq, sql, inArray, and } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { getSettingsMap } from './storeHelpers.ts';
import { evaluateCustomerLoyaltyTickets } from './loyaltyService.ts';
import { recordInventoryMovement } from './inventoryService.ts';

let isExpiringOrders = false;
let expirationWatcherStarted = false;

/**
 * Verifica todos os pedidos pendentes de pagamento ('NEW' ou 'AWAITING_PAYMENT')
 * cujo prazo de pagamento (1h após a liberação do pagamento) já expirou.
 * Cancela automaticamente o pedido e devolve o saldo reservado para os produtos na vitrine.
 */
export async function expireOverdueUnpaidOrders(): Promise<number> {
  if (isExpiringOrders) return 0;
  isExpiringOrders = true;

  try {
    const unpaidOrders = await db
      .select()
      .from(schema.orders)
      .where(inArray(schema.orders.status, ['NEW', 'AWAITING_PAYMENT']));

    if (unpaidOrders.length === 0) return 0;

    const settingsMap = await getSettingsMap();
    const deadlineHours = Math.max(
      0.1,
      parseFloat(settingsMap.payment_deadline_hours || '1') || 1
    );
    const nowMs = Date.now();

    const expiredCandidates = unpaidOrders.filter((ord) => {
      // Se o frete ainda está "A combinar" (deliveryFee === null e não é entrega grátis)
      // e paymentExpiresAt ainda é nulo, o cliente ainda aguarda o Admin definir o frete.
      const hasConfirmedFreight =
        ord.isFirstOrderFreeDelivery ||
        ord.usedFreeDeliveryTicket ||
        (ord.deliveryFee !== null && ord.deliveryFee !== undefined && ord.deliveryFee !== '');

      if (ord.paymentExpiresAt) {
        return new Date(ord.paymentExpiresAt).getTime() <= nowMs;
      }

      if (!hasConfirmedFreight) {
        return false;
      }

      const createdMs = new Date(ord.createdAt).getTime();
      return nowMs - createdMs >= deadlineHours * 3600 * 1000;
    });

    if (expiredCandidates.length === 0) return 0;

    let expiredCount = 0;

    for (const candidate of expiredCandidates) {
      try {
        const didExpire = await db.transaction(async (tx) => {
          const [freshOrder] = await tx
            .select()
            .from(schema.orders)
            .where(eq(schema.orders.id, candidate.id));

          if (
            !freshOrder ||
            (freshOrder.status !== 'NEW' && freshOrder.status !== 'AWAITING_PAYMENT')
          ) {
            return false;
          }

          const hasConfirmedFreight =
            freshOrder.isFirstOrderFreeDelivery ||
            freshOrder.usedFreeDeliveryTicket ||
            (freshOrder.deliveryFee !== null && freshOrder.deliveryFee !== undefined && freshOrder.deliveryFee !== '');
          const freshIsExpired = freshOrder.paymentExpiresAt
            ? new Date(freshOrder.paymentExpiresAt).getTime() <= nowMs
            : hasConfirmedFreight && nowMs - new Date(freshOrder.createdAt).getTime() >= deadlineHours * 3600 * 1000;
          if (!freshIsExpired) return false;

          // Compare-and-set: apenas uma operação que ainda encontra o pedido no estado pendente
          // pode vencer a transição. A devolução de estoque vem depois, dentro da mesma transação.
          const [cancelledOrder] = await tx
            .update(schema.orders)
            .set({
              status: 'CANCELLED',
              stockDeducted: false,
              paymentExpiresAt: null,
              cancellationReason: 'Prazo de 1 hora para pagamento expirou. O pedido foi cancelado automaticamente e os itens voltaram para o estoque da vitrine.',
              updatedAt: new Date(),
            })
            .where(and(
              eq(schema.orders.id, freshOrder.id),
              eq(schema.orders.status, freshOrder.status),
              inArray(schema.orders.status, ['NEW', 'AWAITING_PAYMENT'])
            ))
            .returning();
          if (!cancelledOrder) return false;

          const items = await tx
            .select()
            .from(schema.orderItems)
            .where(eq(schema.orderItems.orderId, freshOrder.id));

          // Devolve o saldo reservado e registra cada produto dentro da transação de expiração.
          if (freshOrder.stockDeducted) {
            const returns = new Map<number, number>();
            for (const item of items) returns.set(item.productId, (returns.get(item.productId) || 0) + item.quantity);
            for (const [productId, quantity] of returns) {
              const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, productId));
              if (!product) throw new Error('Produto associado ao pedido não encontrado.');
              const [restored] = await tx.update(schema.products).set({
                stock: sql`${schema.products.stock} + ${quantity}`,
                status: sql`CASE WHEN ${schema.products.status} = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'ACTIVE' END`,
                updatedAt: new Date(),
              }).where(and(eq(schema.products.id, productId), eq(schema.products.stock, product.stock))).returning();
              if (!restored) throw new Error('O estoque foi alterado por outra operação durante a expiração.');
              await recordInventoryMovement(tx, {
                productId, delta: quantity, beforeStock: product.stock, afterStock: restored.stock,
                movementType: 'ORDER_EXPIRATION_RETURN', reason: `Devolução automática após expiração do pedido #${freshOrder.orderNumber}`,
                actorUserId: null, orderId: freshOrder.id,
                idempotencyKey: `order-expire-return:${freshOrder.id}:${productId}`,
              });
            }
          }

          await tx.insert(schema.orderStatusHistory).values({
            orderId: freshOrder.id,
            oldStatus: freshOrder.status,
            newStatus: 'CANCELLED',
            changedBy: null,
          });

          await tx.insert(schema.notifications).values({
            userId: freshOrder.userId,
            orderId: freshOrder.id,
            orderNumber: freshOrder.orderNumber,
            oldStatus: freshOrder.status,
            newStatus: 'CANCELLED',
            title: `⏰ Prazo de 1h expirado — Pedido #${freshOrder.orderNumber}`,
            message: `O prazo de 1 hora para pagamento do pedido #${freshOrder.orderNumber} terminou e a reserva dos produtos foi cancelada automaticamente. Caso ainda queira os itens, basta fazer um novo pedido na vitrine!`,
            isRead: false,
            popupDismissed: false,
          });

          await evaluateCustomerLoyaltyTickets(freshOrder.userId, tx);
          return true;
        });
        if (didExpire) expiredCount += 1;
      } catch (err) {
        logServerError('server_operation_failed', err);
      }
    }

    return expiredCount;
  } finally {
    isExpiringOrders = false;
  }
}

export function startOrderExpirationWatcher() {
  if (expirationWatcherStarted) return;
  expirationWatcherStarted = true;
  // Executa imediatamente ao subir o servidor e depois a cada 15 segundos
  expireOverdueUnpaidOrders().catch((err) =>
    logServerError('server_operation_failed', err)
  );
  const timer = setInterval(() => {
    expireOverdueUnpaidOrders().catch((err) =>
      logServerError('server_operation_failed', err)
    );
  }, 15000);
  timer.unref();
}
