import { getStoreState } from './storeStatusService.ts';
import {
  calculatePreorderWindow,
  formatDeliveryPromise,
  formatPreorderWindow,
  getDeliveryEta,
} from '../../utils/fulfillmentDates.ts';

export interface FulfillmentPromises {
  deliveryPromise: string | null;
  preorderWindow: string;
}

/**
 * Textos de prazo mostrados ao cliente, sempre calculados a partir de "agora".
 * Delivery: agora + 180 min (respeitando o horário da loja). Encomenda: janela configurada em settings.
 */
export function buildFulfillmentPromises(settingsMap: Record<string, string>, now = new Date()): FulfillmentPromises {
  const storeState = getStoreState(settingsMap, now);
  let deliveryPromise: string | null = null;
  try {
    deliveryPromise = formatDeliveryPromise(getDeliveryEta(now, 180, storeState.hours, storeState.timezone), now, storeState.timezone);
  } catch {
    deliveryPromise = null;
  }
  const window = calculatePreorderWindow(
    now,
    Number(settingsMap.preorder_start_offset_days || 1),
    Number(settingsMap.preorder_window_days || 7),
    storeState.timezone,
  );
  return { deliveryPromise, preorderWindow: formatPreorderWindow(window, storeState.timezone) };
}
