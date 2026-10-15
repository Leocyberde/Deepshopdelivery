import { logServerError, logServerEvent } from '../server/logger.ts';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import * as schema from './schema.ts';

const databaseUrl = process.env.DATABASE_URL;
const postgresSsl = process.env.PGSSL === 'true'
  ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
  : undefined;
export const pgClient = new Pool(databaseUrl
  ? { connectionString: databaseUrl, max: Number(process.env.PGPOOL_MAX) || 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: postgresSsl }
  : {
      host: process.env.PGHOST || process.env.SQL_HOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || process.env.SQL_DB_NAME || 'achadinhos',
      user: process.env.PGUSER || process.env.SQL_USER || 'postgres',
      password: process.env.PGPASSWORD || process.env.SQL_PASSWORD || '',
      max: Number(process.env.PGPOOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: postgresSsl,
  });
type DatabaseAvailability = 'unknown' | 'available' | 'unavailable';
let databaseAvailability: DatabaseAvailability = 'unknown';

export function markDatabaseAvailable(source = 'query') {
  if (databaseAvailability === 'available') return;
  const recovered = databaseAvailability === 'unavailable';
  databaseAvailability = 'available';
  logServerEvent(recovered ? 'database.connection.recovered' : 'database.connection.ready', 'info', {
    source,
    result: recovered ? 'recovered' : 'connected',
  });
}

export function markDatabaseUnavailable(error: unknown, source = 'query') {
  if (databaseAvailability === 'unavailable') return;
  databaseAvailability = 'unavailable';
  logServerError('database.connection.lost', error, { source, result: 'unavailable' });
}

pgClient.on('connect', () => markDatabaseAvailable('pool_connect'));
pgClient.on('error', (error) => markDatabaseUnavailable(error, 'pool_client_error'));
export const db = drizzle(pgClient, { schema });

export async function closeDatabase() {
  await pgClient.end();
}

export async function executeRawSql(sqlText: string): Promise<void> {
  await pgClient.query(sqlText);
}

let initialized = false;

export async function initializeDatabase() {
  if (initialized) return;

  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      cpf TEXT,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      free_delivery_tickets INTEGER NOT NULL DEFAULT 0,
      manual_free_delivery_tickets INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS free_delivery_tickets INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_free_delivery_tickets INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS free_delivery_until TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS free_delivery_until TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP;
    CREATE INDEX IF NOT EXISTS idx_users_cpf_digits
      ON users ((regexp_replace(COALESCE(cpf, ''), '[^0-9]', '', 'g')));

    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'OWN_STORE',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      code TEXT NOT NULL DEFAULT 'A001',
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(10, 2) NOT NULL,
      promo_price NUMERIC(10, 2),
      promo_active BOOLEAN NOT NULL DEFAULT FALSE,
      promo_ends_at TIMESTAMP,
      promo_duration_hours INTEGER,
      promo_max_units INTEGER,
      is_kit BOOLEAN NOT NULL DEFAULT FALSE,
      cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
      cost_unit_precise NUMERIC(14, 6),
      cost_lot_total NUMERIC(12, 2),
      cost_lot_units INTEGER,
      stock INTEGER NOT NULL DEFAULT 0,
      stock_minimum INTEGER NOT NULL DEFAULT 5,
      weight NUMERIC(10, 3) DEFAULT 0.000,
      views_count INTEGER NOT NULL DEFAULT 0,
      clicks_count INTEGER NOT NULL DEFAULT 0,
      shares_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT 'A001';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_price NUMERIC(10, 2);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_active BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_ends_at TIMESTAMP;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_duration_hours INTEGER;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_max_units INTEGER;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_kit BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_unit_precise NUMERIC(14, 6);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_lot_total NUMERIC(12, 2);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_lot_units INTEGER;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS clicks_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimum INTEGER NOT NULL DEFAULT 5;

    CREATE TABLE IF NOT EXISTS product_kit_items (
      id SERIAL PRIMARY KEY,
      kit_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      component_product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_per_kit INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'IMAGE',
      duration_seconds INTEGER,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'IMAGE';
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

    CREATE TABLE IF NOT EXISTS addresses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      street TEXT NOT NULL,
      number TEXT NOT NULL,
      complement TEXT,
      neighborhood TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      reference TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      delivery_distance_km NUMERIC(10, 2),
      delivery_fee NUMERIC(10, 2),
      delivery_fee_status TEXT NOT NULL DEFAULT 'PENDING',
      delivery_fee_source TEXT NOT NULL DEFAULT 'MANUAL',
      delivery_origin TEXT,
      delivery_notes TEXT,
      delivery_updated_by INTEGER,
      delivery_updated_at TIMESTAMP,
      latitude NUMERIC(10, 7),
      longitude NUMERIC(10, 7),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE addresses ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_addresses_user_primary ON addresses(user_id, is_primary);

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      subtotal NUMERIC(10, 2) NOT NULL,
      delivery_fee NUMERIC(10, 2),
      delivery_distance_km NUMERIC(10, 2),
      delivery_fee_source TEXT NOT NULL DEFAULT 'MANUAL',
      total NUMERIC(10, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'NEW',
      is_first_order_free_delivery BOOLEAN NOT NULL DEFAULT FALSE,
      stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
      cancellation_reason TEXT,
      refund_requested BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      payment_method TEXT,
      change_for NUMERIC(10, 2),
      payment_expires_at TIMESTAMP,
      address_snapshot JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_first_order_free_delivery BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS used_free_delivery_ticket BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_requested BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_for NUMERIC(10, 2);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMP;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_minutes INTEGER;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMP;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_delivery_at TIMESTAMP;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
    UPDATE orders SET stock_deducted = TRUE WHERE status IN ('PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED') AND stock_deducted = FALSE;

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'MERCADOPAGO',
      external_reference TEXT NOT NULL UNIQUE,
      provider_order_id TEXT UNIQUE,
      provider_preference_id TEXT UNIQUE,
      provider_payment_id TEXT UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      amount NUMERIC(10, 2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      status TEXT NOT NULL DEFAULT 'PENDING',
      provider_status TEXT,
      checkout_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_order_id TEXT UNIQUE;

    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMP
    );
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS product_slug_snapshot TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS product_link_snapshot TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS initiated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS support_reason TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS post_delivery BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_reason TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS customer_last_read_at TIMESTAMP;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS store_last_read_at TIMESTAMP;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_store_message_at TIMESTAMP;
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at ON support_tickets(updated_at);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_order ON support_tickets(order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_support_ticket_post_delivery_active_reason
      ON support_tickets(order_id, user_id, support_reason)
      WHERE post_delivery = TRUE AND support_reason IS NOT NULL AND status <> 'CLOSED';

    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      support_ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE SET NULL,
      order_number TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      popup_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS support_ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE SET NULL;

    ALTER TABLE notifications ALTER COLUMN order_id DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS admin_notifications (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'NEW_CUSTOMER',
      customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      support_ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE SET NULL,
      address_id INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      popup_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE admin_notifications ALTER COLUMN customer_id DROP NOT NULL;
    ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE;
    ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS support_ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price NUMERIC(10, 2) NOT NULL,
      subtotal NUMERIC(10, 2) NOT NULL,
      unit_cost NUMERIC(14, 6),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14, 6);
    ALTER TABLE order_items ALTER COLUMN unit_cost TYPE NUMERIC(14, 6);

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      delta INTEGER NOT NULL,
      before_stock INTEGER NOT NULL,
      after_stock INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      kit_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      idempotency_key TEXT UNIQUE,
      operation_result JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created ON inventory_movements(product_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS product_interactions (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_product_interactions_prod_type_date ON product_interactions(product_id, type, created_at);
    CREATE INDEX IF NOT EXISTS idx_product_interactions_visitor_prod_type_date ON product_interactions(visitor_id, product_id, type, created_at);

    CREATE TABLE IF NOT EXISTS order_status_history (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stored_objects (
      key TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      result TEXT NOT NULL DEFAULT 'SUCCESS',
      details JSONB,
      request_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs(actor_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_logs(entity_type, entity_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS admin_event_keys (
      event_key TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'admin_audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_admin_audit_no_update_delete ON admin_audit_logs;
    CREATE TRIGGER trg_admin_audit_no_update_delete BEFORE UPDATE OR DELETE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();
  `);

  // Migrações de DADOS: só rodam depois que TODAS as tabelas/colunas acima existem.
  await pgClient.query(`
    -- Migração de pedidos já entregues: preencher delivered_at com a data do histórico ou updated_at
    UPDATE orders o
    SET delivered_at = COALESCE(
      (SELECT created_at FROM order_status_history h WHERE h.order_id = o.id AND h.new_status = 'DELIVERED' ORDER BY h.id DESC LIMIT 1),
      o.updated_at
    )
    WHERE o.status = 'DELIVERED' AND o.delivered_at IS NULL;

    -- Garante que novas configurações de fuso e custos existam
    INSERT INTO settings (key, value) VALUES 
      ('store_timezone', 'America/Sao_Paulo'),
      ('packaging_cost_per_order', '0.00'),
      ('delivery_cost_per_order', '0.00'),
      ('monthly_fixed_costs', '0.00')
    ON CONFLICT (key) DO NOTHING;

    UPDATE products SET status = 'INACTIVE' WHERE stock <= 0;
    INSERT INTO settings (key, value) VALUES
      ('cpf_strict_validation_enabled', 'false'),
      ('store_status', 'OPEN'),
      ('store_closed_message', 'A loja está fechada no momento. Volte durante nosso horário de atendimento.'),
      ('accept_orders_when_closed', 'false'),
      ('store_hours', '{"mon":{"enabled":true,"open":"09:00","close":"18:00"},"tue":{"enabled":true,"open":"09:00","close":"18:00"},"wed":{"enabled":true,"open":"09:00","close":"18:00"},"thu":{"enabled":true,"open":"09:00","close":"18:00"},"fri":{"enabled":true,"open":"09:00","close":"18:00"},"sat":{"enabled":true,"open":"09:00","close":"13:00"},"sun":{"enabled":false,"open":"09:00","close":"13:00"}}'),
      ('company_name', 'DeepShop Delivery'),
      ('company_cnpj', ''),
      ('company_address', ''),
      ('company_email', ''),
      ('company_phone', ''),
      ('privacy_content', 'Esta Política de Privacidade explica como a DeepShop Delivery coleta e utiliza dados necessários para cadastro, atendimento, pedidos, entrega e suporte.'),
      ('terms_content', 'Estes Termos de Uso estabelecem as regras para cadastro, compra, pagamento, entrega, cancelamento e utilização da loja DeepShop Delivery.'),
      ('exchange_content', 'Trocas e devoluções serão tratadas conforme a legislação aplicável e as condições informadas pela loja no momento da compra.'),
      ('callmebot_enabled', 'false'),
      ('callmebot_last_sent_at', '')
    ON CONFLICT (key) DO NOTHING;
  `);

  // Check if initial store "DeepShop" exists
  const existingStores = await db.select().from(schema.stores);
  if (existingStores.length === 0) {
    logServerEvent('database.bootstrap.started', 'info', { result: 'clean_database' });
    // 1. Create OWN_STORE "DeepShop"
    const [store] = await db
      .insert(schema.stores)
      .values({
        name: 'DeepShop',
        description:
          'Loja local de utilidades, tecnologia, iluminação e presentes criativos para o dia a dia.',
        type: 'OWN_STORE',
        status: 'ACTIVE',
      })
      .returning();

    // 2. O administrador inicial é criado fora deste bloco (ensureInitialAdmin), via ADMIN_EMAIL/ADMIN_PASSWORD.

    // 3. Default Settings
    const defaultSettings = [
      { key: 'whatsapp_number', value: '' },
      { key: 'pix_key', value: '' },
      {
        key: 'pix_instructions',
        value:
          'Faça o Pix usando a chave acima e envie o comprovante pelo WhatsApp informando o número do seu pedido.',
      },
      { key: 'freight_base_km', value: '4.0' },
      { key: 'freight_base_fee', value: '7.50' },
      { key: 'freight_extra_km_fee', value: '1.50' },
      { key: 'store_origin_address', value: 'Matriz DeepShop - Rua Central, 120 - Centro' },
      { key: 'payment_deadline_hours', value: '24' },
            { key: 'clean_slate_real_data_v1', value: 'true' },
      { key: 'store_timezone', value: 'America/Sao_Paulo' },
      { key: 'packaging_cost_per_order', value: '0.00' },
      { key: 'delivery_cost_per_order', value: '0.00' },
      { key: 'monthly_fixed_costs', value: '0.00' },
    ];
    for (const s of defaultSettings) {
      await db.insert(schema.settings).values(s).onConflictDoNothing({ target: schema.settings.key });
    }

    // 4. Base Categories for the Admin to start registering real products
    await db.insert(schema.categories).values([
      {
        id: 1,
        storeId: store.id,
        name: 'Eletrônicos & Energia',
        description: 'Carregadores, cabos e acessórios para dispositivos móveis.',
        status: 'ACTIVE',
      },
      {
        id: 2,
        storeId: store.id,
        name: 'Casa & Iluminação',
        description: 'Luminárias, organização e utilidades domésticas.',
        status: 'ACTIVE',
      },
      {
        id: 3,
        storeId: store.id,
        name: 'Térmicos & Utilidades',
        description: 'Garrafas, copos térmicos e acessórios do dia a dia.',
        status: 'ACTIVE',
      },
    ]).onConflictDoNothing();
    logServerEvent('database.bootstrap.completed', 'info', { result: 'clean_database' });
  }

  // Garante categorias base sempre presentes
  const currentCategories = await db.select().from(schema.categories);
  if (currentCategories.length === 0) {
    const allStores = await db.select().from(schema.stores);
    const storeId = allStores[0]?.id || 1;
    await db.insert(schema.categories).values([
      {
        id: 1,
        storeId,
        name: 'Eletrônicos & Energia',
        description: 'Carregadores, cabos e acessórios para dispositivos móveis.',
        status: 'ACTIVE',
      },
      {
        id: 2,
        storeId,
        name: 'Casa & Iluminação',
        description: 'Luminárias, organização e utilidades domésticas.',
        status: 'ACTIVE',
      },
      {
        id: 3,
        storeId,
        name: 'Térmicos & Utilidades',
        description: 'Garrafas, copos térmicos e acessórios do dia a dia.',
        status: 'ACTIVE',
      },
    ]).onConflictDoNothing();
  }

  // Tenta restaurar do snapshot JSON caso o banco esteja sem produtos
  const existingProds = await db.select().from(schema.products);
  if (existingProds.length === 0) {
    const { SNAPSHOT_FILE_PATH: snapshotPath } = await import('./backup.ts');
    let restored = false;
    if (fs.existsSync(snapshotPath)) {
      try {
        const fileContent = fs.readFileSync(snapshotPath, 'utf8');
        const snap = JSON.parse(fileContent);
        if (snap?.tables?.products && snap.tables.products.length > 0) {
          const { restoreFromBackupJson } = await import('./backup.ts');
          await restoreFromBackupJson(snap);
          logServerEvent('database.snapshot.restored', 'info', { count: snap.tables.products.length });
          restored = true;
        }
      } catch (err) {
        logServerError('server_operation_failed', err);
      }
    }

    // O catálogo de seedData.ts é do lojista/demonstração. Em produção ele NÃO é carregado
    // automaticamente: defina SEED_INITIAL_CATALOG=true se quiser esse catálogo inicial.
    const seedCatalog =
      process.env.SEED_INITIAL_CATALOG === 'true' ||
      (process.env.NODE_ENV !== 'production' && process.env.SEED_INITIAL_CATALOG !== 'false');

    if (!restored && !seedCatalog) {
      logServerEvent('database.catalog.seed_skipped', 'info', { reason: 'seed_disabled' });
    }

    if (!restored && seedCatalog) {
      logServerEvent('database.catalog.seed.started', 'info', { count: 5 });
      const { SEED_PRODUCTS, SEED_STORED_OBJECTS } = await import('./seedData.ts');

      // 1. Stored objects (imagens)
      for (const obj of SEED_STORED_OBJECTS) {
        await db.insert(schema.storedObjects).values({
          key: obj.key,
          mimeType: obj.mimeType,
          dataBase64: obj.dataBase64,
        }).onConflictDoNothing();
      }

      // 2. Produtos
      const allStores = await db.select().from(schema.stores);
      const storeId = allStores[0]?.id || 1;

      for (const p of SEED_PRODUCTS) {
        const [inserted] = await db.insert(schema.products).values({
          id: p.id,
          storeId,
          categoryId: p.categoryId,
          code: p.code,
          name: p.name,
          description: p.description,
          price: p.price,
          promoPrice: p.promoPrice,
          promoActive: p.promoActive,
          cost: p.cost,
          stock: p.stock,
          weight: p.weight,
          status: p.status,
        }).onConflictDoNothing().returning();

        const prodId = inserted?.id || p.id;
        if (p.images && p.images.length > 0) {
          for (const img of p.images) {
            await db.insert(schema.productImages).values({
              productId: prodId,
              imageUrl: img.imageUrl,
              mediaType: 'IMAGE',
              isPrimary: img.isPrimary,
            }).onConflictDoNothing();
          }
        }
      }

      // Sincroniza sequences
      await pgClient.query(`
        SELECT setval(pg_get_serial_sequence('products', 'id'), COALESCE((SELECT MAX(id) FROM products), 1), (SELECT COUNT(*) > 0 FROM products));
        SELECT setval(pg_get_serial_sequence('categories', 'id'), COALESCE((SELECT MAX(id) FROM categories), 1), (SELECT COUNT(*) > 0 FROM categories));
      `);
    }

    // Salva snapshot atualizado
    const { triggerAutoSnapshot } = await import('./backup.ts');
    triggerAutoSnapshot();
  }

  // Ensure ADMIN accounts never have customer free delivery tickets or customer notifications
  await pgClient.query(`
    UPDATE users
    SET free_delivery_tickets = 0,
        manual_free_delivery_tickets = 0
    WHERE role IN ('ADMIN','SUPER_ADMIN','GERENTE','OPERADOR');
    DELETE FROM notifications
    WHERE user_id IN (SELECT id FROM users WHERE role = 'ADMIN');
  `);

  await ensureInitialAdmin();

  // Baseline de conciliação: registra o saldo que já existia uma única vez para cada produto.
  await pgClient.query(`
    INSERT INTO inventory_movements (product_id, delta, before_stock, after_stock, movement_type, reason, idempotency_key)
    SELECT p.id, p.stock, 0, p.stock, 'OPENING_BALANCE', 'Saldo existente na migração da trilha de estoque', 'phase2-opening-balance:' || p.id
    FROM products p
    WHERE p.stock > 0
      AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id);
  `);

  initialized = true;
}

// Etapa 1.2: o primeiro admin só nasce de ADMIN_EMAIL/ADMIN_PASSWORD; senha antiga "admin123" força troca.
async function ensureInitialAdmin() {
  await pgClient.query(`UPDATE users SET role = 'SUPER_ADMIN' WHERE role = 'ADMIN'`);
  const admins = await db.select().from(schema.users).where(sql`role IN ('SUPER_ADMIN','GERENTE','OPERADOR')`);

  if (admins.length === 0) {
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!email || password.length < 10) {
      logServerEvent('database.admin.initial_missing', 'warn', { reason: 'admin_credentials_not_configured' });
      return;
    }
    await db.insert(schema.users).values({
      name: 'Administrador DeepShop',
      email,
      phone: String(process.env.ADMIN_PHONE || '').trim() || '00000000000',
      passwordHash: await bcrypt.hash(password, 10),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    logServerEvent('database.admin.initial_created', 'info', { role: 'SUPER_ADMIN' });
    return;
  }

  for (const admin of admins) {
    if (!admin.mustChangePassword && (await bcrypt.compare('admin123', admin.passwordHash))) {
      await db
        .update(schema.users)
        .set({ mustChangePassword: true, updatedAt: new Date() })
        .where(eq(schema.users.id, admin.id));
      logServerEvent('database.admin.legacy_password_detected', 'warn', { adminId: admin.id, reason: 'password_change_required' });
    }
  }
}

export function getDatabaseEngineInfo() {
  return {
    engine: 'PostgreSQL (node-postgres / Drizzle ORM)',
    status: initialized ? 'ONLINE' : 'INITIALIZING',
    storage: 'Servidor PostgreSQL configurado por DATABASE_URL ou PGHOST/PGPORT/PGDATABASE',
    persistence: 'FULL_DURABILITY',
  };
}
