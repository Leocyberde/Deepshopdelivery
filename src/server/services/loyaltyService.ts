import { isAdminRole } from '../governance.ts';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

export interface CustomerLoyaltySummary {
  freeDeliveryTickets: number;
  earnedAutoTickets: number;
  manualFreeDeliveryTickets: number;
  usedFreeDeliveryTickets: number;
  qualifyingOrdersCount: number;
  ordersInCurrentCycle: number;
  ordersRemainingForNextTicket: number;
  isFirstOrderEligible: boolean;
  eligibleForFirstOrderFreeDelivery: boolean;
  eligibleForFreeDelivery: boolean;
}

// Requisito 1 e 2:
// - Dono da loja (ADMIN) NUNCA tem mensagem/direito de entrega grátis de cliente.
// - Novo cliente (CUSTOMER com 0 pedidos): tem direito a Entrega Grátis no 1º pedido!
// - 2º e 3º pedidos: entrega paga normalmente.
// - Ao completar 3 pedidos (1º grátis + 2º pago + 3º pago), no 4º pedido entra na promoção da Entrega Grátis também (ganha +1 Ticket acumulativo).
export async function evaluateCustomerLoyaltyTickets(
  userId: number | null | undefined,
  txOrDb: any = db
): Promise<CustomerLoyaltySummary> {
  if (!userId) {
    return {
      freeDeliveryTickets: 0,
      earnedAutoTickets: 0,
      manualFreeDeliveryTickets: 0,
      usedFreeDeliveryTickets: 0,
      qualifyingOrdersCount: 0,
      ordersInCurrentCycle: 0,
      ordersRemainingForNextTicket: 3,
      isFirstOrderEligible: false,
      eligibleForFirstOrderFreeDelivery: false,
      eligibleForFreeDelivery: false,
    };
  }

  const [userRow] = await txOrDb
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  // Se não existir ou se for ADMIN (dono da loja), nunca exibe nem concede entrega grátis de cliente
  if (!userRow || isAdminRole(userRow.role)) {
    if (userRow && userRow.freeDeliveryTickets !== 0) {
      await txOrDb
        .update(schema.users)
        .set({ freeDeliveryTickets: 0, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }
    return {
      freeDeliveryTickets: 0,
      earnedAutoTickets: 0,
      manualFreeDeliveryTickets: 0,
      usedFreeDeliveryTickets: 0,
      qualifyingOrdersCount: 0,
      ordersInCurrentCycle: 0,
      ordersRemainingForNextTicket: 3,
      isFirstOrderEligible: false,
      eligibleForFirstOrderFreeDelivery: false,
      eligibleForFreeDelivery: false,
    };
  }

  const userOrders = await txOrDb
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.userId, userId));

  const nonCancelledOrders = userOrders
    .filter((o: any) => o.status !== 'CANCELLED')
    .sort((a: any, b: any) => Number(a.id) - Number(b.id));

  // O cliente que ainda não tem nenhum pedido ativo tem direito a Entrega Grátis no 1º Pedido!
  const isFirstOrderEligible = nonCancelledOrders.length === 0;

  // Garante que todo cliente novo (0 pedidos) receba a notificação de boas-vindas informando sobre o 1º pedido grátis + regra do 2º, 3º e 4º pedido
  if (isFirstOrderEligible) {
    try {
      const existingNotifs = await txOrDb
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));
      const hasWelcomeNotif = existingNotifs.some(
        (n: any) => n.newStatus === 'FIRST_ORDER_FREE_WELCOME'
      );
      if (!hasWelcomeNotif) {
        await txOrDb.insert(schema.notifications).values({
          userId,
          orderId: null,
          orderNumber: '1º PEDIDO',
          oldStatus: null,
          newStatus: 'FIRST_ORDER_FREE_WELCOME',
          title: '🎉 Você tem Entrega Grátis para o seu 1º Pedido!',
          message:
            'Bem-vindo(a) ao DeepShop Delivery! Você tem direito a Entrega Grátis no seu 1º pedido. Lembrando: o 2º e o 3º pedido serão pagos e, no 4º pedido, você entra na promoção da Entrega Grátis também!',
          isRead: false,
          popupDismissed: false,
        });
      }
    } catch {
      // ignore if inside read-only context
    }
  }

  // O 1º pedido do cliente (index === 0) usa o benefício de boas-vindas (FIRST_ORDER_FREE) e CONTA como o 1º dos 3 pedidos do ciclo (1º Grátis, 2º Pago, 3º Pago -> 4º Grátis!).
  // Apenas pedidos após o 1º (index > 0) que usarem ticket (usedFreeDeliveryTicket / FREE_DELIVERY_TICKET) consomem um ticket acumulativo de fidelidade.
  const ticketUsedOrders = nonCancelledOrders.filter(
    (o: any, index: number) =>
      index > 0 &&
      Boolean(o.usedFreeDeliveryTicket || o.deliveryFeeSource === 'FREE_DELIVERY_TICKET')
  );

  // Pedidos que contam para o ciclo de 3 pedidos (inclui o 1º pedido grátis de boas-vindas + os pedidos pagos 2º e 3º)
  const qualifyingOrders = nonCancelledOrders.filter(
    (o: any, index: number) =>
      index === 0 ||
      (!o.usedFreeDeliveryTicket && o.deliveryFeeSource !== 'FREE_DELIVERY_TICKET')
  );

  const qualifyingOrdersCount = qualifyingOrders.length;
  const earnedAutoTickets = Math.floor(qualifyingOrdersCount / 3);
  const ordersInCurrentCycle = qualifyingOrdersCount % 3;
  const ordersRemainingForNextTicket = 3 - ordersInCurrentCycle;
  const manualFreeDeliveryTickets = Number(userRow?.manualFreeDeliveryTickets || 0);
  const usedFreeDeliveryTickets = ticketUsedOrders.length;

  const freeDeliveryTickets = Math.max(
    0,
    earnedAutoTickets + manualFreeDeliveryTickets - usedFreeDeliveryTickets
  );

  if (userRow && userRow.freeDeliveryTickets !== freeDeliveryTickets) {
    await txOrDb
      .update(schema.users)
      .set({ freeDeliveryTickets, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  return {
    freeDeliveryTickets,
    earnedAutoTickets,
    manualFreeDeliveryTickets,
    usedFreeDeliveryTickets,
    qualifyingOrdersCount,
    ordersInCurrentCycle,
    ordersRemainingForNextTicket,
    isFirstOrderEligible,
    eligibleForFirstOrderFreeDelivery: isFirstOrderEligible,
    eligibleForFreeDelivery: isFirstOrderEligible || freeDeliveryTickets > 0,
  };
}

export async function isCustomerEligibleForFirstOrderFreeDelivery(
  userId: number | null | undefined,
  txOrDb: any = db
): Promise<boolean> {
  if (!userId) return false;
  const loyalty = await evaluateCustomerLoyaltyTickets(userId, txOrDb);
  return loyalty.isFirstOrderEligible;
}
