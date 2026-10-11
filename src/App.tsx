import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.tsx';
import { Navbar } from './components/Navbar.tsx';
import { StorefrontPage } from './pages/StorefrontPage.tsx';
import { ProductDetailPage } from './pages/ProductDetailPage.tsx';
import { CartPage } from './pages/CartPage.tsx';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { PaymentReturnPage } from './pages/PaymentReturnPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { CustomerAccountPage } from './pages/CustomerAccountPage.tsx';
import { SupportCenterPage } from './pages/SupportCenterPage.tsx';
import { AdminPanelPage } from './pages/AdminPanelPage.tsx';
import { LegalPage } from './pages/LegalPage.tsx';
import { Footer } from './components/Footer.tsx';
import { BottomNav } from './components/BottomNav.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </BrowserRouter>
  );
}

const AppShell: React.FC = () => {
  const location = useLocation();
  const { user } = useApp();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const showBottomNav = user?.role === 'CUSTOMER' && location.pathname !== '/checkout';

  return (
    <div className={`min-h-screen bg-[#F5F8FC] text-zinc-900 flex flex-col ${showBottomNav ? 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}>
      {!isAdminRoute && <Navbar />}
      <div className="flex-1">
            <Routes>
              {/* Rotas públicas e do cliente */}
              <Route path="/" element={<StorefrontPage />} />
              <Route path="/produto/:id" element={<ProductDetailPage />} />
              <Route path="/carrinho" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/pagamento/sucesso" element={<PaymentReturnPage />} />
              <Route path="/pagamento/falha" element={<PaymentReturnPage />} />
              <Route path="/pagamento/pendente" element={<PaymentReturnPage />} />
              <Route path="/pagamento/retorno" element={<PaymentReturnPage />} />
              <Route path="/login" element={<AuthPage />} />
              <Route path="/cadastro" element={<AuthPage />} />
              <Route path="/minha-conta" element={<CustomerAccountPage />} />
              <Route path="/minha-conta/pedidos" element={<CustomerAccountPage />} />
              <Route path="/minha-conta/notificacoes" element={<CustomerAccountPage />} />
              <Route path="/minha-conta/perfil" element={<CustomerAccountPage />} />
              <Route path="/minha-conta/central-ajuda" element={<SupportCenterPage />} />
              <Route path="/privacidade" element={<LegalPage />} />
              <Route path="/termos" element={<LegalPage />} />
              <Route path="/trocas" element={<LegalPage />} />

              {/* Rotas do painel administrativo */}
              <Route path="/admin" element={<AdminPanelPage />} />
              <Route path="/admin/produtos" element={<AdminPanelPage />} />
              <Route path="/admin/produtos-inativos" element={<AdminPanelPage />} />
              <Route path="/admin/estoque" element={<AdminPanelPage />} />
              <Route path="/admin/categorias" element={<AdminPanelPage />} />
              <Route path="/admin/pedidos" element={<AdminPanelPage />} />
              <Route path="/admin/central-ajuda" element={<AdminPanelPage />} />
              <Route path="/admin/clientes" element={<AdminPanelPage />} />
              <Route path="/admin/configuracoes" element={<AdminPanelPage />} />
              <Route path="/admin/lucro-ranking" element={<AdminPanelPage />} />
              <Route path="/admin/fase-3" element={<AdminPanelPage />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
      </div>
      {!isAdminRoute && <Footer />}
      {showBottomNav && <BottomNav />}
    </div>
  );
};
