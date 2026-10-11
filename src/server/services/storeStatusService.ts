import { getSettingsMap } from './storeHelpers.ts';
import { DEFAULT_STORE_TIMEZONE, getDatePartsInTimezone } from '../../utils/timezone.ts';

export type StoreDayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface StoreHourRule {
  enabled: boolean;
  open: string;
  close: string;
}

export type StoreHours = Record<StoreDayKey, StoreHourRule>;

export const DEFAULT_STORE_HOURS: StoreHours = {
  mon: { enabled: true, open: '09:00', close: '18:00' },
  tue: { enabled: true, open: '09:00', close: '18:00' },
  wed: { enabled: true, open: '09:00', close: '18:00' },
  thu: { enabled: true, open: '09:00', close: '18:00' },
  fri: { enabled: true, open: '09:00', close: '18:00' },
  sat: { enabled: true, open: '09:00', close: '13:00' },
  sun: { enabled: false, open: '09:00', close: '13:00' },
};

const DAY_KEYS: StoreDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function parseStoreHours(raw?: string | null): StoreHours {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    const result = { ...DEFAULT_STORE_HOURS } as StoreHours;
    for (const key of DAY_KEYS) {
      const candidate = parsed?.[key];
      if (!candidate) continue;
      result[key] = {
        enabled: Boolean(candidate.enabled),
        open: /^\d{2}:\d{2}$/.test(String(candidate.open)) ? String(candidate.open) : result[key].open,
        close: /^\d{2}:\d{2}$/.test(String(candidate.close)) ? String(candidate.close) : result[key].close,
      };
    }
    return result;
  } catch {
    return DEFAULT_STORE_HOURS;
  }
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function getStoreState(settings: Record<string, string>, now = new Date()) {
  const timeZone = settings.store_timezone || DEFAULT_STORE_TIMEZONE;
  const parts = getDatePartsInTimezone(now, timeZone);
  const day = DAY_KEYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  const hours = parseStoreHours(settings.store_hours);
  const rule = hours[day];
  const currentMinutes = parts.hour * 60 + parts.minute;
  const insideHours = Boolean(rule?.enabled) && currentMinutes >= minutesOf(rule.open) && currentMinutes < minutesOf(rule.close);
  const manuallyOpen = (settings.store_status || 'OPEN').toUpperCase() === 'OPEN';
  const acceptOrdersWhenClosed = (settings.accept_orders_when_closed || 'false') === 'true';
  const isOpen = manuallyOpen && (insideHours || acceptOrdersWhenClosed);

  return {
    status: manuallyOpen ? 'OPEN' : 'CLOSED',
    isOpen,
    insideHours,
    acceptOrdersWhenClosed,
    timezone: timeZone,
    day,
    currentTime: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    hours,
    closedMessage: settings.store_closed_message || 'A loja está fechada no momento.',
  } as const;
}

export async function getCurrentStoreState(now = new Date()) {
  return getStoreState(await getSettingsMap(), now);
}

export function validateStoreHours(hours: StoreHours): string | null {
  for (const key of DAY_KEYS) {
    const rule = hours[key];
    if (!rule) return `Horário ausente para ${key}.`;
    if (!rule.enabled) continue;
    if (!/^\d{2}:\d{2}$/.test(rule.open) || !/^\d{2}:\d{2}$/.test(rule.close)) {
      return `Horário inválido para ${key}.`;
    }
    if (minutesOf(rule.open) >= minutesOf(rule.close)) {
      return `O horário de abertura deve ser anterior ao fechamento em ${key}.`;
    }
  }
  return null;
}
