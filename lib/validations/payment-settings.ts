import { z } from 'zod';
import {
  paymentMethodAccountConfigSchema,
  paymentMethodConfigSchema,
  receivingAccountConfigSchema,
} from '@/lib/validations/payments';

const idSchema = z.object({ id: z.string().uuid() });

export const createPaymentMethodSchema = paymentMethodConfigSchema.extend({
  code: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/i, 'Use letters, numbers, and underscores only'),
  name: z.string().trim().min(1).max(255),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.merge(idSchema);
export const togglePaymentMethodSchema = idSchema;

export const createReceivingAccountSchema = receivingAccountConfigSchema.extend({
  code: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/i, 'Use letters, numbers, and underscores only'),
  name: z.string().trim().min(1).max(255),
  accountLast4: z.string().trim().max(4).optional().nullable(),
});

export const updateReceivingAccountSchema = createReceivingAccountSchema.merge(idSchema);
export const toggleReceivingAccountSchema = idSchema;

export const updateMethodAccountMappingsSchema = z.object({
  paymentMethodId: z.string().uuid(),
  mappings: z.array(paymentMethodAccountConfigSchema.pick({
    receivingAccountId: true,
    isDefault: true,
    isActive: true,
  })).default([]),
});

export const setDefaultReceivingAccountSchema = z.object({
  paymentMethodId: z.string().uuid(),
  receivingAccountId: z.string().uuid(),
});

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
export type CreateReceivingAccountInput = z.infer<typeof createReceivingAccountSchema>;
export type UpdateReceivingAccountInput = z.infer<typeof updateReceivingAccountSchema>;
export type UpdateMethodAccountMappingsInput = z.infer<typeof updateMethodAccountMappingsSchema>;
