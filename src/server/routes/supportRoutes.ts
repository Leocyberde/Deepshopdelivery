import type { Express } from 'express';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { logServerError, logServerEvent } from '../logger.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { isAdminRole } from '../governance.ts';
import { audit } from './adminPhase3Routes.ts';

export const SUPPORT_SUBJECTS = ['AJUDA_COM_PEDIDO', 'PAGAMENTO', 'PRODUTO', 'DUVIDA', 'OUTRO'] as const;
export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_TICKETS_PER_PAGE = 50;

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function hasClientSuppliedIdentity(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['authorId', 'authorUserId', 'userId', 'customerId'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validatedMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (!body || body.length > MAX_MESSAGE_LENGTH) return null;
  return body;
}

async function ticketOrderSummary(orderId: number | null) {
  if (!orderId) return null;
  const [order] = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status })
    .from(schema.orders).where(eq(schema.orders.id, orderId));
  return order || null;
}

async function ticketMessages(ticketId: number) {
  const rows = await db.select({
    id: schema.supportMessages.id,
    body: schema.supportMessages.body,
    createdAt: schema.supportMessages.createdAt,
    role: schema.users.role,
  })
    .from(schema.supportMessages)
    .leftJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id))
    .where(eq(schema.supportMessages.ticketId, ticketId))
    .orderBy(schema.supportMessages.id);
  return rows.map((row) => {
    const authorRole = row.role && isAdminRole(row.role) ? 'ADMIN' : 'CUSTOMER';
    return { id: row.id, body: row.body, createdAt: row.createdAt, authorRole, authorLabel: authorRole === 'ADMIN' ? 'Loja' : 'Você' };
  });
}

async function customerTicketDetail(ticket: typeof schema.supportTickets.$inferSelect) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    orderId: ticket.orderId,
    order: await ticketOrderSummary(ticket.orderId),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    closedAt: ticket.closedAt,
    messages: await ticketMessages(ticket.id),
  };
}

function validSubject(value: unknown): value is typeof SUPPORT_SUBJECTS[number] {
  return typeof value === 'string' && (SUPPORT_SUBJECTS as readonly string[]).includes(value);
}

function validStatus(value: unknown): value is typeof SUPPORT_STATUSES[number] {
  return typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value);
}

export function registerSupportRoutes(app: Express) {
  app.get('/api/support/tickets', requireAuth, async (req: AuthRequest, res) => {
    try {
      const tickets = await db.select().from(schema.supportTickets)
        .where(eq(schema.supportTickets.userId, req.user!.id))
        .orderBy(desc(schema.supportTickets.updatedAt), desc(schema.supportTickets.id))
        .limit(100);
      if (!tickets.length) return res.json({ tickets: [] });

      const ids = tickets.map((ticket) => ticket.id);
      const [messages, orders] = await Promise.all([
        db.select({ ticketId: schema.supportMessages.ticketId, createdAt: schema.supportMessages.createdAt, role: schema.users.role })
          .from(schema.supportMessages)
          .leftJoin(schema.users, eq(schema.supportMessages.authorUserId, schema.users.id))
          .where(inArray(schema.supportMessages.ticketId, ids))
          .orderBy(desc(schema.supportMessages.id)),
        db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status })
          .from(schema.orders)
          .where(inArray(schema.orders.id, tickets.map((ticket) => ticket.orderId).filter((id): id is number => id !== null))),
      ]);
      const latestByTicket = new Map<number, typeof messages[number]>();
      for (const message of messages) if (!latestByTicket.has(message.ticketId)) latestByTicket.set(message.ticketId, message);
      const orderById = new Map(orders.map((order) => [order.id, order]));
      return res.json({
        tickets: tickets.map((ticket) => {
          const last = latestByTicket.get(ticket.id);
          return {
            id: ticket.id,
            subject: ticket.subject,
            status: ticket.status,
            orderId: ticket.orderId,
            order: ticket.orderId ? orderById.get(ticket.orderId) || null : null,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
            closedAt: ticket.closedAt,
            lastAuthorRole: last?.role && isAdminRole(last.role) ? 'ADMIN' : last ? 'CUSTOMER' : null,
            lastMessageAt: last?.createdAt || null,
          };
        }),
      });
    } catch (error) {
      logServerError('support.ticket.list.failed', error, { userId: req.user?.id });
      return res.status(500).json({ error: 'Não foi possível carregar seus atendimentos.' });
    }
  });

  app.post('/api/support/tickets', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (hasClientSuppliedIdentity(req.body)) return res.status(400).json({ error: 'Identidade do cliente ou autor não pode ser informada.' });
      if (!validSubject(req.body?.subject)) return res.status(400).json({ error: 'Assunto inválido.' });
      const body = validatedMessage(req.body?.body);
      if (!body) return res.status(400).json({ error: 'A mensagem é obrigatória e deve ter até 4000 caracteres.' });

      let orderId: number | null = null;
      if (req.body?.orderId !== undefined && req.body?.orderId !== null && req.body?.orderId !== '') {
        orderId = positiveId(req.body.orderId);
        if (!orderId) return res.status(400).json({ error: 'Pedido relacionado inválido.' });
        const [ownedOrder] = await db.select({ id: schema.orders.id }).from(schema.orders)
          .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, req.user!.id)));
        if (!ownedOrder) return res.status(400).json({ error: 'Pedido relacionado inválido.' });
      }

      const now = new Date();
      const created = await db.transaction(async (tx) => {
        const [ticket] = await tx.insert(schema.supportTickets).values({
          userId: req.user!.id,
          orderId,
          subject: req.body.subject,
          status: 'OPEN',
          createdAt: now,
          updatedAt: now,
        }).returning();
        await tx.insert(schema.supportMessages).values({ ticketId: ticket.id, authorUserId: req.user!.id, body, createdAt: now });
        await tx.insert(schema.adminNotifications).values({
          type: 'SUPPORT_TICKET', customerId: req.user!.id, orderId: null, addressId: null,
          title: `Novo atendimento #${ticket.id}`,
          message: 'Um atendimento foi aberto na Central de Ajuda.',
          isRead: false, popupDismissed: false, createdAt: now,
        });
        return ticket;
      });
      logServerEvent('support.ticket.created', 'info', { ticketId: created.id, userId: req.user!.id, orderId: created.orderId, toStatus: created.status, result: 'committed' });
      return res.status(201).json({ ticket: await customerTicketDetail(created) });
    } catch (error) {
      logServerError('support.ticket.create.failed', error, { userId: req.user?.id });
      return res.status(500).json({ error: 'Não foi possível abrir o atendimento.' });
    }
  });

  app.get('/api/support/tickets/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      if (!ticket || ticket.userId !== req.user!.id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      return res.json({ ticket: await customerTicketDetail(ticket) });
    } catch (error) {
      logServerError('support.ticket.detail.failed', error, { userId: req.user?.id, ticketId: positiveId(req.params.id) ?? undefined });
      return res.status(500).json({ error: 'Não foi possível carregar o atendimento.' });
    }
  });

  app.post('/api/support/tickets/:id/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (hasClientSuppliedIdentity(req.body)) return res.status(400).json({ error: 'O autor da mensagem é definido pela sessão autenticada.' });
      const body = validatedMessage(req.body?.body);
      if (!body) return res.status(400).json({ error: 'A mensagem é obrigatória e deve ter até 4000 caracteres.' });
      const id = positiveId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      if (!ticket || ticket.userId !== req.user!.id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return res.status(409).json({ error: 'Este atendimento não aceita novas mensagens.' });

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(schema.supportMessages).values({ ticketId: id, authorUserId: req.user!.id, body, createdAt: now });
        await tx.update(schema.supportTickets).set({ status: 'IN_PROGRESS', updatedAt: now }).where(eq(schema.supportTickets.id, id));
        await tx.insert(schema.adminNotifications).values({
          type: 'SUPPORT_MESSAGE', customerId: req.user!.id, orderId: null, addressId: null,
          title: `Nova mensagem no atendimento #${id}`,
          message: 'Uma nova mensagem foi recebida na Central de Ajuda.',
          isRead: false, popupDismissed: false, createdAt: now,
        });
      });
      const [updated] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      logServerEvent('support.message.sent', 'info', { ticketId: id, userId: req.user!.id, role: 'CUSTOMER', fromStatus: ticket.status, toStatus: updated?.status || 'IN_PROGRESS', result: 'committed' });
      return res.status(201).json({ ticket: await customerTicketDetail(updated) });
    } catch (error) {
      logServerError('support.message.send.failed', error, { userId: req.user?.id, ticketId: positiveId(req.params.id) ?? undefined });
      return res.status(500).json({ error: 'Não foi possível enviar a mensagem.' });
    }
  });

  app.post('/api/support/tickets/:id/close', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      if (!ticket || ticket.userId !== req.user!.id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      if (ticket.status !== 'RESOLVED') return res.status(409).json({ error: 'Somente um atendimento resolvido pode ser encerrado.' });
      const now = new Date();
      const [closed] = await db.update(schema.supportTickets).set({ status: 'CLOSED', closedAt: now, updatedAt: now })
        .where(eq(schema.supportTickets.id, id)).returning();
      logServerEvent('support.ticket.status_changed', 'info', { ticketId: id, userId: req.user!.id, fromStatus: ticket.status, toStatus: 'CLOSED', result: 'committed' });
      return res.json({ ticket: await customerTicketDetail(closed) });
    } catch (error) {
      logServerError('support.ticket.close.failed', error, { userId: req.user?.id, ticketId: positiveId(req.params.id) ?? undefined });
      return res.status(500).json({ error: 'Não foi possível encerrar o atendimento.' });
    }
  });

  app.get('/api/admin/support/tickets', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'ALL';
      if (status !== 'ALL' && !validStatus(status)) return res.status(400).json({ error: 'Status inválido.' });
      const subject = typeof req.query.subject === 'string' ? req.query.subject : 'ALL';
      if (subject !== 'ALL' && !validSubject(subject)) return res.status(400).json({ error: 'Assunto inválido.' });
      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const pageSize = Math.max(1, Math.min(MAX_TICKETS_PER_PAGE, Number(req.query.pageSize) || 25));
      const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const filters = [];
      if (status !== 'ALL') filters.push(eq(schema.supportTickets.status, status));
      if (subject !== 'ALL') filters.push(eq(schema.supportTickets.subject, subject));
      if (query) {
        const pattern = `%${query}%`;
        filters.push(or(ilike(schema.users.name, pattern), ilike(schema.users.email, pattern), ilike(schema.supportTickets.subject, pattern), sql`${schema.supportTickets.id}::text ILIKE ${pattern}`)!);
      }
      const where = filters.length ? and(...filters) : undefined;
      const [countRows, rows] = await Promise.all([
        db.select({ total: count() }).from(schema.supportTickets).innerJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id)).where(where),
        db.select({
          id: schema.supportTickets.id, userId: schema.supportTickets.userId, orderId: schema.supportTickets.orderId,
          subject: schema.supportTickets.subject, status: schema.supportTickets.status,
          createdAt: schema.supportTickets.createdAt, updatedAt: schema.supportTickets.updatedAt, closedAt: schema.supportTickets.closedAt,
          customerName: schema.users.name, customerEmail: schema.users.email,
        }).from(schema.supportTickets).innerJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id))
          .where(where).orderBy(desc(schema.supportTickets.updatedAt), desc(schema.supportTickets.id)).limit(pageSize).offset((page - 1) * pageSize),
      ]);
      const total = Number(countRows[0]?.total || 0);
      const orderIds = rows.map((row) => row.orderId).filter((id): id is number => id !== null);
      const orders = orderIds.length ? await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status }).from(schema.orders).where(inArray(schema.orders.id, orderIds)) : [];
      const orderById = new Map(orders.map((order) => [order.id, order]));
      return res.json({
        tickets: rows.map((row) => ({ ...row, order: row.orderId ? orderById.get(row.orderId) || null : null })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch (error) {
      logServerError('support.admin_ticket.list.failed', error, { adminId: req.user?.id, role: req.user?.role });
      return res.status(500).json({ error: 'Não foi possível carregar os atendimentos.' });
    }
  });

  app.get('/api/admin/support/tickets/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const [ticket] = await db.select({
        id: schema.supportTickets.id, userId: schema.supportTickets.userId, orderId: schema.supportTickets.orderId,
        subject: schema.supportTickets.subject, status: schema.supportTickets.status,
        createdAt: schema.supportTickets.createdAt, updatedAt: schema.supportTickets.updatedAt, closedAt: schema.supportTickets.closedAt,
        customerName: schema.users.name, customerEmail: schema.users.email,
      }).from(schema.supportTickets).innerJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id))
        .where(eq(schema.supportTickets.id, id));
      if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const [order, messages] = await Promise.all([
        ticketOrderSummary(ticket.orderId),
        ticketMessages(id),
      ]);
      return res.json({ ticket: { ...ticket, order, messages } });
    } catch (error) {
      logServerError('support.admin_ticket.detail.failed', error, { adminId: req.user?.id, role: req.user?.role, ticketId: positiveId(req.params.id) ?? undefined });
      return res.status(500).json({ error: 'Não foi possível carregar o atendimento.' });
    }
  });

  app.post('/api/admin/support/tickets/:id/messages', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      if (hasClientSuppliedIdentity(req.body)) return res.status(400).json({ error: 'O autor da mensagem é definido pela sessão autenticada.' });
      const body = validatedMessage(req.body?.body);
      if (!body) return res.status(400).json({ error: 'A mensagem é obrigatória e deve ter até 4000 caracteres.' });
      const id = positiveId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      if (ticket.status === 'CLOSED') return res.status(409).json({ error: 'Este atendimento está encerrado.' });
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(schema.supportMessages).values({ ticketId: id, authorUserId: req.user!.id, body, createdAt: now });
        await tx.update(schema.supportTickets).set({ status: 'WAITING_CUSTOMER', updatedAt: now, closedAt: null }).where(eq(schema.supportTickets.id, id));
      });
      const [updated] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      logServerEvent('support.message.sent', 'info', { ticketId: id, adminId: req.user!.id, role: req.user!.role, fromStatus: ticket.status, toStatus: updated?.status || 'WAITING_CUSTOMER', result: 'committed' });
      return res.status(201).json({ ticket: await customerTicketDetail(updated) });
    } catch (error) {
      logServerError('support.admin_message.send.failed', error, { adminId: req.user?.id, role: req.user?.role, ticketId: positiveId(req.params.id) ?? undefined });
      return res.status(500).json({ error: 'Não foi possível enviar a resposta.' });
    }
  });

  app.patch('/api/admin/support/tickets/:id/status', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      if (!validStatus(req.body?.status)) return res.status(400).json({ error: 'Status inválido.' });
      const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      const status = req.body.status;
      const previousStatus = ticket.status;
      if (ticket.status !== status) {
        const now = new Date();
        await db.update(schema.supportTickets).set({ status, closedAt: status === 'CLOSED' ? now : null, updatedAt: now })
          .where(eq(schema.supportTickets.id, id));
        await audit(req, 'SUPPORT_TICKET_STATUS_CHANGED', 'SUPPORT_TICKET', id, { previousStatus: ticket.status, status });
        logServerEvent('support.ticket.status_changed', 'info', { ticketId: id, adminId: req.user!.id, role: req.user!.role, fromStatus: previousStatus, toStatus: status, result: 'committed' });
      }
      const [updated] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id));
      return res.json({ ticket: await customerTicketDetail(updated) });
    } catch (error) {
      logServerError('support.ticket.status_change.failed', error, { adminId: req.user?.id, role: req.user?.role, ticketId: positiveId(req.params.id) ?? undefined });
      return res.status(500).json({ error: 'Não foi possível alterar o status do atendimento.' });
    }
  });
}
