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
  uniqueIndex,
  date,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['owner', 'manager', 'cashier', 'kitchen']);
export const uiLayoutEnum = pgEnum('ui_layout', ['touchscreen', 'desktop', 'tablet']);

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
  'cash_qr',
  'qr_promptpay',
  'transfer',
  'card',
]);

/** Pricing tile category: guest type | add-on item | discount | loyalty redemption */
export const tileCategoryEnum = pgEnum('tile_category', [
  'guest',
  'addon',
  'discount',
  'loyalty',
]);

/** Discount tile type */
export const discountTypeEnum = pgEnum('discount_type', [
  'fixed',
  'percentage',
]);

export const stockCountStatusEnum = pgEnum('stock_count_status', [
  'draft',
  'submitted',
  'reviewed',
]);

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'draft',
  'pending_approval',
  'ordered',
  'partial_received',
  'received',
  'cancelled',
]);

export const countFrequencyEnum = pgEnum('count_frequency', ['daily', 'weekly']);
export const adjustmentTypeEnum = pgEnum('adjustment_type', ['adjustment', 'waste']);
export const discrepancyTypeEnum = pgEnum('discrepancy_type', ['none', 'short', 'wrong', 'spoiled']);

// ─── Phase 1: Cash Control Enums ─────────────────────────────────────────────

export const cashierShiftStatusEnum = pgEnum('cashier_shift_status', [
  'open',
  'closed',
  'reviewed',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'completed',
  'voided',
  'refunded',
]);

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'promptpay',
  'cash',
  'welfare',
  'mixed_legacy',
  'other',
]);

export const receivingAccountTypeEnum = pgEnum('receiving_account_type', [
  'bank_cash_group',
  'welfare',
  'cash_drawer',
  'other',
]);

// Separate from adjustmentTypeEnum ('adjustment'|'waste') which is for stock
export const paymentAdjustmentTypeEnum = pgEnum('payment_adjustment_type', [
  'void',
  'refund',
  'discount_correction',
]);

export const paymentAdjustmentStatusEnum = pgEnum('payment_adjustment_status', [
  'pending',
  'approved',
  'rejected',
]);

export const discountApprovalStatusEnum = pgEnum('discount_approval_status', [
  'pending',
  'approved',
  'rejected',
]);

// ─── HR / Payroll Enums ───────────────────────────────────────────────────────

export const employeeTypeEnum = pgEnum('employee_type', ['full_time', 'part_time']);
export const employeeStatusEnum = pgEnum('employee_status', ['active', 'inactive']);
export const shiftTypeEnum = pgEnum('shift_type', ['morning', 'afternoon', 'custom']);
export const scheduleEntryStatusEnum = pgEnum('schedule_entry_status', ['working', 'day_off', 'leave']);
export const scheduleCycleStatusEnum = pgEnum('schedule_cycle_status', ['draft', 'published']);
export const payrollStatusEnum = pgEnum('payroll_status', ['draft', 'finalized', 'paid']);
export const hrPaymentMethodEnum = pgEnum('hr_payment_method', ['cash', 'transfer']);
export const deductionTypeEnum = pgEnum('deduction_type', ['advance', 'damage']);
export const absenceTypeEnum = pgEnum('absence_type', ['absence', 'late']);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  address: text('address'),
  phone: varchar('phone', { length: 20 }),
  taxId: varchar('tax_id', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: roleEnum('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  branchId: uuid('branch_id').references(() => branches.id),
  uiLayout: uiLayoutEnum('ui_layout'),
  allowedModules: text('allowed_modules').array(),
  navLayout: jsonb('nav_layout').$type<{ sections: { heading: string; modules: string[] }[] } | null>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 20 }).notNull().unique(),
    name: varchar('name', { length: 100 }),
    lineUserId: varchar('line_user_id', { length: 100 }),
    birthDate: date('birth_date'),
    loyaltyPoints: integer('loyalty_points').notNull().default(0),
    totalVisits: integer('total_visits').notNull().default(0),
    totalSpend: numeric('total_spend', { precision: 12, scale: 2 }).notNull().default('0'),
    lastVisitDate: date('last_visit_date'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('customers_phone_idx').on(t.phone)],
);

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
    branchId: uuid('branch_id').references(() => branches.id),
    /** Soft-delete: set when table has session history and is "removed" from floor plan */
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [index('tables_qr_token_idx').on(t.qrToken)],
);

/**
 * Pricing tiles — replaces pricingTiers.
 * Four categories:
 *   'guest'    — guest types (adult, child, …) used when opening table + billing
 *   'addon'    — add-on items (extra cup, …) used in POS checkout
 *   'discount' — discount tiles (10%, -50฿) used in POS checkout
 *   'loyalty'  — loyalty points redemption tile
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
     */
    parentSessionId: uuid('parent_session_id'),
    customerId: uuid('customer_id').references(() => customers.id),
    branchId: uuid('branch_id').references(() => branches.id),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    closedAt: timestamp('closed_at'),
    status: sessionStatusEnum('status').notNull().default('active'),
    sessionToken: varchar('session_token', { length: 24 }).notNull().unique(),
    taxInvoiceRequested: boolean('tax_invoice_requested').notNull().default(false),
    taxInvoiceNumber: varchar('tax_invoice_number', { length: 30 }),
    notes: text('notes'),
    billPrintedAt: timestamp('bill_printed_at'),
  },
  (t) => [
    index('sessions_status_idx').on(t.status),
    index('sessions_session_token_idx').on(t.sessionToken),
    index('sessions_table_id_idx').on(t.tableId),
    index('sessions_closed_at_idx').on(t.closedAt),
    index('sessions_parent_session_id_idx').on(t.parentSessionId),
    index('sessions_customer_id_idx').on(t.customerId),
  ],
);

export const customerVisits = pgTable(
  'customer_visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    sessionId: uuid('session_id').notNull().references(() => sessions.id),
    pointsEarned: integer('points_earned').notNull().default(0),
    pointsRedeemed: integer('points_redeemed').notNull().default(0),
    visitDate: date('visit_date').notNull(),
  },
  (t) => [
    index('customer_visits_customer_idx').on(t.customerId),
    index('customer_visits_session_idx').on(t.sessionId),
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

export const menuItems = pgTable(
  'menu_items',
  {
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
  },
  (t) => [index('menu_items_category_id_idx').on(t.categoryId)],
);

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
  (t) => [
    index('orders_session_id_idx').on(t.sessionId),
    index('orders_created_at_idx').on(t.createdAt),
  ],
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
  (t) => [
    index('queue_entries_public_token_idx').on(t.publicToken),
    index('queue_entries_status_created_at_idx').on(t.status, t.createdAt),
  ],
);

export const payments = pgTable(
  'payments',
  {
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
    receiptNo: varchar('receipt_no', { length: 30 }),
    notes: text('notes'),
    // ─── Phase 1: Cash Control columns ───────────────────────────────────────
    // shiftId: nullable so existing rows (before cashier_shifts) remain valid
    shiftId: uuid('shift_id').references(() => cashierShifts.id),
    // status: default 'completed' so all existing payments stay valid
    status: paymentStatusEnum('status').notNull().default('completed'),
    voidedAt: timestamp('voided_at'),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
  },
  (t) => [
    index('payments_paid_at_idx').on(t.paidAt),
    index('payments_status_idx').on(t.status),
    index('payments_shift_id_idx').on(t.shiftId),
  ],
);

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
    /** Positive = addon charge, negative = discount/loyalty applied */
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    appliedAt: timestamp('applied_at').notNull().defaultNow(),
  },
  (t) => [index('payment_line_items_payment_id_idx').on(t.paymentId)],
);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    type: paymentMethodTypeEnum('type').notNull(),
    requiresReference: boolean('requires_reference').notNull().default(false),
    allowOverpay: boolean('allow_overpay').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('payment_methods_type_idx').on(t.type),
    index('payment_methods_active_sort_idx').on(t.isActive, t.sortOrder),
  ],
);

export const receivingAccounts = pgTable(
  'receiving_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    type: receivingAccountTypeEnum('type').notNull(),
    bankName: varchar('bank_name', { length: 255 }),
    accountLabel: varchar('account_label', { length: 255 }),
    accountLast4: varchar('account_last4', { length: 4 }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('receiving_accounts_type_idx').on(t.type),
    index('receiving_accounts_active_sort_idx').on(t.isActive, t.sortOrder),
  ],
);

export const paymentMethodAccounts = pgTable(
  'payment_method_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    receivingAccountId: uuid('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_method_accounts_unique_idx').on(t.paymentMethodId, t.receivingAccountId),
    index('payment_method_accounts_method_idx').on(t.paymentMethodId),
    index('payment_method_accounts_account_idx').on(t.receivingAccountId),
    index('payment_method_accounts_active_idx').on(t.isActive),
  ],
);

export const paymentRows = pgTable(
  'payment_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    receivingAccountId: uuid('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    amountTendered: numeric('amount_tendered', { precision: 10, scale: 2 }),
    changeAmount: numeric('change_amount', { precision: 10, scale: 2 }).notNull().default('0'),
    referenceNo: varchar('reference_no', { length: 100 }),
    payerLabel: varchar('payer_label', { length: 100 }),
    note: text('note'),
    status: paymentStatusEnum('status').notNull().default('completed'),
    cashierId: uuid('cashier_id').references(() => users.id),
    shiftId: uuid('shift_id').references(() => cashierShifts.id),
    paidAt: timestamp('paid_at').notNull().defaultNow(),
    voidedAt: timestamp('voided_at'),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('payment_rows_payment_id_idx').on(t.paymentId),
    index('payment_rows_session_id_idx').on(t.sessionId),
    index('payment_rows_method_id_idx').on(t.paymentMethodId),
    index('payment_rows_account_id_idx').on(t.receivingAccountId),
    index('payment_rows_shift_id_idx').on(t.shiftId),
    index('payment_rows_status_idx').on(t.status),
    index('payment_rows_paid_at_idx').on(t.paidAt),
  ],
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

// ─── Phase 1: Cash Control Tables ────────────────────────────────────────────

export const cashierShifts = pgTable(
  'cashier_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').references(() => branches.id),
    cashierId: uuid('cashier_id')
      .notNull()
      .references(() => users.id),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    closedBy: uuid('closed_by').references(() => users.id),
    status: cashierShiftStatusEnum('status').notNull().default('open'),
    openedAt: timestamp('opened_at').notNull().defaultNow(),
    closedAt: timestamp('closed_at'),
    /** เงินทอนตั้งต้นในลิ้นชัก */
    openingFloat: numeric('opening_float', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** คำนวณจาก cash payments ในรอบนี้ + openingFloat */
    expectedCash: numeric('expected_cash', { precision: 10, scale: 2 }),
    /** จำนวนเงินสดที่นับได้จริงเมื่อปิดรอบ */
    actualCash: numeric('actual_cash', { precision: 10, scale: 2 }),
    /** actualCash − expectedCash (ลบ = เงินขาด, บวก = เงินเกิน) */
    cashDifference: numeric('cash_difference', { precision: 10, scale: 2 }),
    differenceReason: text('difference_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNotes: text('review_notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('cashier_shifts_cashier_opened_at_idx').on(t.cashierId, t.openedAt),
    index('cashier_shifts_branch_status_idx').on(t.branchId, t.status),
  ],
);

/** Immutable ledger of payment adjustments (void / refund / discount correction).
 *  Never delete rows — only update status to approved/rejected.
 *
 *  paymentId intentionally has NO FK constraint: in Approach C the payment row
 *  is hard-deleted after this record is inserted. paymentId is kept as a
 *  reference-only UUID for audit trail. Use paymentSnapshot to recover payment
 *  details after the payment row is gone. sessionId (FK → sessions) provides
 *  a stable lookup path since sessions are never deleted. */
export const paymentAdjustments = pgTable(
  'payment_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No FK — payment row may be hard-deleted (Approach C); kept for audit trail only
    paymentId: uuid('payment_id').notNull(),
    // FK → sessions (never deleted) — enables lookup by session/table/history
    sessionId: uuid('session_id').references(() => sessions.id),
    shiftId: uuid('shift_id').references(() => cashierShifts.id),
    type: paymentAdjustmentTypeEnum('type').notNull(),
    /** บวก = คืนเงิน / ลดยอด, ลบ = เพิ่มยอด */
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    /** Snapshot of the payment at time of void — preserved after hard delete */
    paymentSnapshot: jsonb('payment_snapshot'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    status: paymentAdjustmentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payment_adjustments_payment_id_idx').on(t.paymentId),
    index('payment_adjustments_session_id_idx').on(t.sessionId),
    index('payment_adjustments_status_idx').on(t.status),
    index('payment_adjustments_shift_id_idx').on(t.shiftId),
  ],
);

/** Discount approval requests — cashier submits, manager/owner approves. */
export const discountApprovals = pgTable(
  'discount_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    /** Reuse existing discountTypeEnum ('fixed' | 'percentage') */
    discountType: discountTypeEnum('discount_type').notNull(),
    discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    status: discountApprovalStatusEnum('status').notNull().default('pending'),
    /** auto-expire ถ้า manager ไม่อนุมัติภายในเวลาที่กำหนด */
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('discount_approvals_session_id_idx').on(t.sessionId),
    index('discount_approvals_status_idx').on(t.status),
    index('discount_approvals_requested_by_idx').on(t.requestedBy),
  ],
);

// ─── Inventory Tables ─────────────────────────────────────────────────────────

export const ingredientCategories = pgTable('ingredient_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  taxId: text('tax_id'),
  lineContact: text('line_contact'),
  avgLeadTimeDays: integer('avg_lead_time_days').notNull().default(1),
  minOrderAmount: numeric('min_order_amount', { precision: 10, scale: 2 }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const ingredients = pgTable(
  'ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => ingredientCategories.id),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    minStock: numeric('min_stock', { precision: 10, scale: 2 }).notNull().default('0'),
    parLevel: numeric('par_level', { precision: 10, scale: 2 }).notNull().default('0'),
    lastCost: numeric('last_cost', { precision: 10, scale: 2 }).notNull().default('0'),
    defaultSupplierId: uuid('default_supplier_id').references(() => suppliers.id),
    isActive: boolean('is_active').notNull().default(true),
    /** ABC classification: daily = นับทุกวัน, weekly = นับรายสัปดาห์ */
    countFrequency: countFrequencyEnum('count_frequency').notNull().default('daily'),
    /** % ที่ใช้ได้จริงหลังตัดแต่ง (yield), e.g. ผัก 80 → ซื้อ 10kg ใช้ได้ 8kg */
    yieldPercent: numeric('yield_percent', { precision: 5, scale: 2 }).notNull().default('100'),
    /** หน่วยสั่งซื้อ เช่น "ลัง", "กล่อง" (null = same as unit) */
    orderUnit: text('order_unit'),
    /** กี่ unit ต่อ 1 orderUnit เช่น ลัง = 12 กก. → 12 */
    orderUnitConversion: numeric('order_unit_conversion', { precision: 10, scale: 4 }).notNull().default('1'),
    storageLocation: text('storage_location'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('ingredients_category_idx').on(t.categoryId),
    index('ingredients_active_idx').on(t.isActive),
  ],
);

export const stockCounts = pgTable(
  'stock_counts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countDate: date('count_date').notNull(),
    countedBy: uuid('counted_by')
      .notNull()
      .references(() => users.id),
    status: stockCountStatusEnum('status').notNull().default('draft'),
    branchId: uuid('branch_id').references(() => branches.id),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    submittedAt: timestamp('submitted_at'),
  },
  (t) => [
    uniqueIndex('stock_counts_date_unique').on(t.countDate),
    index('stock_counts_date_idx').on(t.countDate),
  ],
);

export const stockCountItems = pgTable(
  'stock_count_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stockCountId: uuid('stock_count_id')
      .notNull()
      .references(() => stockCounts.id),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id),
    /** ยอดยกมาจากวันก่อน (auto-populated from previous count) */
    openingBalance: numeric('opening_balance', { precision: 10, scale: 2 }).notNull().default('0'),
    /** รับเข้าวันนี้ (manual) */
    receivedQty: numeric('received_qty', { precision: 10, scale: 2 }).notNull().default('0'),
    /** ใช้ไปวันนี้ (manual) */
    usedQty: numeric('used_qty', { precision: 10, scale: 2 }).notNull().default('0'),
    /** คงเหลือ = openingBalance + receivedQty − usedQty (stored computed) */
    quantityOnHand: numeric('quantity_on_hand', { precision: 10, scale: 2 }).notNull().default('0'),
    unit: text('unit').notNull(),
    notes: text('notes'),
  },
  (t) => [index('stock_count_items_count_idx').on(t.stockCountId)],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poNumber: text('po_number').notNull().unique(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: purchaseOrderStatusEnum('status').notNull().default('draft'),
    branchId: uuid('branch_id').references(() => branches.id),
    orderDate: date('order_date').notNull(),
    expectedDate: date('expected_date'),
    receivedDate: date('received_date'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('7.00'),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    hasTaxInvoice: boolean('has_tax_invoice').notNull().default(false),
    taxInvoiceNumber: text('tax_invoice_number'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('purchase_orders_supplier_idx').on(t.supplierId),
    index('purchase_orders_status_idx').on(t.status),
    index('purchase_orders_date_idx').on(t.orderDate),
  ],
);

export const stockCountAdjustments = pgTable(
  'stock_count_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stockCountId: uuid('stock_count_id')
      .notNull()
      .references(() => stockCounts.id),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id),
    adjustmentQty: numeric('adjustment_qty', { precision: 10, scale: 2 }).notNull(),
    adjustmentType: adjustmentTypeEnum('adjustment_type').notNull().default('adjustment'),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('stock_count_adj_count_idx').on(t.stockCountId),
    index('stock_count_adj_ingredient_idx').on(t.ingredientId),
  ],
);

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
    unit: text('unit').notNull(),
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
    receivedQuantity: numeric('received_quantity', { precision: 10, scale: 2 }),
  },
  (t) => [index('po_items_po_idx').on(t.purchaseOrderId)],
);

// ─── Goods Receipts (partial / discrepancy-aware receiving) ──────────────────

/** One delivery event per PO — supports multiple partial deliveries on different dates */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id),
    receivedDate: date('received_date').notNull(),
    notes: text('notes'),
    receivedBy: uuid('received_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('goods_receipts_po_idx').on(t.purchaseOrderId),
    index('goods_receipts_date_idx').on(t.receivedDate),
  ],
);

export const goodsReceiptItems = pgTable(
  'goods_receipt_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goodsReceiptId: uuid('goods_receipt_id')
      .notNull()
      .references(() => goodsReceipts.id),
    purchaseOrderItemId: uuid('purchase_order_item_id')
      .notNull()
      .references(() => purchaseOrderItems.id),
    receivedQuantity: numeric('received_quantity', { precision: 10, scale: 2 }).notNull(),
    discrepancyType: discrepancyTypeEnum('discrepancy_type').notNull().default('none'),
    discrepancyNotes: text('discrepancy_notes'),
  },
  (t) => [index('goods_receipt_items_receipt_idx').on(t.goodsReceiptId)],
);

// ─── Recipe Tables ───────────────────────────────────────────────────────────

export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    servingSize: integer('serving_size').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('recipe_menu_item_idx').on(t.menuItemId, t.isActive)],
);

export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredients.id),
  quantity: numeric('quantity', { precision: 10, scale: 4 }).notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  notes: varchar('notes', { length: 200 }),
});

// ─── HR Tables ────────────────────────────────────────────────────────────────

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    branchId: uuid('branch_id').references(() => branches.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phone: text('phone'),
    bankName: text('bank_name'),
    bankAccountNumber: text('bank_account_number'),
    type: employeeTypeEnum('type').notNull(),
    status: employeeStatusEnum('status').notNull().default('active'),
    baseSalaryPerCycle: numeric('base_salary_per_cycle', { precision: 12, scale: 2 }),
    incentivePerDay: numeric('incentive_per_day', { precision: 10, scale: 2 }).notNull().default('0'),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }),
    startDate: date('start_date'),
    employmentEndDate: date('employment_end_date'),
    nationalId: varchar('national_id', { length: 13 }),
    taxId: varchar('tax_id', { length: 13 }),
    socialSecurityNumber: varchar('social_security_number', { length: 15 }),
    ssfRegistered: boolean('ssf_registered').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('employees_type_idx').on(t.type),
    index('employees_status_idx').on(t.status),
  ],
);

export const scheduleCycles = pgTable('schedule_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => branches.id),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: scheduleCycleStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
});

export const scheduleEntries = pgTable(
  'schedule_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cycleId: uuid('cycle_id').notNull().references(() => scheduleCycles.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    workDate: date('work_date').notNull(),
    status: scheduleEntryStatusEnum('status').notNull().default('working'),
    shiftType: shiftTypeEnum('shift_type'),
    startTime: text('start_time'),
    endTime: text('end_time'),
    leaveReason: text('leave_reason'),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('schedule_entries_unique').on(t.cycleId, t.employeeId, t.workDate),
    index('schedule_entries_cycle_idx').on(t.cycleId),
    index('schedule_entries_emp_date_idx').on(t.employeeId, t.workDate),
  ],
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    workDate: date('work_date').notNull(),
    clockIn: text('clock_in').notNull(),
    clockOut: text('clock_out').notNull(),
    totalHours: numeric('total_hours', { precision: 6, scale: 2 }).notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    notes: text('notes'),
  },
  (t) => [index('time_entries_emp_date_idx').on(t.employeeId, t.workDate)],
);

export const payrollCycles = pgTable('payroll_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => branches.id),
  workStartDate: date('work_start_date').notNull(),
  workEndDate: date('work_end_date').notNull(),
  payDate: date('pay_date').notNull(),
  status: payrollStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
});

export const payrollItems = pgTable(
  'payroll_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payrollCycleId: uuid('payroll_cycle_id').notNull().references(() => payrollCycles.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    employeeType: employeeTypeEnum('employee_type').notNull(),
    // snapshot values — locked at cycle creation time
    baseSalary: numeric('base_salary', { precision: 12, scale: 2 }).notNull().default('0'),
    incentivePerDay: numeric('incentive_per_day', { precision: 10, scale: 2 }).notNull().default('0'),
    workDays: integer('work_days').notNull().default(0),
    incentiveTotal: numeric('incentive_total', { precision: 12, scale: 2 }).notNull().default('0'),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }).notNull().default('0'),
    totalHours: numeric('total_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    hourlyTotal: numeric('hourly_total', { precision: 12, scale: 2 }).notNull().default('0'),
    absenceDays: integer('absence_days').notNull().default(0),
    absenceDeduction: numeric('absence_deduction', { precision: 12, scale: 2 }).notNull().default('0'),
    lateMinutes: integer('late_minutes').notNull().default(0),
    lateDeduction: numeric('late_deduction', { precision: 12, scale: 2 }).notNull().default('0'),
    advanceTotal: numeric('advance_total', { precision: 12, scale: 2 }).notNull().default('0'),
    damageTotal: numeric('damage_total', { precision: 12, scale: 2 }).notNull().default('0'),
    gross: numeric('gross', { precision: 12, scale: 2 }).notNull().default('0'),
    totalDeduction: numeric('total_deduction', { precision: 12, scale: 2 }).notNull().default('0'),
    netPay: numeric('net_pay', { precision: 12, scale: 2 }).notNull().default('0'),
    ssfEmployee: numeric('ssf_employee', { precision: 10, scale: 2 }).notNull().default('0'),
    ssfEmployer: numeric('ssf_employer', { precision: 10, scale: 2 }).notNull().default('0'),
    withholdingTax: numeric('withholding_tax', { precision: 10, scale: 2 }).notNull().default('0'),
    netPayAfterTax: numeric('net_pay_after_tax', { precision: 12, scale: 2 }).notNull().default('0'),
    isPaid: boolean('is_paid').notNull().default(false),
    paidMethod: hrPaymentMethodEnum('paid_method'),
    paidAt: timestamp('paid_at'),
    paymentProofUrl: text('payment_proof_url'),
    notes: text('notes'),
  },
  (t) => [
    index('payroll_items_cycle_idx').on(t.payrollCycleId),
    index('payroll_items_emp_idx').on(t.employeeId),
  ],
);

export const payrollDeductions = pgTable(
  'payroll_deductions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payrollItemId: uuid('payroll_item_id').notNull().references(() => payrollItems.id, { onDelete: 'cascade' }),
    type: deductionTypeEnum('type').notNull(),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    occurredDate: date('occurred_date'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('payroll_deductions_item_idx').on(t.payrollItemId)],
);

export const payrollAbsences = pgTable(
  'payroll_absences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payrollItemId: uuid('payroll_item_id').notNull().references(() => payrollItems.id, { onDelete: 'cascade' }),
    type: absenceTypeEnum('type').notNull(),
    occurredDate: date('occurred_date').notNull(),
    lateMinutes: integer('late_minutes'),
    notes: text('notes'),
  },
  (t) => [index('payroll_absences_item_idx').on(t.payrollItemId)],
);

export const hrSettings = pgTable('hr_settings', {
  id: text('id').primaryKey().default('singleton'),
  absenceRatePerDay: numeric('absence_rate_per_day', { precision: 10, scale: 2 }).notNull().default('0'),
  lateRatePerMinute: numeric('late_rate_per_minute', { precision: 10, scale: 2 }).notNull().default('0'),
  morningShiftStart: text('morning_shift_start').notNull().default('10:00'),
  morningShiftEnd: text('morning_shift_end').notNull().default('18:00'),
  afternoonShiftStart: text('afternoon_shift_start').notNull().default('14:00'),
  afternoonShiftEnd: text('afternoon_shift_end').notNull().default('22:00'),
  defaultBreakMinutes: integer('default_break_minutes').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const branchesRelations = relations(branches, ({ many }) => ({
  users: many(users),
  tables: many(tables),
  sessions: many(sessions),
  stockCounts: many(stockCounts),
  purchaseOrders: many(purchaseOrders),
  employees: many(employees),
  scheduleCycles: many(scheduleCycles),
  payrollCycles: many(payrollCycles),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
  payments: many(payments),
  paymentRows: many(paymentRows),
  auditLogs: many(auditLogs),
  stockCounts: many(stockCounts),
  purchaseOrders: many(purchaseOrders),
  employees: many(employees),
  scheduleCycles: many(scheduleCycles),
  payrollCycles: many(payrollCycles),
  // Phase 1: Cash Control
  cashierShiftsAsOwner: many(cashierShifts, { relationName: 'cashierShiftsCashier' }),
  cashierShiftsOpened: many(cashierShifts, { relationName: 'cashierShiftsOpenedBy' }),
  paymentAdjustmentsRequested: many(paymentAdjustments, { relationName: 'adjustmentRequestedBy' }),
  discountApprovalsRequested: many(discountApprovals, { relationName: 'discountRequestedBy' }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  sessions: many(sessions),
  visits: many(customerVisits),
}));

export const customerVisitsRelations = relations(customerVisits, ({ one }) => ({
  customer: one(customers, { fields: [customerVisits.customerId], references: [customers.id] }),
  session: one(sessions, { fields: [customerVisits.sessionId], references: [sessions.id] }),
}));

export const tablesRelations = relations(tables, ({ one, many }) => ({
  branch: one(branches, { fields: [tables.branchId], references: [branches.id] }),
  sessions: many(sessions),
}));

export const pricingTilesRelations = relations(pricingTiles, ({ many }) => ({
  sessionGuests: many(sessionGuests),
  paymentLineItems: many(paymentLineItems),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  table: one(tables, { fields: [sessions.tableId], references: [tables.id] }),
  branch: one(branches, { fields: [sessions.branchId], references: [branches.id] }),
  customer: one(customers, { fields: [sessions.customerId], references: [customers.id] }),
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
  paymentRows: many(paymentRows),
  customerVisits: many(customerVisits),
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
  recipes: many(recipes),
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
  rows: many(paymentRows),
  // Phase 1: Cash Control
  shift: one(cashierShifts, {
    fields: [payments.shiftId],
    references: [cashierShifts.id],
  }),
  voidedByUser: one(users, {
    fields: [payments.voidedBy],
    references: [users.id],
    relationName: 'paymentsVoidedBy',
  }),
  // Note: adjustments relation removed — paymentAdjustments.paymentId has no FK
  // (payment rows may be hard-deleted in Approach C). Query via session instead.
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

export const paymentMethodsRelations = relations(paymentMethods, ({ many }) => ({
  accounts: many(paymentMethodAccounts),
  rows: many(paymentRows),
}));

export const receivingAccountsRelations = relations(receivingAccounts, ({ many }) => ({
  methods: many(paymentMethodAccounts),
  rows: many(paymentRows),
}));

export const paymentMethodAccountsRelations = relations(paymentMethodAccounts, ({ one }) => ({
  paymentMethod: one(paymentMethods, {
    fields: [paymentMethodAccounts.paymentMethodId],
    references: [paymentMethods.id],
  }),
  receivingAccount: one(receivingAccounts, {
    fields: [paymentMethodAccounts.receivingAccountId],
    references: [receivingAccounts.id],
  }),
}));

export const paymentRowsRelations = relations(paymentRows, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentRows.paymentId],
    references: [payments.id],
  }),
  session: one(sessions, {
    fields: [paymentRows.sessionId],
    references: [sessions.id],
  }),
  paymentMethod: one(paymentMethods, {
    fields: [paymentRows.paymentMethodId],
    references: [paymentMethods.id],
  }),
  receivingAccount: one(receivingAccounts, {
    fields: [paymentRows.receivingAccountId],
    references: [receivingAccounts.id],
  }),
  cashier: one(users, {
    fields: [paymentRows.cashierId],
    references: [users.id],
  }),
  shift: one(cashierShifts, {
    fields: [paymentRows.shiftId],
    references: [cashierShifts.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

// ─── Phase 1: Cash Control Relations ─────────────────────────────────────────

export const cashierShiftsRelations = relations(cashierShifts, ({ one, many }) => ({
  branch: one(branches, { fields: [cashierShifts.branchId], references: [branches.id] }),
  cashier: one(users, {
    fields: [cashierShifts.cashierId],
    references: [users.id],
    relationName: 'cashierShiftsCashier',
  }),
  openedByUser: one(users, {
    fields: [cashierShifts.openedBy],
    references: [users.id],
    relationName: 'cashierShiftsOpenedBy',
  }),
  closedByUser: one(users, {
    fields: [cashierShifts.closedBy],
    references: [users.id],
    relationName: 'cashierShiftsClosedBy',
  }),
  reviewedByUser: one(users, {
    fields: [cashierShifts.reviewedBy],
    references: [users.id],
    relationName: 'cashierShiftsReviewedBy',
  }),
  payments: many(payments),
  paymentRows: many(paymentRows),
  adjustments: many(paymentAdjustments),
}));

export const paymentAdjustmentsRelations = relations(paymentAdjustments, ({ one }) => ({
  // No payment relation — paymentId has no FK; payment row may be hard-deleted.
  // Use paymentSnapshot jsonb field to recover payment details after deletion.
  session: one(sessions, {
    fields: [paymentAdjustments.sessionId],
    references: [sessions.id],
  }),
  shift: one(cashierShifts, {
    fields: [paymentAdjustments.shiftId],
    references: [cashierShifts.id],
  }),
  requestedByUser: one(users, {
    fields: [paymentAdjustments.requestedBy],
    references: [users.id],
    relationName: 'adjustmentRequestedBy',
  }),
  approvedByUser: one(users, {
    fields: [paymentAdjustments.approvedBy],
    references: [users.id],
    relationName: 'adjustmentApprovedBy',
  }),
}));

export const discountApprovalsRelations = relations(discountApprovals, ({ one }) => ({
  session: one(sessions, {
    fields: [discountApprovals.sessionId],
    references: [sessions.id],
  }),
  requestedByUser: one(users, {
    fields: [discountApprovals.requestedBy],
    references: [users.id],
    relationName: 'discountRequestedBy',
  }),
  approvedByUser: one(users, {
    fields: [discountApprovals.approvedBy],
    references: [users.id],
    relationName: 'discountApprovedBy',
  }),
}));

export const ingredientCategoriesRelations = relations(ingredientCategories, ({ many }) => ({
  ingredients: many(ingredients),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  ingredients: many(ingredients),
  purchaseOrders: many(purchaseOrders),
}));

export const ingredientsRelations = relations(ingredients, ({ one, many }) => ({
  category: one(ingredientCategories, {
    fields: [ingredients.categoryId],
    references: [ingredientCategories.id],
  }),
  defaultSupplier: one(suppliers, {
    fields: [ingredients.defaultSupplierId],
    references: [suppliers.id],
  }),
  stockCountItems: many(stockCountItems),
  purchaseOrderItems: many(purchaseOrderItems),
  recipeIngredients: many(recipeIngredients),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  menuItem: one(menuItems, {
    fields: [recipes.menuItemId],
    references: [menuItems.id],
  }),
  ingredients: many(recipeIngredients),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeIngredients.recipeId],
    references: [recipes.id],
  }),
  ingredient: one(ingredients, {
    fields: [recipeIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const stockCountsRelations = relations(stockCounts, ({ one, many }) => ({
  countedByUser: one(users, {
    fields: [stockCounts.countedBy],
    references: [users.id],
  }),
  branch: one(branches, { fields: [stockCounts.branchId], references: [branches.id] }),
  items: many(stockCountItems),
  adjustments: many(stockCountAdjustments),
}));

export const stockCountAdjustmentsRelations = relations(stockCountAdjustments, ({ one }) => ({
  stockCount: one(stockCounts, {
    fields: [stockCountAdjustments.stockCountId],
    references: [stockCounts.id],
  }),
  ingredient: one(ingredients, {
    fields: [stockCountAdjustments.ingredientId],
    references: [ingredients.id],
  }),
  createdByUser: one(users, {
    fields: [stockCountAdjustments.createdBy],
    references: [users.id],
  }),
}));

export const stockCountItemsRelations = relations(stockCountItems, ({ one }) => ({
  stockCount: one(stockCounts, {
    fields: [stockCountItems.stockCountId],
    references: [stockCounts.id],
  }),
  ingredient: one(ingredients, {
    fields: [stockCountItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  branch: one(branches, { fields: [purchaseOrders.branchId], references: [branches.id] }),
  createdByUser: one(users, {
    fields: [purchaseOrders.createdBy],
    references: [users.id],
  }),
  items: many(purchaseOrderItems),
  goodsReceipts: many(goodsReceipts),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  ingredient: one(ingredients, {
    fields: [purchaseOrderItems.ingredientId],
    references: [ingredients.id],
  }),
  goodsReceiptItems: many(goodsReceiptItems),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceipts.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  receivedByUser: one(users, {
    fields: [goodsReceipts.receivedBy],
    references: [users.id],
  }),
  items: many(goodsReceiptItems),
}));

export const goodsReceiptItemsRelations = relations(goodsReceiptItems, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, {
    fields: [goodsReceiptItems.goodsReceiptId],
    references: [goodsReceipts.id],
  }),
  purchaseOrderItem: one(purchaseOrderItems, {
    fields: [goodsReceiptItems.purchaseOrderItemId],
    references: [purchaseOrderItems.id],
  }),
}));

// ─── HR Relations ─────────────────────────────────────────────────────────────

export const employeesRelations = relations(employees, ({ one, many }) => ({
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  branch: one(branches, { fields: [employees.branchId], references: [branches.id] }),
  scheduleEntries: many(scheduleEntries),
  timeEntries: many(timeEntries),
  payrollItems: many(payrollItems),
}));

export const scheduleCyclesRelations = relations(scheduleCycles, ({ one, many }) => ({
  createdByUser: one(users, { fields: [scheduleCycles.createdBy], references: [users.id] }),
  branch: one(branches, { fields: [scheduleCycles.branchId], references: [branches.id] }),
  entries: many(scheduleEntries),
}));

export const scheduleEntriesRelations = relations(scheduleEntries, ({ one }) => ({
  cycle: one(scheduleCycles, { fields: [scheduleEntries.cycleId], references: [scheduleCycles.id] }),
  employee: one(employees, { fields: [scheduleEntries.employeeId], references: [employees.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  employee: one(employees, { fields: [timeEntries.employeeId], references: [employees.id] }),
}));

export const payrollCyclesRelations = relations(payrollCycles, ({ one, many }) => ({
  createdByUser: one(users, { fields: [payrollCycles.createdBy], references: [users.id] }),
  branch: one(branches, { fields: [payrollCycles.branchId], references: [branches.id] }),
  items: many(payrollItems),
}));

export const payrollItemsRelations = relations(payrollItems, ({ one, many }) => ({
  payrollCycle: one(payrollCycles, { fields: [payrollItems.payrollCycleId], references: [payrollCycles.id] }),
  employee: one(employees, { fields: [payrollItems.employeeId], references: [employees.id] }),
  deductions: many(payrollDeductions),
  absences: many(payrollAbsences),
}));

export const payrollDeductionsRelations = relations(payrollDeductions, ({ one }) => ({
  payrollItem: one(payrollItems, { fields: [payrollDeductions.payrollItemId], references: [payrollItems.id] }),
}));

export const payrollAbsencesRelations = relations(payrollAbsences, ({ one }) => ({
  payrollItem: one(payrollItems, { fields: [payrollAbsences.payrollItemId], references: [payrollItems.id] }),
}));

/* ─── Store Settings (singleton row, id = 1) ─────────────────────────────── */

export type BillTypeLabel = 'food' | 'receipt_short' | 'tax_full';

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
  logoUrl?: string;
  logoHeight?: number;
  /** Document type label shown on the bill */
  billTypeLabel?: BillTypeLabel;
  /**
   * Fields hidden from this bill type.
   * Keys: 'logo' | 'shopName' | 'branch' | 'address' | 'taxId' |
   *       'receiptNo' | 'tableNo' | 'cashier' | 'date' | 'vatPercent' | 'footerNote'
   */
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
  logoUrl: text('logo_url'),
  logoHeight: integer('logo_height').notNull().default(56),
  billPaperWidth: integer('bill_paper_width').notNull().default(80),
  taxInvoicePrefix: varchar('tax_invoice_prefix', { length: 20 }).notNull().default('LHK'),
  receiptCounter: integer('receipt_counter').notNull().default(0),
  receiptCounterDate: varchar('receipt_counter_date', { length: 10 }).notNull().default(''),
  /** Loyalty: how many baht to earn 1 point (default: 10 → spend ฿10 = 1 point) */
  loyaltyPointsPerBaht: integer('loyalty_points_per_baht').notNull().default(10),
  /** Loyalty: how many points to redeem ฿1 (default: 10 → 10 pts = ฿1) */
  loyaltyPointsRedeemRate: integer('loyalty_points_redeem_rate').notNull().default(10),
  /** Per-bill-type overrides (null = fall back to global fields above) */
  billPreviewConfig:     jsonb('bill_preview_config').$type<BillConfig>(),
  billMainConfig:        jsonb('bill_main_config').$type<BillConfig>(),
  billSecondaryConfig:   jsonb('bill_secondary_config').$type<BillConfig>(),
  billTaxInvoiceConfig:  jsonb('bill_tax_invoice_config').$type<BillConfig>(),
  /** Global menu label overrides — same for all users */
  menuLabels:            jsonb('menu_labels').$type<Record<string, string>>(),
});

// ─── Monthly Expenses (P&L manual entries) ───────────────────────────────────

export const monthlyExpenseCategoryEnum = pgEnum('monthly_expense_category', [
  'rent', 'electricity', 'water', 'other',
]);

export const monthlyExpenses = pgTable('monthly_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** YYYY-MM */
  month: varchar('month', { length: 7 }).notNull(),
  category: monthlyExpenseCategoryEnum('category').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  note: varchar('note', { length: 255 }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('monthly_expenses_month_cat_unique').on(t.month, t.category),
]);

// ─── Tax Invoice Sequence ─────────────────────────────────────────────────────

/** Sequential numbering for tax invoices, reset monthly. One row per YYYY-MM. */
export const taxInvoiceSequence = pgTable('tax_invoice_sequence', {
  month: varchar('month', { length: 7 }).primaryKey(), // YYYY-MM
  lastNumber: integer('last_number').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerVisit = typeof customerVisits.$inferSelect;
export type NewCustomerVisit = typeof customerVisits.$inferInsert;
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
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
export type ReceivingAccount = typeof receivingAccounts.$inferSelect;
export type NewReceivingAccount = typeof receivingAccounts.$inferInsert;
export type PaymentMethodAccount = typeof paymentMethodAccounts.$inferSelect;
export type NewPaymentMethodAccount = typeof paymentMethodAccounts.$inferInsert;
export type PaymentRow = typeof paymentRows.$inferSelect;
export type NewPaymentRow = typeof paymentRows.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type StoreSettings = typeof storeSettings.$inferSelect;
export type IngredientCategory = typeof ingredientCategories.$inferSelect;
export type NewIngredientCategory = typeof ingredientCategories.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Ingredient = typeof ingredients.$inferSelect;
export type NewIngredient = typeof ingredients.$inferInsert;
export type StockCount = typeof stockCounts.$inferSelect;
export type NewStockCount = typeof stockCounts.$inferInsert;
export type StockCountItem = typeof stockCountItems.$inferSelect;
export type NewStockCountItem = typeof stockCountItems.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;
export type StockCountAdjustment = typeof stockCountAdjustments.$inferSelect;
export type NewStockCountAdjustment = typeof stockCountAdjustments.$inferInsert;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type NewGoodsReceipt = typeof goodsReceipts.$inferInsert;
export type GoodsReceiptItem = typeof goodsReceiptItems.$inferSelect;
export type NewGoodsReceiptItem = typeof goodsReceiptItems.$inferInsert;

// ─── HR Types ─────────────────────────────────────────────────────────────────

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type ScheduleCycle = typeof scheduleCycles.$inferSelect;
export type NewScheduleCycle = typeof scheduleCycles.$inferInsert;
export type ScheduleEntry = typeof scheduleEntries.$inferSelect;
export type NewScheduleEntry = typeof scheduleEntries.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type PayrollCycle = typeof payrollCycles.$inferSelect;
export type NewPayrollCycle = typeof payrollCycles.$inferInsert;
export type PayrollItem = typeof payrollItems.$inferSelect;
export type NewPayrollItem = typeof payrollItems.$inferInsert;
export type PayrollDeduction = typeof payrollDeductions.$inferSelect;
export type NewPayrollDeduction = typeof payrollDeductions.$inferInsert;
export type PayrollAbsence = typeof payrollAbsences.$inferSelect;
export type NewPayrollAbsence = typeof payrollAbsences.$inferInsert;
export type HrSettings = typeof hrSettings.$inferSelect;

// ─── Recipe Types ─────────────────────────────────────────────────────────────

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type NewRecipeIngredient = typeof recipeIngredients.$inferInsert;

// ─── Monthly Expense Types ─────────────────────────────────────────────────────

export type MonthlyExpense = typeof monthlyExpenses.$inferSelect;
export type NewMonthlyExpense = typeof monthlyExpenses.$inferInsert;
export type MonthlyExpenseCategory = typeof monthlyExpenseCategoryEnum.enumValues[number];

// ─── Tax Invoice Types ────────────────────────────────────────────────────────

export type TaxInvoiceSequence = typeof taxInvoiceSequence.$inferSelect;

// ─── Phase 1: Cash Control Types ─────────────────────────────────────────────

export type CashierShift = typeof cashierShifts.$inferSelect;
export type NewCashierShift = typeof cashierShifts.$inferInsert;
export type PaymentAdjustment = typeof paymentAdjustments.$inferSelect;
export type NewPaymentAdjustment = typeof paymentAdjustments.$inferInsert;
export type DiscountApproval = typeof discountApprovals.$inferSelect;
export type NewDiscountApproval = typeof discountApprovals.$inferInsert;
export type PaymentStatus = typeof paymentStatusEnum.enumValues[number];
export type PaymentMethodType = typeof paymentMethodTypeEnum.enumValues[number];
export type ReceivingAccountType = typeof receivingAccountTypeEnum.enumValues[number];
export type CashierShiftStatus = typeof cashierShiftStatusEnum.enumValues[number];
export type PaymentAdjustmentType = typeof paymentAdjustmentTypeEnum.enumValues[number];
export type PaymentAdjustmentStatus = typeof paymentAdjustmentStatusEnum.enumValues[number];
export type DiscountApprovalStatus = typeof discountApprovalStatusEnum.enumValues[number];
