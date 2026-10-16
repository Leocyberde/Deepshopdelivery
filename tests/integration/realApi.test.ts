import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://deepshop_test:deepshop_test_local@127.0.0.1:5432/deepshop_test';
const port = Number(process.env.INTEGRATION_PORT || 3211);
const baseUrl = `http://127.0.0.1:${port}`;
let server: ChildProcess | null = null;
let pool: Pool;
let token = '';

async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

before(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  const passwordHash = await bcrypt.hash('TesteSeguro123!', 10);
  server = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_URL: databaseUrl, JWT_SECRET: 'integration-secret-with-more-than-32-characters', SEED_INITIAL_CATALOG: 'false', DISABLE_HMR: 'true', SITE_URL: 'http://127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) break; } catch {}
    await delay(250);
  }
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200, 'servidor de integração não iniciou');
  // O schema é criado pelo servidor na inicialização; só semear depois de ele estar no ar.
  await pool.query(`INSERT INTO users (name, email, phone, password_hash, role, status, session_version)
    VALUES ('Admin Integração', 'admin.integration@test.local', '11999999999', $1, 'SUPER_ADMIN', 'ACTIVE', 1)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'SUPER_ADMIN', status = 'ACTIVE'`, [passwordHash]);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin.integration@test.local', password: 'TesteSeguro123!' }) });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  token = login.body.token;
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await delay(1_000);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await delay(300);
  await pool.end();
});

test('B3/B4 API real: fornecedor, produto preorder, compras, totais e bloqueio de histórico', async () => {
  await pool.query("DELETE FROM supplier_purchases WHERE supplier_id IN (SELECT id FROM suppliers WHERE name = 'Fornecedor Integração')");
  await pool.query("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE code IN ('T201', 'T202'))");
  await pool.query("DELETE FROM products WHERE code IN ('T201', 'T202')");
  await pool.query("DELETE FROM suppliers WHERE name = 'Fornecedor Integração'");
  const category = await pool.query("SELECT id FROM categories ORDER BY id LIMIT 1");
  assert.ok(category.rows[0]?.id, 'migration não criou categoria base');
  const supplierResponse = await request('/api/admin/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Fornecedor Integração', website: 'https://supplier.test/item' }) });
  assert.equal(supplierResponse.response.status, 201, JSON.stringify(supplierResponse.body));
  const supplierId = supplierResponse.body.supplier.id;
  const productResponse = await request('/api/admin/products', { method: 'POST', body: JSON.stringify({ categoryId: category.rows[0].id, code: 'T201', name: 'Produto Encomenda Integração', price: '20.00', cost: '8.00', stock: 0, supplierId, supplierProductUrl: 'https://supplier.test/item', fulfillmentType: 'PREORDER', allowPreorder: true }) });
  assert.equal(productResponse.response.status, 201, JSON.stringify(productResponse.body));
  assert.equal(productResponse.body.status, 'ACTIVE');
  const productId = productResponse.body.id;
  const productList = await request('/api/admin/products?status=ACTIVE&search=T201');
  assert.equal(productList.response.status, 200);
  assert.equal(productList.body.products[0].status, 'ACTIVE');
  const purchaseResponse = await request('/api/admin/purchases', { method: 'POST', body: JSON.stringify({ supplierId, productId, itemName: 'Compra manual', unitCost: '3.25', quantity: 4, purchasedAt: '2026-10-15', productUrl: 'https://supplier.test/item' }) });
  assert.equal(purchaseResponse.response.status, 201, JSON.stringify(purchaseResponse.body));
  const purchases = await request(`/api/admin/suppliers/${supplierId}/purchases?from=2026-10-01&to=2026-10-31`);
  assert.equal(purchases.response.status, 200);
  assert.equal(purchases.body.totals.quantity, 4);
  assert.equal(purchases.body.totals.totalCost, '13.00');
  const stockedProduct = await request('/api/admin/products', { method: 'POST', body: JSON.stringify({ categoryId: category.rows[0].id, code: 'T202', name: 'Produto com Entrada Automática', price: '30.00', cost: '4.00', stock: 2, supplierId, supplierProductUrl: 'https://supplier.test/stock', fulfillmentType: 'DELIVERY', allowPreorder: true }) });
  assert.equal(stockedProduct.response.status, 201, JSON.stringify(stockedProduct.body));
  const movementBody = { productId: stockedProduct.body.id, direction: 'IN', quantity: 1, reason: 'Reposição idempotente', idempotencyKey: '11111111-1111-4111-8111-111111111111' };
  assert.equal((await request('/api/admin/inventory/movements', { method: 'POST', body: JSON.stringify(movementBody) })).response.status, 201);
  assert.equal((await request('/api/admin/inventory/movements', { method: 'POST', body: JSON.stringify(movementBody) })).response.status, 200);
  const purchasesAfterAutomatic = await request(`/api/admin/suppliers/${supplierId}/purchases`);
  assert.equal(purchasesAfterAutomatic.body.totals.quantity, 7);
  const stockUpdate = await request(`/api/admin/products/${productId}`, { method: 'PUT', body: JSON.stringify({ categoryId: category.rows[0].id, code: 'T201', name: 'Produto Encomenda Integração', price: '20.00', cost: '8.00', costUnitPrecise: '8.000000', stock: 0, expectedStock: 0, stockMinimum: 5, supplierId, supplierProductUrl: 'https://supplier.test/item', fulfillmentType: 'PREORDER', allowPreorder: true, status: 'ACTIVE', mediaItems: [] }) });
  assert.equal(stockUpdate.response.status, 200, JSON.stringify(stockUpdate.body));
  assert.equal(stockUpdate.body.status, 'ACTIVE');
  const blockedDelete = await request(`/api/admin/suppliers/${supplierId}`, { method: 'DELETE' });
  assert.equal(blockedDelete.response.status, 409);
});
