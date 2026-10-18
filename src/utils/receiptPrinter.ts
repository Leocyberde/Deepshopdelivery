/**
 * Comanda para impressora térmica 58 mm (ESC/POS, 32 colunas, charset CP860 = português).
 * Gera texto e bytes; o envio é feito pelo app RawBT (Bluetooth clássico) ou pelo navegador.
 */
export const RECEIPT_COLS = 32;
export const STORE_NAME = 'DeepShop Delivery';

// CP860 (português): caracteres acentuados -> byte da impressora
const CP860: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87, 'ê': 0x88, 'Ê': 0x89,
  'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f, 'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93,
  'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97, 'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, 'Ó': 0x9f, 'á': 0xa0, 'í': 0xa1,
  'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, 'Ò': 0xa9,
};

export function encodeCP860(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    if (CP860[ch] !== undefined) { bytes.push(CP860[ch]); continue; }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) { bytes.push(code); continue; }
    if (ch === '\n') { bytes.push(0x0a); continue; }
    // fora da tabela (emoji, aspas curvas etc.): remove acento ou troca por equivalente simples
    const plain = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mapped = plain === '’' || plain === '‘' ? "'" : plain === '“' || plain === '”' ? '"' : plain === '–' || plain === '—' ? '-' : plain;
    for (const c of mapped) { const cc = c.codePointAt(0)!; if (cc >= 0x20 && cc < 0x7f) bytes.push(cc); }
  }
  return bytes;
}

export const brl = (value: unknown) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;

export function wrap(text: string, width = RECEIPT_COLS): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w;
      else if ((line + ' ' + w).length <= width) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

/** "Esquerda ....... Direita" na largura da bobina. */
export function lr(left: string, right: string, width = RECEIPT_COLS): string[] {
  const r = String(right);
  const leftLines = wrap(left, Math.max(1, width - r.length - 1));
  if (!leftLines.length) return [r.padStart(width)];
  const last = leftLines.pop()!;
  return [...leftLines, last + ' '.repeat(Math.max(1, width - last.length - r.length)) + r];
}

export interface ReceiptOrder {
  orderNumber: string;
  createdAt: string | Date;
  customerName?: string;
  customerPhone?: string;
  items: { quantity: number; productName: string; subtotal: unknown }[];
  subtotal: unknown;
  deliveryFee: unknown;
  total: unknown;
  paymentMethod?: string;
  changeFor?: unknown;
  paid: boolean;
  addressSnapshot?: Record<string, any> | null;
  notes?: string | null;
}

type Row = { text: string; align?: 'left' | 'center'; bold?: boolean; big?: boolean };

const paymentLabel = (method?: string) => {
  const m = String(method || '').toUpperCase();
  if (m === 'MERCADOPAGO') return 'Mercado Pago (online)';
  if (['CASH', 'CASH_ON_DELIVERY', 'DINHEIRO'].includes(m)) return 'Dinheiro na entrega';
  return method || 'Não informado';
};

export function buildReceiptRows(o: ReceiptOrder, storeName = STORE_NAME, siteUrl?: string): Row[] {
  const rows: Row[] = [];
  const sep = '-'.repeat(RECEIPT_COLS);
  const add = (lines: string[], extra: Partial<Row> = {}) => lines.forEach((text) => rows.push({ text, ...extra }));
  add(wrap(storeName.toUpperCase()), { align: 'center', bold: true });
  add([`PEDIDO #${o.orderNumber}`], { align: 'center', bold: true, big: true });
  const d = new Date(o.createdAt);
  add([d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })], { align: 'center' });
  rows.push({ text: sep });
  if (o.customerName) add(wrap(`Cliente: ${o.customerName}`), { bold: true });
  if (o.customerPhone) add([`Tel: ${o.customerPhone}`]);
  const a = o.addressSnapshot;
  if (a) {
    add(wrap('ENTREGA:'), { bold: true });
    add(wrap(`${a.street || ''}, ${a.number || ''}${a.complement ? ` (${a.complement})` : ''}`));
    add(wrap(`${a.neighborhood || ''} - ${a.city || ''}/${a.state || ''}`));
    if (a.zipCode) add([`CEP ${a.zipCode}`]);
    if (a.reference) add(wrap(`Ref: ${a.reference}`));
  }
  rows.push({ text: sep });
  for (const item of o.items) add(lr(`${item.quantity}x ${item.productName}`, brl(item.subtotal)));
  rows.push({ text: sep });
  add(lr('Subtotal', brl(o.subtotal)));
  const fee = o.deliveryFee === null || o.deliveryFee === undefined || o.deliveryFee === '' ? null : Number(o.deliveryFee);
  add(lr('Frete', fee === null ? '-' : fee === 0 ? 'Gratis' : brl(fee)));
  add(lr('TOTAL', brl(o.total)), { bold: true, big: true });
  rows.push({ text: sep });
  add(wrap(`Pagamento: ${paymentLabel(o.paymentMethod)}`));
  const cash = ['CASH', 'CASH_ON_DELIVERY', 'DINHEIRO'].includes(String(o.paymentMethod || '').toUpperCase());
  if (o.paid) add(['*** PAGO ***'], { align: 'center', bold: true, big: true });
  else if (cash) {
    add([`COBRAR NA ENTREGA: ${brl(o.total)}`], { bold: true });
    if (o.changeFor) add([`Troco para: ${brl(o.changeFor)}`]);
  } else add(['AGUARDANDO PAGAMENTO'], { bold: true });
  if (o.notes) { rows.push({ text: sep }); add(wrap(`Obs: ${o.notes}`)); }
  rows.push({ text: sep });
  add(['Obrigado pela preferencia!'], { align: 'center' });
  if (siteUrl) add(wrap(siteUrl.replace(/^https?:\/\//, '')), { align: 'center' });
  return rows;
}

export function receiptToText(o: ReceiptOrder, siteUrl?: string): string {
  return buildReceiptRows(o, STORE_NAME, siteUrl).map((r) => {
    if (r.align === 'center') return ' '.repeat(Math.max(0, Math.floor((RECEIPT_COLS - r.text.length) / 2))) + r.text;
    return r.text;
  }).join('\n');
}

/** QR code nativo ESC/POS (GS ( k), modelo 2, módulo 6, correção M. Texto limitado a 120 caracteres. */
export function qrEscPos(text: string): number[] {
  const data = [...Buffer_from(text.slice(0, 120))];
  const len = data.length + 3;
  return [
    0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
  ];
}
const Buffer_from = (t: string) => new TextEncoder().encode(t);

export function receiptToEscPos(o: ReceiptOrder, siteUrl?: string): Uint8Array {
  const out: number[] = [0x1b, 0x40]; // ESC @ : inicializa (volta ao charset padrão CP860 da impressora)
  const rows = buildReceiptRows(o, STORE_NAME, siteUrl);
  // com QR, o endereço do site fica logo abaixo do QR (última linha), não antes
  const urlRows = siteUrl ? Math.max(1, wrap(siteUrl.replace(/^https?:\/\//, '')).length) : 0;
  const body = rows.slice(0, rows.length - urlRows);
  const footer = rows.slice(rows.length - urlRows);
  const pushRow = (r: Row) => {
    out.push(0x1b, 0x61, r.align === 'center' ? 1 : 0);
    out.push(0x1b, 0x45, r.bold ? 1 : 0);
    // texto grande só em linhas curtas (a 2x largura cabem 16 colunas)
    const big = r.big && r.text.length <= RECEIPT_COLS / 2;
    out.push(0x1d, 0x21, big ? 0x11 : 0x00);
    out.push(...encodeCP860(r.text), 0x0a);
  };
  body.forEach(pushRow);
  if (siteUrl) {
    out.push(0x1b, 0x61, 1, 0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x0a);
    out.push(...qrEscPos(siteUrl), 0x0a);
    footer.forEach(pushRow);
  }
  out.push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x0a, 0x0a, 0x0a, 0x0a);
  return Uint8Array.from(out);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Link que abre o app RawBT já com a comanda (impressora pareada por Bluetooth). */
export const rawbtUrl = (o: ReceiptOrder, siteUrl?: string) => `rawbt:base64,${toBase64(receiptToEscPos(o, siteUrl))}`;

/** Fallback: abre uma página 58 mm e chama a impressão do navegador/Android. */
export function printWithBrowser(o: ReceiptOrder, siteUrl?: string) {
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${esc(o.orderNumber)}</title><style>@page{size:58mm auto;margin:0}body{margin:0;padding:2mm;width:54mm;font:12px/1.25 monospace}pre{margin:0;white-space:pre-wrap}</style></head><body><pre>${esc(receiptToText(o, siteUrl))}</pre></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}
