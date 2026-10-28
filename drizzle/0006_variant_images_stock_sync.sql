-- Foto por variação (modelo) e saldo total do produto = soma dos saldos das variações.
-- Idempotente e não destrutivo.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url TEXT;

UPDATE products p
SET stock = v.total, updated_at = NOW()
FROM (SELECT product_id, COALESCE(SUM(stock), 0)::int AS total FROM product_variants WHERE status = 'ACTIVE' GROUP BY product_id) v
WHERE p.id = v.product_id AND p.is_kit = FALSE AND p.stock <> v.total;
