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
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['owner', 'cashier', 'kitchen']);

export const tableStatusEnum = pgEnum('table_status', [
  'available',
  'occupied',
  'cleaning',
  'reserved',
]);

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'closing',
  'closed',
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
    number: integer('number').notNull().unique(),
    capacity: integer('capacity').notNull(),
    zone: varchar('zone', { length: 100 }).notNull().default('ทั่วไป'),
    status: tableStatusEnum('status').notNull().default('available'),
    qrToken: varchar('qr_token', { length: 100 }).notNull().unique(),
  },
  (t) => [index('tables_qr_token_idx').on(t.qrToken)],
);

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  priceAdult: numeric('price_adult', { precision: 10, scale: 2 }).notNull(),
  priceChild: numeric('price_child', { precision: 10, scale: 2 }).notNull(),
  priceSenior: numeric('price_senior', { precision: 10, scale: 2 }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => tables.id),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id),
    adults: integer('adults').notNull().default(0),
    children: integer('children').notNull().default(0),
    seniors: integer('seniors').notNull().default(0),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    endsAt: timestamp('ends_at').notNull(),
    closedAt: timestamp('closed_at'),
    status: sessionStatusEnum('status').notNull().default('active'),
    sessionToken: varchar('session_token', { length: 24 }).notNull().unique(),
  },
  (t) => [
    index('sessions_status_idx').on(t.status),
    index('sessions_session_token_idx').on(t.sessionToken),
    index('sessions_table_id_idx').on(t.tableId),
  ],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  station: stationEnum('station').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  imageUrl: varchar('image_url', { length: 500 }),
  isBuffet: boolean('is_buffet').notNull().default(true),
  extraPrice: numeric('extra_price', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  maxPerOrder: integer('max_per_order'),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  isAvailable: boolean('is_available').notNull().default(true),
  allergens: jsonb('allergens').notNull().default([]),
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
      .notNull()
      .references(() => menuItems.id),
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
  wasteCharge: numeric('waste_charge', { precision: 10, scale: 2 })
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

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  payments: many(payments),
  auditLogs: many(auditLogs),
}));

export const tablesRelations = relations(tables, ({ many }) => ({
  sessions: many(sessions),
}));

export const packagesRelations = relations(packages, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  table: one(tables, { fields: [sessions.tableId], references: [tables.id] }),
  package: one(packages, {
    fields: [sessions.packageId],
    references: [packages.id],
  }),
  orders: many(orders),
  payment: one(payments, {
    fields: [sessions.id],
    references: [payments.sessionId],
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

export const paymentsRelations = relations(payments, ({ one }) => ({
  session: one(sessions, {
    fields: [payments.sessionId],
    references: [sessions.id],
  }),
  processedByUser: one(users, {
    fields: [payments.processedBy],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Table = typeof tables.$inferSelect;
export type NewTable = typeof tables.$inferInsert;
export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
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
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
