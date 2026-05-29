import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  boolean,
  numeric,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['owner', 'manager', 'cashier', 'kitchen']);

export const tableStatusEnum = pgEnum('table_status', [
  'available',
  'occupied',
  'reserved',
  'linked',
  'paid',
]);

export const tableShapeEnum = pgEnum('table_shape', ['square', 'rectangle']);

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'closing',
  'closed',
  'paid',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'preparing',
  'ready',
  'served',
  'cancelled',
]);

export const itemStatusEnum = pgEnum('item_status', [
  'pending',
  'preparing',
  'ready',
  'served',
  'cancelled',
]);

export const stationEnum = pgEnum('station', [
  'meat',
  'seafood',
  'vegetable',
  'noodle',
  'dessert',
  'drink',
  'sauce',
]);

export const queueStatusEnum = pgEnum('queue_status', [
  'waiting',
  'called',
  'seated',
  'left',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'qr_promptpay',
  'transfer',
  'card',
]);

/** Pricing tile category: guest type | add-on item | discount */
export const tileCategoryEnum = pgEnum('tile_category', [
  'guest',
  'addon',
  'discount',
]);

/** Discount tile type */
export const discountTypeEnum = pgEnum('discount_type', [
  'fixed',
  'percentage',
]);

/** Reservation lifecycle */
export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'arrived',
  'cancelled',
  'no_show',
]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: roleEnum('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const tables = pgTable(
  'tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Display label, e.g. "1", "VIP-A" */
    label: varchar('label', { length: 50 }).notNull(),
    capacity: integer('capacity').notNull(),
    zone: varchar('zone', { length: 100 }).notNull().default('ทั่วไป'),
    status: tableStatusEnum('status').notNull().default('available'),
    qrToken: varchar('qr_token', { length: 100 }).notNull().unique(),
    /** Floor plan position (px) */
    positionX: integer('position_x').notNull().default(0),
    positionY: integer('position_y').notNull().default(0),
    /** Floor plan size (px, snapped to 20px grid) */
    width: integer('width').notNull().default(80),
    height: integer('height').notNull().default(80),
    shape: tableShapeEnum('shape').notNull().default('square'),
    /** Soft-delete: set when table has session history and is "removed" from floor plan */
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [index('tables_qr_token_idx').on(t.qrToken)],
);

/**
 * Pricing tiles — replaces pricingTiers.
 * Three categories:
 *   'guest'    — guest types (adult, child, …) used when opening table + billing
 *   'addon'    — add-on items (extra cup, …) used in POS checkout
 *   'discount' — discount tiles (10%, -50฿) used in POS checkout
 */
export const pricingTiles = pgTable('pricing_tiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Unique machine code: 'adult', 'child', 'addon_drink_glass', 'discount_10pct' */
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  /** Base64 data URL or external URL — null = use category icon placeholder */
  imageUrl: text('image_url'),
  category: tileCategoryEnum('category').notNull(),
  /** Price (VAT-inclusive if vatIncluded=true). For discount tiles: 0 (amount is in discountValue) */
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('7.00'),
  vatIncluded: boolean('vat_included').notNull().default(true),
  /** Only for category='discount' */
  discountType: discountTypeEnum('discount_type'),
  discountValue: numeric('discount_value', { precision: 10, scale: 2 }),
  /** Optional tile background colour, e.g. '#FEE2E2' */
  color: varchar('color', { length: 7 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => tables.id),
    /**
     * Linked-table support.
     * Primary session (the table that was opened first): null.
     * Child session (a table linked to the primary): set to primary session id.
     * All child sessions share guests / orders through the primary session.
     */
    parentSessionId: uuid('parent_session_id'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    closedAt: timestamp('closed_at'),
    status: sessionStatusEnum('status').notNull().default('active'),
    sessionToken: varchar('session_token', { length: 24 }).notNull().unique(),
    notes: text('notes'),
  },
  (t) => [
    index('sessions_status_idx').on(t.status),
    index('sessions_session_token_idx').on(t.sessionToken),
    index('sessions_table_id_idx').on(t.tableId),
    index('sessions_closed_at_idx').on(t.closedAt),
    index('sessions_parent_session_id_idx').on(t.parentSessionId),
  ],
);

/**
 * Guest breakdown for a session.
 * Only stored on the PRIMARY session (parentSessionId = null).
 * References pricingTiles (category='guest').
 */
export const sessionGuests = pgTable(
  'session_guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    pricingTileId: uuid('pricing_tile_id')
      .notNull()
      .references(() => pricingTiles.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [index('session_guests_session_id_idx').on(t.sessionId)],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  station: stationEnum('station').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  maxPerSession: integer('max_per_session'),
});

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  name: varchar('name', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  description: text('description'),
  descriptionEn: text('description_en'),
  imageUrl: text('image_url'),
  isBuffet: boolean('is_buffet').notNull().default(true),
  extraPrice: numeric('extra_price', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  maxPerOrder: integer('max_per_order'),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  isAvailable: boolean('is_available').notNull().default(true),
  allergens: jsonb('allergens').notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    orderedBySeat: integer('ordered_by_seat'),
    status: orderStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    servedAt: timestamp('served_at'),
  },
  (t) => [index('orders_session_id_idx').on(t.sessionId)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    menuItemId: uuid('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'set null' }),
    itemName: varchar('item_name', { length: 255 }),
    quantity: integer('quantity').notNull(),
    notes: text('notes'),
    station: stationEnum('station').notNull(),
    status: itemStatusEnum('status').notNull().default('pending'),
    preparedAt: timestamp('prepared_at'),
    servedAt: timestamp('served_at'),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    index('order_items_station_status_idx').on(t.station, t.status),
  ],
);

export const queueEntries = pgTable(
  'queue_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queueNumber: varchar('queue_number', { length: 10 }).notNull(),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    partySize: integer('party_size').notNull(),
    preferredZone: varchar('preferred_zone', { length: 100 }),
    status: queueStatusEnum('status').notNull().default('waiting'),
    publicToken: varchar('public_token', { length: 20 }).notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    calledAt: timestamp('called_at'),
    seatedAt: timestamp('seated_at'),
  },
  (t) => [index('queue_entries_public_token_idx').on(t.publicToken)],
);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id)
    .unique(),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  serviceCharge: numeric('service_charge', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  discount: numeric('discount', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  receivedAmount: numeric('received_amount', {
    precision: 10,
    scale: 2,
  }).notNull(),
  changeAmount: numeric('change_amount', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  paidAt: timestamp('paid_at').notNull().defaultNow(),
  processedBy: uuid('processed_by')
    .notNull()
    .references(() => users.id),
  notes: text('notes'),
});

/**
 * Line items for a payment — addons and discounts applied at checkout.
 * amount: positive for addons (increases total), negative for discounts.
 */
export const paymentLineItems = pgTable(
  'payment_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    pricingTileId: uuid('pricing_tile_id')
      .notNull()
      .references(() => pricingTiles.id),
    quantity: integer('quantity').notNull().default(1),
    /** Positive = addon charge, negative = discount applied */
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    appliedAt: timestamp('applied_at').notNull().defaultNow(),
  },
  (t) => [index('payment_line_items_payment_id_idx').on(t.paymentId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    action: varchar('action', { length: 100 }).notNull(),
    entity: varchar('entity', { length: 100 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_created_at_idx').on(t.createdAt)],
);

/**
 * Table reservations.
 * Primary reservation (parentReservationId = null) is linked to the "main" table.
 * Child reservations (parentReservationId set) are linked tables in a multi-table booking.
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => tables.id),
    reservedAt: timestamp('reserved_at').notNull(),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 20 }),
    partySize: integer('party_size').notNull(),
    notes: text('notes'),
    status: reservationStatusEnum('status').notNull().default('pending'),
    /** Points to the primary reservation for linked-table bookings */
    parentReservationId: uuid('parent_reservation_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index('reservations_table_id_idx').on(t.tableId),
    index('reservations_reserved_at_idx').on(t.reservedAt),
    index('reservations_status_idx').on(t.status),
    index('reservations_parent_id_idx').on(t.parentReservationId),
  ],
);

/**
 * Guest breakdown pre-registered for a reservation.
 * References pricingTiles (category='guest').
 */
export const reservationGuests = pgTable(
  'reservation_guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    pricingTileId: uuid('pricing_tile_id')
      .notNull()
      .references(() => pricingTiles.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [index('reservation_guests_reservation_id_idx').on(t.reservationId)],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  payments: many(payments),
  auditLogs: many(auditLogs),
  reservations: many(reservations),
}));

export const tablesRelations = relations(tables, ({ many }) => ({
  sessions: many(sessions),
  reservations: many(reservations),
}));

export const pricingTilesRelations = relations(pricingTiles, ({ many }) => ({
  sessionGuests: many(sessionGuests),
  reservationGuests: many(reservationGuests),
  paymentLineItems: many(paymentLineItems),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  table: one(tables, { fields: [sessions.tableId], references: [tables.id] }),
  /** Primary session: this points back to itself (null FK) — relation only used for child→parent */
  parentSession: one(sessions, {
    fields: [sessions.parentSessionId],
    references: [sessions.id],
    relationName: 'linkedSessions',
  }),
  linkedSessions: many(sessions, { relationName: 'linkedSessions' }),
  guests: many(sessionGuests),
  orders: many(orders),
  payment: one(payments, {
    fields: [sessions.id],
    references: [payments.sessionId],
  }),
}));

export const sessionGuestsRelations = relations(sessionGuests, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionGuests.sessionId],
    references: [sessions.id],
  }),
  pricingTile: one(pricingTiles, {
    fields: [sessionGuests.pricingTileId],
    references: [pricingTiles.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  menuItems: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(categories, {
    fields: [menuItems.categoryId],
    references: [categories.id],
  }),
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  session: one(sessions, {
    fields: [orders.sessionId],
    references: [sessions.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  session: one(sessions, {
    fields: [payments.sessionId],
    references: [sessions.id],
  }),
  processedByUser: one(users, {
    fields: [payments.processedBy],
    references: [users.id],
  }),
  lineItems: many(paymentLineItems),
}));

export const paymentLineItemsRelations = relations(paymentLineItems, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentLineItems.paymentId],
    references: [payments.id],
  }),
  pricingTile: one(pricingTiles, {
    fields: [paymentLineItems.pricingTileId],
    references: [pricingTiles.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  table: one(tables, { fields: [reservations.tableId], references: [tables.id] }),
  createdByUser: one(users, { fields: [reservations.createdBy], references: [users.id] }),
  parentReservation: one(reservations, {
    fields: [reservations.parentReservationId],
    references: [reservations.id],
    relationName: 'linkedReservations',
  }),
  linkedReservations: many(reservations, { relationName: 'linkedReservations' }),
  guests: many(reservationGuests),
}));

export const reservationGuestsRelations = relations(reservationGuests, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationGuests.reservationId],
    references: [reservations.id],
  }),
  pricingTile: one(pricingTiles, {
    fields: [reservationGuests.pricingTileId],
    references: [pricingTiles.id],
  }),
}));

/* ─── Store Settings (singleton row, id = 1) ─────────────────────────────── */

export type BillConfig = {
  shopNameTh?: string;
  shopNameEn?: string;
  companyName?: string;
  address?: string;
  phone?: string;
  taxId?: string;
  branch?: string;
  registerNo?: string;
  footerNote?: string;
  vatPercent?: number;
  /** Fields explicitly hidden from this bill type (even if global has a value) */
  hiddenFields?: string[];
};

export const storeSettings = pgTable('store_settings', {
  id: integer('id').primaryKey().default(1),
  shopNameTh: varchar('shop_name_th', { length: 255 }).notNull().default('ร้านชาบู'),
  shopNameEn: varchar('shop_name_en', { length: 255 }).notNull().default('Shabu Buffet'),
  companyName: varchar('company_name', { length: 255 }),
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  taxId: varchar('tax_id', { length: 30 }),
  branch: varchar('branch', { length: 100 }).default('สำนักงานใหญ่'),
  registerNo: varchar('register_no', { length: 50 }),
  footerNote: varchar('footer_note', { length: 255 }).default('ขอบคุณและขอให้โชคดี'),
  vatPercent: integer('vat_percent').notNull().default(7),
  /** Per-bill-type overrides (null = fall back to global fields above) */
  billPreviewConfig: jsonb('bill_preview_config').$type<BillConfig>(),
  billMainConfig: jsonb('bill_main_config').$type<BillConfig>(),
  billSecondaryConfig: jsonb('bill_secondary_config').$type<BillConfig>(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Table = typeof tables.$inferSelect;
export type NewTable = typeof tables.$inferInsert;
export type PricingTile = typeof pricingTiles.$inferSelect;
export type NewPricingTile = typeof pricingTiles.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionGuest = typeof sessionGuests.$inferSelect;
export type NewSessionGuest = typeof sessionGuests.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type MenuItem = typeof menuItems.$inferSelect;
export type NewMenuItem = typeof menuItems.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type QueueEntry = typeof queueEntries.$inferSelect;
export type NewQueueEntry = typeof queueEntries.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentLineItem = typeof paymentLineItems.$inferSelect;
export type NewPaymentLineItem = typeof paymentLineItems.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type ReservationGuest = typeof reservationGuests.$inferSelect;
export type NewReservationGuest = typeof reservationGuests.$inferInsert;
export type StoreSettings = typeof storeSettings.$inferSelect;
