import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Download, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall.ts';
import { AchadinhosAppIconSVG } from './AchadinhosLogo.tsx';

const POPUP_DISMISSED_KEY = 'achadinhos_pwa_popup_dismissed_v5';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isInIframe, install } = usePWAInstall();
  const location = useLocation();
  const [showPopup, setShowPopup] = useState(false);
  const [status, setStatus] = useState<'idle' | 'installing' | 'installed' | 'already_installed_hint'>('idle');

  const isAutoInstallTab =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('auto_install') === '1';

  // Exibe automaticamente o pequeno pop-up no canto superior direito ao abrir a loja
  useEffect(() => {
    if (isInstalled) return;
    if (location.pathname.startsWith('/admin')) return;

    if (isAutoInstallTab) {
      setShowPopup(true);
      return;
    }

    const alreadyDismissed = sessionStorage.getItem(POPUP_DISMISSED_KEY);
    if (alreadyDismissed === 'true') return;

    const timer = window.setTimeout(() => {
      setShowPopup(true);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [isInstalled, location.pathname, isAutoInstallTab]);

  // Se abriu na aba rápida de instalação (?auto_install=1), tenta disparar o prompt assim que disponível
  // e fecha a aba automaticamente logo após aceitar!
  useEffect(() => {
    if (!isAutoInstallTab) return;
    if (isInstallable && status === 'idle') {
      install().then((res) => {
        if (res === 'accepted') {
          setStatus('installed');
          window.setTimeout(() => {
            window.close();
          }, 900);
        }
      });
    }
  }, [isAutoInstallTab, isInstallable, status, install]);

  if (isInstalled && status !== 'installed') {
    return null;
  }

  const handleDismiss = () => {
    sessionStorage.setItem(POPUP_DISMISSED_KEY, 'true');
    setShowPopup(false);
    if (isAutoInstallTab) {
      window.close();
    }
  };

  const handleInstallDirect = async () => {
    // Se estiver dentro do iframe do editor AI Studio (onde o Android bloqueia instalação direta),
    // abre a janela auxiliar ?auto_install=1 que dispara a instalação e fecha sozinha em seguida!
    if (isInIframe && !isInstallable) {
      const url = `${window.location.origin}/?auto_install=1`;
      window.open(url, '_blank', 'noopener');
      return;
    }

    setShowPopup(true);
    setStatus('installing');

    const result = await install();
    if (result === 'accepted') {
      setStatus('installed');
      sessionStorage.setItem(POPUP_DISMISSED_KEY, 'true');
      window.setTimeout(() => {
        setShowPopup(false);
        if (isAutoInstallTab) {
          window.close();
        }
      }, 1200);
      return;
    }

    if (result === 'dismissed') {
      setStatus('idle');
      if (isAutoInstallTab) {
        window.close();
      }
      return;
    }

    setStatus('already_installed_hint');
  };

  const autoInstallUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/?auto_install=1` : '/?auto_install=1';

  return (
    <>
      {!isInstalled && (
        isInIframe && !isInstallable ? (
          <a
            href={autoInstallUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-bold text-white bg-[#087BFF] hover:bg-[#0666D6] rounded-lg shadow-xs transition-colors whitespace-nowrap cursor-pointer"
            title="Baixar aplicativo DeepShop Delivery"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Baixar App</span>
            <span className="sm:hidden">App</span>
          </a>
        ) : (
          <button
            type="button"
            onClick={handleInstallDirect}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-bold text-white bg-[#087BFF] hover:bg-[#0666D6] rounded-lg shadow-xs transition-colors whitespace-nowrap cursor-pointer"
            title="Baixar aplicativo DeepShop Delivery"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Baixar App</span>
            <span className="sm:hidden">App</span>
          </button>
        )
      )}

      {showPopup &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-label="Baixar aplicativo DeepShop Delivery"
            className="fixed top-16 right-3 sm:right-6 z-[90] w-[280px] sm:w-[310px] bg-white border-2 border-[#087BFF]/40 rounded-2xl p-3.5 shadow-xl shadow-zinc-900/15 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <button
              type="button"
              onClick={handleDismiss}
              className="absolute top-2.5 right-2.5 p-1 rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-stone-100 transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 pr-5">
              <AchadinhosAppIconSVG className="w-11 h-11 rounded-xl shrink-0 shadow-xs" />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-zinc-900 leading-tight truncate">
                  App DeepShop Delivery
                </h4>
                <p className="text-[11px] text-zinc-600 leading-snug mt-0.5">
                  {isAutoInstallTab
                    ? 'Toque abaixo para confirmar a instalação (esta aba fechará sozinha):'
                    : 'Instale grátis direto no seu celular!'}
                </p>
              </div>
            </div>

            <div className="mt-3">
              {status === 'idle' && (
                isInIframe && !isInstallable ? (
                  <a
                    href={autoInstallUrl}
                    target="_blank"
                    rel="noopener"
                    onClick={() => setShowPopup(false)}
                    className="w-full py-2 px-3 bg-[#087BFF] hover:bg-[#0666D6] active:scale-[0.99] text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Baixar Aplicativo Agora</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={handleInstallDirect}
                    className="w-full py-2 px-3 bg-[#087BFF] hover:bg-[#0666D6] active:scale-[0.99] text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isAutoInstallTab ? 'Confirmar Instalação Agora' : 'Baixar Aplicativo Agora'}
                    </span>
                  </button>
                )
              )}

              {status === 'installing' && (
                <div className="py-2 px-3 rounded-xl bg-sky-50 border border-sky-200 text-[#0666D6] text-xs font-semibold text-center">
                  Abrindo confirmação do Android...
                </div>
              )}

              {status === 'already_installed_hint' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-zinc-700 bg-sky-50 border border-sky-200 rounded-xl p-2 leading-snug">
                    O aplicativo <strong>DeepShop</strong> já está instalado no seu celular! Se
                    quiser reinstalar do zero, remova o ícone antigo da tela inicial e toque abaixo:
                  </p>
                  <button
                    type="button"
                    onClick={handleInstallDirect}
                    className="w-full py-2 px-3 bg-[#087BFF] hover:bg-[#0666D6] text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Tentar Novamente</span>
                  </button>
                </div>
              )}

              {status === 'installed' && (
                <div className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-sky-50 border border-sky-200 text-[#0666D6] text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 text-[#087BFF] shrink-0" />
                  <span>Instalando! Fechando janela...</span>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
