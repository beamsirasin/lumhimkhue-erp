import { z } from 'zod';

export const lineItemSchema = z.object({
  pricingTileId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
  /** Computed amount — positive for addon, negative for discount.
   *  The server re-derives this from the tile, but the client sends it for display consistency. */
  amount: z.number(),
});

export const checkoutPaymentRowSchema = z.object({
  paymentMethodId: z.string().uuid(),
  receivingAccountId: z.string().uuid(),
  amount: z.number().positive(),
  amountTendered: z.number().nonnegative().optional().nullable(),
  changeAmount: z.number().nonnegative().optional().nullable(),
  referenceNo: z.string().max(100).optional().nullable(),
  payerLabel: z.string().max(100).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export const allocationInputSchema = z.object({
  chargeLineId: z.string().uuid(),
  quantity: z.number().int().positive(),
  amount: z.number().min(0),
  note: z.string().max(500).optional().nullable(),
});

export const processPaymentSchema = z.object({
  sessionId: z.string().uuid(),
  settlementMode: z.enum(['partial', 'final']).default('final'),
  paymentMethod: z.enum(['cash', 'cash_qr', 'qr_promptpay', 'transfer', 'card']),
  receivedAmount: z.number().min(0),
  discount: z.number().min(0).default(0),
  notes: z.string().max(500).optional().nullable(),
  receiptNo: z.string().max(30).optional(),
  /** Addon/discount tile line items applied at checkout */
  lineItems: z.array(lineItemSchema).default([]),
  /** Phase 2 true tender rows. Optional for legacy callers. */
  paymentRows: z.array(checkoutPaymentRowSchema).optional(),
  /** Phase 8B-3 optional buffet charge line allocations. Legacy callers omit this field. */
  allocations: z.array(allocationInputSchema).optional(),
  /** Whether paying the full remaining bill or a selected subset of charge lines. */
  paymentMode: z.enum(['full', 'items']).optional().default('full'),
});

export type ProcessPaymentInput = z.infer<typeof processPaymentSchema>;
export type LineItemInput = z.infer<typeof lineItemSchema>;
export type CheckoutPaymentRowInput = z.infer<typeof checkoutPaymentRowSchema>;
export type AllocationInput = z.infer<typeof allocationInputSchema>;
