import { isAdminRole } from '../governance.ts';
import { logServerError, logServerEvent } from '../logger.ts';
import { Express } from 'express';
import { eq, desc, and, sql, inArray, count, type InferSelectModel } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { calculateSuggestedFreight, resolveAddressFreight } from '../../services/freightService.ts';
import {
  buildOrderWhatsAppMessage,
  buildRefundWhatsAppMessage,
  buildWhatsAppLink,
} from '../../utils/whatsapp.ts';
import { AuthRequest, requireAuth } from '../middleware/auth.ts';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  PAID_ORDER_STATUSES,
  computePaymentExpiresAt,
  getPrimaryStoreId,
  getFreightRuleConfig,
  getSettingsMap,
  isPromoCurrentlyActive,
  calculatePromoLinePricing,
  getNextGlobalOrderNumber,
} from '../services/storeHelpers.ts';
import { recordInventoryMovement } from '../services/inventoryService.ts';
import { expireOverdueUnpaidOrders, PAYMENT_TIMEOUT_REASON_PREFIX, LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX } from '../services/orderExpirationService.ts';
import {
  getFastDeliveryEstimate,
  isDeliveryMinutes,
  parseScheduledDelivery,
  type DeliveryMinutes,
} from '../../utils/deliverySchedule.ts';

function getSafeOrderBusinessError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : '';
  if (!message || message.length > 400) return null;
  const safePrefixes = [
    'Produto inválido na sacola.',
    'Quantidade inválida na sacola.',
    'A quantidade máxima por produto é 99 unidades.',
    'O produto "',
    'Estoque insuficiente para "',
    'Estoque insuficiente para reservar "',
    'Informe um valor para troco válido.',
    'O valor para troco (R$ ',
    'Escolha uma opção de prazo válida.',
    'Escolha uma data e um horário válidos para o agendamento.',
    'O agendamento deve ser feito para uma data e horário futuros.',
    'O horário escolhido está fora da disponibilidade da loja.',
  ];
  return safePrefixes.some((prefix) => message.startsWith(prefix)) ? message : null;
}

async function buildIdempotentOrderReplay(order: InferSelectModel<typeof schema.orders>) {
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  return { ...order, items, idempotentReplay: true, whatsappMessage: '', whatsappUrl: '' };
}
function toPaymentSummary(payment: InferSelectModel<typeof schema.payments> | undefined) {
  if (!payment) return null;
  return {
    provider: payment.provider,
    status: payment.status,
    providerStatus: payment.providerStatus,
    providerOrderId: payment.providerOrderId,
    providerPreferenceId: payment.providerPreferenceId,
    providerPaymentId: payment.providerPaymentId,
    amount: payment.amount,
    currency: payment.currency,
    updatedAt: payment.updatedAt,
  };
}
import { getCurrentStoreState } from '../services/storeStatusService.ts';
import { notifyNewOrder } from '../services/orderNotificationService.ts';

const notPaymentExpiredOrder = () => sql`COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${PAYMENT_TIMEOUT_REASON_PREFIX + '%'} AND COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX + '%'}`;
export function registerOrderRoutes(app: Express) {
  app.post('/api/orders', requireAuth, async (req: AuthRequest, res) => {
    let orderTransactionCommitted = false;
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Corpo da requisição inválido.' });
        return;
      }
      const rawNotes = req.body.notes;
      if (rawNotes !== undefined && rawNotes !== null && (typeof rawNotes !== 'string' || rawNotes.length > 500)) {
        res.status(400).json({ error: 'Observações devem ter até 500 caracteres.' });
        return;
      }
      if (req.body.items !== undefined && (!Array.isArray(req.body.items) || req.body.items.length > 50)) {
        res.status(400).json({ error: 'O pedido deve conter no máximo 50 linhas de produtos.' });
        return;
      }
      await expireOverdueUnpaidOrders();
      const {
        addressId,
        items,
        notes,
        paymentMethod,
        deliveryMode,
        deliveryMinutes,
        scheduledDate,
        scheduledTime,
      } = req.body;
      const rawIdempotencyKey = req.get('Idempotency-Key') ?? req.body.idempotencyKey;
      const idempotencyKey = rawIdempotencyKey === undefined || rawIdempotencyKey === null
        ? null
        : String(rawIdempotencyKey).trim();
      if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 128)) {
        res.status(400).json({ error: 'Chave de idempotência inválida.' });
        return;
      }

      const normalizedRequestedPaymentMethod = String(paymentMethod || '').trim().toUpperCase();
      if (normalizedRequestedPaymentMethod !== 'MERCADOPAGO') {
        res.status(400).json({ error: 'Selecione o pagamento online pelo Mercado Pago para concluir o pedido.' });
        return;
      }
      const normalizedPaymentMethod = 'MERCADOPAGO';

      const addressIdNum = Number(addressId);
      if (!Number.isSafeInteger(addressIdNum) || addressIdNum <= 0 || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({
          error: 'Selecione um endereço de entrega e adicione pelo menos um produto ao pedido.',
        });
        return;
      }

      const [address] = await db
        .select()
        .from(schema.addresses)
        .where(
          and(
            eq(schema.addresses.id, addressIdNum),
            eq(schema.addresses.userId, req.user!.id)
          )
        );

      if (!address) {
        res.status(400).json({ error: 'Endereço inválido ou não pertence à sua conta.' });
        return;
      }

      if (idempotencyKey) {
        const [previousOrder] = await db.select().from(schema.orders).where(eq(schema.orders.idempotencyKey, idempotencyKey));
        if (previousOrder) {
          if (previousOrder.userId !== req.user!.id) {
            res.status(409).json({ error: 'A chave de idempotência já foi utilizada.' });
            return;
          }
          res.status(200).json(await buildIdempotentOrderReplay(previousOrder));
          return;
        }
      }

      const storeId = await getPrimaryStoreId();
      const settingsMap = await getSettingsMap();
      const storeState = await getCurrentStoreState();
      if (storeState && !storeState.isOpen) {
        res.status(423).json({
          error: storeState.closedMessage,
          storeClosed: true,
          storeStatus: storeState.status,
          currentTime: storeState.currentTime,
          timezone: storeState.timezone,
          hours: storeState.hours,
        });
        return;
      }
      const normalizedDeliveryMode = String(deliveryMode || '').toUpperCase();
      let normalizedDeliveryMinutes: DeliveryMinutes | null = null;
      let estimatedDeliveryAt: Date | null = null;
      let scheduledDeliveryAt: Date | null = null;
      if (normalizedDeliveryMode === 'FAST') {
        if (!isDeliveryMinutes(deliveryMinutes)) {
          res.status(400).json({ error: 'Escolha uma opção de prazo válida.' });
          return;
        }
        normalizedDeliveryMinutes = Number(deliveryMinutes) as DeliveryMinutes;
        estimatedDeliveryAt = getFastDeliveryEstimate(
          new Date(),
          normalizedDeliveryMinutes,
          storeState.hours,
          storeState.timezone,
        );
      } else if (normalizedDeliveryMode === 'SCHEDULED') {
        scheduledDeliveryAt = parseScheduledDelivery(
          scheduledDate,
          scheduledTime,
          storeState.hours,
          storeState.timezone,
        );
      } else {
        res.status(400).json({ error: 'Escolha uma opção de prazo válida.' });
        return;
      }
      const deadlineHours = Math.max(
        0.1,
        parseFloat(settingsMap.payment_deadline_hours || '0.5') || 0.5
      );

      const createdOrderResult = await db.transaction(async (tx) => {
        let subtotalNum = 0;
        const preparedItems: Array<{
          productId: number;
          productName: string;
          quantity: number;
          unitPrice: string;
          subtotal: string;
          unitCost: string | null;
        }> = [];
        const reservations: Array<{ productId: number; quantity: number; beforeStock: number; afterStock: number }> = [];

        // Agrupa itens com o mesmo productId para garantir que o limite da promoção seja respeitado por produto
        const mergedItemsMap = new Map<number, { productId: number; quantity: number; productName?: string }>();
        for (const rawItem of items) {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
            throw new Error('Produto inválido na sacola.');
          }
          const prodId = Number(rawItem.productId);
          const qty = Number(rawItem.quantity);
          if (!Number.isSafeInteger(prodId) || prodId <= 0 || !Number.isSafeInteger(qty) || qty <= 0 || qty > 99) {
            throw new Error('Quantidade inválida na sacola.');
          }
          const existing = mergedItemsMap.get(prodId);
          if (existing) {
            existing.quantity += qty;
            if (existing.quantity > 99) throw new Error('A quantidade máxima por produto é 99 unidades.');
          } else {
            mergedItemsMap.set(prodId, {
              productId: prodId,
              quantity: qty,
              productName: rawItem.productName,
            });
          }
        }

        for (const rawItem of mergedItemsMap.values()) {
          const prodId = rawItem.productId;
          const qty = rawItem.quantity;

          const [prod] = await tx
            .select()
            .from(schema.products)
            .where(eq(schema.products.id, prodId));

          if (!prod || prod.status !== 'ACTIVE') {
            throw new Error(
              `O produto "${rawItem.productName || '#' + prodId}" não está mais disponível.`
            );
          }

          if (prod.stock < qty) {
            if (prod.stock <= 0) {
              throw new Error(
                `O produto "${prod.code} - ${prod.name}" está sem estoque no momento.`
              );
            }
            throw new Error(
              `Estoque insuficiente para "${prod.code} - ${prod.name}". Disponível: ${prod.stock} un.`
            );
          }

          // Opção 2: Reserva/desconta imediatamente do estoque no ato do pedido (por ordem exata de chegada).
          // Se o saldo chegar a 0, marca como INACTIVE para sair da vitrine imediatamente.
          // Se o cliente não pagar em 1 hora, o verificador automático cancela o pedido e devolve o saldo para a vitrine.
          const nextProdStock = prod.stock - qty;
          const reservedRows = await tx
            .update(schema.products)
            .set({
              stock: sql`${schema.products.stock} - ${qty}`,
              status: nextProdStock <= 0 ? 'INACTIVE' : prod.status,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.products.id, prod.id),
                sql`${schema.products.stock} >= ${qty}`
              )
            )
            .returning();

          if (reservedRows.length === 0) {
            throw new Error(
              `Estoque insuficiente para reservar "${prod.code} - ${prod.name}". Outro pedido acabou de reservar as últimas unidades.`
            );
          }
          reservations.push({ productId: prod.id, quantity: qty, beforeStock: prod.stock, afterStock: nextProdStock });

          // Calcula preço respeitando eventual limite de unidades na promoção (promoMaxUnits):
          // Até o limite sai pelo valor promocional; o excedente segue o valor normal do produto.
          const hasPromo = isPromoCurrentlyActive(prod);
          const pricing = calculatePromoLinePricing({
            normalPrice: prod.price,
            promoPrice: prod.promoPrice,
            hasPromo,
            promoMaxUnits: prod.promoMaxUnits,
            quantity: qty,
          });

          subtotalNum = Number((subtotalNum + pricing.subtotal).toFixed(2));

          // Código do produto na frente do nome nos pedidos e no WhatsApp
          const displayProductName = prod.code
            ? `${prod.code} - ${prod.name}`
            : prod.name;

          const preciseCost = prod.costUnitPrecise !== null && prod.costUnitPrecise !== undefined ? prod.costUnitPrecise : prod.cost;
          const currentUnitCost = preciseCost !== null && preciseCost !== undefined ? String(preciseCost) : null;

          if (pricing.hasLimitExceeded) {
            preparedItems.push({
              productId: prod.id,
              productName: `${displayProductName} (Na promoção — máx. ${pricing.promoMaxUnits} un.)`,
              quantity: pricing.promoQty,
              unitPrice: pricing.promoUnitPrice.toFixed(2),
              subtotal: pricing.promoSubtotal.toFixed(2),
              unitCost: currentUnitCost,
            });
            preparedItems.push({
              productId: prod.id,
              productName: `${displayProductName} (Valor normal acima do limite)`,
              quantity: pricing.normalQty,
              unitPrice: pricing.normalUnitPrice.toFixed(2),
              subtotal: pricing.normalSubtotal.toFixed(2),
              unitCost: currentUnitCost,
            });
          } else {
            const appliedUnitPrice = pricing.hasPromo
              ? pricing.promoUnitPrice
              : pricing.normalUnitPrice;
            preparedItems.push({
              productId: prod.id,
              productName: displayProductName,
              quantity: qty,
              unitPrice: appliedUnitPrice.toFixed(2),
              subtotal: pricing.subtotal.toFixed(2),
              unitCost: currentUnitCost,
            });
          }
        }

        const evaluatedFreight = resolveAddressFreight(address);
        const freightRule = await getFreightRuleConfig();
        const automaticFreight = evaluatedFreight.isItatiba && evaluatedFreight.status !== 'CONFIRMED'
          ? (() => {
              const distanceKm = evaluatedFreight.distanceKm ?? freightRule.baseDistanceKm;
              const fee = calculateSuggestedFreight(distanceKm, freightRule);
              return {
                ...evaluatedFreight,
                status: 'CONFIRMED' as const,
                distanceKm,
                fee,
                source: 'AUTO',
                customerMessage: `Delivery automático para Itatiba — Frete: R$ ${fee.toFixed(2).replace('.', ',')}`,
              };
            })()
          : evaluatedFreight;
        const [customerPromotion] = await tx
          .select({ freeDeliveryUntil: schema.users.freeDeliveryUntil })
          .from(schema.users)
          .where(eq(schema.users.id, req.user!.id));
        const manualPeriodFreeDelivery = Boolean(
          customerPromotion?.freeDeliveryUntil && customerPromotion.freeDeliveryUntil > new Date()
        );
        const deliveryDistanceStr =
            automaticFreight.status === 'CONFIRMED' && automaticFreight.distanceKm !== null
              ? automaticFreight.distanceKm.toFixed(2)
              : null;

        let deliveryFeeStr: string | null;
        let deliveryFeeSource: string;

        if (manualPeriodFreeDelivery) {
          deliveryFeeStr = '0.00';
          deliveryFeeSource = 'MANUAL_FREE_DELIVERY_PERIOD';
        } else {
          deliveryFeeStr =
            automaticFreight.status === 'CONFIRMED' && automaticFreight.fee !== null
              ? automaticFreight.fee.toFixed(2)
              : null;
          deliveryFeeSource = automaticFreight.status === 'CONFIRMED' ? 'AUTO' : 'MANUAL';
        }

        const totalNum =
          deliveryFeeStr !== null
            ? Number((subtotalNum + parseFloat(deliveryFeeStr)).toFixed(2))
            : subtotalNum;

        const changeForStr: string | null = null;

        // Se o frete já for conhecido ou grátis, o pagamento já fica liberado com cronômetro de 1h.
        // Se o frete estiver "Em análise" (null), aguarda o Admin definir o frete para iniciar o cronômetro de 1h.
        const paymentReleased = deliveryFeeStr !== null;
        const paymentExpiresAt = paymentReleased
          ? computePaymentExpiresAt(deadlineHours)
          : null;

        const orderNumber = await getNextGlobalOrderNumber(tx);

        const addressSnapshot: schema.AddressSnapshot = {
          id: address.id,
          label: address.label,
          zipCode: address.zipCode,
          street: address.street,
          number: address.number,
          complement: address.complement,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
          reference: address.reference,
          deliveryOrigin: address.deliveryOrigin,
          deliveryNotes: address.deliveryNotes,
        };

        const [newOrder] = await tx
          .insert(schema.orders)
          .values({
            orderNumber,
            userId: req.user!.id,
            storeId,
            subtotal: subtotalNum.toFixed(2),
            deliveryFee: deliveryFeeStr,
            deliveryDistanceKm: deliveryDistanceStr,
            deliveryFeeSource,
            total: totalNum.toFixed(2),
            idempotencyKey,
            paymentMethod: normalizedPaymentMethod,
            changeFor: changeForStr,
            status: 'NEW',
            stockDeducted: true,
            paymentExpiresAt,
            deliveryMode: normalizedDeliveryMode,
            deliveryMinutes: normalizedDeliveryMinutes,
            estimatedDeliveryAt,
            scheduledDeliveryAt,
            reminderSentAt: null,
            cancellationReason: null,
            refundRequested: false,
            notes: notes ? String(notes).trim() : null,
            addressSnapshot,
          })
          .returning();

        for (const reservation of reservations) {
          await recordInventoryMovement(tx, {
            productId: reservation.productId,
            delta: -reservation.quantity,
            beforeStock: reservation.beforeStock,
            afterStock: reservation.afterStock,
            movementType: 'ORDER_RESERVATION',
            reason: `Reserva de estoque para o pedido #${newOrder.orderNumber}`,
            actorUserId: req.user!.id,
            orderId: newOrder.id,
            idempotencyKey: `order-reserve:${newOrder.id}:${reservation.productId}`,
          });
        }

        for (const item of preparedItems) {
          await tx.insert(schema.orderItems).values({
            orderId: newOrder.id,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            unitCost: item.unitCost,
          });
        }

        await tx.insert(schema.orderStatusHistory).values({
          orderId: newOrder.id,
          oldStatus: null,
          newStatus: 'NEW',
          changedBy: req.user!.id,
        });

        // Notificação persistente do novo pedido: sem CPF, telefone, endereço ou outros dados pessoais.
        await tx.insert(schema.adminNotifications).values({
          type: 'NEW_ORDER',
          customerId: req.user!.id,
          orderId: newOrder.id,
          addressId: null,
          title: `🔔 Novo pedido #${newOrder.orderNumber}`,
          message: `Novo pedido recebido. Total: R$ ${Number(newOrder.total).toFixed(2).replace('.', ',')} · ${preparedItems.reduce((sum, item) => sum + item.quantity, 0)} item(ns).`,
          isRead: false,
          popupDismissed: false,
        });

        return {
          order: newOrder,
          items: preparedItems,
          reservations: reservations.map(({ productId, quantity }) => ({ productId, quantity })),
        };
      });
      orderTransactionCommitted = true;
      logServerEvent('order.created', 'info', {
        orderId: createdOrderResult.order.id,
        userId: req.user!.id,
        orderStatus: createdOrderResult.order.status,
        itemCount: createdOrderResult.reservations.length,
        result: 'committed',
      });
      for (const reservation of createdOrderResult.reservations) {
        logServerEvent('inventory.order_reserved', 'info', {
          orderId: createdOrderResult.order.id,
          productId: reservation.productId,
          stockDelta: -reservation.quantity,
          result: 'committed',
        });
      }

      const allImages = await db.select().from(schema.productImages);
      const whatsappNumber = settingsMap.whatsapp_number || '';
      const whatsappMessage = buildOrderWhatsAppMessage({
        orderNumber: createdOrderResult.order.orderNumber,
        items: createdOrderResult.items,
        subtotal: createdOrderResult.order.subtotal,
        deliveryFee: createdOrderResult.order.deliveryFee,
        deliveryDistanceKm: createdOrderResult.order.deliveryDistanceKm,
        total: createdOrderResult.order.total,
        paymentMethod: createdOrderResult.order.paymentMethod,
        changeFor: createdOrderResult.order.changeFor,
        addressSnapshot: createdOrderResult.order.addressSnapshot,
        notes: createdOrderResult.order.notes,
        deliveryFeeSource: createdOrderResult.order.deliveryFeeSource,
      });
      const whatsappUrl = buildWhatsAppLink(whatsappNumber, whatsappMessage);

      const enrichedItems = createdOrderResult.items.map((it) => {
        const prodImgs = allImages.filter((img) => img.productId === it.productId);
        const primary =
          prodImgs.find((i) => i.isPrimary && i.mediaType !== 'VIDEO') ||
          prodImgs.find((i) => i.mediaType !== 'VIDEO') ||
          prodImgs[0];
        return {
          ...it,
          imageUrl: primary ? primary.imageUrl : null,
        };
      });

      void notifyNewOrder(
        createdOrderResult.order.id,
        createdOrderResult.items.reduce((sum, item) => sum + item.quantity, 0)
      ).catch((err) => logServerError('order.notification.failed', err, { orderId: createdOrderResult.order.id }));

      const paymentReleased = createdOrderResult.order.deliveryFee !== null &&
        createdOrderResult.order.deliveryFee !== undefined &&
        createdOrderResult.order.deliveryFee !== '';

      res.status(201).json({
        ...createdOrderResult.order,
        paymentReleased,
        paymentDeadlineHours: deadlineHours,
        canCustomerCancel: true,
        requiresRefundOnCancel: false,
        items: enrichedItems,
        whatsappMessage,
        whatsappUrl,
      });
    } catch (error: any) {
      const rawRetryKey = req.get('Idempotency-Key') ?? req.body?.idempotencyKey;
      const retryKey = rawRetryKey === undefined || rawRetryKey === null ? null : String(rawRetryKey).trim();
      if (retryKey) {
        const [previousOrder] = await db.select().from(schema.orders).where(eq(schema.orders.idempotencyKey, retryKey));
        if (previousOrder) {
          if (previousOrder.userId !== req.user!.id) {
            logServerEvent('order.creation.idempotency_conflict', 'warn', { status: 409, userId: req.user!.id, orderId: previousOrder.id, result: 'denied', reason: 'key_owned_by_another_user' });
            res.status(409).json({ error: 'A chave de idempotência já foi utilizada.' });
            return;
          }
          res.status(200).json(await buildIdempotentOrderReplay(previousOrder));
          return;
        }
      }
      const publicError = getSafeOrderBusinessError(error);
      const responseStatus = publicError ? 400 : 500;
      if (publicError) {
        logServerEvent('order.creation.rejected', 'warn', { status: responseStatus, userId: req.user?.id, result: 'rejected', reason: 'business_validation' });
      } else {
        logServerError('order.creation.failed', error, {
          status: responseStatus,
          userId: req.user?.id,
          result: orderTransactionCommitted ? 'post_commit_failure' : 'transaction_rolled_back',
        });
      }
      res.status(responseStatus).json({
        error: publicError || 'Não foi possível concluir o pedido.',
      });
    }
  });

  app.get('/api/orders', requireAuth, async (req: AuthRequest, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const page = Math.max(1, Math.min(1000000, Number(req.query.page) || 1));
      const pageSize = Math.max(1, Math.min(50, Number(req.query.pageSize) || 10));
      const offset = (page - 1) * pageSize;
      const [userOrders, [{ total }]] = await Promise.all([
        db.select().from(schema.orders).where(and(eq(schema.orders.userId, req.user!.id), notPaymentExpiredOrder())).orderBy(desc(schema.orders.id)).limit(pageSize).offset(offset),
        db.select({ total: count() }).from(schema.orders).where(and(eq(schema.orders.userId, req.user!.id), notPaymentExpiredOrder())),
      ]);
      const totalOrders = Number(total || 0);
      const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));

      const [customerUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, req.user!.id));

      const allItems = await db.select().from(schema.orderItems);
      const allImages = await db.select().from(schema.productImages);
      const allHistory = await db
        .select()
        .from(schema.orderStatusHistory)
        .orderBy(desc(schema.orderStatusHistory.id));
      const paymentRows = userOrders.length
        ? await db.select().from(schema.payments).where(inArray(schema.payments.orderId, userOrders.map((order) => order.id)))
        : [];
      const paymentsByOrder = new Map(paymentRows.map((payment) => [payment.orderId, payment]));
      const settingsMap = await getSettingsMap();
      const whatsappNumber = settingsMap.whatsapp_number || '';


      const enriched = userOrders.map((o) => {
        const items = allItems
          .filter((i) => i.orderId === o.id)
          .map((i) => {
            const prodImgs = allImages.filter((img) => img.productId === i.productId);
            const primary =
              prodImgs.find((im) => im.isPrimary && im.mediaType !== 'VIDEO') ||
              prodImgs.find((im) => im.mediaType !== 'VIDEO') ||
              prodImgs[0];
            return {
              ...i,
              imageUrl: primary ? primary.imageUrl : null,
            };
          });
        const history = allHistory.filter((h) => h.orderId === o.id);
        const isFreeDelivery = o.deliveryFee !== null && Number(o.deliveryFee) === 0;
        const whatsappMessage = buildOrderWhatsAppMessage({
          orderNumber: o.orderNumber,
          items,
          subtotal: o.subtotal,
          deliveryFee: o.deliveryFee,
          deliveryDistanceKm: o.deliveryDistanceKm,
          total: o.total,
          paymentMethod: o.paymentMethod,
          changeFor: o.changeFor,
          addressSnapshot: o.addressSnapshot,
          notes: o.notes,
          deliveryFeeSource: o.deliveryFeeSource,
        });

        const canCustomerCancel = CUSTOMER_CANCELLABLE_STATUSES.includes(o.status);
        const requiresRefundOnCancel = PAID_ORDER_STATUSES.includes(o.status);
        const paymentReleased = Boolean(
          isFreeDelivery ||
            (o.deliveryFee !== null && o.deliveryFee !== undefined && o.deliveryFee !== '')
        );

        const refundWhatsappMessage = buildRefundWhatsAppMessage({
          orderNumber: o.orderNumber,
          customerName: customerUser?.name || req.user!.name,
          customerPhone: customerUser?.phone || '',
          items,
          subtotal: o.subtotal,
          deliveryFee: o.deliveryFee,
          total: o.total,
          cancellationReason:
            o.cancellationReason || 'Solicito o cancelamento e estorno do valor pago.',
        });
        const refundWhatsappUrl = buildWhatsAppLink(whatsappNumber, refundWhatsappMessage);

        return {
          ...o,
          payment: toPaymentSummary(paymentsByOrder.get(o.id)),
          isFreeDelivery,
          paymentReleased,
          canCustomerCancel,
          requiresRefundOnCancel,
          items,
          history,
          whatsappMessage,
          whatsappUrl: buildWhatsAppLink(whatsappNumber, whatsappMessage),
          refundWhatsappMessage:
            o.refundRequested || requiresRefundOnCancel ? refundWhatsappMessage : null,
          refundWhatsappUrl:
            o.refundRequested || requiresRefundOnCancel ? refundWhatsappUrl : null,
          pixKey: settingsMap.pix_key || '',
          pixInstructions: settingsMap.pix_instructions || '',
        };
      });

      res.json({ orders: enriched, pagination: { page, pageSize, total: totalOrders, totalPages, hasNext: page < totalPages } });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar seus pedidos.' });
    }
  });

  app.get('/api/orders/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const orderId = Number(req.params.id);
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.id, orderId), notPaymentExpiredOrder()));

      if (!order) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }

      if (!isAdminRole(req.user!.role) && order.userId !== req.user!.id) {
        res.status(403).json({ error: 'Acesso negado a este pedido.' });
        return;
      }

      const [orderCustomer] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, order.userId));

      const rawItems = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id));
      const allImages = await db.select().from(schema.productImages);
      const items = rawItems.map((i) => {
        const prodImgs = allImages.filter((img) => img.productId === i.productId);
        const primary =
          prodImgs.find((im) => im.isPrimary && im.mediaType !== 'VIDEO') ||
          prodImgs.find((im) => im.mediaType !== 'VIDEO') ||
          prodImgs[0];
        return {
          ...i,
          imageUrl: primary ? primary.imageUrl : null,
        };
      });

      const history = await db
        .select()
        .from(schema.orderStatusHistory)
        .where(eq(schema.orderStatusHistory.orderId, order.id))
        .orderBy(desc(schema.orderStatusHistory.id));
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));

      const settingsMap = await getSettingsMap();
      const whatsappNumber = settingsMap.whatsapp_number || '';
      const isFreeDelivery = order.deliveryFee !== null && Number(order.deliveryFee) === 0;
      const whatsappMessage = buildOrderWhatsAppMessage({
        orderNumber: order.orderNumber,
        items,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        deliveryDistanceKm: order.deliveryDistanceKm,
        total: order.total,
        paymentMethod: order.paymentMethod,
        changeFor: order.changeFor,
        addressSnapshot: order.addressSnapshot,
        notes: order.notes,
        deliveryFeeSource: order.deliveryFeeSource,
      });

      const canCustomerCancel = CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);
      const requiresRefundOnCancel = PAID_ORDER_STATUSES.includes(order.status);
      const paymentReleased = Boolean(
        isFreeDelivery ||
          (order.deliveryFee !== null &&
            order.deliveryFee !== undefined &&
            order.deliveryFee !== '')
      );
      const refundWhatsappMessage = buildRefundWhatsAppMessage({
        orderNumber: order.orderNumber,
        customerName: orderCustomer?.name || 'Cliente',
        customerPhone: orderCustomer?.phone || '',
        items,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        cancellationReason:
          order.cancellationReason || 'Solicito o cancelamento e estorno do valor pago.',
      });
      const refundWhatsappUrl = buildWhatsAppLink(whatsappNumber, refundWhatsappMessage);

      res.json({
        ...order,
        payment: toPaymentSummary(payment),
        isFreeDelivery,
        paymentReleased,
        canCustomerCancel,
        requiresRefundOnCancel,
        items,
        history,
        whatsappMessage,
        whatsappUrl: buildWhatsAppLink(whatsappNumber, whatsappMessage),
        refundWhatsappMessage:
          order.refundRequested || requiresRefundOnCancel ? refundWhatsappMessage : null,
        refundWhatsappUrl:
          order.refundRequested || requiresRefundOnCancel ? refundWhatsappUrl : null,
        pixKey: settingsMap.pix_key || '',
        pixInstructions: settingsMap.pix_instructions || '',
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar detalhes do pedido.' });
    }
  });

  // Cancelamento de Pedido pelo Cliente (Requisitos 1 e 2)
  app.post('/api/orders/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      const rawReason = req.body?.reason ?? req.body?.cancellationReason ?? '';
      const reasonText = String(rawReason).trim();

      const [existingOrder] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));

      if (!existingOrder) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }

      if (!isAdminRole(req.user!.role) && existingOrder.userId !== req.user!.id) {
        res.status(403).json({ error: 'Você não tem permissão para cancelar este pedido.' });
        return;
      }

      if (existingOrder.status === 'OUT_FOR_DELIVERY') {
        res.status(400).json({
          error: 'Não é possível cancelar o pedido pois ele já saiu para entrega.',
        });
        return;
      }

      if (existingOrder.status === 'DELIVERED') {
        res.status(400).json({
          error: 'Não é possível cancelar um pedido que já foi entregue.',
        });
        return;
      }

      const wasPaidBefore =
        existingOrder.status === 'PAID' || existingOrder.status === 'PREPARING';

      const finalReason =
        reasonText ||
        (wasPaidBefore
          ? 'Solicitação de cancelamento e estorno pelo cliente antes de sair para entrega.'
          : 'Cancelado pelo cliente antes do pagamento.');

      const result = await db.transaction(async (tx) => {
        const [freshOrder] = await tx
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.id, existingOrder.id));
        if (!freshOrder) throw new Error('Pedido não encontrado.');

        const items = await tx
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, freshOrder.id));

        if (freshOrder.status === 'CANCELLED') {
          return {
            updatedOrder: freshOrder,
            items,
            changed: false,
            wasPaid: Boolean(freshOrder.refundRequested),
          };
        }
        if (!CUSTOMER_CANCELLABLE_STATUSES.includes(freshOrder.status)) {
          throw new Error('O pedido mudou de estado e não pode mais ser cancelado. Atualize a tela e tente novamente.');
        }

        const wasPaid = PAID_ORDER_STATUSES.includes(freshOrder.status);
        const [updatedOrder] = await tx
          .update(schema.orders)
          .set({
            status: 'CANCELLED',
            stockDeducted: false,
            paymentExpiresAt: null,
            deliveredAt: null,
            cancellationReason: finalReason,
            refundRequested: wasPaid,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.orders.id, freshOrder.id),
            eq(schema.orders.status, freshOrder.status),
            inArray(schema.orders.status, CUSTOMER_CANCELLABLE_STATUSES)
          ))
          .returning();

        if (!updatedOrder) {
          const [currentOrder] = await tx.select().from(schema.orders).where(eq(schema.orders.id, freshOrder.id));
          if (currentOrder?.status === 'CANCELLED') {
            return {
              updatedOrder: currentOrder,
              items,
              changed: false,
              wasPaid: Boolean(currentOrder.refundRequested),
            };
          }
          throw new Error('O pedido mudou de estado e não pode mais ser cancelado. Atualize a tela e tente novamente.');
        }

        // Somente quem ganhou a transição atômica devolve o estoque; agrega linhas de promoção pelo produto.
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
            if (!restored) throw new Error('O estoque foi alterado por outra operação durante o cancelamento.');
            await recordInventoryMovement(tx, {
              productId, delta: quantity, beforeStock: product.stock, afterStock: restored.stock,
              movementType: 'ORDER_CANCELLATION_RETURN', reason: `Devolução de estoque do pedido #${freshOrder.orderNumber}`,
              actorUserId: req.user!.id, orderId: freshOrder.id,
              idempotencyKey: `order-cancel-return:${freshOrder.id}:${productId}`,
            });
          }
        }

        await tx.insert(schema.orderStatusHistory).values({
          orderId: freshOrder.id,
          oldStatus: freshOrder.status,
          newStatus: 'CANCELLED',
          changedBy: req.user!.id,
        });

        return { updatedOrder, items, changed: true, wasPaid };
      });

      if (result.changed) {
        logServerEvent('order.cancelled', 'info', {
          orderId: existingOrder.id,
          userId: req.user!.id,
          fromStatus: existingOrder.status,
          toStatus: 'CANCELLED',
          role: req.user!.role,
          result: 'committed',
        });
        if (existingOrder.stockDeducted) {
          const returnedByProduct = new Map<number, number>();
          for (const item of result.items) returnedByProduct.set(item.productId, (returnedByProduct.get(item.productId) || 0) + item.quantity);
          for (const [productId, quantity] of returnedByProduct) {
            logServerEvent('inventory.order_returned', 'info', {
              orderId: existingOrder.id,
              productId,
              stockDelta: quantity,
              result: 'committed',
            });
          }
        }
      }

      const [customerUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, existingOrder.userId));
      const settingsMap = await getSettingsMap();
      const whatsappNumber = settingsMap.whatsapp_number || '';

      let refundWhatsappMessage: string | null = null;
      let refundWhatsappUrl: string | null = null;

      if (result.wasPaid) {
        refundWhatsappMessage = buildRefundWhatsAppMessage({
          orderNumber: existingOrder.orderNumber,
          customerName: customerUser?.name || req.user!.name,
          customerPhone: customerUser?.phone || '',
          items: result.items,
          subtotal: existingOrder.subtotal,
          deliveryFee: existingOrder.deliveryFee,
          total: existingOrder.total,
          cancellationReason: finalReason,
        });
        refundWhatsappUrl = buildWhatsAppLink(whatsappNumber, refundWhatsappMessage);
      }

      res.json({
        ...result.updatedOrder,
        canCustomerCancel: false,
        requiresRefundOnCancel: false,
        wasPaid: result.wasPaid,
        refundRequested: result.wasPaid,
        cancellationReason: result.updatedOrder.cancellationReason || finalReason,
        refundWhatsappMessage,
        refundWhatsappUrl,
      });
    } catch (error: any) {
      const isStateConflict = error instanceof Error && error.message.startsWith('O pedido mudou de estado');
      const orderId = Number(req.params.id);
      if (isStateConflict) {
        logServerEvent('order.cancellation.conflict', 'warn', { status: 409, orderId, userId: req.user?.id, result: 'conflict', reason: 'concurrent_status_change' });
      } else {
        logServerError('order.cancellation.failed', error, { status: 500, orderId, userId: req.user?.id, result: 'transaction_rolled_back' });
      }
      res.status(isStateConflict ? 409 : 500).json({
        error: isStateConflict
          ? 'O pedido foi alterado por outra operação. Atualize a tela e tente novamente.'
          : 'Não foi possível cancelar o pedido.',
      });
    }
  });

  // Notificações do Cliente
  app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    try {
      const list = req.user!.role === 'CUSTOMER'
        ? await db.select().from(schema.notifications)
            .where(eq(schema.notifications.userId, req.user!.id))
            .orderBy(desc(schema.notifications.id))
        : [];
      const notifications = list.filter((n) => ![
        'FIRST_ORDER_FREE_WELCOME',
        'FREE_DELIVERY_TICKET_EARNED',
        'MANUAL_FREE_DELIVERY_GRANTED',
      ].includes(String(n.newStatus || '')));
      const unreadCount = notifications.filter((n) => !n.isRead).length;
      const activePopups = notifications.filter((n) => !n.popupDismissed);
      res.json({ notifications, unreadCount, activePopups });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar notificações.' });
    }
  });

  app.put('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      await db
        .update(schema.notifications)
        .set({ isRead: true, popupDismissed: true })
        .where(eq(schema.notifications.userId, req.user!.id));

      res.json({ success: true });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao atualizar notificações.' });
    }
  });

  app.put('/api/notifications/:id/dismiss-popup', requireAuth, async (req: AuthRequest, res) => {
    try {
      const notifId = Number(req.params.id);
      const [updated] = await db
        .update(schema.notifications)
        .set({ popupDismissed: true })
        .where(
          and(
            eq(schema.notifications.id, notifId),
            eq(schema.notifications.userId, req.user!.id)
          )
        )
        .returning();

      res.json({ success: true, notification: updated || null });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao fechar notificação.' });
    }
  });

  app.put('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      const notifId = Number(req.params.id);
      const [updated] = await db
        .update(schema.notifications)
        .set({ isRead: true, popupDismissed: true })
        .where(
          and(
            eq(schema.notifications.id, notifId),
            eq(schema.notifications.userId, req.user!.id)
          )
        )
        .returning();

      res.json({ success: true, notification: updated || null });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao atualizar notificação.' });
    }
  });
}
