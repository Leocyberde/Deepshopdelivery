import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  const [company, setCompany] = useState<any>(null);

  useEffect(() => {
    fetch('/api/legal')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setCompany(data?.company || null))
      .catch(() => {});
  }, []);

  return (
    <footer className="border-t border-stone-200 bg-white mt-10">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-3">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="text-xs text-zinc-500">
            © {company?.name || 'DeepShop Delivery'}. Consulte nossas informações legais.
          </div>
          <nav className="flex flex-wrap gap-4 text-xs font-semibold text-zinc-600">
            <Link to="/privacidade" className="hover:text-zinc-900">Privacidade</Link>
            <Link to="/termos" className="hover:text-zinc-900">Termos</Link>
            <Link to="/trocas" className="hover:text-zinc-900">Trocas e Devoluções</Link>
          </nav>
        </div>
        {company && (company.cnpj || company.address || company.email || company.phone) && (
          <div className="text-[11px] text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
            {company.cnpj && <span>CNPJ: {company.cnpj}</span>}
            {company.address && <span>{company.address}</span>}
            {company.email && <span>{company.email}</span>}
            {company.phone && <span>{company.phone}</span>}
          </div>
        )}
      </div>
    </footer>
  );
};
