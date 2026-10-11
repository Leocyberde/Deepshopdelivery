import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  cpf: text('cpf'),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('CUSTOMER'), // 'CUSTOMER' | 'SUPER_ADMIN' | 'GERENTE' | 'OPERADOR' | legacy 'ADMIN'
  permissions: text('permissions'), // JSON opcional de permissões administrativas customizadas
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'INACTIVE'
  sessionVersion: integer('session_version').notNull().default(1),
  freeDeliveryTickets: integer('free_delivery_tickets').notNull().default(0),
  manualFreeDeliveryTickets: integer('manual_free_delivery_tickets').notNull().default(0),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  resetCodeHash: text('reset_code_hash'),
  resetCodeExpiresAt: timestamp('reset_code_expires_at'),
  resetCodeAttempts: integer('reset_code_attempts').notNull().default(0),
  privacyVersion: text('privacy_version'),
  privacyAcceptedAt: timestamp('privacy_accepted_at'),
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at'),
  deletionRequestedAt: timestamp('deletion_requested_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const stores = pgTable('stores', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull().default('OWN_STORE'), // 'OWN_STORE'
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'INACTIVE'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'INACTIVE'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  code: text('code').notNull().default('A001'), // Código até 4 dígitos: 1 letra e até 3 números (ex: A001)
  name: text('name').notNull(),
  description: text('description'),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  promoPrice: numeric('promo_price', { precision: 10, scale: 2 }),
  promoActive: boolean('promo_active').notNull().default(false),
  promoEndsAt: timestamp('promo_ends_at'),
  promoDurationHours: integer('promo_duration_hours'),
  promoMaxUnits: integer('promo_max_units'),
  isKit: boolean('is_kit').notNull().default(false),
  cost: numeric('cost', { precision: 10, scale: 2 }).notNull().default('0.00'),
  stock: integer('stock').notNull().default(0),
  stockMinimum: integer('stock_minimum').notNull().default(5),
  weight: numeric('weight', { precision: 10, scale: 3 }).default('0.000'), // kg
  viewsCount: integer('views_count').notNull().default(0),
  clicksCount: integer('clicks_count').notNull().default(0),
  sharesCount: integer('shares_count').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'INACTIVE'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const productKitItems = pgTable('product_kit_items', {
  id: serial('id').primaryKey(),
  kitProductId: integer('kit_product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  componentProductId: integer('component_product_id')
    .notNull()
    .references(() => products.id),
  quantityPerKit: integer('quantity_per_kit').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const productImages = pgTable('product_images', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url').notNull(),
  mediaType: text('media_type').notNull().default('IMAGE'), // 'IMAGE' | 'VIDEO'
  durationSeconds: integer('duration_seconds'), // até 30 segundos quando VIDEO
  isPrimary: boolean('is_primary').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const addresses = pgTable('addresses', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(), // Casa, Trabalho, Mãe...
  zipCode: text('zip_code').notNull(),
  street: text('street').notNull(),
  number: text('number').notNull(),
  complement: text('complement'),
  neighborhood: text('neighborhood').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  reference: text('reference'),
  isPrimary: boolean('is_primary').notNull().default(false),
  // Campos de frete no próprio endereço
  deliveryDistanceKm: numeric('delivery_distance_km', { precision: 10, scale: 2 }),
  deliveryFee: numeric('delivery_fee', { precision: 10, scale: 2 }),
  deliveryFeeStatus: text('delivery_fee_status').notNull().default('PENDING'), // 'PENDING' | 'CONFIRMED'
  deliveryFeeSource: text('delivery_fee_source').notNull().default('MANUAL'), // 'MANUAL' | 'GOOGLE'
  deliveryOrigin: text('delivery_origin'),
  deliveryNotes: text('delivery_notes'),
  deliveryUpdatedBy: integer('delivery_updated_by'),
  deliveryUpdatedAt: timestamp('delivery_updated_at'),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface AddressSnapshot {
  id?: number;
  label: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  reference?: string | null;
  deliveryOrigin?: string | null;
  deliveryNotes?: string | null;
}

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(), // #000001
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  deliveryFee: numeric('delivery_fee', { precision: 10, scale: 2 }), // nulo se a combinar
  deliveryDistanceKm: numeric('delivery_distance_km', { precision: 10, scale: 2 }),
  deliveryFeeSource: text('delivery_fee_source').notNull().default('MANUAL'), // 'MANUAL' | 'AUTO'
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  status: text('status').notNull().default('NEW'),
  // 'NEW' | 'AWAITING_PAYMENT' | 'PAID' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED'
  idempotencyKey: text('idempotency_key').unique(),
  isFirstOrderFreeDelivery: boolean('is_first_order_free_delivery').notNull().default(false),
  usedFreeDeliveryTicket: boolean('used_free_delivery_ticket').notNull().default(false),
  stockDeducted: boolean('stock_deducted').notNull().default(false),
  cancellationReason: text('cancellation_reason'),
  refundRequested: boolean('refund_requested').notNull().default(false),
  notes: text('notes'),
  paymentMethod: text('payment_method'),
  changeFor: numeric('change_for', { precision: 10, scale: 2 }),
  paymentExpiresAt: timestamp('payment_expires_at'),
  deliveryMode: text('delivery_mode'), // 'FAST' | 'SCHEDULED'
  deliveryMinutes: integer('delivery_minutes'), // 60 | 90 | 120 | 180
  estimatedDeliveryAt: timestamp('estimated_delivery_at'),
  scheduledDeliveryAt: timestamp('scheduled_delivery_at'),
  deliveredAt: timestamp('delivered_at'),
  reminderSentAt: timestamp('reminder_sent_at'),
  addressSnapshot: jsonb('address_snapshot').$type<AddressSnapshot>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('MERCADOPAGO'),
  externalReference: text('external_reference').notNull().unique(),
  providerOrderId: text('provider_order_id').unique(),
  providerPreferenceId: text('provider_preference_id').unique(),
  providerPaymentId: text('provider_payment_id').unique(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('BRL'),
  status: text('status').notNull().default('PENDING'),
  providerStatus: text('provider_status'),
  checkoutUrl: text('checkout_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('OPEN'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    closedAt: timestamp('closed_at'),
  },
  (table) => [
    index('idx_support_tickets_user').on(table.userId),
    index('idx_support_tickets_status').on(table.status),
    index('idx_support_tickets_updated_at').on(table.updatedAt),
  ]
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: serial('id').primaryKey(),
    ticketId: integer('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: integer('author_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_support_messages_ticket').on(table.ticketId, table.createdAt)]
);

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  orderId: integer('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  orderNumber: text('order_number').notNull(),
  oldStatus: text('old_status'),
  newStatus: text('new_status').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  popupDismissed: boolean('popup_dismissed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const adminNotifications = pgTable('admin_notifications', {
  id: serial('id').primaryKey(),
  type: text('type').notNull().default('NEW_CUSTOMER'), // 'NEW_CUSTOMER' | 'NEW_ORDER'
  customerId: integer('customer_id').references(() => users.id, { onDelete: 'cascade' }),
  orderId: integer('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  addressId: integer('address_id').references(() => addresses.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  popupDismissed: boolean('popup_dismissed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  productName: text('product_name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const productInteractions = pgTable(
  'product_interactions',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'VIEW' | 'CLICK' | 'SHARE'
    visitorId: text('visitor_id').notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_product_interactions_prod_type_date').on(
      table.productId,
      table.type,
      table.createdAt
    ),
    index('idx_product_interactions_visitor_prod_type_date').on(
      table.visitorId,
      table.productId,
      table.type,
      table.createdAt
    ),
  ]
);

export const orderStatusHistory = pgTable('order_status_history', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  oldStatus: text('old_status'),
  newStatus: text('new_status').notNull(),
  changedBy: integer('changed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const storedObjects = pgTable('stored_objects', {
  key: text('key').primaryKey(),
  mimeType: text('mime_type').notNull(),
  dataBase64: text('data_base64').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id').notNull().references(() => products.id),
    delta: integer('delta').notNull(),
    beforeStock: integer('before_stock').notNull(),
    afterStock: integer('after_stock').notNull(),
    movementType: text('movement_type').notNull(),
    reason: text('reason').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    kitProductId: integer('kit_product_id').references(() => products.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').unique(),
    operationResult: jsonb('operation_result'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_inventory_movements_product_created').on(table.productId, table.createdAt)]
);

/** Trilha append-only das ações administrativas relevantes da Fase 3. */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    result: text('result').notNull().default('SUCCESS'),
    details: jsonb('details'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_admin_audit_created').on(table.createdAt),
    index('idx_admin_audit_actor').on(table.actorUserId, table.createdAt),
    index('idx_admin_audit_entity').on(table.entityType, table.entityId, table.createdAt),
  ]
);

/** Chaves de eventos administrativos para impedir duplicação em retry/reload. */
export const adminEventKeys = pgTable('admin_event_keys', {
  eventKey: text('event_key').primaryKey(),
  eventType: text('event_type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
