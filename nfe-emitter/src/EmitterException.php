<?php
declare(strict_types=1);

namespace DeepShop\Emitter;

/** Erro com código HTTP: 422 = dados inválidos, 503 = Sefaz/certificado indisponível. */
final class EmitterException extends \RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 422)
    {
        parent::__construct($message);
    }
}
