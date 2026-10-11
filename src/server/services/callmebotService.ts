import { getSettingsMap } from './storeHelpers.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

const TIMEOUT_MS = 5000;

function buildUrl(phone: string, apiKey: string, text: string): string {
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone.replace(/\D/g, ''));
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('text', text);
  return url.toString();
}

export async function sendCallMeBotMessage(message: string): Promise<{ sent: boolean; reason?: string }> {
  const settings = await getSettingsMap();
  const enabled = settings.callmebot_enabled === 'true';
  const phone = process.env.CALLMEBOT_PHONE || '';
  const apiKey = process.env.CALLMEBOT_APIKEY || '';

  if (!enabled) return { sent: false, reason: 'disabled' };
  if (!phone || !apiKey) return { sent: false, reason: 'not_configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(phone, apiKey, message), {
      method: 'GET',
      signal: controller.signal,
    });
    const responseBody = await response.text();
    if (!response.ok) {
      return { sent: false, reason: `http_${response.status}` };
    }
    const normalizedBody = responseBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const providerRejected = [
      /api[\s_-]*key.{0,80}(invalid|wrong|incorrect|not\s+valid|expired|revoked)/,
      /(invalid|wrong|incorrect|not\s+valid|expired|revoked).{0,80}api[\s_-]*key/,
      /not\s+activated|activation\s+required|not\s+authorized|not\s+allowed/,
      /error\s*:/,
      /too\s+many\s+requests|rate\s*limit|quota\s+exceeded/,
    ].some((pattern) => pattern.test(normalizedBody));
    if (providerRejected) {
      return { sent: false, reason: 'provider_rejected' };
    }
    await db
      .insert(schema.settings)
      .values({ key: 'callmebot_last_sent_at', value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: new Date().toISOString(), updatedAt: new Date() },
      });
    return { sent: true };
  } catch (error: any) {
    return { sent: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCallMeBotStatus() {
  const settings = await getSettingsMap();
  return {
    enabled: settings.callmebot_enabled === 'true',
    configured: Boolean(process.env.CALLMEBOT_PHONE && process.env.CALLMEBOT_APIKEY),
    lastSentAt: settings.callmebot_last_sent_at || null,
  };
}
