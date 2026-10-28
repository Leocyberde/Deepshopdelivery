-- Produto sem reposição: ao zerar o estoque geral, é arquivado e sai da vitrine (sem encomenda).
ALTER TABLE products ADD COLUMN IF NOT EXISTS archive_on_stockout BOOLEAN NOT NULL DEFAULT FALSE;
