import { isAdminRole } from '../governance.ts';
import { logServerError } from '../logger.ts';
import { Express } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { getOptionalAuthUser } from '../middleware/auth.ts';
import {
  getSettingsMap,
  isPromoCurrentlyActive,
  calculateDiscountPercent,
} from '../services/storeHelpers.ts';
import { evaluateCustomerLoyaltyTickets } from '../services/loyaltyService.ts';
import { expireOverdueUnpaidOrders } from '../services/orderExpirationService.ts';
import { getStoreState } from '../services/storeStatusService.ts';

export function registerStorefrontRoutes(app: Express) {
  app.get('/api/storefront', async (req, res) => {
    try {
      await expireOverdueUnpaidOrders();
      const optUser = await getOptionalAuthUser(req);
      const loyalty =
        optUser && optUser.role === 'CUSTOMER'
          ? await evaluateCustomerLoyaltyTickets(optUser.id)
          : null;
      const eligibleForFirstOrderFreeDelivery =
        isAdminRole(optUser?.role)
          ? false
          : loyalty
          ? loyalty.isFirstOrderEligible
          : true;

      const allStores = await db.select().from(schema.stores);
      const store = allStores[0] || null;

      const activeCategories = await db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.status, 'ACTIVE'));

      const allProducts = await db
        .select()
        .from(schema.products)
        .orderBy(desc(schema.products.id));

      const allImages = await db.select().from(schema.productImages);
      const allKitItems = await db.select().from(schema.productKitItems);

      const categoryMap = new Map(activeCategories.map((c) => [c.id, c.name]));
      const prodMap = new Map(allProducts.map((p) => [p.id, p]));

      const visibleProducts = allProducts
        .filter((p) => p.status === 'ACTIVE' && p.stock > 0 && categoryMap.has(p.categoryId))
        .map((p) => {
          const prodImgs = allImages.filter((img) => img.productId === p.id);
          const primaryImg =
            prodImgs.find((i) => i.isPrimary && i.mediaType !== 'VIDEO') ||
            prodImgs.find((i) => i.mediaType !== 'VIDEO') ||
            prodImgs[0];
          const hasPromo = isPromoCurrentlyActive(p);
          const effectivePrice = hasPromo ? String(p.promoPrice) : String(p.price);
          const discountPercent = calculateDiscountPercent(p.price, p.promoPrice, hasPromo);

          const kitComponents = p.isKit
            ? allKitItems
                .filter((k) => k.kitProductId === p.id)
                .map((k) => {
                  const comp = prodMap.get(k.componentProductId);
                  return {
                    id: k.id,
                    componentProductId: k.componentProductId,
                    componentCode: comp?.code || '',
                    componentName: comp?.name || 'Produto',
                    quantityPerKit: k.quantityPerKit,
                  };
                })
            : [];

          return {
            ...p,
            hasPromo,
            effectivePrice,
            discountPercent,
            kitComponents,
            categoryName: categoryMap.get(p.categoryId) || 'Geral',
            imageUrl: primaryImg ? primaryImg.imageUrl : null,
            images: prodImgs,
          };
        });

      const settingsMap = await getSettingsMap();
      const storeState = getStoreState(settingsMap);

      res.json({
        store,
        categories: activeCategories,
        products: visibleProducts,
        eligibleForFirstOrderFreeDelivery,
        loyalty,
        settings: {
          whatsappNumber: settingsMap.whatsapp_number || '',
          pixKey: settingsMap.pix_key || '',
          pixInstructions: settingsMap.pix_instructions || '',
          paymentDeadlineHours: Number(settingsMap.payment_deadline_hours || 24),
          store: storeState,
        },
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar vitrine.' });
    }
  });

  app.get('/api/legal', async (_req, res) => {
    try {
      const settings = await getSettingsMap();
      res.json({
        legalVersion: settings.legal_version || '2026-10-v1',
        company: {
          name: settings.company_name || 'DeepShop Delivery',
          cnpj: settings.company_cnpj || '',
          address: settings.company_address || '',
          email: settings.company_email || '',
          phone: settings.company_phone || '',
        },
        privacy: settings.privacy_content || 'Política de Privacidade ainda não configurada.',
        terms: settings.terms_content || 'Termos de Uso ainda não configurados.',
        exchanges: settings.exchange_content || 'Política de Trocas e Devoluções ainda não configurada.',
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar informações legais.' });
    }
  });

  app.get('/api/products/:id', async (req, res) => {
    try {
      const prodId = Number(req.params.id);
      if (isNaN(prodId)) {
        res.status(400).json({ error: 'ID de produto inválido.' });
        return;
      }

      const [product] = await db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.id, prodId), eq(schema.products.status, 'ACTIVE')));

      if (!product || product.stock <= 0) {
        res.status(404).json({
          error: 'Produto não encontrado ou sem estoque disponível na vitrine.',
        });
        return;
      }

      const [category] = await db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.id, product.categoryId));

      const images = await db
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, product.id));

      const primaryImg =
        images.find((i) => i.isPrimary && i.mediaType !== 'VIDEO') ||
        images.find((i) => i.mediaType !== 'VIDEO') ||
        images[0];

      const hasPromo = isPromoCurrentlyActive(product);
      const effectivePrice = hasPromo ? String(product.promoPrice) : String(product.price);
      const discountPercent = calculateDiscountPercent(
        product.price,
        product.promoPrice,
        hasPromo
      );

      let kitComponents: any[] = [];
      if (product.isKit) {
        const kitRows = await db
          .select()
          .from(schema.productKitItems)
          .where(eq(schema.productKitItems.kitProductId, product.id));
        const allProds = await db.select().from(schema.products);
        const prodMap = new Map(allProds.map((p) => [p.id, p]));
        kitComponents = kitRows.map((k) => {
          const comp = prodMap.get(k.componentProductId);
          return {
            id: k.id,
            componentProductId: k.componentProductId,
            componentCode: comp?.code || '',
            componentName: comp?.name || 'Item',
            quantityPerKit: k.quantityPerKit,
          };
        });
      }

      const optUser = await getOptionalAuthUser(req);
      const loyalty =
        optUser && optUser.role === 'CUSTOMER'
          ? await evaluateCustomerLoyaltyTickets(optUser.id)
          : null;
      const eligibleForFirstOrderFreeDelivery =
        isAdminRole(optUser?.role)
          ? false
          : loyalty
          ? loyalty.isFirstOrderEligible
          : true;

      // Item 7: REMOVER o "+1" automático de GET /api/products/:id.
      // A visualização passa a ser enviada pelo frontend uma única vez por abertura.
      res.json({
        ...product,
        viewsCount: product.viewsCount || 0,
        hasPromo,
        effectivePrice,
        discountPercent,
        kitComponents,
        eligibleForFirstOrderFreeDelivery,
        loyalty,
        categoryName: category ? category.name : 'Geral',
        imageUrl: primaryImg ? primaryImg.imageUrl : null,
        images,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao carregar detalhes do produto.' });
    }
  });

  // Rate limiter em memória por IP: 60 requisições por minuto
  const ipRateLimiter = new Map<string, number[]>();
  function checkInteractionRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReqs = 60;
    const timestamps = (ipRateLimiter.get(ip) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxReqs) {
      return false;
    }
    timestamps.push(now);
    ipRateLimiter.set(ip, timestamps);
    return true;
  }

  // Registrar interação do produto (Cliques, Visualizações, Compartilhamentos no WhatsApp/Link)
  app.post('/api/products/:id/interaction', async (req, res) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
      if (!checkInteractionRateLimit(clientIp)) {
        res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
        return;
      }

      // Validação do corpo
      if (req.body && typeof req.body !== 'object') {
        res.status(400).json({ error: 'Corpo da requisição inválido.' });
        return;
      }

      const prodId = Number(req.params.id);
      if (isNaN(prodId)) {
        res.status(400).json({ error: 'ID de produto inválido.' });
        return;
      }

      const rawAction = String(req.body?.action || '').trim().toUpperCase();
      if (!['VIEW', 'CLICK', 'SHARE'].includes(rawAction)) {
        res.status(400).json({
          error: 'Ação de interação inválida. Deve ser VIEW, CLICK ou SHARE.',
        });
        return;
      }
      const action = rawAction as 'VIEW' | 'CLICK' | 'SHARE';

      // Verifica se o produto existe e está ATIVO (senão 404)
      const [product] = await db
        .select({
          id: schema.products.id,
          status: schema.products.status,
          viewsCount: schema.products.viewsCount,
          clicksCount: schema.products.clicksCount,
          sharesCount: schema.products.sharesCount,
        })
        .from(schema.products)
        .where(eq(schema.products.id, prodId));

      if (!product || product.status !== 'ACTIVE') {
        res.status(404).json({ error: 'Produto não encontrado ou inativo.' });
        return;
      }

      // NÃO contar interações de usuários ADMIN
      const optUser = await getOptionalAuthUser(req);
      if (optUser && isAdminRole(optUser.role)) {
        res.json({
          success: true,
          ignored: true,
          reason: 'ADMIN',
          viewsCount: product.viewsCount || 0,
          clicksCount: product.clicksCount || 0,
          sharesCount: product.sharesCount || 0,
        });
        return;
      }

      // NÃO contar interações de User-Agent com padrão de bot/crawler
      const ua = String(req.headers['user-agent'] || '').toLowerCase();
      if (/bot|crawler|spider|preview|headless|crawling/i.test(ua)) {
        res.json({
          success: true,
          ignored: true,
          reason: 'BOT',
          viewsCount: product.viewsCount || 0,
          clicksCount: product.clicksCount || 0,
          sharesCount: product.sharesCount || 0,
        });
        return;
      }

      const visitorId =
        String(req.body?.visitorId || req.headers['x-visitor-id'] || '').trim() ||
        `anon_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // Deduplicação no servidor:
      // VIEW = máximo 1 a cada 30 min por visitorId + produto
      // CLICK = máximo 1 a cada 10 min por visitorId + produto
      // SHARE = máximo 1 a cada 10 min por visitorId + produto
      const windowMinutes = action === 'VIEW' ? 30 : 10;
      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

      const recentInteractions = await db
        .select({ id: schema.productInteractions.id })
        .from(schema.productInteractions)
        .where(
          and(
            eq(schema.productInteractions.productId, prodId),
            eq(schema.productInteractions.type, action),
            eq(schema.productInteractions.visitorId, visitorId),
            sql`${schema.productInteractions.createdAt} >= ${windowStart}`
          )
        )
        .limit(1);

      if (recentInteractions.length > 0) {
        // Interação repetida dentro da janela retorna sucesso sem gravar duplicata
        res.json({
          success: true,
          deduplicated: true,
          viewsCount: product.viewsCount || 0,
          clicksCount: product.clicksCount || 0,
          sharesCount: product.sharesCount || 0,
        });
        return;
      }

      // Grava na tabela product_interactions
      await db.insert(schema.productInteractions).values({
        productId: prodId,
        type: action,
        visitorId,
        userId: optUser?.id || null,
        createdAt: new Date(),
      });

      // Atualiza o contador de total no produto correspondente
      if (action === 'SHARE') {
        await db
          .update(schema.products)
          .set({ sharesCount: sql`${schema.products.sharesCount} + 1` })
          .where(eq(schema.products.id, prodId));
      } else if (action === 'VIEW') {
        await db
          .update(schema.products)
          .set({ viewsCount: sql`${schema.products.viewsCount} + 1` })
          .where(eq(schema.products.id, prodId));
      } else {
        await db
          .update(schema.products)
          .set({ clicksCount: sql`${schema.products.clicksCount} + 1` })
          .where(eq(schema.products.id, prodId));
      }

      const [updated] = await db
        .select({
          viewsCount: schema.products.viewsCount,
          clicksCount: schema.products.clicksCount,
          sharesCount: schema.products.sharesCount,
        })
        .from(schema.products)
        .where(eq(schema.products.id, prodId));

      res.json({ success: true, ...updated });
    } catch (err: any) {
      logServerError('server_operation_failed', err);
      res.status(500).json({ error: 'Erro ao registrar interação do produto.' });
    }
  });
}
