import 'dotenv/config'; // deve ser o primeiro import: JWT_SECRET e configuração do PostgreSQL são lidos ao carregar os módulos
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { randomUUID } from 'crypto';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { closeDatabase, initializeDatabase, markDatabaseAvailable, markDatabaseUnavailable, pgClient, db } from './src/db/index.ts';
import { triggerAutoSnapshot, startDailyBackup } from './src/db/backup.ts';
import { registerStorageRoutes } from './src/server/routes/storageRoutes.ts';
import { registerAuthRoutes } from './src/server/routes/authRoutes.ts';
import { registerStorefrontRoutes } from './src/server/routes/storefrontRoutes.ts';
import { registerAddressRoutes } from './src/server/routes/addressRoutes.ts';
import { registerOrderRoutes } from './src/server/routes/orderRoutes.ts';
import { registerPaymentRoutes } from './src/server/routes/paymentRoutes.ts';
import { registerSupportRoutes } from './src/server/routes/supportRoutes.ts';
import { registerAdminRoutes } from './src/server/routes/adminRoutes.ts';
import { registerAdminPhase2Routes } from './src/server/routes/adminPhase2Routes.ts';
import { registerAdminPhase3Routes } from './src/server/routes/adminPhase3Routes.ts';
import { startOrderExpirationWatcher } from './src/server/services/orderExpirationService.ts';
import { startOrderNotificationWatcher } from './src/server/services/orderNotificationService.ts';
import { startSupportLifecycleWatcher } from './src/server/services/supportLifecycleService.ts';
import { logServerError, logServerEvent, runWithRequestLogContext } from './src/server/logger.ts';
import { parseSiteUrl } from './src/config/siteUrl.ts';
import { createApiCorsMiddleware } from './src/server/middleware/cors.ts';
import { getProductionCspOptions } from './src/server/csp.ts';
import { getOptionalAuthUser } from './src/server/middleware/auth.ts';
import { isAdminRole } from './src/server/governance.ts';
import * as schema from './src/db/schema.ts';

export type { AuthUserPayload, AuthRequest } from './src/server/middleware/auth.ts';

const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const HEALTH_QUERY_TIMEOUT_MS = 1_500;
const HEALTH_FAILURE_LOG_INTERVAL_MS = 30_000;
let lastHealthFailureCompletionLogAt = 0;

async function startServer() {
  logServerEvent('application.starting', 'info', { port: PORT });
  // Valide antes de abrir conexões ou listeners: produção exige uma HTTPS origin explícita.
  const siteUrl = parseSiteUrl(process.env.SITE_URL, IS_PROD);
  const allowedOrigin = siteUrl?.origin ?? null;

  logServerEvent('database.initialization.started');
  try {
    await initializeDatabase();
    markDatabaseAvailable('initialization');
    logServerEvent('database.initialization.completed');
  } catch (error) {
    markDatabaseUnavailable(error, 'initialization');
    logServerError('database.initialization.failed', error);
    throw error;
  }
  startOrderExpirationWatcher();
  startOrderNotificationWatcher();
  startSupportLifecycleWatcher();
  startDailyBackup();

  const app = express();

  // Atrás de Nginx/Caddy: usa o IP real do cliente (limite de tentativas de login).
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : IS_PROD ? 1 : false);

  app.use((req, res, next) => {
    const incomingId = req.header('x-request-id') || '';
    const requestId = /^[A-Za-z0-9._:-]{1,80}$/.test(incomingId)
      ? incomingId
      : randomUUID();
    const startedAt = process.hrtime.bigint();
    res.setHeader('X-Request-Id', requestId);
    req.headers['x-request-id'] = requestId;
    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : req.path === '/health'
          ? '/health'
        : req.path.startsWith('/api')
            ? '/api/unmatched'
            : '/static';
      let level: 'debug' | 'info' | 'warn' | 'error';
      if (route === '/health') {
        const now = Date.now();
        if (res.statusCode >= 500 && now - lastHealthFailureCompletionLogAt >= HEALTH_FAILURE_LOG_INTERVAL_MS) {
          lastHealthFailureCompletionLogAt = now;
          level = 'error';
        } else {
          level = 'debug';
        }
      } else {
        level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : route === '/static' ? 'debug' : 'info';
      }
      logServerEvent('http.request.completed', level, {
        requestId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(elapsedMs * 100) / 100,
      });
    });
    runWithRequestLogContext(req, requestId, () => next());
  });

  if (IS_PROD) {
    app.use(
      helmet({
        contentSecurityPolicy: getProductionCspOptions(),
        xFrameOptions: { action: 'deny' },
        crossOriginEmbedderPolicy: false,
      })
    );
  }

  // Origem exata de SITE_URL; sem reflexão, wildcard ou credentials.
  app.use('/api', createApiCorsMiddleware(allowedOrigin, IS_PROD));

  // Limite maior SOMENTE na rota de upload (vídeo de 25 MB vira ~34 MB em base64); o resto da API aceita 1 MB.
  app.use('/api/admin/upload-image', express.json({ limit: '40mb' }));
  // A restauração de backup JSON carrega as imagens em base64, então também precisa de limite maior.
  app.use('/api/admin/database/restore-json', express.json({ limit: '80mb' }));
  app.use(express.json({ limit: '1mb' }));

  // Auditoria transversal: cobre mutações administrativas legadas sem copiar
  // payloads, credenciais ou dados pessoais para o log de negócio.
  app.use('/api/admin', async (req, res, next) => {
    const actor = await getOptionalAuthUser(req);
    if (actor && isAdminRole(actor.role) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.on('finish', () => {
        void db.insert(schema.adminAuditLogs).values({
          actorUserId: actor.id,
          actorEmail: actor.email,
          action: 'ADMIN_ROUTE_MUTATION',
          entityType: 'ADMIN_ROUTE',
          entityId: req.path.slice(0, 120),
          result: res.statusCode >= 200 && res.statusCode < 300 ? 'SUCCESS' : `HTTP_${res.statusCode}`,
          details: { method: req.method, route: req.path.slice(0, 160) },
          requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 80) : null,
        }).catch((error) => logServerError('admin_audit_write_failed', error));
      });
    }
    next();
  });

  // Salva snapshot automático do banco PostgreSQL a cada mutação bem-sucedida
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          triggerAutoSnapshot();
        }
      });
    }
    next();
  });

  // Serve PWA manifest and service worker with explicit headers
  app.get('/manifest.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(process.cwd(), 'public', 'manifest.json'));
  });

  app.get('/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(process.cwd(), 'public', 'sw.js'));
  });

  app.get('/health', async (_req, res) => {
    let healthClient: import('pg').PoolClient | undefined;
    try {
      healthClient = await pgClient.connect();
      await healthClient.query({ text: 'SELECT 1', query_timeout: HEALTH_QUERY_TIMEOUT_MS } as import('pg').QueryConfig);
      const checkedClient = healthClient;
      healthClient = undefined;
      checkedClient.release();
      markDatabaseAvailable('health_check');
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      if (healthClient) healthClient.release(error instanceof Error ? error : new Error('health_check_failed'));
      markDatabaseUnavailable(error, 'health_check');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  if (process.env.PHASE4_TEST_ERROR === 'true') {
    app.get('/api/__test/internal-error', () => { throw new Error('intentional test error'); });
  }
  // Register modular API routes
  registerStorageRoutes(app);
  registerAdminPhase2Routes(app);
  registerAdminPhase3Routes(app);
  registerAuthRoutes(app);
  registerStorefrontRoutes(app);
  registerAddressRoutes(app);
  registerOrderRoutes(app);
  registerPaymentRoutes(app);
  registerSupportRoutes(app);
  registerAdminRoutes(app);

  // Nunca permita que caminhos com aparência de armazenamento de backups caiam no fallback SPA.
  app.use((req, res, next) => {
    let candidate = req.path;
    try {
      for (let i = 0; i < 2; i += 1) {
        const decoded = decodeURIComponent(candidate);
        if (decoded === candidate) break;
        candidate = decoded;
      }
    } catch {
      res.status(400).json({ error: 'Caminho inválido.' });
      return;
    }
    candidate = candidate.replace(/\\/g, '/').replace(/\/+/g, '/');
    const pathSegments = candidate.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
    if (pathSegments.includes('backup') || pathSegments.includes('backups')) {
      res.status(404).json({ error: 'Recurso não encontrado.' });
      return;
    }
    next();
  });

  // Prevent unknown /api/* routes from falling through to the SPA index.html
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Rota da API não encontrada.' });
  });

  // Erros inesperados: mensagem genérica ao cliente, detalhe só no log do servidor.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Requisição muito grande.' });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Requisição inválida.' });
      return;
    }
    logServerError('http.error.unhandled', err, { status: 500 });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  const server = http.createServer(app);

  // Vite Dev Middleware or Static Production Build
  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logServerEvent('server.port.conflict', 'error', { code: err.code, port: PORT });
      process.exit(1);
    } else {
      logServerError('http_server_error', err);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    logServerEvent('http.server.listening', 'info', { port: PORT });
    logServerEvent('application.ready', 'info', { port: PORT });
  });

  let shutdownStarted = false;
  const shutdown = (signal: 'SIGTERM' | 'SIGINT') => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logServerEvent('application.shutdown.started', 'info', { signal });
    server.close((serverError) => {
      if (serverError) logServerError('http.server.shutdown.failed', serverError);
      logServerEvent('http.server.closed');
      logServerEvent('database.pool.shutdown.started');
      void closeDatabase()
        .then(() => logServerEvent('database.pool.closed'))
        .catch((error) => logServerError('database.pool.shutdown.failed', error))
        .finally(() => {
          logServerEvent('application.shutdown.completed');
          process.exit(0);
        });
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  logServerError('application.start.failed', err);
  process.exitCode = 1;
});
