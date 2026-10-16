-- Etapa 2C: fila de reembolsos (aprovação pelo dono, devolução manual)
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS due_at TIMESTAMP;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS approved_amount NUMERIC(14,2);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS decision_reason TEXT;
UPDATE refunds SET due_at = created_at + INTERVAL '24 hours' WHERE due_at IS NULL AND status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS idx_refunds_status_due ON refunds(status, due_at);
