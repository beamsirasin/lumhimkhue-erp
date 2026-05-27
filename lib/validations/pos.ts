import { z } from 'zod';

export const processPaymentSchema = z.object({
  sessionId: z.string().uuid(),
  paymentMethod: z.enum(['cash', 'qr_promptpay', 'transfer', 'card']),
  receivedAmount: z.number().min(0),
  discount: z.number().min(0).default(0),
  notes: z.string().max(500).optional(),
});

export type ProcessPaymentInput = z.infer<typeof processPaymentSchema>;
