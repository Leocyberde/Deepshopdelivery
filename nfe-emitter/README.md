# Emissor de NF-e (Sefaz-SP) — DeepShop Delivery

Serviço pequeno em PHP (`sped-nfe` + `sped-da`) que **assina com o certificado A1 e transmite a NF-e modelo 55 à Sefaz-SP**.
O app Node **nunca** vê o certificado: ele só envia o JSON do pedido e recebe de volta chave, protocolo, XML autorizado e DANFE (PDF).
A emissão é **sob demanda**: só acontece quando você clica em **Emitir NF-e** no pedido.

```
Admin clica "Emitir NF-e" → app Node (monta JSON) → POST /nfe/emitir → este serviço → Sefaz-SP (SOAP + mTLS)
```

## O que falta para emitir (só o seu lado)
1. Inscrição Estadual ativa e **credenciamento na Sefaz-SP** (homologação primeiro).
2. **Certificado e-CNPJ A1** (`.pfx`) e a senha.
3. Preencher as variáveis `NFE_EMIT_*` no `.env` do app e `NFE_CERT_*` no emissor (veja abaixo).

## Instalação (Docker — recomendado)
```bash
cd nfe-emitter
cp .env.example .env            # preencha EMITTER_TOKEN e NFE_CERT_PASSWORD
cp /caminho/seu-certificado.pfx ./certificado.pfx   # fora do git (.gitignore já cobre)
docker compose -f docker-compose.example.yml --env-file .env up -d --build
curl -s http://127.0.0.1:8081/health                      # {"ok":true}
curl -s -H "Authorization: Bearer $EMITTER_TOKEN" http://127.0.0.1:8081/cert/status   # CNPJ e dias até vencer
```
Sem Docker: PHP ≥ 8.1 com extensões `soap curl dom gd mbstring openssl zip`, `composer install --no-dev`, e aponte Nginx/Apache para `public/`
(repasse o header `Authorization` ao PHP-FPM com `fastcgi_param HTTP_AUTHORIZATION $http_authorization;`).

No `.env` do **app**: `NFE_SERVICE_URL=http://127.0.0.1:8081` e `NFE_SERVICE_TOKEN=<o mesmo EMITTER_TOKEN>`.
Se o app e o emissor estiverem em máquinas diferentes, coloque HTTPS entre eles; o serviço **nunca** deve ficar aberto na internet.

## Certificado A1
- Fica só aqui (`NFE_CERT_PATH`), com a senha em `NFE_CERT_PASSWORD`. Nunca no repositório nem no app.
- Certificados antigos (cifra RC2) não abrem no OpenSSL 3; o emissor **converte sozinho em memória**. Se preferir converter o arquivo:
  `openssl pkcs12 -legacy -in a1.pfx -nodes -out tmp.pem && openssl pkcs12 -export -in tmp.pem -out a1-novo.pfx && rm tmp.pem`
- O CNPJ do certificado precisa ter a mesma raiz (8 primeiros caracteres) do CNPJ em `NFE_EMIT_CNPJ`.
- O app avisa no painel quando faltam 30 dias ou menos para vencer (validade de 1 ano).

## Segurança
- Autenticação por token (`Authorization: Bearer`), comparado em tempo constante. Sem `EMITTER_TOKEN` o serviço recusa tudo.
- Escute apenas em `127.0.0.1` ou rede privada. Não publique `/nfe/emitir` na internet.

## Guarda legal dos XMLs (5 anos)
Notas autorizadas ficam em `NFE_STORAGE_DIR/authorized/AAAA-MM/<chave>-procNFe.xml` (+ `-danfe.pdf`).
A lei exige guardar o XML por **no mínimo 5 anos**: faça backup diário dessa pasta (rclone/rsync para fora do servidor).
O app também guarda uma cópia no banco, mas não dependa só dela.

## Reenvio seguro (se a internet cair no meio)
O XML assinado fica em `storage/pending/` até haver resposta definitiva. Se a resposta se perder, ao clicar de novo o emissor
**consulta a chave na Sefaz antes de reenviar** e reaproveita o mesmo XML: nunca emite duas notas para o mesmo número.

## Suporte atual e limites
- Emitente **Simples Nacional / MEI** (CRT 1, 2 ou 4); venda a consumidor final (PF, CPF) dentro ou fora de SP.
- CSOSN **102, 103, 300 e 400**. Produtos com substituição tributária (CSOSN 500/201/202) precisam de CEST/campos extras: ainda não suportado.
- PIS/COFINS informados com CST 49 e valores zerados (padrão do Simples).
- **Não implementado ainda:** cancelamento, carta de correção, inutilização de numeração e contingência SVC. Se precisar cancelar uma nota autorizada, use o portal da Sefaz/emissor web.
- **Reforma tributária:** IBS/CBS passam a ser obrigatórios para Simples/MEI a partir de **04/01/2027**. Até lá o leiaute `PL_009_V4` basta; depois será preciso migrar para `PL_010` e informar o grupo IBS/CBS.

## Testes (sem rede, Sefaz simulada)
```bash
composer install            # com dev
./tests/make-test-cert.sh   # certificado A1 FALSO para teste
php tests/flow-test.php     # 22 verificações: autorização, rejeição, timeout+reenvio, duplicidade, validações
```

## Contrato da API
`POST /nfe/emitir` (Bearer) → `200 {ok:true,status:"AUTHORIZED",chave,protocolo,numero,xml,danfePdfBase64}`
ou `200 {ok:false,status:"REJECTED",cStat,xMotivo}` · `422` dados inválidos · `503` Sefaz/certificado indisponível (pode tentar de novo) · `409` já em andamento.
`GET /cert/status` → `{ok,cnpj,company,validTo,daysLeft,expired}` · `GET /health`.
