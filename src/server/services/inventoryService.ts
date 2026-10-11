import * as schema from '../../db/schema.ts';

export type InventoryMovementInput = {
  productId: number;
  delta: number;
  beforeStock: number;
  afterStock: number;
  movementType: string;
  reason: string;
  actorUserId?: number | null;
  orderId?: number | null;
  kitProductId?: number | null;
  idempotencyKey?: string | null;
  operationResult?: Record<string, unknown> | null;
};

/** Registra uma movimentação usando a mesma transação que altera o saldo. */
export async function recordInventoryMovement(tx: any, input: InventoryMovementInput) {
  if (!Number.isSafeInteger(input.productId) || input.productId <= 0) {
    throw new Error('Produto inválido para movimentação de estoque.');
  }
  if (![input.delta, input.beforeStock, input.afterStock].every(Number.isSafeInteger)) {
    throw new Error('Saldo inválido para movimentação de estoque.');
  }
  if (input.afterStock - input.beforeStock !== input.delta || input.afterStock < 0) {
    throw new Error('Movimentação de estoque inconsistente.');
  }
  if (!input.movementType || input.movementType.length > 60 || !input.reason.trim() || input.reason.length > 500) {
    throw new Error('Motivo ou tipo de movimentação inválido.');
  }

  const [movement] = await tx.insert(schema.inventoryMovements).values({
    productId: input.productId,
    delta: input.delta,
    beforeStock: input.beforeStock,
    afterStock: input.afterStock,
    movementType: input.movementType,
    reason: input.reason.trim(),
    actorUserId: input.actorUserId ?? null,
    orderId: input.orderId ?? null,
    kitProductId: input.kitProductId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    operationResult: input.operationResult ?? null,
  }).returning();

  return movement;
}
