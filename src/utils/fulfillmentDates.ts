import { getDatePartsInTimezone, tzToUtc } from './timezone.ts';
import { getFastDeliveryEstimate, type DeliveryStoreHours, type DeliveryMinutes } from './deliverySchedule.ts';

export const STORE_TIMEZONE = 'America/Sao_Paulo';

export interface PreorderWindow {
  start: Date;
  end: Date;
}

export interface FulfillmentSplit {
  deliveryQty: number;
  preorderQty: number;
}

export interface OrderPartTotals {
  deliverySubtotal: number;
  preorderSubtotal: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateFulfillmentSplit(quantity: number, stock: number, receiveAllAsPreorder = false): FulfillmentSplit {
  const safeQuantity = Math.max(0, Math.trunc(quantity));
  const safeStock = Math.max(0, Math.trunc(stock));
  if (receiveAllAsPreorder) return { deliveryQty: 0, preorderQty: safeQuantity };
  return { deliveryQty: Math.min(safeQuantity, safeStock), preorderQty: Math.max(0, safeQuantity - safeStock) };
}

export function calculatePreorderWindow(
  now = new Date(),
  startOffsetDays = 1,
  windowDays = 7,
  timeZone = STORE_TIMEZONE,
): PreorderWindow {
  const local = getDatePartsInTimezone(now, timeZone);
  const start = tzToUtc(local.year, local.month, local.day + startOffsetDays, 0, 0, 0, 0, timeZone);
  const endCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day + startOffsetDays + windowDays));
  const endLocal = { year: endCalendar.getUTCFullYear(), month: endCalendar.getUTCMonth() + 1, day: endCalendar.getUTCDate() };
  const end = tzToUtc(endLocal.year, endLocal.month, endLocal.day, 23, 59, 59, 999, timeZone);
  return { start, end };
}

export function formatPreorderWindow(window: PreorderWindow, timeZone = STORE_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' });
  return `${formatter.format(window.start)} a ${formatter.format(window.end)}`;
}

export function getDeliveryEta(
  now: Date,
  deliveryMinutes: DeliveryMinutes,
  hours: DeliveryStoreHours,
  timeZone = STORE_TIMEZONE,
): Date {
  return getFastDeliveryEstimate(now, deliveryMinutes, hours, timeZone);
}

export function formatDeliveryPromise(date: Date, now = new Date(), timeZone = STORE_TIMEZONE): string {
  const localDate = getDatePartsInTimezone(date, timeZone);
  const nowDate = getDatePartsInTimezone(now, timeZone);
  const formatted = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date).split(':');
  const time = `${formatted[0]}h${formatted[1] === '00' ? '' : formatted[1]}`;
  const sameDay = localDate.year === nowDate.year && localDate.month === nowDate.month && localDate.day === nowDate.day;
  const overnightFastWindow = date.getTime() > now.getTime() && date.getTime() - now.getTime() <= 180 * 60_000;
  return sameDay || overnightFastWindow ? `Chega até às ${time}` : `Entrega amanhã até às ${time}`;
}

export function calculateOrderPartTotals(
  deliverySubtotal: number,
  preorderSubtotal: number,
  deliveryFee: number,
): OrderPartTotals {
  const delivery = roundMoney(deliverySubtotal);
  const preorder = roundMoney(preorderSubtotal);
  const subtotal = roundMoney(delivery + preorder);
  const fee = roundMoney(Math.max(0, deliveryFee));
  return { deliverySubtotal: delivery, preorderSubtotal: preorder, subtotal, deliveryFee: fee, total: roundMoney(subtotal + fee) };
}

export function refundAmountForPart(
  scope: 'FULL_ORDER' | 'DELIVERY_PART' | 'PREORDER_PART',
  totals: OrderPartTotals,
  anyPartDelivered: boolean,
): number {
  const parts = scope === 'DELIVERY_PART' ? totals.deliverySubtotal : scope === 'PREORDER_PART' ? totals.preorderSubtotal : totals.subtotal;
  const fee = scope === 'FULL_ORDER' && !anyPartDelivered ? totals.deliveryFee : 0;
  return roundMoney(parts + fee);
}
