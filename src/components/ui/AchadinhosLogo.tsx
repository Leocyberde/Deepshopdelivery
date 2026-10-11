import React from 'react';

const ICON_SRC = '/brand-assets/deepshop-icon-transparent.png';
const LOGO_SRC = '/brand-assets/deepshop-logo.png';

// Compatibilidade de API: o símbolo oficial agora é a sacola presente na logo enviada.
export const ShoppingBagFaceBadge: React.FC<{
  className?: string;
  bagFill?: string;
  bagStroke?: string;
  handleStroke?: string;
}> = ({ className = 'w-6 h-6' }) => (
  <img
    src={ICON_SRC}
    className={className}
    alt=""
    aria-hidden="true"
  />
);

// Ícone oficial do aplicativo: somente o símbolo da sacola da logo DeepShop Delivery.
export const AchadinhosAppIconSVG: React.FC<{ className?: string }> = ({
  className = 'w-16 h-16',
}) => (
  <img
    src="/pwa-192x192.png"
    className={className}
    alt="Ícone DeepShop Delivery"
  />
);

// Logo oficial horizontal fornecida pelo proprietário do projeto.
export const AchadinhosDeliveryLogo: React.FC<{
  size?: 'sm' | 'lg';
  theme?: 'light' | 'dark';
  className?: string;
}> = ({ size = 'sm', className = '' }) => {
  const isLarge = size === 'lg';
  return (
    <span
      aria-label="DeepShop Delivery"
      className={`inline-flex items-center select-none rounded-lg bg-[#050B1C] px-2 py-1 ${className}`}
    >
      <img
        src={LOGO_SRC}
        className={`h-auto w-auto object-contain ${isLarge ? 'max-w-[300px] sm:max-w-[380px]' : 'max-w-[150px] sm:max-w-[190px]'}`}
        alt="DeepShop Delivery"
      />
    </span>
  );
};
