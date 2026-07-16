import { z } from 'zod';

export const openShiftSchema = z.object({
  openingFloat: z.number().min(0).default(0),
  branchId: z.string().uuid().optional(),
});

export const closeShiftSchema = z.object({
  shiftId: z.string().uuid(),
  actualCash: z.number().min(0),
  differenceReason: z.string().max(500).optional(),
});

export const storeDayApprovalSchema = z.object({
  approvalCode: z.string().trim().min(1).max(20),
  reason: z.string().trim().min(1).max(500),
});

export const reviewShiftSchema = z.object({
  shiftId: z.string().uuid(),
  reviewNotes: z.string().max(1000).optional(),
});

export const listShiftsSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.enum(['open', 'closed', 'reviewed']).optional(),
  cashierId: z.string().uuid().optional(),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type StoreDayApprovalInput = z.infer<typeof storeDayApprovalSchema>;
export type ReviewShiftInput = z.infer<typeof reviewShiftSchema>;
export type ListShiftsInput = z.infer<typeof listShiftsSchema>;
