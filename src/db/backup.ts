import { logServerError } from '../server/logger.ts';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import * as schema from './schema.ts';

import { BACKUP_DIR, SNAPSHOT_DIR, DAILY_DIR } from '../config/paths.ts';

// Cópia mais recente do snapshot (usada na subida, se o banco estiver vazio, e no status do painel).
export const SNAPSHOT_FILE_PATH = path.join(SNAPSHOT_DIR, 'achadinhos_snapshot_latest.json');
const SNAPSHOT_DEBOUNCE_MS = Number(process.env.BACKUP_DEBOUNCE_MS) || 60_000;
const SNAPSHOT_KEEP = 5;
const DAILY_KEEP_DAYS = 14;

function ensurePrivateDirectory(directory: string) {
  const projectRoot = path.resolve(process.cwd());
  const relative = path.relative(projectRoot, path.resolve(directory));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Diretório de backup deve ficar fora do diretório do projeto.');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Diretório de backup não pode ser um link simbólico.');
  fs.chmodSync(directory, 0o700);
}

function writePrivateFile(target: string, content: string) {
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* cleanup best-effort */ }
    throw error;
  }
}

export interface DatabaseBackupPayload {
  version: string;
  exportedAt: string;
  engine: 'PostgreSQL';
  tables: {
    stores: any[];
    users: any[];
    categories: any[];
    products: any[];
    productKitItems: any[];
    productImages: any[];
    addresses: any[];
    orders: any[];
    payments?: any[];
    supportTickets?: any[];
    supportMessages?: any[];
    orderItems: any[];
    orderStatusHistory: any[];
    productInteractions: any[];
    notifications: any[];
    adminNotifications: any[];
    inventoryMovements: any[];
    settings: any[];
    storedObjects: any[];
    adminAuditLogs: any[];
    adminEventKeys: any[];
    suppliers: any[];
    supplierPurchases: any[];
    orderFulfillments: any[];
    refunds: any[];
    refundItems: any[];
    delayNotices: any[];
    geoDistanceCache?: any[];
    geoApiUsage?: any[];
    geoLookupLog?: any[];
    freightLegacyRuns?: any[];
  };
}

export async function exportFullBackupJson(): Promise<DatabaseBackupPayload> {
  const [
    stores,
    users,
    categories,
    products,
    productKitItems,
    productImages,
    addresses,
    orders,
    payments,
    supportTickets,
    supportMessages,
    orderItems,
    orderStatusHistory,
    productInteractions,
    notifications,
    adminNotifications,
    inventoryMovements,
    settings,
    storedObjects,
    adminAuditLogs,
    adminEventKeys,
    suppliers,
    supplierPurchases,
    orderFulfillments,
    refunds,
    refundItems,
    delayNotices, geoDistanceCache, geoApiUsage, geoLookupLog, freightLegacyRuns,
  ] = await Promise.all([
    db.select().from(schema.stores),
    db.select().from(schema.users),
    db.select().from(schema.categories),
    db.select().from(schema.products),
    db.select().from(schema.productKitItems),
    db.select().from(schema.productImages),
    db.select().from(schema.addresses),
    db.select().from(schema.orders),
    db.select().from(schema.payments),
    db.select().from(schema.supportTickets),
    db.select().from(schema.supportMessages),
    db.select().from(schema.orderItems),
    db.select().from(schema.orderStatusHistory),
    db.select().from(schema.productInteractions),
    db.select().from(schema.notifications),
    db.select().from(schema.adminNotifications),
    db.select().from(schema.inventoryMovements),
    db.select().from(schema.settings),
    db.select().from(schema.storedObjects),
    db.select().from(schema.adminAuditLogs),
    db.select().from(schema.adminEventKeys),
    db.select().from(schema.suppliers),
    db.select().from(schema.supplierPurchases),
    db.select().from(schema.orderFulfillments),
    db.select().from(schema.refunds),
    db.select().from(schema.refundItems),
    db.select().from(schema.delayNotices),
    db.select().from(schema.geoDistanceCache), db.select().from(schema.geoApiUsage), db.select().from(schema.geoLookupLog), db.select().from(schema.freightLegacyRuns),
  ]);
  const safeUsers = users.map(({ resetCodeHash, resetCodeExpiresAt, resetCodeAttempts, ...user }) => user);

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    engine: 'PostgreSQL',
    tables: {
      stores,
      users: safeUsers,
      categories,
      products,
      productKitItems,
      productImages,
      addresses,
      orders,
      payments,
      supportTickets,
      supportMessages,
      orderItems,
      orderStatusHistory,
      productInteractions,
      notifications,
      adminNotifications,
      inventoryMovements,
      settings,
      storedObjects,
      adminAuditLogs,
      adminEventKeys,
      suppliers,
      supplierPurchases,
      orderFulfillments,
      refunds,
      refundItems,
      delayNotices, geoDistanceCache, geoApiUsage, geoLookupLog, freightLegacyRuns,
    },
  };
}

let snapshotTimeout: NodeJS.Timeout | null = null;
let lastBackupStatus: 'NEVER' | 'PENDING' | 'SUCCESS' | 'FAILURE' = 'NEVER';
let lastBackupAt: string | null = null;
let lastBackupError: string | null = null;
export function getBackupStatus() { return { status: lastBackupStatus, lastBackupAt, error: lastBackupError }; }

function pruneFiles(dir: string, prefix: string, keepFn: (files: string[]) => string[]) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
  for (const f of keepFn(files)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignora */
    }
  }
}

// Debounce de 60 s: várias alterações seguidas geram um único snapshot; mantém só os 5 últimos.
export function triggerAutoSnapshot() {
  lastBackupStatus = 'PENDING'; lastBackupError = null;
  if (snapshotTimeout) {
    clearTimeout(snapshotTimeout);
  }
  snapshotTimeout = setTimeout(async () => {
    try {
      ensurePrivateDirectory(BACKUP_DIR);
      ensurePrivateDirectory(SNAPSHOT_DIR);
      const payload = await exportFullBackupJson();
      const json = JSON.stringify(payload);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writePrivateFile(path.join(SNAPSHOT_DIR, `snapshot-${stamp}.json`), json);
      writePrivateFile(SNAPSHOT_FILE_PATH, json);
      pruneFiles(SNAPSHOT_DIR, 'snapshot-', (files) => files.slice(0, Math.max(0, files.length - SNAPSHOT_KEEP)));
      lastBackupStatus = 'SUCCESS'; lastBackupAt = new Date().toISOString();
    } catch (err) {
      lastBackupStatus = 'FAILURE'; lastBackupError = err instanceof Error ? err.name : 'BackupError';
      logServerError('backup_snapshot_failed', err);
    }
  }, SNAPSHOT_DEBOUNCE_MS);
}

// Backup diário em SQL, com retenção de 14 dias. Verifica de hora em hora e grava no máximo um por dia.
export async function runDailyBackupIfNeeded() {
  try {
    ensurePrivateDirectory(BACKUP_DIR);
    ensurePrivateDirectory(DAILY_DIR);
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(DAILY_DIR, `achadinhos-${today}.sql`);
    if (!fs.existsSync(target)) {
      const dump = await exportFullPostgresSqlDump();
      writePrivateFile(target, dump);
      lastBackupStatus = 'SUCCESS'; lastBackupAt = new Date().toISOString();
    }
    const limit = Date.now() - DAILY_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(DAILY_DIR)) {
      const full = path.join(DAILY_DIR, f);
      if (f.startsWith('achadinhos-') && f.endsWith('.sql') && fs.statSync(full).mtimeMs < limit) {
        fs.unlinkSync(full);
      }
    }
  } catch (err) {
    logServerError('server_operation_failed', err);
  }
}

export function startDailyBackup() {
  void runDailyBackupIfNeeded();
  setInterval(() => void runDailyBackupIfNeeded(), 60 * 60 * 1000).unref();
}

function sqlVal(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'object') {
    const jsonStr = JSON.stringify(val).replace(/'/g, "''");
    return `'${jsonStr}'::jsonb`;
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

export async function exportFullPostgresSqlDump(): Promise<string> {
  const data = await exportFullBackupJson();
  const migrationPath = path.join(process.cwd(), 'drizzle', '0000_achadinhos_production_schema.sql');
  const ddl = fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, 'utf-8')
    : '';

  const lines: string[] = [];
  lines.push('-- ============================================================================');
  lines.push(`-- DEEPSHOP DELIVERY — DUMP COMPLETO POSTGRESQL (MIGRAÇÃO + DADOS REAIS)`);
  lines.push(`-- Gerado em: ${data.exportedAt}`);
  lines.push('-- Como restaurar na sua VPS com PostgreSQL instalado:');
  lines.push('--   1. Crie o banco: createdb -U postgres achadinhos');
  lines.push('--   2. Importe este arquivo: psql -U postgres -d achadinhos -f achadinhos-postgresql-vps.sql');
  lines.push('-- ============================================================================');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');
  lines.push('-- 1. ESTRUTURA DE TABELAS E ÍNDICES (MIGRAÇÃO DDL)');
  lines.push(ddl);
  lines.push('');
  lines.push('-- 2. DADOS DAS TABELAS (UPSERT IDEMPOTENTE)');

  for (const s of data.tables.stores) {
    lines.push(
      `INSERT INTO stores (id, name, description, type, status, created_at, updated_at) VALUES (${sqlVal(s.id)}, ${sqlVal(s.name)}, ${sqlVal(s.description)}, ${sqlVal(s.type)}, ${sqlVal(s.status)}, ${sqlVal(s.createdAt)}, ${sqlVal(s.updatedAt)}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const u of data.tables.users) {
    lines.push(
      `INSERT INTO users (id, name, cpf, email, phone, password_hash, role, permissions, session_version, status, free_delivery_tickets, manual_free_delivery_tickets, must_change_password, privacy_version, privacy_accepted_at, terms_version, terms_accepted_at, deletion_requested_at, created_at, updated_at) VALUES (${sqlVal(u.id)}, ${sqlVal(u.name)}, ${sqlVal(u.cpf)}, ${sqlVal(u.email)}, ${sqlVal(u.phone)}, ${sqlVal(u.passwordHash)}, ${sqlVal(u.role)}, ${sqlVal(u.permissions ?? null)}, ${sqlVal(u.sessionVersion ?? 1)}, ${sqlVal(u.status)}, ${sqlVal(u.freeDeliveryTickets)}, ${sqlVal(u.manualFreeDeliveryTickets)}, ${sqlVal(u.mustChangePassword ?? false)}, ${sqlVal(u.privacyVersion ?? null)}, ${sqlVal(u.privacyAcceptedAt ?? null)}, ${sqlVal(u.termsVersion ?? null)}, ${sqlVal(u.termsAcceptedAt ?? null)}, ${sqlVal(u.deletionRequestedAt ?? null)}, ${sqlVal(u.createdAt)}, ${sqlVal(u.updatedAt)}) ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions, session_version = EXCLUDED.session_version, must_change_password = EXCLUDED.must_change_password, privacy_version = EXCLUDED.privacy_version, privacy_accepted_at = EXCLUDED.privacy_accepted_at, terms_version = EXCLUDED.terms_version, terms_accepted_at = EXCLUDED.terms_accepted_at, deletion_requested_at = EXCLUDED.deletion_requested_at, name = EXCLUDED.name, cpf = EXCLUDED.cpf, email = EXCLUDED.email, phone = EXCLUDED.phone, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = EXCLUDED.status, free_delivery_tickets = EXCLUDED.free_delivery_tickets, manual_free_delivery_tickets = EXCLUDED.manual_free_delivery_tickets, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const c of data.tables.categories) {
    lines.push(
      `INSERT INTO categories (id, store_id, name, description, status, created_at, updated_at) VALUES (${sqlVal(c.id)}, ${sqlVal(c.storeId)}, ${sqlVal(c.name)}, ${sqlVal(c.description)}, ${sqlVal(c.status)}, ${sqlVal(c.createdAt)}, ${sqlVal(c.updatedAt)}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const p of data.tables.products) {
    lines.push(
      `INSERT INTO products (id, store_id, category_id, code, name, description, price, promo_price, promo_active, promo_ends_at, promo_duration_hours, promo_max_units, is_kit, cost, cost_unit_precise, cost_lot_total, cost_lot_units, stock, weight, views_count, clicks_count, shares_count, stock_minimum, status, created_at, updated_at) VALUES (${sqlVal(p.id)}, ${sqlVal(p.storeId)}, ${sqlVal(p.categoryId)}, ${sqlVal(p.code)}, ${sqlVal(p.name)}, ${sqlVal(p.description)}, ${sqlVal(p.price)}, ${sqlVal(p.promoPrice)}, ${sqlVal(p.promoActive)}, ${sqlVal(p.promoEndsAt)}, ${sqlVal(p.promoDurationHours)}, ${sqlVal(p.promoMaxUnits)}, ${sqlVal(p.isKit)}, ${sqlVal(p.cost)}, ${sqlVal(p.costUnitPrecise ?? p.cost)}, ${sqlVal(p.costLotTotal ?? null)}, ${sqlVal(p.costLotUnits ?? null)}, ${sqlVal(p.stock)}, ${sqlVal(p.weight)}, ${sqlVal(p.viewsCount || 0)}, ${sqlVal(p.clicksCount || 0)}, ${sqlVal(p.sharesCount || 0)}, ${sqlVal(p.stockMinimum ?? 5)}, ${sqlVal(p.status)}, ${sqlVal(p.createdAt)}, ${sqlVal(p.updatedAt)}) ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id, code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price, promo_price = EXCLUDED.promo_price, promo_active = EXCLUDED.promo_active, promo_ends_at = EXCLUDED.promo_ends_at, promo_duration_hours = EXCLUDED.promo_duration_hours, promo_max_units = EXCLUDED.promo_max_units, is_kit = EXCLUDED.is_kit, cost = EXCLUDED.cost, cost_unit_precise = EXCLUDED.cost_unit_precise, cost_lot_total = EXCLUDED.cost_lot_total, cost_lot_units = EXCLUDED.cost_lot_units, stock = EXCLUDED.stock, weight = EXCLUDED.weight, views_count = EXCLUDED.views_count, clicks_count = EXCLUDED.clicks_count, shares_count = EXCLUDED.shares_count, stock_minimum = EXCLUDED.stock_minimum, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const k of data.tables.productKitItems) {
    lines.push(
      `INSERT INTO product_kit_items (id, kit_product_id, component_product_id, quantity_per_kit, created_at) VALUES (${sqlVal(k.id)}, ${sqlVal(k.kitProductId)}, ${sqlVal(k.componentProductId)}, ${sqlVal(k.quantityPerKit)}, ${sqlVal(k.createdAt)}) ON CONFLICT (id) DO UPDATE SET quantity_per_kit = EXCLUDED.quantity_per_kit;`
    );
  }

  for (const img of data.tables.productImages) {
    lines.push(
      `INSERT INTO product_images (id, product_id, image_url, media_type, duration_seconds, is_primary, created_at) VALUES (${sqlVal(img.id)}, ${sqlVal(img.productId)}, ${sqlVal(img.imageUrl)}, ${sqlVal(img.mediaType)}, ${sqlVal(img.durationSeconds)}, ${sqlVal(img.isPrimary)}, ${sqlVal(img.createdAt)}) ON CONFLICT (id) DO UPDATE SET image_url = EXCLUDED.image_url, media_type = EXCLUDED.media_type, duration_seconds = EXCLUDED.duration_seconds, is_primary = EXCLUDED.is_primary;`
    );
  }

  for (const a of data.tables.addresses) {
    lines.push(
      `INSERT INTO addresses (id, user_id, label, zip_code, street, number, complement, neighborhood, city, state, reference, is_primary, delivery_distance_km, delivery_fee, delivery_fee_status, delivery_fee_source, delivery_origin, delivery_notes, delivery_updated_by, delivery_updated_at, latitude, longitude, created_at, updated_at) VALUES (${sqlVal(a.id)}, ${sqlVal(a.userId)}, ${sqlVal(a.label)}, ${sqlVal(a.zipCode)}, ${sqlVal(a.street)}, ${sqlVal(a.number)}, ${sqlVal(a.complement)}, ${sqlVal(a.neighborhood)}, ${sqlVal(a.city)}, ${sqlVal(a.state)}, ${sqlVal(a.reference)}, ${sqlVal(a.isPrimary ?? false)}, ${sqlVal(a.deliveryDistanceKm)}, ${sqlVal(a.deliveryFee)}, ${sqlVal(a.deliveryFeeStatus)}, ${sqlVal(a.deliveryFeeSource)}, ${sqlVal(a.deliveryOrigin)}, ${sqlVal(a.deliveryNotes)}, ${sqlVal(a.deliveryUpdatedBy)}, ${sqlVal(a.deliveryUpdatedAt)}, ${sqlVal(a.latitude)}, ${sqlVal(a.longitude)}, ${sqlVal(a.createdAt)}, ${sqlVal(a.updatedAt)}) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, zip_code = EXCLUDED.zip_code, street = EXCLUDED.street, number = EXCLUDED.number, complement = EXCLUDED.complement, neighborhood = EXCLUDED.neighborhood, city = EXCLUDED.city, state = EXCLUDED.state, reference = EXCLUDED.reference, is_primary = EXCLUDED.is_primary, delivery_distance_km = EXCLUDED.delivery_distance_km, delivery_fee = EXCLUDED.delivery_fee, delivery_fee_status = EXCLUDED.delivery_fee_status, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const a of data.tables.addresses) lines.push(`UPDATE addresses SET delivery_cache_key=${sqlVal(a.deliveryCacheKey ?? null)}, delivery_in_area=${sqlVal(a.deliveryInArea ?? null)} WHERE id=${sqlVal(a.id)};`);
  for (const row of data.tables.geoDistanceCache || []) lines.push(`INSERT INTO geo_distance_cache(cache_key,origin_text,destination_text,distance_meters,duration_seconds,provider,hit_count,created_at,updated_at) VALUES(${sqlVal(row.cacheKey)},${sqlVal(row.originText)},${sqlVal(row.destinationText)},${sqlVal(row.distanceMeters)},${sqlVal(row.durationSeconds)},${sqlVal(row.provider)},${sqlVal(row.hitCount)},${sqlVal(row.createdAt)},${sqlVal(row.updatedAt)}) ON CONFLICT DO NOTHING;`);
  for (const row of data.tables.geoApiUsage || []) lines.push(`INSERT INTO geo_api_usage(month,calls) VALUES(${sqlVal(row.month)},${sqlVal(row.calls)}) ON CONFLICT(month) DO UPDATE SET calls=GREATEST(geo_api_usage.calls,EXCLUDED.calls);`);
  for (const row of data.tables.geoLookupLog || []) lines.push(`INSERT INTO geo_lookup_log(id,user_id,created_at) VALUES(${sqlVal(row.id)},${sqlVal(row.userId)},${sqlVal(row.createdAt)}) ON CONFLICT DO NOTHING;`);
  for (const row of data.tables.freightLegacyRuns || []) lines.push(`INSERT INTO freight_legacy_runs(id,actor_user_id,plan,created_at,executed_at,result) VALUES(${sqlVal(row.id)},${sqlVal(row.actorUserId)},${sqlVal(row.plan)},${sqlVal(row.createdAt)},${sqlVal(row.executedAt)},${sqlVal(row.result)}) ON CONFLICT DO NOTHING;`);

  for (const o of data.tables.orders) {
    lines.push(
      `INSERT INTO orders (id, order_number, user_id, store_id, subtotal, delivery_fee, delivery_distance_km, delivery_fee_source, total, payment_method, change_for, status, is_first_order_free_delivery, used_free_delivery_ticket, stock_deducted, payment_expires_at, delivered_at, reminder_sent_at, cancellation_reason, refund_requested, notes, address_snapshot, created_at, updated_at) VALUES (${sqlVal(o.id)}, ${sqlVal(o.orderNumber)}, ${sqlVal(o.userId)}, ${sqlVal(o.storeId)}, ${sqlVal(o.subtotal)}, ${sqlVal(o.deliveryFee)}, ${sqlVal(o.deliveryDistanceKm)}, ${sqlVal(o.deliveryFeeSource)}, ${sqlVal(o.total)}, ${sqlVal(o.paymentMethod ?? 'PIX')}, ${sqlVal(o.changeFor)}, ${sqlVal(o.status)}, ${sqlVal(o.isFirstOrderFreeDelivery)}, ${sqlVal(o.usedFreeDeliveryTicket)}, ${sqlVal(o.stockDeducted)}, ${sqlVal(o.paymentExpiresAt)}, ${sqlVal(o.deliveredAt)}, ${sqlVal(o.reminderSentAt)}, ${sqlVal(o.cancellationReason)}, ${sqlVal(o.refundRequested)}, ${sqlVal(o.notes)}, ${sqlVal(o.addressSnapshot)}, ${sqlVal(o.createdAt)}, ${sqlVal(o.updatedAt)}) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, stock_deducted = EXCLUDED.stock_deducted, delivered_at = EXCLUDED.delivered_at, reminder_sent_at = EXCLUDED.reminder_sent_at, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const ticket of data.tables.supportTickets || []) {
    lines.push(
      `INSERT INTO support_tickets (id, user_id, order_id, subject, status, created_at, updated_at, closed_at) VALUES (${sqlVal(ticket.id)}, ${sqlVal(ticket.userId)}, ${sqlVal(ticket.orderId)}, ${sqlVal(ticket.subject)}, ${sqlVal(ticket.status)}, ${sqlVal(ticket.createdAt)}, ${sqlVal(ticket.updatedAt)}, ${sqlVal(ticket.closedAt)}) ON CONFLICT (id) DO UPDATE SET order_id = EXCLUDED.order_id, subject = EXCLUDED.subject, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, closed_at = EXCLUDED.closed_at;`
    );
  }

  for (const message of data.tables.supportMessages || []) {
    lines.push(
      `INSERT INTO support_messages (id, ticket_id, author_user_id, body, created_at) VALUES (${sqlVal(message.id)}, ${sqlVal(message.ticketId)}, ${sqlVal(message.authorUserId)}, ${sqlVal(message.body)}, ${sqlVal(message.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const payment of data.tables.payments || []) {
    lines.push(
      `INSERT INTO payments (id, order_id, provider, external_reference, provider_order_id, provider_preference_id, provider_payment_id, idempotency_key, amount, currency, status, provider_status, checkout_url, created_at, updated_at) VALUES (${sqlVal(payment.id)}, ${sqlVal(payment.orderId)}, ${sqlVal(payment.provider)}, ${sqlVal(payment.externalReference)}, ${sqlVal(payment.providerOrderId)}, ${sqlVal(payment.providerPreferenceId)}, ${sqlVal(payment.providerPaymentId)}, ${sqlVal(payment.idempotencyKey)}, ${sqlVal(payment.amount)}, ${sqlVal(payment.currency)}, ${sqlVal(payment.status)}, ${sqlVal(payment.providerStatus)}, ${sqlVal(payment.checkoutUrl)}, ${sqlVal(payment.createdAt)}, ${sqlVal(payment.updatedAt)}) ON CONFLICT (id) DO UPDATE SET provider_order_id = EXCLUDED.provider_order_id, provider_preference_id = EXCLUDED.provider_preference_id, provider_payment_id = EXCLUDED.provider_payment_id, status = EXCLUDED.status, provider_status = EXCLUDED.provider_status, checkout_url = EXCLUDED.checkout_url, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const oi of data.tables.orderItems) {
    lines.push(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, unit_cost, created_at) VALUES (${sqlVal(oi.id)}, ${sqlVal(oi.orderId)}, ${sqlVal(oi.productId)}, ${sqlVal(oi.productName)}, ${sqlVal(oi.quantity)}, ${sqlVal(oi.unitPrice)}, ${sqlVal(oi.subtotal)}, ${sqlVal(oi.unitCost)}, ${sqlVal(oi.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const m of data.tables.inventoryMovements || []) {
    lines.push(
      `INSERT INTO inventory_movements (id, product_id, delta, before_stock, after_stock, movement_type, reason, actor_user_id, order_id, kit_product_id, idempotency_key, operation_result, created_at) VALUES (${sqlVal(m.id)}, ${sqlVal(m.productId)}, ${sqlVal(m.delta)}, ${sqlVal(m.beforeStock)}, ${sqlVal(m.afterStock)}, ${sqlVal(m.movementType)}, ${sqlVal(m.reason)}, ${sqlVal(m.actorUserId)}, ${sqlVal(m.orderId)}, ${sqlVal(m.kitProductId)}, ${sqlVal(m.idempotencyKey)}, ${sqlVal(m.operationResult)}, ${sqlVal(m.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const h of data.tables.orderStatusHistory) {
    lines.push(
      `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, created_at) VALUES (${sqlVal(h.id)}, ${sqlVal(h.orderId)}, ${sqlVal(h.oldStatus)}, ${sqlVal(h.newStatus)}, ${sqlVal(h.changedBy)}, ${sqlVal(h.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const pi of (data.tables.productInteractions || [])) {
    lines.push(
      `INSERT INTO product_interactions (id, product_id, type, visitor_id, user_id, created_at) VALUES (${sqlVal(pi.id)}, ${sqlVal(pi.productId)}, ${sqlVal(pi.type)}, ${sqlVal(pi.visitorId)}, ${sqlVal(pi.userId)}, ${sqlVal(pi.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const n of data.tables.notifications) {
    lines.push(
      `INSERT INTO notifications (id, user_id, order_id, order_number, old_status, new_status, title, message, is_read, popup_dismissed, created_at) VALUES (${sqlVal(n.id)}, ${sqlVal(n.userId)}, ${sqlVal(n.orderId)}, ${sqlVal(n.orderNumber)}, ${sqlVal(n.oldStatus)}, ${sqlVal(n.newStatus)}, ${sqlVal(n.title)}, ${sqlVal(n.message)}, ${sqlVal(n.isRead)}, ${sqlVal(n.popupDismissed)}, ${sqlVal(n.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const an of data.tables.adminNotifications) {
    lines.push(
      `INSERT INTO admin_notifications (id, type, customer_id, order_id, address_id, title, message, is_read, popup_dismissed, created_at) VALUES (${sqlVal(an.id)}, ${sqlVal(an.type)}, ${sqlVal(an.customerId)}, ${sqlVal(an.orderId)}, ${sqlVal(an.addressId)}, ${sqlVal(an.title)}, ${sqlVal(an.message)}, ${sqlVal(an.isRead)}, ${sqlVal(an.popupDismissed)}, ${sqlVal(an.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const st of data.tables.settings) {
    lines.push(
      `INSERT INTO settings (key, value, updated_at) VALUES (${sqlVal(st.key)}, ${sqlVal(st.value)}, ${sqlVal(st.updatedAt)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;`
    );
  }

  for (const obj of data.tables.storedObjects) {
    lines.push(
      `INSERT INTO stored_objects (key, mime_type, data_base64, created_at) VALUES (${sqlVal(obj.key)}, ${sqlVal(obj.mimeType)}, ${sqlVal(obj.dataBase64)}, ${sqlVal(obj.createdAt)}) ON CONFLICT (key) DO UPDATE SET mime_type = EXCLUDED.mime_type, data_base64 = EXCLUDED.data_base64;`
    );
  }

  // Auditoria e chaves de idempotência são append-only: preserva IDs/chaves e
  // não altera registros já existentes quando o dump é reaplicado.
  for (const log of data.tables.adminAuditLogs || []) {
    lines.push(
      `INSERT INTO admin_audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, result, details, request_id, created_at) VALUES (${sqlVal(log.id)}, ${sqlVal(log.actorUserId)}, ${sqlVal(log.actorEmail)}, ${sqlVal(log.action)}, ${sqlVal(log.entityType)}, ${sqlVal(log.entityId)}, ${sqlVal(log.result)}, ${sqlVal(log.details)}, ${sqlVal(log.requestId)}, ${sqlVal(log.createdAt)}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  for (const key of data.tables.adminEventKeys || []) {
    lines.push(
      `INSERT INTO admin_event_keys (event_key, event_type, created_at) VALUES (${sqlVal(key.eventKey)}, ${sqlVal(key.eventType)}, ${sqlVal(key.createdAt)}) ON CONFLICT (event_key) DO NOTHING;`
    );
  }

  lines.push('');
  lines.push('-- 3. SINCRONIZAÇÃO DE SEQUÊNCIAS (SERIAL ID)');
  const serialTables = [
    'stores',
    'users',
    'categories',
    'products',
    'product_kit_items',
    'product_images',
    'addresses',
    'orders',
    'payments',
    'support_tickets',
    'support_messages',
    'order_items',
    'order_status_history',
    'product_interactions',
    'notifications',
    'admin_notifications',
    'inventory_movements',
    'admin_audit_logs',
  ];
  for (const tbl of serialTables) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), (SELECT COUNT(*) > 0 FROM ${tbl}));`
    );
  }

  lines.push('');
  lines.push('COMMIT;');
  return lines.join('\n');
}

const toDate = (v: any): Date => (v ? new Date(v) : new Date());
const toNullableDate = (v: any): Date | null => (v ? new Date(v) : null);

export async function restoreFromBackupJson(payload: DatabaseBackupPayload): Promise<{
  productsRestored: number;
  categoriesRestored: number;
  usersRestored: number;
  ordersRestored: number;
  paymentsRestored: number;
  supportTicketsRestored: number;
  supportMessagesRestored: number;
}> {
  if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object' || Array.isArray(payload.tables)) {
    throw new Error('Arquivo de backup inválido: estrutura "tables" não encontrada.');
  }

  const t = payload.tables;
  const serializedSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (serializedSize > 80 * 1024 * 1024) throw new Error('Arquivo de backup excede o limite de 80 MB.');
  const tableNames = [
    'stores', 'users', 'categories', 'products', 'productKitItems', 'productImages', 'addresses', 'orders',
    'payments', 'supportTickets', 'supportMessages', 'orderItems', 'orderStatusHistory', 'productInteractions',
    'notifications', 'adminNotifications', 'inventoryMovements', 'settings', 'storedObjects', 'adminAuditLogs', 'adminEventKeys', 'suppliers', 'supplierPurchases', 'orderFulfillments', 'refunds', 'refundItems', 'delayNotices', 'geoDistanceCache', 'geoApiUsage', 'geoLookupLog', 'freightLegacyRuns',
  ] as const;
  for (const tableName of tableNames) {
    const rows = (t as any)[tableName];
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new Error(`Arquivo de backup inválido: tabela ${tableName} não é uma lista.`);
    }
  }

  const restoreResult = await db.transaction(async (tx) => {
    for (const s of t.stores || []) {
      await tx
        .insert(schema.stores)
        .values({
          id: s.id,
          name: s.name,
          description: s.description,
          type: s.type || 'OWN_STORE',
          status: s.status || 'ACTIVE',
          createdAt: toDate(s.createdAt),
          updatedAt: toDate(s.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.stores.id,
          set: {
            name: s.name,
            description: s.description,
            status: s.status || 'ACTIVE',
            updatedAt: toDate(s.updatedAt),
          },
        });
    }

    for (const u of t.users || []) {
      await tx
        .insert(schema.users)
        .values({
          id: u.id,
          name: u.name,
          cpf: u.cpf ?? null,
          email: u.email,
          phone: u.phone,
          passwordHash: u.passwordHash,
          role: u.role || 'CUSTOMER',
          // Backups anteriores à governança não tinham esta propriedade; nesse caso,
          // restaura-se NULL sem aplicar permissões padrão derivadas do cargo.
          permissions: u.permissions ?? null,
          sessionVersion: Number(u.sessionVersion || 1),
          status: u.status || 'ACTIVE',
          freeDeliveryTickets: Number(u.freeDeliveryTickets || 0),
          manualFreeDeliveryTickets: Number(u.manualFreeDeliveryTickets || 0),
          mustChangePassword: Boolean(u.mustChangePassword),
          privacyVersion: u.privacyVersion ?? null,
          privacyAcceptedAt: u.privacyAcceptedAt ? toDate(u.privacyAcceptedAt) : null,
          termsVersion: u.termsVersion ?? null,
          termsAcceptedAt: u.termsAcceptedAt ? toDate(u.termsAcceptedAt) : null,
          deletionRequestedAt: u.deletionRequestedAt ? toDate(u.deletionRequestedAt) : null,
          createdAt: toDate(u.createdAt),
          updatedAt: toDate(u.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.users.id,
          set: {
            name: u.name,
            cpf: u.cpf ?? null,
            email: u.email,
            phone: u.phone,
            passwordHash: u.passwordHash,
            role: u.role || 'CUSTOMER',
            // Quando presente, o valor do backup substitui integralmente o valor atual.
            permissions: u.permissions ?? null,
            sessionVersion: Number(u.sessionVersion || 1),
            status: u.status || 'ACTIVE',
            freeDeliveryTickets: Number(u.freeDeliveryTickets || 0),
            manualFreeDeliveryTickets: Number(u.manualFreeDeliveryTickets || 0),
            mustChangePassword: Boolean(u.mustChangePassword),
            privacyVersion: u.privacyVersion ?? null,
            privacyAcceptedAt: u.privacyAcceptedAt ? toDate(u.privacyAcceptedAt) : null,
            termsVersion: u.termsVersion ?? null,
            termsAcceptedAt: u.termsAcceptedAt ? toDate(u.termsAcceptedAt) : null,
            deletionRequestedAt: u.deletionRequestedAt ? toDate(u.deletionRequestedAt) : null,
            updatedAt: toDate(u.updatedAt),
          },
        });
    }

    for (const c of t.categories || []) {
      await tx
        .insert(schema.categories)
        .values({
          id: c.id,
          storeId: c.storeId,
          name: c.name,
          description: c.description ?? null,
          status: c.status || 'ACTIVE',
          createdAt: toDate(c.createdAt),
          updatedAt: toDate(c.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.categories.id,
          set: {
            name: c.name,
            description: c.description ?? null,
            status: c.status || 'ACTIVE',
            updatedAt: toDate(c.updatedAt),
          },
        });
    }

    for (const p of t.products || []) {
      await tx
        .insert(schema.products)
        .values({
          id: p.id,
          storeId: p.storeId,
          categoryId: p.categoryId,
          code: p.code || 'A001',
          name: p.name,
          description: p.description ?? null,
          price: String(p.price),
          promoPrice: p.promoPrice !== null && p.promoPrice !== undefined ? String(p.promoPrice) : null,
          promoActive: Boolean(p.promoActive),
          promoEndsAt: toNullableDate(p.promoEndsAt),
          promoDurationHours: p.promoDurationHours ?? null,
          promoMaxUnits: p.promoMaxUnits ?? null,
          isKit: Boolean(p.isKit),
          cost: String(p.cost ?? '0.00'),
          costUnitPrecise: String(p.costUnitPrecise ?? p.cost ?? '0.00'),
          costLotTotal: p.costLotTotal === null || p.costLotTotal === undefined ? null : String(p.costLotTotal),
          costLotUnits: p.costLotUnits === null || p.costLotUnits === undefined ? null : Number(p.costLotUnits),
          stock: Number(p.stock ?? 0),
          weight: String(p.weight ?? '0.000'),
          viewsCount: Number(p.viewsCount || 0),
          clicksCount: Number(p.clicksCount || 0),
          sharesCount: Number(p.sharesCount || 0),
          stockMinimum: Number(p.stockMinimum ?? 5),
          status: p.status || 'ACTIVE',
          createdAt: toDate(p.createdAt),
          updatedAt: toDate(p.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.products.id,
          set: {
            categoryId: p.categoryId,
            code: p.code || 'A001',
            name: p.name,
            description: p.description ?? null,
            price: String(p.price),
            promoPrice: p.promoPrice !== null && p.promoPrice !== undefined ? String(p.promoPrice) : null,
            promoActive: Boolean(p.promoActive),
            promoEndsAt: toNullableDate(p.promoEndsAt),
            promoDurationHours: p.promoDurationHours ?? null,
            promoMaxUnits: p.promoMaxUnits ?? null,
            isKit: Boolean(p.isKit),
            cost: String(p.cost ?? '0.00'),
            costUnitPrecise: String(p.costUnitPrecise ?? p.cost ?? '0.00'),
            costLotTotal: p.costLotTotal === null || p.costLotTotal === undefined ? null : String(p.costLotTotal),
            costLotUnits: p.costLotUnits === null || p.costLotUnits === undefined ? null : Number(p.costLotUnits),
            stock: Number(p.stock ?? 0),
            weight: String(p.weight ?? '0.000'),
            viewsCount: Number(p.viewsCount || 0),
            clicksCount: Number(p.clicksCount || 0),
            sharesCount: Number(p.sharesCount || 0),
            stockMinimum: Number(p.stockMinimum ?? 5),
            status: p.status || 'ACTIVE',
            updatedAt: toDate(p.updatedAt),
          },
        });
    }

    for (const k of t.productKitItems || []) {
      await tx
        .insert(schema.productKitItems)
        .values({
          id: k.id,
          kitProductId: k.kitProductId,
          componentProductId: k.componentProductId,
          quantityPerKit: Number(k.quantityPerKit),
          createdAt: toDate(k.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.productKitItems.id,
          set: {
            quantityPerKit: Number(k.quantityPerKit),
          },
        });
    }

    for (const img of t.productImages || []) {
      await tx
        .insert(schema.productImages)
        .values({
          id: img.id,
          productId: img.productId,
          imageUrl: img.imageUrl,
          mediaType: img.mediaType || 'IMAGE',
          durationSeconds: img.durationSeconds ?? null,
          isPrimary: Boolean(img.isPrimary),
          createdAt: toDate(img.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.productImages.id,
          set: {
            imageUrl: img.imageUrl,
            mediaType: img.mediaType || 'IMAGE',
            durationSeconds: img.durationSeconds ?? null,
            isPrimary: Boolean(img.isPrimary),
          },
        });
    }

    for (const a of t.addresses || []) {
      await tx
        .insert(schema.addresses)
        .values({
          id: a.id,
          userId: a.userId,
          label: a.label,
          zipCode: a.zipCode,
          street: a.street,
          number: a.number,
          complement: a.complement ?? null,
          neighborhood: a.neighborhood,
          city: a.city,
          state: a.state,
          reference: a.reference ?? null,
          isPrimary: Boolean(a.isPrimary),
          deliveryDistanceKm: a.deliveryDistanceKm ?? null,
          deliveryFee: a.deliveryFee ?? null,
          deliveryFeeStatus: a.deliveryFeeStatus || 'PENDING',
          deliveryFeeSource: a.deliveryFeeSource || 'MANUAL',
          deliveryCacheKey: a.deliveryCacheKey ?? null,
          deliveryInArea: a.deliveryInArea ?? null,
          deliveryOrigin: a.deliveryOrigin ?? null,
          deliveryNotes: a.deliveryNotes ?? null,
          deliveryUpdatedBy: a.deliveryUpdatedBy ?? null,
          deliveryUpdatedAt: toNullableDate(a.deliveryUpdatedAt),
          latitude: a.latitude ?? null,
          longitude: a.longitude ?? null,
          createdAt: toDate(a.createdAt),
          updatedAt: toDate(a.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.addresses.id,
          set: {
            label: a.label,
            zipCode: a.zipCode,
            street: a.street,
            number: a.number,
            complement: a.complement ?? null,
            neighborhood: a.neighborhood,
            city: a.city,
            state: a.state,
            reference: a.reference ?? null,
            isPrimary: Boolean(a.isPrimary),
            deliveryDistanceKm: a.deliveryDistanceKm ?? null,
            deliveryFee: a.deliveryFee ?? null,
            deliveryFeeStatus: a.deliveryFeeStatus || 'PENDING',
            updatedAt: toDate(a.updatedAt),
          },
        });
    }

    for (const o of t.orders || []) {
      await tx
        .insert(schema.orders)
        .values({
          id: o.id,
          orderNumber: o.orderNumber,
          userId: o.userId,
          storeId: o.storeId,
          subtotal: String(o.subtotal),
          deliveryFee: o.deliveryFee !== null && o.deliveryFee !== undefined ? String(o.deliveryFee) : null,
          deliveryDistanceKm: o.deliveryDistanceKm ?? null,
          deliveryFeeSource: o.deliveryFeeSource || 'MANUAL',
          total: String(o.total),
          paymentMethod: o.paymentMethod || 'PIX',
          changeFor: o.changeFor ?? null,
          status: o.status || 'NEW',
          isFirstOrderFreeDelivery: Boolean(o.isFirstOrderFreeDelivery),
          usedFreeDeliveryTicket: Boolean(o.usedFreeDeliveryTicket),
          stockDeducted: Boolean(o.stockDeducted),
          paymentExpiresAt: toNullableDate(o.paymentExpiresAt),
          deliveredAt: toNullableDate(o.deliveredAt),
          reminderSentAt: toNullableDate(o.reminderSentAt),
          cancellationReason: o.cancellationReason ?? null,
          refundRequested: Boolean(o.refundRequested),
          notes: o.notes ?? null,
          addressSnapshot: o.addressSnapshot,
          createdAt: toDate(o.createdAt),
          updatedAt: toDate(o.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.orders.id,
          set: {
            status: o.status || 'NEW',
            stockDeducted: Boolean(o.stockDeducted),
            deliveredAt: toNullableDate(o.deliveredAt),
            reminderSentAt: toNullableDate(o.reminderSentAt),
            updatedAt: toDate(o.updatedAt),
          },
        });
    }

    for (const payment of t.payments || []) {
      await tx
        .insert(schema.payments)
        .values({
          id: payment.id,
          orderId: payment.orderId,
          provider: payment.provider || 'MERCADOPAGO',
          externalReference: payment.externalReference,
          providerOrderId: payment.providerOrderId ?? null,
          providerPreferenceId: payment.providerPreferenceId ?? null,
          providerPaymentId: payment.providerPaymentId ?? null,
          idempotencyKey: payment.idempotencyKey,
          amount: String(payment.amount),
          currency: payment.currency || 'BRL',
          status: payment.status || 'PENDING',
          providerStatus: payment.providerStatus ?? null,
          checkoutUrl: payment.checkoutUrl ?? null,
          createdAt: toDate(payment.createdAt),
          updatedAt: toDate(payment.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.payments.orderId,
          set: {
            provider: payment.provider || 'MERCADOPAGO',
            externalReference: payment.externalReference,
            providerOrderId: payment.providerOrderId ?? null,
            providerPreferenceId: payment.providerPreferenceId ?? null,
            providerPaymentId: payment.providerPaymentId ?? null,
            idempotencyKey: payment.idempotencyKey,
            amount: String(payment.amount),
            currency: payment.currency || 'BRL',
            status: payment.status || 'PENDING',
            providerStatus: payment.providerStatus ?? null,
            checkoutUrl: payment.checkoutUrl ?? null,
            updatedAt: toDate(payment.updatedAt),
          },
        });
    }

    for (const ticket of t.supportTickets || []) {
      await tx
        .insert(schema.supportTickets)
        .values({
          id: ticket.id,
          userId: ticket.userId,
          orderId: ticket.orderId ?? null,
          subject: ticket.subject,
          status: ticket.status || 'OPEN',
          createdAt: toDate(ticket.createdAt),
          updatedAt: toDate(ticket.updatedAt),
          closedAt: toNullableDate(ticket.closedAt),
        })
        .onConflictDoUpdate({
          target: schema.supportTickets.id,
          set: {
            userId: ticket.userId,
            orderId: ticket.orderId ?? null,
            subject: ticket.subject,
            status: ticket.status || 'OPEN',
            updatedAt: toDate(ticket.updatedAt),
            closedAt: toNullableDate(ticket.closedAt),
          },
        });
    }

    for (const message of t.supportMessages || []) {
      await tx
        .insert(schema.supportMessages)
        .values({
          id: message.id,
          ticketId: message.ticketId,
          authorUserId: message.authorUserId,
          body: message.body,
          createdAt: toDate(message.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const oi of t.orderItems || []) {
      await tx
        .insert(schema.orderItems)
        .values({
          id: oi.id,
          orderId: oi.orderId,
          productId: oi.productId,
          productName: oi.productName,
          quantity: Number(oi.quantity),
          unitPrice: String(oi.unitPrice),
          subtotal: String(oi.subtotal),
          unitCost: oi.unitCost !== null && oi.unitCost !== undefined ? String(oi.unitCost) : null,
          createdAt: toDate(oi.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const m of t.inventoryMovements || []) {
      await tx
        .insert(schema.inventoryMovements)
        .values({
          id: m.id,
          productId: m.productId,
          delta: Number(m.delta),
          beforeStock: Number(m.beforeStock),
          afterStock: Number(m.afterStock),
          movementType: m.movementType,
          reason: m.reason,
          actorUserId: m.actorUserId ?? null,
          orderId: m.orderId ?? null,
          kitProductId: m.kitProductId ?? null,
          idempotencyKey: m.idempotencyKey ?? null,
          operationResult: m.operationResult ?? null,
          createdAt: toDate(m.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const h of t.orderStatusHistory || []) {
      await tx
        .insert(schema.orderStatusHistory)
        .values({
          id: h.id,
          orderId: h.orderId,
          oldStatus: h.oldStatus ?? null,
          newStatus: h.newStatus,
          changedBy: h.changedBy ?? null,
          createdAt: toDate(h.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const pi of t.productInteractions || []) {
      await tx
        .insert(schema.productInteractions)
        .values({
          id: pi.id,
          productId: pi.productId,
          type: pi.type,
          visitorId: pi.visitorId,
          userId: pi.userId ?? null,
          createdAt: toDate(pi.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const n of t.notifications || []) {
      await tx
        .insert(schema.notifications)
        .values({
          id: n.id,
          userId: n.userId,
          orderId: n.orderId ?? null,
          orderNumber: n.orderNumber,
          oldStatus: n.oldStatus ?? null,
          newStatus: n.newStatus,
          title: n.title,
          message: n.message,
          isRead: Boolean(n.isRead),
          popupDismissed: Boolean(n.popupDismissed),
          createdAt: toDate(n.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const an of t.adminNotifications || []) {
      await tx
        .insert(schema.adminNotifications)
        .values({
          id: an.id,
          type: an.type || 'NEW_CUSTOMER',
          customerId: an.customerId ?? null,
          orderId: an.orderId ?? null,
          addressId: an.addressId ?? null,
          title: an.title,
          message: an.message,
          isRead: Boolean(an.isRead),
          popupDismissed: Boolean(an.popupDismissed),
          createdAt: toDate(an.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const supplier of t.suppliers || []) {
      await tx.insert(schema.suppliers).values({ id: supplier.id, name: supplier.name, contact: supplier.contact ?? null, website: supplier.website ?? null, notes: supplier.notes ?? null, status: supplier.status || 'ACTIVE', createdAt: toDate(supplier.createdAt), updatedAt: toDate(supplier.updatedAt) }).onConflictDoUpdate({ target: schema.suppliers.id, set: { name: supplier.name, contact: supplier.contact ?? null, website: supplier.website ?? null, notes: supplier.notes ?? null, status: supplier.status || 'ACTIVE', updatedAt: toDate(supplier.updatedAt) } });
    }
    for (const purchase of t.supplierPurchases || []) {
      await tx.insert(schema.supplierPurchases).values({ id: purchase.id, supplierId: purchase.supplierId, productId: purchase.productId ?? null, itemName: purchase.itemName, unitCost: String(purchase.unitCost), quantity: Number(purchase.quantity), totalCost: String(purchase.totalCost), purchasedAt: toDate(purchase.purchasedAt), createdAt: toDate(purchase.createdAt), productUrl: purchase.productUrl ?? null, notes: purchase.notes ?? null, createdBy: purchase.createdBy ?? null }).onConflictDoNothing();
    }
    for (const fulfillment of t.orderFulfillments || []) {
      await tx.insert(schema.orderFulfillments).values({ id: fulfillment.id, orderId: fulfillment.orderId, type: fulfillment.type, status: fulfillment.status || 'PENDING', etaAt: toNullableDate(fulfillment.etaAt), etaStart: toNullableDate(fulfillment.etaStart), etaEnd: toNullableDate(fulfillment.etaEnd), deliveredAt: toNullableDate(fulfillment.deliveredAt), deliveredBy: fulfillment.deliveredBy ?? null, createdAt: toDate(fulfillment.createdAt) }).onConflictDoNothing();
    }
    for (const refund of t.refunds || []) {
      await tx.insert(schema.refunds).values({ id: refund.id, orderId: refund.orderId, fulfillmentId: refund.fulfillmentId ?? null, amount: String(refund.amount), scope: refund.scope, reason: refund.reason, status: refund.status || 'REQUESTED', requestedBy: refund.requestedBy, processedBy: refund.processedBy ?? null, createdAt: toDate(refund.createdAt), processedAt: toNullableDate(refund.processedAt), notes: refund.notes ?? null }).onConflictDoNothing();
    }
    for (const item of t.refundItems || []) {
      await tx.insert(schema.refundItems).values({ id: item.id, refundId: item.refundId, orderItemId: item.orderItemId, quantity: Number(item.quantity), amount: String(item.amount), destination: item.destination ?? null }).onConflictDoNothing();
    }
    for (const notice of t.delayNotices || []) {
      await tx.insert(schema.delayNotices).values({ id: notice.id, orderId: notice.orderId, fulfillmentId: notice.fulfillmentId, message: notice.message, options: notice.options || {}, waitDays: Number(notice.waitDays || 2), status: notice.status || 'PENDING', choice: notice.choice ?? null, answeredAt: toNullableDate(notice.answeredAt), createdBy: notice.createdBy ?? null, createdAt: toDate(notice.createdAt) }).onConflictDoNothing();
    }
    for (const st of t.settings || []) {
      await tx
        .insert(schema.settings)
        .values({
          key: st.key,
          value: String(st.value),
          updatedAt: toDate(st.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: {
            value: String(st.value),
            updatedAt: toDate(st.updatedAt),
          },
        });
    }

    for (const obj of t.storedObjects || []) {
      await tx
        .insert(schema.storedObjects)
        .values({
          key: obj.key,
          mimeType: obj.mimeType,
          dataBase64: obj.dataBase64,
          createdAt: toDate(obj.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.storedObjects.key,
          set: {
            mimeType: obj.mimeType,
            dataBase64: obj.dataBase64,
          },
        });
    }

    // Restaura também a trilha de auditoria e chaves idempotentes; não há UPDATE/DELETE na trilha.
    for (const log of t.adminAuditLogs || []) {
      await tx.insert(schema.adminAuditLogs).values({ id: log.id, actorUserId: log.actorUserId ?? null, actorEmail: log.actorEmail, action: log.action, entityType: log.entityType, entityId: log.entityId ?? null, result: log.result || 'SUCCESS', details: log.details ?? null, requestId: log.requestId ?? null, createdAt: toDate(log.createdAt) }).onConflictDoNothing();
    }
    for (const key of t.adminEventKeys || []) {
      await tx.insert(schema.adminEventKeys).values({ eventKey: key.eventKey, eventType: key.eventType, createdAt: toDate(key.createdAt) }).onConflictDoNothing();
    }
    for (const row of t.geoDistanceCache || []) {
      await tx.insert(schema.geoDistanceCache).values({ ...row, createdAt: toDate(row.createdAt), updatedAt: toDate(row.updatedAt) }).onConflictDoNothing();
    }
    for (const row of t.geoApiUsage || []) {
      // Restore must never reduce current quota usage.
      await tx.insert(schema.geoApiUsage).values(row).onConflictDoUpdate({ target: schema.geoApiUsage.month, set: { calls: sql`GREATEST(${schema.geoApiUsage.calls}, ${Number(row.calls)})` } });
    }
    for (const row of t.geoLookupLog || []) await tx.insert(schema.geoLookupLog).values({ ...row, createdAt: toDate(row.createdAt) }).onConflictDoNothing();
    for (const row of t.freightLegacyRuns || []) await tx.insert(schema.freightLegacyRuns).values({ ...row, createdAt: toDate(row.createdAt), executedAt: toNullableDate(row.executedAt) }).onConflictDoNothing();
    // Sincroniza todas as sequências SERIAL do PostgreSQL após restaurar IDs explícitos
    const serialTables = [
      'stores',
      'users',
      'categories',
      'products',
      'product_kit_items',
      'product_images',
      'addresses',
      'orders',
      'payments',
      'support_tickets',
      'support_messages',
      'order_items',
      'order_status_history',
      'product_interactions',
      'notifications',
      'admin_notifications',
      'inventory_movements',
      'suppliers',
      'supplier_purchases',
      'order_fulfillments',
      'refunds',
      'refund_items',
      'delay_notices',
      'geo_lookup_log',
    ];
    for (const tbl of serialTables) {
      await tx.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), (SELECT COUNT(*) > 0 FROM ${tbl}));`));
    }

    return {
      productsRestored: (t.products || []).length,
      categoriesRestored: (t.categories || []).length,
      usersRestored: (t.users || []).length,
      ordersRestored: (t.orders || []).length,
      paymentsRestored: (t.payments || []).length,
      supportTicketsRestored: (t.supportTickets || []).length,
      supportMessagesRestored: (t.supportMessages || []).length,
    };
  });
  triggerAutoSnapshot();

  return restoreResult;
}
