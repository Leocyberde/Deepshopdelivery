import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { readFile } from 'node:fs/promises';

const url = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://deepshop_test:deepshop_test_local@127.0.0.1:5432/deepshop_test';
if (new URL(url).pathname !== '/deepshop_test') throw new Error('Automatic freight integration requires the disposable deepshop_test database.');
const pool = new Pool({ connectionString: url });
const port = 3223, baseUrl = `http://127.0.0.1:${port}`;
const secret = 'automatic-freight-integration-secret-32-characters';
let app: ChildProcess | null = null, fake: http.Server;
let adminId: number, userId: number, secondId: number, productId: number;
let adminToken: string, userToken: string, secondToken: string;
let calls = 0, meters = 3100, mode = 'ok', output = '';
const fakeKey = 'fake-google-test-key-not-real';
const origin = 'Rua da Loja, 100, Centro, Itatiba/SP, 13250000';
let requestBodies: any[] = [];
function sign(id: number) { return jwt.sign({ id, sessionVersion: 1 }, secret); }
async function api(path: string, body?: any, token = userToken, method = body === undefined ? 'GET' : 'POST', extraHeaders: Record<string,string> = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', Origin: baseUrl, ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); return { status: response.status, data };
}
const address = (number = '1', extra: any = {}) => ({ label:'Casa', zipCode:'13250-000', street:'Rua Cliente', number, neighborhood:'Centro', city:'Itatiba', state:'SP', ...extra });
async function create(number = '1', extra: any = {}, token = userToken) { return api('/api/addresses', address(number, extra), token); }
async function setSetting(key: string, value: string) { await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key,value]); }
async function order(addrId: number, quantity = 1, extra: any = {}, token = userToken) {
  return api('/api/orders', { addressId:addrId, items:[{ productId,quantity }], paymentMethod:'MERCADOPAGO', deliveryMode:'FAST', deliveryMinutes:60, ...extra }, token);
}
async function seedLegacy(number: string, city = 'Itatiba', status = 'NEW', distance: string | null = null, stockDeducted = false) {
  const store = (await pool.query('SELECT id FROM stores ORDER BY id LIMIT 1')).rows[0].id;
  const r = await pool.query(`INSERT INTO orders(order_number,user_id,store_id,subtotal,delivery_fee,total,status,address_snapshot,delivery_distance_km,stock_deducted) VALUES($1,$2,$3,'60',null,'60',$4,$5,$6,$7) RETURNING *`, [`AF-${Date.now()}-${number}`,userId,store,status,JSON.stringify(address(number,{city})),distance,stockDeducted]);
  await pool.query("INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,subtotal,fulfillment_type) VALUES($1,$2,'Produto teste',2,'30','60','DELIVERY')", [r.rows[0].id,productId]);
  await pool.query("INSERT INTO order_fulfillments(order_id,type,status) VALUES($1,'DELIVERY','PENDING')",[r.rows[0].id]);
  return r.rows[0];
}
before(async () => {
  fake = http.createServer(async (req,res) => {
    calls++;
    let raw=''; for await (const chunk of req) raw += chunk;
    let parsed: any = null; try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    requestBodies.push({ path:req.url?.split('?')[0], body:parsed, headers:{ mask:req.headers['x-goog-fieldmask'], keyPresent:req.headers['x-goog-api-key'] === fakeKey } });
    await delay(mode === 'timeout' ? 8500 : 80);
    if (mode === 'forbidden') { res.writeHead(403); res.end('denied'); return; }
    if (mode === 'rate') { res.writeHead(429); res.end('quota'); return; }
    res.setHeader('Content-Type','application/json');
    if (mode === 'invalid') { res.end('{bad'); return; }
    if (req.url?.startsWith('/matrix')) { res.end(JSON.stringify({ status:'OK',rows:[{elements:[mode === 'zero' ? {status:'ZERO_RESULTS'} : {status:'OK',distance:{value:meters},duration:{value:120}}]}] })); return; }
    res.end(JSON.stringify({routes:mode === 'zero' ? [] : [{distanceMeters:meters,duration:'120s'}]}));
  });
  await new Promise<void>((resolve) => fake.listen(0,'127.0.0.1',resolve));
  const fakePort = (fake.address() as any).port;
  app = spawn(process.execPath,['./node_modules/tsx/dist/cli.mjs','server.ts'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'development',PORT:String(port),DATABASE_URL:url,JWT_SECRET:secret,SEED_INITIAL_CATALOG:'false',DISABLE_HMR:'true',SITE_URL:baseUrl,GOOGLE_MAPS_API_KEY:fakeKey,GOOGLE_DISTANCE_PROVIDER:'routes',GOOGLE_ROUTES_BASE_URL:`http://127.0.0.1:${fakePort}/routes`,GOOGLE_DISTANCE_MATRIX_BASE_URL:`http://127.0.0.1:${fakePort}/matrix`,CALLMEBOT_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  app.stdout?.on('data',(chunk)=>{output+=chunk.toString();}); app.stderr?.on('data',(chunk)=>{output+=chunk.toString();});
  let healthy=false; for (let i=0;i<120;i++){try { if ((await fetch(baseUrl+'/health')).ok) {healthy=true;break;} } catch {} await delay(250);}
  assert.ok(healthy,output.slice(-3000));
  const hash=await bcrypt.hash('FakeTest123!',8);
  for (const [name,role] of [['admin','SUPER_ADMIN'],['customer','CUSTOMER'],['second','CUSTOMER']] as const) {
    const result=await pool.query(`INSERT INTO users(name,email,phone,password_hash,role,status,session_version,must_change_password) VALUES($1,$2,'11911111111',$3,$4,'ACTIVE',1,false) ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,session_version=1,must_change_password=false,status='ACTIVE' RETURNING id`,[name,`${name}.auto-freight@test.local`,hash,role]);
    if (name==='admin') {adminId=result.rows[0].id;adminToken=sign(adminId);} else if(name==='customer'){userId=result.rows[0].id;userToken=sign(userId);}else{secondId=result.rows[0].id;secondToken=sign(secondId);}
  }
  const cat=(await pool.query('SELECT id,store_id FROM categories ORDER BY id LIMIT 1')).rows[0];
  const prod=await pool.query(`INSERT INTO products(store_id,category_id,code,name,price,cost,stock,allow_preorder,status) VALUES($1,$2,'AFTEST','Produto Frete Teste','30','10',500,true,'ACTIVE') ON CONFLICT DO NOTHING RETURNING id`,[cat.store_id,cat.id]);
  productId=prod.rows[0]?.id || (await pool.query("SELECT id FROM products WHERE code='AFTEST' ORDER BY id LIMIT 1")).rows[0].id;
  // Repeatable cleanup restricted to synthetic users/orders.
  const ids=(await pool.query('SELECT id FROM orders WHERE user_id=ANY($1::int[])',[ [userId,secondId] ])).rows.map(r=>r.id);
  if(ids.length){for(const table of ['payments','order_status_history','notifications','order_items','order_fulfillments'])await pool.query(`DELETE FROM ${table} WHERE order_id=ANY($1::int[])`,[ids]); await pool.query('DELETE FROM orders WHERE id=ANY($1::int[])',[ids]);}
  await pool.query('DELETE FROM addresses WHERE user_id=ANY($1::int[])',[[userId,secondId]]);
  const ddl=await readFile('drizzle/0003_automatic_freight.sql','utf8'); await pool.query(ddl); await pool.query(ddl);
});
beforeEach(async () => {
  calls=0;mode='ok';meters=3100;requestBodies=[];
  await pool.query('DELETE FROM geo_distance_cache; DELETE FROM geo_lookup_log; DELETE FROM geo_api_usage; DELETE FROM admin_event_keys WHERE event_key LIKE \'geo:%\';');
  await pool.query("DELETE FROM admin_notifications WHERE type='GEO_QUOTA'");
  await setSetting('store_origin_address',origin);
  await setSetting('geo_monthly_limit','35000');await setSetting('geo_warn_at','25000');await setSetting('freight_max_km','20');
  await setSetting('freight_free_band1_enabled','false');await setSetting('freight_free_band2_enabled','false');await setSetting('freight_free_band2_min_value','90');
  await setSetting('payment_deadline_hours','24');await setSetting('store_status','OPEN');await setSetting('accept_orders_when_closed','true');
  await pool.query('UPDATE users SET free_delivery_until=null WHERE id=ANY($1::int[])',[[userId,secondId]]);
  await pool.query("UPDATE products SET price='30',promo_active=false,promo_price=null,promo_max_units=null,stock=500,allow_preorder=true WHERE id=$1",[productId]);
});
after(async () => {
  if(app && app.exitCode===null){app.kill('SIGTERM');await delay(500);if(app.exitCode===null)app.kill('SIGKILL');}
  fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()));await pool.end();
});

test('F01 cadastro automático, cache CEP+número entre clientes e variações de rua, campos manipulados ignorados',async()=>{
  const a=await create('101',{deliveryFee:0,deliveryDistanceKm:0,distanceKm:0,freight:0,latitude:0,longitude:0});assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(a.data.deliveryDistanceKm,'3.10');assert.equal(a.data.deliveryFeeSource,'GOOGLE');assert.equal(a.data.deliveryFee,'7.50');
  const b=await create('101',{street:'R. Cliente',zipCode:'13250000'},secondToken);assert.equal(b.status,201);assert.equal(b.data.deliveryFeeSource,'GOOGLE_CACHE');assert.equal(calls,1);
  assert.equal((await pool.query('SELECT hit_count FROM geo_distance_cache')).rows[0].hit_count,1);
  assert.equal(requestBodies[0].body.travelMode,'DRIVE');assert.equal(requestBodies[0].body.regionCode,'BR');assert.equal(requestBodies[0].headers.mask,'routes.distanceMeters,routes.duration');assert.ok(requestBodies[0].headers.keyPresent);
  assert.ok(!JSON.stringify(a.data).includes(fakeKey));
});
test('F02 edição de complemento/bairro/apelido/rua não consulta; mudar número/CEP consulta',async()=>{
  const a=await create('201');assert.equal(calls,1);
  let edit=await api(`/api/addresses/${a.data.id}`,address('201',{label:'Trabalho',street:'R. Cliente',neighborhood:'Bairro novo',complement:'Apto 1'}),userToken,'PUT');assert.equal(edit.status,200);assert.equal(calls,1);
  edit=await api(`/api/addresses/${a.data.id}`,address('202'),userToken,'PUT');assert.equal(edit.status,200);assert.equal(calls,2);
  edit=await api(`/api/addresses/${a.data.id}`,address('202',{zipCode:'13250-100'}),userToken,'PUT');assert.equal(edit.status,200);assert.equal(calls,3);
});
test('F03 trocar origem invalida distância salva, quote/pedido/listagem não consultam Google; retry recalcula',async()=>{
  const a=await create('301');await setSetting('store_origin_address','Rua Nova Loja, 200, Centro, Itatiba/SP, 13250000');
  const q=await api('/api/cart/quote',{addressId:a.data.id,items:[{productId,quantity:1}]});assert.equal(q.data.freight.status,'DISTANCE_UNAVAILABLE');
  const o=await order(a.data.id);assert.equal(o.status,409);assert.equal(o.data.code,'DISTANCE_UNAVAILABLE');await api('/api/addresses');assert.equal(calls,1);
  assert.equal((await api(`/api/addresses/${a.data.id}/recalculate`,{})).status,200);assert.equal(calls,2);
});
test('F04 consistência quote/pedido, preço promocional e todos itens/preorder contam mínimos; valores do front ignorados',async()=>{
  await setSetting('freight_free_band2_enabled','true');await pool.query("UPDATE products SET promo_active=true,promo_price='20',promo_max_units=2 WHERE id=$1",[productId]);
  const a=await create('401');
  const items=[{productId,quantity:4,receiveAllAsPreorder:true}];
  const q=await api('/api/cart/quote',{addressId:a.data.id,items});assert.equal(q.status,200);assert.equal(q.data.totals.subtotal,100);assert.equal(q.data.freight.source,'FREE_BAND_2');
  const o=await order(a.data.id,4,{items,quoteToken:q.data.quoteToken,deliveryFee:999,deliveryDistanceKm:999,distanceKm:999,freight:999});assert.equal(o.status,201,JSON.stringify(o.data));assert.equal(o.data.subtotal,'100.00');assert.equal(o.data.deliveryFee,'0.00');assert.equal(o.data.deliveryDistanceKm,'3.10');assert.equal(o.data.deliveryFeeSource,q.data.freight.source);assert.equal(Number(o.data.total),q.data.totals.total);assert.ok(o.data.paymentExpiresAt);assert.ok(o.data.items.every((item:any)=>item.fulfillmentType==='PREORDER'));assert.equal(calls,1);
  await setSetting('freight_free_band2_enabled','false');
  const q2=await api('/api/cart/quote',{addressId:a.data.id,items});const o2=await order(a.data.id,4,{items,quoteToken:q2.data.quoteToken});assert.equal(o2.data.deliveryFee,'7.50');assert.equal(Number(o2.data.total),q2.data.totals.total);
  const q3=await api('/api/cart/quote',{addressId:a.data.id,items});await setSetting('freight_base_fee','8');assert.equal((await order(a.data.id,4,{items,quoteToken:q3.data.quoteToken})).data.code,'QUOTE_CHANGED');await setSetting('freight_base_fee','7.50');
});
test('F05 Itatiba apenas, fora da área salvo com distância; >20 bloqueia mesmo com benefício; 15-20 normal',async()=>{
  const before=calls;assert.equal((await create('501',{city:'Jundiaí'})).status,422);assert.equal(calls,before);
  const signup=await api('/api/auth/register',{name:'Fora',email:`outside-${Date.now()}@test.local`,phone:'11911111111',password:'FakeTest123!',lgpdAccepted:true,address:address('1',{city:'Jundiaí'})},'');assert.equal(signup.status,422,JSON.stringify(signup.data));assert.equal(calls,before);
  meters=20010;const a=await create('502');assert.equal(a.status,422);assert.equal(a.data.error,'Não entregamos nessa região. Entre em contato através do WhatsApp: 11910509385');assert.equal(a.data.deliveryDistanceKm,'20.01');assert.equal(a.data.deliveryInArea,false);assert.ok((await pool.query('SELECT id FROM addresses WHERE id=$1',[a.data.id])).rowCount);
  await pool.query("UPDATE users SET free_delivery_until=NOW()+INTERVAL '1 day' WHERE id=$1",[userId]);const o=await order(a.data.id);assert.equal(o.status,422);assert.equal(o.data.code,'OUT_OF_DELIVERY_AREA');
  meters=20000;const b=await create('503');assert.equal(b.status,201);await pool.query('UPDATE users SET free_delivery_until=null WHERE id=$1',[userId]);assert.equal((await order(b.data.id)).data.deliveryFee,'31.50');
});
test('F06 limite de 15 cache misses por 24h; 16º salva endereço sem distância e retorna 429',async()=>{
  for(let i=0;i<15;i++){const a=await create(String(600+i));assert.equal(a.status,201);}
  const last=await create('616');assert.equal(last.status,429);assert.equal(last.data.deliveryDistanceKm,null);assert.equal(calls,15);
  const cache=await create('600');assert.equal(cache.status,201);assert.equal(calls,15);
});
test('F07 cota atômica inclusive falhas e avisos únicos por mês no limiar configurado',async()=>{
  await setSetting('geo_monthly_limit','2');await setSetting('geo_warn_at','1');mode='forbidden';await create('701');mode='ok';await create('702');const third=await create('703');assert.equal(third.data.deliveryDistanceKm,null);assert.equal(third.data.code,'MONTHLY_LIMIT');assert.equal(calls,2);await create('704');
  assert.equal((await pool.query('SELECT calls FROM geo_api_usage')).rows[0].calls,2);assert.equal((await pool.query("SELECT count(*)::int AS n FROM admin_event_keys WHERE event_key LIKE 'geo:%'")).rows[0].n,2);assert.equal((await pool.query("SELECT count(*)::int AS n FROM admin_notifications WHERE type='GEO_QUOTA'")).rows[0].n,2);
});
test('F08 single-flight: cinco cadastros simultâneos do mesmo destino usam uma chamada',async()=>{
  const results=await Promise.all(Array.from({length:5},()=>create('801')));assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(calls,1);assert.equal((await pool.query('SELECT hit_count FROM geo_distance_cache')).rows[0].hit_count,4);
});
test('F09 Google 403/429/ZERO_RESULTS/JSON inválido/timeout: sem distância/sem gratuidade; retry funciona',async()=>{
  let last:any;
  for(const [i,state] of ['forbidden','rate','zero','invalid','timeout'].entries()){
    mode=state;const a=await create(String(900+i));assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(a.data.deliveryDistanceKm,null);assert.equal(a.data.code,['PROVIDER_FORBIDDEN','PROVIDER_RATE_LIMIT','ZERO_RESULTS','PROVIDER_ERROR','TIMEOUT'][i]);assert.equal((await order(a.data.id)).data.code,'DISTANCE_UNAVAILABLE');last=a;
  }
  mode='ok';assert.equal((await api(`/api/addresses/${last.data.id}/recalculate`,{})).data.deliveryDistanceKm,'3.10');assert.equal(calls,6);assert.ok(!output.includes(fakeKey));
});
test('F10 permissões, propriedade, configurações validadas/persistentes/auditadas e rotas antigas 410',async()=>{
  assert.equal((await api('/api/admin/geo/status',undefined,userToken)).status,403);
  assert.equal((await api('/api/admin/settings',{freight_max_km:20},userToken,'PUT')).status,403);
  const a=await create('1001');assert.equal((await api(`/api/addresses/${a.data.id}/recalculate`,{},secondToken)).status,404);assert.equal((await api('/api/cart/quote',{addressId:a.data.id,items:[{productId,quantity:1}]},secondToken)).status,404);
  for(const body of [{freight_base_fee:-1},{geo_monthly_limit:'100'},{freight_free_band2_enabled:true,freight_free_band2_min_value:0},{geo_warn_at:0}])assert.equal((await api('/api/admin/settings',body,adminToken,'PUT')).status,400);
  const update=await api('/api/admin/settings',{freight_free_band2_enabled:true,freight_free_band2_min_value:90,geo_warn_at:1000,freight_max_km:25},adminToken,'PUT');assert.equal(update.status,200,JSON.stringify(update.data));assert.equal((await api('/api/admin/settings',undefined,adminToken)).data.freight_max_km,'25');
  assert.equal((await api(`/api/admin/addresses/${a.data.id}/freight`,{distanceKm:0,deliveryFee:0},adminToken,'PUT')).status,410);assert.equal((await api('/api/admin/orders/1/freight',{deliveryFee:0},adminToken,'PUT')).status,410);assert.equal((await api('/api/admin/freight/suggest',{distanceKm:0},adminToken)).status,410);
  assert.equal((await api('/api/admin/settings',{freight_max_km:20},adminToken,'PUT',{Origin:'https://evil.test'})).status,403);
  assert.ok((await pool.query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE action='FREIGHT_SETTINGS_UPDATED'")).rows[0].n>0);
});
test('F11 benefício em lote, data/revogação e auditoria; tickets antigos não concedidos/consumidos/alterados',async()=>{
  await pool.query('UPDATE users SET free_delivery_tickets=3,manual_free_delivery_tickets=2 WHERE id=$1',[userId]);
  const grant=await api('/api/admin/customers/free-delivery-period',{customerIds:[userId,secondId],until:new Date(Date.now()+86400000).toISOString()},adminToken,'PUT');assert.equal(grant.status,200,JSON.stringify(grant.data));assert.equal(grant.data.count,2);
  const a=await create('1101');const o=await order(a.data.id);assert.equal(o.data.deliveryFee,'0.00');assert.equal(o.data.deliveryFeeSource,'MANUAL_FREE_DELIVERY_PERIOD');assert.equal(o.data.usedFreeDeliveryTicket,false);
  const revoke=await api('/api/admin/customers/free-delivery-period',{customerIds:[userId,secondId],revoke:true},adminToken,'PUT');assert.equal(revoke.status,200);assert.equal((await order(a.data.id)).data.deliveryFee,'7.50');
  const tickets=(await pool.query('SELECT free_delivery_tickets,manual_free_delivery_tickets FROM users WHERE id=$1',[userId])).rows[0];assert.deepEqual(tickets,{free_delivery_tickets:3,manual_free_delivery_tickets:2});
  assert.ok((await pool.query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE entity_id=ANY($1::text[]) AND action IN ('FREE_DELIVERY_GRANTED','FREE_DELIVERY_REVOKED')",[[String(userId),String(secondId)]])).rows[0].n>=4);
});
test('F12 dry-run é somente leitura; execução libera Itatiba/cancela cidade e >limite/restaura estoque; pagos intocados; replay idempotente',async()=>{
  const good=await seedLegacy('1201');const city=await seedLegacy('1202','Jundiaí','AWAITING_PAYMENT',null,true);const far=await seedLegacy('1203','Itatiba','NEW','21',true);const paid=await seedLegacy('1204','Jundiaí','PAID');const done=await seedLegacy('1205','Jundiaí','DELIVERED');
  const stock=(await pool.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock;
  const dry=await api('/api/admin/orders/legacy-freight/dry-run',{},adminToken);assert.equal(dry.status,200,JSON.stringify(dry.data));assert.equal(calls,0);assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,stock);assert.equal(dry.data.counts.cancel,2);
  assert.equal((await api('/api/admin/orders/legacy-freight/execute',{},adminToken)).status,400);
  const run=await api('/api/admin/orders/legacy-freight/execute',{dryRunId:dry.data.dryRunId,confirm:true},adminToken);assert.equal(run.status,200,JSON.stringify(run.data));assert.equal(run.data.counts.released,1);assert.equal(run.data.counts.cancelled,2);
  const rows=(await pool.query('SELECT id,status,delivery_fee,payment_expires_at FROM orders WHERE id=ANY($1::int[])',[[good.id,city.id,far.id,paid.id,done.id]])).rows;assert.equal(rows.find(r=>r.id===good.id).delivery_fee,'7.50');assert.ok(rows.find(r=>r.id===good.id).payment_expires_at);assert.equal(rows.find(r=>r.id===city.id).status,'CANCELLED');assert.equal(rows.find(r=>r.id===far.id).status,'CANCELLED');assert.equal(rows.find(r=>r.id===paid.id).delivery_fee,null);assert.equal(rows.find(r=>r.id===paid.id).status,'PAID');assert.equal(rows.find(r=>r.id===done.id).status,'DELIVERED');assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,stock+4);
  assert.equal((await api('/api/admin/orders/legacy-freight/execute',{dryRunId:dry.data.dryRunId,confirm:true},adminToken)).data.idempotentReplay,true);
  assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,stock+4);
  console.log('LEGACY_TEST_COUNTS',JSON.stringify(run.data.counts));console.log('TICKET_CUSTOMERS_TEST_COUNT',(await pool.query('SELECT count(*)::int AS n FROM users WHERE free_delivery_tickets>0 OR manual_free_delivery_tickets>0')).rows[0].n);
});
