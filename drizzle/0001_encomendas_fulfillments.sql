BEGIN;
CREATE TABLE IF NOT EXISTS suppliers (id SERIAL PRIMARY KEY, name TEXT NOT NULL, contact TEXT, website TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS supplier_purchases (id SERIAL PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, item_name TEXT NOT NULL, unit_cost NUMERIC(14,6) NOT NULL, quantity INTEGER NOT NULL, total_cost NUMERIC(14,2) NOT NULL, purchased_at TIMESTAMP NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), product_url TEXT, notes TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_supplier_purchases_supplier_date ON supplier_purchases(supplier_id, purchased_at);
ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS inventory_movement_id INTEGER REFERENCES inventory_movements(id) ON DELETE SET NULL;
DROP INDEX IF EXISTS idx_supplier_purchases_inventory_movement;
CREATE UNIQUE INDEX idx_supplier_purchases_inventory_movement ON supplier_purchases(inventory_movement_id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_product_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_preorder BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_eta_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preorder_eta_start TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preorder_eta_end TIMESTAMP;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'STATUS';
ALTER TABLE notifications ALTER COLUMN new_status DROP NOT NULL;
CREATE TABLE IF NOT EXISTS order_fulfillments (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', eta_at TIMESTAMP, eta_start TIMESTAMP, eta_end TIMESTAMP, delivered_at TIMESTAMP, delivered_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_order_fulfillments_order ON order_fulfillments(order_id);
CREATE TABLE IF NOT EXISTS refunds (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, fulfillment_id INTEGER REFERENCES order_fulfillments(id) ON DELETE SET NULL, amount NUMERIC(14,2) NOT NULL, scope TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'REQUESTED', requested_by TEXT NOT NULL, processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), processed_at TIMESTAMP, notes TEXT);
CREATE TABLE IF NOT EXISTS refund_items (id SERIAL PRIMARY KEY, refund_id INTEGER NOT NULL REFERENCES refunds(id) ON DELETE CASCADE, order_item_id INTEGER NOT NULL REFERENCES order_items(id), quantity INTEGER NOT NULL, amount NUMERIC(14,2) NOT NULL, destination TEXT);
CREATE TABLE IF NOT EXISTS delay_notices (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, fulfillment_id INTEGER NOT NULL REFERENCES order_fulfillments(id) ON DELETE CASCADE, message TEXT NOT NULL, options JSONB NOT NULL, wait_days INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL DEFAULT 'PENDING', choice TEXT, answered_at TIMESTAMP, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());
INSERT INTO order_fulfillments(order_id, type, status, eta_at, created_at)
SELECT id, 'DELIVERY',
  CASE
    WHEN status IN ('CANCELLED', 'EXPIRED') THEN 'CANCELLED'
    WHEN status IN ('DELIVERED', 'COMPLETED') THEN 'DELIVERED'
    WHEN status IN ('OUT_FOR_DELIVERY', 'SHIPPED', 'IN_TRANSIT') THEN 'OUT_FOR_DELIVERY'
    WHEN status IN ('PREPARING', 'PROCESSING', 'SEPARATING') THEN 'PREPARING'
    ELSE 'PENDING'
  END,
  COALESCE(delivery_eta_at, estimated_delivery_at, scheduled_delivery_at), created_at
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_fulfillments f WHERE f.order_id=o.id);
COMMIT;
