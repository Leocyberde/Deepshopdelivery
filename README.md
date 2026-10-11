# DeepShop (loja própria)

React/Vite + Express + Drizzle ORM + **PostgreSQL**. Uma loja, pagamento por Pix e pedido pelo WhatsApp.

## Instalação
1. `npm install`
2. `cp .env.example .env` e preencha as variáveis (veja abaixo).
3. Crie o banco e aplique a migration oficial em um PostgreSQL vazio:
   `createdb -h "$PGHOST" -U "$PGUSER" "$PGDATABASE"`
   `psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f drizzle/0000_achadinhos_production_schema.sql`
4. Desenvolvimento: `npm run dev`.
5. Produção: `npm run build` e `npm start` (roda `dist-server/server.js` com `NODE_ENV=production`).

A aplicação conecta ao PostgreSQL com `DATABASE_URL` ou com `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` e `PGPASSWORD`. Não há fallback para PGlite. A inicialização do backend também executa DDL idempotente de compatibilidade/evolução do schema; a migration SQL oficial continua sendo a forma documentada de criar o banco do zero.

## Variáveis
| Variável | Para quê |
|---|---|
| `DATABASE_URL` ou `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | Conexão do PostgreSQL. Mantenha credenciais fora do código. |
| `PGSSL`, `PGSSL_REJECT_UNAUTHORIZED` | TLS da conexão (habilite conforme a configuração do servidor). |
| `PGPOOL_MAX` | Limite de conexões do pool node-postgres (padrão 10). |
| `JWT_SECRET` | Obrigatório em produção, mínimo 32 caracteres. Sem ele o servidor não inicia. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Criam o primeiro admin (senha com 10+ caracteres) quando não há admin. |
| `SITE_URL` | URL-base absoluta do site. Em produção exige HTTPS e host não local; aceita somente a raiz (`/` opcional), sem credenciais, path adicional, query ou fragmento. CORS permite apenas a origin exata, sem wildcard nem credentials. |
| `PORT`, `NODE_ENV`, `TRUST_PROXY` | Porta, ambiente e quantidade de proxies reversos. |
| `MERCADOPAGO_MODE`, `MERCADOPAGO_TEST_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | Checkout Pro via Orders (sandbox). Use credenciais do usuário de teste; webhook com evento "Order (Mercado Pago)". |
| `MERCADOPAGO_SANDBOX_PAYER_EMAIL` | E-mail do comprador de teste (`...@testuser.com`). Obrigatório em sandbox quando o cliente não tem e-mail @testuser.com (a API recusa outros com `invalid_email_for_sandbox`). |
| `BACKUP_DIR` | Backups (snapshots e dump diário). Mantenha fora do projeto e da pasta pública. |
| `CALLMEBOT_PHONE` / `CALLMEBOT_APIKEY` | Credenciais do CallMeBot para avisos de novo pedido e lembrete único após 10 minutos. Ative o recurso nas Configurações do Admin. |

## Banco de dados
PostgreSQL é o banco-alvo oficial, em processo/servidor independente da aplicação. PGlite não é usado pelo runtime. A compatibilidade deve ser validada contra PostgreSQL real, e não apenas por compilação de TypeScript.

## Validação CORS e SITE_URL
Em produção, o backend não inicia sem `SITE_URL` HTTPS absoluta e não local. O middleware compara a origin integralmente, responde somente à origin configurada e limita preflight a `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` e aos headers `Content-Type`/`Authorization`; não habilita `Access-Control-Allow-Credentials`. Para executar a suíte integrada (startup fail-closed, CORS, APIs autenticadas e Chromium desktop/mobile), use um banco PostgreSQL descartável cujo nome contenha `test`/`testing` e defina `CORS_TEST_DATABASE_URL`, por exemplo: `CORS_TEST_DATABASE_URL=postgres://usuario:senha@127.0.0.1:5432/achadinhos_phase4_cors_test npm run test:preop:cors-site-url`. A suíte grava contas/fixtures sintéticas nesse banco; não a execute contra produção.

## Backup e restauração
- Dump SQL diário em `BACKUP_DIR/daily/achadinhos-AAAA-MM-DD.sql` (retenção de 14 dias).
- Snapshot JSON em `BACKUP_DIR/snapshots/` (espera de 60 s após alterações; guarda os 5 últimos).
- Restaurar: painel Admin > restaurar JSON (bloqueado em produção), ou copie um snapshot para `BACKUP_DIR/snapshots/achadinhos_snapshot_latest.json` e suba o servidor com o banco vazio.
- Copie `BACKUP_DIR` para fora do servidor (rclone, rsync ou outro). Isso não é feito pelo código.

## Validação PostgreSQL/backup
Com um banco PostgreSQL de teste vazio/migrado e `DATABASE_URL` apontando para ele, execute `npm run test:preop:postgresql-backup -- product-edit` para testar login admin sintético e criação/edição de produto por API. Para o ciclo JSON, execute `npm run test:preop:postgresql-backup -- export /tmp/achadinhos-backup.json`, depois aponte `DATABASE_URL` para outro banco vazio/migrado e execute `npm run test:preop:postgresql-backup -- restore /tmp/achadinhos-backup.json`. Para export SQL real, use `npm run test:preop:postgresql-backup -- sql-export /tmp/achadinhos-backup.sql` e importe-o com `psql -v ON_ERROR_STOP=1 -f /tmp/achadinhos-backup.sql` em um banco de teste vazio/migrado. Para testar diretórios, modos 0700/0600, rejeição de payloads inválidos e rollback atômico após falha de integridade, defina também `BACKUP_DIR` fora do projeto e `BACKUP_DEBOUNCE_MS=50`, e execute `npm run test:preop:postgresql-backup -- security`. Esses comandos escrevem dados sintéticos: não os execute em banco de produção.

## Evidências legadas
Scripts/evidências de fases anteriores que mencionam PGlite são históricas e não fazem parte do runtime PostgreSQL. As suítes antigas foram rotuladas `test:legacy:pglite:*`; não são alvo das validações atuais e podem conter expectativas PGlite obsoletas. Alguns harnesses também herdam `DATABASE_URL` do processo e podem gravar dados sintéticos no banco apontado: execute-os somente com uma base PostgreSQL descartável e nunca com credenciais/dados de produção. Um teste histórico criava um arquivo sintético `postmaster.pid` somente dentro de seu diretório temporário; isso não representa nem acessa `PGDATA` real. **Nunca aponte esses testes para `PGDATA` nem manipule o `postmaster.pid` do servidor.**

## HTTPS
Coloque Nginx ou Caddy na frente (HTTPS e redirecionamento) e defina `TRUST_PROXY=1`.
