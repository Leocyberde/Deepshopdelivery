import { isIP } from 'node:net';

export interface ParsedSiteUrl {
  url: URL;
  origin: string;
}

function invalidSiteUrl(reason: string): never {
  // Não incluir o valor recebido na mensagem: pode ter sido configurado incorretamente e
  // deve permanecer fora de logs e respostas HTTP.
  throw new Error(`SITE_URL ${reason}.`);
}

function isLocalOrUnspecifiedHostname(input: string): boolean {
  const hostname = input
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '0.0.0.0' || hostname === '::' || hostname === '::1') return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const firstOctet = Number(hostname.split('.')[0]);
    return firstOctet === 127;
  }
  if (ipVersion === 6 && /^::ffff:(?:7f[0-9a-f]{2}:|127\.)/i.test(hostname)) return true;
  return false;
}

/**
 * Parseia SITE_URL como URL-base do site. Caminho além de `/`, query e fragmento não
 * têm uso legítimo no projeto: CORS compara a origin e o retorno de pagamento é criado
 * na raiz da mesma origin. Em produção, a origin precisa usar HTTPS e não pode ser local.
 * `null` só é permitido quando a variável está ausente em ambiente não produtivo.
 */
export function parseSiteUrl(raw: string | undefined, production: boolean): ParsedSiteUrl | null {
  if (raw === undefined || raw === '') {
    if (production) invalidSiteUrl('é obrigatório em produção');
    return null;
  }
  if (raw !== raw.trim() || /[\u0000-\u0020\u007f]/.test(raw)) {
    invalidSiteUrl('não pode conter espaços ou caracteres de controle');
  }
  if (raw === '*' || raw.includes('?') || raw.includes('#')) {
    invalidSiteUrl('deve ser uma URL-base única, sem wildcard, query ou fragmento');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalidSiteUrl('deve ser uma URL absoluta válida');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    invalidSiteUrl('deve usar o esquema HTTP ou HTTPS');
  }
  if (!url.hostname || url.origin === 'null') {
    invalidSiteUrl('deve possuir hostname e origin válidos');
  }
  const rawAuthorityHasUserInfo = /^https?:\/\/[^/?#]*@/i.test(raw);
  if (url.username || url.password || rawAuthorityHasUserInfo) {
    invalidSiteUrl('não pode incluir credenciais na URL');
  }
  if (url.pathname !== '/') {
    invalidSiteUrl('deve apontar para a raiz do site, sem caminho adicional');
  }
  if (production && url.protocol !== 'https:') {
    invalidSiteUrl('deve usar HTTPS em produção');
  }
  if (production && isLocalOrUnspecifiedHostname(url.hostname)) {
    invalidSiteUrl('não pode usar localhost ou endereço de loopback em produção');
  }

  return { url, origin: url.origin };
}
