import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { rawbtUrl } from '../../utils/receiptPrinter.ts';
import { toReceiptOrder } from './AdminOrdersSection.tsx';

const KEY_ENABLED = 'deepshop_auto_print';
const KEY_LAST = 'deepshop_auto_print_last';
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // marca antiga demais = recomeça (não reimprime o passado)

interface QueueItem { historyId: number; orderId: number; orderNumber: string; url: string }

const readLast = (): { id: number; ts: number } | null => {
  try { const v = JSON.parse(localStorage.getItem(KEY_LAST) || 'null'); return v && Number.isFinite(v.id) ? v : null; } catch { return null; }
};
const writeLast = (id: number) => { try { localStorage.setItem(KEY_LAST, JSON.stringify({ id, ts: Date.now() })); } catch { /* sem storage */ } };

/**
 * Imprime a comanda quando um pedido passa a PAGO (webhook do Mercado Pago ou ação manual).
 * O navegador do celular pode bloquear a abertura automática do RawBT sem um toque do usuário;
 * por isso o aviso com o botão "Imprimir" permanece até ser dispensado.
 */
export const AutoPrintControl: React.FC<{ apiFetch: (url: string, init?: any) => Promise<any> }> = ({ apiFetch }) => {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(KEY_ENABLED) === '1'; } catch { return false; } });
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const busyRef = useRef(false);

  const toggle = () => {
    const next = !enabled;
    try { localStorage.setItem(KEY_ENABLED, next ? '1' : '0'); } catch { /* ignora */ }
    if (next) { try { localStorage.removeItem(KEY_LAST); } catch { /* ignora */ } } // novo início: só pedidos dali em diante
    setEnabled(next);
  };

  const poll = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const last = readLast();
      const fresh = last && Date.now() - last.ts < MAX_AGE_MS ? last.id : null;
      const res = await apiFetch(`/api/admin/orders/paid-since${fresh !== null ? `?sinceId=${fresh}` : ''}`);
      if (fresh === null) { writeLast(Number(res.maxHistoryId || 0)); return; }
      let cursor = fresh;
      const added: QueueItem[] = [];
      for (const row of res.orders || []) {
        const details = await apiFetch(`/api/admin/orders/${row.orderId}`);
        const receipt = toReceiptOrder({ ...details, status: details.status || 'PAID' });
        added.push({ historyId: row.historyId, orderId: row.orderId, orderNumber: receipt.orderNumber, url: rawbtUrl(receipt, window.location.origin) });
        cursor = row.historyId;
      }
      if (added.length) {
        writeLast(cursor);
        setQueue((q) => [...q, ...added]);
        window.location.href = added[0].url; // tentativa automática (o aviso abaixo cobre o caso de bloqueio)
      } else {
        writeLast(Math.max(cursor, Number(res.maxHistoryId || 0)));
      }
    } catch { /* tenta de novo no próximo ciclo */ } finally { busyRef.current = false; }
  }, [apiFetch]);

  useEffect(() => {
    if (!enabled) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 8000);
    return () => window.clearInterval(timer);
  }, [enabled, poll]);

  return (
    <div className="fixed left-3 bottom-3 z-[70] flex flex-col items-start gap-2 max-w-[calc(100vw-1.5rem)]">
      {queue.map((item) => (
        <div key={item.historyId} className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2 shadow-lg text-xs">
          <span>Pedido <strong>#{item.orderNumber}</strong> pago. Se não imprimiu sozinho, toque:</span>
          <a href={item.url} className="rounded-lg bg-zinc-900 px-2.5 py-1.5 font-semibold text-white">Imprimir</a>
          <button type="button" aria-label="Dispensar" onClick={() => setQueue((q) => q.filter((i) => i.historyId !== item.historyId))} className="text-zinc-500"><X className="w-4 h-4" /></button>
        </div>
      ))}
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow ${enabled ? 'bg-emerald-700 text-white border-emerald-800' : 'bg-white text-zinc-700 border-stone-300'}`}
        title="Imprime a comanda automaticamente quando um pedido for pago (precisa do RawBT e da impressora pareada)"
      >
        <Printer className="w-3.5 h-3.5" />
        Impressão automática: {enabled ? 'LIGADA' : 'desligada'}
      </button>
    </div>
  );
};
