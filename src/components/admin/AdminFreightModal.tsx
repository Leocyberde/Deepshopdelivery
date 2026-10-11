import React from 'react';
import { X } from 'lucide-react';
import { formatCurrency } from '../../context/AppContext.tsx';

interface AdminFreightModalProps {
  freightModalAddr: any | null;
  setFreightModalAddr: (val: any | null) => void;
  freightKmInput: string;
  setFreightKmInput: (val: string) => void;
  freightFeeInput: string;
  setFreightFeeInput: (val: string) => void;
  freightOriginInput: string;
  setFreightOriginInput: (val: string) => void;
  freightNotesInput: string;
  setFreightNotesInput: (val: string) => void;
  suggestedFeePreview: number | null;
  freightRule: { baseDistanceKm: number; baseFee: number; extraKmFee: number };
  handleSaveAddressFreight: (e: React.FormEvent) => void;
}

export const AdminFreightModal: React.FC<AdminFreightModalProps> = ({
  freightModalAddr,
  setFreightModalAddr,
  freightKmInput,
  setFreightKmInput,
  freightFeeInput,
  setFreightFeeInput,
  freightOriginInput,
  setFreightOriginInput,
  freightNotesInput,
  setFreightNotesInput,
  suggestedFeePreview,
  freightRule,
  handleSaveAddressFreight,
}) => {
  if (!freightModalAddr) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 pb-3">
          <div>
            <h2 className="text-base font-bold text-zinc-900">
              Definir Distância e Frete do Endereço
            </h2>
            <p className="text-xs text-zinc-500">
              {freightModalAddr.customerName ? `${freightModalAddr.customerName} — ` : ''}
              {freightModalAddr.label} ({freightModalAddr.street}, {freightModalAddr.number} —{' '}
              {freightModalAddr.neighborhood}, {freightModalAddr.city}/{freightModalAddr.state})
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFreightModalAddr(null)}
            className="p-1 text-zinc-400 hover:text-zinc-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSaveAddressFreight} className="space-y-4">
          <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 text-xs text-zinc-600">
            Regra aritmética da loja: Até <strong>{freightRule.baseDistanceKm} km</strong> ={' '}
            <strong>{formatCurrency(freightRule.baseFee)}</strong> +{' '}
            <strong>{formatCurrency(freightRule.extraKmFee)}</strong> por km excedente.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">Distância (km)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                required
                value={freightKmInput}
                onChange={(e) => setFreightKmInput(e.target.value)}
                placeholder="Ex: 4.5"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-stone-300 rounded-lg"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Valor Confirmado do Frete (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={freightFeeInput}
                onChange={(e) => setFreightFeeInput(e.target.value)}
                placeholder="Ex: 8.25"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-stone-300 rounded-lg"
              />
            </div>
          </div>

          {suggestedFeePreview !== null && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950">
              <span>
                Sugestão calculada pela distância:{' '}
                <strong>{formatCurrency(suggestedFeePreview)}</strong>
              </span>
              <button
                type="button"
                onClick={() => setFreightFeeInput(suggestedFeePreview.toFixed(2))}
                className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
              >
                Usar Sugestão
              </button>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Endereço de Origem da Loja
            </label>
            <input
              type="text"
              value={freightOriginInput}
              onChange={(e) => setFreightOriginInput(e.target.value)}
              placeholder="Matriz DeepShop"
              className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Observações Internas de Entrega (opcional)
            </label>
            <input
              type="text"
              value={freightNotesInput}
              onChange={(e) => setFreightNotesInput(e.target.value)}
              placeholder="Ex: Condomínio, portaria..."
              className="w-full px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={() => setFreightModalAddr(null)}
              className="px-4 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Confirmar e Liberar Frete
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
