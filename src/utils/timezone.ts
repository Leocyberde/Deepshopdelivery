// Helper universal de fuso horário para a loja DeepShop
export const DEFAULT_STORE_TIMEZONE = 'America/Sao_Paulo';

export interface TimezoneDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getDatePartsInTimezone(
  date: Date = new Date(),
  timeZone: string = DEFAULT_STORE_TIMEZONE
): TimezoneDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const rawHour = parseInt(map.hour || '0', 10);
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(map.minute || '0', 10),
    second: parseInt(map.second || '0', 10),
  };
}

export function tzToUtc(
  year: number,
  month: number,
  day: number,
  hour: number = 0,
  min: number = 0,
  sec: number = 0,
  ms: number = 0,
  timeZone: string = DEFAULT_STORE_TIMEZONE
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, min, sec, ms));
  const p = getDatePartsInTimezone(guess, timeZone);
  const offset =
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Date.UTC(year, month - 1, day, hour, min, sec);
  return new Date(guess.getTime() - offset);
}

export interface StoreRange {
  start: Date;
  end: Date;
}

export function getStoreRange(
  period: 'today' | 'month' | '7d' | '30d' | 'all',
  timeZone: string = DEFAULT_STORE_TIMEZONE,
  refDate: Date = new Date()
): StoreRange {
  if (period === 'all') {
    return {
      start: new Date(0),
      end: new Date(Date.now() + 86400000 * 365 * 10), // futuro
    };
  }

  const current = getDatePartsInTimezone(refDate, timeZone);

  if (period === 'today') {
    const start = tzToUtc(current.year, current.month, current.day, 0, 0, 0, 0, timeZone);
    const end = tzToUtc(current.year, current.month, current.day, 23, 59, 59, 999, timeZone);
    return { start, end };
  }

  if (period === 'month') {
    const start = tzToUtc(current.year, current.month, 1, 0, 0, 0, 0, timeZone);
    // Último dia do mês
    const nextMonth = current.month === 12 ? 1 : current.month + 1;
    const nextMonthYear = current.month === 12 ? current.year + 1 : current.year;
    // Início do próximo mês menos 1ms
    const startNextMonth = tzToUtc(nextMonthYear, nextMonth, 1, 0, 0, 0, 0, timeZone);
    const end = new Date(startNextMonth.getTime() - 1);
    return { start, end };
  }

  if (period === '7d') {
    const end = tzToUtc(current.year, current.month, current.day, 23, 59, 59, 999, timeZone);
    // 7 dias completos: hoje + 6 dias anteriores
    const startTemp = new Date(end.getTime() - 7 * 86400000 + 1);
    const startParts = getDatePartsInTimezone(startTemp, timeZone);
    const start = tzToUtc(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0, timeZone);
    return { start, end };
  }

  if (period === '30d') {
    const end = tzToUtc(current.year, current.month, current.day, 23, 59, 59, 999, timeZone);
    // 30 dias completos: hoje + 29 dias anteriores
    const startTemp = new Date(end.getTime() - 30 * 86400000 + 1);
    const startParts = getDatePartsInTimezone(startTemp, timeZone);
    const start = tzToUtc(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0, timeZone);
    return { start, end };
  }

  return {
    start: new Date(0),
    end: new Date(),
  };
}

export function formatStoreDateTime(
  date: Date | string | null | undefined,
  timeZone: string = DEFAULT_STORE_TIMEZONE
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatStoreDate(
  date: Date | string | null | undefined,
  timeZone: string = DEFAULT_STORE_TIMEZONE
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatStoreTime(
  date: Date | string | null | undefined,
  timeZone: string = DEFAULT_STORE_TIMEZONE
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
