-- ============================================================================
-- ACHADINHOS DELIVERY — MIGRAÇÃO OFICIAL POSTGRESQL (V1 PRODUÇÃO / VPS)
-- Compatível com PostgreSQL 14, 15, 16+ (VPS Ubuntu/Debian, Docker, Cloud SQL)
-- Como aplicar em uma VPS com PostgreSQL:
--   psql -U postgres -d achadinhos -f drizzle/0000_achadinhos_production_schema.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'OWN_STORE',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER',
  permissions TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  session_version INTEGER NOT NULL DEFAULT 1,
  free_delivery_tickets INTEGER NOT NULL DEFAULT 0,
  manual_free_delivery_tickets INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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
  payment_method TEXT NOT NULL DEFAULT 'PIX',
  change_for NUMERIC(10, 2),
  status TEXT NOT NULL DEFAULT 'NEW',
  is_first_order_free_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  used_free_delivery_ticket BOOLEAN NOT NULL DEFAULT FALSE,
  stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  payment_expires_at TIMESTAMP,
  delivery_mode TEXT,
  delivery_minutes INTEGER,
  estimated_delivery_at TIMESTAMP,
  scheduled_delivery_at TIMESTAMP,
  delivered_at TIMESTAMP,
  cancellation_reason TEXT,
  refund_requested BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  address_snapshot JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'MERCADOPAGO',
  external_reference TEXT NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  unit_cost NUMERIC(10, 2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_interactions (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS order_status_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  popup_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'NEW_CUSTOMER',
  customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  address_id INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  popup_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_notifications ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE;

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

-- Índices de performance para produção PostgreSQL
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user_primary ON addresses(user_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at ON support_tickets(updated_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

CREATE INDEX IF NOT EXISTS idx_product_interactions_prod_type_date ON product_interactions(product_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_product_interactions_visitor_prod_type_date ON product_interactions(visitor_id, product_id, type, created_at);

-- Compatibilidade com bancos criados por versões anteriores deste arquivo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS clicks_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimum INTEGER NOT NULL DEFAULT 5;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_minutes INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_delivery_at TIMESTAMP;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10, 2);


-- Configurações padrão necessárias para loja aberta/fechada, LGPD e CallMeBot
INSERT INTO settings (key, value) VALUES
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

-- FASE 3: auditoria administrativa append-only e idempotência de eventos
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  entity_type TEXT NOT NULL,
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
