import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  AlertTriangle,
  Tags,
  ShoppingBag,
  Users,
  Settings,
  TrendingUp,
  LogOut,
  Boxes,
  ShieldCheck,
  LifeBuoy,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';

export type AdminSection =
  | 'DASHBOARD'
  | 'PRODUCTS'
  | 'INACTIVE_PRODUCTS'
  | 'STOCK'
  | 'CATEGORIES'
  | 'ORDERS'
  | 'SUPPORT'
  | 'CUSTOMERS'
  | 'PROFIT_RANKING'
  | 'SETTINGS'
  | 'PHASE3';

interface AdminSidebarProps {
  section: AdminSection;
  goToSection: (target: AdminSection) => void;
  pendingAddrCount: number;
  pendingOrdCount: number;
  activeProductsCount: number;
  inactiveProductsCount: number;
  categoriesCount: number;
  ordersCount: number;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  section,
  goToSection,
  pendingAddrCount,
  pendingOrdCount,
  activeProductsCount,
  inactiveProductsCount,
  categoriesCount,
  ordersCount,
}) => {
  const { logout } = useApp();
  const navigate = useNavigate();

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
    badgeTone?: 'amber' | 'neutral';
  }> = [
    { id: 'DASHBOARD', label: 'Visão Geral', icon: LayoutDashboard },
    {
      id: 'PRODUCTS',
      label: 'Produtos & Kits',
      icon: Package,
      badge: activeProductsCount,
      badgeTone: 'neutral',
    },
    {
      id: 'INACTIVE_PRODUCTS',
      label: 'Inativos / Sem Estoque',
      icon: AlertTriangle,
      badge: inactiveProductsCount,
      badgeTone: inactiveProductsCount > 0 ? 'amber' : 'neutral',
    },
    { id: 'STOCK', label: 'Estoque & Movimentações', icon: Boxes },
    {
      id: 'CATEGORIES',
      label: 'Categorias',
      icon: Tags,
      badge: categoriesCount,
      badgeTone: 'neutral',
    },
    {
      id: 'ORDERS',
      label: 'Pedidos',
      icon: ShoppingBag,
      badge: pendingOrdCount > 0 ? pendingOrdCount : ordersCount,
      badgeTone: pendingOrdCount > 0 ? 'amber' : 'neutral',
    },
    { id: 'SUPPORT', label: 'Central de Ajuda', icon: LifeBuoy },
    {
      id: 'CUSTOMERS',
      label: 'Clientes & Frete',
      icon: Users,
      badge: pendingAddrCount > 0 ? pendingAddrCount : undefined,
      badgeTone: 'amber',
    },
    {
      id: 'PROFIT_RANKING',
      label: 'Lucro & Ranking',
      icon: TrendingUp,
    },
    { id: 'SETTINGS', label: 'Configurações', icon: Settings },
    { id: 'PHASE3', label: 'Admin 2.0 / Fase 3', icon: ShieldCheck },
  ];

  return (
    <aside className="w-full lg:w-64 min-w-0 shrink-0 bg-white border border-stone-200 rounded-xl p-3 space-y-1.5">
      <div className="px-3 py-2 border-b border-stone-100 mb-1">
        <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Gestão DeepShop
        </div>
        <div className="text-sm font-bold text-zinc-900">Painel do Administrador</div>
      </div>

      <nav className="flex flex-wrap lg:flex-col gap-1 pb-1 lg:pb-0 min-w-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => goToSection(item.id)}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-700 hover:bg-stone-100 hover:text-zinc-900'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full tabular-nums ${
                    active
                      ? 'bg-white/20 text-white'
                      : item.badgeTone === 'amber'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-stone-100 text-zinc-600'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="pt-2 border-t border-stone-100 mt-2">
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/');
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors cursor-pointer"
          title="Sair da conta de administrador"
        >
          <span className="inline-flex items-center gap-2">
            <LogOut className="w-4 h-4 text-red-600" />
            <span>Sair da Conta Admin</span>
          </span>
        </button>
      </div>
    </aside>
  );
};
