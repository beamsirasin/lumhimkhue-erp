import { z } from 'zod';

export const guestRowSchema = z.object({
  pricingTierId: z.string().uuid(),
  quantity: z.number().int().min(0),
});

export const openSessionSchema = z.object({
  tableId: z.string().uuid(),
  guests: z
    .array(guestRowSchema)
    .refine((arr) => arr.some((g) => g.quantity > 0), {
      message: 'ต้องมีผู้เข้าใช้บริการอย่างน้อย 1 คน',
    }),
  notes: z.string().max(500).optional(),
});

export const closeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export type OpenSessionInput = z.infer<typeof openSessionSchema>;
export type CloseSessionInput = z.infer<typeof closeSessionSchema>;
