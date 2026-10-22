<?php
declare(strict_types=1);

namespace DeepShop\Emitter;

use DateTimeImmutable;
use DateTimeZone;
use NFePHP\Common\Certificate;
use NFePHP\Common\Soap\SoapInterface;
use NFePHP\Common\UFList;
use NFePHP\Common\Validator;
use NFePHP\DA\NFe\Danfe;
use NFePHP\NFe\Common\Standardize;
use NFePHP\NFe\Complements;
use NFePHP\NFe\Make;
use NFePHP\NFe\Tools;
use stdClass;
use Throwable;

/**
 * Monta, assina (A1) e transmite NF-e modelo 55 à Sefaz-SP.
 *
 * Idempotência: o XML assinado fica em storage/pending/<amb>-<serie>-<numero>.xml até haver um desfecho definitivo
 * (autorizada ou rejeitada). Se a resposta se perder (timeout), a próxima chamada para o MESMO número consulta a chave
 * na Sefaz antes de reenviar, e reaproveita o mesmo XML (mesma chave e mesmo digest) — nunca emite duas notas.
 */
final class Emitter
{
    private const AUTHORIZED = ['100', '150'];
    /** CSOSN suportados: Simples sem ST (102/103) e não tributadas (300/400). 101/201/202/203/500/900 exigem outros campos. */
    private const SUPPORTED_CSOSN = ['102', '103', '300', '400'];
    private const HOMOLOG_DEST_NAME = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

    /** @param SoapInterface|null $soap cliente SOAP alternativo (usado nos testes para simular a Sefaz) */
    public function __construct(private readonly Config $cfg, private readonly ?SoapInterface $soap = null) {}

    // ------------------------------------------------------------------ certificado

    public function certificate(): Certificate
    {
        if ($this->cfg->certPath === '' || !is_readable($this->cfg->certPath)) {
            throw new EmitterException('Certificado A1 não encontrado (NFE_CERT_PATH).', 503);
        }
        $content = (string) file_get_contents($this->cfg->certPath);
        try {
            return Certificate::readPfx($content, $this->cfg->certPassword);
        } catch (Throwable $first) {
            // Muitas certificadoras ainda geram .pfx com cifras antigas (RC2-40), que o OpenSSL 3 não abre sem o provider "legacy".
            $converted = $this->convertLegacyPfx($content, $this->cfg->certPassword);
            if ($converted !== null) {
                try {
                    return Certificate::readPfx($converted, $this->cfg->certPassword);
                } catch (Throwable) {
                }
            }
            throw new EmitterException('Não foi possível abrir o certificado A1 (senha incorreta ou arquivo inválido).', 503);
        }
    }

    /** Reempacota em memória um .pfx legado usando o binário openssl (senha só por variável de ambiente do processo filho). */
    private function convertLegacyPfx(string $content, string $password): ?string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'pfx');
        if ($tmp === false) {
            return null;
        }
        try {
            chmod($tmp, 0600);
            file_put_contents($tmp, $content);
            $env = ['PFXPASS' => $password, 'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin'];
            $pem = $this->run(['openssl', 'pkcs12', '-legacy', '-in', $tmp, '-passin', 'env:PFXPASS', '-nodes'], $env, null);
            if ($pem === null || $pem === '') {
                return null;
            }
            file_put_contents($tmp, $pem); // sobrescreve o temporário (0600) com o PEM; apagado no finally
            $pfx = $this->run(['openssl', 'pkcs12', '-export', '-in', $tmp, '-passout', 'env:PFXPASS'], $env, null);
            return $pfx !== null && $pfx !== '' ? $pfx : null;
        } finally {
            @unlink($tmp);
        }
    }

    private function run(array $cmd, array $env, ?string $stdin): ?string
    {
        $proc = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        if (!is_resource($proc)) {
            return null;
        }
        if ($stdin !== null) {
            fwrite($pipes[0], $stdin);
        }
        fclose($pipes[0]);
        $out = (string) stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return proc_close($proc) === 0 ? $out : null;
    }

    public function certificateStatus(): array
    {
        $cert = $this->certificate();
        $validTo = $cert->getValidTo();
        return [
            'company' => $cert->getCompanyName(),
            'cnpj' => $cert->getCnpj(),
            'validTo' => $validTo->format('c'),
            'daysLeft' => (int) floor(($validTo->getTimestamp() - time()) / 86400),
            'expired' => $cert->isExpired(),
        ];
    }

    // ------------------------------------------------------------------ emissão

    public function emitir(array $p): array
    {
        $v = $this->validate($p);
        $cert = $this->certificate();
        if ($cert->isExpired()) {
            throw new EmitterException('O certificado A1 está vencido. Renove-o e substitua o arquivo .pfx.', 503);
        }
        $certCnpj = (string) $cert->getCnpj();
        if ($certCnpj === '' || substr($certCnpj, 0, 8) !== substr($v['cnpj'], 0, 8)) {
            throw new EmitterException('O CNPJ do certificado A1 não corresponde ao CNPJ do emitente.', 422);
        }

        $key = sprintf('%d-%03d-%09d', $v['amb'], $v['serie'], $v['numero']);
        $this->ensureDirs();
        $lock = fopen($this->cfg->storageDir . "/locks/$key.lock", 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            throw new EmitterException('Já existe uma emissão em andamento para este número.', 409);
        }
        try {
            $tools = $this->tools($cert, $v);
            $pending = $this->cfg->storageDir . "/pending/$key.xml";

            if (is_file($pending)) {
                $signed = (string) file_get_contents($pending);
                $chave = $this->chaveFromXml($signed);
                [$cStat, $resp, $std] = $this->consultar($tools, $chave);
                if (in_array($cStat, self::AUTHORIZED, true)) {
                    return $this->finalize($signed, $resp, $chave, $v, $pending);
                }
                if ($cStat === '217') { // não consta na base: nunca chegou à Sefaz
                    return $this->enviar($tools, $signed, $chave, $v, $pending);
                }
                if (in_array($cStat, ['110', '301', '302', '303'], true)) {
                    return $this->rejeitada($pending, $cStat, (string) ($std->xMotivo ?? 'Uso denegado.'));
                }
                throw new EmitterException("A Sefaz respondeu cStat $cStat: " . ($std->xMotivo ?? 'sem detalhes') . '. Tente novamente em instantes.', 503);
            }

            [$signed, $chave] = $this->montarEAssinar($tools, $v);
            file_put_contents($pending, $signed);
            return $this->enviar($tools, $signed, $chave, $v, $pending);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** Monta o XML, assina e valida contra o XSD oficial. Não usa rede. Exposto para o selftest. */
    public function montarEAssinar(Tools $tools, array $v): array
    {
        $xml = $this->montarXml($v);
        $signed = $tools->signNFe($xml);
        $this->validarXsd($signed); // o XSD exige a assinatura, então só dá para validar depois de assinar
        return [$signed, $this->chaveFromXml($signed)];
    }

    public function tools(Certificate $cert, array $v): Tools
    {
        $tools = new Tools(json_encode([
            'atualizacao' => date('Y-m-d H:i:s'),
            'tpAmb' => $v['amb'],
            'razaosocial' => $v['razao'],
            'cnpj' => $v['cnpj'],
            'siglaUF' => $v['uf'],
            'schemes' => $this->cfg->schema,
            'versao' => '4.00',
        ], JSON_THROW_ON_ERROR), $cert);
        $tools->model(55);
        if ($this->soap !== null) {
            $tools->loadSoapClass($this->soap);
        }
        return $tools;
    }

    // ------------------------------------------------------------------ transmissão

    private function enviar(Tools $tools, string $signed, string $chave, array $v, string $pending): array
    {
        try {
            $resp = $tools->sefazEnviaLote([$signed], str_pad((string) $v['numero'], 15, '0', STR_PAD_LEFT), 1);
            $std = (new Standardize())->toStd($resp);
        } catch (Throwable $e) {
            throw new EmitterException('Falha na comunicação com a Sefaz: ' . $e->getMessage(), 503);
        }

        $lote = (string) ($std->cStat ?? '');
        if ($lote === '104' && isset($std->protNFe->infProt)) {
            $prot = $std->protNFe->infProt;
            $cStat = (string) $prot->cStat;
            if (in_array($cStat, self::AUTHORIZED, true)) {
                return $this->finalize($signed, $resp, $chave, $v, $pending);
            }
            if ($cStat === '204') { // duplicidade: provavelmente já autorizada numa tentativa anterior
                [$c2, $resp2] = $this->consultar($tools, $chave);
                if (in_array($c2, self::AUTHORIZED, true)) {
                    return $this->finalize($signed, $resp2, $chave, $v, $pending);
                }
            }
            return $this->rejeitada($pending, $cStat, (string) $prot->xMotivo);
        }
        if (in_array($lote, ['103', '105', '108', '109'], true)) { // processando / serviço paralisado: resultado incerto
            throw new EmitterException("Sefaz sem resultado definitivo (cStat $lote: " . ($std->xMotivo ?? '') . '). Tente novamente em instantes.', 503);
        }
        return $this->rejeitada($pending, $lote !== '' ? $lote : '0', (string) ($std->xMotivo ?? 'Resposta inesperada da Sefaz.'));
    }

    /** @return array{0:string,1:string,2:stdClass} */
    private function consultar(Tools $tools, string $chave): array
    {
        try {
            $resp = $tools->sefazConsultaChave($chave);
            $std = (new Standardize())->toStd($resp);
        } catch (Throwable $e) {
            throw new EmitterException('Falha ao consultar a Sefaz: ' . $e->getMessage(), 503);
        }
        return [(string) ($std->cStat ?? ''), $resp, $std];
    }

    private function finalize(string $signed, string $resp, string $chave, array $v, string $pending): array
    {
        $procXml = Complements::toAuthorize($signed, $resp);
        $proc = simplexml_load_string($procXml);
        $nProt = $proc !== false && isset($proc->protNFe->infProt->nProt) ? (string) $proc->protNFe->infProt->nProt : '';

        $dir = $this->cfg->storageDir . '/authorized/' . date('Y-m');
        if (!is_dir($dir)) {
            mkdir($dir, 0750, true);
        }
        file_put_contents("$dir/$chave-procNFe.xml", $procXml);

        $pdfB64 = null;
        try {
            $danfe = new Danfe($procXml);
            $danfe->debugMode(false);
            $pdf = $danfe->render();
            file_put_contents("$dir/$chave-danfe.pdf", $pdf);
            $pdfB64 = base64_encode($pdf);
        } catch (Throwable $e) {
            error_log('[nfe-emitter] DANFE falhou para ' . $chave . ': ' . $e->getMessage());
        }
        @unlink($pending);
        return ['ok' => true, 'status' => 'AUTHORIZED', 'chave' => $chave, 'protocolo' => $nProt, 'numero' => $v['numero'], 'xml' => $procXml, 'danfePdfBase64' => $pdfB64];
    }

    private function rejeitada(string $pending, string $cStat, string $xMotivo): array
    {
        @unlink($pending); // rejeição definitiva: a próxima tentativa remonta o XML com os dados corrigidos
        return ['ok' => false, 'status' => 'REJECTED', 'cStat' => $cStat, 'xMotivo' => $xMotivo];
    }

    // ------------------------------------------------------------------ montagem do XML

    private function montarXml(array $v): string
    {
        $mk = new Make($this->cfg->schema);
        $mk->setOnlyAscii(false);
        $mk->setCheckGtin(false);

        $mk->taginfNFe((object) ['versao' => '4.00']);

        $now = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->modify('-1 minute')->format('Y-m-d\TH:i:sP');
        $mk->tagide((object) [
            'cUF' => UFList::getCodeByUF($v['uf']),
            'cNF' => $this->cNF($v['numero']),
            'natOp' => $v['natOp'],
            'mod' => 55,
            'serie' => $v['serie'],
            'nNF' => $v['numero'],
            'dhEmi' => $now,
            'dhSaiEnt' => $now,
            'tpNF' => 1,
            'idDest' => (int) $v['idDest'],
            'cMunFG' => $v['codMunicipio'],
            'tpImp' => 1,
            'tpEmis' => 1,
            'tpAmb' => $v['amb'],
            'finNFe' => 1,
            'indFinal' => 1,
            'indPres' => (int) $v['indPres'],
            'indIntermed' => 0,
            'procEmi' => 0,
            'verProc' => substr($this->cfg->verProc, 0, 20),
        ]);

        $e = $v['emit'];
        $mk->tagemit((object) ['xNome' => $e['razao'], 'xFant' => $e['fantasia'], 'IE' => $e['ie'], 'CRT' => (int) $e['crt'], 'CNPJ' => $e['cnpj']]);
        $mk->tagenderEmit((object) [
            'xLgr' => $e['end']['logradouro'], 'nro' => $e['end']['numero'], 'xCpl' => $e['end']['complemento'] ?: null,
            'xBairro' => $e['end']['bairro'], 'cMun' => $e['end']['codMunicipio'], 'xMun' => $e['end']['municipio'],
            'UF' => $e['end']['uf'], 'CEP' => $e['end']['cep'], 'cPais' => 1058, 'xPais' => 'BRASIL', 'fone' => $e['fone'] ?: null,
        ]);

        $d = $v['dest'];
        $mk->tagdest((object) [
            'xNome' => $v['amb'] === 2 ? self::HOMOLOG_DEST_NAME : $d['nome'],
            'CPF' => $d['cpf'], 'indIEDest' => 9, 'email' => $d['email'] ?: null,
        ]);
        $mk->tagenderdest((object) [
            'xLgr' => $d['end']['logradouro'], 'nro' => $d['end']['numero'], 'xCpl' => $d['end']['complemento'] ?: null,
            'xBairro' => $d['end']['bairro'], 'cMun' => $d['end']['codMunicipio'], 'xMun' => $d['end']['municipio'],
            'UF' => $d['end']['uf'], 'CEP' => $d['end']['cep'], 'cPais' => 1058, 'xPais' => 'BRASIL', 'fone' => $d['fone'] ?: null,
        ]);

        // Frete rateado proporcionalmente nos itens (o total de vFrete deve bater com a soma dos itens).
        $fretes = $this->ratear($v['freteCents'], array_map(static fn ($i) => $i['totalCents'], $v['itens']));
        foreach ($v['itens'] as $idx => $i) {
            $n = $idx + 1;
            $mk->tagprod((object) [
                'item' => $n, 'cProd' => $i['codigo'], 'cEAN' => 'SEM GTIN', 'xProd' => $i['descricao'],
                'NCM' => $i['ncm'], 'CFOP' => $i['cfop'], 'uCom' => $i['unidade'], 'qCom' => $i['qtd'],
                'vUnCom' => $this->money($i['unitCents']), 'vProd' => $this->money($i['totalCents']),
                'cEANTrib' => 'SEM GTIN', 'uTrib' => $i['unidade'], 'qTrib' => $i['qtd'], 'vUnTrib' => $this->money($i['unitCents']),
                'vFrete' => $fretes[$idx] > 0 ? $this->money($fretes[$idx]) : null, 'indTot' => 1,
            ]);
            $mk->tagimposto((object) ['item' => $n]);
            $mk->tagICMSSN((object) ['item' => $n, 'orig' => (int) $i['origem'], 'CSOSN' => $i['csosn']]);
            $mk->tagPIS((object) ['item' => $n, 'CST' => '49', 'vBC' => 0.00, 'pPIS' => 0.00, 'vPIS' => 0.00]);
            $mk->tagCOFINS((object) ['item' => $n, 'CST' => '49', 'vBC' => 0.00, 'pCOFINS' => 0.00, 'vCOFINS' => 0.00]);
        }

        $mk->tagtransp((object) ['modFrete' => 9]);
        $mk->tagpag((object) []);
        $mk->tagdetpag((object) array_filter([
            'indPag' => 0, 'tPag' => $v['pag']['tPag'], 'xPag' => $v['pag']['xPag'] ?: null, 'vPag' => $this->money($v['totalCents']),
        ], static fn ($x) => $x !== null));
        $mk->taginfadic((object) ['infCpl' => $v['infCpl']]);

        $rt = $this->cfg->respTec;
        if ($rt['CNPJ'] !== '' && $rt['xContato'] !== '' && $rt['email'] !== '' && $rt['fone'] !== '') {
            $mk->taginfRespTec((object) $rt);
        }

        $xml = $mk->getXML();
        if ($xml === '' || $mk->getErrors()) {
            throw new EmitterException('Não foi possível montar o XML da NF-e: ' . implode(' | ', $mk->getErrors()), 422);
        }
        // Conferência: o total calculado pelo gerador precisa bater com o total do pedido.
        $dom = simplexml_load_string($xml);
        $dom->registerXPathNamespace('n', 'http://www.portalfiscal.inf.br/nfe');
        $vNF = (string) ($dom->xpath('//n:ICMSTot/n:vNF')[0] ?? '');
        if ($vNF !== $this->money($v['totalCents'])) {
            throw new EmitterException("Total da NF-e ($vNF) difere do total do pedido (" . $this->money($v['totalCents']) . ').', 422);
        }
        return $xml;
    }

    /** Código numérico da chave: determinístico por número (retentativa gera a mesma chave) e diferente de nNF. */
    private function cNF(int $numero): string
    {
        $c = (($numero * 7919) + 12345678) % 100000000;
        if ($c === $numero) {
            $c = ($c + 1) % 100000000;
        }
        return str_pad((string) $c, 8, '0', STR_PAD_LEFT);
    }

    /** @return int[] */
    private function ratear(int $totalCents, array $bases): array
    {
        $sum = array_sum($bases);
        $out = array_fill(0, count($bases), 0);
        if ($totalCents <= 0 || $sum <= 0) {
            return $out;
        }
        $given = 0;
        $last = count($bases) - 1;
        foreach ($bases as $i => $base) {
            $out[$i] = $i === $last ? $totalCents - $given : intdiv($totalCents * $base, $sum);
            $given += $out[$i];
        }
        return $out;
    }

    private function money(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    private function validarXsd(string $xml): void
    {
        $xsd = dirname((string) (new \ReflectionClass(Tools::class))->getFileName()) . '/../schemes/' . $this->cfg->schema . '/nfe_v4.00.xsd';
        try {
            Validator::isValid($xml, $xsd);
        } catch (Throwable $e) {
            throw new EmitterException('XML fora do padrão da Sefaz (XSD): ' . $e->getMessage(), 422);
        }
    }

    private function chaveFromXml(string $xml): string
    {
        if (!preg_match('/<infNFe[^>]*\sId="NFe(\d{44})"/', $xml, $m)) {
            throw new EmitterException('Chave de acesso não encontrada no XML.', 422);
        }
        return $m[1];
    }

    private function ensureDirs(): void
    {
        foreach (['pending', 'locks', 'authorized'] as $d) {
            $path = $this->cfg->storageDir . '/' . $d;
            if (!is_dir($path) && !mkdir($path, 0750, true) && !is_dir($path)) {
                throw new EmitterException("Não foi possível criar $path.", 503);
            }
        }
    }

    // ------------------------------------------------------------------ validação do payload

    public function validate(array $p): array
    {
        $fail = static function (string $m): never { throw new EmitterException($m, 422); };
        $s = static fn ($x): string => trim((string) $x);
        $digits = static fn ($x): string => preg_replace('/\D/', '', (string) $x) ?? '';
        $cents = static function ($x) use ($fail): int {
            if (!preg_match('/^\d+(\.\d{1,2})?$/', (string) $x)) { $fail('Valor monetário inválido no payload.'); }
            return (int) round(((float) $x) * 100);
        };

        $amb = (int) ($p['ambiente'] ?? 0);
        if (!in_array($amb, [1, 2], true)) { $fail('ambiente deve ser 1 (produção) ou 2 (homologação).'); }
        $serie = (int) ($p['serie'] ?? 0);
        $numero = (int) ($p['numero'] ?? 0);
        if ($serie < 1 || $serie > 889) { $fail('Série inválida.'); }
        if ($numero < 1 || $numero > 999999999) { $fail('Número da NF-e inválido.'); }

        $em = $p['emitente'] ?? [];
        $cnpj = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) ($em['cnpj'] ?? '')));
        if (!preg_match('/^[A-Z0-9]{12}\d{2}$/', $cnpj)) { $fail('CNPJ do emitente inválido.'); }
        $ie = $digits($em['ie'] ?? '');
        if ($ie === '') { $fail('Inscrição estadual do emitente é obrigatória.'); }
        $crt = $s($em['crt'] ?? '');
        if (!in_array($crt, ['1', '2', '4'], true)) { $fail('Somente emitentes do Simples Nacional/MEI (CRT 1, 2 ou 4) são suportados.'); }
        $ee = $em['endereco'] ?? [];
        $emitEnd = $this->address($ee, 'emitente', $fail, $s, $digits);
        $uf = $emitEnd['uf'];

        $dst = $p['destinatario'] ?? [];
        $cpf = $digits($dst['cpf'] ?? '');
        if (strlen($cpf) !== 11) { $fail('CPF do destinatário inválido.'); }
        $nome = $s($dst['nome'] ?? '');
        if (mb_strlen($nome) < 2) { $fail('Nome do destinatário inválido.'); }
        $destEnd = $this->address($dst['endereco'] ?? [], 'destinatário', $fail, $s, $digits);

        $op = $p['operacao'] ?? [];
        $idDest = $s($op['idDest'] ?? '');
        if (!in_array($idDest, ['1', '2'], true) || ($idDest === '1') !== ($destEnd['uf'] === $uf)) { $fail('idDest incoerente com as UFs de emitente e destinatário.'); }
        $indPres = $s($op['indPres'] ?? '2');
        if (!in_array($indPres, ['0', '1', '2', '3', '4', '5', '9'], true)) { $fail('indPres inválido.'); }

        $itens = [];
        $sumItems = 0;
        foreach (($p['itens'] ?? []) as $i) {
            $ncm = $digits($i['ncm'] ?? '');
            $cfop = $digits($i['cfop'] ?? '');
            $origem = $s($i['origem'] ?? '');
            $csosn = $s($i['csosn'] ?? '');
            $qtd = (int) ($i['quantidade'] ?? 0);
            $label = $s($i['codigo'] ?? '?');
            if (strlen($ncm) !== 8) { $fail("Item $label: NCM inválido."); }
            if (!preg_match('/^[1-7]\d{3}$/', $cfop)) { $fail("Item $label: CFOP inválido."); }
            if (!preg_match('/^[0-8]$/', $origem)) { $fail("Item $label: origem inválida."); }
            if (!in_array($csosn, self::SUPPORTED_CSOSN, true)) { $fail("Item $label: CSOSN $csosn ainda não é suportado (use " . implode(', ', self::SUPPORTED_CSOSN) . ').'); }
            if ($qtd < 1 || $qtd > 999999) { $fail("Item $label: quantidade inválida."); }
            if (($idDest === '1' && $cfop[0] !== '5') || ($idDest === '2' && $cfop[0] !== '6')) { $fail("Item $label: CFOP $cfop incompatível com a operação (" . ($idDest === '1' ? 'dentro' : 'fora') . ' do estado).'); }
            $unit = $cents($i['valorUnitario'] ?? '');
            $total = $cents($i['valorTotal'] ?? '');
            if ($unit * $qtd !== $total) { $fail("Item $label: valorUnitario × quantidade difere de valorTotal."); }
            $sumItems += $total;
            $itens[] = ['codigo' => $label, 'descricao' => mb_substr($s($i['descricao'] ?? ''), 0, 120), 'ncm' => $ncm, 'cfop' => $cfop, 'origem' => $origem,
                'csosn' => $csosn, 'unidade' => strtoupper($s($i['unidade'] ?? 'UN')) ?: 'UN', 'qtd' => $qtd, 'unitCents' => $unit, 'totalCents' => $total];
        }
        if (!$itens || count($itens) > 990) { $fail('A NF-e precisa ter de 1 a 990 itens.'); }

        $val = $p['valores'] ?? [];
        $frete = $cents($val['frete'] ?? '0');
        $total = $cents($val['total'] ?? '');
        if ($sumItems + $frete !== $total) { $fail('Total difere de itens + frete.'); }
        $pag = $p['pagamento'] ?? [];
        $tPag = $s($pag['tPag'] ?? '');
        if (!preg_match('/^(0[1-9]|1[0-9]|90|99)$/', $tPag)) { $fail('Forma de pagamento (tPag) inválida.'); }
        if ($cents($pag['valor'] ?? '') !== $total) { $fail('Valor do pagamento difere do total da nota.'); }

        return [
            'amb' => $amb, 'serie' => $serie, 'numero' => $numero, 'uf' => $uf, 'cnpj' => $cnpj, 'razao' => mb_substr($s($em['razaoSocial'] ?? ''), 0, 60),
            'codMunicipio' => $emitEnd['codMunicipio'], 'natOp' => mb_substr($s($p['naturezaOperacao'] ?? 'Venda de mercadoria'), 0, 60),
            'idDest' => $idDest, 'indPres' => $indPres,
            'emit' => ['cnpj' => $cnpj, 'ie' => $ie, 'crt' => $crt, 'razao' => mb_substr($s($em['razaoSocial'] ?? ''), 0, 60),
                'fantasia' => mb_substr($s($em['nomeFantasia'] ?? '') ?: $s($em['razaoSocial'] ?? ''), 0, 60), 'fone' => $digits($em['fone'] ?? ''), 'end' => $emitEnd],
            'dest' => ['cpf' => $cpf, 'nome' => mb_substr($nome, 0, 60), 'email' => $s($dst['email'] ?? ''), 'fone' => $digits($dst['fone'] ?? ''), 'end' => $destEnd],
            'itens' => $itens, 'freteCents' => $frete, 'totalCents' => $total,
            'pag' => ['tPag' => $tPag, 'xPag' => $s($pag['xPag'] ?? '')],
            'infCpl' => mb_substr($s($p['informacoesComplementares'] ?? ''), 0, 2000),
        ];
    }

    private function address(array $a, string $who, callable $fail, callable $s, callable $digits): array
    {
        $uf = strtoupper($s($a['uf'] ?? ''));
        if (!preg_match('/^[A-Z]{2}$/', $uf)) { $fail("UF do $who inválida."); }
        $cep = $digits($a['cep'] ?? '');
        if (strlen($cep) !== 8) { $fail("CEP do $who inválido."); }
        $cod = $digits($a['codMunicipio'] ?? '');
        if (strlen($cod) !== 7) { $fail("Código IBGE do município do $who inválido."); }
        foreach (['logradouro', 'numero', 'bairro', 'municipio'] as $f) {
            if ($s($a[$f] ?? '') === '') { $fail("Endereço do $who: campo $f é obrigatório."); }
        }
        return ['logradouro' => mb_substr($s($a['logradouro']), 0, 60), 'numero' => mb_substr($s($a['numero']), 0, 60), 'complemento' => mb_substr($s($a['complemento'] ?? ''), 0, 60),
            'bairro' => mb_substr($s($a['bairro']), 0, 60), 'cep' => $cep, 'codMunicipio' => $cod, 'municipio' => mb_substr($s($a['municipio']), 0, 60), 'uf' => $uf];
    }
}
