import { z } from 'zod';

export const revokeManagerApprovalCodeSchema = z.object({
  codeId: z.string().uuid(),
});

export const managerApprovalCodeHistorySchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export type RevokeManagerApprovalCodeInput = z.infer<typeof revokeManagerApprovalCodeSchema>;
export type ManagerApprovalCodeHistoryInput = z.infer<typeof managerApprovalCodeHistorySchema>;
