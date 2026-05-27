import { z } from 'zod';

export const placeOrderSchema = z.object({
  sessionToken: z.string().min(1),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
        notes: z.string().max(200).optional(),
      }),
    )
    .min(1, 'กรุณาเลือกอย่างน้อย 1 รายการ'),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
