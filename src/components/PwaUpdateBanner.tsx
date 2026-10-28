import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** Avisa que existe versão nova do app e recarrega com um toque. */
export const PwaUpdateBanner: React.FC = () => {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const show = () => setAvailable(true);
    window.addEventListener('pwa-update-available', show);
    return () => window.removeEventListener('pwa-update-available', show);
  }, []);
  if (!available) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-[90] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-white shadow-2xl">
      <RefreshCw className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-sm font-semibold">Nova versão disponível</span>
      <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-zinc-900">Atualizar</button>
      <button type="button" aria-label="Dispensar" onClick={() => setAvailable(false)} className="px-1 text-lg leading-none text-white/70">×</button>
    </div>
  );
};
