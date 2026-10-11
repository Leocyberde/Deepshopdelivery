import type { HelmetOptions } from 'helmet';

/**
 * CSP de produção baseada no inventário da Fase Pré-operacional #5.
 *
 * Dependências observadas no código:
 * - script/style/font Google Fonts: index.html e CSS servido por fonts.googleapis.com / fonts.gstatic.com;
 * - ViaCEP: fallback client-side em src/utils/validators.ts;
 * - data:/blob: prévia local de imagens/vídeos no painel (AdminPanelPage.tsx);
 * - style-src-attr unsafe-inline: estilos inline via props React em componentes (ex.: ProductMedia.tsx).
 *
 * Chamadas a BrasilAPI, Mercado Pago e CallMeBot são server-side; URLs wa.me são navegação,
 * não chamadas fetch do documento. Nenhum iframe, worker de terceiros, analytics ou WebSocket
 * é carregado pelo frontend. Não há necessidade de unsafe-eval.
 */
export function getProductionCspOptions(): NonNullable<HelmetOptions['contentSecurityPolicy']> {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      styleSrcElem: ["'self'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'https://viacep.com.br'],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  };
}
