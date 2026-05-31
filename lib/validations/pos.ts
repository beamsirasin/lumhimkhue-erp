import { z } from 'zod';

export const lineItemSchema = z.object({
  pricingTileId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
  /** Computed amount — positive for addon, negative for discount.
   *  The server re-derives this from the tile, but the client sends it for display consistency. */
  amount: z.number(),
});

export const processPaymentSchema = z.object({
  sessionId: z.string().uuid(),
  paymentMethod: z.enum(['cash', 'cash_qr', 'qr_promptpay', 'transfer', 'card']),
  receivedAmount: z.number().min(0),
  discount: z.number().min(0).default(0),
  notes: z.string().max(500).optional(),
  /** Addon/discount tile line items applied at checkout */
  lineItems: z.array(lineItemSchema).default([]),
});

export type ProcessPaymentInput = z.infer<typeof processPaymentSchema>;
export type LineItemInput = z.infer<typeof lineItemSchema>;
