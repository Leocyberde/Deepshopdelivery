export interface CustomerLoyaltySummary {
  freeDeliveryTickets: number;
  earnedAutoTickets: number;
  manualFreeDeliveryTickets: number;
  usedFreeDeliveryTickets: number;
  qualifyingOrdersCount: number;
  ordersInCurrentCycle: number;
  ordersRemainingForNextTicket: number;
  isFirstOrderEligible: boolean;
  eligibleForFirstOrderFreeDelivery: boolean;
  eligibleForFreeDelivery: boolean;
}


/** Compatibility only: historical ticket columns remain, but earning/consumption is retired. */
export async function evaluateCustomerLoyaltyTickets(_userId?: number | null, _executor?: unknown): Promise<CustomerLoyaltySummary> {
  return { freeDeliveryTickets: 0, earnedAutoTickets: 0, manualFreeDeliveryTickets: 0, usedFreeDeliveryTickets: 0, qualifyingOrdersCount: 0, ordersInCurrentCycle: 0, ordersRemainingForNextTicket: 0, isFirstOrderEligible: false, eligibleForFirstOrderFreeDelivery: false, eligibleForFreeDelivery: false };
}
export async function isCustomerEligibleForFirstOrderFreeDelivery(_userId?: number | null, _executor?: unknown) { return false; }
