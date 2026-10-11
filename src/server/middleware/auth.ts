import { logServerError, logServerEvent } from '../logger.ts';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { isAdminRole, parsePermissions, permissionForRequest, isCriticalAdminOperation } from '../governance.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!fromEnv || fromEnv.length < 32) {
      logServerEvent('application.configuration.invalid', 'error', { reason: 'jwt_secret_missing_or_short' });
      process.exit(1);
    }
    return fromEnv;
  }
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  logServerEvent('application.configuration.warning', 'warn', { reason: 'temporary_jwt_secret_in_development' });
  return randomBytes(48).toString('hex');
}

export const JWT_SECRET = resolveJwtSecret();

export interface AuthUserPayload {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPER_ADMIN' | 'GERENTE' | 'OPERADOR' | 'CUSTOMER';
  sessionVersion: number;
}

export interface AuthRequest extends Request {
  user?: AuthUserPayload;
  mustChangePassword?: boolean;
}

// Simple in-memory Rate Limiter for login/register/password recovery (Seção 9 e 16)
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const authRateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

export function checkRateLimit(key: string): {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
} {
  const now = Date.now();
  const entry = authRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    authRateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfterSec: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, retryAfterSec: 0 };
}

export function resetRateLimit(key: string) {
  authRateLimits.delete(key);
}

// Middleware de Autenticação: confere no banco se o usuário existe e está ACTIVE
// e usa o papel (role) do banco, nunca o do token (Etapa 1.7).
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logServerEvent('security.authentication.required', 'warn', { status: 401, result: 'denied', reason: 'missing_bearer_token' });
    res.status(401).json({ error: 'Não autenticado. Faça login para continuar.' });
    return;
  }
  const token = authHeader.slice(7);
  let decoded: AuthUserPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
  } catch {
    logServerEvent('security.authentication.failed', 'warn', { status: 401, result: 'denied', reason: 'invalid_or_expired_token' });
    res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
    return;
  }
  try {
    const [dbUser] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        status: schema.users.status,
        mustChangePassword: schema.users.mustChangePassword,
        permissions: schema.users.permissions,
        sessionVersion: schema.users.sessionVersion,
      })
      .from(schema.users)
      .where(eq(schema.users.id, decoded.id));
    if (!dbUser || dbUser.status !== 'ACTIVE' || decoded.sessionVersion !== dbUser.sessionVersion) {
      // 401 (e não 403): a sessão deixou de ser válida, então o frontend deve encerrar-se.
      logServerEvent('security.authentication.failed', 'warn', { status: 401, result: 'denied', reason: 'account_or_session_invalid', userId: decoded.id });
      res.status(401).json({ error: 'Conta inexistente ou desativada.', code: 'ACCOUNT_DISABLED' });
      return;
    }
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role as AuthUserPayload['role'],
      sessionVersion: dbUser.sessionVersion,
    };
    req.mustChangePassword = dbUser.mustChangePassword;
    next();
  } catch (error) {
    logServerError('authentication.lookup.failed', error, { userId: decoded.id });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

// Autenticação opcional (rotas públicas): se houver token, ele precisa ser válido E o usuário
// precisa existir e estar ACTIVE no banco (mesma regra do requireAuth). Token inválido, expirado
// ou de conta desativada é tratado como visitante anônimo. O papel (role) vem sempre do banco.
export async function getOptionalAuthUser(req: Request): Promise<AuthUserPayload | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  let decoded: AuthUserPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
  } catch {
    return null;
  }
  try {
    const [dbUser] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        status: schema.users.status,
        sessionVersion: schema.users.sessionVersion,
      })
      .from(schema.users)
      .where(eq(schema.users.id, decoded.id));
    if (!dbUser || dbUser.status !== 'ACTIVE' || decoded.sessionVersion !== dbUser.sessionVersion) return null;
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role as AuthUserPayload['role'],
      sessionVersion: dbUser.sessionVersion,
    };
  } catch (error) {
    logServerError('authentication.optional_lookup.failed', error, { userId: decoded.id });
    return null;
  }
}

// Middleware de Autorização por Role ADMIN (Seção 2, 7, 16, Teste 13)
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    logServerEvent('security.admin_access.denied', 'warn', { status: 401, result: 'denied', reason: 'unauthenticated' });
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  if (!isAdminRole(req.user.role)) {
    logServerEvent('security.admin_access.denied', 'warn', { status: 403, result: 'denied', reason: 'role_denied', userId: req.user.id, role: req.user.role });
    res.status(403).json({ error: 'Acesso negado: área restrita ao administrador.', code: 'FORBIDDEN' });
    return;
  }
  if (req.mustChangePassword && !req.originalUrl.startsWith('/api/admin/credentials')) {
    logServerEvent('security.admin_access.denied', 'warn', { status: 403, result: 'denied', reason: 'password_change_required', userId: req.user.id, role: req.user.role });
    res.status(403).json({ error: 'Troque a senha provisória antes de usar o painel.', code: 'MUST_CHANGE_PASSWORD' });
    return;
  }
  try {
    const [row] = await db.select({ role: schema.users.role, permissions: schema.users.permissions }).from(schema.users).where(eq(schema.users.id, req.user.id));
    const perms = parsePermissions(row?.role || req.user.role, row?.permissions);
    const permission = permissionForRequest(req);
    if (permission && !perms.has(permission)) {
      logServerEvent('security.admin_access.denied', 'warn', { status: 403, result: 'denied', reason: 'permission_denied', userId: req.user.id, role: row?.role || req.user.role, action: permission });
      res.status(403).json({ error: 'Permissão insuficiente para esta operação.', code: 'INSUFFICIENT_PERMISSION', permission });
      return;
    }
    if (isCriticalAdminOperation(req) && row?.role !== 'SUPER_ADMIN') {
      logServerEvent('security.admin_access.denied', 'warn', { status: 403, result: 'denied', reason: 'super_admin_required', userId: req.user.id, role: row?.role || req.user.role, action: 'critical_operation' });
      res.status(403).json({ error: 'Somente SUPER_ADMIN pode executar esta operação crítica.', code: 'SUPER_ADMIN_REQUIRED' });
      return;
    }
    next();
  } catch (error) {
    logServerError('security.admin_authorization.failed', error, { userId: req.user.id, role: req.user.role });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
