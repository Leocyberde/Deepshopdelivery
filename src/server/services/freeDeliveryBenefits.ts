import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import type { AuthRequest } from '../middleware/auth.ts';
import { FreightError } from './geoService.ts';
export async function updateFreeDeliveryBenefits(req: AuthRequest, ids: number[]) {
  if (!ids.length || ids.length > 200 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new FreightError('INVALID_CUSTOMERS', 400, 'Selecione entre 1 e 200 clientes válidos.');
  const unique = [...new Set(ids)];
  const { days, until: untilInput, revoke } = req.body || {};
  let until: Date | null;
  if (revoke === true || days === 0) until = null;
  else if (untilInput !== undefined) {
    if (typeof untilInput !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(untilInput)) throw new FreightError('INVALID_UNTIL', 400, 'Informe uma data final ISO com horário e fuso.');
    until = new Date(untilInput);
    if (!Number.isFinite(until.getTime()) || until <= new Date() || until.getTime() > Date.now() + 3650 * 86400000) throw new FreightError('INVALID_UNTIL', 400, 'A data final deve ser futura, até 3650 dias.');
  } else {
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 3650) throw new FreightError('INVALID_DAYS', 400, 'Informe uma quantidade de dias válida entre 0 e 3650.');
    until = new Date(Date.now() + days * 86400000);
  }
  return db.transaction(async (tx) => {
    const customers = await tx.select().from(schema.users).where(and(inArray(schema.users.id, unique), eq(schema.users.role, 'CUSTOMER'))).for('update');
    if (customers.length !== unique.length) throw new FreightError('NOT_FOUND', 404, 'Um ou mais clientes não foram encontrados.');
    const result = [];
    for (const customer of customers) {
      await tx.update(schema.users).set({ freeDeliveryUntil: until, updatedAt: new Date() }).where(eq(schema.users.id, customer.id));
      await tx.insert(schema.adminAuditLogs).values({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: until ? 'FREE_DELIVERY_GRANTED' : 'FREE_DELIVERY_REVOKED', entityType: 'customer', entityId: String(customer.id), details: { customerIds: unique, previousUntil: customer.freeDeliveryUntil, until } });
      result.push({ customerId: customer.id, freeDeliveryUntil: until });
    }
    return { customers: result, count: result.length, freeDeliveryUntil: until, message: until ? 'Frete grátis (benefício da loja) concedido.' : 'Benefício de frete grátis revogado.' };
  });
}
