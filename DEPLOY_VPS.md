# Deploy VPS — frete automático

> Este documento descreve um procedimento de implantação e rollback. A validação local passou, mas isso **não é uma declaração de pronto para produção**: o deploy real ainda exige execução controlada no VPS.

## 1. Pré-requisitos

- VPS com Node.js 22+, PostgreSQL compatível e processo do aplicativo parado ou pronto para reinício controlado.
- Acesso ao banco real e espaço para um dump completo.
- Domínio HTTPS já apontado para o VPS.
- Janela de manutenção para a migração e reinício.

## 2. Backup obrigatório antes de qualquer alteração

Defina a conexão real sem colocá-la em arquivos públicos:

```bash
export DATABASE_URL='postgresql://usuario:senha@host:5432/banco'
export BACKUP_DIR=/var/backups/deepshop
sudo install -d -m 700 "$BACKUP_DIR"
pg_dump --format=custom --file="$BACKUP_DIR/deepshop-before-freight-$(date +%Y%m%d-%H%M%S).dump" "$DATABASE_URL"
pg_dump --schema-only --file="$BACKUP_DIR/deepshop-before-freight-schema-$(date +%Y%m%d-%H%M%S).sql" "$DATABASE_URL"
```

Confirme que os arquivos existem e têm tamanho diferente de zero antes de continuar. Preserve também o diretório da versão anterior do aplicativo e seu arquivo de ambiente fora do diretório público.

## 3. Ordem recomendada

1. Colocar o deploy em modo de manutenção ou interromper temporariamente o processo.
2. Fazer e verificar o backup PostgreSQL acima.
3. Copiar a nova versão para um diretório de release separado.
4. Instalar dependências com `npm ci --omit=dev` ou o procedimento usado pelo serviço.
5. Configurar as variáveis de ambiente abaixo.
6. Aplicar a migration `drizzle/0003_automatic_freight.sql` no banco real.
7. Executar `npm run lint` e `npm run build` no release.
8. Reiniciar o serviço com o novo release.
9. Confirmar `/health`, login administrativo e configurações de frete.
10. Fazer somente um teste de endereço, de preferência um endereço real conhecido de Itatiba, para consumir o mínimo possível de cota.
11. Conferir logs, cache, distância e tarifa gravada.
12. Retirar a manutenção somente depois do smoke test.

## 4. Variáveis novas e relacionadas

As variáveis novas do provider geográfico são:

```dotenv
GOOGLE_MAPS_API_KEY=chave-real-apenas-no-ambiente
GOOGLE_DISTANCE_PROVIDER=routes
SITE_URL=https://seu-dominio.com.br
```

Valores aceitos para `GOOGLE_DISTANCE_PROVIDER`:

- `routes`: Google Routes API, padrão quando omitido;
- `distance_matrix`: Google Distance Matrix API.

Também devem continuar configuradas as variáveis existentes necessárias ao app, especialmente `NODE_ENV=production`, `DATABASE_URL` ou `PG*`, `JWT_SECRET`, `PORT`, `SITE_URL`, Mercado Pago e demais integrações utilizadas pelo ambiente. Nunca coloque a chave Google no frontend, no ZIP público, em logs ou no repositório.

A origem da loja deve ser configurada no painel/admin ou diretamente na configuração persistida, com endereço completo em Itatiba. O código rejeita origem vazia, placeholder ou sem número/cidade válida.

## 5. Aplicar a migration real

A migration é não destrutiva e usa `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` e `ON CONFLICT DO NOTHING`. Pode ser aplicada de forma idempotente:

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f drizzle/0003_automatic_freight.sql
```

Verifique as estruturas:

```bash
psql "$DATABASE_URL" -c "\dt geo_*"
psql "$DATABASE_URL" -c "\d addresses"
psql "$DATABASE_URL" -c "SELECT key,value FROM settings WHERE key LIKE 'geo_%' OR key LIKE 'freight_%';"
```

A migration não apaga tickets históricos, taxas antigas, pedidos ou endereços existentes.

## 6. Validação com o mínimo de cota

- Não faça testes em massa contra o Google.
- Configure uma única origem válida.
- Cadastre ou edite **um único endereço real de Itatiba** e acione uma vez “Recalcular distância”/“Testar endereço”.
- Confirme que o primeiro resultado salva distância, tarifa, origem e `deliveryFeeSource=GOOGLE`.
- Reabra o mesmo endereço ou carregue-o novamente para verificar cache; isso não deve gerar nova chamada externa.
- Não altere CEP/número durante o smoke test, pois isso cria uma nova chave de localização.
- Verifique o status administrativo de uso/cota e o log do provedor.

Se a chave estiver ausente, o comportamento esperado do código é retornar `NOT_CONFIGURED` internamente e manter o endereço sem distância, sem erro 500.

## 7. Monitoramento pós-deploy

Acompanhe:

- respostas `DISTANCE_UNAVAILABLE`, `PROVIDER_FORBIDDEN`, `PROVIDER_RATE_LIMIT`, `TIMEOUT` e `MONTHLY_LIMIT`;
- quantidade de chamadas em `geo_api_usage`;
- entradas e `hit_count` em `geo_distance_cache`;
- notificações administrativas de aviso/esgotamento;
- pedidos novos com cotação e frete gravados.

## 8. Rollback

### 8.1 Falha antes de reiniciar

- Não reinicie o serviço novo.
- Mantenha o release anterior ativo.
- A migration é aditiva e pode permanecer; não remova tabelas/colunas durante um rollback apressado.

### 8.2 Falha depois de reiniciar

1. Coloque a aplicação em manutenção.
2. Volte o symlink/release para a versão anterior.
3. Restaure o arquivo de ambiente anterior.
4. Reinicie o serviço anterior.
5. Verifique `/health`, login e criação de pedido.
6. Preserve os logs e o dump usado na operação.

### 8.3 Restauração destrutiva do banco

Somente faça isso com aprovação operacional explícita e após confirmar o dump correto:

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname="$DATABASE_URL" \
  /var/backups/deepshop/deepshop-before-freight-YYYYMMDD-HHMMSS.dump
```

Depois valide as tabelas, usuários, pedidos e pagamentos. Não execute `DROP` manual das tabelas geográficas como estratégia padrão: elas são compatíveis com a versão anterior e podem conter auditoria/cota útil.

## 9. Critério de encerramento da operação

A operação só deve ser considerada concluída pelo responsável do ambiente quando o backup estiver verificável, a migration estiver aplicada, o serviço estiver saudável, o smoke test de uma única chamada tiver sido confirmado e o rollback estiver disponível. A evidência local deste pacote não substitui essa confirmação no VPS.
