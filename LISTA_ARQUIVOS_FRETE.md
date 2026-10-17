# Inventário de arquivos e schema

**Base de comparação:** ZIP original `Deepshopdelivery-main(2).zip`.

## Criados

- `DEPLOY_VPS.md`
- `ESCLARECIMENTOS_FRETE.md`
- `LISTA_ARQUIVOS_FRETE.md`
- `MATRIZ_TESTES_FRETE.md`
- `RELATORIO_FINAL_FRETE_AUTOMATICO.md`
- `docs/evidencias/npm-run-build.txt`
- `docs/evidencias/npm-run-lint.txt`
- `docs/evidencias/npm-run-test-integration-1.txt`
- `docs/evidencias/npm-run-test-integration-2.txt`
- `docs/evidencias/npm-test.txt`
- `docs/historico/RELATORIO_CORRECOES.md`
- `docs/historico/RELATORIO_FINAL_2026-10-15.md`
- `docs/historico/RELATORIO_IMPLEMENTACAO_2026-10-15.md`
- `docs/historico/RELATORIO_REBRANDING_DEEPSHOP.md`
- `drizzle/0003_automatic_freight.sql`
- `src/components/FreightQuoteSummary.tsx`
- `src/components/admin/AdminAutomaticFreightSettings.tsx`
- `src/components/admin/AdminNotificationsDrawer.tsx`
- `src/db/freightDdl.ts`
- `src/server/routes/geoAdminRoutes.ts`
- `src/server/services/distanceProvider.ts`
- `src/server/services/freeDeliveryBenefits.ts`
- `src/server/services/freightConfig.ts`
- `src/server/services/freightSettingsValidation.ts`
- `src/server/services/geoService.ts`
- `src/server/services/legacyFreightService.ts`
- `src/utils/freightSettingsPayload.ts`
- `tests/automaticFreight.test.ts`
- `tests/integration/automaticFreight.test.ts`

## Alterados

- `server.ts`
- `src/components/admin/AdminCustomersSection.tsx`
- `src/components/admin/AdminDashboardSection.tsx`
- `src/components/admin/AdminOrdersSection.tsx`
- `src/components/admin/AdminSettingsSection.tsx`
- `src/components/ui/LogisticsFlowIllustration.tsx`
- `src/db/backup.ts`
- `src/db/index.ts`
- `src/db/schema.ts`
- `src/pages/AdminPanelPage.tsx`
- `src/pages/AuthPage.tsx`
- `src/pages/CartPage.tsx`
- `src/pages/CheckoutPage.tsx`
- `src/pages/CustomerAccountPage.tsx`
- `src/pages/StorefrontPage.tsx`
- `src/server/governance.ts`
- `src/server/routes/addressRoutes.ts`
- `src/server/routes/adminPhase2Routes.ts`
- `src/server/routes/adminRoutes.ts`
- `src/server/routes/authRoutes.ts`
- `src/server/routes/orderRoutes.ts`
- `src/server/services/loyaltyService.ts`
- `src/server/services/storeHelpers.ts`
- `src/services/freightService.ts`
- `src/utils/whatsapp.ts`

## Removidos ou movidos da raiz

- `RELATORIO_CORRECOES.md`
- `RELATORIO_FINAL_2026-10-15.md`
- `RELATORIO_IMPLEMENTACAO_2026-10-15.md`
- `RELATORIO_REBRANDING_DEEPSHOP.md`
- `src/components/admin/AdminFreightModal.tsx`
- `src/components/admin/AdminNewCustomerAlert.tsx`

## Migration `drizzle/0003_automatic_freight.sql`

```sql
-- Non-destructive; safe to run repeatedly. Historical tickets and manual fees remain untouched.
CREATE TABLE IF NOT EXISTS geo_distance_cache (
  cache_key TEXT PRIMARY KEY, origin_text TEXT NOT NULL, destination_text TEXT NOT NULL,
  distance_meters INTEGER NOT NULL CHECK (distance_meters >= 0), duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  provider TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS geo_api_usage (month TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0));
CREATE TABLE IF NOT EXISTS geo_lookup_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_geo_lookup_user_created ON geo_lookup_log(user_id, created_at);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS delivery_cache_key TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS delivery_in_area BOOLEAN;
CREATE TABLE IF NOT EXISTS freight_legacy_runs (
  id TEXT PRIMARY KEY, actor_user_id INTEGER REFERENCES users(id), plan JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), executed_at TIMESTAMP, result JSONB
);
INSERT INTO settings (key, value) VALUES
 ('freight_free_band1_enabled','false'), ('freight_free_band1_min_required','false'), ('freight_free_band1_min_value','0'),
 ('freight_free_band2_enabled','false'), ('freight_free_band2_min_value','90'),
 ('geo_monthly_limit','35000'), ('geo_warn_at','25000'), ('freight_max_km','20'), ('freight_out_of_area_whatsapp','11910509385')
ON CONFLICT (key) DO NOTHING;
```

## Tabelas novas ou relacionadas

| Tabela | Finalidade |
|---|---|
| `geo_distance_cache` | Cache por origem/destino, distância, duração, provider e `hit_count`. |
| `geo_api_usage` | Contador mensal atômico de chamadas geográficas. |
| `geo_lookup_log` | Controle de misses por usuário em janela de 24 horas. |
| `freight_legacy_runs` | Plano, execução e replay idempotente da migração de pedidos antigos. |
| `admin_event_keys` | Idempotência de avisos de cota e eventos administrativos. |
| `admin_notifications` | Avisos administrativos de cota e operação. |
| `admin_audit_logs` | Auditoria das alterações administrativas. |

A migration também adiciona `addresses.delivery_cache_key` e `addresses.delivery_in_area`.

## Settings novas ou usadas pelo frete

| Setting | Função |
|---|---|
| `freight_free_band1_enabled` | Ativa a faixa 1. |
| `freight_free_band1_min_required` | Exige mínimo na faixa 1. |
| `freight_free_band1_min_value` | Valor mínimo da faixa 1. |
| `freight_free_band2_enabled` | Ativa a faixa 2. |
| `freight_free_band2_min_value` | Valor mínimo da faixa 2. |
| `geo_monthly_limit` | Limite mensal de chamadas. |
| `geo_warn_at` | Limiar de aviso. |
| `freight_max_km` | Distância máxima atendida. |
| `freight_out_of_area_whatsapp` | Telefone usado na mensagem de fora da área. |
| `freight_base_km`, `freight_base_fee`, `freight_extra_km_fee` | Parâmetros da fórmula de frete já persistidos pelo sistema. |
| `store_origin_address` | Origem usada na chave/cache e no provider. |
