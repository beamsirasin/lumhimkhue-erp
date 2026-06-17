import { z } from 'zod';

export const paymentMethodTypeSchema = z.enum([
  'promptpay',
  'cash',
  'welfare',
  'mixed_legacy',
  'other',
]);

export const receivingAccountTypeSchema = z.enum([
  'bank_cash_group',
  'welfare',
  'cash_drawer',
  'other',
]);

export const paymentRowStatusSchema = z.enum(['completed', 'voided', 'refunded']);

export const paymentMethodConfigSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  type: paymentMethodTypeSchema,
  requiresReference: z.boolean().default(false),
  allowOverpay: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const receivingAccountConfigSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  type: receivingAccountTypeSchema,
  bankName: z.string().max(255).optional().nullable(),
  accountLabel: z.string().max(255).optional().nullable(),
  accountLast4: z.string().max(4).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const paymentMethodAccountConfigSchema = z.object({
  paymentMethodId: z.string().uuid(),
  receivingAccountId: z.string().uuid(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const paymentRowSchema = z.object({
  paymentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  receivingAccountId: z.string().uuid(),
  amount: z.number().positive(),
  amountTendered: z.number().nonnegative().optional().nullable(),
  changeAmount: z.number().nonnegative().default(0),
  referenceNo: z.string().max(100).optional().nullable(),
  payerLabel: z.string().max(100).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  status: paymentRowStatusSchema.default('completed'),
  cashierId: z.string().uuid().optional().nullable(),
  shiftId: z.string().uuid().optional().nullable(),
});

export type PaymentMethodConfigInput = z.infer<typeof paymentMethodConfigSchema>;
export type ReceivingAccountConfigInput = z.infer<typeof receivingAccountConfigSchema>;
export type PaymentMethodAccountConfigInput = z.infer<typeof paymentMethodAccountConfigSchema>;
export type PaymentRowInput = z.infer<typeof paymentRowSchema>;
