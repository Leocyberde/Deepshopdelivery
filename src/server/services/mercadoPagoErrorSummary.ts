import { redactOperationalText } from '../logger.ts';

export type ProviderErrorSummary = {
  providerErrorCode?: string;
  providerCauseCode?: string;
  providerErrorMessage: string;
};

function safeProviderErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const code = String(value).trim();
  return code.length > 0 && code.length <= 80 && /^[A-Za-z0-9_.:/-]+$/.test(code) ? code : undefined;
}

/** Extract only allow-listed fields; never return or log the raw provider response. */
export function summarizeProviderError(bodyText: string): ProviderErrorSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { providerErrorMessage: 'Non-JSON provider error body omitted' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { providerErrorMessage: 'Provider error payload had an unexpected format' };
  }
  const payload = parsed as Record<string, unknown>;
  // API de Orders: { errors: [{ code, message, details: [...] }] }
  const orderErrors = Array.isArray(payload.errors)
    ? payload.errors.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
    : [];
  if (orderErrors.length) {
    const first = orderErrors[0];
    const details = Array.isArray(first.details) ? first.details.filter((d): d is string => typeof d === 'string') : [];
    const parts = [first.message, ...details].filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
    return {
      providerErrorCode: safeProviderErrorCode(first.code),
      providerCauseCode: orderErrors.length > 1 ? orderErrors.map((e) => safeProviderErrorCode(e.code)).filter(Boolean).join(',').slice(0, 80) : undefined,
      providerErrorMessage: redactOperationalText(parts.join(' | ').slice(0, 500) || 'Provider error payload had no message field'),
    };
  }
  const rawCauses = Array.isArray(payload.cause)
    ? payload.cause
    : payload.cause && typeof payload.cause === 'object'
      ? [payload.cause]
      : [];
  const cause = rawCauses.find((value) => value && typeof value === 'object') as Record<string, unknown> | undefined;
  const messageParts = [payload.message, cause?.description, payload.error_description]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  return {
    providerErrorCode: safeProviderErrorCode(payload.error) ?? safeProviderErrorCode(payload.code),
    providerCauseCode: safeProviderErrorCode(cause?.code),
    providerErrorMessage: redactOperationalText(
      messageParts.join(' | ') || 'Provider error payload had no message field'
    ),
  };
}
