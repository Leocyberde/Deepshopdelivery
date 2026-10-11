import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, ShoppingBag, FileText, User } from 'lucide-react';
import { useApp, isAdminRole } from '../context/AppContext.tsx';

export const BottomNav: React.FC = () => {
  const { user, cartCount } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const isCheckout = location.pathname === '/checkout';
  if (!user || isAdminRole(user.role) || isCheckout) return null;

  const isHome = location.pathname === '/' && !location.hash;
  const isCart = location.pathname === '/carrinho' || location.pathname === '/checkout';
  const isOrders = location.pathname.startsWith('/minha-conta/pedidos');
  const isProfile = location.pathname.startsWith('/minha-conta') && !isOrders;

  const handleSearchClick = () => {
    if (location.pathname !== '/') {
      navigate('/');
    }
    window.setTimeout(() => {
      const input = document.getElementById('navbar-search-input') as HTMLInputElement | null;
      if (input) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
      }
    }, 100);
  };

  return (
    <nav
      aria-label="Navegação principal inferior"
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-zinc-200 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(0,0,0,0.05)]"
    >
      <div className="max-w-[1200px] mx-auto px-2 h-16 grid grid-cols-5 items-center">
        {/* 1. Início */}
        <Link
          to="/"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 transition-colors ${
            isHome ? 'text-[#09090B] font-bold' : 'text-zinc-500 hover:text-zinc-900 font-medium'
          }`}
        >
          <Home className={`w-5 h-5 ${isHome ? 'stroke-[2.5] text-[#09090B]' : 'stroke-[1.8]'}`} />
          <span className="text-[11px] leading-none">Início</span>
        </Link>

        {/* 2. Busca */}
        <button
          type="button"
          onClick={handleSearchClick}
          className="flex flex-col items-center justify-center gap-1 py-1.5 text-zinc-500 hover:text-zinc-900 font-medium transition-colors cursor-pointer"
        >
          <Search className="w-5 h-5 stroke-[1.8]" />
          <span className="text-[11px] leading-none">Busca</span>
        </button>

        {/* 3. Sacola */}
        <Link
          to="/carrinho"
          className={`relative flex flex-col items-center justify-center gap-1 py-1.5 transition-colors ${
            isCart ? 'text-[#087BFF] font-bold' : 'text-zinc-500 hover:text-zinc-900 font-medium'
          }`}
        >
          <div className="relative">
            <ShoppingBag
              className={`w-5 h-5 ${isCart ? 'stroke-[2.5] text-[#087BFF]' : 'stroke-[1.8]'}`}
            />
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#087BFF] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {cartCount}
              </span>
            )}
          </div>
          <span className="text-[11px] leading-none">Sacola</span>
        </Link>

        {/* 4. Pedidos */}
        <Link
          to={isAdminRole(user.role) ? '/admin/pedidos' : '/minha-conta/pedidos'}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 transition-colors ${
            isOrders ? 'text-[#09090B] font-bold' : 'text-zinc-500 hover:text-zinc-900 font-medium'
          }`}
        >
          <FileText
            className={`w-5 h-5 ${isOrders ? 'stroke-[2.5] text-[#09090B]' : 'stroke-[1.8]'}`}
          />
          <span className="text-[11px] leading-none">Pedidos</span>
        </Link>

        {/* 5. Perfil */}
        <Link
          to={isAdminRole(user.role) ? '/admin' : '/minha-conta'}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 transition-colors ${
            isProfile ? 'text-[#09090B] font-bold' : 'text-zinc-500 hover:text-zinc-900 font-medium'
          }`}
        >
          <div className="relative">
            <User
              className={`w-5 h-5 ${isProfile ? 'stroke-[2.5] text-[#09090B]' : 'stroke-[1.8]'}`}
            />
            <span className="w-2 h-2 rounded-full bg-[#087BFF] absolute -top-0.5 -right-0.5 border border-white" />
          </div>
          <span className="text-[11px] leading-none">
            {isAdminRole(user.role) ? 'Admin' : 'Perfil'}
          </span>
        </Link>
      </div>
    </nav>
  );
};
