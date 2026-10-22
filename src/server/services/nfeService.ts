import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

/**
 * NF-e emitida SOB DEMANDA: nada é enviado à Sefaz automaticamente quando o pedido é pago.
 * O admin aciona o botão "Emitir NF-e" no pedido (útil para encomendas: só se emite depois que o produto chegou).
 * A assinatura (certificado A1) e a transmissão SOAP/mTLS ficam no serviço emissor (NFE_SERVICE_URL);
 * este módulo monta os dados, controla numeração/estado e guarda XML + DANFE.
 */
/** CSOSN que o emissor sabe montar (Simples sem ST e não tributadas). */
export const NFE_SUPPORTED_CSOSN = ['102', '103', '300', '400'];
export const NFE_ELIGIBLE_ORDER_STATUSES = ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const STUCK_PROCESSING_MINUTES = 5;
const EMITTER_TIMEOUT_MS = 90_000;
const COMPLEMENTARY_INFO = 'Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de ICMS, de ISS e de IPI.';

export class NfeError extends Error {
  constructor(public status: number, message: string, public problems: string[] = []) { super(message); }
}

const onlyDigits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const env = (name: string) => String(process.env[name] ?? '').trim();
const centsOf = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const fromCents = (cents: number) => (cents / 100).toFixed(2);

export function isValidCpf(value: unknown): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[len])) return false;
  }
  return true;
}

export function nfeEnvironment() {
  const production = env('NFE_AMBIENTE') === '1';
  return { code: production ? '1' : '2', name: production ? 'PRODUCAO' : 'HOMOLOGACAO', sequence: production ? 'nfe_numero_producao_seq' : 'nfe_numero_homologacao_seq' } as const;
}

function emitterConfig() {
  const cfg = {
    serviceUrl: env('NFE_SERVICE_URL').replace(/\/+$/, ''),
    serviceToken: env('NFE_SERVICE_TOKEN'),
    serie: Math.max(1, Math.min(999, Number(env('NFE_SERIE')) || 1)),
    crt: env('NFE_EMIT_CRT') || '4', // 4 = MEI
    cnpj: env('NFE_EMIT_CNPJ').toUpperCase().replace(/[^A-Z0-9]/g, ''), // CNPJ pode ser alfanumérico a partir de 2026
    ie: onlyDigits(env('NFE_EMIT_IE')),
    razaoSocial: env('NFE_EMIT_RAZAO_SOCIAL'),
    nomeFantasia: env('NFE_EMIT_NOME_FANTASIA'),
    logradouro: env('NFE_EMIT_LOGRADOURO'),
    numero: env('NFE_EMIT_NUMERO'),
    complemento: env('NFE_EMIT_COMPLEMENTO'),
    bairro: env('NFE_EMIT_BAIRRO'),
    cep: onlyDigits(env('NFE_EMIT_CEP')),
    municipio: env('NFE_EMIT_MUNICIPIO'),
    codMunicipio: onlyDigits(env('NFE_EMIT_COD_MUNICIPIO_IBGE')),
    uf: env('NFE_EMIT_UF').toUpperCase() || 'SP',
    fone: onlyDigits(env('NFE_EMIT_FONE')),
  };
  const missing: string[] = [];
  if (!cfg.serviceUrl) missing.push('NFE_SERVICE_URL');
  if (!cfg.serviceToken) missing.push('NFE_SERVICE_TOKEN');
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cfg.cnpj)) missing.push('NFE_EMIT_CNPJ');
  if (!cfg.ie) missing.push('NFE_EMIT_IE');
  if (!cfg.razaoSocial) missing.push('NFE_EMIT_RAZAO_SOCIAL');
  if (!cfg.logradouro) missing.push('NFE_EMIT_LOGRADOURO');
  if (!cfg.numero) missing.push('NFE_EMIT_NUMERO');
  if (!cfg.bairro) missing.push('NFE_EMIT_BAIRRO');
  if (cfg.cep.length !== 8) missing.push('NFE_EMIT_CEP');
  if (!cfg.municipio) missing.push('NFE_EMIT_MUNICIPIO');
  if (cfg.codMunicipio.length !== 7) missing.push('NFE_EMIT_COD_MUNICIPIO_IBGE');
  return { cfg, missing };
}

function paymentCode(method: unknown): { tPag: string; xPag?: string } {
  const m = String(method ?? '').toUpperCase();
  if (m.includes('PIX')) return { tPag: '17' };
  if (['CASH', 'CASH_ON_DELIVERY', 'DINHEIRO'].includes(m)) return { tPag: '01' };
  return { tPag: '99', xPag: 'Outros' };
}

async function lookupIbge(cep: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    const ibge = onlyDigits(data?.ibge);
    return !data?.erro && ibge.length === 7 ? ibge : null;
  } catch { return null; }
}

/** Reúne os dados do pedido e lista o que impede a emissão. Não chama nenhum serviço externo (exceto o IBGE se pedido). */
export async function buildNfeDraft(orderId: number, opts: { resolveIbge?: boolean } = {}) {
  const problems: string[] = [];
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) throw new NfeError(404, 'Pedido não encontrado.');
  const [customer] = await db.select().from(schema.users).where(eq(schema.users.id, order.userId)).limit(1);
  const rows = await db.select({ item: schema.orderItems, product: schema.products })
    .from(schema.orderItems).innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
    .where(eq(schema.orderItems.orderId, orderId));

  if (!NFE_ELIGIBLE_ORDER_STATUSES.includes(order.status)) problems.push('A NF-e só pode ser emitida para pedido já pago e não cancelado.');
  const { cfg, missing } = emitterConfig();
  if (missing.length) problems.push(`Configuração do emissor incompleta (${missing.join(', ')}).`);

  const cpf = onlyDigits(customer?.cpf);
  if (!isValidCpf(cpf)) problems.push('O cliente não tem CPF válido cadastrado (obrigatório na NF-e).');
  const addr = order.addressSnapshot;
  const cep = onlyDigits(addr?.zipCode);
  if (cep.length !== 8) problems.push('Endereço de entrega sem CEP válido.');
  if (!addr?.street || !addr?.neighborhood || !addr?.city || !/^[A-Za-z]{2}$/.test(String(addr?.state ?? ''))) problems.push('Endereço de entrega incompleto (rua, bairro, cidade e UF).');
  if (!rows.length) problems.push('Pedido sem itens.');

  let itemsCents = 0;
  const destUf = String(addr?.state ?? '').toUpperCase();
  const interstate = Boolean(destUf) && destUf !== cfg.uf;
  const itens = rows.map(({ item, product }, index) => {
    const label = `${product.code} - ${product.name}`;
    if (!/^\d{8}$/.test(product.fiscalNcm ?? '')) problems.push(`Produto ${label}: informe o NCM (8 dígitos) no cadastro.`);
    if (!NFE_SUPPORTED_CSOSN.includes(product.fiscalCsosn)) problems.push(`Produto ${label}: CSOSN ${product.fiscalCsosn} ainda não é suportado (use ${NFE_SUPPORTED_CSOSN.join(', ')}).`);
    const qty = item.quantity;
    const unitCents = centsOf(item.unitPrice);
    const totalCents = unitCents * qty;
    if (totalCents !== centsOf(item.subtotal)) problems.push(`Item ${label}: valor unitário × quantidade não confere com o subtotal.`);
    itemsCents += totalCents;
    const options = item.variantOptions && Object.keys(item.variantOptions).length ? ` (${Object.values(item.variantOptions).join(', ')})` : '';
    let cfop = product.fiscalCfop || '5102';
    if (interstate && cfop.startsWith('5')) cfop = `6${cfop.slice(1)}`;
    return {
      numero: index + 1,
      codigo: product.code,
      descricao: `${item.productName}${options}`.slice(0, 120),
      ncm: product.fiscalNcm,
      cfop,
      origem: product.fiscalOrigem || '0',
      csosn: product.fiscalCsosn || '102',
      unidade: product.fiscalUnidade || 'UN',
      quantidade: qty,
      valorUnitario: fromCents(unitCents),
      valorTotal: fromCents(totalCents),
    };
  });

  const freteCents = order.deliveryFee === null ? 0 : centsOf(order.deliveryFee);
  const totalCents = centsOf(order.total);
  if (itemsCents + freteCents !== totalCents) problems.push('O total do pedido não confere com itens + frete (há desconto ou ajuste). Revise antes de emitir.');

  let cMun: string | null = null;
  if (opts.resolveIbge && cep.length === 8) {
    cMun = await lookupIbge(cep);
    if (!cMun) problems.push('Não foi possível obter o código IBGE do município pelo CEP agora. Tente novamente.');
  }

  const payload = {
    naturezaOperacao: 'Venda de mercadoria',
    emitente: { cnpj: cfg.cnpj, ie: cfg.ie, razaoSocial: cfg.razaoSocial, nomeFantasia: cfg.nomeFantasia || cfg.razaoSocial, crt: cfg.crt, fone: cfg.fone,
      endereco: { logradouro: cfg.logradouro, numero: cfg.numero, complemento: cfg.complemento, bairro: cfg.bairro, cep: cfg.cep, codMunicipio: cfg.codMunicipio, municipio: cfg.municipio, uf: cfg.uf } },
    destinatario: { cpf, nome: String(customer?.name ?? '').slice(0, 60), email: customer?.email ?? '', fone: onlyDigits(customer?.phone),
    endereco: { logradouro: addr?.street ?? '', numero: addr?.number || 'S/N', complemento: addr?.complement ?? '', bairro: addr?.neighborhood ?? '', cep, codMunicipio: cMun, municipio: addr?.city ?? '', uf: destUf } },
    operacao: { idDest: interstate ? '2' : '1', indFinal: '1', indPres: '2' },
    itens,
    valores: { produtos: fromCents(itemsCents), frete: fromCents(freteCents), total: fromCents(totalCents) },
    pagamento: { ...paymentCode(order.paymentMethod), valor: fromCents(totalCents) },
    informacoesComplementares: `${COMPLEMENTARY_INFO} Pedido ${order.orderNumber}.`,
    pedido: { id: order.id, numero: order.orderNumber },
  };
  return { order, customerEmail: customer?.email ?? '', problems, payload, cfg };
}

export type CertificateStatus = { daysLeft: number; validTo: string; expired: boolean; cnpj?: string; company?: string };

/** Consulta o emissor (que guarda o A1). Retorna null se o emissor estiver fora do ar ou não configurado. */
export async function fetchCertificateStatus(): Promise<CertificateStatus | null> {
  const { cfg, missing } = emitterConfig();
  if (missing.includes('NFE_SERVICE_URL') || missing.includes('NFE_SERVICE_TOKEN')) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${cfg.serviceUrl}/cert/status`, { signal: controller.signal, headers: { Authorization: `Bearer ${cfg.serviceToken}` } });
    clearTimeout(timer);
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return null;
    return { daysLeft: Number(data.daysLeft), validTo: String(data.validTo), expired: Boolean(data.expired), cnpj: data.cnpj, company: data.company };
  } catch { return null; }
}

const CERT_WARN_DAYS = 30;
const CERT_CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
let certWatcherStarted = false;

/** Avisa o admin (sino de notificações) quando o certificado A1 vence em até 30 dias. No máximo um aviso por semana. */
export function startNfeCertificateWatcher() {
  if (certWatcherStarted || process.env.NODE_ENV === 'test') return;
  certWatcherStarted = true;
  const check = async () => {
    try {
      if (emitterConfig().missing.length) return;
      const status = await fetchCertificateStatus();
      if (!status || (status.daysLeft > CERT_WARN_DAYS && !status.expired)) return;
      const title = status.expired ? '⚠️ Certificado A1 VENCIDO' : `⚠️ Certificado A1 vence em ${status.daysLeft} dia(s)`;
      const message = `O certificado digital A1 usado na NF-e ${status.expired ? 'venceu' : 'vence'} em ${new Date(status.validTo).toLocaleDateString('pt-BR')}. Renove-o na certificadora e substitua o arquivo .pfx no serviço emissor; sem isso as notas não poderão ser emitidas.`;
      await db.execute(sql`INSERT INTO admin_notifications (type, title, message, is_read, popup_dismissed)
        SELECT 'NFE_CERT_EXPIRY', ${title}, ${message}, false, false
        WHERE NOT EXISTS (SELECT 1 FROM admin_notifications WHERE type = 'NFE_CERT_EXPIRY' AND created_at > NOW() - INTERVAL '7 days')`);
    } catch (error) { console.error('[nfe] verificação do certificado falhou:', (error as Error)?.message); }
  };
  void check();
  setInterval(() => void check(), CERT_CHECK_EVERY_MS).unref();
}

const docSummary = (row: any) => row ? {
  status: row.status, environment: row.environment, serie: row.serie, numero: row.numero,
  accessKey: row.access_key ?? null, protocol: row.protocol ?? null,
  rejectionCode: row.rejection_code ?? null, rejectionMessage: row.rejection_message ?? null,
  authorizedAt: row.authorized_at ?? null, updatedAt: row.updated_at ?? null,
  hasXml: Boolean(row.has_xml), hasDanfe: Boolean(row.has_danfe),
} : null;

async function loadDoc(orderId: number) {
  const found = await db.execute(sql`SELECT id, status, environment, serie, numero, access_key, protocol, rejection_code, rejection_message, authorized_at, updated_at,
    (xml_authorized IS NOT NULL) AS has_xml, (danfe_pdf_base64 IS NOT NULL) AS has_danfe FROM fiscal_documents WHERE order_id = ${orderId}`);
  return (found.rows[0] as any) ?? null;
}

export async function getNfeStatus(orderId: number) {
  const draft = await buildNfeDraft(orderId);
  const doc = await loadDoc(orderId);
  const certificate = draft.cfg.serviceUrl ? await fetchCertificateStatus() : null;
  const busy = doc && (doc.status === 'AUTHORIZED' || (doc.status === 'PROCESSING' && Date.now() - new Date(doc.updated_at).getTime() < STUCK_PROCESSING_MINUTES * 60_000));
  return {
    orderNumber: draft.order.orderNumber,
    customerEmail: draft.customerEmail,
    environment: nfeEnvironment().name,
    certificate,
    emitterOnline: certificate !== null,
    canEmit: draft.problems.length === 0 && !busy && certificate !== null && !certificate.expired,
    problems: busy ? [] : draft.problems,
    document: docSummary(doc),
  };
}

export async function getNfeFile(orderId: number, kind: 'xml' | 'danfe') {
  const found = await db.execute(sql`SELECT numero, access_key, xml_authorized, danfe_pdf_base64 FROM fiscal_documents WHERE order_id = ${orderId} AND status = 'AUTHORIZED'`);
  const row: any = found.rows[0];
  if (!row) throw new NfeError(404, 'NF-e autorizada não encontrada para este pedido.');
  if (kind === 'xml') {
    if (!row.xml_authorized) throw new NfeError(404, 'XML indisponível.');
    return { filename: `NFe-${row.access_key}.xml`, mimeType: 'application/xml', dataBase64: Buffer.from(row.xml_authorized, 'utf-8').toString('base64') };
  }
  if (!row.danfe_pdf_base64) throw new NfeError(404, 'DANFE indisponível.');
  return { filename: `DANFE-${String(row.numero).padStart(9, '0')}.pdf`, mimeType: 'application/pdf', dataBase64: row.danfe_pdf_base64 as string };
}

/** Reserva (ou reaproveita) o número da nota de forma atômica. Rejeição/erro reaproveitam o mesmo número para não gerar buracos. */
async function claimDocument(orderId: number, actorId: number) {
  const environment = nfeEnvironment();
  const serie = emitterConfig().cfg.serie;
  const existing = (await db.execute(sql`SELECT status, environment, serie, updated_at FROM fiscal_documents WHERE order_id = ${orderId}`)).rows[0] as any;
  if (!existing) {
    const created = await db.execute(sql`INSERT INTO fiscal_documents (order_id, status, environment, serie, numero, requested_by)
      VALUES (${orderId}, 'PROCESSING', ${environment.name}, ${serie}, nextval(${environment.sequence}::regclass), ${actorId})
      ON CONFLICT (order_id) DO NOTHING RETURNING id, numero, serie`);
    if (created.rows[0]) return created.rows[0] as any;
    throw new NfeError(409, 'Já existe uma emissão em andamento para este pedido.');
  }
  const sameKey = existing.environment === environment.name && Number(existing.serie) === serie;
  const renumber = sameKey ? sql`numero` : sql`nextval(${environment.sequence}::regclass)`;
  const updated = await db.execute(sql`UPDATE fiscal_documents
    SET status = 'PROCESSING', environment = ${environment.name}, serie = ${serie}, numero = ${renumber}, requested_by = ${actorId},
        rejection_code = NULL, rejection_message = NULL, updated_at = NOW()
    WHERE order_id = ${orderId}
      AND (status IN ('REJECTED','ERROR') OR (status = 'PROCESSING' AND updated_at < NOW() - make_interval(mins => ${STUCK_PROCESSING_MINUTES})))
    RETURNING id, numero, serie`);
  if (updated.rows[0]) return updated.rows[0] as any;
  throw new NfeError(409, existing.status === 'AUTHORIZED' ? 'Este pedido já tem NF-e autorizada.' : 'Já existe uma emissão em andamento para este pedido.');
}

export async function emitNfe(orderId: number, actorId: number) {
  const pre = await buildNfeDraft(orderId);
  if (pre.problems.length) throw new NfeError(422, 'Não é possível emitir a NF-e ainda.', pre.problems);

  const claimed = await claimDocument(orderId, actorId);
  const fail = async (status: 'REJECTED' | 'ERROR', code: string | null, message: string) => {
    await db.execute(sql`UPDATE fiscal_documents SET status = ${status}, rejection_code = ${code}, rejection_message = ${message.slice(0, 1000)}, updated_at = NOW() WHERE id = ${claimed.id}`);
    return docSummary(await loadDoc(orderId));
  };

  const draft = await buildNfeDraft(orderId, { resolveIbge: true });
  if (draft.problems.length) { await fail('ERROR', null, draft.problems.join(' ')); throw new NfeError(422, 'Não é possível emitir a NF-e ainda.', draft.problems); }

  const environment = nfeEnvironment();
  const body = { ambiente: environment.code, serie: Number(claimed.serie), numero: Number(claimed.numero), ...draft.payload };
  await db.execute(sql`UPDATE fiscal_documents SET payload = ${JSON.stringify(body)}::jsonb WHERE id = ${claimed.id}`);

  let result: any;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMITTER_TIMEOUT_MS);
    const response = await fetch(`${draft.cfg.serviceUrl}/nfe/emitir`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${draft.cfg.serviceToken}` },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    result = await response.json().catch(() => null);
    if (!response.ok && !result) throw new Error(`Emissor respondeu HTTP ${response.status}.`);
  } catch (error: any) {
    // O envio pode ter chegado à Sefaz. O emissor consulta a chave antes de reenviar, então tentar de novo é seguro.
    const doc = await fail('ERROR', null, `Sem resposta do emissor (${error?.name === 'AbortError' ? 'tempo esgotado' : error?.message || 'falha de rede'}). Tente novamente: a Sefaz é consultada antes de reenviar.`);
    return { document: doc };
  }

  if (result?.ok && result.status === 'AUTHORIZED' && /^\d{44}$/.test(String(result.chave ?? ''))) {
    await db.execute(sql`UPDATE fiscal_documents SET status = 'AUTHORIZED', access_key = ${String(result.chave)}, protocol = ${String(result.protocolo ?? '')},
      xml_authorized = ${String(result.xml ?? '')}, danfe_pdf_base64 = ${result.danfePdfBase64 ? String(result.danfePdfBase64) : null},
      authorized_at = NOW(), updated_at = NOW() WHERE id = ${claimed.id}`);
    return { document: docSummary(await loadDoc(orderId)) };
  }
  const code = result?.cStat != null ? String(result.cStat) : null;
  const message = String(result?.xMotivo || result?.error || 'A Sefaz rejeitou a nota sem detalhar o motivo.');
  return { document: await fail(code ? 'REJECTED' : 'ERROR', code, message) };
}
