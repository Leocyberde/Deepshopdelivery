<?php
declare(strict_types=1);

use DeepShop\Emitter\Config;
use DeepShop\Emitter\Emitter;
use DeepShop\Emitter\EmitterException;

$autoload = getenv('EMITTER_AUTOLOAD') ?: __DIR__ . '/../vendor/autoload.php';
require $autoload;

date_default_timezone_set('America/Sao_Paulo');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$cfg = Config::fromEnv();
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($path === '/health' && $method === 'GET') {
    respond(200, ['ok' => true]);
}

// Autenticação por token compartilhado (comparação em tempo constante). Sem token configurado, o serviço recusa tudo.
$header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$given = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
if ($cfg->token === '' || !hash_equals($cfg->token, $given)) {
    respond(401, ['ok' => false, 'error' => 'Não autorizado.']);
}

$emitter = new Emitter($cfg);
try {
    if ($path === '/cert/status' && $method === 'GET') {
        respond(200, ['ok' => true] + $emitter->certificateStatus());
    }
    if ($path === '/nfe/emitir' && $method === 'POST') {
        $payload = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($payload)) {
            respond(400, ['ok' => false, 'error' => 'JSON inválido.']);
        }
        respond(200, $emitter->emitir($payload));
    }
    respond(404, ['ok' => false, 'error' => 'Rota não encontrada.']);
} catch (EmitterException $e) {
    respond($e->httpStatus, ['ok' => false, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('[nfe-emitter] ' . $e::class . ': ' . $e->getMessage());
    respond(500, ['ok' => false, 'error' => 'Erro interno do emissor.']);
}
