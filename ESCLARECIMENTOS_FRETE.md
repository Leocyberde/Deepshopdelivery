# Esclarecimentos — frete automático

## “Clientes com ticket na evidência: 1”

Essa contagem significa **clientes distintos com saldo histórico de ticket de frete grátis no banco descartável** no momento da consulta. O banco tinha:

- **1 cliente** com saldo de ticket;
- esse cliente possuía `free_delivery_tickets = 3`;
- também possuía `manual_free_delivery_tickets = 2` como coluna histórica;
- `free_delivery_until` não estava ativo.

A funcionalidade de concessão e consumo de tickets foi aposentada. As colunas históricas continuam no banco por compatibilidade e backup; novos pedidos não recebem nem consomem esses tickets. Pedidos antigos que já possuem a marca histórica continuam podendo ser abertos.

## Texto “A combinar”

Os textos ainda existentes em:

- `src/components/admin/AdminOrdersSection.tsx:577`;
- `src/pages/CustomerAccountPage.tsx:1019`;

são fallbacks de **leitura de pedidos históricos** cujo registro antigo possui `deliveryFee IS NULL`. Eles não são usados para calcular novos pedidos.

O fluxo novo calcula e valida o frete no backend antes de gravar o pedido. Se a distância estiver indisponível, o pedido novo é recusado; se estiver fora da área, é recusado com `OUT_OF_DELIVERY_AREA`. Portanto, um pedido novo não deve cair nesse estado legado. Essa afirmação é uma propriedade do fluxo server-side e não foi convertida em PASS adicional na matriz.

## Limitações mantidas como LIMITATION

- Não houve chamada contra Google real; os testes usam provider HTTP falso.
- Não foi executado teste com `GOOGLE_MAPS_API_KEY` ausente em processo separado; o código possui o retorno `NOT_CONFIGURED`.
- Não houve deploy, backup/restore operacional ou smoke test em VPS real.
- O banco usado foi descartável local.
- O build emite aviso de chunk maior que 500 kB.
- A existência histórica de “A combinar” foi documentada, não mascarada como PASS.
