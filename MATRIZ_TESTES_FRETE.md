# Matriz de testes — frete automático

**Data das evidências:** 17/10/2026 UTC (16/10/2026 no fuso do usuário).
**Fonte:** arquivos brutos em `docs/evidencias/`. Cada linha abaixo aponta para a linha real do TAP capturado. Nenhum item de limitação é marcado como PASS.

## Testes executados

| ID | Status | Nome/descrição real do teste | Linha real da saída |
|---|---|---|---|
| U01 | PASS | frete normal 0 km = 7.5 | `npm-test.txt:10` |
| U02 | PASS | frete normal 3 km = 7.5 | `npm-test.txt:15` |
| U03 | PASS | frete normal 4 km = 7.5 | `npm-test.txt:20` |
| U04 | PASS | frete normal 5 km = 9 | `npm-test.txt:25` |
| U05 | PASS | frete normal 6.5 km = 11.25 | `npm-test.txt:30` |
| U06 | PASS | frete normal 10 km = 16.5 | `npm-test.txt:35` |
| U07 | PASS | frete normal 15.01 km = 24.02 | `npm-test.txt:40` |
| U08 | PASS | frete normal 20 km = 31.5 | `npm-test.txt:45` |
| U09 | PASS | faixa 1 desligada + faixa 2 ligada: 2km/50 = AUTO | `npm-test.txt:50` |
| U10 | PASS | faixa 1 desligada + faixa 2 ligada: 3km/120 = AUTO | `npm-test.txt:55` |
| U11 | PASS | faixa 1 desligada + faixa 2 ligada: 3.01km/89.99 = AUTO | `npm-test.txt:60` |
| U12 | PASS | faixa 1 desligada + faixa 2 ligada: 3.1km/89 = AUTO | `npm-test.txt:65` |
| U13 | PASS | faixa 1 desligada + faixa 2 ligada: 3.1km/90 = FREE_BAND_2 | `npm-test.txt:70` |
| U14 | PASS | faixa 1 desligada + faixa 2 ligada: 10km/120 = FREE_BAND_2 | `npm-test.txt:75` |
| U15 | PASS | faixa 1 desligada + faixa 2 ligada: 15km/90 = FREE_BAND_2 | `npm-test.txt:80` |
| U16 | PASS | faixa 1 desligada + faixa 2 ligada: 15.01km/120 = AUTO | `npm-test.txt:85` |
| U17 | PASS | faixa 1 desligada + faixa 2 ligada: 20km/1000 = AUTO | `npm-test.txt:90` |
| U18 | PASS | faixas independentes: 1=false, 2=false | `npm-test.txt:95` |
| U19 | PASS | faixas independentes: 1=false, 2=true | `npm-test.txt:100` |
| U20 | PASS | faixas independentes: 1=true, 2=false | `npm-test.txt:105` |
| U21 | PASS | faixas independentes: 1=true, 2=true | `npm-test.txt:110` |
| U22 | PASS | faixa 1 mínimo inclusivo, subtotal 89.99 | `npm-test.txt:115` |
| U23 | PASS | faixa 1 mínimo inclusivo, subtotal 90 | `npm-test.txt:120` |
| U24 | PASS | faixa 1 mínimo inclusivo, subtotal 90.01 | `npm-test.txt:125` |
| U25 | PASS | sem mínimo faixa 1; km arredondados a duas casas | `npm-test.txt:130` |
| U26 | PASS | benefício tem prioridade, mas não autoriza distância ausente ou acima do máximo | `npm-test.txt:135` |
| U27 | PASS | mínimo não inclui frete: 85+frete >90 não concede; encomenda e promoção já entram no subtotal | `npm-test.txt:140` |
| U28 | PASS | distância ausente/NaN/infinita/negativa nunca concede frete | `npm-test.txt:145` |
| U29 | PASS | limite máximo configurável; mensagem e telefone configuráveis | `npm-test.txt:150` |
| U30 | PASS | cidade restrita com UF e sem aceitar nomes semelhantes; rua/bairro não criam nova chave | `npm-test.txt:155` |
| U31 | PASS | settings rejeitam strings numéricas, negativos, NaN e faixa 2 ativa sem mínimo | `npm-test.txt:160` |
| U32 | PASS | split delivery/encomenda respeita estoque e a opção de receber tudo como encomenda | `npm-test.txt:165` |
| U33 | PASS | janela de encomenda usa data local e atravessa mês/ano | `npm-test.txt:170` |
| U34 | PASS | totais cobram frete uma única vez e reembolso aplica regra de entrega | `npm-test.txt:175` |
| U35 | PASS | formatos de janela e promessa não usam contagem fixa de dias | `npm-test.txt:180` |
| U36 | PASS | delivery rápido calcula 19:00→22h e 19:20→22h20 no fuso local | `npm-test.txt:185` |
| U37 | PASS | delivery fora do horário passa para abertura do dia seguinte mais o prazo | `npm-test.txt:190` |
| U38 | PASS | borda 23:30 BRT usa data local e horário do servidor | `npm-test.txt:195` |
| U39 | PASS | F01 cadastro automático, cache CEP+número entre clientes e variações de rua, campos manipulados ignorados | `npm-test.txt:200` |
| U40 | PASS | F02 edição de complemento/bairro/apelido/rua não consulta; mudar número/CEP consulta | `npm-test.txt:205` |
| U41 | PASS | F03 trocar origem invalida distância salva, quote/pedido/listagem não consultam Google; retry recalcula | `npm-test.txt:210` |
| U42 | PASS | F04 consistência quote/pedido, preço promocional e todos itens/preorder contam mínimos; valores do front ignorados | `npm-test.txt:215` |
| U43 | PASS | F05 Itatiba apenas, fora da área salvo com distância; >20 bloqueia mesmo com benefício; 15-20 normal | `npm-test.txt:220` |
| U44 | PASS | F06 limite de 15 cache misses por 24h; 16º salva endereço sem distância e retorna 429 | `npm-test.txt:225` |
| U45 | PASS | F07 cota atômica inclusive falhas e avisos únicos por mês no limiar configurado | `npm-test.txt:230` |
| U46 | PASS | F08 single-flight: cinco cadastros simultâneos do mesmo destino usam uma chamada | `npm-test.txt:235` |
| U47 | PASS | F09 Google 403/429/ZERO_RESULTS/JSON inválido/timeout: sem distância/sem gratuidade; retry funciona | `npm-test.txt:240` |
| U48 | PASS | F10 permissões, propriedade, configurações validadas/persistentes/auditadas e rotas antigas 410 | `npm-test.txt:245` |
| U49 | PASS | F11 benefício em lote, data/revogação e auditoria; tickets antigos não concedidos/consumidos/alterados | `npm-test.txt:250` |
| U50 | PASS | F12 dry-run é somente leitura; execução libera Itatiba/cancela cidade e >limite/restaura estoque; pagos intocados; replay idempotente | `npm-test.txt:257` |
| U51 | PASS | B2/B6: lista enriquecida, status agregado, aviso e notificação do cliente | `npm-test.txt:281` |
| U52 | PASS | B6.1: lote ignora partes finalizadas e avisa no máximo uma vez por pedido | `npm-test.txt:289` |
| U53 | PASS | Autorização: cliente não usa rotas admin nem responde aviso de outro cliente | `npm-test.txt:305` |
| U54 | PASS | B7: atraso, WAIT/EXCHANGE/REFUND, travas e resposta idempotente | `npm-test.txt:322` |
| U55 | PASS | 2C: só o dono acessa a fila; valor limitado aos itens (sem frete); aprovar, travar entrega e marcar devolvido | `npm-test.txt:368` |
| U56 | PASS | 2C: recusa exige motivo, avisa o cliente e mantém a encomenda ativa | `npm-test.txt:379` |
| U57 | PASS | 2C: passou de 24h apenas sinaliza e avisa o dono uma única vez; nunca aprova sozinho | `npm-test.txt:388` |
| U58 | PASS | 2C: reembolso total sem informar valor usa o máximo, fecha a parte encomenda e recalcula o pedido | `npm-test.txt:399` |
| U59 | PASS | rotas de fornecedores e compras são registradas com CRUD e filtros | `npm-test.txt:410` |
| U60 | PASS | B3/B4 API real: fornecedor, produto preorder, compras, totais e bloqueio de histórico | `npm-test.txt:438` |
| U61 | PASS | custo por lote preserva precisão e calcula o lucro líquido com total original | `npm-test.txt:448` |
| U62 | PASS | prejuízo por unidade não é limitado a zero | `npm-test.txt:453` |
| U63 | PASS | cenário sem promoção exibe apenas lucro normal | `npm-test.txt:458` |
| U64 | PASS | simula cenários distintos mesmo quando a oferta dá prejuízo | `npm-test.txt:463` |
| U65 | PASS | promoção limitada divide 3 unidades em uma promocional e duas normais | `npm-test.txt:468` |
| U66 | PASS | entrada de novo lote calcula custo médio ponderado com precisão e lucro total esperado | `npm-test.txt:473` |
| U67 | PASS | promoção com preço igual/superior ao normal é ignorada | `npm-test.txt:478` |
| U68 | PASS | arredonda promoções com limite corretamente para 3, 7 e 11 unidades | `npm-test.txt:483` |
| U69 | PASS | custo médio com estoque zero usa integralmente o custo da entrada | `npm-test.txt:488` |
| U70 | PASS | custo por lote aceita quantidade do lote diferente do estoque atual | `npm-test.txt:493` |
| U71 | PASS | promoção abaixo do custo conserva prejuízo e preço normal lucrativo | `npm-test.txt:498` |
| U72 | PASS | totais de compras somam quantidade e custo NUMERIC em centavos | `npm-test.txt:504` |
| U73 | PASS | total de compras vazio é zero formatado | `npm-test.txt:509` |
| I01 | PASS | F01 cadastro automático, cache CEP+número entre clientes e variações de rua, campos manipulados ignorados | `npm-run-test-integration-1.txt:10; rerun: npm-run-test-integration-2.txt:10` |
| I02 | PASS | F02 edição de complemento/bairro/apelido/rua não consulta; mudar número/CEP consulta | `npm-run-test-integration-1.txt:15; rerun: npm-run-test-integration-2.txt:15` |
| I03 | PASS | F03 trocar origem invalida distância salva, quote/pedido/listagem não consultam Google; retry recalcula | `npm-run-test-integration-1.txt:20; rerun: npm-run-test-integration-2.txt:20` |
| I04 | PASS | F04 consistência quote/pedido, preço promocional e todos itens/preorder contam mínimos; valores do front ignorados | `npm-run-test-integration-1.txt:25; rerun: npm-run-test-integration-2.txt:25` |
| I05 | PASS | F05 Itatiba apenas, fora da área salvo com distância; >20 bloqueia mesmo com benefício; 15-20 normal | `npm-run-test-integration-1.txt:30; rerun: npm-run-test-integration-2.txt:30` |
| I06 | PASS | F06 limite de 15 cache misses por 24h; 16º salva endereço sem distância e retorna 429 | `npm-run-test-integration-1.txt:35; rerun: npm-run-test-integration-2.txt:35` |
| I07 | PASS | F07 cota atômica inclusive falhas e avisos únicos por mês no limiar configurado | `npm-run-test-integration-1.txt:40; rerun: npm-run-test-integration-2.txt:40` |
| I08 | PASS | F08 single-flight: cinco cadastros simultâneos do mesmo destino usam uma chamada | `npm-run-test-integration-1.txt:45; rerun: npm-run-test-integration-2.txt:45` |
| I09 | PASS | F09 Google 403/429/ZERO_RESULTS/JSON inválido/timeout: sem distância/sem gratuidade; retry funciona | `npm-run-test-integration-1.txt:50; rerun: npm-run-test-integration-2.txt:50` |
| I10 | PASS | F10 permissões, propriedade, configurações validadas/persistentes/auditadas e rotas antigas 410 | `npm-run-test-integration-1.txt:55; rerun: npm-run-test-integration-2.txt:55` |
| I11 | PASS | F11 benefício em lote, data/revogação e auditoria; tickets antigos não concedidos/consumidos/alterados | `npm-run-test-integration-1.txt:60; rerun: npm-run-test-integration-2.txt:60` |
| I12 | PASS | F12 dry-run é somente leitura; execução libera Itatiba/cancela cidade e >limite/restaura estoque; pagos intocados; replay idempotente | `npm-run-test-integration-1.txt:67; rerun: npm-run-test-integration-2.txt:67` |
| I13 | PASS | B2/B6: lista enriquecida, status agregado, aviso e notificação do cliente | `npm-run-test-integration-1.txt:91; rerun: npm-run-test-integration-2.txt:91` |
| I14 | PASS | B6.1: lote ignora partes finalizadas e avisa no máximo uma vez por pedido | `npm-run-test-integration-1.txt:99; rerun: npm-run-test-integration-2.txt:99` |
| I15 | PASS | Autorização: cliente não usa rotas admin nem responde aviso de outro cliente | `npm-run-test-integration-1.txt:115; rerun: npm-run-test-integration-2.txt:115` |
| I16 | PASS | B7: atraso, WAIT/EXCHANGE/REFUND, travas e resposta idempotente | `npm-run-test-integration-1.txt:132; rerun: npm-run-test-integration-2.txt:132` |
| I17 | PASS | 2C: só o dono acessa a fila; valor limitado aos itens (sem frete); aprovar, travar entrega e marcar devolvido | `npm-run-test-integration-1.txt:178; rerun: npm-run-test-integration-2.txt:178` |
| I18 | PASS | 2C: recusa exige motivo, avisa o cliente e mantém a encomenda ativa | `npm-run-test-integration-1.txt:189; rerun: npm-run-test-integration-2.txt:189` |
| I19 | PASS | 2C: passou de 24h apenas sinaliza e avisa o dono uma única vez; nunca aprova sozinho | `npm-run-test-integration-1.txt:198; rerun: npm-run-test-integration-2.txt:198` |
| I20 | PASS | 2C: reembolso total sem informar valor usa o máximo, fecha a parte encomenda e recalcula o pedido | `npm-run-test-integration-1.txt:209; rerun: npm-run-test-integration-2.txt:209` |
| I21 | PASS | rotas de fornecedores e compras são registradas com CRUD e filtros | `npm-run-test-integration-1.txt:220; rerun: npm-run-test-integration-2.txt:220` |
| I22 | PASS | B3/B4 API real: fornecedor, produto preorder, compras, totais e bloqueio de histórico | `npm-run-test-integration-1.txt:248; rerun: npm-run-test-integration-2.txt:248` |

## Cobertura solicitada

| Requisito | Evidência | Status |
|---|---|---|
| Fronteiras 3,00 / 3,01 / 3,10 / 15,00 / 15,01 / 20,00 / 20,01 km | `U11`, `U12`, `U13`, `U15`, `U16`, `U17`, `I05` | PASS |
| Mínimos R$ 89,99 / R$ 90,00 / R$ 90,01 | `U22`, `U23`, `U24`, `U11`, `U13` | PASS |
| Faixa 1 desligada + faixa 2 ligada | `U09`–`U17` | PASS |
| Faixa 1 ligada + faixa 2 desligada e combinações independentes | `U19`, `U20`, `U21` | PASS |
| Primeiro cadastro, cache hit, `hit_count`, variações de endereço e invalidação por origem | `I01`, `I02`, `I03` | PASS |
| Cota, aviso único, esgotamento e limite de 15 misses/24h | `I06`, `I07` | PASS |
| Cinco salvamentos simultâneos com uma chamada | `I08` | PASS |
| Google 403, 429, ZERO_RESULTS, JSON inválido, timeout e retry | `I09` | PASS |
| Cotação igual ao pedido e manipulação de frete ignorada | `I04` | PASS |
| Preorder, promoção e cobrança de frete | `U27`, `U32`, `I04` | PASS |
| Fora de Itatiba e acima de 20 km | `U29`, `U30`, `I05` | PASS |
| Rotas manuais antigas em 410 | `I10` | PASS |
| Ticket antigo não concedido/consumido/alterado | `I11` | PASS |
| Frete grátis em lote, revogação e auditoria | `I11` | PASS |
| Simulação e execução de pedidos antigos sem frete | `I12` | PASS |
| Permissões e persistência de configurações | `I10` | PASS |

## Itens de LIMITATION — não convertidos em PASS

| ID | Status | Limitação / evidência ausente |
|---|---|---|
| L01 | LIMITATION | Não houve chamada contra a API real do Google; os testes usam um servidor HTTP falso para não consumir cota. |
| L02 | LIMITATION | Não foi executado um teste com `GOOGLE_MAPS_API_KEY` ausente retornando `NOT_CONFIGURED`; essa condição deve ser validada no ambiente alvo. |
| L03 | LIMITATION | Backup/restore completo em ambiente de produção não foi executado. O código de backup/restore existe, mas a validação operacional deve ocorrer no VPS com cópia real. |
| L04 | LIMITATION | Não houve deploy ou smoke test em VPS real. |
| L05 | LIMITATION | A evidência usa PostgreSQL descartável local; não prova permissões, latência ou configuração do banco de produção. |
| L06 | LIMITATION | O build emite aviso não bloqueante de chunks maiores que 500 kB; não foi feita otimização de code splitting. |
| L07 | LIMITATION | O texto `A combinar` permanece em `AdminOrdersSection.tsx:577` e `CustomerAccountPage.tsx:1019` como fallback de leitura de pedidos históricos com `deliveryFee IS NULL`; pedidos novos passam pelo cálculo server-side e não devem criar esse estado. Não foi convertida essa inspeção histórica em PASS. |

## Resumo das execuções

- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- `npm test`: 73/73 PASS.
- `npm run test:integration` execução 1: 22/22 PASS.
- `npm run test:integration` execução 2, mesmo banco: 22/22 PASS.
