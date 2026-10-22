<?php
/**
 * Testes do fluxo de emissão com uma Sefaz SIMULADA (nenhuma chamada de rede).
 * Uso: tests/make-test-cert.sh && php tests/flow-test.php
 */
require getenv('EMITTER_AUTOLOAD') ?: __DIR__ . '/../vendor/autoload.php';
use DeepShop\Emitter\{Config, Emitter, EmitterException};
use NFePHP\Common\Soap\{SoapBase, SoapInterface};

date_default_timezone_set('America/Sao_Paulo');
$store = sys_get_temp_dir() . '/nfe-emitter-flow-' . getmypid(); mkdir($store, 0700, true); register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($store)));
putenv("NFE_STORAGE_DIR=$store"); putenv('NFE_CERT_PATH=' . __DIR__ . '/fixtures/test.pfx'); putenv('NFE_CERT_PASSWORD=senha123');

class ScriptedSoap extends SoapBase implements SoapInterface {
    public array $queue = []; public array $log = [];
    public function send($url, $operation = '', $action = '', $soapver = SOAP_1_2, $parameters = [], $namespaces = [], $request = '', $soapheader = null) {
        $step = array_shift($this->queue) ?? fn () => throw new RuntimeException('fila vazia');
        $this->log[] = $operation . ' ' . (preg_match('/<consSitNFe/', $request) ? 'consulta' : 'lote');
        return $step($request);
    }
}
function ns() { return 'xmlns="http://www.portalfiscal.inf.br/nfe"'; }
function prot(string $chave, string $c, string $m, string $dig = 'x') { return "<protNFe versao=\"4.00\"><infProt><tpAmb>2</tpAmb><verAplic>SP</verAplic><chNFe>$chave</chNFe><dhRecbto>" . date('c') . "</dhRecbto><nProt>135260000000009</nProt><digVal>$dig</digVal><cStat>$c</cStat><xMotivo>$m</xMotivo></infProt></protNFe>"; }
function lote(string $req, string $c, string $m) {
    preg_match('/Id="NFe(\d{44})"/', $req, $k); preg_match('/<DigestValue>(.*?)<\/DigestValue>/', $req, $d);
    return '<retEnviNFe ' . ns() . ' versao="4.00"><tpAmb>2</tpAmb><verAplic>SP</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF><dhRecbto>' . date('c') . '</dhRecbto>' . prot($k[1], $c, $m, $d[1] ?? '') . '</retEnviNFe>';
}
function consulta(string $req, string $c, string $m, bool $withProt) {
    preg_match('/<chNFe>(\d{44})/', $req, $k);
    // a chave real vem do XML pendente; o digest é lido do arquivo pendente
    $pend = glob($GLOBALS['store'] . '/pending/*.xml')[0] ?? null; $dig = '';
    if ($pend && preg_match('/<DigestValue>(.*?)<\/DigestValue>/', file_get_contents($pend), $d)) $dig = $d[1];
    return '<retConsSitNFe ' . ns() . ' versao="4.00"><tpAmb>2</tpAmb><verAplic>SP</verAplic><cStat>' . ($withProt ? '100' : $c) . "</cStat><xMotivo>$m</xMotivo><cUF>35</cUF><dhRecbto>" . date('c') . "</dhRecbto><chNFe>{$k[1]}</chNFe>" . ($withProt ? prot($k[1], '100', 'Autorizado o uso da NF-e', $dig) : '') . '</retConsSitNFe>';
}
$base = json_decode(file_get_contents(__DIR__ . '/fixtures/payload.json'), true);
$soap = new ScriptedSoap(); $em = new Emitter(Config::fromEnv(), $soap);
$ok = 0; $fail = 0;
function check(string $name, bool $cond, string $info = '') { global $ok, $fail; $cond ? $ok++ : $fail++; echo ($cond ? 'PASS' : 'FAIL') . " - $name" . ($info ? " [$info]" : '') . "\n"; }
function pend(): array { return glob($GLOBALS['store'] . '/pending/*.xml') ?: []; }

// A) autorização direta
$p = $base; $p['numero'] = 10;
$soap->queue = [fn ($r) => lote($r, '100', 'Autorizado o uso da NF-e')];
$r = $em->emitir($p);
check('A autorizada', $r['ok'] === true && $r['status'] === 'AUTHORIZED' && strlen($r['chave']) === 44 && $r['protocolo'] !== '' && str_contains($r['xml'], '<nfeProc') && $r['danfePdfBase64'] !== null);
check('A pending removido', count(pend()) === 0);

// B) rejeição definitiva (XSD da Sefaz) => remonta na próxima
$p = $base; $p['numero'] = 11;
$soap->queue = [fn ($r) => lote($r, '215', 'Rejeicao: Falha no schema XML')];
$r = $em->emitir($p);
check('B rejeitada', $r['ok'] === false && $r['status'] === 'REJECTED' && $r['cStat'] === '215', $r['xMotivo'] ?? '');
check('B pending removido', count(pend()) === 0);

// C) resposta perdida (timeout) -> pending fica; retry consulta: 217 (não consta) -> reenvia -> autoriza
$p = $base; $p['numero'] = 12;
$soap->queue = [fn () => throw new RuntimeException('timeout')];
try { $em->emitir($p); check('C timeout lança 503', false); } catch (EmitterException $e) { check('C timeout lança 503', $e->httpStatus === 503, $e->getMessage()); }
check('C pending preservado', count(pend()) === 1);
$firstXml = file_get_contents(pend()[0]);
$soap->log = [];
$soap->queue = [fn ($r) => consulta($r, '217', 'Rejeicao: NF-e nao consta na base de dados da SEFAZ', false), fn ($r) => lote($r, '100', 'Autorizado o uso da NF-e')];
$r = $em->emitir($p);
check('C retry autoriza', $r['ok'] === true && $r['status'] === 'AUTHORIZED');
check('C retry consultou antes de reenviar', $soap->log[0] === ' consulta' || str_ends_with($soap->log[0], 'consulta'), implode(',', $soap->log));
check('C mesma chave (XML reaproveitado)', str_contains($r['xml'], substr($firstXml, strpos($firstXml, 'Id="NFe') + 7, 44)));

// D) resposta perdida mas a Sefaz já tinha autorizado -> retry só consulta, não reenvia
$p = $base; $p['numero'] = 13;
$soap->queue = [fn () => throw new RuntimeException('conexão caiu')];
try { $em->emitir($p); } catch (EmitterException $e) {}
$soap->log = [];
$soap->queue = [fn ($r) => consulta($r, '100', 'Autorizado o uso da NF-e', true)];
$r = $em->emitir($p);
check('D autorizada só por consulta', $r['ok'] === true && count($soap->log) === 1, implode(',', $soap->log));

// E) duplicidade 204 no envio, mas consulta confirma autorização
$p = $base; $p['numero'] = 14;
$soap->queue = [fn ($r) => lote($r, '204', 'Rejeicao: Duplicidade de NF-e'), fn ($r) => consulta($r, '100', 'Autorizado o uso da NF-e', true)];
$r = $em->emitir($p);
check('E duplicidade resolvida', $r['ok'] === true && $r['status'] === 'AUTHORIZED');

// F) Sefaz paralisada (108) -> 503 e mantém pending
$p = $base; $p['numero'] = 15;
$soap->queue = [fn () => '<retEnviNFe ' . ns() . ' versao="4.00"><tpAmb>2</tpAmb><verAplic>SP</verAplic><cStat>108</cStat><xMotivo>Servico Paralisado Momentaneamente</xMotivo><cUF>35</cUF><dhRecbto>' . date('c') . '</dhRecbto></retEnviNFe>'];
try { $em->emitir($p); check('F 108 => 503', false); } catch (EmitterException $e) { check('F 108 => 503', $e->httpStatus === 503); }
check('F pending preservado', count(pend()) === 1);

// G) validações locais (422, sem tocar a Sefaz)
foreach ([
  'CSOSN 500 não suportado' => fn (&$p) => $p['itens'][0]['csosn'] = '500',
  'CPF faltando'            => fn (&$p) => $p['destinatario']['cpf'] = '',
  'total não confere'       => fn (&$p) => $p['valores']['total'] = '34.00',
  'CFOP 6xxx dentro de SP'  => fn (&$p) => $p['itens'][0]['cfop'] = '6102',
  'NCM curto'               => fn (&$p) => $p['itens'][1]['ncm'] = '1234',
  'regime normal (CRT 3)'   => fn (&$p) => $p['emitente']['crt'] = '3',
  'IBGE destino faltando'   => fn (&$p) => $p['destinatario']['endereco']['codMunicipio'] = '',
] as $label => $mut) {
    $p = $base; $p['numero'] = 20; $mut($p); $soap->log = [];
    try { $em->emitir($p); check("G $label", false); } catch (EmitterException $e) { check("G $label", $e->httpStatus === 422 && !$soap->log, $e->getMessage()); }
}
// H) interestadual: CFOP 6102 + idDest 2
$p = $base; $p['numero'] = 21; $p['operacao']['idDest'] = '2'; $p['destinatario']['endereco']['uf'] = 'MG'; $p['itens'][0]['cfop'] = '6102'; $p['itens'][1]['cfop'] = '6102';
$soap->queue = [fn ($r) => lote($r, '100', 'Autorizado o uso da NF-e')];
$r = $em->emitir($p);
check('H interestadual autoriza', $r['ok'] === true && str_contains($r['xml'], '<idDest>2</idDest>'));
// I) CNPJ do certificado diferente
$p = $base; $p['numero'] = 22; $p['emitente']['cnpj'] = '99888777000166';
try { $em->emitir($p); check('I cnpj != certificado', false); } catch (EmitterException $e) { check('I cnpj != certificado', $e->httpStatus === 422, $e->getMessage()); }
echo "\n$ok ok, $fail falhas\n"; exit($fail ? 1 : 0);
