import { logServerError, logServerEvent } from '../logger.ts';
import { Express } from 'express';
import bcrypt from 'bcryptjs';
import {
  eq,
  desc,
  asc,
  and,
  or,
  sql,
  count,
  gte,
  lte,
  ilike,
  inArray,
  isNull,
  ne,
} from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  resolveAddressFreight,
  calculateSuggestedFreight,
} from '../../services/freightService.ts';
import {
  buildOrderWhatsAppMessage,
  buildWhatsAppLink,
} from '../../utils/whatsapp.ts';
import { AuthRequest, requireAuth, requireAdmin } from '../middleware/auth.ts';
import { isAdminRole } from '../governance.ts';
import { audit as auditAdminEvent } from './adminPhase3Routes.ts';
import {
  STOCK_DEDUCTED_STATUSES,
  PAID_ORDER_STATUSES,
  VALID_ORDER_STATUSES,
  ORDER_STATUS_LABELS_PT,
  computePaymentExpiresAt,
  buildStatusNotificationTexts,
  validateAndNormalizeCode,
  calculateDiscountPercent,
  parseAndValidateMediaItems,
  maskCpf,
  isPromoCurrentlyActive,
  resolvePromoTiming,
  resolvePromoMaxUnits,
  calculatePromoLinePricing,
  getSettingsMap,
  getFreightRuleConfig,
  getPrimaryStoreId,
} from '../services/storeHelpers.ts';
import { recordInventoryMovement } from '../services/inventoryService.ts';
import { expireOverdueUnpaidOrders, PAYMENT_TIMEOUT_REASON_PREFIX, LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX } from '../services/orderExpirationService.ts';
import { getStoreRange, DEFAULT_STORE_TIMEZONE, tzToUtc } from '../../utils/timezone.ts';
import { getCallMeBotStatus, sendCallMeBotMessage } from '../services/callmebotService.ts';
import { DEFAULT_STORE_HOURS, getStoreState, parseStoreHours, validateStoreHours } from '../services/storeStatusService.ts';
import { calculateStockProfitScenarios } from '../services/profitService.ts';
const notPaymentExpiredOrder = () => sql`COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${PAYMENT_TIMEOUT_REASON_PREFIX + '%'} AND COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX + '%'}`;
export function registerAdminRoutes(app: Express) {
  const allowedOrderTransitions: Record<string, string[]> = {
    NEW: ['AWAITING_PAYMENT', 'PAID', 'PREPARING', 'CANCELLED'],
    AWAITING_PAYMENT: ['PAID', 'PREPARING', 'CANCELLED'],
    PAID: ['PREPARING', 'OUT_FOR_DELIVERY', 'CANCELLED'],
    PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  // Notificações limitadas e enriquecidas por IDs: o polling não carrega tabelas inteiras.
  app.get('/api/admin/notifications', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [recentRows, activeRows, unreadCountRows, activePopupCountRows, freightRule, settingsMap] = await Promise.all([
        db.select().from(schema.adminNotifications).orderBy(desc(schema.adminNotifications.id)).limit(30),
        db.select().from(schema.adminNotifications)
          .where(eq(schema.adminNotifications.popupDismissed, false))
          .orderBy(desc(schema.adminNotifications.id)).limit(10),
        db.select({ value: count() }).from(schema.adminNotifications)
          .where(eq(schema.adminNotifications.isRead, false)),
        db.select({ value: count() }).from(schema.adminNotifications)
          .where(eq(schema.adminNotifications.popupDismissed, false)),
        getFreightRuleConfig(),
        getSettingsMap(),
      ]);
      const rowsById = new Map([...recentRows, ...activeRows].map((row) => [row.id, row]));
      const allRows = [...rowsById.values()];
      const userIds = [...new Set(allRows.map((row) => row.customerId).filter((id): id is number => id !== null))];
      const addressIds = [...new Set(allRows.map((row) => row.addressId).filter((id): id is number => id !== null))];
      const orderIds = [...new Set(allRows.map((row) => row.orderId).filter((id): id is number => id !== null))];
      const [users, selectedAddresses, customerAddresses, orders, orderItems] = await Promise.all([
        userIds.length ? db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : Promise.resolve([]),
        addressIds.length ? db.select().from(schema.addresses).where(inArray(schema.addresses.id, addressIds)) : Promise.resolve([]),
        userIds.length ? db.select().from(schema.addresses).where(inArray(schema.addresses.userId, userIds)).orderBy(desc(schema.addresses.id)) : Promise.resolve([]),
        orderIds.length ? db.select().from(schema.orders).where(inArray(schema.orders.id, orderIds)) : Promise.resolve([]),
        orderIds.length ? db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds)) : Promise.resolve([]),
      ]);
      const userMap = new Map(users.map((user) => [user.id, user]));
      const addressMap = new Map(selectedAddresses.map((address) => [address.id, address]));
      const latestAddressByUser = new Map<number, (typeof customerAddresses)[number]>();
      for (const address of customerAddresses) {
        if (!latestAddressByUser.has(address.userId)) latestAddressByUser.set(address.userId, address);
        if (!addressMap.has(address.id)) addressMap.set(address.id, address);
      }
      const orderMap = new Map(orders.map((order) => [order.id, order]));
      const itemsByOrderId = new Map<number, typeof orderItems>();
      for (const item of orderItems) {
        const items = itemsByOrderId.get(item.orderId) || [];
        items.push(item);
        itemsByOrderId.set(item.orderId, items);
      }
      const enrich = (notification: (typeof allRows)[number]) => {
        const customer = notification.customerId ? userMap.get(notification.customerId) : null;
        const order = notification.orderId ? orderMap.get(notification.orderId) : null;
        const address = (notification.addressId ? addressMap.get(notification.addressId) : null) ||
          (notification.customerId ? latestAddressByUser.get(notification.customerId) : null) || null;
        const items = order ? (itemsByOrderId.get(order.id) || []).map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          subtotal: item.subtotal,
        })) : [];
        return {
          ...notification,
          customer: customer ? {
            id: customer.id,
            name: customer.name,
            cpf: maskCpf(customer.cpf),
            email: customer.email,
            phone: customer.phone,
            createdAt: customer.createdAt,
          } : null,
          order: order ? {
            id: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            status: order.status,
            createdAt: order.createdAt,
            itemCount: items.reduce((total, item) => total + item.quantity, 0),
            items,
          } : null,
          address: address ? { ...address, freight: resolveAddressFreight(address) } : null,
        };
      };
      const enriched = recentRows.map(enrich);
      const enrichedActive = activeRows.map(enrich);
      res.json({
        notifications: enriched,
        unreadCount: Number(unreadCountRows[0]?.value || 0),
        activePopupCount: Number(activePopupCountRows[0]?.value || 0),
        activePopups: enrichedActive,
        freightRule,
        defaultOrigin: settingsMap.store_origin_address || 'Matriz DeepShop',
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar notificações do painel admin.' });
    }
  });

  app.put(
    '/api/admin/notifications/:id/dismiss-popup',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const notifId = Number(req.params.id);
        const [updated] = await db
          .update(schema.adminNotifications)
          .set({ popupDismissed: true })
          .where(eq(schema.adminNotifications.id, notifId))
          .returning();
        res.json({ success: true, notification: updated || null });
      } catch (error) {
        logServerError('server_operation_failed', error);
        res.status(500).json({ error: 'Erro ao fechar notificação.' });
      }
    }
  );

  app.put('/api/admin/notifications/:id/read', requireAuth, requireAdmin, async (req, res) => {
    try {
      const notifId = Number(req.params.id);
      const [updated] = await db
        .update(schema.adminNotifications)
        .set({ isRead: true, popupDismissed: true })
        .where(eq(schema.adminNotifications.id, notifId))
        .returning();
      res.json({ success: true, notification: updated || null });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao atualizar notificação.' });
    }
  });

  app.put('/api/admin/notifications/read-all', requireAuth, requireAdmin, async (_req, res) => {
    try {
      await db
        .update(schema.adminNotifications)
        .set({ isRead: true, popupDismissed: true });
      res.json({ success: true });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao atualizar notificações.' });
    }
  });

  // Resumo operacional enxuto para navegação e polling: sempre agrega no backend e
  // devolve apenas contadores e uma pequena fila de pedidos recentes.
  app.get('/api/admin/dashboard/summary', requireAuth, requireAdmin, async (_req, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const settingsMap = await getSettingsMap();
      const storeTimezone = settingsMap.store_timezone || DEFAULT_STORE_TIMEZONE;
      const todayRange = getStoreRange('today', storeTimezone);
      const [statusRows, todayOrdersRow, newCustomersRow, customersRow, activeProductsRow, inactiveProductsRow, categoriesRow, pendingAddressesRow, pendingFreightOrdersRow, latestOrderRows, pendingRows] =
        await Promise.all([
          db
            .select({ status: schema.orders.status, value: count() })
            .from(schema.orders)
            .where(notPaymentExpiredOrder())
            .groupBy(schema.orders.status),
          db
            .select({ value: count() })
            .from(schema.orders)
            .where(and(notPaymentExpiredOrder(), gte(schema.orders.createdAt, todayRange.start), lte(schema.orders.createdAt, todayRange.end))),
          db
            .select({ value: count() })
            .from(schema.users)
            .where(and(
              eq(schema.users.role, 'CUSTOMER'),
              gte(schema.users.createdAt, todayRange.start),
              lte(schema.users.createdAt, todayRange.end),
            )),
          db
            .select({ value: count() })
            .from(schema.users)
            .where(eq(schema.users.role, 'CUSTOMER')),
          db
            .select({ value: count() })
            .from(schema.products)
            .where(and(eq(schema.products.status, 'ACTIVE'), sql`(${schema.products.stock} > 0 OR ${schema.products.allowPreorder} = TRUE)`)),
          db
            .select({ value: count() })
            .from(schema.products)
            .where(or(eq(schema.products.status, 'INACTIVE'), sql`(${schema.products.stock} <= 0 AND ${schema.products.allowPreorder} = FALSE)`)),
          db.select({ value: count() }).from(schema.categories),
          db
            .select({ value: count() })
            .from(schema.addresses)
            .where(eq(schema.addresses.deliveryFeeStatus, 'PENDING')),
          db
            .select({ value: count() })
            .from(schema.orders)
            .where(and(notPaymentExpiredOrder(), isNull(schema.orders.deliveryFee), ne(schema.orders.status, 'CANCELLED'))),
          db
            .select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, customerName: schema.users.name })
            .from(schema.orders)
            .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
            .where(notPaymentExpiredOrder())
            .orderBy(desc(schema.orders.id))
            .limit(1),
          db
            .select({
              order: schema.orders,
              customerName: schema.users.name,
            })
            .from(schema.orders)
            .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
            .where(and(notPaymentExpiredOrder(), ne(schema.orders.status, 'DELIVERED'), ne(schema.orders.status, 'CANCELLED')))
            .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
            .limit(8),
        ]);

      const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.value || 0)]));
      const orderIds = pendingRows.map((row) => row.order.id);
      const pendingItems = orderIds.length
        ? await db
            .select({ orderId: schema.orderItems.orderId, productName: schema.orderItems.productName, quantity: schema.orderItems.quantity })
            .from(schema.orderItems)
            .where(inArray(schema.orderItems.orderId, orderIds))
        : [];
      const itemsByOrderId = new Map<number, typeof pendingItems>();
      for (const item of pendingItems) {
        const items = itemsByOrderId.get(item.orderId) || [];
        items.push(item);
        itemsByOrderId.set(item.orderId, items);
      }
      const pendingDeliveryOrders = pendingRows.map(({ order, customerName }) => ({
        ...order,
        customerName: customerName || 'Cliente',
        items: itemsByOrderId.get(order.id) || [],
      }));
      const storeState = getStoreState(settingsMap);
      const maxOrderId = Number(latestOrderRows[0]?.id || 0);

      res.json({
        statusCounts,
        metrics: {
          todayOrdersCount: Number(todayOrdersRow[0]?.value || 0),
          newCustomersCount: Number(newCustomersRow[0]?.value || 0),
          customersCount: Number(customersRow[0]?.value || 0),
          totalOrdersCount: Object.values(statusCounts).reduce((total, value) => total + Number(value || 0), 0),
          activeProductsCount: Number(activeProductsRow[0]?.value || 0),
          inactiveProductsCount: Number(inactiveProductsRow[0]?.value || 0),
          categoriesCount: Number(categoriesRow[0]?.value || 0),
          pendingFreightAddressesCount: Number(pendingAddressesRow[0]?.value || 0),
          pendingFreightOrdersCount: Number(pendingFreightOrdersRow[0]?.value || 0),
          pendingOrdersCount: (statusCounts.NEW || 0) + (statusCounts.AWAITING_PAYMENT || 0) +
            (statusCounts.PAID || 0) + (statusCounts.PREPARING || 0) + (statusCounts.OUT_FOR_DELIVERY || 0),
        },
        storeState,
        storeTimezone,
        maxOrderId,
        newestOrder: latestOrderRows[0] || null,
        pendingDeliveryOrders,
        alerts: {
          pendingFreightAddressesCount: Number(pendingAddressesRow[0]?.value || 0),
          pendingFreightOrdersCount: Number(pendingFreightOrdersRow[0]?.value || 0),
        },
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar o resumo operacional.' });
    }
  });

  // Dashboard
  app.get('/api/admin/dashboard', requireAuth, requireAdmin, async (_req, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const allProducts = await db.select().from(schema.products);
      const allUsers = await db.select().from(schema.users);
      const allOrders = await db.select().from(schema.orders).where(notPaymentExpiredOrder()).orderBy(desc(schema.orders.id));
      const allOrderItems = await db.select().from(schema.orderItems);
      const allImages = await db.select().from(schema.productImages);
      const allAddresses = await db
        .select()
        .from(schema.addresses)
        .orderBy(desc(schema.addresses.id));

      const userMap = new Map(allUsers.map((u) => [u.id, u]));
      const itemsByOrderId = new Map<number, typeof allOrderItems>();
      for (const item of allOrderItems) {
        const list = itemsByOrderId.get(item.orderId) || [];
        list.push(item);
        itemsByOrderId.set(item.orderId, list);
      }

      const settingsMap = await getSettingsMap();
      const storeTimezone = settingsMap.store_timezone || DEFAULT_STORE_TIMEZONE;
      const packagingCostPerOrder = Math.max(0, parseFloat(settingsMap.packaging_cost_per_order || '0') || 0);
      const deliveryCostPerOrder = Math.max(0, parseFloat(settingsMap.delivery_cost_per_order || '0') || 0);
      const monthlyFixedCosts = Math.max(0, parseFloat(settingsMap.monthly_fixed_costs || '0') || 0);

      // Função de cálculo financeiro rigorosa (Item 3 e 4)
      const computeFinancialSummary = (orderSubset: typeof allOrders, isMonth: boolean = false) => {
        let productsRevenue = 0;
        let freightRevenue = 0;
        let totalRevenue = 0;
        let productsCost = 0;
        let hasUnknownCost = false;
        let itemsSoldCount = 0;
        let freeDeliveriesCount = 0;
        let estimatedCostCount = 0;

        for (const ord of orderSubset) {
          const sub = parseFloat(ord.subtotal || '0') || 0;
          const fee = parseFloat(ord.deliveryFee || '0') || 0;
          productsRevenue += sub;
          freightRevenue += fee;
          totalRevenue += (parseFloat(ord.total || '0') || (sub + fee));

          if (fee === 0) {
            freeDeliveriesCount++;
          }

          const ordItems = itemsByOrderId.get(ord.id) || [];
          for (const it of ordItems) {
            const hasUnitCost = it.unitCost !== null && it.unitCost !== undefined;
            if (!hasUnitCost) {
              estimatedCostCount++;
            }
            // Custo histórico nulo permanece desconhecido; nunca usar o custo atual do produto.
            if (!hasUnitCost) {
              hasUnknownCost = true;
            } else {
              productsCost += (parseFloat(String(it.unitCost)) || 0) * (it.quantity || 0);
            }
            itemsSoldCount += it.quantity || 0;
          }
        }

        const ordersCount = orderSubset.length;
        // Item 4:
        // Lucro bruto dos produtos = subtotal dos produtos - custo dos produtos
        const knownProductsCost = Number(productsCost.toFixed(2));
        const grossProductProfit = hasUnknownCost ? null : Number((productsRevenue - knownProductsCost).toFixed(2));
        const packagingTotal = Number((ordersCount * packagingCostPerOrder).toFixed(2));
        const deliveryTotal = Number((ordersCount * deliveryCostPerOrder).toFixed(2));
        const freeDeliveryCost = Number((freeDeliveriesCount * deliveryCostPerOrder).toFixed(2));

        // Lucro estimado antes do fixo = Vendas - Custo dos produtos - Embalagem - Entrega
        // (= grossProductProfit + freightRevenue - packagingTotal - deliveryTotal)
        const estimatedProfitBeforeFixed = hasUnknownCost ? null : Number(
          (productsRevenue + freightRevenue - knownProductsCost - packagingTotal - deliveryTotal).toFixed(2)
        );

        const fixedCosts = isMonth ? monthlyFixedCosts : 0;
        const estimatedProfit = estimatedProfitBeforeFixed === null ? null : Number((estimatedProfitBeforeFixed - fixedCosts).toFixed(2));

        const grossMarginPercent =
          grossProductProfit !== null && productsRevenue > 0 ? Number(((grossProductProfit / productsRevenue) * 100).toFixed(1)) : null;

        return {
          ordersCount,
          itemsSoldCount,
          // Sequência exata do Item 4:
          salesTotal: Number(totalRevenue.toFixed(2)), // Vendas (produtos + frete)
          productsRevenue: Number(productsRevenue.toFixed(2)), // Produtos
          freightRevenue: Number(freightRevenue.toFixed(2)), // Frete cobrado
          productsCost: hasUnknownCost ? null : knownProductsCost, // Custo histórico dos produtos
          grossProductProfit, // Lucro bruto dos produtos
          packagingCostPerOrder, // Custo unitário de embalagem
          packagingTotal, // (-) Embalagem total
          deliveryCostPerOrder, // Custo unitário de entrega
          deliveryTotal, // (-) Custo de entrega total
          estimatedProfitBeforeFixed, // Lucro estimado antes do fixo
          monthlyFixedCosts: isMonth ? monthlyFixedCosts : 0, // Custos fixos do mês (apenas no mês)
          fixedCostsNote: isMonth ? null : 'custos fixos entram no resultado do mês',
          estimatedProfit, // = Lucro estimado do período; null quando custo histórico incompleto
          freeDeliveriesCount, // Fretes grátis concedidos: quantidade
          freeDeliveryCost, // Fretes grátis concedidos: custo total
          estimatedCostCount, // Contagem de itens com custo estimado
          // Compatibilidade com telas legadas:
          totalRevenue: Number(totalRevenue.toFixed(2)),
          netProfit: estimatedProfit,
          profitMarginPercent: grossMarginPercent,
          costStatus: hasUnknownCost ? 'INCOMPLETE' : 'KNOWN',
          unknownCostItems: estimatedCostCount,
        };
      };

      const activeProducts = allProducts.filter((p) => p.status === 'ACTIVE' && (p.stock > 0 || p.allowPreorder));
      const inactiveProducts = allProducts.filter((p) => p.status === 'INACTIVE' || (p.stock <= 0 && !p.allowPreorder));
      const lowStockProducts = allProducts.filter(
        (p) => p.status === 'ACTIVE' && p.stock > 0 && p.stock <= Number(p.stockMinimum ?? 5)
      );
      const customers = allUsers.filter((u) => u.role === 'CUSTOMER');
      const statusCounts = allOrders.reduce<Record<string, number>>((counts, order) => {
        counts[order.status] = (counts[order.status] || 0) + 1;
        return counts;
      }, {});

      // PEDIDOS PENDENTES DE ENTREGA (Novo, Aguardando Pagamento, Pago, Em separação, Saiu para entrega)
      const allPendingDeliveryOrders = allOrders
        .filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED')
        .sort((a, b) => b.id - a.id);
      const pendingDeliveryOrders = allPendingDeliveryOrders
        .slice(0, 8)
        .map((o) => {
          const owner = userMap.get(o.userId);
          const ordItems = (itemsByOrderId.get(o.id) || []).map((it) => {
            const pImgs = allImages.filter((img) => img.productId === it.productId);
            const primary =
              pImgs.find((im) => im.isPrimary && im.mediaType !== 'VIDEO') ||
              pImgs.find((im) => im.mediaType !== 'VIDEO') ||
              pImgs[0];
            return {
              ...it,
              imageUrl: primary ? primary.imageUrl : null,
            };
          });

          const customerPhone = owner ? owner.phone : '';
          const customerName = owner ? owner.name : 'Cliente';
          const customerWhatsappUrl = customerPhone
            ? buildWhatsAppLink(
                customerPhone,
                `Olá ${customerName}! Aqui é da loja DeepShop sobre o seu pedido ${o.orderNumber} (Status: ${ORDER_STATUS_LABELS_PT[o.status] || o.status}).`
              )
            : '';

          return {
            ...o,
            customerName,
            customerPhone,
            customerEmail: owner ? owner.email : '',
            customerWhatsappUrl,
            items: ordItems,
          };
        });

      // Item 1 e Item 2: Fuso horário da loja e filtro por delivered_at
      const todayRange = getStoreRange('today', storeTimezone);
      const monthRange = getStoreRange('month', storeTimezone);
      const todayOrdersCount = allOrders.filter(
        (o) => new Date(o.createdAt) >= todayRange.start && new Date(o.createdAt) <= todayRange.end
      ).length;
      const newCustomersCount = customers.filter(
        (u) => new Date(u.createdAt) >= todayRange.start && new Date(u.createdAt) <= todayRange.end
      ).length;

      const deliveredOrdersToday = allOrders.filter(
        (o) =>
          o.status === 'DELIVERED' &&
          o.deliveredAt &&
          new Date(o.deliveredAt) >= todayRange.start &&
          new Date(o.deliveredAt) <= todayRange.end
      );

      const salesTodayTotal = deliveredOrdersToday.reduce(
        (acc, o) => acc + parseFloat(o.total || '0'),
        0
      );

      const deliveredOrdersMonth = allOrders.filter(
        (o) =>
          o.status === 'DELIVERED' &&
          o.deliveredAt &&
          new Date(o.deliveredAt) >= monthRange.start &&
          new Date(o.deliveredAt) <= monthRange.end
      );

      const salesMonthTotal = deliveredOrdersMonth.reduce(
        (acc, o) => acc + parseFloat(o.total || '0'),
        0
      );

      const deliveredOrdersAllTime = allOrders.filter((o) => o.status === 'DELIVERED');

      const todayFinancials = computeFinancialSummary(deliveredOrdersToday, false);
      const monthFinancials = computeFinancialSummary(deliveredOrdersMonth, true);
      const allTimeFinancials = computeFinancialSummary(deliveredOrdersAllTime, false);

      // Item 5: Avaliação financeira do estoque atual na prateleira
      // Considerar no lucro projetado SOMENTE produtos com custo > 0.
      // Excluir produtos sem custo do lucro projetado e do custo total.
      let totalStockUnits = 0;
      let totalInventoryCost = 0;
      let totalInventorySaleValue = 0;
      const productsWithoutCost: Array<{
        id: number;
        code: string;
        name: string;
        stock: number;
        price: string;
      }> = [];

      for (const p of allProducts) {
        if (p.stock > 0) {
          totalStockUnits += p.stock;
          const costNum = parseFloat(String(p.costUnitPrecise ?? p.cost ?? '0').replace(',', '.')) || 0;
          const priceNum = parseFloat(String(p.price || '0').replace(',', '.')) || 0;
          const promoActive = isPromoCurrentlyActive(p);
          const promoPriceNum =
            promoActive && p.promoPrice
              ? parseFloat(String(p.promoPrice).replace(',', '.'))
              : null;

          if (costNum <= 0) {
            productsWithoutCost.push({
              id: p.id,
              code: p.code,
              name: p.name,
              stock: p.stock,
              price: p.price,
            });
            // Excluído do custo total e do lucro projetado
            continue;
          }

          // Projeção com limite de promoção
          let projectedSaleVal = 0;
          if (promoActive && promoPriceNum !== null) {
            const maxUnits = p.promoMaxUnits && p.promoMaxUnits > 0 ? p.promoMaxUnits : null;
            if (maxUnits !== null) {
              const promoUnits = Math.min(p.stock, maxUnits);
              const normalUnits = Math.max(0, p.stock - maxUnits);
              projectedSaleVal = promoUnits * promoPriceNum + normalUnits * priceNum;
            } else {
              projectedSaleVal = p.stock * promoPriceNum;
            }
          } else {
            projectedSaleVal = p.stock * priceNum;
          }

          totalInventoryCost += Number(p.costUnitPrecise ?? costNum) * p.stock;
          totalInventorySaleValue += projectedSaleVal;
        }
      }

      const inventoryValuation = {
        totalStockUnits,
        totalInventoryCost: Number(totalInventoryCost.toFixed(2)),
        totalInventorySaleValue: Number(totalInventorySaleValue.toFixed(2)),
        projectedInventoryProfit: Number(
          (totalInventorySaleValue - totalInventoryCost).toFixed(2)
        ),
        productsWithoutCostCount: productsWithoutCost.length,
        productsWithoutCost,
      };

      const allPendingFreightAddresses = allAddresses
        .filter((a) => a.deliveryFeeStatus === 'PENDING')
        .map((a) => {
          const owner = userMap.get(a.userId);
          return {
            ...a,
            customerName: owner ? owner.name : 'Cliente',
            customerPhone: owner ? owner.phone : '',
            customerEmail: owner ? owner.email : '',
          };
        });

      const allPendingFreightOrders = allOrders
        .filter((o) => o.deliveryFee === null && o.status !== 'CANCELLED')
        .map((o) => {
          const owner = userMap.get(o.userId);
          return {
            ...o,
            customerName: owner ? owner.name : 'Cliente',
            customerPhone: owner ? owner.phone : '',
          };
        });

      const pendingFreightAddresses = allPendingFreightAddresses.slice(0, 6);
      const pendingFreightOrders = allPendingFreightOrders.slice(0, 6);

      res.json({
        metrics: {
          activeProductsCount: activeProducts.length,
          inactiveProductsCount: inactiveProducts.length,
          lowStockCount: lowStockProducts.length,
          customersCount: customers.length,
          pendingOrdersCount: allPendingDeliveryOrders.length,
          todayOrdersCount,
          newCustomersCount,
          statusCounts,
          deliveredOrdersCount: deliveredOrdersAllTime.length,
          ordersTodayCount: deliveredOrdersToday.length,
          salesTodayTotal: Number(salesTodayTotal.toFixed(2)),
          salesMonthTotal: Number(salesMonthTotal.toFixed(2)),
          grossProfitTodayTotal: todayFinancials.grossProductProfit,
          grossProfitMonthTotal: monthFinancials.grossProductProfit,
          profitTodayTotal: todayFinancials.estimatedProfit,
          profitMonthTotal: monthFinancials.estimatedProfit,
          costTodayTotal: todayFinancials.productsCost,
          costMonthTotal: monthFinancials.productsCost,
          freeDeliveriesCountToday: todayFinancials.freeDeliveriesCount,
          freeDeliveriesCountMonth: monthFinancials.freeDeliveriesCount,
        },
        pendingDeliveryOrders,
        financials: {
          today: todayFinancials,
          month: monthFinancials,
          allTime: allTimeFinancials,
          inventory: inventoryValuation,
        },
        lowStockProducts,
        inactiveProducts,
        alerts: {
          pendingFreightAddresses,
          pendingFreightAddressesCount: allPendingFreightAddresses.length,
          pendingFreightOrders,
          pendingFreightOrdersCount: allPendingFreightOrders.length,
        },
        storeTimezone,
        storeState: getStoreState(settingsMap),
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar indicadores do dashboard.' });
    }
  });

  // ============================================================================
  // ANÁLISE DE LUCRO POR PRODUTO & RANKING DE VENDAS (ITENS 3, 6 E 7)
  // ============================================================================
  app.get('/api/admin/analytics/products', requireAuth, requireAdmin, async (req, res) => {
    try {
      const period = (req.query.period as '7d' | '30d' | 'all') || 'all';
      const settingsMap = await getSettingsMap();
      const storeTimezone = settingsMap.store_timezone || DEFAULT_STORE_TIMEZONE;
      const range = getStoreRange(period, storeTimezone);

      const allProducts = await db.select().from(schema.products);
      const allCategories = await db.select().from(schema.categories);
      const allImages = await db.select().from(schema.productImages);
      const allOrders = await db.select().from(schema.orders);
      const allOrderItems = await db.select().from(schema.orderItems);
      const allInteractions = await db.select().from(schema.productInteractions);

      const categoryMap = new Map(allCategories.map((c) => [c.id, c.name]));
      // Filtro de interações no período selecionado
      const periodInteractions =
        period === 'all'
          ? allInteractions
          : allInteractions.filter(
              (i) =>
                new Date(i.createdAt) >= range.start && new Date(i.createdAt) <= range.end
            );

      const viewVisitorsByProd = new Map<number, Set<string>>();
      const clicksByProd = new Map<number, number>();
      const sharesByProd = new Map<number, number>();

      for (const inter of periodInteractions) {
        if (inter.type === 'VIEW') {
          const s = viewVisitorsByProd.get(inter.productId) || new Set<string>();
          s.add(inter.visitorId);
          viewVisitorsByProd.set(inter.productId, s);
        } else if (inter.type === 'CLICK') {
          clicksByProd.set(inter.productId, (clicksByProd.get(inter.productId) || 0) + 1);
        } else if (inter.type === 'SHARE') {
          sharesByProd.set(inter.productId, (sharesByProd.get(inter.productId) || 0) + 1);
        }
      }

      // Pedidos NÃO CANCELADOS no período (para cálculo de taxa de conversão)
      const periodNonCancelledOrders =
        period === 'all'
          ? allOrders.filter((o) => o.status !== 'CANCELLED')
          : allOrders.filter(
              (o) =>
                o.status !== 'CANCELLED' &&
                new Date(o.createdAt) >= range.start &&
                new Date(o.createdAt) <= range.end
            );
      const periodNonCancelledOrderIds = new Set(periodNonCancelledOrders.map((o) => o.id));

      const ordersContainingProduct = new Map<number, Set<number>>();
      for (const it of allOrderItems) {
        if (periodNonCancelledOrderIds.has(it.orderId)) {
          const s = ordersContainingProduct.get(it.productId) || new Set<number>();
          s.add(it.orderId);
          ordersContainingProduct.set(it.productId, s);
        }
      }

      // Pedidos ENTREGUES no período (para faturamento e lucro realizado)
      const deliveredOrdersInPeriod =
        period === 'all'
          ? allOrders.filter((o) => o.status === 'DELIVERED')
          : allOrders.filter(
              (o) =>
                o.status === 'DELIVERED' &&
                o.deliveredAt &&
                new Date(o.deliveredAt) >= range.start &&
                new Date(o.deliveredAt) <= range.end
            );
      const deliveredOrdersSet = new Set(deliveredOrdersInPeriod.map((o) => o.id));

      // Total de vendas por produto em pedidos entregues
      const salesByProduct = new Map<
        number,
        {
          unitsSold: number;
          totalRevenue: number;
          totalCost: number;
          hasUnknownCost: boolean;
          ordersCount: number;
        }
      >();

      for (const it of allOrderItems) {
        if (!deliveredOrdersSet.has(it.orderId)) continue;
        const current = salesByProduct.get(it.productId) || {
          unitsSold: 0,
          totalRevenue: 0,
          totalCost: 0,
          hasUnknownCost: false,
          ordersCount: 0,
        };
        // O custo histórico nulo permanece desconhecido; não usar custo atual do produto.
        if (it.unitCost === null || it.unitCost === undefined) {
          current.hasUnknownCost = true;
        } else {
          current.totalCost += (parseFloat(String(it.unitCost)) || 0) * (it.quantity || 0);
        }

        current.unitsSold += it.quantity;
        current.totalRevenue += parseFloat(it.subtotal || '0') || 0;
        current.ordersCount += 1;
        salesByProduct.set(it.productId, current);
      }

      let totalStockUnits = 0;
      let totalStockCost = 0;
      let totalStockSaleValue = 0;
      let totalStockPromoSaleValue = 0;
      let totalRealizedProfitAll = 0;
      let hasUnknownRealizedProfit = false;
      let totalDeliveredUnitsAll = 0;

      const analyzedProducts = allProducts.map((p) => {
        const costNum = parseFloat(String(p.costUnitPrecise ?? p.cost ?? '0').replace(',', '.')) || 0;
        const priceNum = parseFloat(String(p.price || '0').replace(',', '.')) || 0;
        const promoActive = isPromoCurrentlyActive(p);
        const promoNum =
          promoActive && p.promoPrice
            ? parseFloat(String(p.promoPrice).replace(',', '.'))
            : null;
        const effectivePrice = promoNum !== null ? promoNum : priceNum;
        const stockProfitScenarios = calculateStockProfitScenarios({ ...p, price: priceNum, promoPrice: promoNum, promoActive, cost: costNum });

        const hasCostDefined = costNum > 0;
        let unitProfit = 0;
        let unitMarginPercent = 0;
        let markupPercent = 0;
        let marginStatus: 'NO_COST' | 'ZERO_PROFIT' | 'PROFITABLE' | 'LOSS' = 'NO_COST';

        if (hasCostDefined) {
          unitProfit = Number((effectivePrice - costNum).toFixed(2));
          unitMarginPercent = effectivePrice > 0 ? Number(((unitProfit / effectivePrice) * 100).toFixed(1)) : 0;
          markupPercent = costNum > 0 ? Number(((unitProfit / costNum) * 100).toFixed(1)) : 0;
          marginStatus = unitProfit < 0 ? 'LOSS' : unitProfit === 0 ? 'ZERO_PROFIT' : 'PROFITABLE';
        }

        const potentialStockProfit = hasCostDefined ? (stockProfitScenarios.promoStockProfit ?? stockProfitScenarios.normalStockProfit ?? 0) : 0;

        if (p.stock > 0) {
          totalStockUnits += p.stock;
          totalStockCost += costNum * p.stock;
          totalStockSaleValue += stockProfitScenarios.normalStockRevenue;
          totalStockPromoSaleValue += stockProfitScenarios.promoStockRevenue ?? stockProfitScenarios.normalStockRevenue;
        }

        const stats = salesByProduct.get(p.id) || {
          unitsSold: 0,
          totalRevenue: 0,
          totalCost: 0,
          hasUnknownCost: false,
          ordersCount: 0,
        };

        // Item 3: Lucro realizado usa o custo no momento da venda (stats.totalCost)
        const realizedProfit = stats.hasUnknownCost ? null : Number((stats.totalRevenue - stats.totalCost).toFixed(2));
        if (realizedProfit === null) hasUnknownRealizedProfit = true;

        if (realizedProfit !== null) totalRealizedProfitAll += realizedProfit;
        totalDeliveredUnitsAll += stats.unitsSold;

        const pImgs = allImages.filter((im) => im.productId === p.id);
        const primary =
          pImgs.find((im) => im.isPrimary && im.mediaType !== 'VIDEO') ||
          pImgs.find((im) => im.mediaType !== 'VIDEO') ||
          pImgs[0];

        // Item 6 e 7: Visitantes únicos que viram o produto, Cliques e Compartilhamentos
        const recordedUniqueViewers = viewVisitorsByProd.get(p.id)?.size || 0;
        // Preserva histórico para 'all' se não havia interações gravadas
        const uniqueVisitors =
          period === 'all'
            ? Math.max(recordedUniqueViewers, p.viewsCount || 0)
            : recordedUniqueViewers;

        const clicksCount =
          period === 'all'
            ? Math.max(clicksByProd.get(p.id) || 0, p.clicksCount || 0)
            : clicksByProd.get(p.id) || 0;

        const sharesCount =
          period === 'all'
            ? Math.max(sharesByProd.get(p.id) || 0, p.sharesCount || 0)
            : sharesByProd.get(p.id) || 0;

        // Pedidos não cancelados que contêm o produto
        const ordersWithProductCount = ordersContainingProduct.get(p.id)?.size || 0;

        // Taxa de conversão: pedidos com produto / visitantes únicos (máximo 100%).
        // Se menos de 10 visitantes únicos, retorna null para exibir "—" (poucos dados).
        const hasEnoughVisitors = uniqueVisitors >= 10;
        const conversionRatePercent =
          hasEnoughVisitors && uniqueVisitors > 0
            ? Math.min(100, Number(((ordersWithProductCount / uniqueVisitors) * 100).toFixed(1)))
            : null;

        return {
          id: p.id,
          code: p.code,
          name: p.name,
          categoryName: categoryMap.get(p.categoryId) || 'Geral',
          imageUrl: primary ? primary.imageUrl : null,
          status: p.status,
          stock: p.stock,
          isKit: p.isKit,
          cost: costNum,
          price: priceNum,
          promoPrice: promoNum,
          hasPromo: promoActive,
          effectivePrice,
          hasCostDefined,
          marginStatus,
          markupPercent,
          unitProfit,
          unitMarginPercent,
          potentialStockProfit,
          normalStockProfit: stockProfitScenarios.normalStockProfit,
          promoStockProfit: stockProfitScenarios.promoStockProfit,
          viewsCount: uniqueVisitors,
          clicksCount,
          sharesCount,
          conversionRatePercent,
          hasEnoughConversionData: hasEnoughVisitors,
          unitsSold: stats.unitsSold,
          revenue: Number(stats.totalRevenue.toFixed(2)),
          realizedProfit,
          realizedCostStatus: stats.hasUnknownCost ? 'INCOMPLETE' : 'KNOWN',
          ordersCount: stats.ordersCount,
        };
      });

      // Rankings
      const rankingBestSellers = [...analyzedProducts]
        .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
        .slice(0, 10);

      const rankingMostProfitable = [...analyzedProducts]
        .sort((a, b) => (b.realizedProfit ?? -Infinity) - (a.realizedProfit ?? -Infinity) || b.unitsSold - a.unitsSold)
        .slice(0, 10);

      const rankingHighestMargin = [...analyzedProducts]
        .filter((p) => p.status === 'ACTIVE')
        .sort((a, b) => b.unitMarginPercent - a.unitMarginPercent || b.unitProfit - a.unitProfit)
        .slice(0, 10);

      const rankingMostViewed = [...analyzedProducts]
        .sort((a, b) => b.viewsCount - a.viewsCount || b.clicksCount - a.clicksCount)
        .slice(0, 10);

      const rankingMostClicked = [...analyzedProducts]
        .sort((a, b) => b.clicksCount - a.clicksCount || b.viewsCount - a.viewsCount)
        .slice(0, 10);

      const rankingMostShared = [...analyzedProducts]
        .sort((a, b) => b.sharesCount - a.sharesCount || b.viewsCount - a.viewsCount)
        .slice(0, 10);

      res.json({
        summary: {
          period,
          totalProducts: allProducts.length,
          totalProductsWithCost: analyzedProducts.filter((p) => p.hasCostDefined).length,
          totalStockUnits,
          totalStockCost: Number(totalStockCost.toFixed(2)),
          totalStockSaleValue: Number(totalStockSaleValue.toFixed(2)),
          potentialInventoryProfit: Number((totalStockSaleValue - totalStockCost).toFixed(2)),
          totalStockPromoSaleValue: Number(totalStockPromoSaleValue.toFixed(2)),
          potentialInventoryPromoProfit: Number((totalStockPromoSaleValue - totalStockCost).toFixed(2)),
          averageMarginPercent:
            totalStockSaleValue > 0
              ? Number(
                  (
                    ((totalStockSaleValue - totalStockCost) / totalStockSaleValue) *
                    100
                  ).toFixed(1)
                )
              : 0,
          totalRealizedProfitAll: hasUnknownRealizedProfit ? null : Number(totalRealizedProfitAll.toFixed(2)),
          realizedProfitStatus: hasUnknownRealizedProfit ? 'INCOMPLETE' : 'KNOWN',
          totalDeliveredUnitsAll,
          totalViewsAll: analyzedProducts.reduce((acc, p) => acc + (p.viewsCount || 0), 0),
          totalClicksAll: analyzedProducts.reduce((acc, p) => acc + (p.clicksCount || 0), 0),
          totalSharesAll: analyzedProducts.reduce((acc, p) => acc + (p.sharesCount || 0), 0),
        },
        products: analyzedProducts,
        rankingBestSellers,
        rankingMostProfitable,
        rankingHighestMargin,
        rankingMostViewed,
        rankingMostClicked,
        rankingMostShared,
      });
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar análise de produtos.' });
    }
  });

  // Admin: Categorias
  app.get('/api/admin/categories', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const list = await db
        .select()
        .from(schema.categories)
        .orderBy(desc(schema.categories.id));
      res.json(list);
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao listar categorias.' });
    }
  });

  app.post('/api/admin/categories', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, description, status } = req.body;
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'Informe o nome da categoria.' });
        return;
      }
      const storeId = await getPrimaryStoreId();
      const [created] = await db
        .insert(schema.categories)
        .values({
          storeId,
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        })
        .returning();
      res.status(201).json(created);
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao criar categoria.' });
    }
  });

  app.put('/api/admin/categories/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const catId = Number(req.params.id);
      const { name, description, status } = req.body;
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'Informe o nome da categoria.' });
        return;
      }
      const [updated] = await db
        .update(schema.categories)
        .set({
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.categories.id, catId))
        .returning();
      res.json(updated);
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao editar categoria.' });
    }
  });

  // Admin: Produtos e Kits
  app.get('/api/admin/products', requireAuth, requireAdmin, async (_req, res) => {
    try {
      await expireOverdueUnpaidOrders();

      const allProducts = await db
        .select()
        .from(schema.products)
        .orderBy(desc(schema.products.id));
      const allCategories = await db.select().from(schema.categories);
      const allImages = await db.select().from(schema.productImages);
      const allKitItems = await db.select().from(schema.productKitItems);

      const catMap = new Map(allCategories.map((c) => [c.id, c.name]));
      const prodMap = new Map(allProducts.map((p) => [p.id, p]));

      const enriched = allProducts.map((p) => {
        const imgs = allImages.filter((i) => i.productId === p.id);
        const primary =
          imgs.find((i) => i.isPrimary && i.mediaType !== 'VIDEO') ||
          imgs.find((i) => i.mediaType !== 'VIDEO') ||
          imgs[0];
        const hasPromo = isPromoCurrentlyActive(p);
        const promoExpired = Boolean(
          p.promoActive &&
            p.promoPrice &&
            p.promoEndsAt &&
            new Date(p.promoEndsAt).getTime() <= Date.now()
        );
        const effectivePrice = hasPromo ? String(p.promoPrice) : String(p.price);
        const discountPercent = calculateDiscountPercent(p.price, p.promoPrice, hasPromo);

        const kitComponents = p.isKit
          ? allKitItems
              .filter((k) => k.kitProductId === p.id)
              .map((k) => {
                const comp = prodMap.get(k.componentProductId);
                return {
                  id: k.id,
                  componentProductId: k.componentProductId,
                  componentCode: comp?.code || '',
                  componentName: comp?.name || 'Produto',
                  quantityPerKit: k.quantityPerKit,
                  totalReservedInKit: p.stock * k.quantityPerKit,
                };
              })
          : [];

        return {
          ...p,
          hasPromo,
          promoExpired,
          effectivePrice,
          discountPercent,
          kitComponents,
          categoryName: catMap.get(p.categoryId) || 'Sem categoria',
          imageUrl: primary ? primary.imageUrl : null,
          images: imgs,
        };
      });

      res.json(enriched);
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao listar produtos.' });
    }
  });

  app.post('/api/admin/products', requireAuth, requireAdmin, async (req, res) => {
    try {
      const {
        categoryId,
        code,
        name,
        description,
        price,
        promoPrice,
        promoActive,
        cost,
        stock,
        weight,
        status,
      } = req.body;

      if (!categoryId || !name || price === undefined || price === '') {
        res.status(400).json({ error: 'Nome, categoria e preço são obrigatórios.' });
        return;
      }

      const categoryIdNum = Number(categoryId);
      const priceInput = Number(String(price).replace(',', '.'));
      const stockInput = Number(stock ?? 0);
      const costInput = Number(String(cost ?? '0').replace(',', '.'));
      const preciseCostInput = req.body.costUnitPrecise === undefined ? costInput : Number(String(req.body.costUnitPrecise).replace(',', '.'));
      const lotTotalInput = req.body.costLotTotal === undefined || req.body.costLotTotal === null || req.body.costLotTotal === '' ? null : Number(String(req.body.costLotTotal).replace(',', '.'));
      const lotUnitsInput = req.body.costLotUnits === undefined || req.body.costLotUnits === null || req.body.costLotUnits === '' ? null : Number(req.body.costLotUnits);
      const weightInput = Number(String(weight ?? '0').replace(',', '.'));
      const promoInput = promoPrice === undefined || promoPrice === null || String(promoPrice).trim() === ''
        ? null
        : Number(String(promoPrice).replace(',', '.'));
      if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
          (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 5000)) ||
          !Number.isSafeInteger(categoryIdNum) || categoryIdNum <= 0 ||
          !Number.isFinite(priceInput) || priceInput < 0 || priceInput > 99999999.99 ||
          !Number.isInteger(stockInput) || stockInput < 0 || stockInput > 1000000 ||
          !Number.isFinite(costInput) || costInput < 0 || costInput > 99999999.99 ||
          !Number.isFinite(preciseCostInput) || preciseCostInput < 0 || preciseCostInput > 99999999.999999 ||
          (lotTotalInput !== null && (!Number.isFinite(lotTotalInput) || lotTotalInput < 0 || lotUnitsInput === null || !Number.isSafeInteger(lotUnitsInput) || lotUnitsInput <= 0)) ||
          !Number.isFinite(weightInput) || weightInput < 0 || weightInput > 9999999.999 ||
          (promoInput !== null && (!Number.isFinite(promoInput) || promoInput < 0 || promoInput > 99999999.99))) {
        res.status(400).json({ error: 'Campos do produto inválidos ou acima dos limites permitidos.' });
        return;
      }

      const normalizedCode = code
        ? validateAndNormalizeCode(code)
        : `A${String(Math.floor(100 + Math.random() * 900))}`;

      if (!normalizedCode) {
        res.status(400).json({
          error:
            'Código do produto inválido. Use até 4 caracteres: 1 letra seguida de até 3 números (ex: A001, B12, P105).',
        });
        return;
      }

      const storeId = await getPrimaryStoreId();
      const priceNum = priceInput;
      const rawPromo =
        promoPrice !== undefined && promoPrice !== null && String(promoPrice).trim() !== ''
          ? parseFloat(String(promoPrice).replace(',', '.'))
          : null;
      const isPromoValid = rawPromo !== null && !isNaN(rawPromo) && rawPromo > 0;
      const finalPromoPrice = isPromoValid ? rawPromo.toFixed(2) : null;
      const finalPromoActive = Boolean(promoActive) && isPromoValid;
      const { promoEndsAt, promoDurationHours } = resolvePromoTiming(
        req.body,
        finalPromoActive,
        null
      );
      const promoMaxUnits = resolvePromoMaxUnits(req.body, finalPromoActive);

      const costNum = costInput;
      const stockNum = stockInput;
      const weightNum = weightInput;

      const parsedMedia = parseAndValidateMediaItems(req.body);

      const [created] = await db
        .insert(schema.products)
        .values({
          storeId,
          categoryId: Number(categoryId),
          code: normalizedCode,
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          price: priceNum.toFixed(2),
          promoPrice: finalPromoPrice,
          promoActive: finalPromoActive,
          promoEndsAt,
          promoDurationHours,
          promoMaxUnits,
          isKit: false,
          cost: preciseCostInput.toFixed(2),
          costUnitPrecise: preciseCostInput.toFixed(6),
          costLotTotal: lotTotalInput === null ? null : lotTotalInput.toFixed(2),
          costLotUnits: lotUnitsInput,
          stock: stockNum,
          weight: weightNum.toFixed(3),
          status: stockNum <= 0 || status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        })
        .returning();

      if (parsedMedia && parsedMedia.length > 0) {
        for (const m of parsedMedia) {
          await db.insert(schema.productImages).values({
            productId: created.id,
            imageUrl: m.imageUrl,
            mediaType: m.mediaType,
            durationSeconds: m.durationSeconds,
            isPrimary: m.isPrimary,
          });
        }
      }

      res.status(201).json(created);
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(400).json({ error: 'Erro ao cadastrar produto.' });
    }
  });

  app.put('/api/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const prodId = Number(req.params.id);
      const {
        categoryId,
        code,
        name,
        description,
        price,
        promoPrice,
        promoActive,
        cost,
        stock,
        weight,
        status,
      } = req.body;

      if (!categoryId || !name || price === undefined || price === '') {
        res.status(400).json({ error: 'Nome, categoria e preço são obrigatórios.' });
        return;
      }

      const categoryIdNum = Number(categoryId);
      const priceInput = Number(String(price).replace(',', '.'));
      const stockInput = Number(stock ?? 0);
      const costInput = Number(String(cost ?? '0').replace(',', '.'));
      const preciseCostInput = req.body.costUnitPrecise === undefined ? costInput : Number(String(req.body.costUnitPrecise).replace(',', '.'));
      const lotTotalInput = req.body.costLotTotal === undefined || req.body.costLotTotal === null || req.body.costLotTotal === '' ? null : Number(String(req.body.costLotTotal).replace(',', '.'));
      const lotUnitsInput = req.body.costLotUnits === undefined || req.body.costLotUnits === null || req.body.costLotUnits === '' ? null : Number(req.body.costLotUnits);
      const weightInput = Number(String(weight ?? '0').replace(',', '.'));
      const promoInput = promoPrice === undefined || promoPrice === null || String(promoPrice).trim() === ''
        ? null
        : Number(String(promoPrice).replace(',', '.'));
      if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
          (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 5000)) ||
          !Number.isSafeInteger(categoryIdNum) || categoryIdNum <= 0 ||
          !Number.isFinite(priceInput) || priceInput < 0 || priceInput > 99999999.99 ||
          !Number.isInteger(stockInput) || stockInput < 0 || stockInput > 1000000 ||
          !Number.isFinite(costInput) || costInput < 0 || costInput > 99999999.99 ||
          !Number.isFinite(preciseCostInput) || preciseCostInput < 0 || preciseCostInput > 99999999.999999 ||
          (lotTotalInput !== null && (!Number.isFinite(lotTotalInput) || lotTotalInput < 0 || lotUnitsInput === null || !Number.isSafeInteger(lotUnitsInput) || lotUnitsInput <= 0)) ||
          !Number.isFinite(weightInput) || weightInput < 0 || weightInput > 9999999.999 ||
          (promoInput !== null && (!Number.isFinite(promoInput) || promoInput < 0 || promoInput > 99999999.99))) {
        res.status(400).json({ error: 'Campos do produto inválidos ou acima dos limites permitidos.' });
        return;
      }

      const [existingProd] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, prodId));

      if (!existingProd) {
        res.status(404).json({ error: 'Produto não encontrado.' });
        return;
      }

      const normalizedCode = code
        ? validateAndNormalizeCode(code)
        : existingProd.code || 'A001';

      if (!normalizedCode) {
        res.status(400).json({
          error:
            'Código do produto inválido. Use até 4 caracteres: 1 letra seguida de até 3 números (ex: A001, B12, P105).',
        });
        return;
      }

      const priceNum = priceInput;
      const rawPromo =
        promoPrice !== undefined && promoPrice !== null && String(promoPrice).trim() !== ''
          ? parseFloat(String(promoPrice).replace(',', '.'))
          : null;
      const isPromoValid = rawPromo !== null && !isNaN(rawPromo) && rawPromo > 0;
      const finalPromoPrice = isPromoValid ? rawPromo.toFixed(2) : null;
      const finalPromoActive = Boolean(promoActive) && isPromoValid;
      const { promoEndsAt, promoDurationHours } = resolvePromoTiming(
        req.body,
        finalPromoActive,
        existingProd
      );
      const promoMaxUnits = resolvePromoMaxUnits(req.body, finalPromoActive);

      const costNum = costInput;
      const stockNum = stockInput;
      const weightNum = weightInput;

      const parsedMedia = parseAndValidateMediaItems(req.body);

      const [updated] = await db
        .update(schema.products)
        .set({
          categoryId: categoryIdNum,
          code: normalizedCode,
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          price: priceNum.toFixed(2),
          promoPrice: finalPromoPrice,
          promoActive: finalPromoActive,
          promoEndsAt,
          promoDurationHours,
          promoMaxUnits,
          cost: preciseCostInput.toFixed(2),
          costUnitPrecise: preciseCostInput.toFixed(6),
          costLotTotal: lotTotalInput === null ? null : lotTotalInput.toFixed(2),
          costLotUnits: lotUnitsInput,
          stock: stockNum,
          weight: weightNum.toFixed(3),
          status: stockNum <= 0 || status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(and(eq(schema.products.id, prodId), eq(schema.products.stock, existingProd.stock)))
        .returning();

      if (!updated) {
        res.status(409).json({ error: 'O estoque foi alterado por outra operação. Atualize os dados e tente novamente.' });
        return;
      }

      if (parsedMedia !== null) {
        await db
          .delete(schema.productImages)
          .where(eq(schema.productImages.productId, prodId));
        for (const m of parsedMedia) {
          await db.insert(schema.productImages).values({
            productId: prodId,
            imageUrl: m.imageUrl,
            mediaType: m.mediaType,
            durationSeconds: m.durationSeconds,
            isPrimary: m.isPrimary,
          });
        }
      }

      res.json(updated);
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(400).json({ error: 'Erro ao atualizar produto.' });
    }
  });

  // Requisito 1: Editar estoque de produto inativo/zerado e deixá-lo ATIVO novamente na vitrine
  app.put(
    '/api/admin/products/:id/activate-stock',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const prodId = Number(req.params.id);
        const stockNum = Number(req.body.stock);

        if (!Number.isSafeInteger(stockNum) || stockNum <= 0 || stockNum > 1000000) {
          res.status(400).json({
            error:
              'Informe uma quantidade de estoque maior que zero para reativar o produto na vitrine.',
          });
          return;
        }

        const [existingProd] = await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, prodId));

        if (!existingProd) {
          res.status(404).json({ error: 'Produto não encontrado.' });
          return;
        }

        const [updated] = await db
          .update(schema.products)
          .set({
            stock: stockNum,
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(and(eq(schema.products.id, prodId), eq(schema.products.stock, existingProd.stock)))
          .returning();

        if (!updated) {
          res.status(409).json({ error: 'O estoque foi alterado por outra operação. Atualize os dados e tente novamente.' });
          return;
        }
        res.json(updated);
      } catch (error: any) {
        logServerError('server_operation_failed', error);
        res.status(400).json({ error: 'Erro ao ativar produto.' });
      }
    }
  );

  // Montar Kit & Desfazer Kit
  app.post('/api/admin/kits', requireAuth, requireAdmin, async (req, res) => {
    try {
      const {
        categoryId,
        code,
        name,
        description,
        price,
        promoPrice,
        promoActive,
        cost,
        kitsQuantity,
        weight,
        components,
      } = req.body;

      if (!categoryId || !name || price === undefined || price === '') {
        res.status(400).json({ error: 'Informe nome, categoria e preço do Kit.' });
        return;
      }

      if (!Array.isArray(components) || components.length === 0) {
        res.status(400).json({
          error: 'Selecione pelo menos um produto da loja e a quantidade para montar o Kit.',
        });
        return;
      }

      const categoryIdNum = Number(categoryId);
      const kitsCount = Number(kitsQuantity ?? 1);
      const priceNum = Number(String(price).replace(',', '.'));
      const weightNum = Number(String(weight ?? '0').replace(',', '.'));
      const promoNum = promoPrice === undefined || promoPrice === null || String(promoPrice).trim() === ''
        ? null
        : Number(String(promoPrice).replace(',', '.'));
      if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
          (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 5000)) ||
          !Number.isSafeInteger(categoryIdNum) || categoryIdNum <= 0 ||
          !Number.isSafeInteger(kitsCount) || kitsCount < 1 || kitsCount > 1000 ||
          components.length > 100 ||
          !Number.isFinite(priceNum) || priceNum < 0 || priceNum > 99999999.99 ||
          !Number.isFinite(weightNum) || weightNum < 0 || weightNum > 9999999.999 ||
          (promoNum !== null && (!Number.isFinite(promoNum) || promoNum < 0 || promoNum > 99999999.99))) {
        res.status(400).json({ error: 'Dados do kit inválidos ou acima dos limites permitidos.' });
        return;
      }
      const suppliedCost = cost === undefined || cost === null || cost === ''
        ? null
        : Number(String(cost).replace(',', '.'));
      if (suppliedCost !== null && (!Number.isFinite(suppliedCost) || suppliedCost < 0 || suppliedCost > 99999999.99)) {
        res.status(400).json({ error: 'Custo do kit inválido.' });
        return;
      }

      const normalizedCode = code
        ? validateAndNormalizeCode(code)
        : `K${String(Math.floor(100 + Math.random() * 900))}`;

      if (!normalizedCode) {
        res.status(400).json({
          error:
            'Código do Kit inválido. Use até 4 caracteres: 1 letra seguida de até 3 números (ex: K001).',
        });
        return;
      }

      
      const storeId = await getPrimaryStoreId();

      
      const rawPromo =
        promoPrice !== undefined && promoPrice !== null && String(promoPrice).trim() !== ''
          ? parseFloat(String(promoPrice).replace(',', '.'))
          : null;
      const isPromoValid = rawPromo !== null && !isNaN(rawPromo) && rawPromo > 0;
      const finalPromoPrice = isPromoValid ? rawPromo.toFixed(2) : null;
      const finalPromoActive = Boolean(promoActive) && isPromoValid;
      const { promoEndsAt, promoDurationHours } = resolvePromoTiming(
        req.body,
        finalPromoActive,
        null
      );
      const promoMaxUnits = resolvePromoMaxUnits(req.body, finalPromoActive);
      

      const createdKit = await db.transaction(async (tx) => {
        let calculatedCostPerKit = 0;
        const validatedComponents: Array<{
          productId: number;
          quantityPerKit: number;
          totalDeducted: number;
          name: string;
          code: string;
        }> = [];

        for (const comp of components) {
          const compProdId = Number(comp.productId);
          const qtyPerKit = Number(comp.quantityPerKit);

          if (!Number.isSafeInteger(compProdId) || compProdId <= 0 || !Number.isSafeInteger(qtyPerKit) || qtyPerKit <= 0 || qtyPerKit > 1000 || qtyPerKit * kitsCount > 1000000) {
            throw new Error('Quantidade inválida para um dos produtos do Kit.');
          }

          const [prod] = await tx
            .select()
            .from(schema.products)
            .where(eq(schema.products.id, compProdId));

          if (!prod) {
            throw new Error(`Produto #${compProdId} não encontrado.`);
          }

          const totalToDeduct = qtyPerKit * kitsCount;
          if (prod.stock < totalToDeduct) {
            throw new Error(
              `Estoque insuficiente em "${prod.code} - ${prod.name}". Saldo atual: ${prod.stock} un. Necessário para montar o kit: ${totalToDeduct} un.`
            );
          }

          const nextCompStock = prod.stock - totalToDeduct;
          const updatedStock = await tx
            .update(schema.products)
            .set({
              stock: sql`${schema.products.stock} - ${totalToDeduct}`,
              status: sql`CASE WHEN ${schema.products.stock} - ${totalToDeduct} <= 0 AND NOT ${schema.products.allowPreorder} THEN 'INACTIVE' ELSE ${schema.products.status} END`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.products.id, prod.id),
                sql`${schema.products.stock} >= ${totalToDeduct}`
              )
            )
            .returning();

          if (updatedStock.length === 0) {
            throw new Error(
              `Não foi possível reservar o estoque do produto "${prod.code} - ${prod.name}".`
            );
          }

          calculatedCostPerKit += parseFloat(String(prod.cost || '0')) * qtyPerKit;
          validatedComponents.push({
            productId: prod.id,
            quantityPerKit: qtyPerKit,
            totalDeducted: totalToDeduct,
            name: prod.name,
            code: prod.code,
          });
        }

        const finalCostNum = suppliedCost !== null ? suppliedCost : calculatedCostPerKit;

        const autoDesc =
          description && String(description).trim()
            ? String(description).trim()
            : `Kit composto por: ${validatedComponents
                .map((c) => `${c.quantityPerKit}x ${c.code} - ${c.name}`)
                .join(', ')}.`;

        const [kitProd] = await tx
          .insert(schema.products)
          .values({
            storeId,
            categoryId: categoryIdNum,
            code: normalizedCode,
            name: String(name).trim(),
            description: autoDesc,
            price: priceNum.toFixed(2),
            promoPrice: finalPromoPrice,
            promoActive: finalPromoActive,
            promoEndsAt,
            promoDurationHours,
            promoMaxUnits,
            isKit: true,
            cost: finalCostNum.toFixed(2),
            stock: kitsCount,
            weight: weightNum.toFixed(3),
            status: 'ACTIVE',
          })
          .returning();

        for (const vc of validatedComponents) {
          await tx.insert(schema.productKitItems).values({
            kitProductId: kitProd.id,
            componentProductId: vc.productId,
            quantityPerKit: vc.quantityPerKit,
          });
        }

        const parsedKitMedia = parseAndValidateMediaItems(req.body);
        if (parsedKitMedia && parsedKitMedia.length > 0) {
          for (const m of parsedKitMedia) {
            await tx.insert(schema.productImages).values({
              productId: kitProd.id,
              imageUrl: m.imageUrl,
              mediaType: m.mediaType,
              durationSeconds: m.durationSeconds,
              isPrimary: m.isPrimary,
            });
          }
        }

        return {
          kit: kitProd,
          deductedComponents: validatedComponents,
        };
      });

      res.status(201).json(createdKit);
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(400).json({ error: 'Erro ao montar Kit.' });
    }
  });

  // Desfazer Kit: devolve o saldo reservado de volta para os produtos originais
  app.post('/api/admin/kits/:id/disassemble', requireAuth, requireAdmin, async (req, res) => {
    try {
      const kitId = Number(req.params.id);

      const result = await db.transaction(async (tx) => {
        const [kit] = await tx
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, kitId));

        if (!kit || !kit.isKit) {
          throw new Error('Kit não encontrado.');
        }

        const [claimedKit] = await tx
          .update(schema.products)
          .set({ stock: 0, status: 'INACTIVE', isKit: false, updatedAt: new Date() })
          .where(and(eq(schema.products.id, kit.id), eq(schema.products.isKit, true)))
          .returning({ id: schema.products.id });
        if (!claimedKit) throw new Error('O kit já está sendo desmontado ou foi alterado.');

        const kitItems = await tx
          .select()
          .from(schema.productKitItems)
          .where(eq(schema.productKitItems.kitProductId, kit.id));

        const restoredDetails: Array<{ productId: number; restoredQty: number }> = [];

        if (kit.stock > 0 && kitItems.length > 0) {
          for (const item of kitItems) {
            const qtyToReturn = kit.stock * item.quantityPerKit;
            if (qtyToReturn > 0) {
              await tx
                .update(schema.products)
                .set({
                  stock: sql`${schema.products.stock} + ${qtyToReturn}`,
                  updatedAt: new Date(),
                })
                .where(eq(schema.products.id, item.componentProductId));

              restoredDetails.push({
                productId: item.componentProductId,
                restoredQty: qtyToReturn,
              });
            }
          }
        }

        const usedInOrders = await tx
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.productId, kit.id));

        if (usedInOrders.length === 0) {
          await tx
            .delete(schema.productKitItems)
            .where(eq(schema.productKitItems.kitProductId, kit.id));
          await tx.delete(schema.products).where(eq(schema.products.id, kit.id));
        } else {
          await tx
            .delete(schema.productKitItems)
            .where(eq(schema.productKitItems.kitProductId, kit.id));
        }

        return {
          kitName: kit.name,
          restoredDetails,
        };
      });

      res.json({
        message: `Kit "${result.kitName}" desfeito com sucesso! Os saldos voltaram para o estoque dos produtos originais.`,
        ...result,
      });
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(400).json({ error: 'Erro ao desfazer Kit.' });
    }
  });

  // Admin: Clientes & Endereços & Frete Manual
  app.get('/api/admin/customers', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const allUsers = await db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.id));
      const allAddresses = await db
        .select()
        .from(schema.addresses)
        .orderBy(desc(schema.addresses.id));
      const allOrders = await db.select().from(schema.orders);

      const userMap = new Map(allUsers.map((u) => [u.id, u.name]));
      const freightRule = await getFreightRuleConfig();
      const settingsMap = await getSettingsMap();

      const customerUsers = allUsers.filter((u) => u.role === 'CUSTOMER');
      const customers = await Promise.all(
        customerUsers.map(async (u) => {
          const addrs = allAddresses
            .filter((a) => a.userId === u.id)
            .map((a) => ({
              ...a,
              updatedByName: a.deliveryUpdatedBy
                ? userMap.get(a.deliveryUpdatedBy) || 'Admin'
                : null,
              freight: resolveAddressFreight(a),
            }));
          const userOrders = allOrders.filter((o) => o.userId === u.id);
          return {
            id: u.id,
            name: u.name,
            cpf: maskCpf(u.cpf),
            email: u.email,
            phone: u.phone,
            status: u.status,
            deletionRequestedAt: u.deletionRequestedAt,
            createdAt: u.createdAt,
            addresses: addrs,
            ordersCount: userOrders.length,
          };
        })
      );

      res.json({
        customers,
        freightRule,
        defaultOrigin: settingsMap.store_origin_address || 'Matriz DeepShop',
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar clientes e endereços.' });
    }
  });

  // Sugestão aritmética simples de frete
  app.post('/api/admin/freight/suggest', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rawKm = parseFloat(String(req.body.distanceKm || '0').replace(',', '.'));
      if (isNaN(rawKm) || rawKm < 0) {
        res.status(400).json({ error: 'Informe uma distância válida em km.' });
        return;
      }
      const config = await getFreightRuleConfig();
      const suggestedFee = calculateSuggestedFreight(rawKm, config);
      res.json({
        distanceKm: rawKm,
        suggestedFee,
        rule: config,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao calcular sugestão de frete.' });
    }
  });

  // Definir/alterar frete de um endereço pelo ADMIN
  app.put(
    '/api/admin/addresses/:id/freight',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const addrId = Number(req.params.id);
        const { distanceKm, deliveryFee, deliveryOrigin, deliveryNotes } = req.body;

        const parsedDistance = parseFloat(String(distanceKm ?? '').replace(',', '.'));
        const parsedFee = parseFloat(String(deliveryFee ?? '').replace(',', '.'));

        if (isNaN(parsedDistance) || parsedDistance < 0) {
          res.status(400).json({ error: 'Informe uma distância em km válida (ex: 4,8).' });
          return;
        }
        if (isNaN(parsedFee) || parsedFee < 0) {
          res.status(400).json({ error: 'Informe um valor de frete válido (ex: 8,50).' });
          return;
        }

        const settingsMap = await getSettingsMap();
        const originText =
          deliveryOrigin && String(deliveryOrigin).trim()
            ? String(deliveryOrigin).trim()
            : settingsMap.store_origin_address || 'Matriz DeepShop';

        const [updated] = await db
          .update(schema.addresses)
          .set({
            deliveryDistanceKm: parsedDistance.toFixed(2),
            deliveryFee: parsedFee.toFixed(2),
            deliveryFeeStatus: 'CONFIRMED',
            deliveryFeeSource: 'MANUAL',
            deliveryOrigin: originText,
            deliveryNotes: deliveryNotes ? String(deliveryNotes).trim() : null,
            deliveryUpdatedBy: req.user!.id,
            deliveryUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.addresses.id, addrId))
          .returning();

        if (!updated) {
          res.status(404).json({ error: 'Endereço não encontrado.' });
          return;
        }

        await db
          .update(schema.adminNotifications)
          .set({ isRead: true, popupDismissed: true })
          .where(eq(schema.adminNotifications.customerId, updated.userId));

        // Se o cliente tiver algum pedido aberto ('NEW' ou 'AWAITING_PAYMENT') aguardando frete neste endereço,
        // já define o frete no pedido, recalcula o total, inicia o cronômetro de 1h e notifica o cliente!
        const deadlineHours = Math.max(
          0.1,
          parseFloat(settingsMap.payment_deadline_hours || '0.5') || 0.5
        );
        const customerOrders = await db
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.userId, updated.userId));

        for (const ord of customerOrders) {
          if (
            (ord.status === 'NEW' || ord.status === 'AWAITING_PAYMENT') &&
            ord.deliveryFee === null &&
            (!ord.addressSnapshot?.id || ord.addressSnapshot.id === addrId)
          ) {
            const sub = parseFloat(ord.subtotal);
            const nextTot = Number((sub + parsedFee).toFixed(2));
            const nextExpires = computePaymentExpiresAt(deadlineHours);

            await db
              .update(schema.orders)
              .set({
                deliveryFee: parsedFee.toFixed(2),
                deliveryDistanceKm: parsedDistance.toFixed(2),
                deliveryFeeSource: 'MANUAL',
                total: nextTot.toFixed(2),
                paymentExpiresAt: nextExpires,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, ord.id));

            await db.insert(schema.notifications).values({
              userId: updated.userId,
              orderId: ord.id,
              orderNumber: ord.orderNumber,
              oldStatus: ord.status,
              newStatus: ord.status,
              title: `💰 Frete definido e pagamento liberado! (Pedido #${ord.orderNumber})`,
              message: `O frete do seu pedido #${ord.orderNumber} foi confirmado em R$ ${parsedFee
                .toFixed(2)
                .replace('.', ',')}. O pagamento via PIX/WhatsApp já está liberado e você tem 1 hora para realizar o pagamento antes que a reserva do estoque expire!`,
              isRead: false,
              popupDismissed: false,
            });
          }
        }

        res.json({
          ...updated,
          freight: resolveAddressFreight(updated),
        });
      } catch (error) {
        logServerError('server_operation_failed', error);
        res.status(500).json({ error: 'Erro ao salvar frete do endereço.' });
      }
    }
  );

  // Admin: Pedidos — filtros e paginação executados no banco; a listagem não carrega itens nem histórico.
  app.get('/api/admin/orders', requireAuth, requireAdmin, async (req, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? req.query.limit ?? 25);
      if (!Number.isInteger(page) || page < 1 || page > 1000000) {
        res.status(400).json({ error: 'Página inválida.' });
        return;
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'O tamanho da página deve estar entre 1 e 100.' });
        return;
      }

      const status = String(req.query.status || 'ALL');
      const search = String(req.query.search || '').trim();
      const from = String(req.query.from || '');
      const to = String(req.query.to || '');
      const sort = String(req.query.sort || 'newest');
      if (search.length > 100) {
        res.status(400).json({ error: 'A busca deve ter no máximo 100 caracteres.' });
        return;
      }
      if (status !== 'ALL' && status !== 'PENDING_FREIGHT' && !VALID_ORDER_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Filtro de status inválido.' });
        return;
      }
      if (!['priority', 'oldest', 'newest'].includes(sort)) {
        res.status(400).json({ error: 'Ordenação inválida.' });
        return;
      }
      const settingsMap = await getSettingsMap();
      const storeTimezone = settingsMap.store_timezone || DEFAULT_STORE_TIMEZONE;

      const parseDateFilter = (value: string, endOfDay: boolean): Date | null => {
        if (!value) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(Number.NaN);
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return new Date(Number.NaN);
        return tzToUtc(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0, storeTimezone);
      };
      const fromDate = parseDateFilter(from, false);
      const toDate = parseDateFilter(to, true);
      if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) ||
          (fromDate && toDate && fromDate > toDate)) {
        res.status(400).json({ error: 'Período inválido.' });
        return;
      }

      const filters: any[] = [notPaymentExpiredOrder()];
      if (status === 'PENDING_FREIGHT') {
        filters.push(isNull(schema.orders.deliveryFee), ne(schema.orders.status, 'CANCELLED'));
      } else if (status !== 'ALL') {
        filters.push(eq(schema.orders.status, status));
      }
      if (search) {
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        filters.push(or(
          ilike(schema.orders.orderNumber, pattern),
          ilike(schema.users.name, pattern),
          ilike(schema.users.phone, pattern),
        ));
      }
      if (fromDate) filters.push(gte(schema.orders.createdAt, fromDate));
      if (toDate) filters.push(lte(schema.orders.createdAt, toDate));
      const whereClause = filters.length ? and(...filters) : undefined;

      const [[totalRow], rows] = await Promise.all([
        db
          .select({ value: count() })
          .from(schema.orders)
          .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
          .where(whereClause),
        db
          .select({
            order: schema.orders,
            customerName: schema.users.name,
            customerPhone: schema.users.phone,
            customerEmail: schema.users.email,
          })
          .from(schema.orders)
          .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
          .where(whereClause)
          .orderBy(
            ...(sort === 'oldest'
              ? [asc(schema.orders.createdAt), asc(schema.orders.id)]
              : sort === 'newest'
              ? [desc(schema.orders.createdAt), desc(schema.orders.id)]
              : [
                  sql<number>`CASE
                    WHEN ${schema.orders.status} IN ('NEW', 'AWAITING_PAYMENT') THEN 0
                    WHEN ${schema.orders.status} IN ('PAID', 'PREPARING') THEN 1
                    WHEN ${schema.orders.status} = 'OUT_FOR_DELIVERY' THEN 2
                    ELSE 3 END`,
                  asc(schema.orders.createdAt),
                  asc(schema.orders.id),
                ]),
          )
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);

      const deadlineHours = Math.max(0.1, parseFloat(settingsMap.payment_deadline_hours || '0.5') || 0.5);
      const nowMs = Date.now();
      const orders = rows.map(({ order, customerName, customerPhone, customerEmail }) => {
        const ageHours = (nowMs - new Date(order.createdAt).getTime()) / (1000 * 60 * 60);
        const isPaymentExpired = Boolean(
          (order.status === 'NEW' || order.status === 'AWAITING_PAYMENT') &&
            (order.paymentExpiresAt
              ? new Date(order.paymentExpiresAt).getTime() <= nowMs
              : ageHours >= deadlineHours)
        );
        const isFreeDelivery = order.deliveryFee !== null && Number(order.deliveryFee) === 0;
        return {
          ...order,
          isFreeDelivery,
          paymentReleased: Boolean(isFreeDelivery || order.deliveryFee !== null),
          customerName: customerName || 'Cliente',
          customerPhone: customerPhone || '',
          customerEmail: customerEmail || '',
          isPaymentExpired,
          ageHours: Number(ageHours.toFixed(1)),
          items: [],
          history: [],
        };
      });

      res.json({
        orders,
        page,
        pageSize,
        totalCount: Number(totalRow?.value || 0),
        totalPages: Math.ceil(Number(totalRow?.value || 0) / pageSize),
        paymentDeadlineHours: deadlineHours,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar pedidos.' });
    }
  });

  // Admin: Detalhe sob demanda, com histórico e itens apenas do pedido solicitado.
  app.get('/api/admin/orders/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const orderId = Number(req.params.id);
      if (!Number.isSafeInteger(orderId) || orderId < 1) {
        res.status(400).json({ error: 'Identificador de pedido inválido.' });
        return;
      }
      const [row] = await db
        .select({ order: schema.orders, customerName: schema.users.name, customerPhone: schema.users.phone, customerEmail: schema.users.email })
        .from(schema.orders)
        .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
        .where(and(eq(schema.orders.id, orderId), notPaymentExpiredOrder()));
      if (!row) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }
      const { order } = row;
      const rawItems = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      const productIds = [...new Set(rawItems.map((item) => item.productId))];
      const images = productIds.length
        ? await db.select().from(schema.productImages).where(inArray(schema.productImages.productId, productIds))
        : [];
      const items = rawItems.map((item) => {
        const productImages = images.filter((image) => image.productId === item.productId);
        const primary = productImages.find((image) => image.isPrimary && image.mediaType !== 'VIDEO') ||
          productImages.find((image) => image.mediaType !== 'VIDEO') || productImages[0];
        return { ...item, imageUrl: primary?.imageUrl || null };
      });
      const historyRows = await db
        .select()
        .from(schema.orderStatusHistory)
        .where(eq(schema.orderStatusHistory.orderId, order.id))
        .orderBy(desc(schema.orderStatusHistory.id));
      const actorIds = [...new Set(historyRows.map((entry) => entry.changedBy).filter((id): id is number => id !== null))];
      const actors = actorIds.length
        ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, actorIds))
        : [];
      const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
      const history = historyRows.map((entry) => ({
        ...entry,
        changedByName: entry.changedBy ? actorNames.get(entry.changedBy) || 'Usuário' : 'Sistema',
      }));
      const settingsMap = await getSettingsMap();
      const deadlineHours = Math.max(0.1, parseFloat(settingsMap.payment_deadline_hours || '0.5') || 0.5);
      const isFreeDelivery = order.deliveryFee !== null && Number(order.deliveryFee) === 0;
      const ageHours = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60);
      const paymentReleased = Boolean(isFreeDelivery || order.deliveryFee !== null);
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
      const customerPhone = row.customerPhone || '';
      const customerName = row.customerName || 'Cliente';
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
      res.json({
        ...order,
        payment: payment ? {
          provider: payment.provider,
          status: payment.status,
          providerStatus: payment.providerStatus,
          providerOrderId: payment.providerOrderId,
          providerPreferenceId: payment.providerPreferenceId,
          providerPaymentId: payment.providerPaymentId,
          amount: payment.amount,
          currency: payment.currency,
          updatedAt: payment.updatedAt,
        } : null,
        customerName,
        customerPhone,
        customerEmail: row.customerEmail || '',
        customerWhatsappUrl: customerPhone
          ? buildWhatsAppLink(customerPhone, `Olá ${customerName}! Aqui é da loja DeepShop sobre o seu pedido ${order.orderNumber}.`)
          : '',
        isFreeDelivery,
        paymentReleased,
        isPaymentExpired: Boolean(
          (order.status === 'NEW' || order.status === 'AWAITING_PAYMENT') &&
            (order.paymentExpiresAt ? new Date(order.paymentExpiresAt).getTime() <= Date.now() : ageHours >= deadlineHours)
        ),
        ageHours: Number(ageHours.toFixed(1)),
        items,
        history,
        whatsappMessage,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar detalhes do pedido.' });
    }
  });

  // Admin: Definir ou alterar o frete direto no pedido
  app.put(
    '/api/admin/orders/:id/freight',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const orderId = Number(req.params.id);
        const { deliveryFee, deliveryDistanceKm, alsoUpdateAddress, isManualFreeDelivery } =
          req.body;

        const parsedFee = isManualFreeDelivery
          ? 0
          : parseFloat(String(deliveryFee ?? '').replace(',', '.'));
        const parsedDist =
          deliveryDistanceKm !== undefined &&
          deliveryDistanceKm !== null &&
          deliveryDistanceKm !== ''
            ? parseFloat(String(deliveryDistanceKm).replace(',', '.'))
            : null;

        if (isNaN(parsedFee) || parsedFee < 0) {
          res.status(400).json({ error: 'Informe um valor de frete válido.' });
          return;
        }

        const [existingOrder] = await db
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.id, orderId));

        if (!existingOrder) {
          res.status(404).json({ error: 'Pedido não encontrado.' });
          return;
        }

        const subtotalNum = parseFloat(existingOrder.subtotal);
        const newTotalNum = Number((subtotalNum + parsedFee).toFixed(2));
        const nextSource =
          isManualFreeDelivery || parsedFee === 0 ? 'MANUAL_FREE_DELIVERY' : 'MANUAL';

        const settingsMap = await getSettingsMap();
        const deadlineHours = Math.max(
          0.1,
          parseFloat(settingsMap.payment_deadline_hours || '0.5') || 0.5
        );
        const wasWaitingForFreight = existingOrder.deliveryFee === null;
        const isUnpaidOrder =
          existingOrder.status === 'NEW' || existingOrder.status === 'AWAITING_PAYMENT';
        const nextPaymentExpiresAt = isUnpaidOrder
          ? existingOrder.paymentExpiresAt || computePaymentExpiresAt(deadlineHours)
          : existingOrder.paymentExpiresAt;

        const [updatedOrder] = await db
          .update(schema.orders)
          .set({
            deliveryFee: parsedFee.toFixed(2),
            deliveryDistanceKm:
              parsedDist !== null && !isNaN(parsedDist)
                ? parsedDist.toFixed(2)
                : existingOrder.deliveryDistanceKm,
            deliveryFeeSource: nextSource,
            total: newTotalNum.toFixed(2),
            paymentExpiresAt: nextPaymentExpiresAt,
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, orderId))
          .returning();

        if (isUnpaidOrder && wasWaitingForFreight) {
          await db.insert(schema.notifications).values({
            userId: existingOrder.userId,
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            oldStatus: existingOrder.status,
            newStatus: existingOrder.status,
            title: `💰 Frete definido e pagamento liberado! (Pedido #${existingOrder.orderNumber})`,
            message:
              parsedFee === 0
                ? `A loja liberou Entrega Grátis para o seu pedido #${existingOrder.orderNumber}! O pagamento via PIX/WhatsApp já está disponível e você tem 1 hora para concluir o pagamento.`
                : `O frete do seu pedido #${existingOrder.orderNumber} foi definido em R$ ${parsedFee
                    .toFixed(2)
                    .replace('.', ',')}. O pagamento via PIX/WhatsApp já está liberado e você tem 1 hora para realizar o pagamento antes que a reserva do estoque expire!`,
            isRead: false,
            popupDismissed: false,
          });
        }

        if (alsoUpdateAddress && existingOrder.addressSnapshot?.id) {
          await db
            .update(schema.addresses)
            .set({
              deliveryFee: parsedFee.toFixed(2),
              deliveryDistanceKm:
                parsedDist !== null && !isNaN(parsedDist) ? parsedDist.toFixed(2) : null,
              deliveryFeeStatus: 'CONFIRMED',
              deliveryFeeSource: 'MANUAL',
              deliveryOrigin: settingsMap.store_origin_address || 'Matriz DeepShop',
              deliveryUpdatedBy: req.user!.id,
              deliveryUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.addresses.id, existingOrder.addressSnapshot.id));
        }

        res.json(updatedOrder);
      } catch (error) {
        logServerError('server_operation_failed', error);
        res.status(500).json({ error: 'Erro ao atualizar frete do pedido.' });
      }
    }
  );

  app.put(
    '/api/admin/orders/:id/status',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      let transitionFrom: string | undefined;
      const stockChanges: Array<{ productId: number; delta: number }> = [];
      try {
        const orderId = Number(req.params.id);
        const { status } = req.body;
        const cancellationReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

        if (!status || !VALID_ORDER_STATUSES.includes(status)) {
          res.status(400).json({ error: 'Status de pedido inválido.' });
          return;
        }
        if (status === 'CANCELLED' && (cancellationReason.length < 5 || cancellationReason.length > 500)) {
          res.status(400).json({ error: 'Informe um motivo para cancelar o pedido (de 5 a 500 caracteres).' });
          return;
        }

        const updated = await db.transaction(async (tx) => {
          // Serializa a entrega com a abertura de tickets vinculados a este pedido.
          await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
          const [order] = await tx
            .select()
            .from(schema.orders)
            .where(eq(schema.orders.id, orderId));

          if (!order) {
            throw new Error('Pedido não encontrado.');
          }

          const oldStatus = order.status;
          transitionFrom = oldStatus;
          if (oldStatus === status) {
            return order;
          }
          if (PAID_ORDER_STATUSES.includes(status) && String(order.paymentMethod || '').toUpperCase() === 'MERCADOPAGO') {
            const [gatewayPayment] = await tx.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
            if (gatewayPayment?.status !== 'PAID') {
              throw new Error('Pedidos Mercado Pago só podem avançar após confirmação server-side do provedor.');
            }
          }
          if (status === 'PAID' && ['CASH', 'CASH_ON_DELIVERY', 'DINHEIRO'].includes(String(order.paymentMethod || '').toUpperCase())) {
            throw new Error('Pedidos com pagamento na entrega não podem ser marcados como pagos antes da entrega.');
          }
          if (!(allowedOrderTransitions[oldStatus] || []).includes(status)) {
            throw new Error(`Transição de pedido não permitida: ${oldStatus} → ${status}.`);
          }

          const items = await tx
            .select()
            .from(schema.orderItems)
            .where(eq(schema.orderItems.orderId, order.id));

          const shouldHaveStockDeducted = STOCK_DEDUCTED_STATUSES.includes(status);
          const currentlyHasStockDeducted = Boolean(order.stockDeducted);
          let nextStockDeducted = currentlyHasStockDeducted;

          if (!currentlyHasStockDeducted && shouldHaveStockDeducted) nextStockDeducted = true;
          else if (currentlyHasStockDeducted && !shouldHaveStockDeducted) nextStockDeducted = false;

          const settingsMap = await getSettingsMap(tx);
          const deadlineHours = Math.max(
            0.1,
            parseFloat(settingsMap.payment_deadline_hours || '0.5') || 0.5
          );

          // Se foi marcado como PAGO (ou status posterior pago) ou CANCELADO, desliga o cronômetro de expiração de 1h.
          // Se foi colocado em AWAITING_PAYMENT (ou NEW), garante que o cronômetro de 1h esteja ativo.
          let nextPaymentExpiresAt = order.paymentExpiresAt;
          if (PAID_ORDER_STATUSES.includes(status) || status === 'CANCELLED') {
            nextPaymentExpiresAt = null;
          } else if (
            (status === 'AWAITING_PAYMENT' || status === 'NEW') &&
            !order.paymentExpiresAt
          ) {
            nextPaymentExpiresAt = computePaymentExpiresAt(deadlineHours);
          }

          const nextDeliveredAt =
            status === 'DELIVERED'
              ? (order.deliveredAt || new Date())
              : null;

          const [updatedOrder] = await tx
            .update(schema.orders)
            .set({
              status,
              stockDeducted: nextStockDeducted,
              paymentExpiresAt: nextPaymentExpiresAt,
              deliveredAt: nextDeliveredAt,
              cancellationReason: status === 'CANCELLED' ? cancellationReason : order.cancellationReason,
              updatedAt: new Date(),
            })
            .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, oldStatus)))
            .returning();

          if (!updatedOrder) {
            throw new Error('O pedido foi alterado por outra operação. Atualize a tela e tente novamente.');
          }

          // O Compare-and-set do status ocorre primeiro; esta transação só persiste a baixa/devolução
          // se a transição tiver vencido. Qualquer falha no estoque reverte a transação inteira.
          if (!currentlyHasStockDeducted && shouldHaveStockDeducted) {
            for (const item of items) {
              const [prod] = await tx.select().from(schema.products).where(eq(schema.products.id, item.productId));
              if (!prod || prod.stock < item.quantity) throw new Error(`Estoque insuficiente para confirmar o item "${item.productName}".`);
              const [deducted] = await tx.update(schema.products).set({
                stock: sql`${schema.products.stock} - ${item.quantity}`,
                status: sql`CASE WHEN ${schema.products.stock} - ${item.quantity} <= 0 AND NOT ${schema.products.allowPreorder} THEN 'INACTIVE' ELSE ${schema.products.status} END`,
                updatedAt: new Date(),
              }).where(and(eq(schema.products.id, item.productId), eq(schema.products.stock, prod.stock), sql`${schema.products.stock} >= ${item.quantity}`)).returning();
              if (!deducted) throw new Error(`Não foi possível descontar o estoque do item "${item.productName}".`);
              await recordInventoryMovement(tx, {
                productId: item.productId, delta: -item.quantity, beforeStock: prod.stock, afterStock: deducted.stock,
                movementType: 'ORDER_STATUS_RESERVATION', reason: `Reserva de estoque ao alterar o pedido #${order.orderNumber}`,
                actorUserId: req.user!.id, orderId: order.id, idempotencyKey: `order-status-reserve:${order.id}:${item.id}`,
              });
              stockChanges.push({ productId: item.productId, delta: -item.quantity });
            }
          } else if (currentlyHasStockDeducted && !shouldHaveStockDeducted) {
            for (const item of items) {
              const [prod] = await tx.select().from(schema.products).where(eq(schema.products.id, item.productId));
              if (!prod) throw new Error('Produto associado ao pedido não encontrado.');
              const [restored] = await tx.update(schema.products).set({
                stock: sql`${schema.products.stock} + ${item.quantity}`,
                status: sql`CASE WHEN ${schema.products.status} = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'ACTIVE' END`,
                updatedAt: new Date(),
              }).where(and(eq(schema.products.id, item.productId), eq(schema.products.stock, prod.stock))).returning();
              if (!restored) throw new Error('Estoque alterado por outra operação.');
              await recordInventoryMovement(tx, {
                productId: item.productId, delta: item.quantity, beforeStock: prod.stock, afterStock: restored.stock,
                movementType: status === 'CANCELLED' ? 'ORDER_CANCELLATION_RETURN' : 'ORDER_STATUS_RETURN',
                reason: `Devolução de estoque na transição do pedido #${order.orderNumber} para ${status}`,
                actorUserId: req.user!.id, orderId: order.id, idempotencyKey: `order-status-return:${order.id}:${item.id}:${status}`,
              });
              stockChanges.push({ productId: item.productId, delta: item.quantity });
            }
          }

          await tx.insert(schema.orderStatusHistory).values({
            orderId: order.id,
            oldStatus,
            newStatus: status,
            changedBy: req.user!.id,
          });

          const { title, message } = buildStatusNotificationTexts(
            order.orderNumber,
            oldStatus,
            status
          );
          const [createdNotification] = await tx
            .insert(schema.notifications)
            .values({
              userId: order.userId,
              orderId: order.id,
              orderNumber: order.orderNumber,
              oldStatus,
              newStatus: status,
              title,
              message,
              isRead: false,
              popupDismissed: false,
            })
            .returning();

          if (status === 'DELIVERED') {
            const deliveryClosedTickets = await tx.update(schema.supportTickets).set({
              status: 'CLOSED',
              closedAt: sql`(SELECT delivered_at FROM orders WHERE id = ${order.id})`,
              closedByUserId: null,
              closedReason: 'ORDER_DELIVERED',
              updatedAt: sql`CURRENT_TIMESTAMP`,
            }).where(and(
              eq(schema.supportTickets.orderId, order.id),
              eq(schema.supportTickets.postDelivery, false),
              ne(schema.supportTickets.status, 'CLOSED'),
              sql`${schema.supportTickets.createdAt} < (SELECT delivered_at FROM orders WHERE id = ${order.id})`,
            )).returning({ id: schema.supportTickets.id, userId: schema.supportTickets.userId });
            for (const ticket of deliveryClosedTickets) {
              await tx.insert(schema.notifications).values({
                userId: ticket.userId,
                orderId: order.id,
                supportTicketId: ticket.id,
                orderNumber: order.orderNumber,
                oldStatus: null,
                newStatus: 'SUPPORT_CLOSED',
                title: `Atendimento #${ticket.id} encerrado após a entrega`,
                message: 'Este atendimento foi encerrado automaticamente porque o pedido foi entregue. O histórico continua disponível na Central de Ajuda.',
                isRead: false,
                popupDismissed: false,
                createdAt: sql`CURRENT_TIMESTAMP`,
              });
            }
          }
          return {
            ...updatedOrder,
            notification: createdNotification,
          };
        });
        if (transitionFrom && transitionFrom !== updated.status) {
          logServerEvent('order.status.changed', 'info', { orderId: updated.id, adminId: req.user!.id, role: req.user!.role, fromStatus: transitionFrom, toStatus: updated.status, result: 'committed' });
          const byProduct = new Map<number, number>();
          for (const change of stockChanges) byProduct.set(change.productId, (byProduct.get(change.productId) || 0) + change.delta);
          for (const [productId, delta] of byProduct) {
            logServerEvent('inventory.order_status_movement', 'info', { orderId: updated.id, productId, adminId: req.user!.id, stockDelta: delta, result: 'committed' });
          }
        }
        res.json(updated);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'Pedidos Mercado Pago só podem avançar após confirmação server-side do provedor.') {
          logServerEvent('order.status.update.rejected', 'warn', { status: 409, orderId: Number(req.params.id), adminId: req.user?.id, role: req.user?.role, result: 'rejected', reason: 'payment_not_confirmed' });
          res.status(409).json({ error: message });
          return;
        }
        if (message.includes('alterado por outra operação')) {
          logServerEvent('order.status.update.conflict', 'warn', { status: 400, orderId: Number(req.params.id), adminId: req.user?.id, role: req.user?.role, result: 'conflict', reason: 'concurrent_update' });
        } else {
          logServerError('order.status.update.failed', error, { status: 400, orderId: Number(req.params.id), adminId: req.user?.id, role: req.user?.role, result: 'transaction_rolled_back' });
        }
        res.status(400).json({ error: 'Erro ao alterar status do pedido.' });
      }
    }
  );

  // Admin: Configurações
  app.get('/api/admin/settings', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const map = await getSettingsMap();
      res.json({
        whatsapp_number: map.whatsapp_number || '',
        pix_key: map.pix_key || '',
        pix_instructions: map.pix_instructions || '',
        freight_base_km: map.freight_base_km || '4.0',
        freight_base_fee: map.freight_base_fee || '7.50',
        freight_extra_km_fee: map.freight_extra_km_fee || '1.50',
        store_origin_address: map.store_origin_address || 'Matriz DeepShop',
        payment_deadline_hours: map.payment_deadline_hours || '0.5',
        cpf_strict_validation_enabled: map.cpf_strict_validation_enabled || 'false',
        store_timezone: map.store_timezone || DEFAULT_STORE_TIMEZONE,
        packaging_cost_per_order: map.packaging_cost_per_order || '0.00',
        delivery_cost_per_order: map.delivery_cost_per_order || '0.00',
        monthly_fixed_costs: map.monthly_fixed_costs || '0.00',
        store_status: map.store_status || 'OPEN',
        store_closed_message: map.store_closed_message || 'A loja está fechada no momento. Volte durante nosso horário de atendimento.',
        accept_orders_when_closed: map.accept_orders_when_closed || 'false',
        store_hours: map.store_hours || JSON.stringify(DEFAULT_STORE_HOURS),
        company_name: map.company_name || 'DeepShop Delivery',
        company_cnpj: map.company_cnpj || '',
        company_address: map.company_address || '',
        company_email: map.company_email || '',
        company_phone: map.company_phone || '',
        privacy_content: map.privacy_content || '',
        terms_content: map.terms_content || '',
        exchange_content: map.exchange_content || '',
        callmebot_enabled: map.callmebot_enabled || 'false',
        callmebot_last_sent_at: map.callmebot_last_sent_at || '',
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar configurações.' });
    }
  });

  app.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
      const allowedKeys = [
        'whatsapp_number',
        'pix_key',
        'pix_instructions',
        'freight_base_km',
        'freight_base_fee',
        'freight_extra_km_fee',
        'store_origin_address',
        'payment_deadline_hours',
        'cpf_strict_validation_enabled',
        'store_timezone',
        'packaging_cost_per_order',
        'delivery_cost_per_order',
        'monthly_fixed_costs',
        'store_status',
        'store_closed_message',
        'accept_orders_when_closed',
        'store_hours',
        'company_name',
        'company_cnpj',
        'company_address',
        'company_email',
        'company_phone',
        'privacy_content',
        'terms_content',
        'exchange_content',
        'callmebot_enabled',
      ];

      if (req.body.store_hours !== undefined) {
        let parsedHours: any;
        try {
          parsedHours = JSON.parse(String(req.body.store_hours));
        } catch {
          res.status(400).json({ error: 'Horários da loja inválidos.' });
          return;
        }
        const hoursError = validateStoreHours(parsedHours);
        if (hoursError) {
          res.status(400).json({ error: hoursError });
          return;
        }
      }
      if (req.body.store_status !== undefined && !['OPEN', 'CLOSED'].includes(String(req.body.store_status))) {
        res.status(400).json({ error: 'Status da loja inválido.' });
        return;
      }
      for (const key of allowedKeys) {
        if (req.body[key] !== undefined) {
          const val = String(req.body[key]).trim();
          const existing = await db
            .select()
            .from(schema.settings)
            .where(eq(schema.settings.key, key));
          if (existing.length > 0) {
            await db
              .update(schema.settings)
              .set({ value: val, updatedAt: new Date() })
              .where(eq(schema.settings.key, key));
          } else {
            await db.insert(schema.settings).values({ key, value: val });
          }
        }
      }

      const updated = await getSettingsMap();
      res.json(updated);
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao salvar configurações.' });
    }
  });

  app.get('/api/admin/callmebot/status', requireAuth, requireAdmin, async (_req, res) => {
    try {
      res.json(await getCallMeBotStatus());
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao consultar configuração do CallMeBot.' });
    }
  });

  app.post('/api/admin/callmebot/test', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await sendCallMeBotMessage('Teste de notificações do DeepShop Delivery: o CallMeBot está configurado e funcionando.');
      if (!result.sent) {
        const message = result.reason === 'not_configured'
          ? 'Defina CALLMEBOT_PHONE e CALLMEBOT_APIKEY no ambiente da aplicação.'
          : result.reason === 'disabled'
          ? 'Ative o envio do CallMeBot nas configurações.'
          : 'O envio de teste falhou. Verifique os logs e as credenciais.';
        res.status(400).json({ error: message, reason: result.reason });
        return;
      }
      res.json({ success: true, message: 'Mensagem de teste enviada com sucesso.' });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao enviar teste do CallMeBot.' });
    }
  });

  // Admin: Alterar E-mail, Nome e Senha do Administrador (Item 3.4)
  app.put(
    '/api/admin/credentials',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { name, email, currentPassword, newPassword } = req.body || {};

        if (!currentPassword || !String(currentPassword).trim()) {
          res.status(400).json({
            error: 'Informe sua senha atual para confirmar a alteração dos dados de acesso.',
          });
          return;
        }

        const [adminUser] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, req.user!.id));

        if (!adminUser || !isAdminRole(adminUser.role)) {
          res.status(404).json({ error: 'Conta de administrador não encontrada.' });
          return;
        }

        const validCurrent = await bcrypt.compare(
          String(currentPassword),
          adminUser.passwordHash
        );
        if (!validCurrent) {
          res.status(400).json({ error: 'A senha atual informada está incorreta.' });
          return;
        }

        const nextName = name && String(name).trim() ? String(name).trim() : adminUser.name;
        const nextEmail =
          email && String(email).trim()
            ? String(email).trim().toLowerCase()
            : adminUser.email.toLowerCase();

        if (!nextEmail.includes('@')) {
          res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
          return;
        }

        if (nextEmail !== adminUser.email.toLowerCase()) {
          const allUsers = await db.select().from(schema.users);
          const duplicate = allUsers.find(
            (u) => u.id !== adminUser.id && u.email.toLowerCase() === nextEmail
          );
          if (duplicate) {
            res.status(400).json({
              error: 'Este e-mail já está sendo utilizado por outro usuário.',
            });
            return;
          }
        }

        let nextPasswordHash = adminUser.passwordHash;
        const cleanNewPass = newPassword ? String(newPassword).trim() : '';
        if (cleanNewPass.length > 0) {
          if (cleanNewPass.length < 10 || cleanNewPass.toLowerCase() === 'admin123') {
            res.status(400).json({
              error: 'A nova senha do administrador deve ter pelo menos 10 caracteres.',
            });
            return;
          }
          nextPasswordHash = await bcrypt.hash(cleanNewPass, 10);
        }

        const [updatedAdmin] = await db
          .update(schema.users)
          .set({
            name: nextName,
            email: nextEmail,
            passwordHash: nextPasswordHash,
            mustChangePassword: cleanNewPass.length > 0 ? false : adminUser.mustChangePassword,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, adminUser.id))
          .returning();

        res.json({
          message:
            cleanNewPass.length > 0
              ? 'E-mail e nova senha do Administrador atualizados com sucesso!'
              : 'Dados de acesso do Administrador atualizados com sucesso!',
          user: {
            id: updatedAdmin.id,
            name: updatedAdmin.name,
            email: updatedAdmin.email,
            phone: updatedAdmin.phone,
            role: updatedAdmin.role,
          },
        });
      } catch (error: any) {
        logServerError('server_operation_failed', error);
        res.status(500).json({
          error: 'Erro ao atualizar dados de acesso do administrador.',
        });
      }
    }
  );

  // ============================================================================
  // BANCO DE DADOS POSTGRESQL (PRODUÇÃO, MIGRAÇÕES & EXPORTAÇÃO PARA VPS)
  // ============================================================================
  app.get('/api/admin/database/status', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { getDatabaseEngineInfo } = await import('../../db/index.ts');
      const { exportFullBackupJson, SNAPSHOT_FILE_PATH } = await import('../../db/backup.ts');
      const fs = await import('fs');

      const payload = await exportFullBackupJson();
      const snapshotExists = fs.existsSync(SNAPSHOT_FILE_PATH);
      const snapshotUpdatedAt = snapshotExists
        ? fs.statSync(SNAPSHOT_FILE_PATH).mtime.toISOString()
        : null;

      res.json({
        engine: getDatabaseEngineInfo(),
        snapshotUpdatedAt,
        counts: {
          products: payload.tables.products.length,
          categories: payload.tables.categories.length,
          kits: payload.tables.products.filter((p) => p.isKit).length,
          mediaFiles: payload.tables.storedObjects.length,
          customers: payload.tables.users.filter((u) => !isAdminRole(u.role)).length,
          orders: payload.tables.orders.length,
        },
      });
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao consultar status do banco PostgreSQL.' });
    }
  });

  app.get('/api/admin/database/export-sql', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { exportFullPostgresSqlDump } = await import('../../db/backup.ts');
      const sqlDump = await exportFullPostgresSqlDump();
      await auditAdminEvent(req, 'DATABASE_BACKUP_CREATED', 'BACKUP', null, { format: 'sql' });
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="achadinhos-postgresql-vps-${new Date().toISOString().slice(0, 10)}.sql"`
      );
      res.send(sqlDump);
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      await auditAdminEvent(req, 'DATABASE_BACKUP_FAILED', 'BACKUP', null, { format: 'sql' }, 'FAILURE');
      res.status(500).json({ error: 'Erro ao gerar dump SQL do PostgreSQL.' });
    }
  });

  app.get('/api/admin/database/export-json', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { exportFullBackupJson, triggerAutoSnapshot } = await import('../../db/backup.ts');
      triggerAutoSnapshot();
      const jsonBackup = await exportFullBackupJson();
      await auditAdminEvent(req, 'DATABASE_BACKUP_CREATED', 'BACKUP', null, { format: 'json' });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="achadinhos-backup-${new Date().toISOString().slice(0, 10)}.json"`
      );
      res.send(JSON.stringify(jsonBackup, null, 2));
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      await auditAdminEvent(req, 'DATABASE_BACKUP_FAILED', 'BACKUP', null, { format: 'json' }, 'FAILURE');
      res.status(500).json({ error: 'Erro ao gerar backup JSON do PostgreSQL.' });
    }
  });

  app.post('/api/admin/database/restore-json', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    if (process.env.NODE_ENV === 'production') {
      await auditAdminEvent(req, 'DATABASE_RESTORE_REJECTED', 'BACKUP', null, { reason: 'production_restore_blocked' }, 'FAILURE');
      res.status(403).json({ error: 'Restore destrutivo bloqueado em produção.', code: 'RESTORE_TEST_ONLY' });
      return;
    }
    try {
      const { restoreFromBackupJson } = await import('../../db/backup.ts');
      await auditAdminEvent(req, 'DATABASE_RESTORE_STARTED', 'BACKUP', null, { format: 'json' });
      const result = await restoreFromBackupJson(req.body);
      await auditAdminEvent(req, 'DATABASE_RESTORE_COMPLETED', 'BACKUP', null, {
        productsRestored: result.productsRestored, usersRestored: result.usersRestored,
        ordersRestored: result.ordersRestored, supportTicketsRestored: result.supportTicketsRestored,
        supportMessagesRestored: result.supportMessagesRestored,
      });
      res.json({
        message: `Backup restaurado com sucesso! (${result.productsRestored} produto(s), ${result.categoriesRestored} categoria(s), ${result.ordersRestored} pedido(s)).`,
        ...result,
      });
    } catch (error: any) {
      await auditAdminEvent(req, 'DATABASE_RESTORE_FAILED', 'BACKUP', null, { format: 'json' }, 'FAILURE');
      logServerError('server_operation_failed', error);
      res.status(400).json({
        error: 'Erro ao restaurar arquivo de backup no PostgreSQL.',
      });
    }
  });

  // ============================================================================
  // DISPARAR NOTIFICAÇÃO / PROMOÇÃO PARA TODOS OS CLIENTES (ESTILO IFOOD)
  // ============================================================================
  app.post('/api/admin/broadcast-notification', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { title, message } = req.body || {};
      if (!title || !String(title).trim()) {
        res.status(400).json({ error: 'O título da notificação é obrigatório.' });
        return;
      }
      if (!message || !String(message).trim()) {
        res.status(400).json({ error: 'A mensagem da notificação é obrigatória.' });
        return;
      }

      const allCustomers = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.role, 'CUSTOMER'));

      if (allCustomers.length === 0) {
        res.json({ count: 0, message: 'Nenhum cliente cadastrado ainda para receber o aviso.' });
        return;
      }

      const cleanTitle = String(title).trim();
      const cleanMessage = String(message).trim();

      for (const customer of allCustomers) {
        await db.insert(schema.notifications).values({
          userId: customer.id,
          orderId: null,
          orderNumber: 'PROMO',
          oldStatus: null,
          newStatus: 'PROMO_ALERT',
          title: cleanTitle,
          message: cleanMessage,
          isRead: false,
          popupDismissed: false,
        });
      }

      const { triggerAutoSnapshot } = await import('../../db/backup.ts');
      triggerAutoSnapshot();

      res.json({
        success: true,
        count: allCustomers.length,
        message: `Notificação enviada com sucesso para ${allCustomers.length} cliente(s)!`,
      });
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao enviar notificação para os clientes.' });
    }
  });

  app.patch('/api/admin/products/:id/cost', requireAuth, requireAdmin, async (req, res) => {
    try {
      const prodId = Number(req.params.id);
      const { cost, price } = req.body;

      const [existing] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, prodId));

      if (!existing) {
        res.status(404).json({ error: 'Produto não encontrado.' });
        return;
      }

      const updates: any = { updatedAt: new Date() };

      if (cost !== undefined && cost !== null) {
        const costNum = Math.max(0, parseFloat(String(cost).replace(',', '.')) || 0);
        updates.cost = costNum.toFixed(2);
        updates.costUnitPrecise = costNum.toFixed(6);
        updates.costLotTotal = null;
        updates.costLotUnits = null;
      }

      if (price !== undefined && price !== null && String(price).trim() !== '') {
        const priceNum = Math.max(0, parseFloat(String(price).replace(',', '.')) || 0);
        if (priceNum > 0) {
          updates.price = priceNum.toFixed(2);
        }
      }

      const [updated] = await db
        .update(schema.products)
        .set(updates)
        .where(eq(schema.products.id, prodId))
        .returning();

      const { triggerAutoSnapshot } = await import('../../db/backup.ts');
      triggerAutoSnapshot();

      const costNum = parseFloat(String(updated.costUnitPrecise ?? updated.cost ?? '0')) || 0;
      const priceNum = parseFloat(String(updated.price || '0')) || 0;
      const promoActive = isPromoCurrentlyActive(updated);
      const effectivePrice = promoActive && updated.promoPrice ? parseFloat(String(updated.promoPrice)) : priceNum;
      const unitProfit = Number((effectivePrice - costNum).toFixed(2));
      const unitMarginPercent = effectivePrice > 0 ? Number(((unitProfit / effectivePrice) * 100).toFixed(1)) : 0;
      const stockProfitScenarios = calculateStockProfitScenarios({ ...updated, cost: costNum, promoActive });
      const potentialStockProfit = stockProfitScenarios.promoStockProfit ?? stockProfitScenarios.normalStockProfit ?? 0;

      res.json({
        success: true,
        product: {
          ...updated,
          unitProfit,
          unitMarginPercent,
          potentialStockProfit,
          normalStockProfit: stockProfitScenarios.normalStockProfit,
          promoStockProfit: stockProfitScenarios.promoStockProfit,
        },
        message: 'Custo e margem do produto atualizados com sucesso!',
      });
    } catch (error: any) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao atualizar custo do produto.' });
    }
  });
}
