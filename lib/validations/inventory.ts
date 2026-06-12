import { z } from 'zod';

const toNullableUuid = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z.string().uuid().nullable(),
);

const toNullableString = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z.string().nullable(),
);

// ── Ingredient ────────────────────────────────────────────────────────────────

export const createIngredientSchema = z.object({
  categoryId: z.string().uuid('กรุณาเลือกหมวด'),
  name: z.string().min(1, 'กรุณาระบุชื่อวัตถุดิบ'),
  unit: z.string().min(1, 'กรุณาระบุหน่วย'),
  minStock: z.coerce.number().min(0, 'ต้องไม่ต่ำกว่า 0'),
  parLevel: z.coerce.number().min(0, 'ต้องไม่ต่ำกว่า 0'),
  lastCost: z.coerce.number().min(0, 'ต้องไม่ต่ำกว่า 0'),
  defaultSupplierId: toNullableUuid.optional(),
  countFrequency: z.enum(['daily', 'weekly']).default('daily'),
  yieldPercent: z.coerce.number().min(0).max(100).default(100),
  orderUnit: toNullableString.optional(),
  orderUnitConversion: z.coerce.number().min(0.0001).default(1),
  storageLocation: toNullableString.optional(),
  notes: toNullableString.optional(),
});

export const updateIngredientSchema = createIngredientSchema.extend({
  id: z.string().uuid(),
});

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;

// ── Supplier ──────────────────────────────────────────────────────────────────

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'กรุณาระบุชื่อผู้ขาย'),
  contactName: toNullableString.optional(),
  phone: toNullableString.optional(),
  email: toNullableString.optional(),
  address: toNullableString.optional(),
  taxId: toNullableString.optional(),
  lineContact: toNullableString.optional(),
  avgLeadTimeDays: z.coerce.number().int().min(0).default(1),
  minOrderAmount: z.coerce.number().min(0).optional(),
  notes: toNullableString.optional(),
});

export const updateSupplierSchema = createSupplierSchema.extend({
  id: z.string().uuid(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

// ── Stock Count ───────────────────────────────────────────────────────────────

export const saveStockCountSchema = z.object({
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง'),
  asDraft: z.boolean(),
  notes: toNullableString.optional(),
  items: z.array(
    z.object({
      ingredientId: z.string().uuid(),
      openingBalance: z.coerce.number().min(0),
      receivedQty: z.coerce.number().min(0),
      /** Physical count — what staff actually counts on the shelf */
      physicalCount: z.coerce.number().min(0),
      unit: z.string().min(1),
      notes: toNullableString.optional(),
    }),
  ),
});

export type SaveStockCountInput = z.infer<typeof saveStockCountSchema>;

export const createStockAdjustmentSchema = z.object({
  stockCountId: z.string().uuid(),
  ingredientId: z.string().uuid('กรุณาเลือกวัตถุดิบ'),
  adjustmentQty: z.coerce.number().refine((n) => n !== 0, 'จำนวนต้องไม่เป็น 0'),
  adjustmentType: z.enum(['adjustment', 'waste']).default('adjustment'),
  reason: z.string().min(1, 'กรุณาระบุเหตุผล').max(500),
});

export type CreateStockAdjustmentInput = z.infer<typeof createStockAdjustmentSchema>;

// ── Purchase Order ────────────────────────────────────────────────────────────

export const poItemSchema = z.object({
  ingredientId: z.string().uuid('กรุณาเลือกวัตถุดิบ'),
  quantity: z.coerce.number().min(0.01, 'จำนวนต้องมากกว่า 0'),
  unit: z.string().min(1, 'กรุณาระบุหน่วย'),
  unitCost: z.coerce.number().min(0, 'ต้องไม่ต่ำกว่า 0'),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid('กรุณาเลือก Supplier'),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง'),
  expectedDate: toNullableString.optional(),
  vatRate: z.coerce.number().min(0).max(100).default(7),
  hasTaxInvoice: z.boolean().default(false),
  taxInvoiceNumber: toNullableString.optional(),
  notes: toNullableString.optional(),
  items: z.array(poItemSchema).min(1, 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ'),
});

export const updatePurchaseOrderSchema = createPurchaseOrderSchema.extend({
  id: z.string().uuid(),
});

export const receivePurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasTaxInvoice: z.boolean(),
  taxInvoiceNumber: toNullableString.optional(),
  isPartial: z.boolean().default(false),
  notes: toNullableString.optional(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      receivedQuantity: z.coerce.number().min(0),
      discrepancyType: z.enum(['none', 'short', 'wrong', 'spoiled']).default('none'),
      discrepancyNotes: toNullableString.optional(),
    }),
  ),
});

export type PoItemInput = z.infer<typeof poItemSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
