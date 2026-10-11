import React from 'react';
import { AchadinhosDeliveryLogo } from './AchadinhosLogo.tsx';

// Desenho ilustrativo passo a passo completo:
// 1. Vitrine -> 2. Sacola -> 3. Pedido -> 4. Aprovação do ADM -> 5. Pagamento pelo WhatsApp direto com ADM -> 6. Entrega ao Cliente Feliz
export const LogisticsFlowIllustration: React.FC = () => {
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-gradient-to-br from-[#EAF8FF] via-white to-[#EAF8FF] border-2 border-[#087BFF]/30 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Cabeçalho do Desenho Ilustrativo */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#087BFF]/20 pb-3">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full bg-[#087BFF] text-white text-[10px] sm:text-xs font-extrabold uppercase tracking-wider">
            Como Funciona
          </span>
          <span className="text-xs sm:text-sm font-extrabold text-zinc-900">
            Da Vitrine até a Entrega ao Cliente Feliz
          </span>
        </div>
        <span className="text-[11px] font-bold text-[#087BFF]">
          Rápido, seguro e direto com o ADM
        </span>
      </div>

      {/* Grade Ilustrada com as 6 Etapas Conectadas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 relative">
        {/* ETAPA 1: VITRINE */}
        <div className="relative bg-white border-2 border-[#087BFF]/25 rounded-2xl p-3 flex flex-col items-center text-center shadow-2xs">
          <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-[#09090B] text-white text-[10px] font-black flex items-center justify-center">
            1
          </span>
          <svg viewBox="0 0 96 80" fill="none" className="w-20 h-16 sm:w-24 sm:h-20">
            {/* Celular mostrando a Vitrine */}
            <rect x="26" y="6" width="44" height="68" rx="8" fill="#09090B" />
            <rect x="30" y="12" width="36" height="54" rx="4" fill="#FFFFFF" />
            {/* Topo azul da vitrine no celular */}
            <rect x="30" y="12" width="36" height="10" rx="2" fill="#087BFF" />
            {/* Cards de produtos na vitrine */}
            <rect x="33" y="25" width="14" height="16" rx="2" fill="#EAF8FF" stroke="#087BFF" strokeWidth="1.5" />
            <rect x="49" y="25" width="14" height="16" rx="2" fill="#EAF8FF" stroke="#087BFF" strokeWidth="1.5" />
            <rect x="33" y="44" width="30" height="8" rx="2" fill="#087BFF" />
            {/* Etiqueta de oferta */}
            <circle cx="68" cy="22" r="10" fill="#087BFF" stroke="#FFFFFF" strokeWidth="2" />
            <text x="68" y="25" textAnchor="middle" fill="#FFFFFF" fontSize="7" fontWeight="900">
              %
            </text>
          </svg>
          <div className="text-xs font-extrabold text-zinc-900 mt-1">1. Vitrine</div>
          <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">
            Escolha seus produtos e ofertas no app
          </p>
        </div>

        {/* ETAPA 2: SACOLA */}
        <div className="relative bg-white border-2 border-[#087BFF]/25 rounded-2xl p-3 flex flex-col items-center text-center shadow-2xs">
          <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-[#09090B] text-white text-[10px] font-black flex items-center justify-center">
            2
          </span>
          <svg viewBox="0 0 96 80" fill="none" className="w-20 h-16 sm:w-24 sm:h-20">
            {/* Caixinhas entrando na sacola */}
            <rect x="34" y="8" width="14" height="12" rx="2" fill="#09090B" transform="rotate(-10 34 8)" />
            <rect x="50" y="6" width="14" height="12" rx="2" fill="#A855F7" transform="rotate(12 50 6)" />
            {/* Alça da Bolsa */}
            <path d="M38 26V20C38 14.5 42.5 11 48 11C53.5 11 58 14.5 58 20V26" stroke="#09090B" strokeWidth="3.5" strokeLinecap="round" />
            {/* Corpo da Bolsa com a Carinha DeepShop */}
            <path d="M26 26H70L74 68H22L26 26Z" fill="#FFFFFF" stroke="#087BFF" strokeWidth="3.5" strokeLinejoin="round" />
            {/* Olhinhos e sorriso dentro da sacola */}
            <circle cx="40" cy="44" r="5" fill="#EAF8FF" stroke="#087BFF" strokeWidth="2.4" />
            <circle cx="41" cy="43.5" r="2" fill="#09090B" />
            <circle cx="56" cy="44" r="5" fill="#EAF8FF" stroke="#087BFF" strokeWidth="2.4" />
            <circle cx="57" cy="43.5" r="2" fill="#09090B" />
            <path d="M38 55C43 60 53 60 58 55" stroke="#087BFF" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div className="text-xs font-extrabold text-zinc-900 mt-1">2. Sacola</div>
          <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">
            Adicione tudo na sua bolsa de compras
          </p>
        </div>

        {/* ETAPA 3: PEDIDO */}
        <div className="relative bg-white border-2 border-[#087BFF]/25 rounded-2xl p-3 flex flex-col items-center text-center shadow-2xs">
          <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-[#09090B] text-white text-[10px] font-black flex items-center justify-center">
            3
          </span>
          <svg viewBox="0 0 96 80" fill="none" className="w-20 h-16 sm:w-24 sm:h-20">
            {/* Bloco do Pedido */}
            <rect x="24" y="10" width="44" height="58" rx="6" fill="#FFFFFF" stroke="#09090B" strokeWidth="3" />
            <rect x="34" y="6" width="24" height="8" rx="3" fill="#087BFF" />
            {/* Linhas de itens com check */}
            <circle cx="33" cy="26" r="3.5" fill="#087BFF" />
            <line x1="40" y1="26" x2="58" y2="26" stroke="#09090B" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="33" cy="38" r="3.5" fill="#087BFF" />
            <line x1="40" y1="38" x2="58" y2="38" stroke="#09090B" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="33" cy="50" r="3.5" fill="#087BFF" />
            <line x1="40" y1="50" x2="54" y2="50" stroke="#09090B" strokeWidth="2.5" strokeLinecap="round" />
            {/* Aviãozinho / Seta de envio do pedido */}
            <circle cx="68" cy="54" r="12" fill="#087BFF" />
            <path d="M63 54L73 49L70 59L68 55L63 54Z" fill="#FFFFFF" />
          </svg>
          <div className="text-xs font-extrabold text-zinc-900 mt-1">3. Pedido</div>
          <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">
            Confirme seu endereço e gere o pedido
          </p>
        </div>

        {/* ETAPA 4: APROVAÇÃO DO ADM */}
        <div className="relative bg-white border-2 border-[#087BFF]/25 rounded-2xl p-3 flex flex-col items-center text-center shadow-2xs">
          <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-[#087BFF] text-white text-[10px] font-black flex items-center justify-center">
            4
          </span>
          <svg viewBox="0 0 96 80" fill="none" className="w-20 h-16 sm:w-24 sm:h-20">
            {/* Personagem ADM conferindo e aprovando */}
            <circle cx="44" cy="24" r="11" fill="#EAF8FF" stroke="#09090B" strokeWidth="2.8" />
            {/* Boné azul do ADM */}
            <path d="M33 20C33 14 38 11 44 11C50 11 55 14 55 20H33Z" fill="#087BFF" />
            {/* Olhinhos e sorriso do ADM */}
            <circle cx="40.5" cy="24" r="1.6" fill="#09090B" />
            <circle cx="47.5" cy="24" r="1.6" fill="#09090B" />
            <path d="M40.5 28.5C42.5 30.5 45.5 30.5 47.5 28.5" stroke="#087BFF" strokeWidth="2" strokeLinecap="round" />
            {/* Corpo / Painel do ADM */}
            <path d="M26 58C26 46 34 40 44 40C54 40 62 46 62 58" fill="#09090B" />
            <rect x="35" y="46" width="18" height="9" rx="2" fill="#087BFF" />
            <text x="44" y="52.5" textAnchor="middle" fill="#FFFFFF" fontSize="6" fontWeight="900">
              ADM
            </text>
            {/* Selo grande de Aprovado */}
            <circle cx="68" cy="48" r="14" fill="#087BFF" stroke="#FFFFFF" strokeWidth="2.5" />
            <path d="M62 48L66.5 52.5L75 43.5" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-xs font-extrabold text-zinc-900 mt-1">4. Aprovação do ADM</div>
          <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">
            O ADM confere e aprova seu pedido na hora
          </p>
        </div>

        {/* ETAPA 5: PAGAMENTO PELO WHATSAPP DIRETO COM ADM */}
        <div className="relative bg-white border-2 border-[#087BFF]/25 rounded-2xl p-3 flex flex-col items-center text-center shadow-2xs">
          <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-[#087BFF] text-white text-[10px] font-black flex items-center justify-center">
            5
          </span>
          <svg viewBox="0 0 96 80" fill="none" className="w-20 h-16 sm:w-24 sm:h-20">
            {/* Balão de conversa WhatsApp + Pix direto com ADM */}
            <path
              d="M18 22C18 14.8203 23.8203 9 31 9H61C68.1797 9 74 14.8203 74 22V44C74 51.1797 68.1797 57 61 57H34L20 66V54.5C18.7 51.5 18 48 18 44V22Z"
              fill="#FFFFFF"
              stroke="#09090B"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {/* Símbolo Pix + WhatsApp */}
            <rect x="25" y="17" width="42" height="14" rx="4" fill="#087BFF" />
            <text x="46" y="26.5" textAnchor="middle" fill="#FFFFFF" fontSize="7.5" fontWeight="900">
              PIX + WHATSAPP
            </text>
            <rect x="25" y="36" width="32" height="12" rx="4" fill="#EAF8FF" stroke="#087BFF" strokeWidth="1.5" />
            <text x="41" y="44" textAnchor="middle" fill="#09090B" fontSize="6.5" fontWeight="900">
              DIRETO C/ ADM
            </text>
            <circle cx="67" cy="44" r="9" fill="#09090B" />
            <path d="M63.5 44L66 46.5L71 41.5" stroke="#C084FC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-xs font-extrabold text-zinc-900 mt-1">
            5. Pagamento no WhatsApp
          </div>
          <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">
            Pagamento fácil direto com o ADM no WhatsApp
          </p>
        </div>

        {/* ETAPA 6: ENTREGA AO CLIENTE FELIZ */}
        <div className="relative bg-white border-2 border-[#087BFF] rounded-2xl p-3 flex flex-col items-center text-center shadow-xs">
          <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-[#087BFF] text-white text-[10px] font-black flex items-center justify-center">
            6
          </span>
          <svg viewBox="0 0 96 80" fill="none" className="w-20 h-16 sm:w-24 sm:h-20">
            {/* Motinha de Delivery na esquerda */}
            <g transform="translate(6, 26)">
              <rect x="2" y="8" width="11" height="10" rx="2" fill="#087BFF" stroke="#09090B" strokeWidth="1.8" />
              <circle cx="19" cy="6" r="5" fill="#09090B" stroke="#087BFF" strokeWidth="1.8" />
              <path d="M6 20H22L26 23H33L29 12H25" fill="#087BFF" stroke="#09090B" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="10" cy="25" r="4.8" fill="#09090B" />
              <circle cx="10" cy="25" r="2" fill="#FFFFFF" />
              <circle cx="29" cy="25" r="4.8" fill="#09090B" />
              <circle cx="29" cy="25" r="2" fill="#FFFFFF" />
            </g>

            {/* Pacote DeepShop sendo entregue */}
            <rect x="41" y="32" width="14" height="13" rx="2.5" fill="#087BFF" stroke="#09090B" strokeWidth="2" />
            <path d="M45 39C46.5 41 49.5 41 51 39" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />

            {/* Cliente Feliz Sorrindo de Braços Abertos */}
            <circle cx="71" cy="24" r="11" fill="#EAF8FF" stroke="#09090B" strokeWidth="2.8" />
            <circle cx="67.5" cy="22" r="1.8" fill="#09090B" />
            <circle cx="74.5" cy="22" r="1.8" fill="#09090B" />
            {/* Sorriso bem feliz do cliente */}
            <path d="M66 26.5C68.5 31 73.5 31 76 26.5" stroke="#087BFF" strokeWidth="2.6" strokeLinecap="round" />
            {/* Braços comemorando e corpo */}
            <path d="M56 36L65 42H77L86 34" stroke="#09090B" strokeWidth="3" strokeLinecap="round" />
            <path d="M61 58C61 47 65 42 71 42C77 42 81 47 81 58" fill="#087BFF" stroke="#09090B" strokeWidth="2.5" />
            {/* Estrelinhas / Coração de cliente feliz */}
            <path d="M71 6L72.5 9.5L76 11L72.5 12.5L71 16L69.5 12.5L66 11L69.5 9.5L71 6Z" fill="#087BFF" />
          </svg>
          <div className="text-xs font-extrabold text-[#087BFF] mt-1">
            6. Cliente Feliz!
          </div>
          <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">
            Entrega rápida na palma da mão em poucas horas
          </p>
        </div>
      </div>

      {/* Rodapé da Ilustração com a Logo DeepShop Delivery */}
      <div className="bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <AchadinhosDeliveryLogo size="sm" />
        <div className="text-[11px] leading-tight text-right">
          <div className="font-bold text-zinc-900">Na palma da mão em poucas horas</div>
          <div className="text-[#087BFF] font-semibold">
            Delivery exclusivo: Região de Itatiba · Correios p/ outras cidades
          </div>
        </div>
      </div>
    </div>
  );
};
