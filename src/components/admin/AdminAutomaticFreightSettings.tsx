import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
export const AdminAutomaticFreightSettings: React.FC<{ form: any; setForm: (value: any) => void }> = ({ form, setForm }) => {
  const { apiFetch, toast } = useApp();
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const refresh = () => apiFetch('/api/admin/geo/status').then(setStatus).catch(() => {});
  useEffect(() => { void refresh(); }, [apiFetch]);
  const action = async (path: string, body?: any) => {
    setBusy(true);
    try {
      const data = await apiFetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
      setResult(data); await refresh(); toast('Operação de frete concluída. Confira o resumo.', 'success'); return data;
    } catch (error: any) { toast(error.message, 'error'); } finally { setBusy(false); }
  };
  const bool = (key: string, title: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[key] === 'true'} onChange={(e) => setForm({ ...form, [key]: String(e.target.checked) })} />{title}</label>;
  const numeric = (key: string, title: string, fallback: string, min = 0, max?: number, step = '0.01') => <label className="block space-y-1 text-xs font-semibold">{title}<input type="number" min={min} max={max} step={step} required value={form[key] ?? fallback} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" /></label>;
  return <div className="space-y-4">
    <p className="text-xs text-zinc-600">Atendemos apenas Itatiba. O servidor calcula a distância e o frete. Salve as configurações antes de testar o endereço.</p>
    <button type="button" disabled={busy} onClick={() => void action('/api/admin/geo/test-origin')} className="rounded-lg border px-3 py-2 text-xs font-semibold">Testar endereço salvo (1 consulta)</button>
    <div className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold text-sm">Faixa 1 — de 0 a 3 km</h3>{bool('freight_free_band1_enabled', 'Ativar frete grátis')}{bool('freight_free_band1_min_required', 'Exigir valor mínimo')}{form.freight_free_band1_min_required === 'true' && numeric('freight_free_band1_min_value', 'Mínimo de produtos (R$)', '0')}</div>
    <div className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold text-sm">Faixa 2 — acima de 3 até 15 km</h3>{bool('freight_free_band2_enabled', 'Ativar frete grátis')}{numeric('freight_free_band2_min_value', 'Mínimo de produtos (R$)', '90', form.freight_free_band2_enabled === 'true' ? 0.01 : 0)}</div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{numeric('freight_max_km', 'Distância máxima (km)', '20', 15, 1000)}{numeric('geo_monthly_limit', 'Limite mensal de consultas', '35000', 100, 40000, '1')}{numeric('geo_warn_at', 'Avisar a partir de consultas', '25000', 1, 40000, '1')}</div>
    <label className="block text-xs font-semibold">WhatsApp da mensagem fora da área<input value={form.freight_out_of_area_whatsapp ?? '11910509385'} pattern="[0-9]{10,15}" onChange={(e) => setForm({ ...form, freight_out_of_area_whatsapp: e.target.value })} className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm" /></label>
    <div className="rounded-xl border bg-stone-50 p-4 space-y-3"><h3 className="font-semibold text-sm">Uso da API</h3>{status ? <p className="text-xs">Estado: {status.state} · Provedor: {status.provider}<br />{status.calls} / {status.limit} consultas ({status.percent}%) · aviso: {status.warnAt}<br />{status.cacheEntries} endereços em cache · {status.savedHits} consultas economizadas</p> : <p className="text-xs">Status indisponível para este perfil.</p>}<button type="button" disabled={busy} onClick={() => void action('/api/admin/geo/calculate-pending')} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">Calcular distâncias pendentes (até 50)</button></div>
    <div className="rounded-xl border border-amber-300 p-4 space-y-3"><h3 className="font-semibold text-sm">Pedidos antigos sem frete</h3><p className="text-xs">Somente NEW/AWAITING_PAYMENT com frete nulo. Pagos/concluídos ficam intocados. Faça o dry-run antes de executar. Itatiba calcula e libera; fora da cidade/limite cancela e devolve o estoque reservado.</p><button type="button" disabled={busy} onClick={async () => { const data = await action('/api/admin/orders/legacy-freight/dry-run'); if (data) setPlan(data); }} className="rounded-lg border px-3 py-2 text-xs">Prévia (dry-run)</button>{plan && <><p className="text-xs">Prévia: {plan.counts.calculateAndRelease} para calcular/liberar; {plan.counts.cancel} para cancelar. Total elegível: {plan.totalEligible}.</p><button type="button" disabled={busy} onClick={async () => { const data = await action('/api/admin/orders/legacy-freight/execute', { dryRunId: plan.dryRunId, confirm: true }); if (data) setPlan(null); }} className="rounded-lg bg-amber-900 px-3 py-2 text-xs text-white">Executar esta prévia</button></>}</div>
    {result && <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-100 p-3 text-[11px]" aria-live="polite">{JSON.stringify(result, null, 2)}</pre>}
  </div>;
};
