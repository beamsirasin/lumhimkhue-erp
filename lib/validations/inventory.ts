import { z } from 'zod';

const toNullableUuid = z.preprocess(
  (value) => (value === '' || value == null ? null : value),
  z.string().uuid().nullable(),
);

const toNullableString = z.preprocess(
  (value) => (value === '' || value == null ? null : value),
  z.string().nullable(),
);

const toNullableNumber = z.preprocess(
  (value) => (
    value === '' || value == null || (typeof value === 'number' && Number.isNaN(value))
      ? null
      : value
  ),
  z.coerce.number().min(0).nullable(),
);

export const purchasePriceStatusSchema = z.enum(['pending', 'estimated', 'confirmed']);

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

export const updateIngredientSchema = createIngredientSchema.extend({ id: z.string().uuid() });
export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;

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

export const updateSupplierSchema = createSupplierSchema.extend({ id: z.string().uuid() });
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const saveStockCountSchema = z.object({
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง'),
  asDraft: z.boolean(),
  notes: toNullableString.optional(),
  items: z.array(z.object({
    ingredientId: z.string().uuid(),
    openingBalance: z.coerce.number().min(0),
    receivedQty: z.coerce.number().min(0),
    regularReceivedQty: z.coerce.number().min(0).default(0),
    emergencyReceivedQty: z.coerce.number().min(0).default(0),
    physicalCount: toNullableNumber,
    isCounted: z.boolean(),
    openingOverrideReason: toNullableString.optional(),
    unit: z.string().min(1),
    notes: toNullableString.optional(),
  })),
});

export type SaveStockCountInput = z.infer<typeof saveStockCountSchema>;

export const createStockAdjustmentSchema = z.object({
  stockCountId: z.string().uuid(),
  ingredientId: z.string().uuid('กรุณาเลือกวัตถุดิบ'),
  adjustmentQty: z.coerce.number().refine((value) => value !== 0, 'จำนวนต้องไม่เป็น 0'),
  adjustmentType: z.enum(['adjustment', 'waste']).default('adjustment'),
  reason: z.string().min(1, 'กรุณาระบุเหตุผล').max(500),
});

export type CreateStockAdjustmentInput = z.infer<typeof createStockAdjustmentSchema>;

export const poItemSchema = z.object({
  ingredientId: z.string().uuid('กรุณาเลือกวัตถุดิบ'),
  quantity: z.coerce.number().min(0.01, 'จำนวน stock unit ต้องมากกว่า 0'),
  unit: z.string().min(1, 'กรุณาระบุหน่วยสต็อก'),
  purchaseQuantity: z.coerce.number().positive().optional(),
  purchaseUnit: toNullableString.optional(),
  conversionFactor: z.coerce.number().positive().default(1),
  priceStatus: purchasePriceStatusSchema,
  unitCost: toNullableNumber,
  lastCostSnapshot: toNullableNumber.optional(),
}).superRefine((item, ctx) => {
  if (item.priceStatus !== 'pending' && item.unitCost == null) {
    ctx.addIssue({ code: 'custom', path: ['unitCost'], message: 'กรุณาระบุราคา' });
  }
  if (item.priceStatus === 'confirmed' && item.unitCost === 0) {
    ctx.addIssue({ code: 'custom', path: ['unitCost'], message: 'ราคายืนยันต้องมากกว่า 0' });
  }
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

export const updatePurchaseOrderSchema = createPurchaseOrderSchema.extend({ id: z.string().uuid() });

export const receivePurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasTaxInvoice: z.boolean(),
  taxInvoiceNumber: toNullableString.optional(),
  isPartial: z.boolean().default(false),
  idempotencyKey: z.string().min(16).max(64),
  overReceiveConfirmed: z.boolean().default(false),
  overReceiveReason: toNullableString.optional(),
  notes: toNullableString.optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    receivedQuantity: z.coerce.number().min(0),
    receivedPurchaseQuantity: z.coerce.number().min(0).optional(),
    purchaseUnit: toNullableString.optional(),
    conversionFactor: z.coerce.number().positive().default(1),
    stockUnit: toNullableString.optional(),
    discrepancyType: z.enum(['none', 'short', 'wrong', 'spoiled']).default('none'),
    discrepancyNotes: toNullableString.optional(),
    priceStatus: purchasePriceStatusSchema,
    actualUnitCost: toNullableNumber,
  })).min(1),
});

export const confirmReceiptPriceSchema = z.object({
  goodsReceiptItemId: z.string().uuid(),
  actualUnitCost: z.coerce.number().positive('ราคาจริงต้องมากกว่า 0'),
  reason: z.string().trim().min(3, 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร').max(500),
});

export const voidGoodsReceiptSchema = z.object({
  goodsReceiptId: z.string().uuid(),
  reason: z.string().trim().min(3, 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร').max(500),
});

export const cancelPurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร').max(500),
});

export const emergencyPurchaseSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purchasedAt: z.string().datetime().optional(),
  supplierId: toNullableUuid.optional(),
  vendorName: z.string().trim().min(1, 'กรุณาระบุร้านหรือผู้ขาย').max(200),
  sourcePurchaseOrderId: toNullableUuid.optional(),
  reason: z.string().trim().min(3, 'กรุณาระบุเหตุผลการซื้อฉุกเฉิน').max(500),
  notes: toNullableString.optional(),
  idempotencyKey: z.string().min(16).max(64),
  items: z.array(z.object({
    ingredientId: z.string().uuid(),
    quantity: z.coerce.number().positive(),
    unit: z.string().min(1),
    purchaseUnit: toNullableString.optional(),
    conversion: z.coerce.number().positive().default(1),
    priceStatus: z.enum(['pending', 'confirmed']),
    actualUnitCost: toNullableNumber,
  })).min(1),
}).superRefine((purchase, ctx) => {
  purchase.items.forEach((item, index) => {
    if (item.priceStatus === 'confirmed' && (!item.actualUnitCost || item.actualUnitCost <= 0)) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'actualUnitCost'], message: 'กรุณาระบุราคาจริง' });
    }
  });
});

export type PoItemInput = z.infer<typeof poItemSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type ConfirmReceiptPriceInput = z.infer<typeof confirmReceiptPriceSchema>;
export type VoidGoodsReceiptInput = z.infer<typeof voidGoodsReceiptSchema>;
export type EmergencyPurchaseInput = z.infer<typeof emergencyPurchaseSchema>;
