import { getDatePartsInTimezone, tzToUtc, type TimezoneDateParts } from './timezone.ts';

export const DELIVERY_MINUTE_OPTIONS = [60, 90, 120, 180] as const;
export type DeliveryMinutes = (typeof DELIVERY_MINUTE_OPTIONS)[number];
export type DeliveryMode = 'FAST' | 'SCHEDULED';

export const DELIVERY_OPTION_LABELS: Record<DeliveryMinutes, string> = {
  60: 'Em até 60 minutos',
  90: 'Em até 90 minutos',
  120: 'Em até 120 minutos',
  180: 'Em até 180 minutos',
};

export type DeliveryStoreHours = Record<string, { enabled: boolean; open: string; close: string }>;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function minutesOf(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function dateKey(parts: Pick<TimezoneDateParts, 'year' | 'month' | 'day'>): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function isDeliveryMinutes(value: unknown): value is DeliveryMinutes {
  return DELIVERY_MINUTE_OPTIONS.includes(Number(value) as DeliveryMinutes);
}

export function getStoreDayKey(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimezone(date, timeZone);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return DAY_KEYS[day];
}

export function isDateTimeWithinStoreHours(
  date: Date,
  hours: DeliveryStoreHours,
  timeZone: string,
): boolean {
  const parts = getDatePartsInTimezone(date, timeZone);
  const rule = hours[getStoreDayKey(date, timeZone)];
  if (!rule?.enabled) return false;
  const current = parts.hour * 60 + parts.minute;
  return current >= minutesOf(rule.open) && current < minutesOf(rule.close);
}

export function parseScheduledDelivery(
  dateValue: unknown,
  timeValue: unknown,
  hours: DeliveryStoreHours,
  timeZone: string,
  now = new Date(),
): Date {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Escolha uma data e um horário válidos para o agendamento.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Escolha uma data e um horário válidos para o agendamento.');
  }
  const scheduled = tzToUtc(year, month, day, hour, minute, 0, 0, timeZone);
  if (Number.isNaN(scheduled.getTime()) || scheduled <= now) {
    throw new Error('O agendamento deve ser feito para uma data e horário futuros.');
  }
  if (!isDateTimeWithinStoreHours(scheduled, hours, timeZone)) {
    throw new Error('O horário escolhido está fora da disponibilidade da loja.');
  }
  return scheduled;
}

export function getFastDeliveryEstimate(
  now: Date,
  deliveryMinutes: DeliveryMinutes,
  hours: DeliveryStoreHours,
  timeZone: string,
): Date {
  const firstCandidate = new Date(now.getTime() + deliveryMinutes * 60_000);
  if (isDateTimeWithinStoreHours(firstCandidate, hours, timeZone)) return firstCandidate;

  const current = getDatePartsInTimezone(firstCandidate, timeZone);
  for (let offset = 1; offset < 8; offset += 1) {
    const candidateDate = new Date(Date.UTC(current.year, current.month - 1, current.day + offset, 12));
    const dayKey = DAY_KEYS[candidateDate.getUTCDay()];
    const rule = hours[dayKey];
    if (!rule?.enabled) continue;
    const candidateParts = getDatePartsInTimezone(candidateDate, timeZone);
    return tzToUtc(
      candidateParts.year,
      candidateParts.month,
      candidateParts.day,
      Number(rule.open.slice(0, 2)),
      Number(rule.open.slice(3, 5)),
      0,
      0,
      timeZone,
    );
  }
  return firstCandidate;
}

export function formatDeliveryDateTime(date: Date | string, timeZone = 'America/Sao_Paulo'): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function formatDeliveryTime(date: Date | string, timeZone = 'America/Sao_Paulo'): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(parsed);
}

export function localDateString(date = new Date(), timeZone = 'America/Sao_Paulo'): string {
  return dateKey(getDatePartsInTimezone(date, timeZone));
}
