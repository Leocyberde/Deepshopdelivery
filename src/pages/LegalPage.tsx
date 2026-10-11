import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const CONFIG: Record<string, { title: string; key: 'privacy' | 'terms' | 'exchanges' }> = {
  '/privacidade': { title: 'Política de Privacidade', key: 'privacy' },
  '/termos': { title: 'Termos de Uso', key: 'terms' },
  '/trocas': { title: 'Trocas e Devoluções', key: 'exchanges' },
};

export const LegalPage: React.FC = () => {
  const location = useLocation();
  const config = CONFIG[location.pathname] || CONFIG['/privacidade'];
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/legal').then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Erro ao carregar página.');
      setData(body);
    }).catch((e) => setError(e.message));
  }, []);

  return (
    <main className="max-w-[900px] mx-auto w-full px-4 sm:px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-zinc-900">{config.title}</h1><p className="text-xs text-zinc-500 mt-1">Versão {data?.legalVersion || '2026-10-v1'}</p></div>
        <Link to="/" className="text-xs font-semibold text-zinc-700 hover:text-zinc-900">Voltar para a loja</Link>
      </div>
      {error ? <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div> : <div className="bg-white border border-stone-200 rounded-xl p-6 whitespace-pre-wrap text-sm leading-7 text-zinc-700">{data?.[config.key] || 'Carregando...'}</div>}
      {data?.company && <div className="bg-stone-50 border border-stone-200 rounded-xl p-5 text-xs text-zinc-600 space-y-1"><div className="font-bold text-zinc-900">{data.company.name}</div>{data.company.cnpj && <div>CNPJ: {data.company.cnpj}</div>}{data.company.address && <div>{data.company.address}</div>}{data.company.email && <div>{data.company.email}</div>}{data.company.phone && <div>{data.company.phone}</div>}</div>}
    </main>
  );
};
