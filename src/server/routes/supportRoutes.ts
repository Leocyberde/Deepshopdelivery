import type { Express, Response, NextFunction } from 'express';
import { and, count, desc, eq, gte, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { logServerError, logServerEvent } from '../logger.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { isAdminRole } from '../governance.ts';
import { audit } from './adminPhase3Routes.ts';

export const SUPPORT_SUBJECTS = ['AJUDA_COM_PEDIDO', 'PAGAMENTO', 'PRODUTO', 'DUVIDA', 'OUTRO'] as const;
export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export const SUPPORT_REASONS = ['ORDER_PROBLEM', 'WRONG_ORDER', 'MISSING_ITEM', 'DAMAGED_PRODUCT', 'NOT_DELIVERED', 'OTHER'] as const;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_TICKETS_PER_PAGE = 50;
const DEFAULT_CONFIG = {
  postDeliveryDays: 30,
  postDeliveryAutoCloseDays: 15,
  generalAutoCloseDays: 30,
  retentionMonths: 12,
  maxOpenPerCustomer: 10,
  ticketsPerHour: 5,
  postDeliveryPerOrder: 5,
};
const CONFIG_KEYS = {
  postDeliveryDays: 'support_post_delivery_days',
  postDeliveryAutoCloseDays: 'support_post_delivery_auto_close_days',
  generalAutoCloseDays: 'support_general_auto_close_days',
  retentionMonths: 'support_retention_months',
  maxOpenPerCustomer: 'support_max_open_per_customer',
  ticketsPerHour: 'support_tickets_per_hour',
  postDeliveryPerOrder: 'support_post_delivery_per_order',
} as const;
type SupportConfig = typeof DEFAULT_CONFIG;
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  logServerError('support.operation.failed', error);
  return res.status(500).json({ error: fallback });
}
function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function optionalId(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = positiveId(value);
  if (!id) throw new HttpError(400, `${label} inválido.`);
  return id;
}
function hasClientSuppliedIdentity(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['authorId', 'authorUserId', 'userId', 'customerId'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function validatedMessage(value: unknown, allowEmpty = false): string | null {
  if (value === undefined && allowEmpty) return '';
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (body.length > MAX_MESSAGE_LENGTH || (!body && !allowEmpty)) return null;
  return body;
}
function validSubject(value: unknown): value is typeof SUPPORT_SUBJECTS[number] {
  return typeof value === 'string' && (SUPPORT_SUBJECTS as readonly string[]).includes(value);
}
function validStatus(value: unknown): value is typeof SUPPORT_STATUSES[number] {
  return typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value);
}
function validReason(value: unknown): value is typeof SUPPORT_REASONS[number] {
  return typeof value === 'string' && (SUPPORT_REASONS as readonly string[]).includes(value);
}
function sameOrigin(req: AuthRequest, res: Response, next: NextFunction) {
  const origin = req.get('Origin');
  if (!origin) return res.status(403).json({ error: 'Origem da solicitação ausente.' });
  let originValue: string;
  try { originValue = new URL(origin).origin; } catch { return res.status(403).json({ error: 'Origem da solicitação inválida.' }); }
  let configuredOrigin: string | null = null;
  try { configuredOrigin = process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : null; } catch { configuredOrigin = null; }
  const requestOrigin = req.get('host') ? `${req.protocol}://${req.get('host')}` : null;
  const expectedOrigin = configuredOrigin || requestOrigin;
  if (!expectedOrigin || originValue !== expectedOrigin) return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
  return next();
}
function configInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
async function supportConfig(): Promise<SupportConfig> {
  const keys = Object.values(CONFIG_KEYS);
  const rows = await db.select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings).where(inArray(schema.settings.key, keys));
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    postDeliveryDays: configInteger(map.get(CONFIG_KEYS.postDeliveryDays), DEFAULT_CONFIG.postDeliveryDays, 1, 365),
    postDeliveryAutoCloseDays: configInteger(map.get(CONFIG_KEYS.postDeliveryAutoCloseDays), DEFAULT_CONFIG.postDeliveryAutoCloseDays, 1, 180),
    generalAutoCloseDays: configInteger(map.get(CONFIG_KEYS.generalAutoCloseDays), DEFAULT_CONFIG.generalAutoCloseDays, 1, 365),
    retentionMonths: configInteger(map.get(CONFIG_KEYS.retentionMonths), DEFAULT_CONFIG.retentionMonths, 1, 120),
    maxOpenPerCustomer: configInteger(map.get(CONFIG_KEYS.maxOpenPerCustomer), DEFAULT_CONFIG.maxOpenPerCustomer, 1, 50),
    ticketsPerHour: configInteger(map.get(CONFIG_KEYS.ticketsPerHour), DEFAULT_CONFIG.ticketsPerHour, 1, 100),
    postDeliveryPerOrder: configInteger(map.get(CONFIG_KEYS.postDeliveryPerOrder), DEFAULT_CONFIG.postDeliveryPerOrder, 1, 30),
  };
}
async function ticketOrderSummary(orderId: number | null) {
  if (!orderId) return null;
  const [order] = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, deliveredAt: schema.orders.deliveredAt })
    .from(schema.orders).where(eq(schema.orders.id, orderId));
  return order || null;
}
async function ticketMessages(ticketId: number, sinceId: number | null = null) {
  const where = sinceId ? and(eq(schema.supportMessages.ticketId, ticketId), sql`${schema.supportMessages.id} > ${sinceId}`) : eq(schema.supportMessages.ticketId, ticketId);
  const rows = await db.select({
    id: schema.supportMessages.id,
    body: schema.supportMessages.body,
    createdAt: schema.supportMessages.createdAt,
    role: schema.users.role,
  }).from(schema.supportMessages)
    .leftJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id))
    .where(where).orderBy(schema.supportMessages.id);
  return rows.map((row) => {
    const authorRole = row.role && isAdminRole(row.role) ? 'ADMIN' : 'CUSTOMER';
    return { id: row.id, body: row.body, createdAt: row.createdAt, authorRole, authorLabel: authorRole === 'ADMIN' ? 'Loja' : 'Você' };
  });
}
async function hasStoreReply(ticketId: number) {
  const rows = await db.select({ role: schema.users.role }).from(schema.supportMessages)
    .innerJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id))
    .where(eq(schema.supportMessages.ticketId, ticketId));
  return rows.some((row) => isAdminRole(row.role));
}
async function customerTicketDetail(ticket: typeof schema.supportTickets.$inferSelect, sinceId: number | null = null) {
  const [order, messages, storeReply] = await Promise.all([
    ticketOrderSummary(ticket.orderId), ticketMessages(ticket.id, sinceId), hasStoreReply(ticket.id),
  ]);
  return {
    id: ticket.id, subject: ticket.subject, status: ticket.status, orderId: ticket.orderId, order,
    productId: ticket.productId, productNameSnapshot: ticket.productNameSnapshot,
    productSlugSnapshot: ticket.productSlugSnapshot, productLinkSnapshot: ticket.productLinkSnapshot,
    supportReason: ticket.supportReason, postDelivery: ticket.postDelivery,
    createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, closedAt: ticket.closedAt,
    closedReason: ticket.closedReason, messages, canCustomerCancel: ticket.status === 'OPEN' && !storeReply,
    unreadForCustomer: false, lastAuthorRole: messages.at(-1)?.authorRole || null,
  };
}
async function writeCustomerNotification(tx: any, userId: number, orderId: number | null, ticketId: number, title: string, message: string) {
  let orderNumber = `CHAT-${ticketId}`;
  if (orderId) {
    const [order] = await tx.select({ orderNumber: schema.orders.orderNumber }).from(schema.orders).where(eq(schema.orders.id, orderId));
    if (order?.orderNumber) orderNumber = order.orderNumber;
  }
  await tx.insert(schema.notifications).values({
    userId, orderId, supportTicketId: ticketId, orderNumber,
    oldStatus: null, newStatus: 'SUPPORT_MESSAGE', title, message,
    isRead: false, popupDismissed: false, createdAt: new Date(),
  });
}
async function writeAdminNotification(tx: any, customerId: number, orderId: number | null, ticketId: number, title: string, message: string) {
  await tx.insert(schema.adminNotifications).values({
    type: 'SUPPORT_MESSAGE', customerId, orderId, supportTicketId: ticketId, addressId: null,
    title, message, isRead: false, popupDismissed: false, createdAt: new Date(),
  });
}
async function validateVisibleProduct(productId: number | null) {
  if (!productId) return null;
  const [product] = await db.select({ id: schema.products.id, name: schema.products.name, status: schema.products.status, stock: schema.products.stock })
    .from(schema.products).where(eq(schema.products.id, productId));
  if (!product || product.status !== 'ACTIVE' || product.stock <= 0) throw new HttpError(400, 'Este produto não está disponível na vitrine.');
  const slug = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
  return { id: product.id, name: product.name, slug, link: `/produto/${product.id}` };
}
async function enforceCustomerTicketLimits(tx: any, userId: number, orderId: number | null, config: SupportConfig, postDelivery: boolean) {
  await tx.execute(sql`SELECT id FROM ${schema.users} WHERE ${schema.users.id} = ${userId} FOR UPDATE`);
  const [hourly] = await tx.select({ total: count() }).from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.userId, userId), sql`${schema.supportTickets.createdAt} >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour'`));
  if (Number(hourly?.total || 0) >= config.ticketsPerHour) throw new HttpError(429, 'Limite de novos atendimentos por hora atingido. Tente novamente mais tarde.');
  const [active] = await tx.select({ total: count() }).from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.userId, userId), ne(schema.supportTickets.status, 'CLOSED')));
  if (Number(active?.total || 0) >= config.maxOpenPerCustomer) throw new HttpError(429, 'Você atingiu o limite de atendimentos ativos.');
  if (postDelivery && orderId) {
    const [perOrder] = await tx.select({ total: count() }).from(schema.supportTickets)
      .where(and(eq(schema.supportTickets.orderId, orderId), eq(schema.supportTickets.postDelivery, true), sql`${schema.supportTickets.createdAt} >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - (${config.postDeliveryDays} * INTERVAL '1 day')`));
    if (Number(perOrder?.total || 0) >= config.postDeliveryPerOrder) throw new HttpError(429, 'Limite de chamados ativos para este pedido atingido.');
  }
}
function safeSince(value: unknown): number | null {
  if (value === undefined) return null;
  const id = positiveId(value);
  if (!id) throw new HttpError(400, 'Parâmetro since inválido. Use o identificador da última mensagem.');
  return id;
}
function supportError(error: unknown, res: Response, fallback: string) { return fail(res, error, fallback); }

export function registerSupportRoutes(app: Express) {
  app.get('/api/support/config', async (_req, res) => {
    try { const config = await supportConfig(); return res.json({ postDeliveryDays: config.postDeliveryDays }); }
    catch (error) { return supportError(error, res, 'Não foi possível carregar as configurações do atendimento.'); }
  });

  app.get('/api/support/tickets', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) return res.status(403).json({ error: 'Use a Central de Ajuda administrativa.' });
      const tickets = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.userId, req.user!.id))
        .orderBy(desc(schema.supportTickets.updatedAt), desc(schema.supportTickets.id)).limit(100);
      if (!tickets.length) return res.json({ tickets: [], unreadCount: 0 });
      const ids = tickets.map((ticket) => ticket.id);
      const [messages, orders] = await Promise.all([
        db.select({ id: schema.supportMessages.id, ticketId: schema.supportMessages.ticketId, createdAt: schema.supportMessages.createdAt, role: schema.users.role })
          .from(schema.supportMessages).leftJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id))
          .where(inArray(schema.supportMessages.ticketId, ids)).orderBy(desc(schema.supportMessages.id)),
        db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, deliveredAt: schema.orders.deliveredAt })
          .from(schema.orders).where(inArray(schema.orders.id, tickets.map((ticket) => ticket.orderId).filter((id): id is number => id !== null))),
      ]);
      const latest = new Map<number, typeof messages[number]>();
      for (const message of messages) if (!latest.has(message.ticketId)) latest.set(message.ticketId, message);
      const orderMap = new Map(orders.map((order) => [order.id, order]));
      const summaries = tickets.map((ticket) => {
        const last = latest.get(ticket.id);
        const unreadForCustomer = Boolean(last && last.role && isAdminRole(last.role) && (!ticket.customerLastReadAt || new Date(last.createdAt) > new Date(ticket.customerLastReadAt)));
        return {
          id: ticket.id, subject: ticket.subject, status: ticket.status, orderId: ticket.orderId,
          order: ticket.orderId ? orderMap.get(ticket.orderId) || null : null,
          productId: ticket.productId, productNameSnapshot: ticket.productNameSnapshot,
          productSlugSnapshot: ticket.productSlugSnapshot, productLinkSnapshot: ticket.productLinkSnapshot,
          supportReason: ticket.supportReason, postDelivery: ticket.postDelivery,
          createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, closedAt: ticket.closedAt, closedReason: ticket.closedReason,
          lastAuthorRole: last?.role && isAdminRole(last.role) ? 'ADMIN' : last ? 'CUSTOMER' : null,
          lastMessageAt: last?.createdAt || null, lastMessageId: last?.id || null,
          unreadForCustomer,
        };
      });
      return res.json({ tickets: summaries, unreadCount: summaries.filter((ticket) => ticket.unreadForCustomer).length });
    } catch (error) { return supportError(error, res, 'Não foi possível carregar seus atendimentos.'); }
  });

  app.post('/api/support/tickets', requireAuth, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) return res.status(403).json({ error: 'Somente clientes podem abrir atendimentos por esta rota.' });
      if (hasClientSuppliedIdentity(req.body)) throw new HttpError(400, 'Identidade do cliente ou autor não pode ser informada.');
      if (!validSubject(req.body?.subject)) throw new HttpError(400, 'Assunto inválido.');
      const body = validatedMessage(req.body?.body);
      if (!body) throw new HttpError(400, 'A mensagem é obrigatória e deve ter até 4000 caracteres.');
      const orderId = optionalId(req.body?.orderId, 'Pedido');
      const productId = optionalId(req.body?.productId, 'Produto');
      const product = await validateVisibleProduct(productId);
      const config = await supportConfig();
      const now = new Date();
      const created = await db.transaction(async (tx) => {
        if (orderId) {
          const lock = await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} AND user_id = ${req.user!.id} FOR UPDATE`);
          if (!lock.rows?.length) throw new HttpError(404, 'Pedido relacionado não encontrado.');
          const [order] = await tx.select({ status: schema.orders.status }).from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, req.user!.id)));
          if (!order) throw new HttpError(404, 'Pedido relacionado não encontrado.');
          if (order.status === 'DELIVERED') throw new HttpError(409, 'Este pedido já foi entregue. Abra um novo chamado pós-entrega na conversa encerrada.');
        }
        await enforceCustomerTicketLimits(tx, req.user!.id, orderId, config, false);
        const [ticket] = await tx.insert(schema.supportTickets).values({
          userId: req.user!.id, orderId, productId: product?.id ?? null,
          productNameSnapshot: product?.name ?? null, productSlugSnapshot: product?.slug ?? null,
          productLinkSnapshot: product?.link ?? null, subject: req.body.subject,
          status: 'OPEN', initiatedByUserId: req.user!.id, postDelivery: false,
          customerLastReadAt: now, updatedAt: now, createdAt: now,
        }).returning();
        await tx.insert(schema.supportMessages).values({ ticketId: ticket.id, authorUserId: req.user!.id, body, createdAt: now });
        await writeAdminNotification(tx, req.user!.id, orderId, ticket.id, `Novo atendimento #${ticket.id}`, 'Um cliente abriu um atendimento na Central de Ajuda.');
        return ticket;
      });
      logServerEvent('support.ticket.created', 'info', { ticketId: created.id, userId: req.user!.id, orderId, productId, result: 'committed' });
      return res.status(201).json({ ticket: await customerTicketDetail(created) });
    } catch (error) { return supportError(error, res, 'Não foi possível abrir o atendimento.'); }
  });

  app.post('/api/support/orders/:id/post-delivery-tickets', requireAuth, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) throw new HttpError(403, 'Somente o cliente pode abrir este chamado.');
      if (hasClientSuppliedIdentity(req.body)) throw new HttpError(400, 'O autor é definido pela sessão autenticada.');
      const orderId = positiveId(req.params.id);
      if (!orderId) throw new HttpError(404, 'Pedido não encontrado.');
      const rawReason: unknown = req.body?.reasonCode;
      if (!validReason(rawReason)) throw new HttpError(400, 'Motivo pós-entrega inválido.');
      const reasonCode = rawReason as typeof SUPPORT_REASONS[number];
      const description = validatedMessage(req.body?.description, true);
      if (description === null) throw new HttpError(400, 'A descrição deve ter até 4000 caracteres.');
      const config = await supportConfig();
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} AND user_id = ${req.user!.id} FOR UPDATE`);
        if (!locked.rows?.length) throw new HttpError(404, 'Pedido não encontrado.');
        const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, req.user!.id)));
        if (!order || order.status !== 'DELIVERED' || !order.deliveredAt) throw new HttpError(409, 'O pedido precisa estar marcado como entregue para abrir suporte pós-entrega.');
        const [window] = await tx.select({ open: sql<boolean>`(${schema.orders.deliveredAt} + (${config.postDeliveryDays} * INTERVAL '1 day')) >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')` })
          .from(schema.orders).where(eq(schema.orders.id, orderId));
        if (!window?.open) throw new HttpError(410, 'O prazo para abrir suporte pós-entrega terminou.');
        const [existing] = await tx.select().from(schema.supportTickets).where(and(
          eq(schema.supportTickets.orderId, orderId), eq(schema.supportTickets.userId, req.user!.id),
          eq(schema.supportTickets.postDelivery, true), eq(schema.supportTickets.supportReason, reasonCode),
          ne(schema.supportTickets.status, 'CLOSED'),
        )).orderBy(desc(schema.supportTickets.updatedAt)).limit(1);
        if (existing) return { ticket: existing, created: false };
        await enforceCustomerTicketLimits(tx, req.user!.id, orderId, config, true);
        const label: Record<typeof SUPPORT_REASONS[number], string> = {
          ORDER_PROBLEM: 'Pedido com problema', WRONG_ORDER: 'Pedido errado', MISSING_ITEM: 'Item faltando ou incompleto',
          DAMAGED_PRODUCT: 'Produto danificado', NOT_DELIVERED: 'Pedido não chegou apesar de marcado como entregue', OTHER: 'Outro',
        };
        const body = [label[reasonCode], description].filter(Boolean).join('\n\nDetalhes: ');
        const [ticket] = await tx.insert(schema.supportTickets).values({
          userId: req.user!.id, orderId, subject: 'AJUDA_COM_PEDIDO', supportReason: reasonCode,
          postDelivery: true, status: 'OPEN', initiatedByUserId: req.user!.id,
          customerLastReadAt: now, createdAt: now, updatedAt: now,
        }).onConflictDoNothing().returning();
        if (!ticket) {
          const [concurrent] = await tx.select().from(schema.supportTickets).where(and(
            eq(schema.supportTickets.orderId, orderId), eq(schema.supportTickets.userId, req.user!.id),
            eq(schema.supportTickets.postDelivery, true), eq(schema.supportTickets.supportReason, reasonCode),
            ne(schema.supportTickets.status, 'CLOSED'),
          )).orderBy(desc(schema.supportTickets.updatedAt)).limit(1);
          if (concurrent) return { ticket: concurrent, created: false };
          throw new HttpError(409, 'Não foi possível abrir o chamado. Tente novamente.');
        }
        await tx.insert(schema.supportMessages).values({ ticketId: ticket.id, authorUserId: req.user!.id, body, createdAt: now });
        await writeAdminNotification(tx, req.user!.id, orderId, ticket.id, `Chamado pós-entrega #${ticket.id}`, `Novo motivo de suporte: ${label[reasonCode]}.`);
        return { ticket, created: true };
      });
      logServerEvent('support.post_delivery.created', 'info', { ticketId: result.ticket.id, userId: req.user!.id, orderId, reason: reasonCode, created: result.created, result: 'committed' });
      return res.status(result.created ? 201 : 200).json({ ticket: await customerTicketDetail(result.ticket), reused: !result.created });
    } catch (error) { return supportError(error, res, 'Não foi possível abrir o chamado pós-entrega.'); }
  });

  app.get('/api/support/tickets/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) throw new HttpError(403, 'Use a Central de Ajuda administrativa.');
      const id = positiveId(req.params.id); if (!id) throw new HttpError(404, 'Atendimento não encontrado.');
      const sinceId = safeSince(req.query.since);
      await db.update(schema.supportTickets).set({ customerLastReadAt: new Date() })
        .where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.userId, req.user!.id)));
      const [ticket] = await db.select().from(schema.supportTickets).where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.userId, req.user!.id)));
      if (!ticket) throw new HttpError(404, 'Atendimento não encontrado.');
      return res.json({ ticket: await customerTicketDetail(ticket, sinceId) });
    } catch (error) { return supportError(error, res, 'Não foi possível carregar o atendimento.'); }
  });

  app.post('/api/support/tickets/:id/messages', requireAuth, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) throw new HttpError(403, 'Use a Central de Ajuda administrativa.');
      if (hasClientSuppliedIdentity(req.body)) throw new HttpError(400, 'O autor da mensagem é definido pela sessão autenticada.');
      const body = validatedMessage(req.body?.body); if (!body) throw new HttpError(400, 'A mensagem é obrigatória e deve ter até 4000 caracteres.');
      const id = positiveId(req.params.id); if (!id) throw new HttpError(404, 'Atendimento não encontrado.');
      const now = new Date();
      const ticket = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM support_tickets WHERE id = ${id} FOR UPDATE`);
        const [current] = await tx.select().from(schema.supportTickets).where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.userId, req.user!.id)));
        if (!current) throw new HttpError(404, 'Atendimento não encontrado.');
        if (current.status === 'RESOLVED' || current.status === 'CLOSED') throw new HttpError(409, 'Este atendimento não aceita novas mensagens.');
        await tx.insert(schema.supportMessages).values({ ticketId: id, authorUserId: req.user!.id, body, createdAt: now });
        const [updated] = await tx.update(schema.supportTickets).set({ status: 'IN_PROGRESS', updatedAt: now, customerLastReadAt: now })
          .where(eq(schema.supportTickets.id, id)).returning();
        await writeAdminNotification(tx, req.user!.id, current.orderId, id, `Nova mensagem no atendimento #${id}`, 'Uma nova mensagem foi recebida na Central de Ajuda.');
        return updated;
      });
      return res.status(201).json({ ticket: await customerTicketDetail(ticket) });
    } catch (error) { return supportError(error, res, 'Não foi possível enviar a mensagem.'); }
  });

  app.post('/api/support/tickets/:id/close', requireAuth, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) throw new HttpError(403, 'Use a Central de Ajuda administrativa.');
      const id = positiveId(req.params.id); if (!id) throw new HttpError(404, 'Atendimento não encontrado.');
      const now = new Date();
      const closed = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM support_tickets WHERE id = ${id} FOR UPDATE`);
        const [ticket] = await tx.select().from(schema.supportTickets).where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.userId, req.user!.id)));
        if (!ticket) throw new HttpError(404, 'Atendimento não encontrado.');
        if (ticket.status === 'CLOSED') throw new HttpError(409, 'Este atendimento já está encerrado.');
        const messages = await tx.select({ role: schema.users.role }).from(schema.supportMessages)
          .innerJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id)).where(eq(schema.supportMessages.ticketId, id));
        const storeHasReplied = messages.some((row) => isAdminRole(row.role));
        if (ticket.status !== 'RESOLVED' && !(ticket.status === 'OPEN' && !storeHasReplied)) {
          throw new HttpError(409, 'Só é possível encerrar um atendimento resolvido ou cancelar um atendimento ainda sem resposta da loja.');
        }
        const reason = ticket.status === 'OPEN' ? 'CUSTOMER_CANCELLED_NO_REPLY' : 'CUSTOMER_CONFIRMED';
        const [updated] = await tx.update(schema.supportTickets).set({
          status: 'CLOSED', closedAt: now, closedByUserId: req.user!.id, closedReason: reason, updatedAt: now,
        }).where(eq(schema.supportTickets.id, id)).returning();
        return updated;
      });
      return res.json({ ticket: await customerTicketDetail(closed) });
    } catch (error) { return supportError(error, res, 'Não foi possível encerrar o atendimento.'); }
  });

  app.get('/api/admin/support/settings', requireAuth, requireAdmin, async (_req, res) => {
    try { return res.json(await supportConfig()); }
    catch (error) { return supportError(error, res, 'Não foi possível carregar as configurações de atendimento.'); }
  });
  app.put('/api/admin/support/settings', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try {
      const map: Record<string, { key: string; min: number; max: number }> = {
        postDeliveryDays: { key: CONFIG_KEYS.postDeliveryDays, min: 1, max: 365 },
        postDeliveryAutoCloseDays: { key: CONFIG_KEYS.postDeliveryAutoCloseDays, min: 1, max: 180 },
        generalAutoCloseDays: { key: CONFIG_KEYS.generalAutoCloseDays, min: 1, max: 365 },
        retentionMonths: { key: CONFIG_KEYS.retentionMonths, min: 1, max: 120 },
        maxOpenPerCustomer: { key: CONFIG_KEYS.maxOpenPerCustomer, min: 1, max: 50 },
        ticketsPerHour: { key: CONFIG_KEYS.ticketsPerHour, min: 1, max: 100 },
        postDeliveryPerOrder: { key: CONFIG_KEYS.postDeliveryPerOrder, min: 1, max: 30 },
      };
      const keys = Object.keys(req.body || {});
      if (!keys.length || keys.some((key) => !(key in map))) throw new HttpError(400, 'Configuração de suporte inválida.');
      for (const field of keys) {
        const { key, min, max } = map[field]; const value = Number(req.body[field]);
        if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `Valor inválido para ${field}.`);
        const [existing] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
        if (existing) await db.update(schema.settings).set({ value: String(value), updatedAt: new Date() }).where(eq(schema.settings.key, key));
        else await db.insert(schema.settings).values({ key, value: String(value) });
      }
      await audit(req, 'SUPPORT_SETTINGS_UPDATED', 'SUPPORT_SETTINGS', null, { changedFields: keys });
      return res.json(await supportConfig());
    } catch (error) { return supportError(error, res, 'Não foi possível salvar as configurações.'); }
  });

  app.get('/api/admin/support/customers', requireAuth, requireAdmin, async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
      if (q.length < 2) return res.json({ customers: [] });
      const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;
      const customers = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users).where(and(eq(schema.users.role, 'CUSTOMER'), eq(schema.users.status, 'ACTIVE'), or(ilike(schema.users.name, pattern), ilike(schema.users.email, pattern))!))
        .orderBy(schema.users.name).limit(20);
      return res.json({ customers });
    } catch (error) { return supportError(error, res, 'Não foi possível buscar clientes.'); }
  });
  app.get('/api/admin/support/customers/:id/orders', requireAuth, requireAdmin, async (req, res) => {
    try {
      const customerId = positiveId(req.params.id); if (!customerId) throw new HttpError(400, 'Cliente inválido.');
      const orders = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, deliveredAt: schema.orders.deliveredAt })
        .from(schema.orders).where(eq(schema.orders.userId, customerId)).orderBy(desc(schema.orders.createdAt)).limit(50);
      return res.json({ orders });
    } catch (error) { return supportError(error, res, 'Não foi possível carregar os pedidos do cliente.'); }
  });
  app.get('/api/admin/support/products', requireAuth, requireAdmin, async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
      if (q.length < 2) return res.json({ products: [] });
      const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;
      const products = await db.select({ id: schema.products.id, name: schema.products.name, code: schema.products.code })
        .from(schema.products).where(and(eq(schema.products.status, 'ACTIVE'), sql`${schema.products.stock} > 0`, or(ilike(schema.products.name, pattern), ilike(schema.products.code, pattern))!))
        .orderBy(schema.products.name).limit(20);
      return res.json({ products });
    } catch (error) { return supportError(error, res, 'Não foi possível buscar produtos.'); }
  });
  app.post('/api/admin/support/tickets', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (['authorId', 'authorUserId', 'userId'].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key))) throw new HttpError(400, 'O autor da mensagem é definido pela sessão administrativa.');
      const customerId = positiveId(req.body?.customerId); if (!customerId) throw new HttpError(400, 'Selecione um cliente.');
      if (!validSubject(req.body?.subject)) throw new HttpError(400, 'Assunto inválido.');
      const body = validatedMessage(req.body?.body); if (!body) throw new HttpError(400, 'A mensagem inicial é obrigatória e deve ter até 4000 caracteres.');
      const orderId = optionalId(req.body?.orderId, 'Pedido'); const productId = optionalId(req.body?.productId, 'Produto');
      const product = await validateVisibleProduct(productId);
      const [customer] = await db.select({ id: schema.users.id, role: schema.users.role, status: schema.users.status }).from(schema.users).where(eq(schema.users.id, customerId));
      if (!customer || customer.role !== 'CUSTOMER' || customer.status !== 'ACTIVE') throw new HttpError(404, 'Cliente não encontrado ou inativo.');
      const config = await supportConfig(); void config;
      const now = new Date();
      const ticket = await db.transaction(async (tx) => {
        if (orderId) {
          const [order] = await tx.select({ id: schema.orders.id, status: schema.orders.status }).from(schema.orders)
            .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, customerId)));
          if (!order) throw new HttpError(400, 'O pedido não pertence ao cliente selecionado.');
          if (order.status === 'DELIVERED') throw new HttpError(409, 'Não associe um novo atendimento administrativo a um pedido entregue; abra uma conversa geral ou oriente o cliente a usar o fluxo pós-entrega.');
        }
        const [created] = await tx.insert(schema.supportTickets).values({
          userId: customerId, orderId, productId: product?.id ?? null,
          productNameSnapshot: product?.name ?? null, productSlugSnapshot: product?.slug ?? null,
          productLinkSnapshot: product?.link ?? null, subject: req.body.subject,
          status: 'WAITING_CUSTOMER', initiatedByUserId: req.user!.id, postDelivery: false,
          storeLastReadAt: now, lastStoreMessageAt: now, createdAt: now, updatedAt: now,
        }).returning();
        await tx.insert(schema.supportMessages).values({ ticketId: created.id, authorUserId: req.user!.id, body, createdAt: now });
        await writeCustomerNotification(tx, customerId, orderId, created.id, 'A loja iniciou uma conversa', 'A DeepShop enviou uma mensagem. Abra a Central de Ajuda para responder.');
        return created;
      });
      await audit(req, 'SUPPORT_TICKET_CREATED_BY_ADMIN', 'SUPPORT_TICKET', ticket.id, { customerId, orderId, productId, initiatedByUserId: req.user!.id });
      logServerEvent('support.ticket.admin_initiated', 'info', { ticketId: ticket.id, adminId: req.user!.id, customerId, orderId, productId, result: 'committed' });
      return res.status(201).json({ ticket: await customerTicketDetail(ticket) });
    } catch (error) { return supportError(error, res, 'Não foi possível iniciar a conversa.'); }
  });

  app.get('/api/admin/support/tickets', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'ALL';
      if (status !== 'ALL' && !validStatus(status)) throw new HttpError(400, 'Status inválido.');
      const subject = typeof req.query.subject === 'string' ? req.query.subject : 'ALL';
      if (subject !== 'ALL' && !validSubject(subject)) throw new HttpError(400, 'Assunto inválido.');
      const reason = typeof req.query.reason === 'string' ? req.query.reason : 'ALL';
      if (reason !== 'ALL' && !validReason(reason)) throw new HttpError(400, 'Motivo inválido.');
      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const pageSize = Math.max(1, Math.min(MAX_TICKETS_PER_PAGE, Number(req.query.pageSize) || 25));
      const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const filters: any[] = [];
      if (status !== 'ALL') filters.push(eq(schema.supportTickets.status, status));
      if (subject !== 'ALL') filters.push(eq(schema.supportTickets.subject, subject));
      if (reason !== 'ALL') filters.push(eq(schema.supportTickets.supportReason, reason));
      if (query) {
        const pattern = `%${query}%`;
        filters.push(or(ilike(schema.users.name, pattern), ilike(schema.users.email, pattern), ilike(schema.supportTickets.subject, pattern), sql`${schema.supportTickets.id}::text ILIKE ${pattern}`)!);
      }
      const where = filters.length ? and(...filters) : undefined;
      const [countRows, rows] = await Promise.all([
        db.select({ total: count() }).from(schema.supportTickets).innerJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id)).where(where),
        db.select({
          id: schema.supportTickets.id, userId: schema.supportTickets.userId, orderId: schema.supportTickets.orderId,
          productId: schema.supportTickets.productId, productNameSnapshot: schema.supportTickets.productNameSnapshot,
          productSlugSnapshot: schema.supportTickets.productSlugSnapshot, productLinkSnapshot: schema.supportTickets.productLinkSnapshot,
          supportReason: schema.supportTickets.supportReason, postDelivery: schema.supportTickets.postDelivery,
          subject: schema.supportTickets.subject, status: schema.supportTickets.status, closedReason: schema.supportTickets.closedReason,
          createdAt: schema.supportTickets.createdAt, updatedAt: schema.supportTickets.updatedAt, closedAt: schema.supportTickets.closedAt,
          storeLastReadAt: schema.supportTickets.storeLastReadAt,
          customerName: schema.users.name, customerEmail: schema.users.email,
        }).from(schema.supportTickets).innerJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id))
          .where(where).orderBy(desc(schema.supportTickets.updatedAt), desc(schema.supportTickets.id)).limit(pageSize).offset((page - 1) * pageSize),
      ]);
      const total = Number(countRows[0]?.total || 0);
      const ids = rows.map((row) => row.id);
      if (!ids.length) return res.json({ tickets: [], pagination: { page, pageSize, total, totalPages: 0 }, unreadCount: 0 });
      const [orders, messages] = await Promise.all([
        db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, deliveredAt: schema.orders.deliveredAt })
          .from(schema.orders).where(inArray(schema.orders.id, rows.map((row) => row.orderId).filter((id): id is number => id !== null))),
        db.select({ id: schema.supportMessages.id, ticketId: schema.supportMessages.ticketId, createdAt: schema.supportMessages.createdAt, role: schema.users.role })
          .from(schema.supportMessages).innerJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id))
          .where(inArray(schema.supportMessages.ticketId, ids)).orderBy(desc(schema.supportMessages.id), desc(schema.supportMessages.createdAt)),
      ]);
      const latest = new Map<number, typeof messages[number]>();
      for (const message of messages) if (!latest.has(message.ticketId)) latest.set(message.ticketId, message);
      const orderMap = new Map(orders.map((order) => [order.id, order]));
      const tickets = rows.map((row) => {
        const last = latest.get(row.id);
        const unreadForStore = Boolean(last && !isAdminRole(last.role) && (!row.storeLastReadAt || new Date(last.createdAt) > new Date(row.storeLastReadAt)));
        return { ...row, storeLastReadAt: undefined, order: row.orderId ? orderMap.get(row.orderId) || null : null,
          lastMessageId: last?.id || null, lastAuthorRole: last && isAdminRole(last.role) ? 'ADMIN' : last ? 'CUSTOMER' : null,
          lastMessageAt: last?.createdAt || null, unreadForStore };
      });
      return res.json({ tickets, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }, unreadCount: tickets.filter((ticket) => ticket.unreadForStore).length });
    } catch (error) { return supportError(error, res, 'Não foi possível carregar os atendimentos.'); }
  });

  app.get('/api/admin/support/tickets/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = positiveId(req.params.id); if (!id) throw new HttpError(404, 'Atendimento não encontrado.');
      const sinceId = safeSince(req.query.since);
      await db.update(schema.supportTickets).set({ storeLastReadAt: new Date() }).where(eq(schema.supportTickets.id, id));
      const [ticket] = await db.select({
        id: schema.supportTickets.id, userId: schema.supportTickets.userId, orderId: schema.supportTickets.orderId,
        productId: schema.supportTickets.productId, productNameSnapshot: schema.supportTickets.productNameSnapshot,
        productSlugSnapshot: schema.supportTickets.productSlugSnapshot, productLinkSnapshot: schema.supportTickets.productLinkSnapshot,
        supportReason: schema.supportTickets.supportReason, postDelivery: schema.supportTickets.postDelivery,
        closedReason: schema.supportTickets.closedReason, closedByUserId: schema.supportTickets.closedByUserId,
        subject: schema.supportTickets.subject, status: schema.supportTickets.status,
        createdAt: schema.supportTickets.createdAt, updatedAt: schema.supportTickets.updatedAt, closedAt: schema.supportTickets.closedAt,
        customerName: schema.users.name, customerEmail: schema.users.email,
      }).from(schema.supportTickets).innerJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id)).where(eq(schema.supportTickets.id, id));
      if (!ticket) throw new HttpError(404, 'Atendimento não encontrado.');
      const [order, messages] = await Promise.all([ticketOrderSummary(ticket.orderId), ticketMessages(id, sinceId)]);
      return res.json({ ticket: { ...ticket, order, messages } });
    } catch (error) { return supportError(error, res, 'Não foi possível carregar o atendimento.'); }
  });

  app.post('/api/admin/support/tickets/:id/messages', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try {
      if (hasClientSuppliedIdentity(req.body)) throw new HttpError(400, 'O autor da mensagem é definido pela sessão administrativa.');
      const body = validatedMessage(req.body?.body); if (!body) throw new HttpError(400, 'A mensagem é obrigatória e deve ter até 4000 caracteres.');
      const id = positiveId(req.params.id); if (!id) throw new HttpError(404, 'Atendimento não encontrado.');
      const now = new Date();
      const ticket = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM support_tickets WHERE id = ${id} FOR UPDATE`);
        const [current] = await tx.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
        if (!current) throw new HttpError(404, 'Atendimento não encontrado.');
        if (current.status === 'CLOSED') throw new HttpError(409, 'Este atendimento está encerrado. Reabra-o primeiro, exceto se foi encerrado pela entrega do pedido.');
        await tx.insert(schema.supportMessages).values({ ticketId: id, authorUserId: req.user!.id, body, createdAt: now });
        const [updated] = await tx.update(schema.supportTickets).set({
          status: 'WAITING_CUSTOMER', updatedAt: now, storeLastReadAt: now, lastStoreMessageAt: now,
          closedAt: null, closedByUserId: null, closedReason: null,
        }).where(eq(schema.supportTickets.id, id)).returning();
        await writeCustomerNotification(tx, current.userId, current.orderId, id, `Nova resposta da loja no atendimento #${id}`, 'A loja respondeu à sua mensagem. Abra a Central de Ajuda para continuar.');
        return updated;
      });
      return res.status(201).json({ ticket: await customerTicketDetail(ticket) });
    } catch (error) { return supportError(error, res, 'Não foi possível enviar a resposta.'); }
  });

  app.patch('/api/admin/support/tickets/:id/status', requireAuth, requireAdmin, sameOrigin, async (req: AuthRequest, res) => {
    try {
      const id = positiveId(req.params.id); if (!id) throw new HttpError(404, 'Atendimento não encontrado.');
      if (!validStatus(req.body?.status)) throw new HttpError(400, 'Status inválido.');
      const status = req.body.status; const now = new Date();
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM support_tickets WHERE id = ${id} FOR UPDATE`);
        const [current] = await tx.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
        if (!current) throw new HttpError(404, 'Atendimento não encontrado.');
        if (current.status === status) return { ticket: current, previousStatus: current.status };
        if (current.status === 'CLOSED' && status !== 'CLOSED' && current.closedReason === 'ORDER_DELIVERED' && !current.postDelivery) {
          throw new HttpError(409, 'Atendimento encerrado pela entrega não pode ser reaberto. Oriente o cliente a abrir um chamado pós-entrega.');
        }
        const closing = status === 'CLOSED';
        const [updated] = await tx.update(schema.supportTickets).set({
          status, updatedAt: now,
          closedAt: closing ? now : null,
          closedByUserId: closing ? req.user!.id : null,
          closedReason: closing ? 'ADMIN_CLOSED' : null,
          lastStoreMessageAt: status === 'WAITING_CUSTOMER' || status === 'RESOLVED' ? now : current.lastStoreMessageAt,
        }).where(eq(schema.supportTickets.id, id)).returning();
        return { ticket: updated, previousStatus: current.status };
      });
      if (result.previousStatus !== status) {
        await audit(req, 'SUPPORT_TICKET_STATUS_CHANGED', 'SUPPORT_TICKET', id, { previousStatus: result.previousStatus, status });
        if (['RESOLVED', 'CLOSED'].includes(status)) {
          await db.transaction(async (tx) => {
            await writeCustomerNotification(tx, result.ticket.userId, result.ticket.orderId, id,
              status === 'RESOLVED' ? `Atendimento #${id} resolvido` : `Atendimento #${id} encerrado`,
              status === 'RESOLVED' ? 'A loja marcou o atendimento como resolvido. Se precisar, abra a conversa na Central de Ajuda.' : 'A loja encerrou este atendimento. O histórico continua disponível.');
          });
        }
      }
      return res.json({ ticket: await customerTicketDetail(result.ticket) });
    } catch (error) { return supportError(error, res, 'Não foi possível alterar o status do atendimento.'); }
  });
}
