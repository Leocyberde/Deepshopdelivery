import { freightRulesFromSettings } from './freightConfig.ts';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { FreightRuleConfig } from '../../services/freightService.ts';

export const ORDER_STATUS_LABELS_PT: Record<string, string> = {
  NEW: 'Novo',
  AWAITING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pago',
  PREPARING: 'Em separação',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  PARTIALLY_DELIVERED: 'Parcialmente entregue',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

// Status em que os produtos estão reservados/descontados do estoque do sistema (Opção 2: reserva imediata no pedido)
export const STOCK_DEDUCTED_STATUSES = [
  'NEW',
  'AWAITING_PAYMENT',
  'PAID',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'PARTIALLY_DELIVERED',
  'DELIVERED',
];

// Status em que o cliente já realizou o pagamento (exige estorno se cancelado)
export const PAID_ORDER_STATUSES = ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED'];

// Status em que o cliente pode cancelar o pedido (antes de "Saiu para entrega")
export const CUSTOMER_CANCELLABLE_STATUSES = ['NEW', 'AWAITING_PAYMENT', 'PAID', 'PREPARING'];

export const VALID_ORDER_STATUSES = [
  'NEW',
  'AWAITING_PAYMENT',
  'PAID',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'PARTIALLY_DELIVERED',
  'DELIVERED',
  'CANCELLED',
];

export type FulfillmentStatusLike = { status: string };

/** Fonte única do status agregado do pedido. */
export function deriveOrderStatusFromFulfillments(
  orderStatus: string,
  fulfillments: FulfillmentStatusLike[],
): string {
  if (['NEW', 'AWAITING_PAYMENT', 'CANCELLED'].includes(orderStatus)) return orderStatus;
  const active = fulfillments.filter((item) => !['CANCELLED', 'REFUNDED'].includes(item.status));
  if (active.length > 0 && active.every((item) => item.status === 'DELIVERED')) return 'DELIVERED';
  if (active.some((item) => item.status === 'DELIVERED')) return 'PARTIALLY_DELIVERED';
  if (active.some((item) => item.status === 'OUT_FOR_DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (active.some((item) => item.status === 'PREPARING')) return 'PREPARING';
  return orderStatus;
}

export function computePaymentExpiresAt(deadlineHours = 0.5): Date {
  const validHours = !isNaN(deadlineHours) && deadlineHours > 0 ? deadlineHours : 1;
  return new Date(Date.now() + validHours * 3600 * 1000);
}

export function buildStatusNotificationTexts(
  orderNumber: string,
  oldStatus: string | null,
  newStatus: string
): { title: string; message: string } {
  const oldLabel = oldStatus ? ORDER_STATUS_LABELS_PT[oldStatus] || oldStatus : 'Anterior';
  const newLabel = ORDER_STATUS_LABELS_PT[newStatus] || newStatus;

  let title = `Atualização do Pedido ${orderNumber}: ${newLabel}`;
  let message = `O status do seu pedido ${orderNumber} mudou de "${oldLabel}" para "${newLabel}".`;

  if (newStatus === 'OUT_FOR_DELIVERY') {
    title = `🛵 Saiu para entrega! Pedido #${orderNumber}`;
    message = `O motoboy do DeepShop já está a caminho do seu endereço! Fique de olho para receber seus produtos.`;
  } else if (newStatus === 'DELIVERED') {
    title = `🎉 Pedido #${orderNumber} Entregue!`;
    message = `Seu pedido foi entregue com sucesso! Esperamos que ame seus novos produtos DeepShop.`;
  } else if (newStatus === 'PAID') {
    title = `✅ Pagamento Confirmado! Pedido #${orderNumber}`;
    message = `Seu pagamento foi confirmado com sucesso pelo ADM! Já estamos preparando o seu pacote para envio.`;
  } else if (newStatus === 'PREPARING') {
    title = `📦 Separando seus DeepShop! Pedido #${orderNumber}`;
    message = `Seus produtos já estão sendo separados e conferidos no estoque com todo o cuidado.`;
  } else if (newStatus === 'AWAITING_PAYMENT') {
    title = `💰 Frete definido! Pedido #${orderNumber}`;
    message = `O frete foi calculado e os produtos estão reservados! Conclua o pagamento via Pix no WhatsApp para liberar o envio.`;
  } else if (newStatus === 'CANCELLED') {
    title = `❌ Pedido #${orderNumber} Cancelado`;
    message = `Este pedido foi cancelado e os produtos reservados voltaram para o estoque da loja.`;
  }

  return { title, message };
}

// Validação de código do produto: até 4 dígitos (1 letra e até 3 números, ex: A001, B12, K105)
const PRODUCT_CODE_REGEX = /^[A-Za-z][0-9]{1,3}$/;

export function normalizeCpfDigits(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpfMask(raw: string | null | undefined): string {
  const digits = normalizeCpfDigits(raw);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }
  return digits;
}

export function isValidBrazilianCpf(raw: string | null | undefined): boolean {
  const digits = normalizeCpfDigits(raw);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits.charAt(i), 10) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits.charAt(9), 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits.charAt(i), 10) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits.charAt(10), 10)) return false;

  return true;
}

export function validateAndNormalizeCode(rawCode?: string): string | null {
  if (!rawCode) return null;
  const cleaned = String(rawCode).trim().toUpperCase();
  if (!PRODUCT_CODE_REGEX.test(cleaned)) return null;
  return cleaned;
}

export function calculateDiscountPercent(
  price: string | number,
  promoPrice: string | number | null | undefined,
  hasPromo: boolean
): number {
  if (!hasPromo || promoPrice === null || promoPrice === undefined) return 0;
  const normalNum = parseFloat(String(price));
  const promoNum = parseFloat(String(promoPrice));
  if (
    isNaN(normalNum) ||
    isNaN(promoNum) ||
    normalNum <= 0 ||
    promoNum <= 0 ||
    promoNum >= normalNum
  ) {
    return 0;
  }
  return Math.max(1, Math.round(((normalNum - promoNum) / normalNum) * 100));
}

export interface IncomingMediaItem {
  imageUrl?: string;
  url?: string;
  mediaType?: 'IMAGE' | 'VIDEO';
  durationSeconds?: number | null;
}

// A CSP de produção só permite imagem/vídeo da própria origem (+ data/blob). Por isso o cadastro
// aceita apenas mídia enviada pelo painel (/api/storage/...), nunca URLs externas.
export function isLocalMediaUrl(url: string): boolean {
  return /^\/api\/storage\/[A-Za-z0-9._-]+$/.test(url);
}

function assertLocalMediaUrl(url: string) {
  if (!isLocalMediaUrl(url)) {
    throw new Error(
      'Use apenas fotos/vídeos enviados pelo painel (upload). URLs externas não são permitidas.'
    );
  }
}

export function parseAndValidateMediaItems(body: any): Array<{
  imageUrl: string;
  mediaType: 'IMAGE' | 'VIDEO';
  durationSeconds: number | null;
  isPrimary: boolean;
}> | null {
  // If mediaItems array is provided, validate up to 5 photos and up to 1 video <= 30s
  if (Array.isArray(body.mediaItems)) {
    const cleaned = body.mediaItems
      .map((item: IncomingMediaItem) => {
        const rawUrl = String(item.imageUrl || item.url || '').trim();
        const type: 'IMAGE' | 'VIDEO' = item.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE';
        const dur =
          type === 'VIDEO' && item.durationSeconds !== undefined && item.durationSeconds !== null
            ? Math.round(Number(item.durationSeconds))
            : null;
        return { imageUrl: rawUrl, mediaType: type, durationSeconds: dur };
      })
      .filter((i: any) => i.imageUrl.length > 0);

    cleaned.forEach((i: any) => assertLocalMediaUrl(i.imageUrl));

    const photos = cleaned.filter((i: any) => i.mediaType === 'IMAGE');
    const videos = cleaned.filter((i: any) => i.mediaType === 'VIDEO');

    if (photos.length > 5) {
      throw new Error('Cada produto pode ter no máximo 5 fotos.');
    }
    if (videos.length > 1) {
      throw new Error('Cada produto pode ter no máximo 1 vídeo.');
    }
    if (videos.length === 1 && videos[0].durationSeconds && videos[0].durationSeconds > 30) {
      throw new Error('O vídeo do produto deve ter no máximo 30 segundos.');
    }

    const ordered = [...photos, ...videos];
    return ordered.map((item, idx) => ({
      imageUrl: item.imageUrl,
      mediaType: item.mediaType,
      durationSeconds: item.durationSeconds,
      isPrimary: idx === 0,
    }));
  }

  // Fallback for single imageUrl
  if (body.imageUrl !== undefined) {
    const trimmed = String(body.imageUrl || '').trim();
    if (!trimmed) return [];
    assertLocalMediaUrl(trimmed);
    return [
      {
        imageUrl: trimmed,
        mediaType: 'IMAGE',
        durationSeconds: null,
        isPrimary: true,
      },
    ];
  }

  return null;
}

export function isPromoCurrentlyActive(p: {
  promoActive?: boolean | null;
  promoPrice?: string | number | null;
  promoEndsAt?: Date | string | null;
}): boolean {
  const hasValidPrice =
    Boolean(p.promoActive) &&
    p.promoPrice !== null &&
    p.promoPrice !== undefined &&
    parseFloat(String(p.promoPrice)) > 0;
  if (!hasValidPrice) return false;
  if (p.promoEndsAt) {
    const endsMs = new Date(p.promoEndsAt).getTime();
    if (!isNaN(endsMs) && endsMs <= Date.now()) {
      return false;
    }
  }
  return true;
}

export function resolvePromoTiming(
  body: any,
  finalPromoActive: boolean,
  existingProd?: { promoEndsAt?: Date | null; promoDurationHours?: number | null } | null
): { promoEndsAt: Date | null; promoDurationHours: number | null } {
  if (!finalPromoActive) {
    return { promoEndsAt: null, promoDurationHours: null };
  }

  // If explicit promoEndsAt ISO string/timestamp is provided
  if (body.promoEndsAt) {
    const parsed = new Date(body.promoEndsAt);
    if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      const diffHours = Math.max(
        1,
        Math.round((parsed.getTime() - Date.now()) / (3600 * 1000))
      );
      return {
        promoEndsAt: parsed,
        promoDurationHours: Number(body.promoDurationHours) || diffHours,
      };
    }
  }

  // If duration in minutes or hours is provided
  const rawMinutes = Number(body.promoDurationMinutes);
  const rawHours = Number(body.promoDurationHours);
  if (!isNaN(rawMinutes) && rawMinutes > 0) {
    const endsAt = new Date(Date.now() + rawMinutes * 60 * 1000);
    return {
      promoEndsAt: endsAt,
      promoDurationHours: Math.max(1, Math.round(rawMinutes / 60)),
    };
  }
  if (!isNaN(rawHours) && rawHours > 0) {
    const endsAt = new Date(Date.now() + rawHours * 3600 * 1000);
    return {
      promoEndsAt: endsAt,
      promoDurationHours: Math.round(rawHours),
    };
  }

  // If editing an existing product with a valid future promoEndsAt, keep it; otherwise default to 24h
  if (
    existingProd?.promoEndsAt &&
    new Date(existingProd.promoEndsAt).getTime() > Date.now()
  ) {
    return {
      promoEndsAt: new Date(existingProd.promoEndsAt),
      promoDurationHours: existingProd.promoDurationHours || 24,
    };
  }

  return {
    promoEndsAt: new Date(Date.now() + 24 * 3600 * 1000),
    promoDurationHours: 24,
  };
}

export function resolvePromoMaxUnits(body: any, finalPromoActive: boolean): number | null {
  if (!finalPromoActive) return null;
  if (
    body.promoMaxUnits === null ||
    body.promoMaxUnits === undefined ||
    body.promoMaxUnits === '' ||
    body.promoLimitEnabled === false
  ) {
    return null;
  }
  const parsed = Number(body.promoMaxUnits);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('O limite da promoção deve ser um número inteiro maior que zero.');
  }
  return parsed;
}

export function calculatePromoLinePricing(params: {
  normalPrice: string | number;
  promoPrice?: string | number | null;
  hasPromo?: boolean;
  promoMaxUnits?: string | number | null;
  quantity: number;
}) {
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

// Requisito 3: Numeração sequencial global de pedidos (01, 02, 03, 04... 102, 103) sem risco de repetição
export function formatSequentialOrderNumber(seq: number): string {
  return String(Math.max(1, seq)).padStart(2, '0');
}

export async function getNextGlobalOrderNumber(tx: any): Promise<string> {
  const existingOrders = await tx
    .select({
      id: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
    })
    .from(schema.orders);

  let maxSeq = existingOrders.length;
  for (const row of existingOrders) {
    const cleanDigits = String(row.orderNumber || '').replace(/\D/g, '');
    const parsedNum = parseInt(cleanDigits, 10);
    if (!isNaN(parsedNum) && parsedNum > maxSeq) {
      maxSeq = parsedNum;
    }
  }

  const [seqSetting] = await tx
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'global_order_sequence'));

  if (seqSetting) {
    const savedSeq = parseInt(seqSetting.value, 10);
    if (!isNaN(savedSeq) && savedSeq > maxSeq) {
      maxSeq = savedSeq;
    }
  }

  const nextSeq = maxSeq + 1;
  const formatted = formatSequentialOrderNumber(nextSeq);

  if (seqSetting) {
    await tx
      .update(schema.settings)
      .set({ value: String(nextSeq), updatedAt: new Date() })
      .where(eq(schema.settings.key, 'global_order_sequence'));
  } else {
    await tx.insert(schema.settings).values({
      key: 'global_order_sequence',
      value: String(nextSeq),
    });
  }

  return formatted;
}

export async function getSettingsMap(executor: any = db): Promise<Record<string, string>> {
  const rows = await executor.select().from(schema.settings);
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

export async function getFreightRuleConfig(): Promise<FreightRuleConfig> {
  return freightRulesFromSettings(await getSettingsMap());
}
export async function getPrimaryStoreId(): Promise<number> {
  const allStores = await db.select().from(schema.stores);
  if (allStores.length > 0) return allStores[0].id;
  const [created] = await db
    .insert(schema.stores)
    .values({
      name: 'DeepShop',
      description: 'Loja própria DeepShop',
      type: 'OWN_STORE',
      status: 'ACTIVE',
    })
    .returning();
  return created.id;
}

// LGPD: CPF nunca vai completo para listas do painel admin. Mostra só os 2 últimos dígitos.
export function maskCpf(cpf?: string | null): string | null {
  if (!cpf) return null;
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length < 3) return '***.***.***-**';
  return `***.***.***-${digits.slice(-2)}`;
}
