export function toCents(value: unknown): number {
  const numberValue = Number(String(value ?? '0'));
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error('Valor monetário inválido.');
  return Math.round(numberValue * 100);
}

export interface CompositionItem { quantity: unknown; unitPrice: unknown; subtotal: unknown }
export interface CompositionOrder { subtotal: unknown; deliveryFee: unknown; total: unknown }
export type CompositionResult =
  | { ok: true; itemSubtotalCents: number; shippingCents: number; totalCents: number }
  | { ok: false; reason: string };

/**
 * Valida a composição monetária em centavos inteiros.
 * O unitPrice salvo é uma média arredondada (promoção parcial), então ele NÃO
 * é usado para reconstruir o subtotal; apenas uma sanidade com tolerância de
 * arredondamento. A verdade é o subtotal de cada linha.
 * Frete grátis = 0 (nunca ausência de valor).
 */
export function validateOrderComposition(items: CompositionItem[], order: CompositionOrder): CompositionResult {
  try {
    if (!items.length) return { ok: false, reason: 'no_items' };
    let itemSubtotalCents = 0;
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return { ok: false, reason: 'invalid_quantity' };
      const line = toCents(item.subtotal);
      const unit = toCents(item.unitPrice);
      if (line <= 0 || unit <= 0) return { ok: false, reason: 'non_positive_line' };
      // média arredondada a 2 casas pode diferir até meio centavo por unidade
      if (Math.abs(line - unit * quantity) > quantity) return { ok: false, reason: 'line_unit_mismatch' };
      itemSubtotalCents += line;
    }
    const orderSubtotal = toCents(order.subtotal);
    const total = toCents(order.total);
    const fee = toCents(order.deliveryFee === null || order.deliveryFee === undefined || order.deliveryFee === '' ? 0 : order.deliveryFee);
    if (itemSubtotalCents <= 0 || total <= 0) return { ok: false, reason: 'non_positive_total' };
    if (itemSubtotalCents !== orderSubtotal) return { ok: false, reason: 'items_vs_order_subtotal' };
    if (total !== orderSubtotal + fee) return { ok: false, reason: 'total_vs_subtotal_plus_fee' };
    return { ok: true, itemSubtotalCents, shippingCents: fee, totalCents: total };
  } catch {
    return { ok: false, reason: 'invalid_amount' };
  }
}

type Tx = Record<string, unknown>;
const APPROVED = new Set(['processed', 'approved', 'accredited']);

/**
 * Escolhe a transação a partir das transações da própria Order consultada.
 * Prioriza a aprovada; depois a que coincide com o id auxiliar da URL; senão a
 * mais recente (última da lista). O id da URL nunca bloqueia a confirmação.
 */
export function pickProviderTransaction(transactions: Tx[], suppliedId?: string): Tx | undefined {
  if (!transactions.length) return undefined;
  const approved = transactions.find((t) => APPROVED.has(String(t.status || '').toLowerCase()) || APPROVED.has(String(t.status_detail || '').toLowerCase()));
  if (approved) return approved;
  if (suppliedId) {
    const match = transactions.find((t) => String(t.id || '') === suppliedId);
    if (match) return match;
  }
  return transactions[transactions.length - 1];
}

export interface ProviderItem { external_code: string; title: string; quantity: number; unit_price: string }
export interface OrderLine { productId: unknown; productName: unknown; quantity: unknown; subtotal: unknown }

const money = (valueInCents: number) => (valueInCents / 100).toFixed(2);

/**
 * Monta os itens enviados ao Mercado Pago a partir das linhas reais do pedido,
 * agrupadas por produto (entrega + encomenda do mesmo produto viram uma linha).
 * Se o subtotal da linha não for divisível pela quantidade (promoção parcial),
 * envia quantidade 1 com "Nx Produto" no título, para a soma ficar exata.
 * O frete (se > 0) vira uma linha "Entrega". Frete grátis não gera linha.
 * Devolve null se a soma não fechar com o total: o chamador usa o fallback de item único.
 */
export function buildProviderItems(lines: OrderLine[], totalCents: number, shippingCents: number, orderNumber: string, orderId: number): ProviderItem[] | null {
  const grouped = new Map<string, { name: string; qty: number; cents: number }>();
  for (const line of lines) {
    const key = String(line.productId ?? line.productName);
    const qty = Number(line.quantity);
    const cents = toCents(line.subtotal);
    if (!Number.isSafeInteger(qty) || qty < 1 || cents <= 0) return null;
    const current = grouped.get(key);
    if (current) { current.qty += qty; current.cents += cents; }
    else grouped.set(key, { name: String(line.productName || `Pedido ${orderNumber}`), qty, cents });
  }
  const items: ProviderItem[] = [];
  let index = 0;
  for (const g of grouped.values()) {
    index += 1;
    const exact = g.cents % g.qty === 0;
    items.push({
      external_code: `order-${orderId}-${index}`,
      title: (exact || g.qty === 1 ? g.name : `${g.qty}x ${g.name}`).slice(0, 250),
      quantity: exact ? g.qty : 1,
      unit_price: money(exact ? g.cents / g.qty : g.cents),
    });
  }
  if (shippingCents > 0) {
    items.push({ external_code: `order-${orderId}-shipping`, title: 'Entrega', quantity: 1, unit_price: money(shippingCents) });
  }
  const sum = items.reduce((acc, item) => acc + Math.round(Number(item.unit_price) * 100) * item.quantity, 0);
  if (!items.length || items.length > 50 || sum !== totalCents) return null;
  return items;
}
