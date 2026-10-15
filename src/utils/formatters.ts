import { ProductMediaItem, PAYMENT_METHOD_LABELS } from '../types/app.ts';

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'R$ 0,00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 'R$ 0,00';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPaymentMethodDisplay(
  paymentMethod?: string | null,
  changeFor?: string | number | null
): string {
  const method = String(paymentMethod || 'PIX').toUpperCase();
  if (method === 'CASH') {
    const changeNum =
      changeFor !== null && changeFor !== undefined && changeFor !== ''
        ? typeof changeFor === 'string'
          ? parseFloat(changeFor)
          : Number(changeFor)
        : 0;
    if (!isNaN(changeNum) && changeNum > 0) {
      return `Dinheiro (Troco para ${formatCurrency(changeNum)})`;
    }
    return 'Dinheiro (Sem necessidade de troco)';
  }
  return PAYMENT_METHOD_LABELS[method] || 'Pix';
}

export function formatDistance(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  const formatted = num % 1 === 0 ? num.toFixed(1) : Number(num.toFixed(2)).toString();
  return `${formatted.replace('.', ',')} km`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatOrderNumberLabel(orderNumber: string | number | null | undefined): string {
  const raw = String(orderNumber ?? '').trim();
  if (!raw) return 'Pedido';
  if (/^pedido\s+/i.test(raw)) return raw;
  return `Pedido ${raw}`;
}

export function isItatibaCity(city: string | null | undefined): boolean {
  if (!city) return false;
  const normalized = String(city)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'itatiba' || normalized.startsWith('itatiba ');
}

export function calculateDiscountPercent(
  price: string | number | null | undefined,
  promoPrice: string | number | null | undefined,
  hasPromo = true
): number {
  if (!hasPromo || promoPrice === null || promoPrice === undefined || promoPrice === '') return 0;
  const normalNum = typeof price === 'string' ? parseFloat(price) : Number(price);
  const promoNum = typeof promoPrice === 'string' ? parseFloat(promoPrice) : Number(promoPrice);
  if (isNaN(normalNum) || isNaN(promoNum) || normalNum <= 0 || promoNum <= 0 || promoNum >= normalNum) {
    return 0;
  }
  return Math.max(1, Math.round(((normalNum - promoNum) / normalNum) * 100));
}

export function buildProductShareWhatsAppUrl(params: {
  id: number;
  code?: string | null;
  name: string;
  price: string | number;
  promoPrice?: string | number | null;
  hasPromo?: boolean;
}): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const productUrl = `${origin}/produto/${params.id}`;
  const fullTitle = params.code ? `${params.code} - ${params.name}` : params.name;
  const isPromo = Boolean(
    params.hasPromo &&
      params.promoPrice !== null &&
      params.promoPrice !== undefined &&
      params.promoPrice !== ''
  );

  const message = isPromo
    ? `🔥 Olha essa oferta no DeepShop Delivery:\n*${fullTitle}*\nDe ${formatCurrency(params.price)} por *${formatCurrency(params.promoPrice)}*!\n\nConfira aqui: ${productUrl}`
    : `🛍️ Olha esse achadinho no DeepShop Delivery:\n*${fullTitle}* por *${formatCurrency(params.price)}*!\n\nConfira aqui: ${productUrl}`;

  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function isVideoMedia(item: ProductMediaItem): boolean {
  if (item.mediaType === 'VIDEO') return true;
  const lower = (item.imageUrl || '').toLowerCase();
  return lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov');
}

export interface PromoLinePricingResult {
  hasPromo: boolean;
  hasLimit: boolean;
  hasLimitExceeded: boolean;
  promoMaxUnits: number | null;
  promoQty: number;
  normalQty: number;
  promoUnitPrice: number;
  normalUnitPrice: number;
  promoSubtotal: number;
  normalSubtotal: number;
  subtotal: number;
}

export function calculatePromoLinePricing(params: {
  normalPrice: string | number;
  promoPrice?: string | number | null;
  hasPromo?: boolean;
  promoMaxUnits?: string | number | null;
  quantity: number;
}): PromoLinePricingResult {
  const qty = Math.max(0, Math.floor(Number(params.quantity) || 0));
  const normalNum =
    typeof params.normalPrice === 'string'
      ? parseFloat(params.normalPrice)
      : Number(params.normalPrice || 0);
  const rawPromo =
    params.promoPrice !== null && params.promoPrice !== undefined && params.promoPrice !== ''
      ? typeof params.promoPrice === 'string'
        ? parseFloat(params.promoPrice)
        : Number(params.promoPrice)
      : 0;
  const isPromoActive = Boolean(params.hasPromo && !isNaN(rawPromo) && rawPromo > 0 && rawPromo < normalNum);
  const promoNum = isPromoActive ? rawPromo : normalNum;

  const parsedLimit =
    params.promoMaxUnits !== null &&
    params.promoMaxUnits !== undefined &&
    params.promoMaxUnits !== ''
      ? Math.floor(Number(params.promoMaxUnits))
      : 0;
  const hasLimit = isPromoActive && !isNaN(parsedLimit) && parsedLimit > 0;
  const limitVal = hasLimit ? parsedLimit : null;

  if (!isPromoActive) {
    const normalSubtotal = Number((normalNum * qty).toFixed(2));
    return {
      hasPromo: false,
      hasLimit: false,
      hasLimitExceeded: false,
      promoMaxUnits: null,
      promoQty: 0,
      normalQty: qty,
      promoUnitPrice: normalNum,
      normalUnitPrice: normalNum,
      promoSubtotal: 0,
      normalSubtotal,
      subtotal: normalSubtotal,
    };
  }

  if (hasLimit && limitVal !== null) {
    const promoQty = Math.min(qty, limitVal);
    const normalQty = Math.max(0, qty - limitVal);
    const promoSubtotal = Number((promoQty * promoNum).toFixed(2));
    const normalSubtotal = Number((normalQty * normalNum).toFixed(2));
    const subtotal = Number((promoSubtotal + normalSubtotal).toFixed(2));
    return {
      hasPromo: true,
      hasLimit: true,
      hasLimitExceeded: normalQty > 0,
      promoMaxUnits: limitVal,
      promoQty,
      normalQty,
      promoUnitPrice: promoNum,
      normalUnitPrice: normalNum,
      promoSubtotal,
      normalSubtotal,
      subtotal,
    };
  }

  const promoSubtotal = Number((qty * promoNum).toFixed(2));
  return {
    hasPromo: true,
    hasLimit: false,
    hasLimitExceeded: false,
    promoMaxUnits: null,
    promoQty: qty,
    normalQty: 0,
    promoUnitPrice: promoNum,
    normalUnitPrice: normalNum,
    promoSubtotal,
    normalSubtotal: 0,
    subtotal: promoSubtotal,
  };
}

