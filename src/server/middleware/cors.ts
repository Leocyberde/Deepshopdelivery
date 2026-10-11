import type { RequestHandler, Response } from 'express';

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ALLOWED_METHOD_SET = new Set<string>(ALLOWED_METHODS);
const ALLOWED_HEADERS = ['content-type', 'authorization'] as const;
const ALLOWED_HEADER_SET = new Set<string>(ALLOWED_HEADERS);

function deny(res: Response): void {
  res.status(403).json({ error: 'Origem ou preflight não permitido.' });
}

/** CORS apenas para a API. Nunca reflete Origin; a única origem permitida é a configurada. */
export function createApiCorsMiddleware(allowedOrigin: string | null, production: boolean): RequestHandler {
  if (production && !allowedOrigin) {
    throw new Error('Configuração CORS inválida: SITE_URL é obrigatória em produção.');
  }

  return (req, res, next) => {
    const origin = req.get('Origin');
    const isOptions = req.method === 'OPTIONS';

    if (origin) res.vary('Origin');
    if (isOptions) {
      res.vary('Access-Control-Request-Method');
      res.vary('Access-Control-Request-Headers');
    }

    const requestOrigin = req.get('host') ? `${req.protocol}://${req.get('host')}` : null;
    if (origin && origin !== allowedOrigin && (production || origin !== requestOrigin)) {
      deny(res);
      return;
    }

    const isAllowedOrigin = Boolean(allowedOrigin && origin === allowedOrigin);

    if (isOptions) {
      const requestedMethod = req.get('Access-Control-Request-Method');
      if (isAllowedOrigin && requestedMethod !== undefined) {
        const method = requestedMethod.trim().toUpperCase();
        const requestedHeaders = (req.get('Access-Control-Request-Headers') || '')
          .split(',')
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);

        if (!ALLOWED_METHOD_SET.has(method) || requestedHeaders.some((header) => !ALLOWED_HEADER_SET.has(header))) {
          deny(res);
          return;
        }

        res.setHeader('Access-Control-Allow-Origin', allowedOrigin!);
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(','));
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.sendStatus(204);
        return;
      }

      // OPTIONS sem Origin/preflight não abre acesso CORS. Em desenvolvimento, chamadas
      // same-origin continuam funcionando; origens cross-origin não configuradas são negadas.
      res.sendStatus(204);
      return;
    }

    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin!);
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(','));
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    next();
  };
}
