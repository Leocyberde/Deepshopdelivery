import { Express } from 'express';
import bcrypt from 'bcryptjs';
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { logServerError } from '../logger.ts';
import { ALL_PERMISSIONS, ADMIN_ROLES } from '../governance.ts';
import { randomInt } from 'crypto';
import { triggerAutoSnapshot, SNAPSHOT_FILE_PATH, getBackupStatus } from '../../db/backup.ts';
import fs from 'fs';

const MAX_PAGE_SIZE = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pageParams(query: any) {
  const page = Number.isSafeInteger(Number(query.page)) && Number(query.page) > 0 ? Number(query.page) : 1;
  const pageSize = Number.isSafeInteger(Number(query.pageSize)) && Number(query.pageSize) > 0
    ? Math.min(MAX_PAGE_SIZE, Number(query.pageSize)) : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function dateParam(value: unknown, end = false): Date | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requestId(req: any): string | null {
  return typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 80) : null;
}

function safeDetails(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const forbidden = /password|hash|token|secret|api.?key|jwt|cpf/i;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.test(key)) continue;
    if (typeof raw === 'string' && (raw.length > 500 || forbidden.test(raw))) continue;
    if (typeof raw === 'number' || typeof raw === 'boolean' || raw === null || typeof raw === 'string') result[key] = raw;
  }
  return result;
}

export async function audit(req: AuthRequest, action: string, entityType: string, entityId: string | number | null, details?: unknown, result = 'SUCCESS') {
  if (!req.user) return;
  try {
    await db.insert(schema.adminAuditLogs).values({
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: action.slice(0, 120),
      entityType: entityType.slice(0, 80),
      entityId: entityId == null ? null : String(entityId).slice(0, 120),
      result: result.slice(0, 40),
      details: safeDetails(details),
      requestId: requestId(req),
    });
  } catch (error) {
    logServerError('admin_audit_write_failed', error);
  }
}

export function registerAdminPhase3Routes(app: Express) {
  app.get('/api/admin/phase3/finance', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const from = dateParam(req.query.from);
      const to = dateParam(req.query.to, true);
      if (req.query.from && !from) return res.status(400).json({ error: 'Data inicial inválida.' });
      if (req.query.to && !to) return res.status(400).json({ error: 'Data final inválida.' });
      if (from && to && from > to) return res.status(400).json({ error: 'Período inválido.' });
      const status = typeof req.query.status === 'string' ? req.query.status : 'ALL';
      const allowedStatuses = ['ALL', 'NEW', 'AWAITING_PAYMENT', 'PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
      if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
      const { page, pageSize, offset } = pageParams(req.query);
      const filters: any[] = [];
      if (from) filters.push(gte(schema.orders.createdAt, from));
      if (to) filters.push(lte(schema.orders.createdAt, to));
      if (status !== 'ALL') filters.push(eq(schema.orders.status, status));
      // Regra documentada: cancelados só entram quando o filtro explícito for CANCELLED.
      if (status === 'ALL') filters.push(sql`${schema.orders.status} <> 'CANCELLED'`);
      const where = filters.length ? and(...filters) : undefined;
      const [countRows, summaryRows, productRows, costRows] = await Promise.all([
        db.select({ value: count() }).from(schema.orders).where(where),
        db.select({
          ordersCount: count(schema.orders.id),
          grossRevenue: sql<string>`COALESCE(SUM(${schema.orders.subtotal}), 0)`,
          freightRevenue: sql<string>`COALESCE(SUM(${schema.orders.deliveryFee}), 0)`,
          totalRevenue: sql<string>`COALESCE(SUM(${schema.orders.total}), 0)`,
        }).from(schema.orders).where(where),
        db.select({
          productId: schema.orderItems.productId,
          productName: schema.orderItems.productName,
          quantity: sql<string>`COALESCE(SUM(${schema.orderItems.quantity}), 0)`,
          revenue: sql<string>`COALESCE(SUM(${schema.orderItems.subtotal}), 0)`,
          knownCost: sql<string>`SUM(CASE WHEN ${schema.orderItems.unitCost} IS NOT NULL THEN ${schema.orderItems.unitCost} * ${schema.orderItems.quantity} ELSE 0 END)`,
          unknownQuantity: sql<string>`COALESCE(SUM(CASE WHEN ${schema.orderItems.unitCost} IS NULL THEN ${schema.orderItems.quantity} ELSE 0 END), 0)`,
        }).from(schema.orderItems)
          .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
          .where(where)
          .groupBy(schema.orderItems.productId, schema.orderItems.productName)
          .orderBy(desc(sql`SUM(${schema.orderItems.subtotal})`))
          .limit(pageSize).offset(offset),
        db.select({
          knownCost: sql<string>`SUM(CASE WHEN ${schema.orderItems.unitCost} IS NOT NULL THEN ${schema.orderItems.unitCost} * ${schema.orderItems.quantity} ELSE 0 END)`,
          unknownQuantity: sql<string>`COALESCE(SUM(CASE WHEN ${schema.orderItems.unitCost} IS NULL THEN ${schema.orderItems.quantity} ELSE 0 END), 0)`,
        }).from(schema.orderItems)
          .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
          .where(where),
      ]);
      const summary = summaryRows[0] || {};
      const ordersCount = Number(summary.ordersCount || 0);
      const totalRevenue = Number(Number(summary.totalRevenue || 0).toFixed(2));
      const productRanking = productRows.map((row) => {
        const revenue = Number(Number(row.revenue || 0).toFixed(2));
        const unknownQuantity = Number(row.unknownQuantity || 0);
        const cost = Number(Number(row.knownCost || 0).toFixed(2));
        const costStatus = unknownQuantity > 0 ? (cost > 0 ? 'INCOMPLETE' : 'UNKNOWN') : 'KNOWN';
        return { productId: row.productId, productName: row.productName, quantity: Number(row.quantity || 0), revenue, cost: costStatus === 'KNOWN' ? cost : null, knownCost: cost, unknownQuantity, costStatus, estimatedProfit: costStatus === 'KNOWN' ? Number((revenue - cost).toFixed(2)) : null };
      });
      const unknownCostQuantity = Number(costRows[0]?.unknownQuantity || 0);
      const knownCostTotal = Number(Number(costRows[0]?.knownCost || 0).toFixed(2));
      await audit(req, 'VIEW_FINANCE_REPORT', 'FINANCE_REPORT', null, { status, from: req.query.from || null, to: req.query.to || null });
      return res.json({
        methodology: 'Pedidos cancelados são excluídos por padrão; custos usam order_items.unit_cost histórico e margem é estimativa, não contabilidade oficial.',
        filters: { from: req.query.from || null, to: req.query.to || null, status },
        summary: { ordersCount, grossRevenue: Number(Number(summary.grossRevenue || 0).toFixed(2)), freightRevenue: Number(Number(summary.freightRevenue || 0).toFixed(2)), totalRevenue, averageTicket: ordersCount ? Number((totalRevenue / ordersCount).toFixed(2)) : 0, costStatus: unknownCostQuantity > 0 ? 'INCOMPLETE' : 'KNOWN', unknownCostQuantity, knownCost: knownCostTotal, estimatedProfit: unknownCostQuantity > 0 ? null : Number((totalRevenue - knownCostTotal).toFixed(2)) },
        products: { rows: productRanking, page, pageSize, totalCount: Number(countRows[0]?.value || 0), totalPages: Math.ceil(Number(countRows[0]?.value || 0) / pageSize) },
      });
    } catch (error) {
      logServerError('admin_phase3_finance_failed', error);
      return res.status(500).json({ error: 'Não foi possível carregar o relatório financeiro.' });
    }
  });

  app.get('/api/admin/phase3/notifications', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { page, pageSize, offset } = pageParams(req.query);
      const filters: any[] = [];
      if (typeof req.query.type === 'string' && req.query.type !== 'ALL') filters.push(eq(schema.adminNotifications.type, req.query.type));
      if (req.query.read === 'true') filters.push(eq(schema.adminNotifications.isRead, true));
      if (req.query.read === 'false') filters.push(eq(schema.adminNotifications.isRead, false));
      const from = dateParam(req.query.from); const to = dateParam(req.query.to, true);
      if (req.query.from && !from) return res.status(400).json({ error: 'Data inicial inválida.' });
      if (req.query.to && !to) return res.status(400).json({ error: 'Data final inválida.' });
      if (from) filters.push(gte(schema.adminNotifications.createdAt, from));
      if (to) filters.push(lte(schema.adminNotifications.createdAt, to));
      const where = filters.length ? and(...filters) : undefined;
      const [totalRows, unreadRows, rows] = await Promise.all([
        db.select({ value: count() }).from(schema.adminNotifications).where(where),
        db.select({ value: count() }).from(schema.adminNotifications).where(and(eq(schema.adminNotifications.isRead, false))),
        db.select().from(schema.adminNotifications).where(where).orderBy(desc(schema.adminNotifications.id)).limit(pageSize).offset(offset),
      ]);
      return res.json({ notifications: rows, unreadCount: Number(unreadRows[0]?.value || 0), page, pageSize, totalCount: Number(totalRows[0]?.value || 0), totalPages: Math.ceil(Number(totalRows[0]?.value || 0) / pageSize) });
    } catch (error) {
      logServerError('admin_phase3_notifications_failed', error);
      return res.status(500).json({ error: 'Não foi possível carregar as notificações.' });
    }
  });

  app.put('/api/admin/phase3/notifications/:id/read', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Notificação inválida.' });
      await db.update(schema.adminNotifications).set({ isRead: true, popupDismissed: true }).where(eq(schema.adminNotifications.id, id));
      await audit(req, 'MARK_NOTIFICATION_READ', 'ADMIN_NOTIFICATION', id);
      return res.json({ success: true });
    } catch (error) { logServerError('admin_phase3_notification_read_failed', error); return res.status(500).json({ error: 'Não foi possível atualizar a notificação.' }); }
  });

  app.put('/api/admin/phase3/notifications/read-all', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try { await db.update(schema.adminNotifications).set({ isRead: true, popupDismissed: true }).where(eq(schema.adminNotifications.isRead, false)); await audit(req, 'MARK_ALL_NOTIFICATIONS_READ', 'ADMIN_NOTIFICATION', null); return res.json({ success: true }); }
    catch (error) { logServerError('admin_phase3_notifications_read_all_failed', error); return res.status(500).json({ error: 'Não foi possível atualizar as notificações.' }); }
  });

  app.post('/api/admin/phase3/notifications/event', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const eventKey = typeof req.body?.eventKey === 'string' ? req.body.eventKey.trim().slice(0, 160) : '';
      const type = typeof req.body?.type === 'string' ? req.body.type.trim().slice(0, 80) : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
      const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
      if (!eventKey || !type || !title || !message) return res.status(400).json({ error: 'Evento de notificação inválido.' });
      const result = await db.transaction(async (tx) => {
        const [key] = await tx.insert(schema.adminEventKeys).values({ eventKey, eventType: type }).onConflictDoNothing().returning();
        if (!key) return { duplicate: true, notification: null };
        const [notification] = await tx.insert(schema.adminNotifications).values({ type, title, message, customerId: null, orderId: null, addressId: null, isRead: false, popupDismissed: false }).returning();
        return { duplicate: false, notification };
      });
      await audit(req, result.duplicate ? 'RETRY_NOTIFICATION_EVENT' : 'CREATE_NOTIFICATION_EVENT', 'ADMIN_NOTIFICATION', result.notification?.id || eventKey, { type, duplicate: result.duplicate });
      return res.status(result.duplicate ? 200 : 201).json({ ...result, idempotent: true });
    } catch (error) { logServerError('admin_phase3_notification_event_failed', error); return res.status(500).json({ error: 'Não foi possível processar o evento.' }); }
  });

  app.get('/api/admin/phase3/audit', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { page, pageSize, offset } = pageParams(req.query); const filters: any[] = [];
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
      if (search) filters.push(or(ilike(schema.adminAuditLogs.action, `%${search}%`), ilike(schema.adminAuditLogs.entityType, `%${search}%`), ilike(schema.adminAuditLogs.actorEmail, `%${search}%`)));
      if (typeof req.query.entityType === 'string' && req.query.entityType) filters.push(eq(schema.adminAuditLogs.entityType, req.query.entityType));
      const from = dateParam(req.query.from); const to = dateParam(req.query.to, true);
      if (req.query.from && !from) return res.status(400).json({ error: 'Data inicial inválida.' });
      if (req.query.to && !to) return res.status(400).json({ error: 'Data final inválida.' });
      if (from) filters.push(gte(schema.adminAuditLogs.createdAt, from)); if (to) filters.push(lte(schema.adminAuditLogs.createdAt, to));
      const where = filters.length ? and(...filters) : undefined;
      const [totalRows, rows] = await Promise.all([
        db.select({ value: count() }).from(schema.adminAuditLogs).where(where),
        db.select().from(schema.adminAuditLogs).where(where).orderBy(desc(schema.adminAuditLogs.id)).limit(pageSize).offset(offset),
      ]);
      return res.json({ logs: rows, page, pageSize, totalCount: Number(totalRows[0]?.value || 0), totalPages: Math.ceil(Number(totalRows[0]?.value || 0) / pageSize) });
    } catch (error) { logServerError('admin_phase3_audit_failed', error); return res.status(500).json({ error: 'Não foi possível carregar a auditoria.' }); }
  });

  app.get('/api/admin/phase3/administrators', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const admins = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, phone: schema.users.phone, status: schema.users.status, createdAt: schema.users.createdAt, updatedAt: schema.users.updatedAt }).from(schema.users).where(sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`).orderBy(asc(schema.users.name));
      return res.json({ administrators: admins, activeCount: admins.filter((a) => a.status === 'ACTIVE').length });
    } catch (error) { logServerError('admin_phase3_admin_list_failed', error); return res.status(500).json({ error: 'Não foi possível carregar os administradores.' }); }
  });

  app.post('/api/admin/phase3/administrators', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '00000000000';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const role = typeof req.body?.role === 'string' && ADMIN_ROLES.includes(req.body.role) && req.body.role !== 'ADMIN' ? req.body.role : 'SUPER_ADMIN';
      if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128 || password.toLowerCase() === 'admin123') return res.status(400).json({ error: 'Nome, e-mail ou credencial inválidos. A senha deve ter 10 a 128 caracteres.' });
      const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (existing) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
      const [created] = await db.insert(schema.users).values({ name, email, phone: phone.slice(0, 30), passwordHash: await bcrypt.hash(password, 10), role, status: 'ACTIVE' }).returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email, status: schema.users.status });
      await audit(req, 'CREATE_ADMINISTRATOR', 'USER', created.id, { email: created.email, status: created.status });
      return res.status(201).json({ administrator: created });
    } catch (error) { logServerError('admin_phase3_admin_create_failed', error); return res.status(500).json({ error: 'Não foi possível criar o administrador.' }); }
  });

  app.patch('/api/admin/phase3/administrators/:id/status', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id); const status = req.body?.status;
      if (!Number.isSafeInteger(id) || id <= 0 || !['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'Administrador ou estado inválido.' });
      const updated = await db.transaction(async (tx) => {
        // Serializa todas as mudanças de estado de administradores no mesmo banco.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(834201)`);
        const [target] = await tx.select().from(schema.users).where(and(eq(schema.users.id, id), sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`)).limit(1);
        if (!target) throw Object.assign(new Error('Administrador não encontrado.'), { statusCode: 404 });
        if (status === 'INACTIVE' && target.status === 'ACTIVE') {
          const activeRows = await tx.select({ value: count() }).from(schema.users).where(and(sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`, eq(schema.users.status, 'ACTIVE')));
          if (Number(activeRows[0]?.value || 0) <= 1) throw Object.assign(new Error('O último administrador ativo não pode ser desativado.'), { statusCode: 409 });
        }
        const [row] = await tx.update(schema.users).set({ status, updatedAt: new Date() }).where(and(eq(schema.users.id, id), sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`)).returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email, status: schema.users.status });
        return row;
      });
      await audit(req, status === 'ACTIVE' ? 'ACTIVATE_ADMINISTRATOR' : 'DEACTIVATE_ADMINISTRATOR', 'USER', id, { status });
      return res.json({ administrator: updated });
    } catch (error: any) { if (error?.statusCode === 404) return res.status(404).json({ error: 'Administrador não encontrado.' }); if (error?.statusCode === 409) return res.status(409).json({ error: 'O último administrador ativo não pode ser desativado.' }); logServerError('admin_phase3_admin_status_failed', error); return res.status(500).json({ error: 'Não foi possível alterar o estado do administrador.' }); }
  });

  app.patch('/api/admin/phase3/administrators/:id/role', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id); const role = String(req.body?.role || '');
      if (!Number.isSafeInteger(id) || !['SUPER_ADMIN','GERENTE','OPERADOR'].includes(role)) return res.status(400).json({ error: 'Papel inválido.' });
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(834201)`);
        const [target] = await tx.select().from(schema.users).where(and(eq(schema.users.id,id), sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`));
        if (!target) throw Object.assign(new Error('Administrador não encontrado.'), { statusCode: 404 });
        if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
          const [n] = await tx.select({ value: count() }).from(schema.users).where(and(sql`role IN ('ADMIN','SUPER_ADMIN')`, eq(schema.users.status,'ACTIVE')));
          if (Number(n?.value || 0) <= 1) throw Object.assign(new Error('O último SUPER_ADMIN ativo não pode perder o papel.'), { statusCode: 409 });
        }
        const [updated] = await tx.update(schema.users).set({ role, permissions: null, updatedAt: new Date() }).where(eq(schema.users.id,id)).returning({id:schema.users.id,name:schema.users.name,email:schema.users.email,role:schema.users.role,status:schema.users.status});
        return updated;
      });
      await audit(req,'CHANGE_ADMIN_ROLE','USER',id,{role}); return res.json({ administrator: result });
    } catch (e:any) { if(e?.statusCode===404) return res.status(404).json({error:'Administrador não encontrado.'}); if(e?.statusCode===409) return res.status(409).json({error:e.message}); logServerError('admin_role_change_failed',e); return res.status(500).json({error:'Não foi possível alterar o papel.'}); }
  });
  app.patch('/api/admin/phase3/administrators/:id/permissions', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id=Number(req.params.id); const permissions=req.body?.permissions;
      if(!Number.isSafeInteger(id)||!Array.isArray(permissions)||permissions.some((x:any)=>!ALL_PERMISSIONS.includes(x))) return res.status(400).json({error:'Permissões inválidas.'});
      const [target]=await db.select().from(schema.users).where(and(eq(schema.users.id,id),sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`));
      if(!target) return res.status(404).json({error:'Administrador não encontrado.'});
      if(target.role==='SUPER_ADMIN' && permissions.length < ALL_PERMISSIONS.length) return res.status(409).json({error:'SUPER_ADMIN deve manter todas as permissões.'});
      const [updated]=await db.update(schema.users).set({permissions:JSON.stringify([...new Set(permissions)]),updatedAt:new Date()}).where(eq(schema.users.id,id)).returning({id:schema.users.id,role:schema.users.role,permissions:schema.users.permissions});
      await audit(req,'CHANGE_ADMIN_PERMISSIONS','USER',id,{permissionCount:permissions.length}); return res.json({administrator:updated});
    } catch(e){ logServerError('admin_permissions_change_failed',e); return res.status(500).json({error:'Não foi possível alterar as permissões.'}); }
  });
  app.post('/api/admin/phase3/administrators/:id/reset-code', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try { const id=Number(req.params.id); const [target]=await db.select().from(schema.users).where(and(eq(schema.users.id,id),sql`role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR')`)); if(!target) return res.status(404).json({error:'Administrador não encontrado.'}); const code=String(randomInt(0,1000000)).padStart(6,'0'); await db.update(schema.users).set({resetCodeHash:await bcrypt.hash(code,12),resetCodeExpiresAt:new Date(Date.now()+(Number(process.env.ADMIN_RESET_TTL_MS)||15*60*1000)),resetCodeAttempts:0,updatedAt:new Date()}).where(eq(schema.users.id,id)); await audit(req,'ISSUE_ADMIN_PASSWORD_RESET','USER',id,{expiresInMinutes:15}); return res.json({code,expiresInMinutes:15}); }
    catch(e){ logServerError('admin_reset_issue_failed',e); return res.status(500).json({error:'Não foi possível gerar o código.'}); }
  });

  app.get('/api/admin/phase3/operations', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const snapshotExists = fs.existsSync(SNAPSHOT_FILE_PATH);
      const backupStatus = getBackupStatus();
      const [pendingLgpd, unreadNotifications, lowStock] = await Promise.all([
        db.select({ value: count() }).from(schema.users).where(and(eq(schema.users.role, 'CUSTOMER'), sql`${schema.users.deletionRequestedAt} IS NOT NULL`)),
        db.select({ value: count() }).from(schema.adminNotifications).where(eq(schema.adminNotifications.isRead, false)),
        db.select({ value: count() }).from(schema.products).where(and(eq(schema.products.status, 'ACTIVE'), sql`${schema.products.stock} <= ${schema.products.stockMinimum}`)),
      ]);
      return res.json({ backup: { ...backupStatus, snapshotExists, snapshotUpdatedAt: snapshotExists ? fs.statSync(SNAPSHOT_FILE_PATH).mtime.toISOString() : null, location: 'BACKUP_DIR privado; não exposto ao frontend' }, pendingLgpdRequests: Number(pendingLgpd[0]?.value || 0), unreadNotifications: Number(unreadNotifications[0]?.value || 0), lowStockProducts: Number(lowStock[0]?.value || 0), coverage: ['banco PostgreSQL', 'pedidos', 'ledger de estoque', 'notificações', 'configurações suportadas pelo snapshot'] });
    } catch (error) { logServerError('admin_phase3_operations_failed', error); return res.status(500).json({ error: 'Não foi possível consultar a operação.' }); }
  });

  app.post('/api/admin/phase3/backup', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try { triggerAutoSnapshot(); await audit(req, 'BACKUP_REQUESTED', 'BACKUP', null, { mode: 'scheduled_snapshot' }); return res.status(202).json({ accepted: true, message: 'Snapshot solicitado; será gravado no BACKUP_DIR privado após a janela de debounce.' }); }
    catch (error) { logServerError('admin_phase3_backup_failed', error); return res.status(500).json({ error: 'Não foi possível solicitar o backup.' }); }
  });
}
