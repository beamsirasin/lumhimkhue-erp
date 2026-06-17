import { z } from 'zod';

export const requestDiscountSchema = z.object({
  sessionId: z.string().uuid(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.number().min(0.01),
  reason: z.string().min(1).max(500),
});

export const reviewDiscountSchema = z.object({
  approvalId: z.string().uuid(),
  reviewNotes: z.string().max(500).optional(),
});

export const listDiscountApprovalsSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  sessionId: z.string().uuid().optional(),
});

export type RequestDiscountInput = z.infer<typeof requestDiscountSchema>;
export type ReviewDiscountInput = z.infer<typeof reviewDiscountSchema>;
export type ListDiscountApprovalsInput = z.infer<typeof listDiscountApprovalsSchema>;
