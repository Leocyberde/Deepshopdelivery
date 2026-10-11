import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Express } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { logServerError, logServerEvent } from '../logger.ts';
import { summarizeProviderError } from '../services/mercadoPagoErrorSummary.ts';
import { AuthRequest, requireAuth } from '../middleware/auth.ts';
import { expireOverdueUnpaidOrders } from '../services/orderExpirationService.ts';
import { parseSiteUrl } from '../../config/siteUrl.ts';

const PROVIDER = 'MERCADOPAGO';
const PROVIDER_API = 'https://api.mercadopago.com';
const PAYMENT_ORDER_STATUSES = new Set(['NEW', 'AWAITING_PAYMENT']);
const TERMINAL_ORDER_STATUSES = new Set(['CANCELLED', 'EXPIRED']);

function providerToken(): string | null {
  const token = String(process.env.MERCADOPAGO_TEST_ACCESS_TOKEN || '').trim();
  const mode = String(process.env.MERCADOPAGO_MODE || '').trim().toLowerCase();
  return token && mode === 'sandbox' ? token : null;
}

/**
 * Em sandbox a API de Orders só aceita compradores de teste (e-mail @testuser.com);
 * qualquer outro e-mail devolve HTTP 400 `invalid_email_for_sandbox`.
 */
function sandboxPayerEmail(customerEmail: string): string | null {
  const isTestUser = (value: string) => /^[^\s@]+@testuser\.com$/i.test(value);
  if (isTestUser(customerEmail)) return customerEmail;
  const configured = String(process.env.MERCADOPAGO_SANDBOX_PAYER_EMAIL || '').trim();
  return isTestUser(configured) ? configured : null;
}

function cents(value: unknown): number {
  const numberValue = Number(String(value ?? '0'));
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error('Valor monetário inválido.');
  return Math.round(numberValue * 100);
}

function currencyValue(valueInCents: number): number {
  return Number((valueInCents / 100).toFixed(2));
}

function responsePayment(payment: typeof schema.payments.$inferSelect | undefined) {
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

function callbackUrls(orderId: number): { success: string; failure: string; pending: string } | null {
  try {
    const site = parseSiteUrl(process.env.SITE_URL, process.env.NODE_ENV === 'production')?.url;
    if (!site || site.protocol !== 'https:') return null;
    if (['localhost', '127.0.0.1', '0.0.0.0', 'seu-dominio.com.br'].includes(site.hostname)) return null;
    const query = `orderId=${encodeURIComponent(String(orderId))}`;
    return {
      success: new URL(`/pagamento/sucesso?${query}`, site.origin).toString(),
      failure: new URL(`/pagamento/falha?${query}`, site.origin).toString(),
      pending: new URL(`/pagamento/pendente?${query}`, site.origin).toString(),
    };
  } catch {
    return null;
  }
}

function isSandboxCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'mercadopago.com.br' || url.hostname.endsWith('.mercadopago.com.br') ||
        url.hostname === 'mercadopago.com' || url.hostname.endsWith('.mercadopago.com'));
  } catch {
    return false;
  }
}

async function getOwnedOrder(orderId: number, userId: number) {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!order) return { order: null, forbidden: false };
  if (order.userId !== userId) return { order: null, forbidden: true };
  return { order, forbidden: false };
}

function providerOrderStatus(status: unknown, statusDetail: unknown, transactionStatus: unknown): string {
  const order = String(status || '').toLowerCase();
  const transaction = String(transactionStatus || '').toLowerCase();
  if (order === 'processed' || transaction === 'processed' || String(statusDetail || '').toLowerCase() === 'accredited') return 'PAID';
  if (order === 'failed' || transaction === 'rejected') return 'REJECTED';
  if (order === 'canceled' || order === 'cancelled') return 'CANCELLED';
  if (order === 'refunded') return 'REFUNDED';
  return 'PENDING';
}

class ProviderLookupError extends Error {
  constructor(
    readonly kind: 'not_found' | 'auth' | 'unavailable' | 'unexpected',
    readonly providerStatus: number,
  ) {
    super(`Mercado Pago order lookup failed (HTTP ${providerStatus}).`);
    this.name = 'ProviderLookupError';
  }
}

async function queryProviderOrder(token: string, providerOrderId: string) {
  const response = await fetch(`${PROVIDER_API}/v1/orders/${encodeURIComponent(providerOrderId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const kind = response.status === 400 || response.status === 404
      ? 'not_found'
      : response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 408 || response.status === 429 || response.status >= 500
          ? 'unavailable'
          : 'unexpected';
    throw new ProviderLookupError(kind, response.status);
  }
  return await response.json() as Record<string, unknown>;
}

function webhookSignatureIsValid(req: { headers: Record<string, string | string[] | undefined> }, dataId: string): boolean {
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '').trim();
  if (!secret || !signature || !requestId || !dataId) return false;
  const parts = Object.fromEntries(signature.split(',').map((part) => {
    const index = part.indexOf('=');
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ['', ''];
  }).filter(([key, value]) => key && value));
  const timestamp = String(parts.ts || '');
  const receivedHash = String(parts.v1 || '').toLowerCase();
  if (!/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(receivedHash)) return false;
  const tolerance = Math.max(30, Math.min(3600, Number(process.env.MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS) || 300));
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > tolerance) return false;
  // Documentação MP: se data.id for alfanumérico (ex.: ORD01J...), deve entrar em minúsculas no manifest.
  const received = Buffer.from(receivedHash, 'hex');
  return [...new Set([dataId.toLowerCase(), dataId])].some((id) => {
    const manifest = `id:${id};request-id:${requestId};ts:${timestamp};`;
    const expected = createHmac('sha256', secret).update(manifest).digest();
    return timingSafeEqual(expected, received);
  });
}

export function registerPaymentRoutes(app: Express) {
  app.post('/api/payments/mercadopago/webhook', async (req, res) => {
    const dataId = String(req.query['data.id'] || '').trim();
    if (!dataId || !webhookSignatureIsValid(req, dataId)) {
      logServerEvent('payment.webhook.rejected', 'warn', { status: 401, result: 'invalid_signature' });
      res.status(401).json({ error: 'Notificação não autenticada.' });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    if (String(body.type || '').toLowerCase() !== 'order') {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const token = providerToken();
    if (!token) {
      logServerEvent('payment.webhook.unavailable', 'error', { status: 503, result: 'provider_not_configured' });
      res.status(503).json({ error: 'Notificação recebida, mas o provedor não está configurado.' });
      return;
    }

    try {
      const providerOrder = await queryProviderOrder(token, dataId);
      const providerOrderId = String(providerOrder.id || '').trim();
      const providerExternalReference = String(providerOrder.external_reference || '').trim();
      const providerCurrency = String(providerOrder.currency || '').trim();
      const providerAmountCents = cents(providerOrder.total_amount);
      if (providerOrderId !== dataId) {
        res.status(409).json({ error: 'A Order consultada não corresponde à notificação.' });
        return;
      }

      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.providerOrderId, providerOrderId));
      if (!payment) {
        logServerEvent('payment.webhook.unknown_order', 'warn', { status: 404, result: 'order_not_registered' });
        res.status(404).json({ error: 'Order não registrada.' });
        return;
      }
      if (providerExternalReference !== payment.externalReference || providerCurrency !== payment.currency || providerAmountCents !== cents(payment.amount)) {
        logServerEvent('payment.webhook.mismatch', 'warn', { status: 409, paymentId: payment.id, result: 'provider_data_mismatch' });
        res.status(409).json({ error: 'A Order não corresponde ao pedido local.' });
        return;
      }

      const providerTransactions = providerOrder.transactions && typeof providerOrder.transactions === 'object'
        ? (providerOrder.transactions as Record<string, unknown>).payments
        : null;
      const transactions = Array.isArray(providerTransactions) ? providerTransactions as Array<Record<string, unknown>> : [];
      const providerPayment = transactions[0];
      const providerPaymentId = String(providerPayment?.id || '').trim() || null;
      const nextPaymentStatus = providerOrderStatus(providerOrder.status, providerOrder.status_detail, providerPayment?.status);
      const providerStatus = String(providerOrder.status_detail || providerOrder.status || 'unknown').slice(0, 80);
      const result = await db.transaction(async (tx) => {
        const [freshPayment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
        const [freshOrder] = await tx.select().from(schema.orders).where(eq(schema.orders.id, payment.orderId));
        if (!freshPayment || !freshOrder) throw new Error('Pedido ou pagamento não encontrado.');
        if (freshPayment.status === 'PAID' && nextPaymentStatus !== 'PAID') {
          return { duplicate: true, orderStatus: freshOrder.status, paymentStatus: freshPayment.status };
        }
        if (!['PENDING', 'CREATING'].includes(freshPayment.status) && nextPaymentStatus === 'PENDING') {
          return { duplicate: true, orderStatus: freshOrder.status, paymentStatus: freshPayment.status };
        }
        const [savedPayment] = await tx.update(schema.payments).set({
          providerPaymentId,
          status: nextPaymentStatus,
          providerStatus,
          updatedAt: new Date(),
        }).where(eq(schema.payments.id, freshPayment.id)).returning();
        let savedOrder = freshOrder;
        if (nextPaymentStatus === 'PAID' && PAYMENT_ORDER_STATUSES.has(freshOrder.status)) {
          const [changedOrder] = await tx.update(schema.orders).set({ status: 'PAID', paymentExpiresAt: null, updatedAt: new Date() })
            .where(and(eq(schema.orders.id, freshOrder.id), eq(schema.orders.status, freshOrder.status))).returning();
          if (changedOrder) {
            await tx.insert(schema.orderStatusHistory).values({ orderId: freshOrder.id, oldStatus: freshOrder.status, newStatus: 'PAID', changedBy: null, createdAt: new Date() });
            savedOrder = changedOrder;
          }
        }
        return { duplicate: freshPayment.status === nextPaymentStatus && savedOrder.status === freshOrder.status, orderStatus: savedOrder.status, paymentStatus: savedPayment.status };
      });
      logServerEvent('payment.webhook.processed', 'info', { status: 200, paymentId: payment.id, orderId: payment.orderId, result: result.duplicate ? 'duplicate' : 'updated' });
      res.status(200).json({ received: true, processed: !result.duplicate, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof ProviderLookupError) {
        if (error.kind === 'not_found') {
          logServerEvent('payment.webhook.order_not_found', 'warn', { status: 404, providerStatus: error.providerStatus, result: 'order_not_found' });
          res.status(404).json({ error: 'A Order informada não existe no provedor.' });
          return;
        }
        logServerEvent(
          error.kind === 'auth' ? 'payment.webhook.provider_auth_failed' : 'payment.webhook.provider_unavailable',
          'error',
          { status: 503, providerStatus: error.providerStatus, result: error.kind },
        );
        res.status(503).json({ error: 'Não foi possível consultar a Order no provedor agora.' });
        return;
      }
      logServerError('payment.webhook.failed', error, { status: 503, orderId: dataId });
      res.status(503).json({ error: 'Não foi possível processar a notificação agora.' });
    }
  });

  app.post('/api/orders/:id/payments', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Pedido inválido.' });
        return;
      }
      const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
        res.status(400).json({ error: 'Chave de idempotência inválida.' });
        return;
      }

      await expireOverdueUnpaidOrders();
      const { order, forbidden } = await getOwnedOrder(orderId, req.user!.id);
      if (forbidden) {
        logServerEvent('security.payment_order_access.denied', 'warn', { status: 403, orderId, userId: req.user!.id, result: 'denied', reason: 'order_not_owned' });
        res.status(403).json({ error: 'Acesso negado a este pedido.' });
        return;
      }
      if (!order) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }
      if (String(order.paymentMethod || '').toUpperCase() !== 'MERCADOPAGO') {
        res.status(409).json({ error: 'Este pedido não foi criado para pagamento pelo Mercado Pago.' });
        return;
      }
      if (!PAYMENT_ORDER_STATUSES.has(order.status)) {
        res.status(409).json({ error: 'O pedido não está aguardando pagamento.' });
        return;
      }
      const paymentReleased = order.deliveryFee !== null && order.deliveryFee !== undefined ||
        order.isFirstOrderFreeDelivery || order.usedFreeDeliveryTicket ||
        ['FIRST_ORDER_FREE', 'FREE_DELIVERY_TICKET', 'MANUAL_FREE_DELIVERY'].includes(String(order.deliveryFeeSource || '').toUpperCase());
      if (!paymentReleased) {
        res.status(409).json({ error: 'O valor do frete ainda não foi confirmado; o pagamento está bloqueado.' });
        return;
      }
      if (order.paymentExpiresAt && new Date(order.paymentExpiresAt).getTime() <= Date.now()) {
        res.status(409).json({ error: 'O prazo de pagamento deste pedido terminou.' });
        return;
      }

      logServerEvent('payment.creation.attempted', 'info', { orderId: order.id, userId: req.user!.id, orderStatus: order.status, result: 'requested' });

      let [existingPayment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
      // Falha definitiva do provedor (HTTP 4xx, nenhuma Order criada): libera nova tentativa com chave nova.
      let providerIdempotencyKey = idempotencyKey;
      if (existingPayment && existingPayment.status === 'CREATION_FAILED' && !existingPayment.providerOrderId && !existingPayment.checkoutUrl &&
        /^HTTP_4\d\d$/.test(existingPayment.providerStatus || '') && existingPayment.providerStatus !== 'HTTP_408' && existingPayment.providerStatus !== 'HTTP_429') {
        await db.delete(schema.payments).where(and(eq(schema.payments.id, existingPayment.id), eq(schema.payments.status, 'CREATION_FAILED')));
        providerIdempotencyKey = randomUUID();
        existingPayment = undefined as unknown as typeof existingPayment;
        logServerEvent('payment.creation.retry_after_provider_4xx', 'info', { orderId: order.id, userId: req.user!.id, result: 'retry_allowed' });
      }
      if (existingPayment) {
        if (existingPayment.checkoutUrl && (existingPayment.providerOrderId || existingPayment.providerPreferenceId)) {
          logServerEvent('payment.preference.replayed', 'info', { orderId: order.id, paymentId: existingPayment.id, paymentStatus: existingPayment.status, result: 'replayed' });
          res.json({ payment: responsePayment(existingPayment), checkoutUrl: existingPayment.checkoutUrl, replayed: true });
          return;
        }
        if (existingPayment.idempotencyKey !== idempotencyKey) {
          res.status(409).json({ error: 'A criação da preferência anterior está pendente; a mesma chave deve ser reutilizada.' });
          return;
        }
        res.status(409).json({ error: 'A criação da preferência anterior está pendente ou falhou. Nenhuma nova preferência foi criada para evitar duplicidade.' });
        return;
      }

      const [customer] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, order.userId));
      if (!customer?.email) {
        res.status(409).json({ error: 'Não foi possível validar o e-mail do comprador.' });
        return;
      }

      const payerEmail = sandboxPayerEmail(customer.email);
      if (!payerEmail) {
        logServerEvent('payment.creation.unavailable', 'warn', { status: 503, orderId: order.id, userId: req.user!.id, result: 'unavailable', reason: 'sandbox_payer_email_missing' });
        res.status(503).json({ error: 'Sandbox: use uma conta compradora de teste (@testuser.com) ou configure MERCADOPAGO_SANDBOX_PAYER_EMAIL no servidor.' });
        return;
      }

      const orderItems = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      if (!orderItems.length) {
        res.status(409).json({ error: 'O pedido não possui itens para pagamento.' });
        return;
      }
      const totalCents = cents(order.total);
      const itemSubtotalCents = orderItems.reduce((sum, item) => {
        const itemLineCents = cents(item.unitPrice) * Number(item.quantity);
        if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 999) {
          throw new Error('Quantidade inválida na composição do pedido.');
        }
        return sum + itemLineCents;
      }, 0);
      if (itemSubtotalCents <= 0 || totalCents <= 0 || itemSubtotalCents !== cents(order.subtotal) || itemSubtotalCents > totalCents) {
        res.status(409).json({ error: 'A composição monetária do pedido não é válida para cobrança.' });
        return;
      }
      const shippingCents = totalCents - itemSubtotalCents;
      const token = providerToken();
      if (!token) {
        logServerEvent('payment.creation.unavailable', 'warn', { status: 503, orderId: order.id, userId: req.user!.id, result: 'unavailable', reason: 'provider_not_configured' });
        res.status(503).json({ error: 'Pagamento em sandbox indisponível: configure a credencial de teste no servidor.' });
        return;
      }
      const returnUrls = callbackUrls(orderId);
      if (!returnUrls) {
        res.status(503).json({ error: 'SITE_URL HTTPS válido é necessário para o retorno do checkout.' });
        return;
      }
      const externalReference = randomUUID();
      let inserted: typeof schema.payments.$inferSelect;
      try {
        [inserted] = await db.insert(schema.payments).values({
          orderId: order.id,
          provider: PROVIDER,
          externalReference,
          idempotencyKey: providerIdempotencyKey,
          amount: currencyValue(totalCents).toFixed(2),
          currency: 'BRL',
          status: 'CREATING',
        }).returning();
      } catch {
        const [concurrent] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
        if (concurrent?.idempotencyKey === providerIdempotencyKey && concurrent.checkoutUrl && (concurrent.providerOrderId || concurrent.providerPreferenceId)) {
          res.json({ payment: responsePayment(concurrent), checkoutUrl: concurrent.checkoutUrl, replayed: true });
          return;
        }
        logServerEvent('payment.creation.conflict', 'warn', { status: 409, orderId: order.id, userId: req.user!.id, result: 'conflict', reason: 'concurrent_preference_request' });
        res.status(409).json({ error: 'Outra solicitação de pagamento já está em andamento para este pedido.' });
        return;
      }

      const orderItemsPayload = orderItems.map((item) => ({
        external_code: String(item.productId),
        title: String(item.productName).slice(0, 250),
        quantity: Number(item.quantity),
        unit_price: currencyValue(cents(item.unitPrice)).toFixed(2),
      }));
      if (shippingCents > 0) {
        orderItemsPayload.push({
          external_code: 'delivery',
          title: 'Frete do pedido',
          quantity: 1,
          unit_price: currencyValue(shippingCents).toFixed(2),
        });
      }
      const orderPayload = {
        type: 'online',
        processing_mode: 'manual',
        capture_mode: 'automatic_async',
        total_amount: currencyValue(totalCents).toFixed(2),
        items: orderItemsPayload,
        payer: { email: payerEmail },
        external_reference: externalReference,
        config: {
          online: {
            success_url: returnUrls.success,
            failure_url: returnUrls.failure,
            pending_url: returnUrls.pending,
            auto_return: 'approved',
          },
        },
      };

      logServerEvent('payment.order.requested', 'info', { orderId: order.id, paymentId: inserted.id, userId: req.user!.id, result: 'creating' });

      try {
        const response = await fetch(`${PROVIDER_API}/v1/orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Idempotency-Key': providerIdempotencyKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(orderPayload),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const providerErrorBody = await response.text().catch(() => '');
          const providerError = summarizeProviderError(providerErrorBody.slice(0, 8192));
          logServerEvent('payment.order.failed', 'warn', {
            status: 502,
            providerHttpStatus: response.status,
            ...providerError,
            orderId: order.id,
            paymentId: inserted.id,
            result: 'provider_http_error',
          });
          await db.update(schema.payments).set({ status: 'CREATION_FAILED', providerStatus: `HTTP_${response.status}`, updatedAt: new Date() }).where(eq(schema.payments.id, inserted.id));
          res.status(502).json({ error: 'O provedor não conseguiu criar o checkout de teste.' });
          return;
        }
        const createdOrder = await response.json() as Record<string, unknown>;
        const checkoutUrl = createdOrder.checkout_url;
        const providerOrderId = String(createdOrder.id || '').trim();
        if (!providerOrderId || !isSandboxCheckoutUrl(checkoutUrl)) {
          logServerEvent('payment.order.failed', 'warn', { status: 502, orderId: order.id, paymentId: inserted.id, result: 'invalid_provider_response' });
          await db.update(schema.payments).set({ status: 'CREATION_FAILED', providerStatus: 'INVALID_ORDER_RESPONSE', updatedAt: new Date() }).where(eq(schema.payments.id, inserted.id));
          res.status(502).json({ error: 'O provedor não retornou uma Order ou checkout seguro.' });
          return;
        }
        const [savedPayment] = await db.update(schema.payments).set({
          providerOrderId,
          checkoutUrl,
          status: 'PENDING',
          providerStatus: 'order_created',
          updatedAt: new Date(),
        }).where(eq(schema.payments.id, inserted.id)).returning();
        logServerEvent('payment.order.created', 'info', { orderId: order.id, paymentId: savedPayment.id, paymentStatus: savedPayment.status, result: 'created' });
        res.status(201).json({ payment: responsePayment(savedPayment), checkoutUrl, replayed: false });
      } catch (error) {
        // Falha ambígua: preservar a linha CREATING evita criar uma segunda preferência após timeout.
        logServerError('payment.preference.request.failed', error, { orderId: order.id, paymentId: inserted.id, status: 502 });
        res.status(502).json({ error: 'Não foi possível confirmar a criação do checkout. Reutilize a mesma chave; uma nova preferência não será criada automaticamente.' });
      }
    } catch (error) {
      logServerError('payment.preference.route.failed', error, { orderId: Number(req.params.id), status: 500 });
      res.status(500).json({ error: 'Erro ao iniciar o pagamento.' });
    }
  });

  app.post('/api/orders/:id/payments/confirm', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Pedido inválido.' });
        return;
      }
      const { order, forbidden } = await getOwnedOrder(orderId, req.user!.id);
      if (forbidden) {
        logServerEvent('security.payment_order_access.denied', 'warn', { status: 403, orderId, userId: req.user!.id, result: 'denied', reason: 'order_not_owned' });
        res.status(403).json({ error: 'Acesso negado a este pedido.' });
        return;
      }
      if (!order) {
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
      if (!payment || payment.provider !== PROVIDER || !(payment.providerOrderId || payment.providerPreferenceId)) {
        res.status(409).json({ error: 'Não há checkout Mercado Pago iniciado para este pedido.' });
        return;
      }
      if (TERMINAL_ORDER_STATUSES.has(order.status)) {
        res.status(409).json({ error: 'O pedido foi encerrado; esta confirmação não altera um pedido cancelado ou expirado.' });
        return;
      }
      const suppliedId = String(req.body?.paymentId || '').trim();
      if (suppliedId && !/^[A-Za-z0-9._:-]{1,128}$/.test(suppliedId)) {
        res.status(400).json({ error: 'ID de pagamento inválido.' });
        return;
      }
      const providerOrderId = payment.providerOrderId || payment.providerPreferenceId || '';
      const [paymentWithId] = suppliedId
        ? await db.select().from(schema.payments).where(eq(schema.payments.providerPaymentId, suppliedId))
        : [];
      if (paymentWithId && paymentWithId.orderId !== order.id) {
        res.status(409).json({ error: 'Este pagamento já está associado a outro pedido.' });
        return;
      }
      const token = providerToken();
      if (!token) {
        logServerEvent('payment.confirmation.unavailable', 'warn', { status: 503, orderId: order.id, paymentId: payment.id, userId: req.user!.id, result: 'unavailable', reason: 'provider_not_configured' });
        res.status(503).json({ error: 'A confirmação em sandbox está indisponível no servidor.' });
        return;
      }

      logServerEvent('payment.confirmation.attempted', 'info', { orderId: order.id, paymentId: payment.id, userId: req.user!.id, result: 'requested' });
      const providerOrder = await queryProviderOrder(token, providerOrderId);
      const providerId = String(providerOrder.id || '');
      const providerExternalReference = String(providerOrder.external_reference || '');
      const providerCurrency = String(providerOrder.currency || '');
      const providerAmountCents = cents(providerOrder.total_amount);
      const providerTransactions = providerOrder.transactions && typeof providerOrder.transactions === 'object'
        ? (providerOrder.transactions as Record<string, unknown>).payments
        : null;
      const transactions = Array.isArray(providerTransactions) ? providerTransactions as Array<Record<string, unknown>> : [];
      const matchingTransaction = suppliedId ? transactions.find((transaction) => String(transaction.id || '') === suppliedId) : transactions[0];
      if (suppliedId && !matchingTransaction) {
        res.status(409).json({ error: 'O pagamento informado não pertence à Order deste pedido.' });
        return;
      }
      const resolvedPaymentId = String(matchingTransaction?.id || suppliedId || payment.providerPaymentId || '').trim();
      if (providerId !== providerOrderId || providerExternalReference !== payment.externalReference ||
        providerCurrency !== payment.currency || providerAmountCents !== cents(payment.amount)) {
        res.status(409).json({ error: 'Os dados da transação não correspondem ao pedido e ao valor registrado.' });
        return;
      }

      const nextPaymentStatus = providerOrderStatus(providerOrder.status, providerOrder.status_detail, matchingTransaction?.status);
      const providerStatus = String(providerOrder.status_detail || providerOrder.status || 'unknown').slice(0, 80);
      const now = new Date();
      const updatedResult = await db.transaction(async (tx) => {
        const [freshOrder] = await tx.select().from(schema.orders).where(eq(schema.orders.id, order.id));
        const [freshPayment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
        if (!freshOrder || !freshPayment) throw new Error('Pedido ou pagamento não encontrado durante a confirmação.');
        if (TERMINAL_ORDER_STATUSES.has(freshOrder.status)) throw new Error('O pedido foi encerrado durante a confirmação.');
        if (freshPayment.providerPaymentId && resolvedPaymentId && freshPayment.providerPaymentId !== resolvedPaymentId && freshPayment.status === 'PAID') {
          throw new Error('Outro pagamento aprovado já está associado ao pedido.');
        }
        if (nextPaymentStatus === 'PAID' && !PAYMENT_ORDER_STATUSES.has(freshOrder.status) &&
          !['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(freshOrder.status)) {
          throw new Error('O pedido não está em um estado que aceite confirmação do pagamento.');
        }

        const [savedPayment] = await tx.update(schema.payments).set({
          providerPaymentId: resolvedPaymentId || null,
          status: nextPaymentStatus,
          providerStatus,
          updatedAt: now,
        }).where(eq(schema.payments.id, freshPayment.id)).returning();

        let savedOrder = freshOrder;
        if (nextPaymentStatus === 'PAID' && PAYMENT_ORDER_STATUSES.has(freshOrder.status)) {
          const [changedOrder] = await tx.update(schema.orders).set({
            status: 'PAID',
            paymentExpiresAt: null,
            updatedAt: now,
          }).where(and(eq(schema.orders.id, freshOrder.id), eq(schema.orders.status, freshOrder.status))).returning();
          if (!changedOrder) throw new Error('O pedido foi alterado por outra operação.');
          await tx.insert(schema.orderStatusHistory).values({
            orderId: freshOrder.id,
            oldStatus: freshOrder.status,
            newStatus: 'PAID',
            changedBy: null,
            createdAt: now,
          });
          savedOrder = changedOrder;
        }
        return { payment: savedPayment, order: savedOrder };
      });

      logServerEvent('payment.status.updated', 'info', {
        orderId: updatedResult.order.id,
        paymentId: updatedResult.payment.providerPaymentId || updatedResult.payment.id,
        userId: req.user!.id,
        paymentStatus: updatedResult.payment.status,
        orderStatus: updatedResult.order.status,
        result: 'confirmed_from_provider',
      });
      res.json({ payment: responsePayment(updatedResult.payment), orderStatus: updatedResult.order.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'O pedido foi encerrado durante a confirmação.' ||
        message === 'Outro pagamento aprovado já está associado ao pedido.' ||
        message === 'O pedido não está em um estado que aceite confirmação do pagamento.') {
        logServerEvent('payment.confirmation.conflict', 'warn', { status: 409, orderId: Number(req.params.id), userId: req.user?.id, result: 'conflict', reason: 'order_state_changed' });
        res.status(409).json({ error: message });
        return;
      }
      logServerError('payment.confirmation.failed', error, { status: 502, orderId: Number(req.params.id), userId: req.user?.id });
      res.status(502).json({ error: 'Não foi possível confirmar o pagamento com o provedor.' });
    }
  });
}
