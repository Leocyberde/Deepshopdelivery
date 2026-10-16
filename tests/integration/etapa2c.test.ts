import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL || 'postgresql://deepshop_test:deepshop_test_local@127.0.0.1:5432/deepshop_test';
const port = 3213; const base = `http://127.0.0.1:${port}`;
let server: ChildProcess; let pool: Pool;
let ownerToken = ''; let managerToken = ''; let customerToken = '';
let storeId = 0; let productId = 0; let customerId = 0;

async function call(path: string, token: string, body?: any, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { response, body: parsed };
}
async function login(email: string) { const r = await call('/api/auth/login', '', { email, password: 'TesteSeguro123!' }); assert.ok(r.body.token, `login ${email}`); return r.body.token as string; }

/** Pedido pago de R$ 25 = delivery R$ 10 + encomenda R$ 10 + frete R$ 5. */
async function seedOrder(orderNumber: string, deliveryStatus = 'OUT_FOR_DELIVERY', orderStatus = 'PAID') {
  const order = await pool.query(`INSERT INTO orders(order_number,user_id,store_id,subtotal,delivery_fee,total,status,address_snapshot) VALUES($1,$2,$3,'20.00','5.00','25.00',$4,$5) RETURNING id`, [orderNumber, customerId, storeId, orderStatus, JSON.stringify({ label: 'Casa', zipCode: '13200-000', street: 'Rua Teste', number: '1', neighborhood: 'Centro', city: 'Itatiba', state: 'SP' })]);
  const orderId = order.rows[0].id as number;
  await pool.query(`INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,subtotal,unit_cost,fulfillment_type) VALUES($1,$2,'Produto 2C',1,'10.00','10.00','4.000000','DELIVERY'),($1,$2,'Produto 2C',1,'10.00','10.00','4.000000','PREORDER')`, [orderId, productId]);
  const delivery = await pool.query(`INSERT INTO order_fulfillments(order_id,type,status,eta_at) VALUES($1,'DELIVERY',$2,NOW()) RETURNING id`, [orderId, deliveryStatus]);
  const preorder = await pool.query(`INSERT INTO order_fulfillments(order_id,type,status,eta_start,eta_end) VALUES($1,'PREORDER','PREPARING',NOW()-interval '4 days',NOW()-interval '1 day') RETURNING id`, [orderId]);
  await pool.query(`INSERT INTO payments(order_id,provider,external_reference,provider_order_id,provider_payment_id,idempotency_key,amount,status,provider_status) VALUES($1,'MERCADOPAGO',$2,$3,$4,$5,'25.00','PAID','accredited')`, [orderId, `ext-${orderNumber}`, `ORD-${orderNumber}`, `PAY-${orderNumber}`, `idem-${orderNumber}`]);
  return { orderId, deliveryId: delivery.rows[0].id as number, preorderId: preorder.rows[0].id as number };
}
/** Fluxo real: admin cria aviso de atraso e o cliente escolhe reembolso. Devolve o id do reembolso. */
async function requestRefund(preorderId: number) {
  const notice = await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, ownerToken, { message: 'Atraso 2C' }); assert.equal(notice.response.status, 201);
  const answer = await call(`/api/delay-notices/${notice.body.notice.id}/respond`, customerToken, { choice: 'REFUND' }); assert.equal(answer.response.status, 200);
  assert.ok(answer.body.refundId); return answer.body.refundId as number;
}
const decisionMessages = async (orderNumber: string) => (await pool.query("SELECT message FROM notifications WHERE order_number=$1 AND kind='REFUND_DECISION' ORDER BY id", [orderNumber])).rows.map((r) => r.message as string);

before(async () => {
  pool = new Pool({ connectionString: databaseUrl }); const hash = await bcrypt.hash('TesteSeguro123!', 10);
  // O schema é criado pelo servidor na inicialização: subir o servidor ANTES de semear.
  server = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'server.ts'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_URL: databaseUrl, JWT_SECRET: 'integration-secret-with-more-than-32-characters', SEED_INITIAL_CATALOG: 'false', DISABLE_HMR: 'true', SITE_URL: base }, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await delay(250); }
  await pool.query("DELETE FROM orders WHERE order_number LIKE '2C-TEST-%'");
  for (const table of ['users', 'stores', 'categories', 'suppliers', 'products', 'orders', 'order_items', 'order_fulfillments', 'payments']) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`);
  }
  const upsertUser = (name: string, email: string, phone: string, role: string) => pool.query(`INSERT INTO users (name,email,phone,password_hash,role,status,session_version) VALUES ($1,$2,$3,$4,$5,'ACTIVE',1) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,status='ACTIVE' RETURNING id`, [name, email, phone, hash, role]);
  await upsertUser('Dono 2C', 'owner.2c@test.local', '11988887777', 'SUPER_ADMIN');
  await upsertUser('Gerente 2C', 'manager.2c@test.local', '11988886666', 'GERENTE');
  customerId = (await upsertUser('Cliente 2C', 'customer.2c@test.local', '11977776666', 'CUSTOMER')).rows[0].id;
  const store = await pool.query(`INSERT INTO stores(name) VALUES('Loja 2C') RETURNING id`); storeId = store.rows[0].id;
  const category = await pool.query(`INSERT INTO categories(store_id,name) VALUES($1,'Categoria 2C') RETURNING id`, [storeId]);
  const supplier = await pool.query(`INSERT INTO suppliers(name,website) VALUES('Fornecedor 2C','https://supplier.test') RETURNING id`);
  const product = await pool.query(`INSERT INTO products(store_id,category_id,code,name,price,cost,stock,supplier_id,fulfillment_type,allow_preorder) VALUES($1,$2,'C201','Produto 2C',10,4,1,$3,'PREORDER',true) RETURNING id`, [storeId, category.rows[0].id, supplier.rows[0].id]); productId = product.rows[0].id;
  ownerToken = await login('owner.2c@test.local'); managerToken = await login('manager.2c@test.local'); customerToken = await login('customer.2c@test.local');
});
after(async () => { if (server?.exitCode === null) server.kill('SIGTERM'); await delay(500); await pool?.end(); });

test('2C: só o dono acessa a fila; valor limitado aos itens (sem frete); aprovar, travar entrega e marcar devolvido', async () => {
  const { orderId, preorderId } = await seedOrder('2C-TEST-001');
  const refundId = await requestRefund(preorderId);
  const row = (await pool.query('SELECT status, amount::text AS amount, due_at FROM refunds WHERE id=$1', [refundId])).rows[0];
  assert.equal(row.status, 'REQUESTED'); assert.equal(row.amount, '10.00');
  const dueIn = new Date(row.due_at).getTime() - Date.now(); assert.ok(dueIn > 23 * 3_600_000 && dueIn <= 24 * 3_600_000, 'prazo de análise de 24h');

  // Só o dono (SUPER_ADMIN): gerente e cliente recebem 403 em leitura e escrita.
  assert.equal((await call('/api/admin/refunds', managerToken)).response.status, 403);
  assert.equal((await call('/api/admin/refunds', customerToken)).response.status, 403);
  assert.equal((await call(`/api/admin/refunds/${refundId}/approve`, managerToken, {})).response.status, 403);
  assert.equal((await call(`/api/admin/refunds/${refundId}/reject`, managerToken, { reason: 'não' })).response.status, 403);

  const list = await call('/api/admin/refunds?status=REQUESTED', ownerToken); assert.equal(list.response.status, 200);
  const mine = list.body.refunds.find((r: any) => r.id === refundId);
  assert.equal(mine.maxAmount, '10.00', 'máximo = itens da encomenda; o frete de R$ 5 não entra');
  assert.equal(mine.customer.name, 'Cliente 2C'); assert.equal(mine.customer.phone, '11977776666');
  assert.equal(mine.payment.providerPaymentId, 'PAY-2C-TEST-001'); assert.equal(mine.overdue, false);

  // Valores inválidos ou acima dos itens (inclusive somando o frete) são recusados.
  for (const amount of ['10,01', '15,00', '25,00', 'abc', '0', '-3']) {
    assert.equal((await call(`/api/admin/refunds/${refundId}/approve`, ownerToken, { amount })).response.status, 400, `amount ${amount}`);
  }
  assert.equal((await pool.query('SELECT status FROM refunds WHERE id=$1', [refundId])).rows[0].status, 'REQUESTED');
  assert.equal((await call(`/api/admin/refunds/${refundId}/mark-refunded`, ownerToken, {})).response.status, 409, 'só marca devolvido depois de aprovar');

  const approved = await call(`/api/admin/refunds/${refundId}/approve`, ownerToken, { amount: '8,00', note: 'Desconto combinado' }); assert.equal(approved.response.status, 200); assert.equal(approved.body.approvedAmount, '8.00');
  assert.ok((await decisionMessages('2C-TEST-001')).some((m) => m.includes('R$ 8,00') && m.includes('aprovado')));
  assert.equal((await call(`/api/admin/refunds/${refundId}/approve`, ownerToken, { amount: '9,00' })).response.status, 409, 'segunda decisão é recusada');
  assert.equal((await call(`/api/admin/refunds/${refundId}/reject`, ownerToken, { reason: 'mudei de ideia' })).response.status, 409);
  assert.equal((await decisionMessages('2C-TEST-001')).length, 1, 'cliente só é avisado uma vez');

  // Enquanto o reembolso está aberto, a parte não pode ser marcada como entregue.
  await pool.query("UPDATE order_fulfillments SET status='OUT_FOR_DELIVERY' WHERE id=$1", [preorderId]);
  const blocked = await call(`/api/admin/fulfillments/${preorderId}/status`, ownerToken, { status: 'DELIVERED' }, 'PATCH'); assert.equal(blocked.response.status, 400);
  await pool.query("UPDATE order_fulfillments SET status='PREPARING' WHERE id=$1", [preorderId]);

  // Devolução parcial (R$ 8 de R$ 10): registra, avisa e mantém a entrega ativa.
  const done = await call(`/api/admin/refunds/${refundId}/mark-refunded`, ownerToken, { note: 'Pix feito pelo dono' }); assert.equal(done.response.status, 200); assert.equal(done.body.fulfillmentRefunded, false);
  const after = (await pool.query('SELECT status, notes, processed_by FROM refunds WHERE id=$1', [refundId])).rows[0]; assert.equal(after.status, 'PROCESSED'); assert.equal(after.notes, 'Pix feito pelo dono'); assert.ok(after.processed_by);
  assert.equal((await pool.query('SELECT status FROM order_fulfillments WHERE id=$1', [preorderId])).rows[0].status, 'PREPARING');
  assert.equal((await call(`/api/admin/refunds/${refundId}/mark-refunded`, ownerToken, {})).response.status, 409, 'não registra duas vezes');
  const msgs = await decisionMessages('2C-TEST-001'); assert.equal(msgs.length, 2); assert.ok(msgs[1].includes('R$ 8,00') && msgs[1].includes('realizada'));
  void orderId;
});

test('2C: recusa exige motivo, avisa o cliente e mantém a encomenda ativa', async () => {
  const { preorderId } = await seedOrder('2C-TEST-002');
  const refundId = await requestRefund(preorderId);
  assert.equal((await call(`/api/admin/refunds/${refundId}/reject`, ownerToken, {})).response.status, 400);
  assert.equal((await call(`/api/admin/refunds/${refundId}/reject`, ownerToken, { reason: 'ab' })).response.status, 400);
  const rejected = await call(`/api/admin/refunds/${refundId}/reject`, ownerToken, { reason: 'Produto já foi despachado' }); assert.equal(rejected.response.status, 200);
  assert.equal((await pool.query('SELECT status, decision_reason FROM refunds WHERE id=$1', [refundId])).rows[0].decision_reason, 'Produto já foi despachado');
  const msgs = await decisionMessages('2C-TEST-002'); assert.equal(msgs.length, 1); assert.ok(msgs[0].includes('não foi aprovado') && msgs[0].includes('Produto já foi despachado'));
  assert.equal((await pool.query('SELECT status FROM order_fulfillments WHERE id=$1', [preorderId])).rows[0].status, 'PREPARING');
  assert.equal((await call(`/api/admin/refunds/${refundId}/approve`, ownerToken, {})).response.status, 409);
});

test('2C: passou de 24h apenas sinaliza e avisa o dono uma única vez; nunca aprova sozinho', async () => {
  const { orderId, preorderId } = await seedOrder('2C-TEST-003');
  const refundId = await requestRefund(preorderId);
  await pool.query("UPDATE refunds SET due_at = NOW() - interval '1 hour' WHERE id=$1", [refundId]);
  const first = await call('/api/admin/refunds?status=REQUESTED', ownerToken); const second = await call('/api/admin/refunds?status=REQUESTED', ownerToken);
  const mine = first.body.refunds.find((r: any) => r.id === refundId); assert.equal(mine.overdue, true); assert.ok(first.body.overdueCount >= 1); assert.equal(second.response.status, 200);
  const alerts = await pool.query("SELECT count(*)::int AS count FROM admin_notifications WHERE type='REFUND_OVERDUE' AND order_id=$1", [orderId]); assert.equal(alerts.rows[0].count, 1);
  assert.equal((await pool.query('SELECT status FROM refunds WHERE id=$1', [refundId])).rows[0].status, 'REQUESTED', 'continua aguardando decisão do dono');
  assert.equal((await decisionMessages('2C-TEST-003')).length, 0);
});

test('2C: reembolso total sem informar valor usa o máximo, fecha a parte encomenda e recalcula o pedido', async () => {
  const { orderId, preorderId } = await seedOrder('2C-TEST-004', 'DELIVERED', 'PARTIALLY_DELIVERED');
  const refundId = await requestRefund(preorderId);
  const approved = await call(`/api/admin/refunds/${refundId}/approve`, ownerToken, {}); assert.equal(approved.response.status, 200); assert.equal(approved.body.approvedAmount, '10.00');
  const done = await call(`/api/admin/refunds/${refundId}/mark-refunded`, ownerToken, {}); assert.equal(done.response.status, 200); assert.equal(done.body.fulfillmentRefunded, true);
  assert.equal((await pool.query('SELECT status FROM order_fulfillments WHERE id=$1', [preorderId])).rows[0].status, 'REFUNDED');
  assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status, 'DELIVERED', 'só a parte delivery restou e foi entregue');
  // Sem novo aviso/reembolso para uma parte já reembolsada.
  assert.equal((await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, ownerToken, { message: 'de novo' })).response.status, 409);
  const all = await call('/api/admin/refunds?status=PROCESSED', ownerToken); assert.ok(all.body.refunds.some((r: any) => r.id === refundId));
});
