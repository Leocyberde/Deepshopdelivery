import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL || 'postgresql://deepshop_test:deepshop_test_local@127.0.0.1:5432/deepshop_test';
const port = 3212; const base = `http://127.0.0.1:${port}`; const orderNumber = '2B-TEST-001';
let server: ChildProcess; let pool: Pool; let adminToken = ''; let customerToken = ''; let deliveryId = 0; let preorderId = 0; let noticeId = 0;
async function call(path: string, token: string, body?: any, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { response, body: parsed };
}
before(async () => {
  pool = new Pool({ connectionString: databaseUrl }); const hash = await bcrypt.hash('TesteSeguro123!', 10);
  // O schema é criado pelo servidor na inicialização: subir o servidor ANTES de semear.
  server = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'server.ts'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_URL: databaseUrl, JWT_SECRET: 'integration-secret-with-more-than-32-characters', SEED_INITIAL_CATALOG: 'false', DISABLE_HMR: 'true', SITE_URL: base }, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await delay(250); }
  await pool.query('DELETE FROM orders WHERE order_number=$1', [orderNumber]);
  for (const table of ['users', 'stores', 'categories', 'suppliers', 'products', 'orders', 'order_items', 'order_fulfillments']) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`);
  }
  const admin = await pool.query(`INSERT INTO users (name,email,phone,password_hash,role,status,session_version) VALUES ('Admin 2B','admin.2b@test.local','11988887777',$1,'SUPER_ADMIN','ACTIVE',1) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='SUPER_ADMIN',status='ACTIVE' RETURNING id`, [hash]);
  const customer = await pool.query(`INSERT INTO users (name,email,phone,password_hash,role,status,session_version) VALUES ('Cliente 2B','customer.2b@test.local','11977776666',$1,'CUSTOMER','ACTIVE',1) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='CUSTOMER',status='ACTIVE' RETURNING id`, [hash]);
  const store = await pool.query(`INSERT INTO stores(name) VALUES('Loja 2B') RETURNING id`); const category = await pool.query(`INSERT INTO categories(store_id,name) VALUES($1,'Categoria 2B') RETURNING id`, [store.rows[0].id]);
  const supplier = await pool.query(`INSERT INTO suppliers(name,website) VALUES('Fornecedor 2B','https://supplier.test') RETURNING id`, []);
  const product = await pool.query(`INSERT INTO products(store_id,category_id,code,name,price,cost,stock,supplier_id,fulfillment_type,allow_preorder) VALUES($1,$2,'B201','Produto 2B',10,4,1,$3,'PREORDER',true) RETURNING id`, [store.rows[0].id, category.rows[0].id, supplier.rows[0].id]);
  const order = await pool.query(`INSERT INTO orders(order_number,user_id,store_id,subtotal,delivery_fee,total,status,address_snapshot) VALUES($1,$2,$3,'20.00','5.00','25.00','PAID',$4) RETURNING id`, [orderNumber, customer.rows[0].id, store.rows[0].id, JSON.stringify({ label: 'Casa', zipCode: '13200-000', street: 'Rua Teste', number: '1', neighborhood: 'Centro', city: 'Itatiba', state: 'SP' })]);
  await pool.query(`INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,subtotal,unit_cost,fulfillment_type) VALUES($1,$2,'Produto 2B',1,'10.00','10.00','4.000000','DELIVERY'),($1,$2,'Produto 2B',1,'10.00','10.00','4.000000','PREORDER')`, [order.rows[0].id, product.rows[0].id]);
  const delivery = await pool.query(`INSERT INTO order_fulfillments(order_id,type,status,eta_at) VALUES($1,'DELIVERY','OUT_FOR_DELIVERY',NOW()+interval '2 hours') RETURNING id`, [order.rows[0].id]); deliveryId = delivery.rows[0].id;
  const preorder = await pool.query(`INSERT INTO order_fulfillments(order_id,type,status,eta_start,eta_end) VALUES($1,'PREORDER','PREPARING',NOW()-interval '4 days',NOW()-interval '1 day') RETURNING id`, [order.rows[0].id]); preorderId = preorder.rows[0].id;
  const a = await call('/api/auth/login', '', { email: 'admin.2b@test.local', password: 'TesteSeguro123!' }); adminToken = a.body.token;
  const c = await call('/api/auth/login', '', { email: 'customer.2b@test.local', password: 'TesteSeguro123!' }); customerToken = c.body.token;
  assert.ok(adminToken); assert.ok(customerToken); void admin;
});
after(async () => { if (server?.exitCode === null) server.kill('SIGTERM'); await delay(500); await pool?.end(); });

test('B2/B6: lista enriquecida, status agregado, aviso e notificação do cliente', async () => {
  const list = await call('/api/admin/fulfillments?type=PREORDER', adminToken); assert.equal(list.response.status, 200); const mine = list.body.fulfillments.find((f: any) => f.order.orderNumber === orderNumber); assert.ok(mine, 'a encomenda deste teste deve aparecer na lista (a base pode ter dados de outras suítes)'); assert.equal(mine.customer.name, 'Cliente 2B'); assert.equal(mine.items.length, 1); assert.equal(mine.supplier.name, 'Fornecedor 2B'); assert.equal(mine.overdue, true);
  let changed = await call(`/api/admin/fulfillments/${deliveryId}/status`, adminToken, { status: 'DELIVERED' }, 'PATCH'); assert.equal(changed.response.status, 200); let order = await pool.query('SELECT status FROM orders WHERE order_number=$1', [orderNumber]); assert.equal(order.rows[0].status, 'PARTIALLY_DELIVERED');
  changed = await call(`/api/admin/fulfillments/${preorderId}/status`, adminToken, { status: 'OUT_FOR_DELIVERY' }, 'PATCH'); assert.equal(changed.response.status, 200);
  changed = await call(`/api/admin/fulfillments/${preorderId}/status`, adminToken, { status: 'DELIVERED' }, 'PATCH'); assert.equal(changed.response.status, 200); order = await pool.query('SELECT status FROM orders WHERE order_number=$1', [orderNumber]); assert.equal(order.rows[0].status, 'DELIVERED');
  const notice = await call(`/api/admin/fulfillments/${preorderId}/notify`, adminToken, { template: 'TOMORROW' }); assert.equal(notice.response.status, 201); assert.ok(notice.body.notification.id);
  const statusNotif = await pool.query("SELECT count(*)::int AS count FROM notifications WHERE order_number=$1 AND new_status='PARTIALLY_DELIVERED'", [orderNumber]); assert.equal(statusNotif.rows[0].count, 1);
  const customerNotifs = await call('/api/notifications', customerToken); assert.equal(customerNotifs.response.status, 200); assert.equal(customerNotifs.body.notifications.some((n: any) => n.kind === 'OWNER_MESSAGE'), true);
});

const ownerMessages = async () => (await pool.query("SELECT count(*)::int AS count FROM notifications WHERE order_number=$1 AND kind='OWNER_MESSAGE'", [orderNumber])).rows[0].count as number;
const setStatus = (id: number, status: string) => pool.query('UPDATE order_fulfillments SET status=$2, delivered_at=NULL WHERE id=$1', [id, status]);

test('B6.1: lote ignora partes finalizadas e avisa no máximo uma vez por pedido', async () => {
  let before = await ownerMessages();
  let batch = await call('/api/admin/fulfillments/notify-batch', adminToken, { template: 'TOMORROW' });
  assert.equal(batch.response.status, 201); assert.equal(await ownerMessages(), before, 'partes DELIVERED não podem receber aviso em lote');
  await setStatus(deliveryId, 'OUT_FOR_DELIVERY'); await setStatus(preorderId, 'PREPARING');
  before = await ownerMessages();
  batch = await call('/api/admin/fulfillments/notify-batch', adminToken, { template: 'TOMORROW' });
  assert.equal(batch.response.status, 201); assert.equal(await ownerMessages() - before, 1, 'pedido misto recebe um único aviso');
  assert.ok(batch.body.skipped >= 1);
  before = await ownerMessages();
  batch = await call('/api/admin/fulfillments/notify-batch', adminToken, { template: 'TOMORROW', type: 'PREORDER' });
  assert.equal(await ownerMessages() - before, 1);
});

test('Autorização: cliente não usa rotas admin nem responde aviso de outro cliente', async () => {
  assert.ok([401, 403].includes((await call('/api/admin/fulfillments', customerToken)).response.status));
  assert.ok([401, 403].includes((await call('/api/admin/fulfillments/notify-batch', customerToken, { template: 'TOMORROW' })).response.status));
  assert.ok([401, 403].includes((await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, customerToken, { message: 'x' })).response.status));
  const hash = await bcrypt.hash('TesteSeguro123!', 10);
  await pool.query(`INSERT INTO users (name,email,phone,password_hash,role,status,session_version) VALUES ('Outro 2B','other.2b@test.local','11966665555',$1,'CUSTOMER','ACTIVE',1) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,status='ACTIVE'`, [hash]);
  const other = await call('/api/auth/login', '', { email: 'other.2b@test.local', password: 'TesteSeguro123!' }); assert.ok(other.body.token);
  const created = await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Atraso authz', waitDays: 2 }); assert.equal(created.response.status, 201);
  const stolen = await call(`/api/delay-notices/${created.body.notice.id}/respond`, other.body.token, { choice: 'REFUND' }); assert.equal(stolen.response.status, 400);
  const state = await pool.query('SELECT status FROM delay_notices WHERE id=$1', [created.body.notice.id]); assert.equal(state.rows[0].status, 'PENDING');
  const refunds = await pool.query('SELECT count(*)::int AS count FROM refunds WHERE fulfillment_id=$1', [preorderId]); assert.equal(refunds.rows[0].count, 0);
  const own = await call(`/api/delay-notices/${created.body.notice.id}/respond`, customerToken, { choice: 'WAIT' }); assert.equal(own.response.status, 200);
});

test('B7: atraso, WAIT/EXCHANGE/REFUND, travas e resposta idempotente', async () => {
  await setStatus(preorderId, 'PREPARING');
  // WAIT estende a data prometida
  const waitNotice = await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Atraso de teste', waitDays: 3 }); assert.equal(waitNotice.response.status, 201);
  const duplicatePending = await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Repetido' }); assert.equal(duplicatePending.response.status, 409);
  const adminList = await call('/api/admin/delay-notices', adminToken); assert.equal(adminList.body.notices[0].orderNumber, orderNumber); assert.equal(adminList.body.notices[0].customerName, 'Cliente 2B');
  const waitResponse = await call(`/api/delay-notices/${waitNotice.body.notice.id}/respond`, customerToken, { choice: 'WAIT' }); assert.equal(waitResponse.response.status, 200);
  const eta = await pool.query('SELECT eta_end FROM order_fulfillments WHERE id=$1', [preorderId]); assert.ok(new Date(eta.rows[0].eta_end).getTime() > Date.now() + 2 * 86_400_000);
  // EXCHANGE abre suporte
  const exchangeNotice = await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Atraso 2', waitDays: 2 }); assert.equal(exchangeNotice.response.status, 201);
  const exchange = await call(`/api/delay-notices/${exchangeNotice.body.notice.id}/respond`, customerToken, { choice: 'EXCHANGE' }); assert.equal(exchange.response.status, 200); assert.ok(exchange.body.ticketId);
  // aviso em encomenda já finalizada é recusado
  await setStatus(preorderId, 'DELIVERED');
  assert.equal((await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Tarde demais' })).response.status, 409);
  assert.equal((await call(`/api/admin/fulfillments/${deliveryId}/delay-notice`, adminToken, { message: 'Delivery não atrasa' })).response.status, 400);
  await setStatus(preorderId, 'PREPARING');
  // REFUND concorrente: uma única linha, valor da parte encomenda
  const refundNotice = await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Atraso 3', waitDays: 2 }); assert.equal(refundNotice.response.status, 201);
  const responses = await Promise.all([call(`/api/delay-notices/${refundNotice.body.notice.id}/respond`, customerToken, { choice: 'REFUND' }), call(`/api/delay-notices/${refundNotice.body.notice.id}/respond`, customerToken, { choice: 'REFUND' })]);
  assert.equal(responses.every((r) => r.response.status === 200), true);
  const refunds = await pool.query("SELECT amount::text AS amount, scope, status, due_at FROM refunds WHERE fulfillment_id=$1 AND requested_by='DELAY_NOTICE'", [preorderId]);
  assert.equal(refunds.rows.length, 1); const dueIn = new Date(refunds.rows[0].due_at).getTime() - Date.now(); assert.ok(dueIn > 23 * 3_600_000 && dueIn <= 24 * 3_600_000, 'prazo de análise de 24h'); assert.equal(refunds.rows[0].amount, '10.00'); assert.equal(refunds.rows[0].scope, 'PREORDER_PART'); assert.equal(refunds.rows[0].status, 'REQUESTED');
  // depois de um reembolso solicitado, novo aviso é bloqueado (sem reembolso duplicado)
  assert.equal((await call(`/api/admin/fulfillments/${preorderId}/delay-notice`, adminToken, { message: 'Depois do reembolso' })).response.status, 409);
});
