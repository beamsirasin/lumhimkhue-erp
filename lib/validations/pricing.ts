import { z } from 'zod';

export const pricingTierSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'ต้องเป็นตัวอักษรพิมพ์เล็ก ตัวเลข หรือ _'),
  name: z.string().min(1).max(255),
  price: z.number().min(0),
  vatIncluded: z.boolean().default(true),
  vatRate: z.number().min(0).max(100).default(7),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

export const updatePricingTierSchema = pricingTierSchema.extend({
  id: z.string().uuid(),
});

export type PricingTierInput = z.infer<typeof pricingTierSchema>;
export type UpdatePricingTierInput = z.infer<typeof updatePricingTierSchema>;
