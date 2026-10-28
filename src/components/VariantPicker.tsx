import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Minus, Plus, X, ZoomIn } from 'lucide-react';
import { ProductImage } from './ui/ProductMedia.tsx';
import { formatCurrency } from '../utils/formatters.ts';

export interface PublicVariant {
  id: number;
  sku?: string | null;
  options: Record<string, string>;
  imageUrl?: string | null;
  price: string;
  promoPrice?: string | null;
  allowPreorder: boolean;
  availabilityMode: 'DELIVERY' | 'PREORDER';
}

export interface OptionValue {
  value: string;
  imageUrl: string | null;
  /** DELIVERY quando algum modelo desta opção tem saldo; PREORDER quando só dá para encomendar. */
  mode: 'DELIVERY' | 'PREORDER';
  available: boolean;
}

export interface OptionGroup {
  type: string;
  /** true = mostrar como cartões com foto (o tipo cujo valor define a foto). */
  photoBased: boolean;
  values: OptionValue[];
}

export const variantLabel = (variant: Pick<PublicVariant, 'options'> | null | undefined): string =>
  variant ? Object.values(variant.options).join(' / ') : '';

const isPurchasable = (variant: PublicVariant) => variant.availabilityMode === 'DELIVERY' || variant.allowPreorder;

function optionTypes(variants: PublicVariant[]): string[] {
  const types: string[] = [];
  for (const variant of variants) for (const key of Object.keys(variant.options)) if (!types.includes(key)) types.push(key);
  return types;
}

/** Descobre qual tipo de opção "carrega" a foto: todos os valores têm foto e cada valor aponta para uma única foto. */
function photoTypeOf(variants: PublicVariant[], types: string[]): string | null {
  for (const type of types) {
    const byValue = new Map<string, Set<string>>();
    let everyVariantHasPhoto = true;
    for (const variant of variants) {
      const value = variant.options[type];
      if (!value) continue;
      if (!variant.imageUrl) { everyVariantHasPhoto = false; break; }
      byValue.set(value, (byValue.get(value) || new Set()).add(variant.imageUrl));
    }
    if (everyVariantHasPhoto && byValue.size > 0 && [...byValue.values()].every((photos) => photos.size === 1)) return type;
  }
  return null;
}

export function buildOptionGroups(variants: PublicVariant[], selection: Record<string, string>): OptionGroup[] {
  const types = optionTypes(variants);
  const photoType = photoTypeOf(variants, types);
  return types.map((type) => {
    const valueNames: string[] = [];
    for (const variant of variants) {
      const value = variant.options[type];
      if (value && !valueNames.includes(value)) valueNames.push(value);
    }
    const values = valueNames.map((value) => {
      // Considera as demais escolhas já feitas para saber se esta opção está disponível/encomenda.
      const candidates = variants.filter((variant) => variant.options[type] === value
        && Object.entries(selection).every(([otherType, otherValue]) => otherType === type || variant.options[otherType] === otherValue));
      const pool = candidates.length ? candidates : variants.filter((variant) => variant.options[type] === value);
      const purchasable = pool.filter(isPurchasable);
      const hasDelivery = purchasable.some((variant) => variant.availabilityMode === 'DELIVERY');
      const imageUrl = pool.find((variant) => variant.imageUrl)?.imageUrl ?? null;
      return { value, imageUrl, mode: hasDelivery ? 'DELIVERY' as const : 'PREORDER' as const, available: candidates.length > 0 && purchasable.length > 0 };
    });
    return { type, photoBased: type === photoType, values };
  });
}

/** Escolhe a variação que melhor casa com a seleção atual depois que o cliente troca uma opção. */
export function pickVariantAfterChoice(variants: PublicVariant[], current: PublicVariant | null, type: string, value: string): PublicVariant | null {
  const wanted = { ...(current?.options || {}), [type]: value };
  const exact = variants.find((variant) => isPurchasable(variant) && Object.entries(wanted).every(([key, val]) => variant.options[key] === val));
  if (exact) return exact;
  const sameValue = variants.filter((variant) => isPurchasable(variant) && variant.options[type] === value);
  if (!sameValue.length) return null;
  const score = (variant: PublicVariant) => Object.entries(wanted).filter(([key, val]) => variant.options[key] === val).length;
  return [...sameValue].sort((a, b) => score(b) - score(a))[0];
}

const EncomendaBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 ${className}`}>Encomenda</span>
);

/** Grupos de opções: cartões com foto quando o modelo tem foto + chips de texto para as demais opções. */
export const VariantOptionGroups: React.FC<{
  variants: PublicVariant[];
  selectedVariantId: number | null;
  onSelect: (variantId: number) => void;
  onPreview?: (imageUrl: string) => void;
}> = ({ variants, selectedVariantId, onSelect, onPreview }) => {
  const selected = variants.find((variant) => variant.id === selectedVariantId) || null;
  const groups = useMemo(() => buildOptionGroups(variants, selected?.options || {}), [variants, selected]);
  const choose = (type: string, value: string) => {
    const next = pickVariantAfterChoice(variants, selected, type, value);
    if (next) onSelect(next.id);
  };
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.type} className="space-y-2">
          <h3 className="text-sm font-bold text-zinc-900">{group.type} <span className="font-normal text-zinc-500">({group.values.length})</span></h3>
          {group.photoBased ? (
            <div className="grid grid-cols-3 gap-2.5">
              {group.values.map((option) => {
                const active = selected?.options[group.type] === option.value;
                return (
                  <button
                    type="button"
                    key={option.value}
                    disabled={!option.available}
                    onClick={() => choose(group.type, option.value)}
                    aria-pressed={active}
                    className={`relative overflow-hidden rounded-xl border-2 bg-white text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-rose-600 shadow-sm' : 'border-stone-200 hover:border-stone-400'}`}
                  >
                    <div className="relative aspect-square w-full bg-stone-50">
                      <ProductImage src={option.imageUrl} alt={option.value} />
                      {option.imageUrl && onPreview && (
                        <span
                          role="button"
                          aria-label={`Ampliar foto de ${option.value}`}
                          onClick={(event) => { event.stopPropagation(); onPreview(option.imageUrl as string); }}
                          className="absolute left-1 top-1 rounded-full bg-black/45 p-1 text-white"
                        ><ZoomIn className="h-3 w-3" /></span>
                      )}
                      {option.mode === 'PREORDER' && option.available && <EncomendaBadge className="absolute bottom-1 right-1" />}
                    </div>
                    <div className={`truncate px-1 py-1.5 text-xs font-semibold ${active ? 'text-rose-600' : 'text-zinc-800'}`}>{option.value}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {group.values.map((option) => {
                const active = selected?.options[group.type] === option.value;
                return (
                  <button
                    type="button"
                    key={option.value}
                    disabled={!option.available}
                    onClick={() => choose(group.type, option.value)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:border-dashed disabled:text-stone-400 ${active ? 'border-rose-600 bg-rose-50 font-semibold text-rose-600' : 'border-stone-300 bg-white text-zinc-800 hover:border-stone-500'}`}
                  >
                    {option.value}
                    {option.mode === 'PREORDER' && option.available && <EncomendaBadge />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/** Linha resumida da página do produto: miniaturas + "Selecionado: ..." (abre o seletor completo). */
export const VariantSummaryRow: React.FC<{
  variants: PublicVariant[];
  selectedVariantId: number | null;
  onOpen: () => void;
}> = ({ variants, selectedVariantId, onOpen }) => {
  const selected = variants.find((variant) => variant.id === selectedVariantId) || null;
  const thumbs = variants.filter((variant) => variant.imageUrl).slice(0, 4);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-white p-2.5 text-left hover:bg-stone-50">
      {thumbs.length > 0 && (
        <div className="flex shrink-0 gap-1.5">
          {thumbs.map((variant) => (
            <span key={variant.id} className={`h-11 w-11 overflow-hidden rounded-md border-2 ${variant.id === selectedVariantId ? 'border-rose-600' : 'border-transparent'}`}>
              <ProductImage src={variant.imageUrl} alt={variantLabel(variant)} />
            </span>
          ))}
        </div>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-600">
        {variants.length} opções · Selecionado: <strong className="text-zinc-900">{variantLabel(selected) || 'escolha uma opção'}</strong>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
    </button>
  );
};

/** Seletor em "gaveta" (bottom sheet), igual ao do TikTok Shop: foto + preço no topo, opções no meio, botão embaixo. */
export const VariantSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  fallbackImageUrl: string | null;
  variants: PublicVariant[];
  selectedVariantId: number | null;
  onSelect: (variantId: number) => void;
  normalPrice: string;
  promoPrice?: string | null;
  hasPromo: boolean;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  maxQuantity?: number;
  confirmLabel: string;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}> = ({ open, onClose, title, fallbackImageUrl, variants, selectedVariantId, onSelect, normalPrice, promoPrice, hasPromo, quantity, onQuantityChange, maxQuantity = 20, confirmLabel, onConfirm, confirmDisabled }) => {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setPreview(null); return; }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (preview) setPreview(null); else onClose(); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, preview]);
  if (!open) return null;
  const selected = variants.find((variant) => variant.id === selectedVariantId) || null;
  const headerImage = selected?.imageUrl || fallbackImageUrl;
  const showPromo = hasPromo && Boolean(promoPrice);
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`Escolher opção de ${title}`} className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-stone-200 p-4">
          <button type="button" onClick={() => headerImage && setPreview(headerImage)} aria-label="Ampliar foto escolhida" className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
            <ProductImage src={headerImage} alt={title} />
          </button>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-extrabold text-rose-600 tabular-nums">{formatCurrency(showPromo ? (promoPrice as string) : normalPrice)}</span>
              {showPromo && <span className="text-xs text-zinc-400 line-through tabular-nums">{formatCurrency(normalPrice)}</span>}
            </div>
            <p className="truncate text-xs text-zinc-600">{title}</p>
            {selected && (
              <p className="text-xs font-semibold text-zinc-900">
                {variantLabel(selected)} {selected.availabilityMode === 'PREORDER' && <EncomendaBadge className="ml-1" />}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-1.5 text-zinc-500 hover:bg-stone-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <VariantOptionGroups variants={variants} selectedVariantId={selectedVariantId} onSelect={onSelect} onPreview={setPreview} />
          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-900">Quantidade</span>
            <div className="inline-flex items-center rounded-lg border border-stone-300 bg-stone-50">
              <button type="button" aria-label="Diminuir quantidade" disabled={quantity <= 1} onClick={() => onQuantityChange(Math.max(1, quantity - 1))} className="p-2.5 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
              <span className="min-w-10 text-center text-sm font-bold tabular-nums">{quantity}</span>
              <button type="button" aria-label="Aumentar quantidade" disabled={quantity >= maxQuantity} onClick={() => onQuantityChange(Math.min(maxQuantity, quantity + 1))} className="p-2.5 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        <div className="border-t border-stone-200 p-4">
          <button type="button" onClick={onConfirm} disabled={confirmDisabled || !selected} className="w-full rounded-full bg-rose-600 px-4 py-3.5 text-base font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
            {confirmLabel}
          </button>
        </div>
      </section>

      {preview && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4" onClick={() => setPreview(null)}>
          <button type="button" aria-label="Fechar foto" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white"><X className="h-5 w-5" /></button>
          <img src={preview} alt={variantLabel(selected) || title} referrerPolicy="no-referrer" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
};
