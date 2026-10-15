# Relatório final — DeepShop Delivery

**Data:** 15/10/2026  
**Escopo:** continuação do projeto recebido, com foco em entrada de estoque pelo formulário, custo médio ponderado, padronização de lucro e ajustes da sacola.

## 1. Resumo

Implementado o fluxo de aumento/redução de estoque pelo formulário de edição de produto. A entrada pode usar o custo atual, outro custo unitário ou o total da nova compra. O custo médio ponderado, o estoque e o movimento são gravados na mesma transação, com bloqueio pessimista da linha e resposta `409` em concorrência.

Também foi criada uma fonte server-side para os cenários de lucro normal e promocional. O ranking, o resumo agregado e a tabela de produtos deixam de tratar o estoque inteiro como uma única venda promocional limitada. Prejuízos continuam negativos e são exibidos com indicação visual de prejuízo.

O contador da sacola já tinha a decisão desejada no código: mostra a quantidade total de unidades na sacola, incluindo itens desmarcados. O resumo do checkout continua considerando apenas os itens marcados.

## 2. Arquivos alterados/criados nesta sessão

- `src/server/routes/adminPhase2Routes.ts`
  - edição de produto aceita mudança de estoque;
  - cálculo de custo médio ponderado em entrada;
  - registro de `inventory_movements`;
  - bloqueio `FOR UPDATE` e conflito `409`;
  - redução a zero torna o produto inativo automaticamente.
- `src/server/services/profitService.ts` (novo)
  - fonte única para lucro normal/promocional no estoque.
- `src/server/routes/adminRoutes.ts`
  - analytics e endpoint de custo usam a nova fonte;
  - payload inclui lucro normal e promocional;
  - resumo inclui `potentialInventoryPromoProfit`.
- `src/pages/AdminPanelPage.tsx`
  - estados e payload do custo da nova compra;
  - chave idempotente para movimento de estoque pelo formulário.
- `src/components/admin/AdminProductsSection.tsx`
  - campo de estoque editável;
  - bloco de custo da nova compra;
  - tabela mostra normal e promo separadamente.
- `src/components/admin/AdminProfitRankingSection.tsx`
  - exibe cenários normal/promo;
  - não converte prejuízo em lucro zero;
  - mostra rótulo de prejuízo e resumo agregado separado.
- `tests/profitSimulation.test.ts`
  - cobertura ampliada para estoque zero, lote diferente do estoque e promoção abaixo do custo.
- `RELATORIO_FINAL_2026-10-15.md` (este arquivo).

## 3. Ambiente

- Sistema: Ubuntu 24.04 no sandbox.
- Node.js: `v22.13.0`.
- npm: `10.9.2`.
- PostgreSQL: `16.15`.
- Banco descartável: `deepshop_final_test`.
- Usuário sintético: `deepshop_test`.
- Ambiente: `NODE_ENV=development`, credenciais sintéticas, `SEED_INITIAL_CATALOG=false`, sem Mercado Pago/CallMeBot.
- O banco foi criado localmente, a migration oficial foi aplicada e a aplicação foi executada em `127.0.0.1:3100`.
- O servidor local continuou ativo apenas durante a validação; o banco e o servidor serão removidos/encerrados antes da entrega final.

## 4. Evidências e casos de teste

| ID | Cenário | Esperado | Obtido | Resultado | Evidência |
|---|---|---|---|---|---|
| U1 | Simulação lote R$ 19,99 / 12 un.; normal R$ 8,90; promo R$ 7,49; estoque 12 | Normal R$ 86,81 e promo R$ 69,89 | Valores exatos | ✅ | `tests/profitSimulation.test.ts` |
| U2 | Prejuízo unitário | Resultado negativo preservado | `-R$ 12,50` por unidade e `-R$ 125,00` no estoque | ✅ | `tests/profitSimulation.test.ts` |
| U3 | Custo médio: 12 × 1,665833 + entrada 12 × R$ 2,00 | Média `1,832917` | Média e lucro do estoque corretos | ✅ | `tests/profitSimulation.test.ts` |
| U4 | Estoque zero | Custo da entrada integral | Custo médio igual ao custo da entrada | ✅ | `tests/profitSimulation.test.ts` |
| U5 | Lote com quantidade diferente do estoque | Divisão pelo número do lote, não pelo estoque | 12 unidades de lote e estoque 7 processados corretamente | ✅ | `tests/profitSimulation.test.ts` |
| U6 | Promoção inválida igual/superior ao normal | Promoção ignorada | Promoção ignorada | ✅ | `tests/profitSimulation.test.ts` |
| U7 | Arredondamento de 3, 7 e 11 unidades com limite 1 | `47,47`, `127,43`, `207,39` | Valores exatos | ✅ | `tests/profitSimulation.test.ts` |
| A1 | Criar produto via API com custo preciso/lote | Persistir estoque e campos de custo | `12`, `1.665833`, `19.99`, `12` | ✅ | PostgreSQL descartável + resposta HTTP 201 |
| A2 | Editar apenas preço/nome | Não alterar custo/lote | Antes/depois: `12|1.665833|19.99|12` | ✅ | Consulta SQL descartável |
| A3 | Aumentar estoque pelo formulário com total de compra R$ 24,00 / 12 | Média `1.832917`, estoque 24 e movimento | Obtido; movimento `MANUAL_ENTRY` registrado | ✅ | API HTTP 200 + consulta SQL |
| A4 | Aumentar estoque usando “mesmo custo” | Custo médio inalterado | Estoque aumentou e `1.832917` permaneceu | ✅ | API HTTP 200 + consulta SQL |
| A5 | Custo de compra negativo | Rejeitar com 400 | HTTP 400, sem alteração no banco | ✅ | API local |
| A6 | Duas edições concorrentes | Apenas uma alteração aplicada; outra 409 | Uma HTTP 200, outra HTTP 409; estoque final de uma operação | ✅ | Duas requisições simultâneas + SQL |
| A7 | Analytics com cenários normal/promo | Dois valores no payload | `normalStockProfit` e `promoStockProfit` retornados | ✅ | `/api/admin/analytics/products` |
| A8 | DDL em banco já migrado, duas inicializações | Sem erro de schema | Inicialização repetida completou sem erro; segunda porta falhou apenas por `EADDRINUSE` porque o primeiro servidor já estava ativo | ⚠️ | `/tmp/deepshop-reboot.log` |
| T1 | Testes unitários completos | Todos passarem | 11/11 passaram | ✅ | `npx tsx --test tests/*.test.ts` |
| Q1 | Lint | Sem erros | Passou | ✅ | `npm run lint` |
| Q2 | Build | Sem erros novos | Passou | ✅ | `npm run build` |
| Q3 | Smoke test de suporte | Executar se possível | Não executado nesta sessão | ⚠️ | Script existente, sem evidência de execução |
| E1 | Playwright desktop/mobile completo | Screenshots de todas as etapas | Não executado | ⚠️ | Chromium não disponível em `/opt/pw-browsers` |

## 5. Linha de base × final

| Verificação | Linha de base | Final |
|---|---:|---:|
| `npm ci` | ✅ Passou; 182 pacotes, 0 vulnerabilidades | Dependências mantidas pelo lockfile |
| `npm run lint` | ✅ Passou | ✅ Passou |
| `npm run build` | ✅ Passou | ✅ Passou |
| Testes unitários | 8/8 no relatório anterior | 11/11 nesta sessão |

Os avisos conhecidos do Vite permanecem: uso de `__dirname` no config loader e chunk JavaScript acima de 500 kB. Não foram introduzidos erros de compilação.

## 6. Pendências e riscos

1. O E2E visual completo em desktop `1280×800` e mobile `390×844` não foi executado por ausência do Chromium no caminho especificado. Não há screenshots novas; não declarar os cenários E2E como aprovados.
2. `support-chat-smoke.mjs` não foi executado.
3. Não foram completados nesta sessão todos os cenários de borda visuais: promoção expirada com item na sacola, produto arquivado, redução de estoque abaixo da quantidade da sacola, duplicidade visual de cards, kit completo pelo navegador e persistência visual em `localStorage`.
4. A regra do badge da sacola foi confirmada por inspeção: totaliza todas as unidades, incluindo desmarcadas. Não foi coberta por E2E nesta sessão.
5. A rota antiga duplicada em `adminRoutes.ts` permanece no código, mas não é a rota efetiva para edição porque `adminPhase2Routes.ts` é registrado antes. Recomenda-se futura limpeza da duplicidade, fora do escopo imediato para evitar regressão.

## 7. Passo a passo seguro para a VPS

1. Fazer backup antes da troca:
   ```bash
   pg_dump -Fc -d "$DATABASE_URL" -f backup-pre-deepshop-$(date +%F-%H%M).dump
   pg_restore -l backup-pre-deepshop-*.dump > backup-pre-deepshop-$(date +%F-%H%M).list
   ```
2. Copiar o ZIP para uma pasta de release nova. Manter o `.env` da VPS fora do ZIP e não sobrescrevê-lo.
3. Conferir o diff e confirmar que as migrations são aditivas. Não apagar colunas existentes.
4. Na pasta da nova release:
   ```bash
   npm ci
   npm run lint
   npm run build
   ```
5. Trocar o symlink ou diretório de release conforme o procedimento operacional da VPS e reiniciar o serviço.
6. Checklist de cinco minutos:
   - `GET /api/storefront` responde;
   - login administrativo funciona;
   - editar somente preço preserva custo/lote;
   - aumentar estoque com custo atual preserva o custo médio;
   - aumentar estoque com custo de lote cria movimento e recalcula média;
   - simular 3 unidades com limite 1 confere preço promo + preço normal;
   - conferir no banco o `unit_cost` de um pedido de teste controlado.
7. Para reverter código, voltar à release anterior. Como a alteração de banco é aditiva, não remover colunas para reverter o código. Restaurar o dump somente após avaliação operacional e se houver corrupção de dados.

## 8. Higiene de entrega

O ZIP final deve excluir `.env`, `node_modules`, `dist` e `dist-server`. O PostgreSQL de teste e os arquivos temporários de ambiente não fazem parte da entrega.

## 9. Correção posterior (revisão independente) — formulário desatualizado
Problema: o formulário de edição de produto enviava o estoque que carregou ao abrir; se uma venda ocorresse com o formulário aberto, salvar (mesmo só o preço) tratava o valor antigo como "entrada" e devolvia ao estoque unidades já vendidas, além de poder sobrescrever o custo médio com valor antigo.
Correção: `AdminPanelPage.tsx` agora envia `expectedStock` (saldo carregado) e `PUT /api/admin/products/:id` (`adminPhase2Routes.ts`) responde **409** com a mensagem "O estoque deste produto mudou de X para Y un. desde que você abriu o formulário…" quando o saldo real for diferente. Requisições sem `expectedStock` só são aceitas se o estoque enviado for igual ao atual (400 caso contrário).
Status do teste: a correção foi verificada apenas por revisão de código e checagem de sintaxe; **lint/build e teste automatizado desta correção ainda não foram executados** (ambiente sem acesso ao registro npm). Executar `npm ci && npm run lint && npm run build` e o teste manual: abrir produto → vender 1 un. em outra aba → salvar o formulário → deve aparecer o erro 409 e o estoque não pode voltar.
