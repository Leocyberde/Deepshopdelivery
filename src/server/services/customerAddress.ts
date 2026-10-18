import { isServedAddress } from '../../services/freightService.ts';

/**
 * Resposta pública de endereço (cliente). Nunca expõe distância, frete,
 * origem da cotação, chave de cache nem dados internos de quem atualizou.
 * O administrador continua usando as rotas administrativas com o registro completo.
 */
export interface CustomerAddress {
  id: number;
  label: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  reference: string | null;
  isPrimary: boolean;
  served: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function toCustomerAddress(address: Record<string, any>): CustomerAddress {
  return {
    id: address.id,
    label: address.label,
    zipCode: address.zipCode,
    street: address.street,
    number: address.number,
    complement: address.complement ?? null,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    reference: address.reference ?? null,
    isPrimary: Boolean(address.isPrimary),
    served: isServedAddress(address),
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}

/** Quote devolvida ao cliente: sem distância, faixa, origem nem frete "normal". */
export function toCustomerFreight(freight: Record<string, any> | null | undefined) {
  if (!freight) return null;
  return {
    status: freight.status,
    finalFee: freight.finalFee,
    isFree: freight.finalFee === 0,
    freeBenefit: freight.source === 'MANUAL_FREE_DELIVERY_PERIOD',
    minimumRequired: freight.minimumRequired ?? null,
    missingAmount: freight.missingAmount ?? null,
    ...(freight.message ? { message: freight.message } : {}),
  };
}
