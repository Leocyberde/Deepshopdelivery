import type { AddressSnapshot } from '../db/schema.ts';

export interface WhatsAppOrderItem {
  productName: string;
  quantity: number;
  unitPrice: string | number;
  subtotal: string | number;
}

export interface WhatsAppOrderPayload {
  orderNumber: string;
  items: WhatsAppOrderItem[];
  subtotal: string | number;
  deliveryFee: string | number | null;
  deliveryDistanceKm: string | number | null;
  total: string | number;
  addressSnapshot: AddressSnapshot;
  notes?: string | null;
  deliveryFeeSource?: string | null;
  paymentMethod?: string | null;
  changeFor?: string | number | null;
}

export function formatOrderSeqDisplay(orderNumber: string): string {
  const cleaned = String(orderNumber || '').replace(/^(Pedido\s*|#)/i, '').trim();
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && num > 0) {
    return String(num).padStart(2, '0');
  }
  return cleaned || orderNumber;
}

export function formatBrlPlain(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0,00';
  return num.toFixed(2).replace('.', ',');
}

export function formatDistancePlain(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  const formatted = num % 1 === 0 ? num.toFixed(1) : Number(num.toFixed(2)).toString();
  return formatted.replace('.', ',');
}

export function formatAddressLine(addr: AddressSnapshot): string {
  const complementPart = addr.complement ? ` (${addr.complement})` : '';
  const refPart = addr.reference ? ` - Ref: ${addr.reference}` : '';
  const zipPart = addr.zipCode ? ` - CEP: ${addr.zipCode}` : '';
  return `${addr.street}, ${addr.number}${complementPart} - ${addr.neighborhood} - ${addr.city}/${addr.state}${zipPart}${refPart}`;
}

export function isItatibaAddressCity(city?: string | null): boolean {
  if (!city) return false;
  const normalized = String(city)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'itatiba' || normalized.startsWith('itatiba ');
}

export function buildOrderWhatsAppMessage(order: WhatsAppOrderPayload): string {
  const lines: string[] = [];
  const seqCode = formatOrderSeqDisplay(order.orderNumber);
  const isItatiba = isItatibaAddressCity(order.addressSnapshot?.city);

  lines.push('Olá! Quero fazer um pedido pelo DeepShop Delivery.');
  lines.push(`Pedido: ${seqCode}`);
  lines.push('Produtos:');
  for (const item of order.items) {
    lines.push(`${item.quantity}x ${item.productName} - R$${formatBrlPlain(item.unitPrice)}`);
  }
  lines.push(`Subtotal: R$${formatBrlPlain(order.subtotal)}`);

  const isFreeDelivery = order.deliveryFee !== null &&
    order.deliveryFee !== undefined &&
    order.deliveryFee !== '' &&
    Number(order.deliveryFee) === 0;

  if (isFreeDelivery) {
    const isStoreCourtesy = ['MANUAL_FREE_DELIVERY', 'MANUAL_FREE_DELIVERY_PERIOD'].includes(
      String(order.deliveryFeeSource || '').toUpperCase()
    );
    lines.push(isStoreCourtesy ? 'Entrega: Grátis (cortesia da loja)' : 'Entrega: Grátis');
    if (!isItatiba) {
      lines.push('Modalidade: Entrega através dos Correios — conferir valor no WhatsApp');
    } else {
      lines.push('Modalidade: Temos delivery (Região de Itatiba)');
    }
    lines.push(`Total: R$${formatBrlPlain(order.subtotal)}`);
  } else {
    const hasConfirmedFreight =
      order.deliveryFee !== null &&
      order.deliveryFee !== undefined &&
      order.deliveryFee !== '';
    if (hasConfirmedFreight) {
      if (
        order.deliveryDistanceKm !== null &&
        order.deliveryDistanceKm !== undefined &&
        order.deliveryDistanceKm !== ''
      ) {
        lines.push(`Distância: ${formatDistancePlain(order.deliveryDistanceKm)} km`);
      }
      lines.push(`Entrega: R$${formatBrlPlain(order.deliveryFee!)}`);
      lines.push(
        isItatiba
          ? 'Modalidade: Temos delivery (Região de Itatiba)'
          : 'Modalidade: Entrega através dos Correios — conferir valor no WhatsApp'
      );
      lines.push(`Total: R$${formatBrlPlain(order.total)}`);
    } else {
      lines.push(
        isItatiba
          ? 'Entrega: a combinar (Temos delivery em Itatiba)'
          : 'Entrega: Entrega através dos Correios — conferir valor no WhatsApp'
      );
      lines.push(`Total (sem o frete): R$${formatBrlPlain(order.subtotal)}`);
    }
  }

  lines.push(`Endereço: ${formatAddressLine(order.addressSnapshot)}`);
  if (order.notes && order.notes.trim()) {
    lines.push(`Observações: ${order.notes.trim()}`);
  }
  return lines.join('\n');
}

export interface WhatsAppRefundPayload {
  orderNumber: string;
  customerName?: string;
  customerPhone?: string;
  items: WhatsAppOrderItem[];
  subtotal: string | number;
  deliveryFee: string | number | null;
  total: string | number;
  cancellationReason: string;
}

export function buildRefundWhatsAppMessage(payload: WhatsAppRefundPayload): string {
  const lines: string[] = [];
  lines.push('Olá! Solicito o cancelamento e estorno de um pedido pago no DeepShop.');
  lines.push(`Pedido: ${payload.orderNumber}`);
  if (payload.customerName) {
    lines.push(
      `Cliente: ${payload.customerName}${payload.customerPhone ? ` (${payload.customerPhone})` : ''}`
    );
  }
  lines.push('Produtos do Pedido:');
  for (const item of payload.items) {
    lines.push(`${item.quantity}x ${item.productName} - R$${formatBrlPlain(item.unitPrice)}`);
  }
  const hasFreight =
    payload.deliveryFee !== null &&
    payload.deliveryFee !== undefined &&
    payload.deliveryFee !== '';
  const totalPaid = hasFreight ? payload.total : payload.subtotal;
  lines.push(`Valor Pago para Estorno: R$${formatBrlPlain(totalPaid)}`);
  lines.push(`Motivo do Cancelamento: ${payload.cancellationReason || 'Não informado'}`);
  return lines.join('\n');
}

export function buildWhatsAppLink(phone: string, text: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const normalizedPhone = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(text)}`;
}
