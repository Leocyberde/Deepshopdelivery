import React, { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  Layers,
  RotateCcw,
  Trash2,
  Film,
  Image as ImageIcon,
  AlertTriangle,
  Check,
  Search,
  Archive,
} from 'lucide-react';
import {
  formatCurrency,
  calculateDiscountPercent,
  ProductImage,
  ProductMediaItem,
  ExpandableDescription,
  PromoCountdown,
  calculatePromoLinePricing,
} from '../../context/AppContext.tsx';
import { simulateProfit } from '../../utils/profitSimulation.ts';
import { AdminSection } from './AdminSidebar.tsx';

interface AdminProductsSectionProps {
  section: 'PRODUCTS' | 'INACTIVE_PRODUCTS' | 'PREORDER_STOCKOUT';
  goToSection: (target: AdminSection) => void;
  products: any[];
  productSearch: string;
  setProductSearch: (value: string) => void;
  productPage: number;
  setProductPage: (value: number) => void;
  productSort: string;
  setProductSort: (value: string) => void;
  productCategoryId: string;
  onProductCategoryChange: (value: string) => void;
  productTotalCount: number;
  productTotalPages: number;
  activeProductCount: number;
  inactiveProductCount: number;
  stockMinimum: string;
  setStockMinimum: (value: string) => void;
  onProductStatusChange: (product: any, status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED') => void;
  activeProductsList: any[];
  inactiveProductsList: any[];
  categories: any[];
  supplierOptions: any[];
  showProdForm: boolean;
  setShowProdForm: (val: boolean) => void;
  formMode: 'PRODUCT' | 'KIT';
  setFormMode: (val: 'PRODUCT' | 'KIT') => void;
  editingProd: any | null;
  prodCategoryId: number | '';
  setProdCategoryId: (val: number | '') => void;
  prodCode: string;
  setProdCode: (val: string) => void;
  prodName: string;
  setProdName: (val: string) => void;
  prodDesc: string;
  setProdDesc: (val: string) => void;
  prodPrice: string;
  setProdPrice: (val: string) => void;
  prodPromoPrice: string;
  setProdPromoPrice: (val: string) => void;
  prodPromoActive: boolean;
  setProdPromoActive: (val: boolean) => void;
  prodPromoDays: string;
  setProdPromoDays: (val: string) => void;
  prodPromoHours: string;
  setProdPromoHours: (val: string) => void;
  prodPromoMinutes: string;
  setProdPromoMinutes: (val: string) => void;
  prodPromoLimitEnabled: boolean;
  setProdPromoLimitEnabled: (val: boolean) => void;
  prodPromoMaxUnits: string;
  setProdPromoMaxUnits: (val: string) => void;
  prodCost: string;
  setProdCost: (val: string) => void;
  prodCostMode: 'unit' | 'lot';
  setProdCostMode: (val: 'unit' | 'lot') => void;
  prodCostLotUnits: string;
  setProdCostLotUnits: (val: string) => void;
  prodStock: string;
  setProdStock: (val: string) => void;
  purchaseCostMode: 'same' | 'unit' | 'lot';
  setPurchaseCostMode: (val: 'same' | 'unit' | 'lot') => void;
  purchaseCost: string;
  setPurchaseCost: (val: string) => void;
  prodWeight: string;
  setProdWeight: (val: string) => void;
  prodStatus: 'ACTIVE' | 'INACTIVE';
  setProdStatus: (val: 'ACTIVE' | 'INACTIVE') => void;
  prodSupplierId: number | '';
  setProdSupplierId: (val: number | '') => void;
  prodSupplierUrl: string;
  setProdSupplierUrl: (val: string) => void;
  prodFulfillmentType: 'DELIVERY' | 'PREORDER';
  setProdFulfillmentType: (val: 'DELIVERY' | 'PREORDER') => void;
  prodAllowPreorder: boolean;
  setProdAllowPreorder: (val: boolean) => void;
  prodImageUrl: string;
  setProdImageUrl: (val: string) => void;
  prodMediaItems: ProductMediaItem[];
  newMediaType: 'IMAGE' | 'VIDEO';
  setNewMediaType: (val: 'IMAGE' | 'VIDEO') => void;
  newVideoDuration: string;
  setNewVideoDuration: (val: string) => void;
  uploadingImage: boolean;
  kitQuantityToBuild: string;
  setKitQuantityToBuild: (val: string) => void;
  selectedKitItems: Record<number, number>;
  reactivateStockInputs: Record<number, string>;
  setReactivateStockInputs: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  activatingProductId: number | null;
  suggestNextCode: (prefixLetter: string) => string;
  openNewProduct: () => void;
  openNewKit: () => void;
  openEditProduct: (prod: any) => void;
  toggleKitComponent: (productId: number, defaultQty?: number) => void;
  updateKitComponentQty: (productId: number, qty: number) => void;
  addMediaByUrl: () => void;
  removeMediaItem: (index: number) => void;
  setPrimaryMediaItem: (index: number) => void;
  handleImageFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleVideoFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSaveProduct: (e: React.FormEvent) => void;
  handleDisassembleKit: (kitProd: any) => void;
  handleActivateProductStock: (prod: any) => void;
}

export const AdminProductsSection: React.FC<AdminProductsSectionProps> = ({
  section,
  goToSection,
  products,
  productSearch, setProductSearch, productPage, setProductPage, productTotalCount, productTotalPages,
  productSort, setProductSort, productCategoryId, onProductCategoryChange,
  activeProductCount, inactiveProductCount, stockMinimum, setStockMinimum, onProductStatusChange,
  activeProductsList,
  inactiveProductsList,
  categories,
  supplierOptions,
  showProdForm,
  setShowProdForm,
  formMode,
  setFormMode,
  editingProd,
  prodCategoryId,
  setProdCategoryId,
  prodCode,
  setProdCode,
  prodName,
  setProdName,
  prodDesc,
  setProdDesc,
  prodPrice,
  setProdPrice,
  prodPromoPrice,
  setProdPromoPrice,
  prodPromoActive,
  setProdPromoActive,
  prodPromoDays,
  setProdPromoDays,
  prodPromoHours,
  setProdPromoHours,
  prodPromoMinutes,
  setProdPromoMinutes,
  prodPromoLimitEnabled,
  setProdPromoLimitEnabled,
  prodPromoMaxUnits,
  setProdPromoMaxUnits,
  prodCost,
  setProdCost,
  prodCostMode,
  setProdCostMode,
  prodCostLotUnits,
  setProdCostLotUnits,
  prodStock,
  setProdStock,
  purchaseCostMode,
  setPurchaseCostMode,
  purchaseCost,
  setPurchaseCost,
  prodWeight,
  setProdWeight,
  prodStatus,
  setProdStatus,
  prodSupplierId, setProdSupplierId, prodSupplierUrl, setProdSupplierUrl,
  prodFulfillmentType, setProdFulfillmentType, prodAllowPreorder, setProdAllowPreorder,
  prodImageUrl,
  setProdImageUrl,
  prodMediaItems,
  newMediaType,
  setNewMediaType,
  newVideoDuration,
  setNewVideoDuration,
  uploadingImage,
  kitQuantityToBuild,
  setKitQuantityToBuild,
  selectedKitItems,
  reactivateStockInputs,
  setReactivateStockInputs,
  activatingProductId,
  suggestNextCode,
  openNewProduct,
  openNewKit,
  openEditProduct,
  toggleKitComponent,
  updateKitComponentQty,
  addMediaByUrl,
  removeMediaItem,
  setPrimaryMediaItem,
  handleImageFileUpload,
  handleVideoFileUpload,
  handleSaveProduct,
  handleDisassembleKit,
  handleActivateProductStock,
}) => {
  const [searchDraft, setSearchDraft] = useState(productSearch);
  useEffect(() => setSearchDraft(productSearch), [productSearch]);
  useEffect(() => {
    if (searchDraft === productSearch) return;
    const timer = setTimeout(() => { setProductSearch(searchDraft); setProductPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [searchDraft, productSearch, setProductSearch, setProductPage]);

  const currentPhotosCount = prodMediaItems.filter((m) => m.mediaType !== 'VIDEO').length;
  const currentVideosCount = prodMediaItems.filter((m) => m.mediaType === 'VIDEO').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            {section === 'INACTIVE_PRODUCTS'
              ? 'Produtos Inativos & Estoque Zerado'
              : 'Cadastro de Produtos & Montagem de Kits'}
          </h1>
          <p className="text-xs text-zinc-500">
            {section === 'INACTIVE_PRODUCTS'
              ? 'Quando um produto zera o estoque, ele some automaticamente da vitrine e aparece nesta aba para você repor o estoque e deixá-lo ativo novamente.'
              : 'Cadastre o código (1 letra e até 3 números), ative valores promocionais na vitrine ou monte kits descontando automaticamente do estoque dos produtos.'}
          </p>
        </div>
        {!showProdForm && (
          <div className="flex flex-wrap items-center gap-2 self-start">
            <button
              type="button"
              onClick={openNewProduct}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Produto</span>
            </button>
            <button
              type="button"
              onClick={openNewKit}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-zinc-900 bg-stone-200 hover:bg-stone-300 rounded-lg transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Montar Kit</span>
            </button>
          </div>
        )}
      </div>

      {/* Abas superiores: Produtos Ativos na Vitrine vs Produtos Inativos */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 pb-3">
        <button
          type="button"
          onClick={() => goToSection('PRODUCTS')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
            section === 'PRODUCTS'
              ? 'bg-zinc-900 text-white'
              : 'bg-white border border-stone-200 text-zinc-700 hover:bg-stone-100'
          }`}
        >
          Produtos Ativos na Vitrine ({activeProductCount})
        </button>
        <button
          type="button"
          onClick={() => goToSection('INACTIVE_PRODUCTS')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
            section === 'INACTIVE_PRODUCTS'
              ? 'bg-zinc-900 text-white'
              : 'bg-white border border-stone-200 text-zinc-700 hover:bg-stone-100'
          }`}
        >
          <span>Produtos Inativos ({inactiveProductCount})</span>
          {inactiveProductCount > 0 && section !== 'INACTIVE_PRODUCTS' && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-600 text-white tabular-nums">
              {inactiveProductsList.length}
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Buscar por código, nome ou descrição" className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm" /></label>
        <select aria-label="Filtrar produtos por categoria" value={productCategoryId} onChange={(e) => onProductCategoryChange(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="">Todas as categorias</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}</select>
        <select aria-label="Ordenar produtos" value={productSort} onChange={(e) => setProductSort(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="newest">Mais recentes</option><option value="name_asc">Nome A–Z</option><option value="name_desc">Nome Z–A</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="stock_asc">Menor estoque</option></select>
        <span className="whitespace-nowrap text-xs text-zinc-500">{productTotalCount} produto(s) · página {productPage} de {Math.max(productTotalPages, 1)}</span>
        <div className="flex gap-2"><button type="button" disabled={productPage <= 1} onClick={() => setProductPage(productPage - 1)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Anterior</button><button type="button" disabled={productPage >= productTotalPages} onClick={() => setProductPage(productPage + 1)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Próxima</button></div>
      </div>

      {showProdForm && (
        <form
          onSubmit={handleSaveProduct}
          className="bg-white border border-stone-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-zinc-900">
                {editingProd
                  ? `Editar ${editingProd.isKit ? 'Kit' : 'Produto'}: ${editingProd.code} - ${
                      editingProd.name
                    }`
                  : formMode === 'KIT'
                  ? 'Montar Novo Kit de Produtos'
                  : 'Cadastrar Novo Produto'}
              </h2>
              <p className="text-xs text-zinc-500">
                {formMode === 'KIT' && !editingProd
                  ? 'Escolha os produtos da loja e a quantidade por kit. O saldo será descontado do estoque de cada produto.'
                  : 'O código aparece na frente do nome na vitrine, nos pedidos e no WhatsApp para facilitar a separação.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!editingProd && (
                <div className="inline-flex p-1 bg-stone-100 border border-stone-200 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setFormMode('PRODUCT');
                      if (prodCode.startsWith('K')) setProdCode(suggestNextCode('P'));
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                      formMode === 'PRODUCT'
                        ? 'bg-zinc-900 text-white'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Produto Individual
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormMode('KIT');
                      if (!prodCode.startsWith('K')) setProdCode(suggestNextCode('K'));
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                      formMode === 'KIT'
                        ? 'bg-zinc-900 text-white'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Montar Kit
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowProdForm(false)}
                className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 bg-stone-100 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>

          {/* Linha 1: Código (1 letra e até 3 números), Nome e Categoria */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            <div className="sm:col-span-3 space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Código (1 letra + até 3 núm.)
              </label>
              <input
                type="text"
                required
                maxLength={4}
                value={prodCode}
                onChange={(e) => setProdCode(e.target.value.toUpperCase())}
                placeholder="Ex: A001"
                className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono font-bold uppercase"
              />
              <span className="block text-[11px] text-zinc-500">
                Ex: E001, S010, K001 (aparece na vitrine e WhatsApp)
              </span>
            </div>

            <div className="sm:col-span-6 space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                {formMode === 'KIT' ? 'Nome do Kit' : 'Nome do Produto'}
              </label>
              <input
                type="text"
                required
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                placeholder={
                  formMode === 'KIT'
                    ? 'Ex: Kit 10 Sacos de Lixo Reforçados'
                    : 'Ex: Saco de Lixo Reforçado 100L'
                }
                className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
              />
              <span className="block text-[11px] text-zinc-500">
                Exibição na loja e pedidos:{' '}
                <strong className="font-mono text-zinc-800">
                  {prodCode || 'A001'} - {prodName || 'Nome do Produto'}
                </strong>
              </span>
            </div>

            <div className="sm:col-span-3 space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">Categoria</label>
              <select
                required
                value={prodCategoryId}
                onChange={(e) => setProdCategoryId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
              >
                <option value="" disabled>
                  Selecione...
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {formMode === 'PRODUCT' && (
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-12">
              <div className="space-y-1 sm:col-span-4"><label className="block text-xs font-semibold text-zinc-700">Fornecedor</label><select value={prodSupplierId} onChange={(e) => setProdSupplierId(e.target.value ? Number(e.target.value) : '')} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"><option value="">Sem fornecedor</option>{supplierOptions.filter((supplier) => supplier.status !== 'INACTIVE').map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
              <div className="space-y-1 sm:col-span-4"><label className="block text-xs font-semibold text-zinc-700">Link no fornecedor</label><input type="url" placeholder="https://..." value={prodSupplierUrl} onChange={(e) => setProdSupplierUrl(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" /></div>
              <div className="space-y-1 sm:col-span-4"><label className="block text-xs font-semibold text-zinc-700">Tipo inicial</label><select value={prodFulfillmentType} onChange={(e) => setProdFulfillmentType(e.target.value as 'DELIVERY' | 'PREORDER')} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"><option value="DELIVERY">Delivery</option><option value="PREORDER">Encomenda</option></select></div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-700 sm:col-span-12"><input type="checkbox" checked={prodAllowPreorder} onChange={(e) => setProdAllowPreorder(e.target.checked)} className="h-4 w-4 accent-zinc-900" />Permitir encomenda quando acabar</label>
              <p className="text-[11px] text-zinc-500 sm:col-span-12">O saldo decide a modalidade na vitrine. A opção controla apenas se o produto pode continuar ativo quando o saldo chegar a zero.</p>
            </div>
          )}

          {/* Seção de Seleção de Produtos para Montar Kit (Requisito 3) */}
          {formMode === 'KIT' && (
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">
                    Selecione os Produtos da Loja para Montar o Kit
                  </h3>
                  <p className="text-xs text-zinc-600">
                    Marque os produtos exibidos pela busca, filtros e paginação do catálogo acima e
                    informe quantas unidades vão dentro do kit. O estoque será descontado automaticamente;
                    limpe os filtros para localizar outros componentes.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-xs font-semibold text-zinc-800">
                    Qtd. de Kits a montar:
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={kitQuantityToBuild}
                    onChange={(e) => setKitQuantityToBuild(e.target.value)}
                    className="w-20 px-2.5 py-1.5 text-sm font-mono font-bold bg-white border border-stone-300 rounded-lg text-center"
                  />
                </div>
              </div>

              <div className="divide-y divide-stone-200 bg-white border border-stone-200 rounded-lg max-h-72 overflow-y-auto">
                {products
                  .filter((p) => !p.isKit)
                  .map((prod) => {
                    const isSelected = selectedKitItems[prod.id] !== undefined;
                    const qtyPerKit = selectedKitItems[prod.id] || 1;
                    const kitsCountNum = Math.max(
                      1,
                      Math.floor(Number(kitQuantityToBuild) || 1)
                    );
                    const totalToDeduct = qtyPerKit * kitsCountNum;
                    const remainingStock = prod.stock - totalToDeduct;

                    return (
                      <div
                        key={prod.id}
                        className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isSelected ? 'bg-emerald-50/40' : 'hover:bg-stone-50'
                        }`}
                      >
                        <label className="flex items-center gap-3 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={prod.stock <= 0 && !isSelected}
                            onChange={() => toggleKitComponent(prod.id, 10)}
                            className="w-4 h-4 accent-zinc-900 rounded"
                          />
                          <div className="space-y-0.5 text-xs">
                            <div className="font-semibold text-zinc-900">
                              <span className="font-mono font-bold text-zinc-800">
                                {prod.code}
                              </span>{' '}
                              - {prod.name}
                            </div>
                            <div className="text-zinc-500 tabular-nums">
                              Estoque atual na vitrine:{' '}
                              <strong className="text-zinc-800">{prod.stock} un.</strong> · Preço
                              unitário: {formatCurrency(prod.effectivePrice || prod.price)}
                            </div>
                          </div>
                        </label>

                        {isSelected && (
                          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-zinc-700">
                                Unidades por Kit:
                              </span>
                              <input
                                type="number"
                                min="1"
                                max={prod.stock}
                                value={qtyPerKit}
                                onChange={(e) =>
                                  updateKitComponentQty(prod.id, Number(e.target.value))
                                }
                                className="w-20 px-2.5 py-1 text-xs font-mono font-bold bg-white border border-stone-300 rounded-md text-center"
                              />
                            </div>

                            <div
                              className={`text-xs font-mono px-2.5 py-1 rounded border tabular-nums ${
                                remainingStock < 0
                                  ? 'bg-red-50 border-red-200 text-red-700 font-bold'
                                  : 'bg-white border-stone-200 text-emerald-800 font-semibold'
                              }`}
                            >
                              {remainingStock < 0
                                ? `Saldo insuficiente (Faltam ${Math.abs(remainingStock)} un.)`
                                : `Tira ${totalToDeduct} un. → Fica ${remainingStock} un. na vitrine`}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Linha 2: Valor Normal, Valor Promocional e Chave Liga/Desliga Promoção (Requisito 1) */}
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-zinc-900">
                  Preços & Valor Promocional na Vitrine
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Quando o valor promocional estiver ligado e preenchido, ele aparece em destaque na
                  vitrine com o valor normal riscado. Se vazio ou desligado, aparece apenas o valor
                  normal.
                </p>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-white border border-stone-200">
                <input
                  type="checkbox"
                  checked={prodPromoActive}
                  onChange={(e) => setProdPromoActive(e.target.checked)}
                  className="w-4 h-4 accent-emerald-700 rounded"
                />
                <span className="text-xs font-semibold text-zinc-900">
                  {prodPromoActive ? 'Promoção Ligada na Vitrine' : 'Promoção Desligada'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">
                  Valor Normal de Venda (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={prodPrice}
                  onChange={(e) => setProdPrice(e.target.value)}
                  placeholder="Ex: 89.90"
                  className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">
                  Valor Promocional (R$) — opcional
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={prodPromoPrice}
                  onChange={(e) => {
                    setProdPromoPrice(e.target.value);
                    if (e.target.value.trim() !== '' && !prodPromoActive) {
                      setProdPromoActive(true);
                    }
                  }}
                  placeholder="Ex: 69.90 (deixe vazio se sem promoção)"
                  className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-white border border-stone-200 text-xs">
                <div className="text-[11px] text-zinc-500 mb-0.5">
                  Como vai aparecer na vitrine:
                </div>
                {prodPromoActive &&
                prodPromoPrice.trim() !== '' &&
                parseFloat(prodPromoPrice) > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-zinc-400 line-through tabular-nums">
                      {formatCurrency(prodPrice || 0)}
                    </span>
                    <span className="font-bold text-emerald-700 tabular-nums">
                      {formatCurrency(prodPromoPrice)}
                    </span>
                    {calculateDiscountPercent(prodPrice, prodPromoPrice, true) > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold text-white bg-emerald-700 rounded">
                        -{calculateDiscountPercent(prodPrice, prodPromoPrice, true)}% OFF na foto
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="font-semibold text-zinc-900 tabular-nums">
                    {formatCurrency(prodPrice || 0)}{' '}
                    <span className="text-[11px] font-normal text-zinc-500">
                      (apenas valor normal)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Campo de Tempo de Duração da Promoção (Requisito 2: aparece ao colocar em promoção) */}
            {(prodPromoActive || prodPromoPrice.trim() !== '') && (
              <div className="pt-3 border-t border-stone-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900">
                      Quanto tempo vai durar a promoção?
                    </h4>
                    <p className="text-[11px] text-zinc-500">
                      O cronômetro regressivo aparecerá diminuindo em tempo real no produto na
                      vitrine.
                    </p>
                  </div>

                  {/* Atalhos rápidos de duração */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { label: '2 horas', d: '0', h: '2', m: '0' },
                      { label: '6 horas', d: '0', h: '6', m: '0' },
                      { label: '12 horas', d: '0', h: '12', m: '0' },
                      { label: '24h (1 dia)', d: '1', h: '0', m: '0' },
                      { label: '48h (2 dias)', d: '2', h: '0', m: '0' },
                      { label: '7 dias', d: '7', h: '0', m: '0' },
                    ].map((preset) => {
                      const isCurrent =
                        prodPromoDays === preset.d &&
                        prodPromoHours === preset.h &&
                        prodPromoMinutes === preset.m;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setProdPromoDays(preset.d);
                            setProdPromoHours(preset.h);
                            setProdPromoMinutes(preset.m);
                            if (!prodPromoActive) setProdPromoActive(true);
                          }}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                            isCurrent
                              ? 'bg-zinc-900 text-white border-zinc-900'
                              : 'bg-white text-zinc-700 border-stone-300 hover:bg-stone-100'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="block text-[11px] font-semibold text-zinc-700">Dias</label>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={prodPromoDays}
                      onChange={(e) => setProdPromoDays(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-stone-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <label className="block text-[11px] font-semibold text-zinc-700">Horas</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={prodPromoHours}
                      onChange={(e) => setProdPromoHours(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-stone-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <label className="block text-[11px] font-semibold text-zinc-700">
                      Minutos
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={prodPromoMinutes}
                      onChange={(e) => setProdPromoMinutes(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-stone-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <PromoCountdown
                      promoEndsAt={
                        new Date(
                          Date.now() +
                            Math.max(
                              1,
                              (Number(prodPromoDays) || 0) * 1440 +
                                (Number(prodPromoHours) || 0) * 60 +
                                (Number(prodPromoMinutes) || 0)
                            ) *
                              60000
                        )
                      }
                    />
                  </div>
                </div>

                {/* Limite de produtos a ser comprado na promoção (Requisito 2) */}
                <div className="pt-3 border-t border-stone-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-zinc-900">
                        Máximo de unidades em oferta por cliente em cada pedido (vazio/desligado = sem limite)
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        Se ativado, o cliente só pode comprar até a quantidade limite pelo valor promocional; as unidades excedentes são cobradas pelo valor normal do produto.
                      </p>
                    </div>

                    <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-white border border-stone-200 shrink-0">
                      <input
                        type="checkbox"
                        checked={prodPromoLimitEnabled}
                        onChange={(e) => {
                          setProdPromoLimitEnabled(e.target.checked);
                          if (e.target.checked && !prodPromoMaxUnits) {
                            setProdPromoMaxUnits('5');
                          }
                        }}
                        className="w-4 h-4 accent-emerald-700 rounded"
                      />
                      <span className="text-xs font-semibold text-zinc-900">
                        {prodPromoLimitEnabled
                          ? 'Limite na Promoção Ativado'
                          : 'Limitar qtd. na promoção'}
                      </span>
                    </label>
                  </div>

                  {prodPromoLimitEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 rounded-lg bg-emerald-50/70 border border-emerald-200">
                      <div className="sm:col-span-3 space-y-1">
                        <label className="block text-[11px] font-semibold text-emerald-950">
                          Máximo de unidades em oferta por pedido
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          required={prodPromoLimitEnabled}
                          value={prodPromoMaxUnits}
                          onChange={(e) => setProdPromoMaxUnits(e.target.value)}
                          placeholder="Ex: 5"
                          className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-emerald-300 rounded-lg"
                        />
                      </div>

                      <div className="sm:col-span-4 space-y-1">
                        <span className="block text-[11px] font-semibold text-emerald-950">
                          Atalhos rápidos:
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {['2', '3', '5', '10'].map((numStr) => (
                            <button
                              key={numStr}
                              type="button"
                              onClick={() => setProdPromoMaxUnits(numStr)}
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                                prodPromoMaxUnits === numStr
                                  ? 'bg-emerald-800 text-white border-emerald-800'
                                  : 'bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                              }`}
                            >
                              Até {numStr} un.
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="sm:col-span-5 text-xs text-emerald-950 bg-white/90 border border-emerald-200 rounded-lg p-2.5">
                        <div className="text-[10px] font-bold uppercase text-emerald-800 mb-0.5">
                          Aviso exibido ao cliente:
                        </div>
                        <div className="font-medium leading-snug">
                          {Number.isSafeInteger(Number(prodPromoMaxUnits)) && Number(prodPromoMaxUnits) > 0 ? <>&ldquo;Só é permitido comprar{' '}
                            <strong>{Number(prodPromoMaxUnits)}</strong>{' '}
                            {Number(prodPromoMaxUnits) === 1 ? 'unidade' : 'unidades'}{' '}
                            em oferta por pedido ({formatCurrency(prodPromoPrice || 0)}), acima segue o valor normal ({formatCurrency(prodPrice || 0)}).&rdquo;</> : <span className="text-red-700">Informe um número inteiro maior que zero para o limite.</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Linha 3: Custo, Estoque, Peso e Status */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2 space-y-2">
              {formMode === 'PRODUCT' && <fieldset className="space-y-1">
                <legend className="block text-xs font-semibold text-zinc-700">Informar custo:</legend>
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5"><input type="radio" name="cost-mode" checked={prodCostMode === 'unit'} onChange={() => setProdCostMode('unit')} />Por unidade</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" name="cost-mode" checked={prodCostMode === 'lot'} onChange={() => setProdCostMode('lot')} />Total do lote</label>
                </div>
              </fieldset>}
              <label className="block text-xs font-semibold text-zinc-700">
                {formMode === 'KIT' || prodCostMode === 'unit' ? 'Custo de Compra por unidade (R$)' : 'Custo total do lote (R$)'}
                <input type="number" step="0.01" min="0" value={prodCost} onChange={(e) => setProdCost(e.target.value)} placeholder={prodCostMode === 'lot' ? 'Ex: 19.99' : 'Ex: 6.50'} className="mt-1 w-full px-3 py-2 text-sm bg-sky-50/50 border border-sky-300 rounded-lg font-mono font-bold text-sky-950 focus:ring-2 focus:ring-[#087BFF]" />
              </label>
              {formMode === 'PRODUCT' && prodCostMode === 'lot' && <label className="block text-xs font-semibold text-zinc-700">
                Quantidade de unidades do lote
                <input type="number" min="1" step="1" value={prodCostLotUnits} onChange={(e) => setProdCostLotUnits(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono" />
                <span className="mt-1 block text-[10px] text-zinc-500">Custo por unidade: {formatCurrency((Number(String(prodCost || 0).replace(',', '.')) || 0) / Math.max(1, Number(prodCostLotUnits) || Number(prodStock) || 1))} (total ÷ unidades).</span>
              </label>}
              {prodCostMode === 'unit' && <span className="text-[10px] text-zinc-500">Quanto pagou por uma unidade.</span>}
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-950">
                Alterar este custo apenas atualiza o custo cadastrado e não adiciona unidades ao estoque. O estoque só muda quando o saldo atual for alterado e confirmado como uma nova entrada.
              </p>
            </div>

            {!(!editingProd && formMode === 'KIT') && <>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">Estoque atual (un.)</label>
                <input type="number" step="1" min="0" required value={prodStock} onChange={(e) => setProdStock(e.target.value)} className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono" />
                {editingProd && <span className="text-[10px] text-zinc-500">Aumentos de saldo podem registrar o custo da nova compra; reduções mantêm o custo médio.</span>}
              </div>
              {editingProd && formMode === 'PRODUCT' && Number(prodStock) > Number(editingProd.stock) && <div className="col-span-2 sm:col-span-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                <p className="font-bold">Essas {Number(prodStock) - Number(editingProd.stock)} unidades novas foram compradas por quanto?</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={purchaseCostMode === 'same'} onChange={() => setPurchaseCostMode('same')} />Mesmo custo atual (padrão)</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={purchaseCostMode === 'unit'} onChange={() => setPurchaseCostMode('unit')} />Outro custo por unidade</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={purchaseCostMode === 'lot'} onChange={() => setPurchaseCostMode('lot')} />Total desta compra</label>
                </div>
                {purchaseCostMode !== 'same' && <label className="mt-3 block max-w-xs font-semibold">{purchaseCostMode === 'lot' ? 'Total pago nesta compra (R$)' : 'Custo por unidade (R$)'}<input type="number" min="0" step="0.01" required value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} className="mt-1 w-full rounded-lg border border-sky-300 bg-white px-3 py-2 font-mono" /></label>}
              </div>}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-700">Alerta de estoque mínimo</label>
                <input type="number" step="1" min="0" max="1000000" required value={stockMinimum} onChange={(e) => setStockMinimum(e.target.value)} className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono" />
                <span className="text-[10px] text-zinc-500">Alerta quando o saldo for igual ou inferior.</span>
              </div>
            </>}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">Peso (kg)</label>
              <input type="number" step="0.001" min="0" value={prodWeight} onChange={(e) => setProdWeight(e.target.value)} className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">Status</label>
              <select value={prodStatus} onChange={(e) => setProdStatus(e.target.value as 'ACTIVE' | 'INACTIVE')} className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select>
            </div>
          </div>

          {/* Simulador puro: recalcula ambos os cenários com custo unitário preciso. */}
          {(() => {
            const enteredCost = Number(String(prodCost || '0').replace(',', '.')) || 0;
            const lotUnits = Math.max(1, Number(prodCostLotUnits) || Number(prodStock) || 1);
            const result = simulateProfit({
              normalPrice: prodPrice,
              promoPrice: prodPromoPrice,
              hasPromo: prodPromoActive,
              cost: enteredCost,
              costMode: formMode === 'PRODUCT' ? prodCostMode : 'unit',
              lotUnits,
              stock: prodStock,
              promoMaxUnits: prodPromoLimitEnabled ? prodPromoMaxUnits : null,
            });
            const valueClass = (value: number) => value < 0 ? 'text-red-700' : value > 0 ? 'text-emerald-700' : 'text-zinc-800';
            const card = (label: string, item: typeof result.normal) => <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
              <h4 className="text-sm font-bold text-zinc-900">{label}</h4>
              <div className="grid grid-cols-2 gap-y-1 text-xs"><span>Preço de venda</span><strong className="text-right">{formatCurrency(item.salePrice)}</strong><span>Custo por unidade</span><strong className="text-right">{result.hasCost ? formatCurrency(result.costUnitDisplay) : 'Não informado'}</strong><span>Lucro por unidade</span><strong className={`text-right ${valueClass(item.unitProfit)}`}>{formatCurrency(item.unitProfit)}</strong><span>Margem</span><strong className={`text-right ${valueClass(item.unitProfit)}`}>{result.hasCost ? `${item.marginPercent.toFixed(1)}%` : '—'}</strong><span>Receita se vender todo o estoque ({item.stockUnits} un.)</span><strong className="text-right">{formatCurrency(item.stockRevenue)}</strong><span className="font-bold">Lucro no estoque</span><strong className={`text-right font-bold ${valueClass(item.stockProfit)}`}>{formatCurrency(item.stockProfit)} ({item.stockUnits} un.)</strong></div>
              {result.hasCost && item.salePrice < item.unitCost && item.stockUnits > 0 && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-800">Atenção: o custo por unidade ({formatCurrency(result.costUnitDisplay)}) é maior que {label === 'Preço promocional' ? 'o preço promocional' : 'o preço normal'} ({formatCurrency(item.salePrice)}). Cada unidade vendida dá prejuízo de {formatCurrency(item.unitProfit)}; vendendo as {item.stockUnits} un. o prejuízo total será {formatCurrency(item.stockProfit)}.</p>}
              {result.hasCost && item.salePrice === item.unitCost && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-900">Custo igual ao preço: lucro zero.</p>}
              {label === 'Preço promocional' && result.promoMaxUnits && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">Oferta limitada a {result.promoMaxUnits} un. por pedido; as demais unidades de cada pedido saem pelo preço normal.</p>}
            </div>;
            return <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 space-y-3" aria-label="Simulador de lucro e margem">
              <div><h3 className="text-sm font-extrabold text-sky-950">Simulador de Lucro & Margem</h3><p className="text-[11px] text-zinc-600">Cenário de venda de todo o estoque a um único preço, sem estimar divisão de vendas. {result.hasCost && prodCostMode === 'lot' && `Custo por unidade: ${formatCurrency(result.costUnitDisplay)} (${formatCurrency(enteredCost)} ÷ ${lotUnits}).`}</p></div>
              {!result.hasCost ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Informe o custo de compra para calcular lucros, margens e prejuízos.</p> : <div className={`grid gap-3 ${result.promo ? 'md:grid-cols-2' : 'grid-cols-1'}`}>{card('Preço normal', result.normal)}{result.promo && card('Preço promocional', result.promo)}</div>}
            </section>;
          })()}

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Descrição (opcional — para kits, é gerada automaticamente se deixada em branco)
            </label>
            <textarea
              rows={2}
              value={prodDesc}
              onChange={(e) => setProdDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>

          {/* Galeria de Mídias do Produto: até 5 fotos e/ou 1 vídeo de até 30 segundos (Requisito 3) */}
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-xs font-bold text-zinc-900">
                  Fotos & Vídeo do Produto (Rolar para o lado na Vitrine)
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Adicione <strong>até 5 fotos</strong> do produto ou{' '}
                  <strong>1 vídeo de até 30 segundos</strong>. Na vitrine, o cliente pode rolar
                  para o lado para ver todas as fotos e o vídeo.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono">
                <span
                  className={`px-2.5 py-1 rounded border font-semibold ${
                    currentPhotosCount >= 5
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-white border-stone-200 text-zinc-800'
                  }`}
                >
                  Fotos: {currentPhotosCount}/5
                </span>
                <span
                  className={`px-2.5 py-1 rounded border font-semibold ${
                    currentVideosCount >= 1
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-white border-stone-200 text-zinc-800'
                  }`}
                >
                  Vídeo (≤30s): {currentVideosCount}/1
                </span>
              </div>
            </div>

            {/* Upload Buttons for Photos (up to 5) and Video (up to 30s) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                  currentPhotosCount >= 5
                    ? 'bg-stone-100 text-zinc-400 border-stone-200 cursor-not-allowed'
                    : 'bg-white hover:bg-stone-100 text-zinc-900 border-stone-300 cursor-pointer'
                }`}
              >
                <ImageIcon className="w-4 h-4 text-zinc-700" />
                <span>
                  {uploadingImage
                    ? 'Enviando mídia...'
                    : `Enviar Foto(s) do Computador/Celular (${currentPhotosCount}/5)`}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={currentPhotosCount >= 5 || uploadingImage}
                  onChange={handleImageFileUpload}
                  className="hidden"
                />
              </label>

              <label
                className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                  currentVideosCount >= 1
                    ? 'bg-stone-100 text-zinc-400 border-stone-200 cursor-not-allowed'
                    : 'bg-white hover:bg-stone-100 text-zinc-900 border-stone-300 cursor-pointer'
                }`}
              >
                <Film className="w-4 h-4 text-emerald-700" />
                <span>
                  {uploadingImage
                    ? 'Validando vídeo...'
                    : `Enviar Vídeo de até 30 Segundos (${currentVideosCount}/1)`}
                </span>
                <input
                  type="file"
                  accept="video/*"
                  disabled={currentVideosCount >= 1 || uploadingImage}
                  onChange={handleVideoFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Or Add by URL */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end pt-1">
              <div className="sm:col-span-3 space-y-1">
                <label className="block text-[11px] font-semibold text-zinc-700">
                  Tipo de Mídia por URL
                </label>
                <select
                  value={newMediaType}
                  onChange={(e) => setNewMediaType(e.target.value as 'IMAGE' | 'VIDEO')}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-stone-300 rounded-lg"
                >
                  <option value="IMAGE">Foto (Imagem)</option>
                  <option value="VIDEO">Vídeo (até 30s)</option>
                </select>
              </div>

              <div
                className={`${
                  newMediaType === 'VIDEO' ? 'sm:col-span-5' : 'sm:col-span-7'
                } space-y-1`}
              >
                <label className="block text-[11px] font-semibold text-zinc-700">
                  Caminho da {newMediaType === 'VIDEO' ? 'Mídia de Vídeo' : 'Foto'} (somente upload do painel)
                </label>
                <input
                  type="text"
                  value={prodImageUrl}
                  onChange={(e) => setProdImageUrl(e.target.value)}
                  placeholder={
                    newMediaType === 'VIDEO'
                      ? '/api/storage/... (use o botão de upload)'
                      : '/api/storage/... (use o botão de upload)'
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg"
                />
              </div>

              {newMediaType === 'VIDEO' && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="block text-[11px] font-semibold text-zinc-700">
                    Duração (seg ≤30)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={newVideoDuration}
                    onChange={(e) => setNewVideoDuration(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-stone-300 rounded-lg"
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={addMediaByUrl}
                  className="w-full px-3 py-2 text-xs font-semibold text-zinc-900 bg-stone-200 hover:bg-stone-300 rounded-lg transition-colors"
                >
                  + Adicionar
                </button>
              </div>
            </div>

            {/* Preview Grid of Added Photos & Video */}
            {prodMediaItems.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
                {prodMediaItems.map((media, idx) => (
                  <div
                    key={`${media.imageUrl}-${idx}`}
                    className="bg-white border border-stone-200 rounded-lg overflow-hidden flex flex-col justify-between"
                  >
                    <div className="relative aspect-square bg-stone-100 overflow-hidden">
                      {media.mediaType === 'VIDEO' ? (
                        <video
                          src={media.imageUrl}
                          className="w-full h-full object-cover bg-zinc-900"
                          muted
                          playsInline
                        />
                      ) : (
                        <ProductImage
                          src={media.imageUrl}
                          alt={`Mídia ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-zinc-900/80 text-white rounded">
                        {idx === 0
                          ? '1ª Capa'
                          : `${idx + 1}ª ${media.mediaType === 'VIDEO' ? 'Vídeo' : 'Foto'}`}
                      </span>
                      {media.mediaType === 'VIDEO' && (
                        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-emerald-700 text-white rounded">
                          Vídeo {media.durationSeconds ? `${media.durationSeconds}s` : '≤30s'}
                        </span>
                      )}
                    </div>

                    <div className="p-1.5 flex items-center justify-between gap-1 bg-white border-t border-stone-100">
                      {idx !== 0 ? (
                        <button
                          type="button"
                          onClick={() => setPrimaryMediaItem(idx)}
                          className="text-[10px] font-semibold text-zinc-600 hover:text-zinc-900"
                        >
                          Definir Capa
                        </button>
                      ) : (
                        <span className="text-[10px] font-semibold text-emerald-700">
                          Principal
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMediaItem(idx)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                        title="Remover mídia"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              {editingProd
                ? 'Salvar Alterações'
                : formMode === 'KIT'
                ? 'Confirmar e Montar Kit (Descontar do Estoque)'
                : 'Salvar Produto'}
            </button>
          </div>
        </form>
      )}

      {section === 'PRODUCTS' ? (
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-zinc-500 bg-stone-50 text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold">Código & Produto</th>
                <th className="py-3 px-4 font-semibold">Categoria</th>
                <th className="py-3 px-4 font-semibold text-right">Preço Venda</th>
                <th className="py-3 px-4 font-semibold text-right">Custo Unitário</th>
                <th className="py-3 px-4 font-semibold text-right text-emerald-800">Lucro / Un.</th>
                <th className="py-3 px-4 font-semibold text-right text-emerald-800">Margem (%)</th>
                <th className="py-3 px-4 font-semibold text-right text-sky-900">Lucro Estoque</th>
                <th className="py-3 px-4 font-semibold text-center">Estoque</th>
                <th className="py-3 px-4 font-semibold text-center">Interações</th>
                <th className="py-3 px-4 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {activeProductsList.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 px-4 text-center text-zinc-500">
                    Nenhum produto ativo com estoque disponível no momento. Confira a aba{' '}
                    <button
                      type="button"
                      onClick={() => goToSection('INACTIVE_PRODUCTS')}
                      className="font-semibold text-zinc-900 underline"
                    >
                      Produtos Inativos
                    </button>
                    .
                  </td>
                </tr>
              ) : (
                activeProductsList.map((p) => {
                  const simulation = simulateProfit({ normalPrice: p.price, promoPrice: p.promoPrice, hasPromo: p.hasPromo, cost: p.costUnitPrecise ?? p.cost, stock: p.stock, promoMaxUnits: p.promoMaxUnits });
                  const costPrice = simulation.costUnitDisplay;
                  const hasCost = simulation.hasCost;
                  const salePrice = simulation.promo?.salePrice ?? simulation.normal.salePrice;
                  const profit = simulation.promo?.unitProfit ?? simulation.normal.unitProfit;
                  const margin = simulation.promo?.marginPercent ?? simulation.normal.marginPercent;
                  const stockProfit = simulation.normal.stockProfit;
                  const promoStockProfit = simulation.promo?.stockProfit ?? null;
                  const isZeroProfit = hasCost && profit === 0;
                  const isLoss = hasCost && profit < 0;

                  return (
                    <tr key={p.id} className="hover:bg-stone-50/70">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-stone-100 border border-stone-200 overflow-hidden shrink-0">
                            <ProductImage src={p.imageUrl} alt={`${p.code} - ${p.name}`} />
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-semibold text-zinc-900">
                              <span className="font-mono font-bold text-zinc-800 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 mr-1.5">
                                {p.code}
                              </span>
                              <span className="truncate">{p.name}</span>
                              {p.isKit && (
                                <span className="ml-2 text-[11px] font-bold text-emerald-800">
                                  · KIT
                                </span>
                              )}
                            </div>
                            {p.isKit && p.kitComponents && p.kitComponents.length > 0 ? (
                              <div className="space-y-0.5 text-[11px] font-medium">
                                <div className="text-emerald-800">
                                  Composição por kit:{' '}
                                  {p.kitComponents
                                    .map(
                                      (kc: any) =>
                                        `${kc.quantityPerKit}x ${kc.componentCode} - ${kc.componentName}`
                                    )
                                    .join(', ')}
                                </div>
                                <div className="text-zinc-600">
                                  Máximo montável agora: <strong>{p.maxBuildableKits ?? 0} kit(s)</strong>
                                </div>
                                {p.kitComponents.some((kc: any) => Number(kc.componentStock) < Number(kc.quantityPerKit)) && (
                                  <div role="alert" className="font-semibold text-red-700">
                                    Componente sem estoque suficiente; nova montagem está bloqueada.
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="max-w-xs">
                                <ExpandableDescription
                                  text={p.description}
                                  maxChars={65}
                                  className="text-[11px] text-zinc-500 leading-relaxed"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-600">{p.categoryName}</td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {p.hasPromo && p.promoPrice ? (
                          <div>
                            <div className="text-[11px] text-zinc-400 line-through">
                              {formatCurrency(p.price)}
                            </div>
                            <div className="font-bold text-emerald-700">
                              {formatCurrency(p.promoPrice)}
                            </div>
                            {p.discountPercent > 0 && (
                              <div className="text-[10px] font-mono font-bold text-emerald-800">
                                -{p.discountPercent}% OFF
                              </div>
                            )}
                            {p.promoMaxUnits && p.promoMaxUnits > 0 && (
                              <div className="text-[10px] font-semibold text-amber-800">
                                Máx. {p.promoMaxUnits} un. na promo
                              </div>
                            )}
                            {p.promoEndsAt && (
                              <div className="pt-1 flex justify-end">
                                <PromoCountdown promoEndsAt={p.promoEndsAt} compact />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-zinc-900">
                              {formatCurrency(p.price)}
                            </div>
                            {p.promoPrice && !p.promoActive && (
                              <div className="text-[10px] text-zinc-400">
                                Promo desligada ({formatCurrency(p.promoPrice)})
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Custo Unitário */}
                      <td className="py-3 px-4 text-right tabular-nums">
                        {hasCost ? (
                          <span className="font-mono text-zinc-600 font-semibold">
                            {formatCurrency(costPrice)}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            Sem custo
                          </span>
                        )}
                      </td>

                      {/* Lucro / Un. */}
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {!hasCost ? (
                          <span className="text-zinc-400 text-[11px]">Defina o custo</span>
                        ) : isZeroProfit ? (
                          <span className="text-red-700 font-bold text-xs" title="Custo igual ou maior que a venda">
                            R$ 0,00
                          </span>
                        ) : (
                          <span className="font-bold text-emerald-700">
                            + {formatCurrency(profit)}
                          </span>
                        )}
                      </td>

                      {/* Margem (%) */}
                      <td className="py-3 px-4 text-right tabular-nums font-mono">
                        {!hasCost ? <span className="text-zinc-400 text-[11px]">-</span> : <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${isLoss ? 'bg-red-100 text-red-800' : margin >= 50 ? 'bg-emerald-100 text-emerald-800' : margin >= 30 ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-zinc-700'}`}>{margin.toFixed(1)}%</span>}
                      </td>

                      {/* Lucro Estoque */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-sky-900 tabular-nums">
                        {!hasCost ? <span className="text-zinc-400 font-normal font-sans text-[11px]">Defina o custo</span> : <div className="space-y-0.5"><div className={stockProfit < 0 ? 'text-red-700' : 'text-sky-900'}>Normal: {formatCurrency(stockProfit)}</div>{promoStockProfit !== null && <div className={promoStockProfit < 0 ? 'text-red-700' : 'text-sky-900'}>Promo: {formatCurrency(promoStockProfit)}</div>}{p.stock === 0 && <div className="text-[10px] text-zinc-500">(0 un.)</div>}</div>}
                      </td>

                      {/* Estoque */}
                      <td className="py-3 px-4 text-center font-mono font-bold tabular-nums">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            p.stock <= 0
                              ? 'bg-red-100 text-red-700'
                              : p.stock <= Number(p.stockMinimum ?? 5)
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-stone-100 text-zinc-800'
                          }`}
                        >
                          {p.stock} / mín. {p.stockMinimum ?? 5} un.
                        </span>
                      </td>

                      {/* Interações */}
                      <td className="py-3 px-4 text-center tabular-nums">
                        <div className="inline-flex flex-col items-start gap-0.5 text-[11px] font-mono">
                          <span className="inline-flex items-center gap-1 text-zinc-700" title="Visualizações">
                            <span>👁️</span> <strong>{p.viewsCount || 0}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1 text-blue-700" title="Cliques na vitrine">
                            <span>👆</span> <strong>{p.clicksCount || 0}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1 text-emerald-800" title="Compartilhamentos">
                            <span>📢</span> <strong>{p.sharesCount || 0}</strong>
                          </span>
                        </div>
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditProduct(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:text-zinc-900 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>

                          <button type="button" onClick={() => onProductStatusChange(p, 'INACTIVE')} className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold hover:bg-stone-50">Inativar</button>
                          <button type="button" onClick={() => onProductStatusChange(p, 'ARCHIVED')} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-100"><Archive className="h-3.5 w-3.5" />Arquivar</button>
                          {p.isKit && (
                            <button
                              type="button"
                              onClick={() => handleDisassembleKit(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors"
                              title="Desfazer o kit e devolver os saldos para os produtos originais"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Desfazer Kit</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Requisito 1: Aba de Produtos Inativos (produtos com estoque zerado ou inativos, ocultos da vitrine) */
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">
                {section === 'PREORDER_STOCKOUT' ? 'Produtos sem estoque disponíveis para encomenda' : 'Produtos ocultos da vitrine por estoque zerado ou inativação'}
              </div>
              <p className="text-amber-900">
                {section === 'PREORDER_STOCKOUT'
                  ? 'Estes produtos continuam visíveis na vitrine como encomenda. O saldo pode ser reposto pela área de estoque.'
                  : 'Quando um produto zera o estoque, ele some automaticamente da vitrine e aparece nesta aba. Informe a nova quantidade de estoque abaixo e clique em '}{section !== 'PREORDER_STOCKOUT' && <>
                <strong>Ativar com Novo Estoque</strong> para deixá-lo ativo na vitrine
                imediatamente.</>}
              </p>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-zinc-500 bg-stone-50">
                  <th className="py-3 px-4 font-semibold">Código & Produto Inativo</th>
                  <th className="py-3 px-4 font-semibold">Categoria</th>
                  <th className="py-3 px-4 font-semibold text-right">Preço</th>
                  <th className="py-3 px-4 font-semibold text-right">Estoque Atual</th>
                  <th className="py-3 px-4 font-semibold text-center">Interações</th>
                  <th className="py-3 px-4 font-semibold">Situação</th>
                  <th className="py-3 px-4 font-semibold text-right">
                    Editar Estoque e Deixar Ativo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {inactiveProductsList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 px-4 text-center text-zinc-500">
                      Nenhum produto inativo ou com estoque zerado no momento! Todos os produtos
                      estão ativos na vitrine.
                    </td>
                  </tr>
                ) : (
                  inactiveProductsList.map((p) => {
                    const inputVal =
                      reactivateStockInputs[p.id] ?? (p.stock > 0 ? String(p.stock) : '10');
                    return (
                      <tr key={p.id} className="hover:bg-stone-50/70">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded bg-stone-100 border border-stone-200 overflow-hidden shrink-0 opacity-75">
                              <ProductImage src={p.imageUrl} alt={`${p.code} - ${p.name}`} />
                            </div>
                            <div className="space-y-0.5">
                              <div className="font-semibold text-zinc-900">
                                <span className="font-mono font-bold text-zinc-800 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 mr-1.5">
                                  {p.code}
                                </span>
                                <span>{p.name}</span>
                              </div>
                              <div className="text-[11px] text-red-700 font-medium">
                                {p.status === 'ARCHIVED' ? 'Arquivado (histórico preservado)' : p.stock <= 0 ? 'Estoque zerado (oculto da vitrine)' : 'Marcado como inativo (oculto da vitrine)'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-zinc-600">{p.categoryName}</td>
                        <td className="py-3 px-4 text-right font-semibold text-zinc-900 tabular-nums">
                          {formatCurrency(p.effectivePrice || p.price)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                          <span className="text-red-600">{p.stock} un.</span>
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">
                          <div className="inline-flex flex-col items-start gap-0.5 text-[11px] font-mono">
                            <span className="inline-flex items-center gap-1 text-zinc-700" title="Visualizações">
                              <span>👁️</span> <strong>{p.viewsCount || 0}</strong> views
                            </span>
                            <span className="inline-flex items-center gap-1 text-blue-700" title="Cliques na vitrine">
                              <span>👆</span> <strong>{p.clicksCount || 0}</strong> cliques
                            </span>
                            <span className="inline-flex items-center gap-1 text-emerald-800" title="Compartilhamentos">
                              <span>📢</span> <strong>{p.sharesCount || 0}</strong> shares
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-800 font-semibold text-[11px]">
                            {p.status === 'ARCHIVED' ? 'Arquivado' : 'Inativo'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-2">
                            <div className="inline-flex items-center gap-1.5">
                              <label
                                htmlFor={`reactivate-stock-${p.id}`}
                                className="text-[11px] font-medium text-zinc-600"
                              >
                                Novo estoque:
                              </label>
                              <input
                                id={`reactivate-stock-${p.id}`}
                                type="number"
                                min="1"
                                value={inputVal}
                                onChange={(e) =>
                                  setReactivateStockInputs((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.value,
                                  }))
                                }
                                className="w-20 px-2.5 py-1.5 text-xs font-mono font-bold bg-white border border-stone-300 rounded-lg text-right"
                              />
                            </div>
                            {p.status !== 'ARCHIVED' && <button
                              type="button"
                              disabled={activatingProductId === p.id}
                              onClick={() => handleActivateProductStock(p)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>
                                {activatingProductId === p.id
                                  ? 'Ativando...'
                                  : 'Ativar com Novo Estoque'}
                              </span>
                            </button>}
                            {p.status === 'ARCHIVED' && <button type="button" onClick={() => onProductStatusChange(p, p.stock > 0 ? 'ACTIVE' : 'INACTIVE')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"><Check className="h-3.5 w-3.5" />Restaurar</button>}
                            <button
                              type="button"
                              onClick={() => openEditProduct(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Editar Completo</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
