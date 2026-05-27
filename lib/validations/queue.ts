import { z } from 'zod';

export const addQueueSchema = z.object({
  customerName: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  phone: z.string().max(20).optional(),
  partySize: z.number().int().min(1).max(99),
  preferredZone: z.string().max(100).optional(),
});

export type AddQueueInput = z.infer<typeof addQueueSchema>;
