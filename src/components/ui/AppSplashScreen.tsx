import React, { useState, useEffect } from 'react';
import { ShoppingBagFaceBadge } from './AchadinhosLogo.tsx';

// Tela de Carregamento Azul (#087BFF) que já cai direto na animação da cestinha + logo com a Bolsa de Compras e Carinha dentro
export const AppSplashScreen: React.FC<{
  forceOpen?: boolean;
  onClose?: () => void;
}> = ({ forceOpen = false, onClose }) => {
  const [visible, setVisible] = useState<boolean>(() => {
    if (forceOpen) return true;
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('auto_install') === '1') return false;
    const seen = sessionStorage.getItem('achadinhos_splash_seen_v3');
    return seen !== 'true';
  });

  const [step, setStep] = useState<'basket' | 'logo'>('basket');

  useEffect(() => {
    if (!visible) return;

    const t1 = window.setTimeout(() => setStep('logo'), 1300);
    const t2 = window.setTimeout(() => {
      sessionStorage.setItem('achadinhos_splash_seen_v3', 'true');
      setVisible(false);
      onClose?.();
    }, 2000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Carregando DeepShop Delivery"
      onClick={() => {
        sessionStorage.setItem('achadinhos_splash_seen_v3', 'true');
        setVisible(false);
        onClose?.();
      }}
      className="fixed inset-0 z-[120] bg-[#087BFF] text-white flex flex-col items-center justify-center select-none cursor-pointer overflow-hidden"
    >
      {step === 'basket' ? (
        <div className="flex flex-col items-center justify-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
          {/* Logo compacta no topo da animação com a bolsa de compras e carinha dentro */}
          <div className="inline-flex items-center font-display font-black tracking-tight text-white text-3xl sm:text-4xl leading-none mb-1">
            <span>achadinh</span>
            <span className="inline-flex items-center justify-center mx-1 -translate-y-0.5">
              <ShoppingBagFaceBadge
                className="w-8 h-8 sm:w-9 sm:h-9"
                bagFill="#FFFFFF"
                bagStroke="#09090B"
                handleStroke="#FFFFFF"
              />
            </span>
            <span>s</span>
          </div>

          {/* Cestinha inclinada animada estilo iFood com a Bolsa de Compras + Carinha dentro */}
          <div className="relative w-44 h-44 flex items-center justify-center">
            <svg viewBox="0 0 180 180" fill="none" className="w-44 h-44">
              <g className="animate-bounce">
                <g transform="translate(72, 26) rotate(12)">
                  <rect
                    x="0"
                    y="0"
                    width="44"
                    height="44"
                    rx="8"
                    fill="#09090B"
                    stroke="#FFFFFF"
                    strokeWidth="3"
                  />
                  <line x1="22" y1="0" x2="22" y2="44" stroke="#C084FC" strokeWidth="5" />
                  <line x1="0" y1="22" x2="44" y2="22" stroke="#C084FC" strokeWidth="5" />
                </g>

                {/* Bolsa de compras com carinha dentro caindo na cesta */}
                <g transform="translate(38, 42) rotate(-14)">
                  <path
                    d="M15 10V6C15 2.5 18.5 0 23 0C27.5 0 31 2.5 31 6V10"
                    stroke="#FFFFFF"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <rect
                    x="0"
                    y="8"
                    width="46"
                    height="42"
                    rx="10"
                    fill="#FFFFFF"
                    stroke="#09090B"
                    strokeWidth="3"
                  />
                  <circle cx="16" cy="25" r="4.5" fill="#EAF8FF" stroke="#087BFF" strokeWidth="2.2" />
                  <circle cx="16.8" cy="24.5" r="1.8" fill="#09090B" />
                  <circle cx="30" cy="25" r="4.5" fill="#EAF8FF" stroke="#087BFF" strokeWidth="2.2" />
                  <circle cx="30.8" cy="24.5" r="1.8" fill="#09090B" />
                  <path
                    d="M14 36C18 41 28 41 32 36"
                    stroke="#087BFF"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </g>
              </g>

              <g transform="rotate(-10 90 115)">
                <path
                  d="M28 82H152L134 142H46L28 82Z"
                  fill="#087BFF"
                  fillOpacity="0.35"
                  stroke="#FFFFFF"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                />
                <line x1="34" y1="102" x2="146" y2="102" stroke="#FFFFFF" strokeWidth="2.8" />
                <line x1="40" y1="122" x2="140" y2="122" stroke="#FFFFFF" strokeWidth="2.8" />
                <line x1="58" y1="82" x2="66" y2="142" stroke="#FFFFFF" strokeWidth="2.8" />
                <line x1="90" y1="82" x2="90" y2="142" stroke="#FFFFFF" strokeWidth="2.8" />
                <line x1="122" y1="82" x2="114" y2="142" stroke="#FFFFFF" strokeWidth="2.8" />
              </g>

              <ellipse cx="92" cy="162" rx="28" ry="4" fill="#09090B" fillOpacity="0.35" />
            </svg>
          </div>

          <p className="text-white font-sans font-bold text-base sm:text-lg tracking-tight text-center px-6">
            Peça utilidades, acessórios e novidades
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-200">
          <div className="inline-flex items-center font-display font-black tracking-tight text-white text-5xl sm:text-6xl leading-none">
            <span>achadinh</span>
            <span className="inline-flex items-center justify-center mx-1.5 -translate-y-0.5">
              <ShoppingBagFaceBadge
                className="w-12 h-12 sm:w-14 sm:h-14"
                bagFill="#FFFFFF"
                bagStroke="#09090B"
                handleStroke="#FFFFFF"
              />
            </span>
            <span>s</span>
          </div>

          <div className="inline-flex items-center gap-2 mt-2">
            <span className="px-2.5 py-0.5 rounded-md bg-[#09090B] text-white font-sans font-black text-xs tracking-widest uppercase">
              DELIVERY
            </span>
            <svg viewBox="0 0 44 28" fill="none" className="w-9 h-6">
              <line x1="1" y1="14" x2="7" y2="14" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
              <line x1="3" y1="19" x2="8" y2="19" stroke="#09090B" strokeWidth="2" strokeLinecap="round" />
              <rect x="9" y="7" width="9" height="9" rx="2" fill="#FFFFFF" stroke="#09090B" strokeWidth="1.5" />
              <circle cx="23" cy="5.5" r="4.2" fill="#09090B" stroke="#FFFFFF" strokeWidth="1.5" />
              <path d="M18 17L21 10L30 12" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 17H26L30 20H37L33 10H29" fill="#09090B" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
              <circle cx="15" cy="22" r="4.2" fill="#09090B" stroke="#FFFFFF" strokeWidth="1.8" />
              <circle cx="34" cy="22" r="4.2" fill="#09090B" stroke="#FFFFFF" strokeWidth="1.8" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};
