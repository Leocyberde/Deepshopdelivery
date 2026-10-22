import type { Express, Response } from 'express';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { audit } from './adminPhase3Routes.ts';
import { emitNfe, getNfeFile, getNfeStatus, NfeError } from '../services/nfeService.ts';
import { logServerError } from '../logger.ts';

function orderId(req: AuthRequest): number | null {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function fail(res: Response, error: unknown, event: string) {
  if (error instanceof NfeError) { res.status(error.status).json({ error: error.message, problems: error.problems }); return; }
  logServerError(event, error, {});
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

/** NF-e sob demanda: consulta, emissão por botão e download de XML/DANFE. Nunca emite sozinha. */
export function registerAdminNfeRoutes(app: Express) {
  app.get('/api/admin/orders/:id/nfe', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = orderId(req); if (!id) { res.status(400).json({ error: 'Pedido inválido.' }); return; }
    try { res.json(await getNfeStatus(id)); } catch (error) { fail(res, error, 'admin.nfe.status_failed'); }
  });

  app.post('/api/admin/orders/:id/nfe/emit', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = orderId(req); if (!id) { res.status(400).json({ error: 'Pedido inválido.' }); return; }
    try {
      const result = await emitNfe(id, req.user!.id);
      await audit(req, 'NFE_EMIT', 'ORDER', id, { status: result.document?.status, numero: result.document?.numero, environment: result.document?.environment });
      res.json(result);
    } catch (error) {
      if (error instanceof NfeError) await audit(req, 'NFE_EMIT', 'ORDER', id, { problems: error.problems, message: error.message }, 'FAILURE').catch(() => undefined);
      fail(res, error, 'admin.nfe.emit_failed');
    }
  });

  app.get('/api/admin/orders/:id/nfe/download/:kind', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = orderId(req); const kind = req.params.kind;
    if (!id || (kind !== 'xml' && kind !== 'danfe')) { res.status(400).json({ error: 'Pedido ou tipo de arquivo inválido.' }); return; }
    try { res.json(await getNfeFile(id, kind)); } catch (error) { fail(res, error, 'admin.nfe.download_failed'); }
  });
}
