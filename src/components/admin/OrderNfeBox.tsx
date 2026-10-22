import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Mail } from 'lucide-react';

type Props = {
  orderId: number;
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>;
  toast: (text: string, type?: 'success' | 'error' | 'info') => void;
};

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  AUTHORIZED: { text: 'Autorizada', tone: 'bg-emerald-100 text-emerald-800' },
  PROCESSING: { text: 'Processando…', tone: 'bg-amber-100 text-amber-800' },
  REJECTED: { text: 'Rejeitada pela Sefaz', tone: 'bg-red-100 text-red-800' },
  ERROR: { text: 'Falha — tente novamente', tone: 'bg-red-100 text-red-800' },
};

function saveBase64(file: { filename: string; mimeType: string; dataBase64: string }) {
  const bytes = Uint8Array.from(atob(file.dataBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const a = document.createElement('a');
  a.href = url; a.download = file.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** NF-e opcional por pedido pago: só é enviada à Sefaz quando o admin clica em "Emitir NF-e". */
export const OrderNfeBox: React.FC<Props> = ({ orderId, apiFetch, toast }) => {
  const [info, setInfo] = useState<any>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setInfo(await apiFetch(`/api/admin/orders/${orderId}/nfe`)); setProblems([]); }
    catch (error: any) { setInfo(null); toast(error.message || 'Não foi possível consultar a NF-e.', 'error'); }
    finally { setLoading(false); }
  }, [apiFetch, orderId, toast]);
  useEffect(() => { void load(); }, [load]);

  const emit = async () => {
    const production = info?.environment === 'PRODUCAO';
    const question = production
      ? `Emitir a NF-e REAL deste pedido ${info?.orderNumber ?? ''} na Sefaz? Depois de autorizada, só pode ser cancelada pelo processo oficial.`
      : `Emitir NF-e de TESTE (homologação) do pedido ${info?.orderNumber ?? ''}?`;
    if (!window.confirm(question)) return;
    setBusy(true); setProblems([]);
    try {
      const result: any = await apiFetch(`/api/admin/orders/${orderId}/nfe/emit`, { method: 'POST', body: JSON.stringify({}) });
      const status = result?.document?.status;
      if (status === 'AUTHORIZED') toast('NF-e autorizada. Baixe o XML e o DANFE para enviar ao cliente.', 'success');
      else toast(result?.document?.rejectionMessage || 'A NF-e não foi autorizada.', 'error');
    } catch (error: any) {
      setProblems(Array.isArray(error?.problems) ? error.problems : []);
      toast(error.message || 'Não foi possível emitir a NF-e.', 'error');
    } finally { setBusy(false); await load(); }
  };

  const download = async (kind: 'xml' | 'danfe') => {
    try { saveBase64(await apiFetch(`/api/admin/orders/${orderId}/nfe/download/${kind}`)); }
    catch (error: any) { toast(error.message || 'Não foi possível baixar o arquivo.', 'error'); }
  };

  const doc = info?.document;
  const label = doc ? STATUS_LABEL[doc.status] : null;
  const shownProblems = problems.length ? problems : (info?.problems ?? []);
  const mailto = info?.customerEmail
    ? `mailto:${encodeURIComponent(info.customerEmail)}?subject=${encodeURIComponent(`Nota fiscal do pedido ${info.orderNumber}`)}&body=${encodeURIComponent('Olá! Segue em anexo a nota fiscal (DANFE e XML) do seu pedido. Obrigado pela compra!')}`
    : '';

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-zinc-900"><FileText className="h-3.5 w-3.5" />Nota fiscal (NF-e)</h3>
        {label && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${label.tone}`}>{label.text}</span>}
      </div>
      {loading && <p className="text-xs text-zinc-500">Consultando…</p>}
      {!loading && info && (
        <>
          {info.environment !== 'PRODUCAO' && <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">Ambiente de testes (homologação): a nota não tem valor fiscal.</p>}
          {info.emitterOnline === false && doc?.status !== 'AUTHORIZED' && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">O serviço emissor não respondeu ou não conseguiu abrir o certificado A1. Verifique se ele está no ar, se NFE_SERVICE_URL/NFE_SERVICE_TOKEN estão corretos e se o .pfx e a senha estão certos.</p>}
          {info.certificate && (info.certificate.expired || info.certificate.daysLeft <= 30) && doc?.status !== 'AUTHORIZED' && (
            <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{info.certificate.expired ? 'Certificado A1 vencido: renove-o para emitir.' : `Certificado A1 vence em ${info.certificate.daysLeft} dia(s): renove em breve.`}</p>
          )}
          {doc && <p className="text-[11px] text-zinc-600">Nº {doc.numero} · Série {doc.serie}{doc.accessKey ? <> · Chave {doc.accessKey}</> : null}</p>}
          {doc && (doc.status === 'REJECTED' || doc.status === 'ERROR') && doc.rejectionMessage && <p className="text-[11px] text-red-700">{doc.rejectionCode ? `[${doc.rejectionCode}] ` : ''}{doc.rejectionMessage}</p>}
          {shownProblems.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-red-700">{shownProblems.map((p: string) => <li key={p}>{p}</li>)}</ul>}
          <div className="flex flex-wrap gap-1.5">
            {doc?.status !== 'AUTHORIZED' && (
              <button type="button" disabled={busy || !info.canEmit} onClick={emit} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
                {busy ? 'Emitindo…' : doc ? 'Tentar emitir novamente' : 'Emitir NF-e'}
              </button>
            )}
            {doc?.status === 'AUTHORIZED' && (
              <>
                <button type="button" disabled={!doc.hasDanfe} onClick={() => download('danfe')} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-stone-50 disabled:opacity-40">Baixar DANFE (PDF)</button>
                <button type="button" disabled={!doc.hasXml} onClick={() => download('xml')} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-stone-50 disabled:opacity-40">Baixar XML</button>
                {mailto && <a href={mailto} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-stone-50"><Mail className="h-3.5 w-3.5" />E-mail do cliente</a>}
              </>
            )}
          </div>
          {doc?.status === 'AUTHORIZED' && <p className="text-[11px] text-zinc-500">Anexe o DANFE e o XML ao e-mail e envie ao cliente. Guarde o XML por 5 anos.</p>}
        </>
      )}
    </div>
  );
};
