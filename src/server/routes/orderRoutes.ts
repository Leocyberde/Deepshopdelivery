import { createHmac } from 'node:crypto';
import { isAdminRole } from '../governance.ts';
import { logServerError, logServerEvent } from '../logger.ts';
import { Express } from 'express';
import { eq, desc, and, sql, inArray, count, type InferSelectModel } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { freightForSavedAddress, requireAvailableFreight, FreightError } from '../services/geoService.ts';
import { isServedAddress } from '../../services/freightService.ts';
import {
  buildOrderWhatsAppMessage,
  buildRefundWhatsAppMessage,
  buildWhatsAppLink,
} from '../../utils/whatsapp.ts';
import { AuthRequest, requireAuth, JWT_SECRET } from '../middleware/auth.ts';
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
import { calculateFulfillmentSplit, calculatePreorderWindow, calculateOrderPartTotals } from '../../utils/fulfillmentDates.ts';
import { buildFulfillmentPromises } from '../services/fulfillmentPromises.ts';

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
function toCustomerOrderItem(item: InferSelectModel<typeof schema.orderItems>, imageUrl: string | null) {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    subtotal: item.subtotal,
    fulfillmentType: item.fulfillmentType,
    imageUrl,
  };
}
import { getCurrentStoreState } from '../services/storeStatusService.ts';
import { notifyNewOrder } from '../services/orderNotificationService.ts';

const notPaymentExpiredOrder = () => sql`COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${PAYMENT_TIMEOUT_REASON_PREFIX + '%'} AND COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX + '%'}`;
function quoteToken(userId: number, addressId: number, items: any[], subtotal: number, freight: any) {
  const merged = new Map<number, any>();
  for (const item of items) {
    const id = Number(item.productId), previous = merged.get(id);
    if (previous) previous.quantity += Number(item.quantity);
    else merged.set(id, { productId: id, quantity: Number(item.quantity), receiveAllAsPreorder: Boolean(item.receiveAllAsPreorder) });
  }
  const payload = { userId, addressId, items: [...merged.values()].sort((a,b) => a.productId - b.productId), subtotal, distanceKm: freight.distanceKm, fee: freight.finalFee, source: freight.source, normalFee: freight.normalFee };
  return createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
}
export function registerOrderRoutes(app: Express) {
  app.post('/api/cart/quote', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!Array.isArray(req.body?.items) || req.body.items.length === 0 || req.body.items.length > 50) {
        res.status(400).json({ error: 'Informe os itens para cotação.' });
        return;
      }
      const settings = await getSettingsMap();
      const maxQty = Math.max(1, Number(settings.max_qty_per_item || 20));
      const productIds = req.body.items
        .map((i: any) => Number(i?.productId))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0);
      const products = productIds.length
        ? await db.select().from(schema.products).where(inArray(schema.products.id, productIds))
        : [];
      const byId = new Map(products.map((p) => [p.id, p]));
      const quoteItems = new Map<number, any>();
      for (const raw of req.body.items) {
        const productId = Number(raw?.productId), quantity = Number(raw?.quantity);
        if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity) || quantity < 1) { res.status(400).json({ error: 'Item inválido.' }); return; }
        const existing = quoteItems.get(productId);
        if (existing) existing.quantity += quantity;
        else quoteItems.set(productId, { ...raw, productId, quantity });
      }
      const lines: Array<Record<string, unknown>> = [];
      let deliverySubtotal = 0;
      let preorderSubtotal = 0;
      for (const raw of quoteItems.values()) {
        const productId = Number(raw?.productId);
        const quantity = Number(raw?.quantity);
        if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > maxQty) {
          res.status(400).json({ error: `A quantidade máxima por item é ${maxQty}.` });
          return;
        }
        const product = byId.get(productId);
        if (!product || product.status !== 'ACTIVE' || ((product.stock < quantity || raw.receiveAllAsPreorder) && !product.allowPreorder)) {
          res.status(409).json({ error: 'Um produto da cotação não está mais disponível.' });
          return;
        }
        const split = calculateFulfillmentSplit(quantity, product.stock, Boolean(raw.receiveAllAsPreorder));
        const pricing = calculatePromoLinePricing({ normalPrice: product.price, promoPrice: product.promoPrice, hasPromo: isPromoCurrentlyActive(product), promoMaxUnits: product.promoMaxUnits, quantity });
        const deliveryPromoQty = Math.min(split.deliveryQty, pricing.promoQty);
        const preorderPromoQty = Math.min(split.preorderQty, Math.max(0, pricing.promoQty - deliveryPromoQty));
        const deliveryLine = Number((deliveryPromoQty * pricing.promoUnitPrice + (split.deliveryQty - deliveryPromoQty) * pricing.normalUnitPrice).toFixed(2));
        const preorderLine = Number((preorderPromoQty * pricing.promoUnitPrice + (split.preorderQty - preorderPromoQty) * pricing.normalUnitPrice).toFixed(2));
        const totalLineQty = split.deliveryQty + split.preorderQty;
        const blendedUnitPrice = totalLineQty ? Number(((deliveryLine + preorderLine) / totalLineQty).toFixed(2)) : pricing.normalUnitPrice;
        deliverySubtotal += deliveryLine; preorderSubtotal += preorderLine;
        lines.push({ productId, quantity, deliveryQty: split.deliveryQty, preorderQty: split.preorderQty, deliveryPromoQty, preorderPromoQty, deliverySubtotal: deliveryLine.toFixed(2), preorderSubtotal: preorderLine.toFixed(2), unitPrice: blendedUnitPrice.toFixed(2), receiveAllAsPreorder: Boolean(raw.receiveAllAsPreorder) });
      }
      let freight = null;
      if (req.body.addressId !== undefined && req.body.addressId !== null) {
        const id = Number(req.body.addressId);
        if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'Endereço inválido.' }); return; }
        const [address] = await db.select().from(schema.addresses).where(and(eq(schema.addresses.id, id), eq(schema.addresses.userId, req.user!.id)));
        if (!address) { res.status(404).json({ error: 'Endereço não encontrado.' }); return; }
        const [customer] = await db.select({ until: schema.users.freeDeliveryUntil }).from(schema.users).where(eq(schema.users.id, req.user!.id));
        freight = freightForSavedAddress(address, settings, Number((deliverySubtotal + preorderSubtotal).toFixed(2)), customer?.until);
      }
      const totals = calculateOrderPartTotals(deliverySubtotal, preorderSubtotal, freight?.finalFee || 0);
      res.json({ lines, totals, freight, quoteToken: freight?.status === 'OK' ? quoteToken(req.user!.id, Number(req.body.addressId), req.body.items, totals.subtotal, freight) : null, promises: buildFulfillmentPromises(settings), quotedAt: new Date().toISOString(), maxQtyPerItem: maxQty });
    } catch (error) {
      if (error instanceof FreightError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      logServerError('cart.quote.failed', error);
      const message = error instanceof Error ? error.message : '';
      res.status(message ? 400 : 500).json({ error: message || 'Erro ao cotar a sacola.' });
    }
  });

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
        res.status(404).json({ error: 'Endereço inválido ou não pertence à sua conta.' });
        return;
      }

      if (!isServedAddress(address)) { res.status(422).json({ error: 'Atendemos apenas Itatiba', code: 'CITY_NOT_SERVED' }); return; }
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
      const normalizedDeliveryMode = null;
      const normalizedDeliveryMinutes = null;
      const estimatedDeliveryAt = null;
      const scheduledDeliveryAt = null;
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
          fulfillmentType: 'DELIVERY' | 'PREORDER';
        }> = [];
        const reservations: Array<{ productId: number; quantity: number; beforeStock: number; afterStock: number }> = [];
        let hasPreorderPart = false;
        let hasDeliveryPart = false;
        const preorderWindow = calculatePreorderWindow(new Date(), Number(settingsMap.preorder_start_offset_days || 1), Number(settingsMap.preorder_window_days || 7));

        // Agrupa itens com o mesmo productId para garantir que o limite da promoção seja respeitado por produto
        const mergedItemsMap = new Map<number, { productId: number; quantity: number; productName?: string; receiveAllAsPreorder?: boolean }>();
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
              receiveAllAsPreorder: Boolean(rawItem.receiveAllAsPreorder),
            });
          }
        }

        for (const rawItem of mergedItemsMap.values()) {
          if (rawItem.quantity > Math.max(1, Number(settingsMap.max_qty_per_item || 20))) throw new Error('A quantidade máxima por produto é 99 unidades.');
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

          const receiveAllAsPreorder = Boolean(rawItem.receiveAllAsPreorder);
          const split = calculateFulfillmentSplit(qty, prod.stock, receiveAllAsPreorder);
          if (split.preorderQty > 0 && !prod.allowPreorder) {
            throw new Error(`O produto "${prod.code} - ${prod.name}" não aceita encomenda.`);
          }
          const deliveryQty = split.deliveryQty;
          if (deliveryQty > 0) {
            const nextProdStock = prod.stock - deliveryQty;
            const reservedRows = await tx
              .update(schema.products)
              .set({ stock: sql`${schema.products.stock} - ${deliveryQty}`, updatedAt: new Date() })
              .where(and(eq(schema.products.id, prod.id), sql`${schema.products.stock} >= ${deliveryQty}`))
              .returning();
            if (reservedRows.length === 0) {
              throw new Error(`Estoque alterado para "${prod.code} - ${prod.name}". Refaça a cotação antes de confirmar.`);
            }
            reservations.push({ productId: prod.id, quantity: deliveryQty, beforeStock: prod.stock, afterStock: nextProdStock });
            hasDeliveryPart = true;
          }
          if (split.preorderQty > 0) hasPreorderPart = true;
          const hasPromo = isPromoCurrentlyActive(prod);
          const pricing = calculatePromoLinePricing({ normalPrice: prod.price, promoPrice: prod.promoPrice, hasPromo, promoMaxUnits: prod.promoMaxUnits, quantity: qty });
          subtotalNum = Number((subtotalNum + pricing.subtotal).toFixed(2));
          const displayProductName = prod.code ? `${prod.code} - ${prod.name}` : prod.name;
          const preciseCost = prod.costUnitPrecise !== null && prod.costUnitPrecise !== undefined ? prod.costUnitPrecise : prod.cost;
          const currentUnitCost = preciseCost !== null && preciseCost !== undefined ? String(preciseCost) : null;
          const pushPart = (partQty: number, type: 'DELIVERY' | 'PREORDER', promoQty: number) => {
            if (partQty <= 0) return;
            const partSubtotal = Number((promoQty * pricing.promoUnitPrice + (partQty - promoQty) * pricing.normalUnitPrice).toFixed(2));
            const partUnitPrice = partQty ? Number((partSubtotal / partQty).toFixed(2)) : pricing.normalUnitPrice;
            preparedItems.push({ productId: prod.id, productName: displayProductName, quantity: partQty, unitPrice: partUnitPrice.toFixed(2), subtotal: partSubtotal.toFixed(2), unitCost: currentUnitCost, fulfillmentType: type });
          };
          const deliveryPromoQty = Math.min(deliveryQty, pricing.promoQty);
          const preorderPromoQty = Math.min(split.preorderQty, Math.max(0, pricing.promoQty - deliveryPromoQty));
          pushPart(deliveryQty, 'DELIVERY', deliveryPromoQty);
          pushPart(split.preorderQty, 'PREORDER', preorderPromoQty);
        }
        const [customerPromotion] = await tx.select({ freeDeliveryUntil: schema.users.freeDeliveryUntil }).from(schema.users).where(eq(schema.users.id, req.user!.id));
        const [currentAddress] = await tx.select().from(schema.addresses).where(and(eq(schema.addresses.id, address.id), eq(schema.addresses.userId, req.user!.id))).for('share');
        if (!currentAddress) throw new FreightError('NOT_FOUND', 404, 'Endereço não encontrado.');
        const freight = requireAvailableFreight(freightForSavedAddress(currentAddress, settingsMap, subtotalNum, customerPromotion?.freeDeliveryUntil));
        if (req.body.quoteToken !== undefined && req.body.quoteToken !== quoteToken(req.user!.id, address.id, items, subtotalNum, freight)) throw new FreightError('QUOTE_CHANGED', 409, 'A cotação mudou. Atualize o resumo e confirme novamente.');
        const deliveryDistanceStr = freight.distanceKm!.toFixed(2);
        const deliveryFeeStr = freight.finalFee!.toFixed(2);
        const deliveryFeeSource = freight.source;

        const totalNum =
          deliveryFeeStr !== null
            ? Number((subtotalNum + parseFloat(deliveryFeeStr)).toFixed(2))
            : subtotalNum;

        const changeForStr: string | null = null;

        // New orders always have computed freight and payment deadline; null is legacy only.
        const paymentReleased = deliveryFeeStr !== null;
        const paymentExpiresAt = paymentReleased
          ? computePaymentExpiresAt(deadlineHours)
          : null;

        const orderNumber = await getNextGlobalOrderNumber(tx);

        const addressSnapshot: schema.AddressSnapshot = {
          id: currentAddress.id,
          label: currentAddress.label,
          zipCode: currentAddress.zipCode,
          street: currentAddress.street,
          number: currentAddress.number,
          complement: currentAddress.complement,
          neighborhood: currentAddress.neighborhood,
          city: currentAddress.city,
          state: currentAddress.state,
          reference: currentAddress.reference,
          deliveryOrigin: currentAddress.deliveryOrigin,
          deliveryNotes: currentAddress.deliveryNotes,
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
            stockDeducted: reservations.length > 0,
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
            deliveryEtaAt: estimatedDeliveryAt,
            preorderEtaStart: hasPreorderPart ? preorderWindow.start : null,
            preorderEtaEnd: hasPreorderPart ? preorderWindow.end : null,
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
            fulfillmentType: item.fulfillmentType,
          });
        }

        if (hasDeliveryPart) await tx.insert(schema.orderFulfillments).values({ orderId: newOrder.id, type: 'DELIVERY', status: 'PENDING', etaAt: estimatedDeliveryAt });
        if (hasPreorderPart) await tx.insert(schema.orderFulfillments).values({ orderId: newOrder.id, type: 'PREORDER', status: 'PENDING', etaStart: preorderWindow.start, etaEnd: preorderWindow.end });
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
      if (error instanceof FreightError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
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
      const fulfillmentRows = userOrders.length
        ? await db.select().from(schema.orderFulfillments).where(inArray(schema.orderFulfillments.orderId, userOrders.map((order) => order.id)))
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
            return toCustomerOrderItem(i, primary ? primary.imageUrl : null);
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
          fulfillments: fulfillmentRows.filter((f) => f.orderId === o.id).map(({ deliveredBy: _deliveredBy, ...fulfillment }) => fulfillment),
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
        return toCustomerOrderItem(i, primary ? primary.imageUrl : null);
      });

      const history = await db
        .select()
        .from(schema.orderStatusHistory)
        .where(eq(schema.orderStatusHistory.orderId, order.id))
        .orderBy(desc(schema.orderStatusHistory.id));
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
      const fulfillments = await db.select().from(schema.orderFulfillments).where(eq(schema.orderFulfillments.orderId, order.id));

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
        fulfillments: fulfillments.map(({ deliveredBy: _deliveredBy, ...fulfillment }) => fulfillment),
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
          for (const item of items) {
              if (item.fulfillmentType !== 'DELIVERY') continue;
              returns.set(item.productId, (returns.get(item.productId) || 0) + item.quantity);
            }
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

        await tx.update(schema.orderFulfillments).set({ status: 'CANCELLED' }).where(and(eq(schema.orderFulfillments.orderId, freshOrder.id), sql`${schema.orderFulfillments.status} NOT IN ('DELIVERED','REFUNDED')`));
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
