-- Dados fiscais do produto para emissão de NF-e. Idempotente e não destrutivo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS fiscal_ncm TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fiscal_cfop TEXT NOT NULL DEFAULT '5102';
ALTER TABLE products ADD COLUMN IF NOT EXISTS fiscal_origem TEXT NOT NULL DEFAULT '0';
ALTER TABLE products ADD COLUMN IF NOT EXISTS fiscal_csosn TEXT NOT NULL DEFAULT '102';
ALTER TABLE products ADD COLUMN IF NOT EXISTS fiscal_unidade TEXT NOT NULL DEFAULT 'UN';
