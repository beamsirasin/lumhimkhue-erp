import { z } from 'zod';

export const openSessionSchema = z.object({
  tableId: z.string().uuid(),
  packageId: z.string().uuid(),
  adults: z.number().int().min(1, 'ต้องมีผู้ใหญ่อย่างน้อย 1 คน'),
  children: z.number().int().min(0),
  seniors: z.number().int().min(0),
});

export const extendSessionSchema = z.object({
  sessionId: z.string().uuid(),
  minutes: z.number().int().min(1).max(120),
});

export type OpenSessionInput = z.infer<typeof openSessionSchema>;
export type ExtendSessionInput = z.infer<typeof extendSessionSchema>;
