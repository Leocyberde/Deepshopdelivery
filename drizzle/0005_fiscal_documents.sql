-- NF-e emitida sob demanda por pedido (botão no painel). Idempotente e não destrutivo.
CREATE TABLE IF NOT EXISTS fiscal_documents (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PROCESSING', -- PROCESSING | AUTHORIZED | REJECTED | ERROR
  environment TEXT NOT NULL,                  -- HOMOLOGACAO | PRODUCAO
  serie INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  access_key TEXT,
  protocol TEXT,
  rejection_code TEXT,
  rejection_message TEXT,
  payload JSONB,
  xml_authorized TEXT,
  danfe_pdf_base64 TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  authorized_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE SEQUENCE IF NOT EXISTS nfe_numero_homologacao_seq START 1;
CREATE SEQUENCE IF NOT EXISTS nfe_numero_producao_seq START 1;
