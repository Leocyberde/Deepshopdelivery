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
    <footer className="mt-10 border-t border-stone-200 bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="space-y-3 md:col-span-1">
          <div className="text-lg font-bold tracking-tight text-zinc-900">Deep<span className="text-blue-600">Shop</span> <span className="text-sm text-zinc-500">Delivery</span></div>
          <p className="text-sm leading-6 text-zinc-600">Utilidades, acessórios, tecnologia e novidades com delivery local conforme o endereço de entrega.</p>
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-900">Institucional</h2>
          <nav className="mt-3 flex flex-col items-start gap-2 text-sm text-zinc-600">
            <Link to="/sobre" className="hover:text-zinc-900">Sobre nós</Link>
            <Link to="/pagamento-seguranca" className="hover:text-zinc-900">Pagamento e segurança</Link>
            <Link to="/envio-entrega" className="hover:text-zinc-900">Prazos de envio e entrega</Link>
          </nav>
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-900">Políticas</h2>
          <nav className="mt-3 flex flex-col items-start gap-2 text-sm text-zinc-600">
            <Link to="/privacidade" className="hover:text-zinc-900">Privacidade</Link>
            <Link to="/termos" className="hover:text-zinc-900">Termos de uso</Link>
            <Link to="/trocas" className="hover:text-zinc-900">Trocas e devoluções</Link>
          </nav>
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-900">Atendimento</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-600">Acompanhe pedidos, tire dúvidas e fale com a loja pela sua conta.</p>
          <Link to="/minha-conta/central-ajuda" className="mt-3 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800">Abrir Central de Ajuda</Link>
        </div>
      </div>
      <div className="border-t border-stone-200">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {company?.name || 'DeepShop Delivery'}. Todos os direitos reservados.</span>
          {company?.email && <span>{company.email}</span>}
        </div>
      </div>
    </footer>
  );
};
