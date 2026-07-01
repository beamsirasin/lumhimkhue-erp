import { z } from 'zod';

export const tileCategoryValues = ['guest', 'addon', 'discount', 'loyalty', 'penalty'] as const;
export type TileCategory = (typeof tileCategoryValues)[number];

export const discountTypeValues = ['fixed', 'percentage'] as const;
export type DiscountType = (typeof discountTypeValues)[number];

export const pricingTileSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'ต้องเป็นตัวอักษรพิมพ์เล็ก ตัวเลข หรือ _'),
  name: z.string().min(1).max(255),
  category: z.enum(tileCategoryValues),
  imageUrl: z.string().max(2_000_000).nullable().optional(),
  price: z.number().min(0),
  vatIncluded: z.boolean().default(true),
  vatRate: z.number().min(0).max(100).default(7),
  discountType: z.enum(discountTypeValues).nullable().optional(),
  discountValue: z.number().min(0).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'ต้องเป็น hex color เช่น #FF0000')
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

export const updatePricingTileSchema = pricingTileSchema.extend({
  id: z.string().uuid(),
  // code is read-only after creation — but we still pass it for reference
});

export const reorderTilesSchema = z.array(
  z.object({ id: z.string().uuid(), sortOrder: z.number().int().min(0) }),
);

export type PricingTileInput = z.infer<typeof pricingTileSchema>;
export type UpdatePricingTileInput = z.infer<typeof updatePricingTileSchema>;
