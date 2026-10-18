import test from 'node:test';
import assert from 'node:assert/strict';
import { qrEscPos, RECEIPT_COLS, buildReceiptRows, encodeCP860, lr, receiptToEscPos, receiptToText, wrap } from '../src/utils/receiptPrinter.ts';

const order = {
  orderNumber: '00658', createdAt: '2026-10-18T11:00:00Z', customerName: 'Leonardo Silva', customerPhone: '11999990000',
  items: [{ quantity: 2, productName: 'Garrafa térmica inox 500ml edição especial', subtotal: '50.00' }, { quantity: 1, productName: 'Caneca', subtotal: '20.00' }],
  subtotal: '70.00', deliveryFee: '7.50', total: '77.50', paymentMethod: 'MERCADOPAGO', paid: true,
  addressSnapshot: { street: 'Rua das Flores', number: '10', complement: 'ap 3', neighborhood: 'Centro', city: 'Itatiba', state: 'SP', zipCode: '13250-000' },
  notes: 'Tocar a campainha',
};

test('acentos saem em CP860 (português)', () => {
  assert.deepEqual(encodeCP860('ção'), [0x87, 0x84, 0x6f]);
  assert.deepEqual(encodeCP860('Ação é à'), [0x41, 0x87, 0x84, 0x6f, 0x20, 0x82, 0x20, 0x85]);
  assert.deepEqual(encodeCP860('R$ 1,50 ✓'), [...Buffer.from('R$ 1,50 ')]); // símbolo desconhecido é descartado
});

test('nenhuma linha passa de 32 colunas', () => {
  for (const r of buildReceiptRows(order)) assert.ok(r.text.length <= RECEIPT_COLS, r.text);
  assert.ok(wrap('Palavraenormesemespacoquepassadotamanhodalinha e mais').every((l) => l.length <= RECEIPT_COLS));
  const [line] = lr('2x Caneca', 'R$ 20,00');
  assert.equal(line.length, RECEIPT_COLS);
});

test('comanda tem pedido, endereço, itens, frete, total e pago', () => {
  const t = receiptToText(order);
  for (const s of ['PEDIDO #00658', 'Rua das Flores, 10 (ap 3)', 'R$ 77,50', 'Frete', '*** PAGO ***', 'Obs: Tocar a campainha']) assert.ok(t.includes(s), s);
});

test('dinheiro não pago mostra cobrar e troco; frete grátis', () => {
  const t = receiptToText({ ...order, paymentMethod: 'CASH', paid: false, changeFor: '100', deliveryFee: '0', total: '70.00' });
  assert.ok(t.includes('COBRAR NA ENTREGA: R$ 70,00') && t.includes('Troco para: R$ 100,00') && t.includes('Gratis'));
});

test('ESC/POS começa com init e termina com avanço de papel', () => {
  const b = receiptToEscPos(order);
  assert.deepEqual([b[0], b[1]], [0x1b, 0x40]);
  assert.deepEqual([...b.slice(-4)], [0x0a, 0x0a, 0x0a, 0x0a]);
});

test('QR code ESC/POS: comandos GS ( k na ordem certa, com a URL do site', () => {
  const url = 'https://loja.example.com.br';
  const q = qrEscPos(url);
  assert.deepEqual(q.slice(0, 9), [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); // modelo 2
  const storeAt = q.findIndex((_, i) => q[i] === 0x31 && q[i + 1] === 0x50 && q[i + 2] === 0x30);
  assert.equal(q[storeAt - 2], url.length + 3); // pL
  assert.equal(q[storeAt - 1], 0); // pH
  assert.equal(Buffer.from(q.slice(storeAt + 3, storeAt + 3 + url.length)).toString(), url);
  assert.deepEqual(q.slice(-8), [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]); // imprimir
});

test('comanda com site: QR no ESC/POS e endereço do site abaixo; texto mostra o site', () => {
  const url = 'https://loja.example.com.br';
  const b = receiptToEscPos(order, url);
  assert.ok(Buffer.from(b).toString('hex').includes('1d286b040031413200')); // comando de QR modelo 2 presente
  assert.ok(Buffer.from(b).includes(Buffer.from('loja.example.com.br')));
  assert.ok(receiptToText(order, url).includes('loja.example.com.br'));
  assert.ok(receiptToEscPos(order).length < b.length); // sem site não tem QR
});
