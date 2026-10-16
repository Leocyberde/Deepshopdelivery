import { Express } from 'express';
import { and, asc, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { audit } from './adminPhase3Routes.ts';

function validHttpUrl(value: unknown): string | null {
  if (value == null || value === '') return null;
  try { const url = new URL(String(value)); return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${field} deve ser um inteiro positivo.`);
  return parsed;
}

function money(value: unknown, field: string, allowZero = true): number {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0) || parsed > 99_999_999_999.99) throw new Error(`${field} inválido.`);
  return parsed;
}

function purchaseDate(value: unknown, fallback = new Date()): Date {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('Data da compra inválida.');
  return parsed;
}

export function summarizeSupplierPurchases(purchases: Array<{ quantity: number; totalCost: string | number | null }>) {
  const totalCostCents = purchases.reduce((sum, purchase) => {
    const cents = Math.round(Number(String(purchase.totalCost ?? 0).replace(',', '.')) * 100);
    return Number.isFinite(cents) ? sum + cents : sum;
  }, 0);
  return { quantity: purchases.reduce((sum, purchase) => sum + Number(purchase.quantity || 0), 0), totalCost: (totalCostCents / 100).toFixed(2) };
}

function dateFilter(value: unknown, end = false): Date | null {
  if (value === undefined || value === '') return null;
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T${end ? '23:59:59.999' : '00:00:00.000'}-03:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('Período de compras inválido.');
  return parsed;
}

async function selectPurchases(query: any, supplierId?: number) {
  const filters: any[] = [];
  if (supplierId !== undefined) filters.push(eq(schema.supplierPurchases.supplierId, supplierId));
  if (query.search) {
    const pattern = `%${String(query.search).trim().slice(0, 120).replace(/[\\%_]/g, '\\$&')}%`;
    filters.push(or(ilike(schema.supplierPurchases.itemName, pattern), ilike(schema.supplierPurchases.productUrl, pattern), ilike(schema.supplierPurchases.notes, pattern)));
  }
  const from = dateFilter(query.from);
  const to = dateFilter(query.to, true);
  if (from && to && from > to) throw new Error('Período de compras inválido.');
  if (from) filters.push(gte(schema.supplierPurchases.purchasedAt, from));
  if (to) filters.push(lte(schema.supplierPurchases.purchasedAt, to));
  return db.select().from(schema.supplierPurchases).where(filters.length ? and(...filters) : undefined).orderBy(desc(schema.supplierPurchases.purchasedAt), desc(schema.supplierPurchases.id));
}

function purchaseInput(body: any, existing?: any) {
  const supplierId = body?.supplierId === undefined ? existing?.supplierId : positiveInteger(body.supplierId, 'Fornecedor');
  if (!Number.isSafeInteger(Number(supplierId)) || Number(supplierId) <= 0) throw new Error('Fornecedor inválido.');
  const itemName = body?.itemName === undefined ? existing?.itemName : String(body.itemName).trim();
  if (!itemName || itemName.length > 200) throw new Error('Informe um item de compra válido.');
  const quantity = body?.quantity === undefined ? existing?.quantity : positiveInteger(body.quantity, 'Quantidade');
  if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) throw new Error('Quantidade deve ser um inteiro positivo.');
  const unitCost = body?.unitCost === undefined ? money(existing?.unitCost, 'Custo unitário') : money(body.unitCost, 'Custo unitário');
  const calculatedTotal = Number((unitCost * Number(quantity)).toFixed(2));
  const totalCost = body?.totalCost === undefined ? calculatedTotal : money(body.totalCost, 'Custo total');
  if (Math.abs(totalCost - calculatedTotal) > 0.01) throw new Error('Custo total não corresponde ao custo unitário e à quantidade.');
  const productUrl = body?.productUrl === undefined ? (existing?.productUrl ?? null) : validHttpUrl(body.productUrl);
  if (body?.productUrl && !productUrl) throw new Error('A URL do produto deve usar http ou https.');
  const productId = body?.productId === undefined ? (existing?.productId ?? null) : body.productId === null || body.productId === '' ? null : positiveInteger(body.productId, 'Produto');
  return {
    supplierId: Number(supplierId), productId: productId === null ? null : Number(productId), itemName,
    unitCost: unitCost.toFixed(6), quantity: Number(quantity), totalCost: totalCost.toFixed(2),
    purchasedAt: purchaseDate(body?.purchasedAt, existing?.purchasedAt ? new Date(existing.purchasedAt) : new Date()),
    productUrl, notes: body?.notes === undefined ? (existing?.notes ?? null) : String(body.notes).trim() || null,
  };
}

export function registerFulfillmentRoutes(app: Express) {
  app.get('/api/admin/suppliers', requireAuth, requireAdmin, async (_req, res) => {
    const suppliers = await db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.name));
    res.json({ suppliers });
  });

  app.post('/api/admin/suppliers', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 160) { res.status(400).json({ error: 'Informe um nome de fornecedor válido.' }); return; }
    const website = validHttpUrl(req.body?.website);
    if (req.body?.website && !website) { res.status(400).json({ error: 'O site deve usar http ou https.' }); return; }
    const [supplier] = await db.insert(schema.suppliers).values({ name, contact: String(req.body?.contact || '').trim() || null, website, notes: String(req.body?.notes || '').trim() || null }).returning();
    await audit(req, 'SUPPLIER_CREATE', 'SUPPLIER', supplier.id, { name: supplier.name });
    res.status(201).json({ supplier });
  });

  app.patch('/api/admin/suppliers/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const website = validHttpUrl(req.body?.website);
    if (req.body?.website && !website) { res.status(400).json({ error: 'O site deve usar http ou https.' }); return; }
    const [existing] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    if (!existing) { res.status(404).json({ error: 'Fornecedor não encontrado.' }); return; }
    const patch: any = { updatedAt: new Date() };
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 160) { res.status(400).json({ error: 'Informe um nome de fornecedor válido.' }); return; }
      patch.name = name;
    }
    if (req.body?.contact !== undefined) patch.contact = String(req.body.contact).trim() || null;
    if (req.body?.website !== undefined) patch.website = website;
    if (req.body?.notes !== undefined) patch.notes = String(req.body.notes).trim() || null;
    if (req.body?.status !== undefined) patch.status = req.body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const [supplier] = await db.update(schema.suppliers).set(patch).where(eq(schema.suppliers.id, id)).returning();
    await audit(req, 'SUPPLIER_UPDATE', 'SUPPLIER', id, { status: supplier.status });
    res.json({ supplier });
  });

  app.delete('/api/admin/suppliers/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'Fornecedor inválido.' }); return; }
    const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    if (!supplier) { res.status(404).json({ error: 'Fornecedor não encontrado.' }); return; }
    const history = await db.select({ id: schema.supplierPurchases.id }).from(schema.supplierPurchases).where(eq(schema.supplierPurchases.supplierId, id)).limit(1);
    if (history.length) {
      res.status(409).json({ error: 'Fornecedor com histórico não pode ser excluído fisicamente. Inative-o para preservar o histórico.', code: 'SUPPLIER_HAS_HISTORY' });
      return;
    }
    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, id));
    await audit(req, 'SUPPLIER_DELETE', 'SUPPLIER', id, { name: supplier.name });
    res.status(204).send();
  });

  app.get('/api/admin/suppliers/:id/purchases', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'Fornecedor inválido.' }); return; }
    try {
      const purchases = await selectPurchases(req.query, id);
      res.json({ purchases, totals: summarizeSupplierPurchases(purchases) });
    } catch (error: any) { res.status(400).json({ error: error?.message || 'Não foi possível carregar as compras.' }); }
  });

  app.get(['/api/admin/purchases', '/api/admin/supplier-purchases'], requireAuth, requireAdmin, async (req, res) => {
    try {
      const supplierId = req.query.supplierId === undefined ? undefined : positiveInteger(req.query.supplierId, 'Fornecedor');
      const purchases = await selectPurchases(req.query, supplierId);
      const grouped = new Map<number, Array<{ quantity: number; totalCost: string | number | null }>>();
      for (const purchase of purchases) grouped.set(purchase.supplierId, [...(grouped.get(purchase.supplierId) || []), purchase]);
      res.json({
        purchases,
        totals: summarizeSupplierPurchases(purchases),
        totalsBySupplier: [...grouped.entries()].map(([id, rows]) => ({ supplierId: id, ...summarizeSupplierPurchases(rows) })),
      });
    } catch (error: any) { res.status(400).json({ error: error?.message || 'Não foi possível carregar as compras.' }); }
  });

  app.post(['/api/admin/purchases', '/api/admin/supplier-purchases'], requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const input = purchaseInput(req.body);
      const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, input.supplierId));
      if (!supplier) { res.status(404).json({ error: 'Fornecedor não encontrado.' }); return; }
      if (supplier.status !== 'ACTIVE') { res.status(409).json({ error: 'Só é possível cadastrar compras para fornecedor ativo.' }); return; }
      if (input.productId !== null) {
        const [product] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.id, input.productId));
        if (!product) { res.status(404).json({ error: 'Produto não encontrado.' }); return; }
      }
      const [purchase] = await db.insert(schema.supplierPurchases).values({ ...input, createdBy: req.user!.id }).returning();
      await audit(req, 'SUPPLIER_PURCHASE_CREATE', 'SUPPLIER_PURCHASE', purchase.id, { supplierId: purchase.supplierId, productId: purchase.productId, quantity: purchase.quantity, totalCost: purchase.totalCost });
      res.status(201).json({ purchase });
    } catch (error: any) { res.status(400).json({ error: error?.message || 'Não foi possível cadastrar a compra.' }); }
  });

  app.patch(['/api/admin/purchases/:id', '/api/admin/supplier-purchases/:id'], requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = positiveInteger(req.params.id, 'Compra');
      const [existing] = await db.select().from(schema.supplierPurchases).where(eq(schema.supplierPurchases.id, id));
      if (!existing) { res.status(404).json({ error: 'Compra não encontrada.' }); return; }
      const input = purchaseInput(req.body, existing);
      const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, input.supplierId));
      if (!supplier) { res.status(404).json({ error: 'Fornecedor não encontrado.' }); return; }
      if (input.productId !== null) {
        const [product] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.id, input.productId));
        if (!product) { res.status(404).json({ error: 'Produto não encontrado.' }); return; }
      }
      const [purchase] = await db.update(schema.supplierPurchases).set(input).where(eq(schema.supplierPurchases.id, id)).returning();
      await audit(req, 'SUPPLIER_PURCHASE_UPDATE', 'SUPPLIER_PURCHASE', id, { supplierId: purchase.supplierId, quantity: purchase.quantity, totalCost: purchase.totalCost });
      res.json({ purchase });
    } catch (error: any) { res.status(400).json({ error: error?.message || 'Não foi possível editar a compra.' }); }
  });

  app.delete(['/api/admin/purchases/:id', '/api/admin/supplier-purchases/:id'], requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = positiveInteger(req.params.id, 'Compra');
      const [purchase] = await db.delete(schema.supplierPurchases).where(eq(schema.supplierPurchases.id, id)).returning();
      if (!purchase) { res.status(404).json({ error: 'Compra não encontrada.' }); return; }
      await audit(req, 'SUPPLIER_PURCHASE_DELETE', 'SUPPLIER_PURCHASE', id, { supplierId: purchase.supplierId, quantity: purchase.quantity, totalCost: purchase.totalCost });
      res.status(204).send();
    } catch (error: any) { res.status(400).json({ error: error?.message || 'Não foi possível excluir a compra.' }); }
  });
}
