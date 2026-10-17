# Relatório final — Frete automático por distância

**Projeto analisado:** DeepShop Delivery
**Data:** 16/10/2026
**Escopo:** implementação e validação do frete automático conforme o prompt enviado, sem Correios, sem cotação manual e sem edição manual do frete.

## 1. Resultado executivo

A implementação foi concluída na cópia de trabalho do projeto e passou pela validação final completa. O fluxo agora usa distância calculada pelo provedor configurado, cache persistente, cotação server-side e regras de frete configuráveis. O frontend não permite substituir os valores calculados pelo backend.

O tratamento de dados históricos foi preservado. Endpoints administrativos antigos de edição/sugestão manual continuam publicados apenas para responder `410 Gone`, evitando que clientes antigos recebam uma operação manual válida.

## 2. Alterações realizadas

### Frete e distância

- Cálculo automático por distância com fórmula configurável:
  - distância-base;
  - tarifa-base;
  - valor por quilômetro excedente;
  - limite máximo de atendimento.
- Restrição de atendimento para Itatiba/SP.
- Distância arredondada e tarifa calculada no backend.
- Cache por origem, CEP/número e demais componentes de localização relevantes.
- Invalidação quando a origem da loja muda.
- Reutilização entre clientes e variações de texto que não alteram a localização.
- Recálculo explícito do endereço quando necessário.
- Proteções para indisponibilidade, timeout, resposta inválida, `403`, `429`, `ZERO_RESULTS`, limite mensal e chamadas concorrentes.
- Controle de cota com comportamento atômico e notificações sem duplicação.

### Carrinho, checkout e pedidos

- Cotação server-side com token para garantir consistência entre cotação e criação do pedido.
- Subtotal calculado com preço promocional, quantidade total e itens de encomenda/preorder.
- Valores de frete enviados pelo frontend são ignorados.
- Pedido bloqueado quando a distância está indisponível ou fora da área.
- Benefício de frete grátis aplicado somente depois das validações de distância e área.
- Faixas de gratuidade independentes, com mínimo inclusivo.
- Alteração das configurações após a cotação invalida o token com `QUOTE_CHANGED`.

### Remoção de legado

- Textos de Correios removidos das mensagens de WhatsApp.
- Textos de “frete a combinar” substituídos por indicação de indisponibilidade histórica.
- Filtro administrativo `PENDING_FREIGHT` removido da lista de pedidos e clientes.
- Fluxo visual de filtro manual removido do dashboard e dos componentes administrativos.
- Rotas antigas de edição/sugestão manual mantidas somente como compatibilidade `410`:
  - `/api/admin/addresses/:id/freight`
  - `/api/admin/orders/:id/freight`
  - `/api/admin/freight/suggest`

## 3. Correções encontradas durante a validação

- Corrigida a consulta de produtos da cotação: o uso anterior de `ANY` gerava parâmetro inválido no PostgreSQL; foi substituído por seleção com `inArray` e validação dos IDs.
- Corrigidas expectativas unitárias que não correspondiam à fórmula configurada de R$ 7,50 + R$ 1,50 por quilômetro excedente.
- Corrigido o fixture de integração de cadastro para usar o campo real `lgpdAccepted`.
- Removidos resíduos de UI e mensagens que ainda mencionavam o modelo antigo de entrega.

## 4. Evidências de validação

Execução final realizada usando banco PostgreSQL descartável `deepshop_test`:

| Verificação | Resultado |
|---|---:|
| `npm run lint` | passou — exit 0 |
| `npm run build` | passou — exit 0 |
| `npm test` | **73/73** testes passando |
| `npm run test:integration` — execução 1 | **22/22** passando |
| `npm run test:integration` — execução 2 | **22/22** passando |
| Falhas unitárias | 0 |
| Falhas de integração | 0 |
| Testes pulados | 0 |
| Contagem legada reportada | released 1, cancelled 2, failed 0, skipped 0 |
| Clientes com ticket na evidência | 1 |

O build emitiu apenas o aviso não bloqueante de chunks maiores que 500 kB.

## 5. Segurança e empacotamento

- Nenhuma chave real foi adicionada ao código.
- A chave usada nos testes é fictícia e somente de teste.
- Arquivos `.env`, `node_modules`, `dist` e `dist-server` não fazem parte do ZIP entregue.
- `.env.example` é apenas modelo sem segredo e pode permanecer no projeto.

## 6. Observações para produção

1. Definir em produção a variável de ambiente do provedor de distância e a origem oficial da loja.
2. Executar a migração `drizzle/0003_automatic_freight.sql` no banco de produção antes do deploy.
3. Configurar limites mensais e limiar de alerta de acordo com o contrato do provedor.
4. Confirmar a política operacional para endereços fora de Itatiba antes de publicar.
5. O build gera um aviso de tamanho de chunk; não é erro funcional, mas pode ser tratado futuramente com code splitting.

## 7. Artefato entregue

O ZIP entregue contém o código-fonte sanitizado, testes, migrations, configuração e documentação necessária para revisão. Dependências instaladas e artefatos de build foram excluídos para reduzir o tamanho e evitar transportar dados gerados localmente.
