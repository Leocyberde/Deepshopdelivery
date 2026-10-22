#!/usr/bin/env bash
# Gera um certificado A1 FALSO (só para testes locais) com o OID de CNPJ da ICP-Brasil. Nunca use em produção.
set -euo pipefail
cd "$(dirname "$0")/fixtures"
cat > cert.cnf <<'CNF'
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=EMPRESA TESTE LTDA:11222333000181
O=ICP-Brasil
C=BR
[v3]
subjectAltName=otherName:2.16.76.1.3.3;UTF8:11222333000181
keyUsage=digitalSignature,keyEncipherment
CNF
openssl req -x509 -newkey rsa:2048 -nodes -keyout test.key -out test.crt -days 365 -config cert.cnf 2>/dev/null
openssl pkcs12 -export -out test.pfx -inkey test.key -in test.crt -passout pass:senha123
rm -f cert.cnf test.key test.crt
echo "Gerado tests/fixtures/test.pfx (senha: senha123)"
