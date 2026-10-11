import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type RequestLogContext = {
  requestId: string;
  method: string;
  resolveRoute: () => string;
};

const requestLogContext = new AsyncLocalStorage<RequestLogContext>();
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const FIELD_ALLOWLIST = new Set([
  'requestId', 'method', 'route', 'status', 'durationMs', 'environment',
  'errorType', 'errorCode', 'errorMessage', 'code', 'userId', 'adminId',
  'orderId', 'productId', 'ticketId', 'paymentId', 'role', 'action', 'result',
  'reason', 'source', 'phase', 'signal', 'port', 'count', 'itemCount',
  'movementCount', 'retryAfterSec', 'fromStatus', 'toStatus', 'orderStatus',
  'paymentStatus', 'provider', 'providerHttpStatus', 'providerErrorCode', 'providerCauseCode', 'providerErrorMessage',
  'state', 'operation', 'changed', 'stockDelta',
]);
const NUMERIC_FIELDS = new Set([
  'status', 'providerHttpStatus', 'durationMs', 'userId', 'adminId', 'orderId', 'productId', 'ticketId', 'paymentId',
  'count', 'itemCount', 'movementCount', 'retryAfterSec', 'port', 'stockDelta',
]);
const CODE_FIELDS = new Set([
  'errorType', 'errorCode', 'code', 'role', 'action', 'result', 'reason', 'source',
  'phase', 'signal', 'fromStatus', 'toStatus', 'orderStatus', 'paymentStatus',
  'provider', 'providerErrorCode', 'providerCauseCode', 'state', 'operation',
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function configuredLevel(): LogLevel {
  const candidate = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
  return candidate === 'debug' || candidate === 'info' || candidate === 'warn' || candidate === 'error'
    ? candidate
    : 'info';
}

function normalizedEnvironment(): string {
  const value = String(process.env.NODE_ENV || 'development').toLowerCase();
  return value === 'production' || value === 'test' || value === 'development' ? value : 'other';
}

function currentRoute(req: Request): string {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  const baseUrl = typeof req.baseUrl === 'string' && /^\/[A-Za-z0-9_./:-]*$/.test(req.baseUrl)
    ? req.baseUrl
    : '';
  const candidate = `${baseUrl}${routePath}`.slice(0, 180);
  if (candidate === '/health') return '/health';
  if (/^\/api(?:\/|$)/.test(candidate) && /^\/[A-Za-z0-9_./:*?=-]+$/.test(candidate)) return candidate;
  return '/static';
}

export function runWithRequestLogContext(req: Request, requestId: string, callback: () => void) {
  const safeId = UUID_V4.test(requestId) ? requestId : '';
  const method = /^[A-Z]{3,12}$/.test(req.method) ? req.method : 'UNKNOWN';
  return requestLogContext.run({ requestId: safeId, method, resolveRoute: () => currentRoute(req) }, callback);
}

function redactOperationalMessage(value: unknown): string {
  let message = typeof value === 'string' ? value : '';
  message = message
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?\b/g, '[token redacted]')
    .replace(/(["']?)(?:authorization|cookie|password|senha|jwt|token|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|database_url|mp_access_token|callmebot[_ -]?apikey|mercadopago[_ -]?test[_ -]?access[_ -]?token)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[sensitive field redacted]')
    .replace(/\b(?:user|username|database|host)\s+["'][^"']+["']/gi, '$1 [redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email redacted]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf redacted]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[- ]?\d{4}\b/g, '[phone redacted]')
    .replace(/\b(?:cvv|cvc|security[_ -]?code)\s*[:=]?\s*\d{3,4}\b/gi, '[payment security code redacted]')
    .replace(/\b(?:expiration[_ -]?date|card[_ -]?expiry)\s*[:=]?\s*(?:0?[1-9]|1[0-2])\/(?:\d{2}|\d{4})\b/gi, '[card expiry redacted]')
    .replace(/([\"']?)(?:card[_ -]?number|pan)\1\s*[:=]\s*(?:\d[ -]?){12,19}\b/gi, '[payment data redacted]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[card redacted]')
    .replace(/\b(?:\d[ -]?){5,}\b/g, '[number redacted]')
    .replace(/(["'`])[^"'`\r\n]{1,240}\1/g, '[quoted value redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return message.slice(0, 240) || 'Operational error';
}

function safeField(key: string, value: unknown): string | number | boolean | undefined {
  if (!FIELD_ALLOWLIST.has(key) || value === null || value === undefined) return undefined;
  if (key === 'requestId') return typeof value === 'string' && UUID_V4.test(value) ? value : undefined;
  if (key === 'method') return typeof value === 'string' && /^[A-Z]{3,12}$/.test(value) ? value : undefined;
  if (key === 'route') {
    return typeof value === 'string' && /^\/(?:api(?:\/[A-Za-z0-9_./:*?=-]*)?|health|static)$/.test(value)
      ? value.slice(0, 180)
      : undefined;
  }
  if (key === 'errorMessage' || key === 'providerErrorMessage') return redactOperationalMessage(value);
  if (NUMERIC_FIELDS.has(key)) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > 1_000_000_000) return undefined;
    if ((key === 'status' || key === 'providerHttpStatus') && (n < 100 || n > 599)) return undefined;
    if (key !== 'durationMs' && !Number.isSafeInteger(n)) return undefined;
    return key === 'durationMs' ? Math.round(n * 100) / 100 : n;
  }
  if (CODE_FIELDS.has(key)) {
    if (typeof value !== 'string') return undefined;
    const clean = value.replace(/[\r\n\t\u0000-\u001f\u007f]/g, '').slice(0, 80);
    return /^[A-Za-z0-9_.:/-]+$/.test(clean) ? clean : undefined;
  }
  if (typeof value === 'boolean') return value;
  return undefined;
}

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
  const context = requestLogContext.getStore();
  const merged: Record<string, unknown> = {
    ...(context ? {
      requestId: context.requestId,
      method: context.method,
      route: context.resolveRoute(),
    } : {}),
    ...fields,
  };
  const safeFields: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(merged)) {
    const safe = safeField(key, value);
    if (safe !== undefined) safeFields[key] = safe;
  }
  const safeEvent = event.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100) || 'operational.event';
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: safeEvent,
    environment: normalizedEnvironment(),
    ...safeFields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logServerError(event: string, error?: unknown, fields: Record<string, unknown> = {}) {
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown } | null | undefined;
  const errorType = error instanceof Error ? error.name : typeof error;
  const rawCode = candidate && typeof candidate === 'object' ? candidate.code : undefined;
  const errorCode = typeof rawCode === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(rawCode) ? rawCode : undefined;
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  write('error', event, { ...fields, errorType, errorCode, errorMessage: rawMessage });
}

export function logServerEvent(event: string, level: LogLevel = 'info', fields: Record<string, unknown> = {}) {
  write(level, event, fields);
}

export function redactOperationalText(value: unknown): string {
  return redactOperationalMessage(value);
}
