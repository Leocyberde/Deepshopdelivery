import { Express } from 'express';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAuth, requireAdmin } from '../middleware/auth.ts';
import { logServerError, logServerEvent } from '../logger.ts';
import {
  calculateDiscountPercent,
  getFreightRuleConfig,
  getPrimaryStoreId,
  getSettingsMap,
  isPromoCurrentlyActive,
  maskCpf,
  parseAndValidateMediaItems,
  resolvePromoMaxUnits,
  resolvePromoTiming,
  validateAndNormalizeCode,
} from '../services/storeHelpers.ts';
import { resolveAddressFreight } from '../../services/freightService.ts';
import { recordInventoryMovement } from '../services/inventoryService.ts';
import { PAYMENT_TIMEOUT_REASON_PREFIX, LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX } from '../services/orderExpirationService.ts';

const notPaymentExpiredOrder = () => sql`COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${PAYMENT_TIMEOUT_REASON_PREFIX + '%'} AND COALESCE(${schema.orders.cancellationReason}, '') NOT LIKE ${LEGACY_PAYMENT_TIMEOUT_REASON_PREFIX + '%'}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STOCK = 1_000_000;

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function cleanSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function escapedLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function uuidKey(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function normMoney(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? fallback).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function productData(body: any, existing?: any) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const categoryId = Number(body?.categoryId);
  const price = normMoney(body?.price);
  const cost = normMoney(body?.cost ?? existing?.cost ?? 0);
  const weight = normMoney(body?.weight ?? existing?.weight ?? 0);
  const promoPrice = body?.promoPrice === undefined || body?.promoPrice === null || String(body.promoPrice).trim() === ''
    ? null
    : normMoney(body.promoPrice);
  const stockMinimum = Number(body?.stockMinimum ?? existing?.stockMinimum ?? 5);
  if (!name || name.length > 120 || (body?.description != null && (typeof body.description !== 'string' || body.description.length > 5000))) {
    throw new Error('Nome ou descrição inválidos.');
  }
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('Categoria inválida.');
  if (!Number.isFinite(price) || price < 0 || price > 99_999_999.99) throw new Error('Preço inválido.');
  if (!Number.isFinite(cost) || cost < 0 || cost > 99_999_999.99) throw new Error('Custo inválido.');
  if (!Number.isFinite(weight) || weight < 0 || weight > 9_999_999.999) throw new Error('Peso inválido.');
  if (promoPrice !== null && (!Number.isFinite(promoPrice) || promoPrice < 0 || promoPrice > 99_999_999.99)) throw new Error('Preço promocional inválido.');
  if (!Number.isSafeInteger(stockMinimum) || stockMinimum < 0 || stockMinimum > MAX_STOCK) throw new Error('Estoque mínimo inválido.');
  const code = body?.code ? validateAndNormalizeCode(body.code) : existing?.code;
  if (!code) throw new Error('Código inválido. Use uma letra seguida de até três números.');
  const promoActive = Boolean(body?.promoActive) && promoPrice !== null && promoPrice > 0;
  const promoTiming = resolvePromoTiming(body || {}, promoActive, existing || null);
  return {
    categoryId,
    code,
    name,
    description: body?.description?.trim() || null,
    price: price.toFixed(2),
    promoPrice: promoActive ? promoPrice!.toFixed(2) : null,
    promoActive,
    promoEndsAt: promoTiming.promoEndsAt,
    promoDurationHours: promoTiming.promoDurationHours,
    promoMaxUnits: resolvePromoMaxUnits(body || {}, promoActive),
    cost: cost.toFixed(2),
    weight: weight.toFixed(3),
    stockMinimum,
  };
}

function summarizeFingerprint(parts: unknown[]): string {
  return JSON.stringify(parts);
}

async function getPriorOperation(tx: any, key: string, fingerprint: string) {
  const [prior] = await tx.select().from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.idempotencyKey, key)).limit(1);
  if (!prior) return null;
  const stored = prior.operationResult as any;
  if (!stored || stored.fingerprint !== fingerprint) return { conflict: true as const };
  return { duplicate: true as const, result: stored.result };
}

async function validateComponents(tx: any, components: any[]) {
  if (!Array.isArray(components) || components.length < 1 || components.length > 100) {
    throw new Error('Selecione de 1 a 100 produtos para compor o kit.');
  }
  const seen = new Set<number>();
  const parsed: Array<{ productId: number; quantityPerKit: number; product: any }> = [];
  for (const item of components) {
    const productId = Number(item?.productId);
    const quantityPerKit = Number(item?.quantityPerKit);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantityPerKit) || quantityPerKit <= 0 || quantityPerKit > 1000) {
      throw new Error('Componente ou quantidade inválida.');
    }
    if (seen.has(productId)) throw new Error('O mesmo componente não pode ser repetido no kit.');
    seen.add(productId);
    const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1);
    if (!product || product.isKit || product.status === 'ARCHIVED') throw new Error('Kit só pode usar produtos comuns não arquivados como componentes.');
    parsed.push({ productId, quantityPerKit, product });
  }
  return parsed;
}

async function changeStock(
  tx: any,
  product: any,
  delta: number,
  details: { movementType: string; reason: string; actorUserId?: number | null; orderId?: number | null; kitProductId?: number | null; idempotencyKey?: string | null; operationResult?: Record<string, unknown> | null }
) {
  const afterStock = product.stock + delta;
  if (!Number.isSafeInteger(afterStock) || afterStock < 0 || afterStock > MAX_STOCK) throw new Error('O movimento deixaria o saldo fora dos limites permitidos.');
  const nextStatus = product.status === 'ARCHIVED' ? 'ARCHIVED' : afterStock <= 0 ? 'INACTIVE' : 'ACTIVE';
  const [updated] = await tx.update(schema.products).set({ stock: afterStock, status: nextStatus, updatedAt: new Date() })
    .where(and(eq(schema.products.id, product.id), eq(schema.products.stock, product.stock))).returning();
  if (!updated) throw new Error('O saldo foi alterado por outra operação. Atualize a tela e tente novamente.');
  await recordInventoryMovement(tx, {
    productId: product.id,
    delta,
    beforeStock: product.stock,
    afterStock,
    movementType: details.movementType,
    reason: details.reason,
    actorUserId: details.actorUserId,
    orderId: details.orderId,
    kitProductId: details.kitProductId,
    idempotencyKey: details.idempotencyKey,
    operationResult: details.operationResult,
  });
  return updated;
}

export function registerAdminPhase2Routes(app: Express) {
  // Produtos: consulta filtrada/paginada; o payload inclui apenas mídia e componentes da página atual.
  app.get('/api/admin/products', requireAuth, requireAdmin, async (req, res) => {
    try {
      const page = boundedInt(req.query.page, 1, 1, 1_000_000);
      const pageSize = boundedInt(req.query.pageSize, 25, 1, 100);
      const search = cleanSearch(req.query.search);
      const status = typeof req.query.status === 'string' ? req.query.status : 'ACTIVE';
      const categoryId = req.query.categoryId === undefined ? null : Number(req.query.categoryId);
      const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
      const productSorts: Record<string, any[]> = {
        newest: [desc(schema.products.id)], name_asc: [asc(schema.products.name), desc(schema.products.id)],
        name_desc: [desc(schema.products.name), desc(schema.products.id)], price_asc: [asc(schema.products.price), desc(schema.products.id)],
        price_desc: [desc(schema.products.price), desc(schema.products.id)], stock_asc: [asc(schema.products.stock), desc(schema.products.id)],
      };
      if (!productSorts[sort]) { res.status(400).json({ error: 'Ordenação de produtos inválida.' }); return; }
      if (!['ACTIVE', 'INACTIVE', 'ARCHIVED', 'NON_ACTIVE', 'ALL'].includes(status)) { res.status(400).json({ error: 'Filtro de status de produtos inválido.' }); return; }
      if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId <= 0)) { res.status(400).json({ error: 'Filtro de categoria inválido.' }); return; }
      const excludeKits = req.query.excludeKits === 'true';
      const filters: any[] = [];
      if (status === 'NON_ACTIVE') filters.push(or(eq(schema.products.status, 'INACTIVE'), eq(schema.products.status, 'ARCHIVED')));
      else if (['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) filters.push(eq(schema.products.status, status));
      if (Number.isSafeInteger(categoryId) && Number(categoryId) > 0) filters.push(eq(schema.products.categoryId, Number(categoryId)));
      if (excludeKits) filters.push(eq(schema.products.isKit, false));
      if (req.query.kits === 'true') filters.push(eq(schema.products.isKit, true));
      if (search) {
        const pattern = `%${escapedLike(search)}%`;
        filters.push(or(ilike(schema.products.name, pattern), ilike(schema.products.code, pattern), ilike(schema.products.description, pattern)));
      }
      const where = filters.length ? and(...filters) : undefined;
      const [totalRows, rows] = await Promise.all([
        db.select({ value: count() }).from(schema.products).where(where),
        db.select().from(schema.products).where(where).orderBy(...productSorts[sort]).limit(pageSize).offset((page - 1) * pageSize),
      ]);
      const ids = rows.map((row) => row.id);
      const categories = ids.length ? await db.select().from(schema.categories).where(inArray(schema.categories.id, [...new Set(rows.map((row) => row.categoryId))])) : [];
      const images = ids.length ? await db.select().from(schema.productImages).where(inArray(schema.productImages.productId, ids)) : [];
      const kitItems = ids.length ? await db.select().from(schema.productKitItems).where(inArray(schema.productKitItems.kitProductId, ids)) : [];
      const componentIds = [...new Set(kitItems.map((item) => item.componentProductId))];
      const components = componentIds.length ? await db.select().from(schema.products).where(inArray(schema.products.id, componentIds)) : [];
      const categoryNames = new Map(categories.map((cat) => [cat.id, cat.name]));
      const componentMap = new Map(components.map((product) => [product.id, product]));
      const enriched = rows.map((product) => {
        const productImages = images.filter((image) => image.productId === product.id);
        const primary = productImages.find((image) => image.isPrimary && image.mediaType !== 'VIDEO') || productImages.find((image) => image.mediaType !== 'VIDEO') || productImages[0];
        const componentRows = kitItems.filter((item) => item.kitProductId === product.id).map((item) => {
          const component = componentMap.get(item.componentProductId);
          return { id: item.id, componentProductId: item.componentProductId, componentCode: component?.code || '', componentName: component?.name || 'Produto', quantityPerKit: item.quantityPerKit, totalReservedInKit: product.stock * item.quantityPerKit, componentStock: component?.stock ?? 0 };
        });
        const maxBuildable = componentRows.length ? Math.min(...componentRows.map((item) => Math.floor(item.componentStock / item.quantityPerKit))) : 0;
        const estimatedCost = componentRows.reduce((sum, item) => sum + (Number(componentMap.get(item.componentProductId)?.cost || 0) * item.quantityPerKit), 0);
        const hasPromo = isPromoCurrentlyActive(product);
        return {
          ...product,
          hasPromo,
          promoExpired: Boolean(product.promoActive && product.promoEndsAt && new Date(product.promoEndsAt).getTime() <= Date.now()),
          effectivePrice: String(hasPromo ? product.promoPrice : product.price),
          discountPercent: calculateDiscountPercent(product.price, product.promoPrice, hasPromo),
          categoryName: categoryNames.get(product.categoryId) || 'Sem categoria',
          imageUrl: primary?.imageUrl || null,
          images: productImages,
          kitComponents: componentRows,
          maxBuildableKits: product.isKit ? maxBuildable : 0,
          estimatedComponentCost: product.isKit ? estimatedCost.toFixed(2) : null,
          grossMarginEstimate: product.isKit ? (Number(product.price) - estimatedCost).toFixed(2) : null,
        };
      });
      res.json({ products: enriched, page, pageSize, totalCount: Number(totalRows[0]?.value || 0), totalPages: Math.ceil(Number(totalRows[0]?.value || 0) / pageSize) });
    } catch (error) {
      logServerError('admin_products_list_failed', error);
      res.status(500).json({ error: 'Não foi possível carregar os produtos.' });
    }
  });

  app.post('/api/admin/products', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const input = productData(req.body);
      const initialStock = Number(req.body?.stock ?? 0);
      if (!Number.isSafeInteger(initialStock) || initialStock < 0 || initialStock > MAX_STOCK) {
        res.status(400).json({ error: 'Estoque inicial inválido.' }); return;
      }
      const [category] = await db.select().from(schema.categories).where(eq(schema.categories.id, input.categoryId)).limit(1);
      if (!category || category.status !== 'ACTIVE') { res.status(400).json({ error: 'Escolha uma categoria ativa.' }); return; }
      const media = parseAndValidateMediaItems(req.body);
      // A consulta global fica fora da transação para evitar usar uma conexão diferente do cliente transacional.
      const storeId = await getPrimaryStoreId();
      const created = await db.transaction(async (tx) => {
        const [product] = await tx.insert(schema.products).values({
          storeId, categoryId: input.categoryId, code: input.code, name: input.name, description: input.description,
          price: input.price, promoPrice: input.promoPrice, promoActive: input.promoActive, promoEndsAt: input.promoEndsAt,
          promoDurationHours: input.promoDurationHours, promoMaxUnits: input.promoMaxUnits, isKit: false, cost: input.cost,
          stock: initialStock, stockMinimum: input.stockMinimum, weight: input.weight,
          status: initialStock > 0 && req.body?.status !== 'INACTIVE' ? 'ACTIVE' : 'INACTIVE',
        }).returning();
        if (initialStock > 0) await recordInventoryMovement(tx, {
          productId: product.id, delta: initialStock, beforeStock: 0, afterStock: initialStock,
          movementType: 'INITIAL_STOCK', reason: 'Saldo inicial informado no cadastro do produto', actorUserId: req.user!.id,
        });
        if (media) for (const item of media) await tx.insert(schema.productImages).values({ productId: product.id, ...item });
        return product;
      });
      res.status(201).json(created);
    } catch (error: any) {
      logServerError('admin_product_create_failed', error);
      res.status(error?.message ? 400 : 500).json({ error: error?.message || 'Não foi possível cadastrar o produto.' });
    }
  });

  app.put('/api/admin/products/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'ID de produto inválido.' }); return; }
      const [existing] = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
      if (!existing) { res.status(404).json({ error: 'Produto não encontrado.' }); return; }
      if (existing.isKit) { res.status(409).json({ error: 'Edite kits pela operação específica de kits.' }); return; }
      if (req.body?.stock !== undefined && Number(req.body.stock) !== existing.stock) { res.status(400).json({ error: 'O saldo deve ser alterado na área Estoque, com motivo registrado.' }); return; }
      const input = productData(req.body, existing);
      const [category] = await db.select().from(schema.categories).where(eq(schema.categories.id, input.categoryId)).limit(1);
      if (!category) { res.status(400).json({ error: 'Categoria inválida.' }); return; }
      const media = parseAndValidateMediaItems(req.body);
      const targetStatus = ['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(req.body?.status) ? req.body.status : existing.status;
      if (targetStatus === 'ACTIVE' && existing.stock <= 0) { res.status(400).json({ error: 'Produto sem saldo; registre uma entrada de estoque antes de ativá-lo.' }); return; }
      if (targetStatus === 'ARCHIVED') {
        const [activeKitRef] = await db.select({ id: schema.products.id }).from(schema.productKitItems)
          .innerJoin(schema.products, eq(schema.productKitItems.kitProductId, schema.products.id))
          .where(and(eq(schema.productKitItems.componentProductId, id), eq(schema.products.isKit, true), eq(schema.products.status, 'ACTIVE'))).limit(1);
        if (activeKitRef) { res.status(409).json({ error: 'Desative ou arquive os kits ativos que usam este produto antes de arquivá-lo.' }); return; }
      }
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(schema.products).set({ ...input, status: targetStatus, updatedAt: new Date() })
          .where(and(eq(schema.products.id, id), eq(schema.products.stock, existing.stock))).returning();
        if (!row) throw new Error('O saldo foi alterado por outra operação. Atualize a tela e tente novamente.');
        if (media !== null) {
          await tx.delete(schema.productImages).where(eq(schema.productImages.productId, id));
          for (const item of media) await tx.insert(schema.productImages).values({ productId: id, ...item });
        }
        return row;
      });
      res.json(updated);
    } catch (error: any) {
      logServerError('admin_product_update_failed', error);
      res.status(error?.message ? 400 : 500).json({ error: error?.message || 'Não foi possível atualizar o produto.' });
    }
  });

  app.put('/api/admin/products/:id/status', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const target = req.body?.status;
      if (!Number.isSafeInteger(id) || id <= 0 || !['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(target)) { res.status(400).json({ error: 'Produto ou status inválido.' }); return; }
      const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
      if (!product) { res.status(404).json({ error: 'Produto não encontrado.' }); return; }
      if (target === 'ACTIVE' && product.stock <= 0) { res.status(409).json({ error: 'Registre entrada de estoque antes de ativar.' }); return; }
      if (target === 'ARCHIVED' && product.isKit && product.stock > 0) { res.status(409).json({ error: 'Desmonte o saldo do kit antes de arquivá-lo.' }); return; }
      if (target === 'ARCHIVED' && !product.isKit) {
        const [activeKitRef] = await db.select({ id: schema.products.id }).from(schema.productKitItems)
          .innerJoin(schema.products, eq(schema.productKitItems.kitProductId, schema.products.id))
          .where(and(eq(schema.productKitItems.componentProductId, id), eq(schema.products.isKit, true), eq(schema.products.status, 'ACTIVE'))).limit(1);
        if (activeKitRef) { res.status(409).json({ error: 'Desative os kits ativos que usam este produto antes de arquivá-lo.' }); return; }
      }
      const [updated] = await db.update(schema.products).set({ status: target, updatedAt: new Date() })
        .where(and(eq(schema.products.id, id), eq(schema.products.stock, product.stock))).returning();
      if (!updated) { res.status(409).json({ error: 'Produto alterado por outra operação.' }); return; }
      res.json(updated);
    } catch (error) {
      logServerError('admin_product_status_failed', error);
      res.status(500).json({ error: 'Não foi possível atualizar o status do produto.' });
    }
  });

  app.put('/api/admin/products/:id/activate-stock', requireAuth, requireAdmin, (_req, res) => {
    res.status(409).json({ error: 'Ajustes de saldo devem ser feitos na área Estoque com motivo e chave idempotente.' });
  });

  // Categorias: contagem de produtos e paginação; não há exclusão física.
  app.get('/api/admin/categories', requireAuth, requireAdmin, async (req, res) => {
    try {
      const page = boundedInt(req.query.page, 1, 1, 1_000_000);
      const pageSize = boundedInt(req.query.pageSize, 100, 1, 200);
      const search = cleanSearch(req.query.search);
      const status = typeof req.query.status === 'string' ? req.query.status : 'ALL';
      const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
      const categorySorts: Record<string, any[]> = { newest: [desc(schema.categories.id)], name_asc: [asc(schema.categories.name), desc(schema.categories.id)], name_desc: [desc(schema.categories.name), desc(schema.categories.id)] };
      if (!categorySorts[sort]) { res.status(400).json({ error: 'Ordenação de categorias inválida.' }); return; }
      if (!['ALL', 'ACTIVE', 'INACTIVE'].includes(status)) { res.status(400).json({ error: 'Filtro de status de categorias inválido.' }); return; }
      const filters: any[] = [];
      if (status === 'ACTIVE' || status === 'INACTIVE') filters.push(eq(schema.categories.status, status));
      if (search) filters.push(or(ilike(schema.categories.name, `%${escapedLike(search)}%`), ilike(schema.categories.description, `%${escapedLike(search)}%`)));
      const where = filters.length ? and(...filters) : undefined;
      const [totals, rows] = await Promise.all([
        db.select({ value: count() }).from(schema.categories).where(where),
        db.select().from(schema.categories).where(where).orderBy(...categorySorts[sort]).limit(pageSize).offset((page - 1) * pageSize),
      ]);
      const ids = rows.map((row) => row.id);
      const countRows = ids.length ? await db.select({ categoryId: schema.products.categoryId, total: count() }).from(schema.products).where(inArray(schema.products.categoryId, ids)).groupBy(schema.products.categoryId) : [];
      const byCategory = new Map(countRows.map((row) => [row.categoryId, Number(row.total)]));
      const totalCount = Number(totals[0]?.value || 0);
      res.json({ categories: rows.map((row) => ({ ...row, productCount: byCategory.get(row.id) || 0 })), page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) });
    } catch (error) {
      logServerError('admin_categories_list_failed', error);
      res.status(500).json({ error: 'Não foi possível carregar as categorias.' });
    }
  });

  app.post('/api/admin/categories', requireAuth, requireAdmin, async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const description = req.body?.description;
      if (!name || name.length > 100 || (description != null && (typeof description !== 'string' || description.length > 1000))) { res.status(400).json({ error: 'Nome ou descrição de categoria inválidos.' }); return; }
      const [row] = await db.insert(schema.categories).values({ storeId: await getPrimaryStoreId(), name, description: description?.trim() || null, status: req.body?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE' }).returning();
      res.status(201).json({ ...row, productCount: 0 });
    } catch (error) {
      logServerError('admin_category_create_failed', error); res.status(500).json({ error: 'Não foi possível criar a categoria.' });
    }
  });

  app.put('/api/admin/categories/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const description = req.body?.description;
      if (!Number.isSafeInteger(id) || id <= 0 || !name || name.length > 100 || (description != null && (typeof description !== 'string' || description.length > 1000))) { res.status(400).json({ error: 'Categoria, nome ou descrição inválidos.' }); return; }
      const [row] = await db.update(schema.categories).set({ name, description: description?.trim() || null, status: req.body?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', updatedAt: new Date() }).where(eq(schema.categories.id, id)).returning();
      if (!row) { res.status(404).json({ error: 'Categoria não encontrada.' }); return; }
      const [countRow] = await db.select({ total: count() }).from(schema.products).where(eq(schema.products.categoryId, id));
      res.json({ ...row, productCount: Number(countRow?.total || 0) });
    } catch (error) {
      logServerError('admin_category_update_failed', error); res.status(500).json({ error: 'Não foi possível atualizar a categoria.' });
    }
  });

  // Estoque: movimentos manuais imutáveis e idempotentes; kits só mudam pelo fluxo de montagem.
  app.get('/api/admin/inventory/products', requireAuth, requireAdmin, async (req, res) => {
    try {
      const page = boundedInt(req.query.page, 1, 1, 1_000_000);
      const pageSize = boundedInt(req.query.pageSize, 25, 1, 100);
      const search = cleanSearch(req.query.search);
      const lowOnly = req.query.lowStock === 'true';
      const filters: any[] = [neStatusArchived()];
      if (search) filters.push(or(ilike(schema.products.name, `%${escapedLike(search)}%`), ilike(schema.products.code, `%${escapedLike(search)}%`)));
      if (lowOnly) filters.push(sql`${schema.products.stock} <= ${schema.products.stockMinimum}`);
      const where = and(...filters);
      const [totals, rows, lowStockRows] = await Promise.all([
        db.select({ value: count() }).from(schema.products).where(where),
        db.select({ id: schema.products.id, code: schema.products.code, name: schema.products.name, stock: schema.products.stock, stockMinimum: schema.products.stockMinimum, status: schema.products.status, categoryId: schema.products.categoryId, isKit: schema.products.isKit })
          .from(schema.products).where(where).orderBy(asc(schema.products.stock), asc(schema.products.name)).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ value: count() }).from(schema.products).where(and(neStatusArchived(), sql`${schema.products.stock} <= ${schema.products.stockMinimum}`)),
      ]);
      const totalCount = Number(totals[0]?.value || 0);
      res.json({ products: rows, page, pageSize, totalCount, lowStockCount: Number(lowStockRows[0]?.value || 0), totalPages: Math.ceil(totalCount / pageSize) });
    } catch (error) {
      logServerError('admin_inventory_list_failed', error); res.status(500).json({ error: 'Não foi possível carregar os saldos.' });
    }
  });

  app.get('/api/admin/inventory/products/:id/movements', requireAuth, requireAdmin, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const page = boundedInt(req.query.page, 1, 1, 1_000_000);
      const pageSize = boundedInt(req.query.pageSize, 25, 1, 100);
      if (!Number.isSafeInteger(productId) || productId <= 0) { res.status(400).json({ error: 'Produto inválido.' }); return; }
      const [product] = await db.select({ id: schema.products.id, code: schema.products.code, name: schema.products.name, stock: schema.products.stock, stockMinimum: schema.products.stockMinimum, isKit: schema.products.isKit }).from(schema.products).where(eq(schema.products.id, productId)).limit(1);
      if (!product) { res.status(404).json({ error: 'Produto não encontrado.' }); return; }
      const [totalRows, movements] = await Promise.all([
        db.select({ value: count() }).from(schema.inventoryMovements).where(eq(schema.inventoryMovements.productId, productId)),
        db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.productId, productId)).orderBy(desc(schema.inventoryMovements.id)).limit(pageSize).offset((page - 1) * pageSize),
      ]);
      const actorIds = [...new Set(movements.map((row) => row.actorUserId).filter((id): id is number => id !== null))];
      const orderIds = [...new Set(movements.map((row) => row.orderId).filter((id): id is number => id !== null))];
      const actors = actorIds.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, actorIds)) : [];
      const orders = orderIds.length ? await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber }).from(schema.orders).where(inArray(schema.orders.id, orderIds)) : [];
      const actorMap = new Map(actors.map((row) => [row.id, row.name]));
      const orderMap = new Map(orders.map((row) => [row.id, row.orderNumber]));
      const totalCount = Number(totalRows[0]?.value || 0);
      res.json({ product, movements: movements.map((row) => ({ ...row, actorName: row.actorUserId ? actorMap.get(row.actorUserId) || 'Administrador' : 'Sistema', orderNumber: row.orderId ? orderMap.get(row.orderId) || null : null })), page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) });
    } catch (error) {
      logServerError('admin_inventory_history_failed', error); res.status(500).json({ error: 'Não foi possível carregar o histórico do produto.' });
    }
  });

  app.post('/api/admin/inventory/movements', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const key = uuidKey(req.body?.idempotencyKey);
    const productId = Number(req.body?.productId);
    const direction = req.body?.direction;
    const quantity = Number(req.body?.quantity);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!key || !Number.isSafeInteger(productId) || productId <= 0 || !['IN', 'OUT', 'SET'].includes(direction) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_STOCK || !reason || reason.length > 500) {
      res.status(400).json({ error: 'Informe produto, operação, quantidade, motivo (até 500 caracteres) e chave de envio válida.' }); return;
    }
    const fingerprint = summarizeFingerprint([productId, direction, quantity, reason]);
    try {
      const result = await db.transaction(async (tx) => {
        const prior = await getPriorOperation(tx, key, fingerprint);
        if (prior?.conflict) return { conflict: true as const };
        if (prior?.duplicate) return { duplicate: true as const, result: prior.result };
        const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1);
        if (!product) return { notFound: true as const };
        if (product.isKit) return { kit: true as const };
        const delta = direction === 'IN' ? quantity : direction === 'OUT' ? -quantity : quantity - product.stock;
        const afterStock = product.stock + delta;
        if (afterStock < 0 || afterStock > MAX_STOCK) return { insufficient: true as const };
        const movement = await changeStock(tx, product, delta, {
          movementType: direction === 'IN' ? 'MANUAL_ENTRY' : direction === 'OUT' ? 'MANUAL_EXIT' : 'MANUAL_CORRECTION',
          reason, actorUserId: req.user!.id, idempotencyKey: key,
          operationResult: { fingerprint, result: { productId, delta, beforeStock: product.stock, afterStock } },
        });
        return { movement, stockDelta: delta, product: { id: movement.id, stock: movement.stock, status: movement.status, code: movement.code, name: movement.name } };
      });
      if ('notFound' in result) { res.status(404).json({ error: 'Produto não encontrado.' }); return; }
      if ('kit' in result) { res.status(409).json({ error: 'Ajustes manuais de kits são bloqueados; use montagem ou desmonte.' }); return; }
      if ('insufficient' in result) { logServerEvent('inventory.manual_movement.rejected', 'warn', { status: 409, productId, adminId: req.user!.id, action: direction, result: 'rejected', reason: 'stock_bounds' }); res.status(409).json({ error: 'A operação deixaria o estoque negativo ou acima do limite.' }); return; }
      if ('conflict' in result) { logServerEvent('inventory.manual_movement.conflict', 'warn', { status: 409, productId, adminId: req.user!.id, action: direction, result: 'conflict', reason: 'idempotency_key_reused' }); res.status(409).json({ error: 'Esta chave idempotente já foi usada com dados diferentes.' }); return; }
      if ('duplicate' in result) { res.json({ ...result.result, duplicate: true }); return; }
      logServerEvent('inventory.manual_movement.created', 'info', { productId: result.product.id, adminId: req.user!.id, role: req.user!.role, action: direction, stockDelta: result.stockDelta, result: 'committed' });
      res.status(201).json({ ...result.product, duplicate: false });
    } catch (error: any) {
      logServerError('inventory.manual_movement.failed', error, { productId, adminId: req.user!.id, action: direction, result: 'transaction_rolled_back' });
      const [prior] = key ? await db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.idempotencyKey, key)).limit(1).catch(() => []) : [];
      const stored = prior?.operationResult as any;
      if (prior && stored?.fingerprint === fingerprint) { res.json({ ...stored.result, duplicate: true }); return; }
      res.status(error?.message?.includes('outra operação') ? 409 : 500).json({ error: error?.message || 'Não foi possível registrar a movimentação.' });
    }
  });

  // Clientes: busca/paginação no servidor e detalhe/histórico somente sob demanda.
  app.get('/api/admin/customers', requireAuth, requireAdmin, async (req, res) => {
    try {
      const page = boundedInt(req.query.page, 1, 1, 1_000_000);
      const pageSize = boundedInt(req.query.pageSize, 25, 1, 100);
      const search = cleanSearch(req.query.search);
      const status = typeof req.query.status === 'string' ? req.query.status : 'ALL';
      const lgpd = typeof req.query.lgpd === 'string' ? req.query.lgpd : 'ALL';
      const segment = typeof req.query.segment === 'string' ? req.query.segment : 'ALL';
      const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
      const customerSorts: Record<string, any[]> = { newest: [desc(schema.users.id)], name_asc: [asc(schema.users.name), desc(schema.users.id)], name_desc: [desc(schema.users.name), desc(schema.users.id)] };
      if (!customerSorts[sort]) { res.status(400).json({ error: 'Ordenação de clientes inválida.' }); return; }
      if (!['ALL', 'PENDING_FREIGHT', 'WITH_FREE_DELIVERY'].includes(segment)) { res.status(400).json({ error: 'Filtro de segmento de clientes inválido.' }); return; }
      if (!['ALL', 'ACTIVE', 'INACTIVE', 'BLOCKED'].includes(status) || !['ALL', 'PENDING', 'NONE'].includes(lgpd)) { res.status(400).json({ error: 'Filtro de clientes inválido.' }); return; }
      const filters: any[] = [eq(schema.users.role, 'CUSTOMER')];
      if (['ACTIVE', 'INACTIVE', 'BLOCKED'].includes(status)) filters.push(eq(schema.users.status, status));
      if (lgpd === 'PENDING') filters.push(isNotNull(schema.users.deletionRequestedAt));
      if (lgpd === 'NONE') filters.push(sql`${schema.users.deletionRequestedAt} IS NULL`);
      if (segment === 'PENDING_FREIGHT') filters.push(sql`EXISTS (SELECT 1 FROM addresses a WHERE a.user_id = ${schema.users.id} AND a.delivery_fee_status = 'PENDING')`);
      if (segment === 'WITH_FREE_DELIVERY') filters.push(sql`${schema.users.freeDeliveryUntil} > NOW()`);
      if (search) {
        const pattern = `%${escapedLike(search)}%`;
        filters.push(or(ilike(schema.users.name, pattern), ilike(schema.users.email, pattern), ilike(schema.users.phone, pattern), ilike(schema.users.cpf, pattern)));
      }
      const where = and(...filters);
      const [totalRows, rows] = await Promise.all([
        db.select({ value: count() }).from(schema.users).where(where),
        db.select({ id: schema.users.id, name: schema.users.name, cpf: schema.users.cpf, email: schema.users.email, phone: schema.users.phone, status: schema.users.status, deletionRequestedAt: schema.users.deletionRequestedAt, createdAt: schema.users.createdAt, freeDeliveryUntil: schema.users.freeDeliveryUntil })
          .from(schema.users).where(where).orderBy(...customerSorts[sort]).limit(pageSize).offset((page - 1) * pageSize),
      ]);
      const ids = rows.map((row) => row.id);
      const [orderStats, addressRows, freightRule, settingsMap] = await Promise.all([
        ids.length ? db.select({ userId: schema.orders.userId, ordersCount: count(), totalSpent: sql<string>`COALESCE(SUM(CASE WHEN ${schema.orders.status} <> 'CANCELLED' THEN ${schema.orders.total} ELSE 0 END), 0)`, lastOrderAt: sql<Date | null>`MAX(${schema.orders.createdAt})` }).from(schema.orders).where(and(inArray(schema.orders.userId, ids), notPaymentExpiredOrder())).groupBy(schema.orders.userId) : Promise.resolve([]),
        ids.length ? db.select({ userId: schema.addresses.userId, deliveryFeeStatus: schema.addresses.deliveryFeeStatus }).from(schema.addresses).where(inArray(schema.addresses.userId, ids)) : Promise.resolve([]),
        getFreightRuleConfig(), getSettingsMap(),
      ]);
      const orderMap = new Map<number, any>((orderStats as any[]).map((row: any) => [row.userId, row]));
      const addressCount = new Map<number, { count: number; pending: number }>();
      for (const row of addressRows) {
        const entry = addressCount.get(row.userId) || { count: 0, pending: 0 };
        entry.count += 1; if (row.deliveryFeeStatus === 'PENDING') entry.pending += 1;
        addressCount.set(row.userId, entry);
      }
      const totalCount = Number(totalRows[0]?.value || 0);
      res.json({
        customers: rows.map((row) => {
          const stats = orderMap.get(row.id); const addr = addressCount.get(row.id);
          return { ...row, cpf: maskCpf(row.cpf), ordersCount: Number(stats?.ordersCount || 0), totalSpent: String(stats?.totalSpent || '0'), lastOrderAt: stats?.lastOrderAt || null, addressCount: addr?.count || 0, pendingAddressCount: addr?.pending || 0 };
        }),
        page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize),
        freightRule, defaultOrigin: settingsMap.store_origin_address || 'Matriz DeepShop',
      });
    } catch (error) {
      logServerError('admin_customers_list_failed', error); res.status(500).json({ error: 'Não foi possível carregar os clientes.' });
    }
  });

  app.get('/api/admin/customers/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'ID de cliente inválido.' }); return; }
      const [customer] = await db.select({ id: schema.users.id, name: schema.users.name, cpf: schema.users.cpf, email: schema.users.email, phone: schema.users.phone, status: schema.users.status, deletionRequestedAt: schema.users.deletionRequestedAt, createdAt: schema.users.createdAt, privacyVersion: schema.users.privacyVersion, privacyAcceptedAt: schema.users.privacyAcceptedAt, termsVersion: schema.users.termsVersion, termsAcceptedAt: schema.users.termsAcceptedAt, freeDeliveryUntil: schema.users.freeDeliveryUntil })
        .from(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.role, 'CUSTOMER'))).limit(1);
      if (!customer) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }
      const [addresses, aggregates] = await Promise.all([
        db.select().from(schema.addresses).where(eq(schema.addresses.userId, id)).orderBy(desc(schema.addresses.id)),
        db.select({ ordersCount: count(), totalSpent: sql<string>`COALESCE(SUM(CASE WHEN ${schema.orders.status} <> 'CANCELLED' THEN ${schema.orders.total} ELSE 0 END), 0)`, lastOrderAt: sql<Date | null>`MAX(${schema.orders.createdAt})` }).from(schema.orders).where(and(eq(schema.orders.userId, id), notPaymentExpiredOrder())),
      ]);
      const updaterIds = [...new Set(addresses.map((address) => address.deliveryUpdatedBy).filter((value): value is number => value !== null))];
      const users = updaterIds.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, updaterIds)) : [];
      const userNames = new Map(users.map((row) => [row.id, row.name]));
      res.json({ ...customer, cpf: maskCpf(customer.cpf), addresses: addresses.map((address) => ({ ...address, updatedByName: address.deliveryUpdatedBy ? userNames.get(address.deliveryUpdatedBy) || 'Administrador' : null, freight: resolveAddressFreight(address) })), ordersCount: Number(aggregates[0]?.ordersCount || 0), totalSpent: String(aggregates[0]?.totalSpent || '0'), lastOrderAt: aggregates[0]?.lastOrderAt || null, freightRule: await getFreightRuleConfig(), defaultOrigin: (await getSettingsMap()).store_origin_address || 'Matriz DeepShop' });
    } catch (error) {
      logServerError('admin_customer_detail_failed', error); res.status(500).json({ error: 'Não foi possível carregar o cliente.' });
    }
  });

  app.get('/api/admin/customers/:id/orders', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id); const limit = boundedInt(req.query.limit, 10, 1, 25);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'Cliente inválido.' }); return; }
      const [customer] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.role, 'CUSTOMER'))).limit(1);
      if (!customer) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }
      const orders = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, total: schema.orders.total, createdAt: schema.orders.createdAt, paymentMethod: schema.orders.paymentMethod }).from(schema.orders).where(and(eq(schema.orders.userId, id), notPaymentExpiredOrder())).orderBy(desc(schema.orders.id)).limit(limit);
      const orderIds = orders.map((order) => order.id);
      const items = orderIds.length ? await db.select({ orderId: schema.orderItems.orderId, productName: schema.orderItems.productName, quantity: schema.orderItems.quantity, subtotal: schema.orderItems.subtotal }).from(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds)) : [];
      res.json({ orders: orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) })) });
    } catch (error) {
      logServerError('admin_customer_orders_failed', error); res.status(500).json({ error: 'Não foi possível carregar o histórico de pedidos.' });
    }
  });

  app.put('/api/admin/customers/:id/status', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id); const status = req.body?.status;
      if (!Number.isSafeInteger(id) || id <= 0 || !['ACTIVE', 'INACTIVE', 'BLOCKED'].includes(status)) { res.status(400).json({ error: 'Cliente ou status inválido.' }); return; }
      const [updated] = await db.update(schema.users).set({ status, updatedAt: new Date() }).where(and(eq(schema.users.id, id), eq(schema.users.role, 'CUSTOMER'))).returning({ id: schema.users.id, status: schema.users.status });
      if (!updated) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }
      res.json(updated);
    } catch (error) { logServerError('admin_customer_status_failed', error); res.status(500).json({ error: 'Não foi possível atualizar o cliente.' }); }
  });

  app.put('/api/admin/customers/:id/free-delivery-period', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const days = Number(req.body?.days);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(days) || days < 0 || days > 3650) {
        res.status(400).json({ error: 'Informe uma quantidade de dias válida entre 0 e 3650.' });
        return;
      }
      const [customer] = await db.select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(and(eq(schema.users.id, id), eq(schema.users.role, 'CUSTOMER')));
      if (!customer) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }
      const until = days === 0 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const [updated] = await db.update(schema.users)
        .set({ freeDeliveryUntil: until, updatedAt: new Date() })
        .where(eq(schema.users.id, id))
        .returning({ id: schema.users.id, freeDeliveryUntil: schema.users.freeDeliveryUntil });
      logServerEvent('admin.customer.free_delivery_period.updated', 'info', { customerId: id, days, result: 'updated' });
      res.json({ customerId: id, customerName: customer.name, days, freeDeliveryUntil: updated?.freeDeliveryUntil || null, message: days > 0 ? `Frete grátis liberado para ${customer.name} por ${days} dia(s).` : `Frete grátis por período removido de ${customer.name}.` });
    } catch (error) {
      logServerError('admin.customer.free_delivery_period.failed', error);
      res.status(500).json({ error: 'Não foi possível atualizar o período de frete grátis.' });
    }
  });
  // O reset assistido permanece desativado até existir entrega verificável do código ao cliente.
  // Nunca retorna código, hash, token ou segredo ao painel administrativo.
  app.post('/api/admin/customers/:id/reset-code', requireAuth, requireAdmin, (_req, res) => {
    res.status(409).json({ error: 'Redefinição administrativa temporariamente indisponível: configure um canal seguro de entrega ao cliente.' });
  });

  // Operações idempotentes de kit: componente, saldo final e operação ficam na mesma transação.
  app.post('/api/admin/kits', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const key = uuidKey(req.body?.idempotencyKey);
    if (!key) { res.status(400).json({ error: 'Chave idempotente válida é obrigatória.' }); return; }
    let input: ReturnType<typeof productData>;
    try { input = productData(req.body); } catch (error: any) { res.status(400).json({ error: error.message }); return; }
    const kitsCount = Number(req.body?.kitsQuantity ?? 1);
    if (!Number.isSafeInteger(kitsCount) || kitsCount < 1 || kitsCount > MAX_STOCK) { res.status(400).json({ error: 'Quantidade de kits inválida.' }); return; }
    const fingerprint = summarizeFingerprint([input.categoryId, input.code, input.name, input.price, kitsCount, req.body?.components]);
    try {
      const media = parseAndValidateMediaItems(req.body);
      // Esta consulta usa o pool global e precisa ocorrer antes da transação.
      const storeId = await getPrimaryStoreId();
      const result: any = await db.transaction(async (tx) => {
        const prior = await getPriorOperation(tx, key, fingerprint);
        if (prior?.conflict) return { conflict: true as const };
        if (prior?.duplicate) return { duplicate: true as const, result: prior.result };
        const category = await tx.select().from(schema.categories).where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.status, 'ACTIVE'))).limit(1);
        if (!category.length) throw new Error('Escolha uma categoria ativa.');
        const components = await validateComponents(tx, req.body?.components);
        let cost = 0;
        for (const item of components) {
          const total = item.quantityPerKit * kitsCount;
          if (total > MAX_STOCK || item.product.stock < total) throw new Error(`Estoque insuficiente para o componente ${item.product.code} - ${item.product.name}.`);
          await changeStock(tx, item.product, -total, { movementType: 'KIT_ASSEMBLY_COMPONENT_OUT', reason: `Componentes utilizados na montagem do kit ${input.code} - ${input.name}`, actorUserId: req.user!.id, kitProductId: undefined });
          cost += Number(item.product.cost || 0) * item.quantityPerKit;
        }
        const suppliedCost = req.body?.cost === undefined || req.body?.cost === null || req.body?.cost === '' ? cost : normMoney(req.body.cost);
        if (!Number.isFinite(suppliedCost) || suppliedCost < 0 || suppliedCost > 99_999_999.99) throw new Error('Custo do kit inválido.');
        const [kit] = await tx.insert(schema.products).values({
          storeId, categoryId: input.categoryId, code: input.code, name: input.name, description: input.description,
          price: input.price, promoPrice: input.promoPrice, promoActive: input.promoActive, promoEndsAt: input.promoEndsAt,
          promoDurationHours: input.promoDurationHours, promoMaxUnits: input.promoMaxUnits, isKit: true, cost: suppliedCost.toFixed(2),
          stock: kitsCount, stockMinimum: input.stockMinimum, weight: input.weight, status: 'ACTIVE',
        }).returning();
        for (const item of components) await tx.insert(schema.productKitItems).values({ kitProductId: kit.id, componentProductId: item.productId, quantityPerKit: item.quantityPerKit });
        if (media) for (const item of media) await tx.insert(schema.productImages).values({ productId: kit.id, ...item });
        const operationResult = { fingerprint, result: { kitId: kit.id, stock: kitsCount, status: kit.status } };
        await recordInventoryMovement(tx, { productId: kit.id, delta: kitsCount, beforeStock: 0, afterStock: kitsCount, movementType: 'KIT_ASSEMBLY', reason: `Montagem inicial de ${kitsCount} unidade(s) do kit`, actorUserId: req.user!.id, idempotencyKey: key, operationResult });
        return { kit, duplicate: false };
      });
      if ('conflict' in result) { res.status(409).json({ error: 'Chave idempotente reutilizada com outro conteúdo.' }); return; }
      if ('duplicate' in result && result.duplicate) { res.json({ ...result.result, duplicate: true }); return; }
      res.status(201).json({ ...result.kit, duplicate: false });
    } catch (error: any) {
      logServerError('admin_kit_create_failed', error); res.status(error?.message ? 400 : 500).json({ error: error?.message || 'Não foi possível montar o kit.' });
    }
  });

  app.post('/api/admin/kits/:id/assemble', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id); const countUnits = Number(req.body?.quantity); const key = uuidKey(req.body?.idempotencyKey);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : 'Montagem adicional de kit pelo administrador';
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(countUnits) || countUnits < 1 || countUnits > MAX_STOCK || !key || reason.length > 500) { res.status(400).json({ error: 'Kit, quantidade, motivo ou chave idempotente inválidos.' }); return; }
    const fingerprint = summarizeFingerprint([id, countUnits, reason]);
    try {
      const result = await db.transaction(async (tx) => {
        const prior = await getPriorOperation(tx, key, fingerprint);
        if (prior?.conflict) return { conflict: true as const };
        if (prior?.duplicate) return { duplicate: true as const, result: prior.result };
        const [kit] = await tx.select().from(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.isKit, true))).limit(1);
        if (!kit) return { notFound: true as const };
        const items = await tx.select().from(schema.productKitItems).where(eq(schema.productKitItems.kitProductId, id));
        if (!items.length) throw new Error('Kit sem componentes não pode ser montado.');
        for (const item of items) {
          const [component] = await tx.select().from(schema.products).where(eq(schema.products.id, item.componentProductId)).limit(1);
          if (!component) throw new Error('Componente do kit não encontrado.');
          const delta = item.quantityPerKit * countUnits;
          if (component.stock < delta) throw new Error(`Estoque insuficiente para ${component.code} - ${component.name}.`);
          await changeStock(tx, component, -delta, { movementType: 'KIT_ASSEMBLY_COMPONENT_OUT', reason: `Montagem de ${countUnits} unidade(s) do kit ${kit.code} - ${kit.name}: ${reason}`, actorUserId: req.user!.id, kitProductId: id });
        }
        const nextStock = kit.stock + countUnits;
        const [updated] = await tx.update(schema.products).set({ stock: nextStock, status: 'ACTIVE', updatedAt: new Date() }).where(and(eq(schema.products.id, id), eq(schema.products.stock, kit.stock))).returning();
        if (!updated) throw new Error('Saldo do kit alterado por outra operação.');
        const operationResult = { fingerprint, result: { kitId: id, stock: nextStock, status: 'ACTIVE' } };
        await recordInventoryMovement(tx, { productId: id, delta: countUnits, beforeStock: kit.stock, afterStock: nextStock, movementType: 'KIT_ASSEMBLY', reason, actorUserId: req.user!.id, kitProductId: id, idempotencyKey: key, operationResult });
        return { product: updated };
      });
      if ('notFound' in result) { res.status(404).json({ error: 'Kit não encontrado.' }); return; }
      if ('conflict' in result) { res.status(409).json({ error: 'Chave idempotente reutilizada com outro conteúdo.' }); return; }
      if ('duplicate' in result) { res.json({ ...result.result, duplicate: true }); return; }
      res.json({ ...result.product, duplicate: false });
    } catch (error: any) { logServerError('admin_kit_assemble_failed', error); res.status(error?.message ? 409 : 500).json({ error: error?.message || 'Não foi possível montar o kit.' }); }
  });

  app.put('/api/admin/kits/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id); const key = uuidKey(req.body?.idempotencyKey);
    if (!Number.isSafeInteger(id) || id <= 0 || !key) { res.status(400).json({ error: 'Kit ou chave idempotente inválidos.' }); return; }
    const [existing] = await db.select().from(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.isKit, true))).limit(1);
    if (!existing) { res.status(404).json({ error: 'Kit não encontrado.' }); return; }
    let input: ReturnType<typeof productData>;
    try { input = productData(req.body, existing); } catch (error: any) { res.status(400).json({ error: error.message }); return; }
    const fingerprint = summarizeFingerprint([id, input.categoryId, input.code, input.name, input.price, req.body?.components]);
    try {
      const media = parseAndValidateMediaItems(req.body);
      const updated = await db.transaction(async (tx) => {
        const prior = await getPriorOperation(tx, key, fingerprint);
        if (prior?.conflict) throw new Error('Chave idempotente reutilizada com outro conteúdo.');
        if (prior?.duplicate) return { duplicate: true, result: prior.result };
        const category = await tx.select().from(schema.categories).where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.status, 'ACTIVE'))).limit(1);
        if (!category.length) throw new Error('Escolha uma categoria ativa.');
        const nextComponents = await validateComponents(tx, req.body?.components);
        const oldItems = await tx.select().from(schema.productKitItems).where(eq(schema.productKitItems.kitProductId, id));
        const oldByProduct = new Map(oldItems.map((item) => [item.componentProductId, item.quantityPerKit]));
        const nextByProduct = new Map(nextComponents.map((item) => [item.productId, item.quantityPerKit]));
        const componentIds = [...new Set([...oldByProduct.keys(), ...nextByProduct.keys()])];
        let estimatedCost = 0;
        for (const componentId of componentIds) {
          const [component] = await tx.select().from(schema.products).where(eq(schema.products.id, componentId)).limit(1);
          if (!component) throw new Error('Componente não encontrado.');
          const oldQty = oldByProduct.get(componentId) || 0; const nextQty = nextByProduct.get(componentId) || 0;
          const delta = existing.stock * (oldQty - nextQty);
          if (component.stock + delta < 0 || component.stock + delta > MAX_STOCK) throw new Error(`Saldo insuficiente para atualizar o componente ${component.code} - ${component.name}.`);
          if (delta !== 0) await changeStock(tx, component, delta, { movementType: delta > 0 ? 'KIT_RECONFIGURE_COMPONENT_IN' : 'KIT_RECONFIGURE_COMPONENT_OUT', reason: `Reconfiguração dos componentes do kit ${existing.code} - ${existing.name}`, actorUserId: req.user!.id, kitProductId: id });
          const next = nextByProduct.get(componentId) || 0;
          if (next) estimatedCost += Number(component.cost || 0) * next;
        }
        const suppliedCost = req.body?.cost === undefined || req.body?.cost === null || req.body?.cost === '' ? estimatedCost : normMoney(req.body.cost);
        if (!Number.isFinite(suppliedCost) || suppliedCost < 0 || suppliedCost > 99_999_999.99) throw new Error('Custo do kit inválido.');
        const [row] = await tx.update(schema.products).set({ ...input, cost: suppliedCost.toFixed(2), status: existing.status, updatedAt: new Date() })
          .where(and(eq(schema.products.id, id), eq(schema.products.stock, existing.stock))).returning();
        if (!row) throw new Error('O kit foi alterado por outra operação.');
        await tx.delete(schema.productKitItems).where(eq(schema.productKitItems.kitProductId, id));
        for (const item of nextComponents) await tx.insert(schema.productKitItems).values({ kitProductId: id, componentProductId: item.productId, quantityPerKit: item.quantityPerKit });
        if (media !== null) {
          await tx.delete(schema.productImages).where(eq(schema.productImages.productId, id));
          for (const item of media) await tx.insert(schema.productImages).values({ productId: id, ...item });
        }
        const operationResult = { fingerprint, result: { kitId: id, stock: existing.stock, status: existing.status } };
        await recordInventoryMovement(tx, { productId: id, delta: 0, beforeStock: existing.stock, afterStock: existing.stock, movementType: 'KIT_UPDATED', reason: 'Dados e composição do kit atualizados', actorUserId: req.user!.id, kitProductId: id, idempotencyKey: key, operationResult });
        return { row, duplicate: false };
      });
      if ('duplicate' in updated && updated.duplicate) { res.json({ ...updated.result, duplicate: true }); return; }
      res.json({ ...updated.row, duplicate: false });
    } catch (error: any) { logServerError('admin_kit_update_failed', error); res.status(error?.message ? 409 : 500).json({ error: error?.message || 'Não foi possível atualizar o kit.' }); }
  });

  app.post('/api/admin/kits/:id/disassemble', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id); const key = uuidKey(req.body?.idempotencyKey);
    if (!Number.isSafeInteger(id) || id <= 0 || !key) { res.status(400).json({ error: 'Kit ou chave idempotente inválidos.' }); return; }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : 'Desmontagem manual do kit';
    if (!reason || reason.length > 500) { res.status(400).json({ error: 'Informe um motivo válido para desmontar o kit.' }); return; }
    const fingerprint = summarizeFingerprint([id, reason]);
    try {
      const result = await db.transaction(async (tx) => {
        const prior = await getPriorOperation(tx, key, fingerprint);
        if (prior?.conflict) return { conflict: true as const };
        if (prior?.duplicate) return { duplicate: true as const, result: prior.result };
        const [kit] = await tx.select().from(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.isKit, true))).limit(1);
        if (!kit) return { notFound: true as const };
        const items = await tx.select().from(schema.productKitItems).where(eq(schema.productKitItems.kitProductId, id));
        if (kit.stock > 0 && !items.length) throw new Error('Não é possível desmontar: a composição do kit está ausente.');
        for (const item of items) {
          const [component] = await tx.select().from(schema.products).where(eq(schema.products.id, item.componentProductId)).limit(1);
          if (!component) throw new Error('Componente do kit não encontrado.');
          await changeStock(tx, component, kit.stock * item.quantityPerKit, { movementType: 'KIT_DISASSEMBLY_COMPONENT_IN', reason: `Componentes devolvidos pela desmontagem do kit ${kit.code} - ${kit.name}: ${reason}`, actorUserId: req.user!.id, kitProductId: id });
        }
        const [archived] = await tx.update(schema.products).set({ stock: 0, status: 'ARCHIVED', updatedAt: new Date() })
          .where(and(eq(schema.products.id, id), eq(schema.products.stock, kit.stock), eq(schema.products.isKit, true))).returning();
        if (!archived) throw new Error('O kit foi alterado por outra operação.');
        const operationResult = { fingerprint, result: { kitId: id, stock: 0, status: 'ARCHIVED' } };
        await recordInventoryMovement(tx, { productId: id, delta: -kit.stock, beforeStock: kit.stock, afterStock: 0, movementType: 'KIT_DISASSEMBLY', reason, actorUserId: req.user!.id, kitProductId: id, idempotencyKey: key, operationResult });
        return { kitName: kit.name, restoredComponents: items.length, stock: kit.stock };
      });
      if ('notFound' in result) { res.status(404).json({ error: 'Kit não encontrado.' }); return; }
      if ('conflict' in result) { res.status(409).json({ error: 'Chave idempotente reutilizada com outro conteúdo.' }); return; }
      if ('duplicate' in result) { res.json({ ...result.result, duplicate: true }); return; }
      res.json({ ...result, duplicate: false, message: `Kit arquivado; ${result.stock} unidade(s) desmontada(s), componentes devolvidos. O histórico permanece preservado.` });
    } catch (error: any) { logServerError('admin_kit_disassemble_failed', error); res.status(error?.message ? 409 : 500).json({ error: error?.message || 'Não foi possível desmontar o kit.' }); }
  });
}

function neStatusArchived() {
  return sql`${schema.products.status} <> 'ARCHIVED'`;
}
