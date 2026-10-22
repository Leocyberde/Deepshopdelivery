<?php
declare(strict_types=1);

namespace DeepShop\Emitter;

final class Config
{
    public function __construct(
        public readonly string $token,
        public readonly string $certPath,
        public readonly string $certPassword,
        public readonly string $storageDir,
        public readonly string $schema,
        public readonly string $verProc,
        public readonly array $respTec,
    ) {}

    public static function fromEnv(): self
    {
        $get = static fn (string $k, string $d = ''): string => trim((string) (getenv($k) !== false ? getenv($k) : $d));
        $storage = rtrim($get('NFE_STORAGE_DIR', dirname(__DIR__) . '/storage'), '/');
        return new self(
            $get('EMITTER_TOKEN'),
            $get('NFE_CERT_PATH'),
            (string) getenv('NFE_CERT_PASSWORD'),
            $storage,
            $get('NFE_SCHEMA', 'PL_009_V4'),
            $get('NFE_VER_PROC', 'DeepShop 1.0'),
            [
                'CNPJ' => preg_replace('/[^A-Za-z0-9]/', '', $get('NFE_RESP_TEC_CNPJ')) ?: '',
                'xContato' => $get('NFE_RESP_TEC_CONTATO'),
                'email' => $get('NFE_RESP_TEC_EMAIL'),
                'fone' => preg_replace('/\D/', '', $get('NFE_RESP_TEC_FONE')) ?: '',
            ],
        );
    }
}
