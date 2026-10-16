export type AdminRole = 'ADMIN' | 'SUPER_ADMIN' | 'GERENTE' | 'OPERADOR';
export type UserRole = AdminRole | 'CUSTOMER';

export function isAdminRole(role: string | null | undefined): role is AdminRole {
  return role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'GERENTE' || role === 'OPERADOR';
}

export interface UserProfile {
  id: number;
  name: string;
  cpf?: string | null;
  email: string;
  phone: string;
  role: UserRole;
  status?: string;
  mustChangePassword?: boolean;
  privacyVersion?: string | null;
  termsVersion?: string | null;
  deletionRequestedAt?: string | null;
}

export interface CartItem {
  productId: number;
  receiveAllAsPreorder?: boolean;
  name: string;
  price: number;
  originalPrice?: number;
  promoPrice?: number | null;
  hasPromo?: boolean;
  promoMaxUnits?: number | null;
  imageUrl: string | null;
  categoryName?: string;
  quantity: number;
  selected?: boolean;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface CustomerNotification {
  id: number;
  userId: number;
  orderId: number | null;
  supportTicketId?: number | null;
  orderNumber: string;
  oldStatus: string | null;
  newStatus: string;
  title: string;
  message: string;
  isRead: boolean;
  popupDismissed: boolean;
  createdAt: string;
}

export interface ProductMediaItem {
  id?: number;
  imageUrl: string;
  mediaType?: 'IMAGE' | 'VIDEO' | string;
  durationSeconds?: number | null;
  isPrimary?: boolean;
}

export interface CepLookupResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  complement?: string;
}

// Status em português (Seção 12)
export const ORDER_STATUS_LABELS: Record<string, string> = {
  NEW: 'Novo',
  AWAITING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pago',
  PREPARING: 'Em preparo',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

export type PaymentMethodType = 'PIX' | 'CARD_CREDIT' | 'CARD_DEBIT' | 'CASH' | 'MERCADOPAGO';

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: 'Pix',
  CARD_CREDIT: 'Cartão de Crédito (na entrega)',
  CARD_DEBIT: 'Cartão de Débito (na entrega)',
  CASH: 'Dinheiro (na entrega)',
  MERCADOPAGO: 'Mercado Pago (online)',
};

export const ORDER_STATUS_LIST = [
  { value: 'NEW', label: 'Novo' },
  { value: 'AWAITING_PAYMENT', label: 'Aguardando pagamento' },
  { value: 'PAID', label: 'Pago' },
  { value: 'PREPARING', label: 'Em preparo' },
  { value: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' },
  { value: 'DELIVERED', label: 'Entregue' },
  { value: 'CANCELLED', label: 'Cancelado' },
];
