# Relatório de implementação — DeepShop Delivery

**Data:** 15/10/2026
**Escopo:** custos por lote e lucro real, limite de unidades promocionais por pedido, seleção/precificação da sacola e salvaguardas de pedido.

## 1. Resumo (5 linhas)

1. Acrescentei persistência para custo unitário com 6 casas decimais e metadados da última compra em lote; a migration é aditiva/idempotente.
2. Implementei média ponderada do custo em entradas de estoque, mantendo saídas/ajustes sem custo informado fora desse recálculo.
3. Centralizei a simulação financeira, incluindo prejuízos reais, preço normal/promo e limite da oferta; a UI administrativa usa a simulação.
4. A sacola/checkout passam a calcular apenas itens selecionados, separar unidades promo/normal e deixar o servidor revalidar preço, limite e estoque.
5. Testes unitários, API, concorrência e round-trip SQL passaram; o E2E completo, a validação final pós-última edição e alguns casos de borda ficaram pendentes.

### Arquivos alterados/criados

- `drizzle/0000_achadinhos_production_schema.sql`
- `src/db/schema.ts`, `src/db/index.ts`, `src/db/backup.ts`
- `src/types/app.ts`
- `src/utils/formatters.ts`, `src/utils/profitSimulation.ts` **(novo)**
- `src/server/services/storeHelpers.ts`
- `src/server/routes/adminRoutes.ts`, `src/server/routes/adminPhase2Routes.ts`, `src/server/routes/orderRoutes.ts`
- `src/context/AppContext.tsx`
- `src/pages/AdminPanelPage.tsx`, `src/pages/CartPage.tsx`, `src/pages/CheckoutPage.tsx`, `src/pages/StorefrontPage.tsx`
- `src/components/admin/AdminProductsSection.tsx`, `AdminInventorySection.tsx`, `AdminProfitRankingSection.tsx`
- `tests/profitSimulation.test.ts` **(novo)**

## 2. Ambiente de teste

- Node.js 22.x no sandbox; PostgreSQL **16.15** (Ubuntu 16.15-0ubuntu0.24.04.1).
- Criei o banco isolado `deepshop_feature_test`, apliquei a migration e rodei a aplicação local com administrador/cliente sintéticos. Para o round-trip, o dump gerado pelo próprio exportador da aplicação foi importado em `deepshop_feature_restore`.
- Não usei banco, credenciais, gateway ou pagamentos de produção. O pedido sintético foi criado no banco de teste e cancelado; a concorrência também foi cancelada e o saldo recomposto.
- A pedido do utilizador, parei a validação, encerrei o servidor/proxy temporários e removi `.env` de teste. O ZIP exclui `.env`, `node_modules`, `dist` e `dist-server`.

## 3. Casos executados

| ID | Cenário | Esperado | Obtido | Resultado | Evidência |
|---|---|---|---|---|---|
| U1 | Custo R$ 19,99, venda R$ 7,49, estoque 10 | Prejuízo unitário R$ 12,50; total −R$ 125,00 | Simulação conserva resultado negativo | ✅ | `tests/profitSimulation.test.ts` |
| U2 | Custo R$ 5,00, venda R$ 10,00, estoque 10, sem promo | Lucro unitário R$ 5,00; margem 50%; total R$ 50,00 | Valores esperados | ✅ | `tests/profitSimulation.test.ts` |
| U3 | Promo R$ 7,49, normal R$ 19,99, limite 1, custo R$ 5,00 | Exibir cenários normal e promo | Coberto pela simulação compartilhada | ✅ | `tests/profitSimulation.test.ts` |
| U4 | Limite 1, quantidade 3; ainda com centavos para 7 e 11 | R$ 47,47; R$ 127,43; R$ 207,39 | Valores exatos | ✅ | Teste unitário de preço por linha |
| U5 | Promo igual/superior ao preço normal | Ignorar promo inválida | Promo ignorada | ✅ | `tests/profitSimulation.test.ts` |
| U6 | Entrada de 12 unidades a R$ 2,00, saldo anterior 12 a R$ 1,665833 | Média R$ 1,832917; estoque 24; custo total R$ 43,99 | API gravou 1,832917; lucro normal do cenário R$ 169,61 | ✅ | SQL do banco descartável e teste unitário |
| A1 | Criar produto com custo unitário preciso, dados do lote e limite 1 | Persistir todos os campos | Após corrigir a rota phase2 que efetivamente atende o POST, campos persistidos | ✅ | POST API + consulta PostgreSQL |
| A2 | Limite promocional 0, negativo, decimal ou texto | Rejeitar entrada | Todos responderam HTTP 400 | ✅ | Teste API local |
| A3 | Pedido de 3 un. a R$ 19,99, promo R$ 7,49, limite 1; body envia preço e limite falsos | Servidor cobra R$ 47,47, em duas linhas | 1 × R$ 7,49 + 2 × R$ 19,99 = R$ 47,47; snapshot de custo veio do produto | ✅ | Resposta API e `orders`/`order_items` |
| A4 | Quantidade negativa, decimal, string decimal e maior que estoque | Rejeitar; não confiar no preço do cliente | Todas as tentativas responderam HTTP 400 | ✅ | Teste API local |
| A5 | Dois pedidos concorrentes, 6 un. cada, estoque 10 | No máximo um pedido confirmado | Um HTTP 201, outro 400; saldo caiu para 4 e voltou a 10 após cancelamento | ✅ | Log API + consulta PostgreSQL |
| B1 | Exportação e restauração SQL com produto promo/custo por lote | Restaurar limite e custos | Produto restaurado com limite 1, custo preciso 1,832917, lote R$ 24,00/12 un. | ✅ | `deepshop_feature_restore` (descartado ao finalizar) |
| V1 | Vitrine desktop: seletor, 3 unidades, limite 1 | Mostrar subtotal R$ 47,47 e excedente pelo preço normal | Modal mostrou 1 × R$ 7,49 + 2 × R$ 19,99 = R$ 47,47; item adicionado | ⚠️ Parcial | [Captura do seletor desktop](evidencias/seletor-quantidade-desktop.webp) |
| V2 | Sacola/checkout em desktop e mobile; pedido pelo fluxo visual | Validar todas as etapas e viewports | Não concluído — execução interrompida a pedido do utilizador | ⏳ | Não há screenshot dessas etapas |

**Testes unitários:** 8/8 passaram depois de corrigir o empate de arredondamento na sexta casa da média ponderada.
**Migration/backup:** migration executada no banco descartável; round-trip do SQL do exportador confirmou limite e custos de lote.

## 4. Lint, build e testes preexistentes

| Verificação | Antes das alterações | Depois | Observação |
|---|---|---|---|
| `npm run lint` | Passou | Passou às 15:24; **não repetido após a última alteração pequena na rota phase2** | Recomendo repetir antes de deploy |
| `npm run build` | Passou | Passou às 15:24; **não repetido após o ajuste de arredondamento/última alteração da rota** | Recomendo repetir antes de deploy |
| `npx tsx --test tests/profitSimulation.test.ts` | Não havia este teste | 8/8 passaram às 15:24 | Não requer nova dependência |
| `support-chat-smoke.mjs` | Não executado | Não executado | Fora do foco da feature; não foi rodado antes nem depois |
| Playwright E2E completo | Não executado | Parcial inspeção visual desktop | Chromium não estava disponível no caminho informado; a inspeção visual usou a pré-visualização do browser e foi interrompida a pedido do utilizador |

O build apresentou avisos preexistentes do Vite sobre `__dirname`/config loader e tamanho de chunk acima de 500 kB; não houve erro de build na execução registrada.

## 5. Pendências, riscos e limitações

1. Reexecutar **`npm run lint` e `npm run build`** no ZIP/fonte final, pois a pessoa utilizadora pediu para parar antes dessa última verificação.
2. Completar E2E com Playwright em desktop **1280×800** e mobile **390×844**: formulário/admin ranking, listagem, sacola, checkout, pedido, promoção sem limite, sem promoção e kit.
3. Executar cenários restantes: promoção expirada/desativada, produto arquivado/inativo, redução de estoque abaixo da sacola, produto duplicado em cards/carrosséis, criação/edição de kit e quantidade = estoque.
4. Executar `support-chat-smoke.mjs` no ambiente isolado apropriado, caso seja requisito de release.
5. A pré-visualização temporária foi encerrada; o link de teste não permanece ativo.

**Defeito dentro do escopo encontrado e corrigido:** havia duas rotas de criação de produto, e a rota phase2 registrada primeiro não persistia os campos de custo preciso/lote mesmo que o normalizador os calculasse. O insert foi atualizado e a criação foi repetida com sucesso.

## 6. Aplicação segura na VPS

1. **Faça backup antes de alterar código ou banco**, por exemplo `pg_dump -Fc -d "$DATABASE_URL" -f backup-pre-custos-promos-$(date +%F-%H%M).dump`, e confirme que o arquivo pode ser lido (`pg_restore -l`).
2. Envie o ZIP ao servidor e extraia numa pasta de release nova; preserve o `.env`/segredos atuais da VPS fora do ZIP. O ZIP não inclui `.env` nem `node_modules`.
3. Compare as alterações e mantenha a migration do projeto. As novas colunas usam evolução aditiva/`ADD COLUMN IF NOT EXISTS`; não há drop/renomeação de colunas.
4. Instale dependências conforme o lockfile (`npm ci`) se necessário; execute `npm run lint` e `npm run build` antes de trocar o serviço.
5. Faça a troca/restart do serviço conforme o nome configurado no seu host (ex.: `sudo systemctl restart deepshop`); verifique logs de inicialização e conexão PostgreSQL.
6. Checklist de 5 minutos: `/api/storefront` responde; criar/editar produto de staging com custo e limite; registrar entrada de estoque com custo; conferir média; simular 3 unidades com limite 1 (1 promo + 2 normais); criar um pedido de teste/staging e confirmar o subtotal revalidado no banco.
7. Se houver regressão de aplicação, volte à release/código anterior. Como a alteração de banco é aditiva, não remova colunas para reverter; restaure o backup apenas se houver corrupção de dados e após avaliação operacional.
