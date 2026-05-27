import { z } from 'zod';

export const packageSchema = z.object({
  name: z.string().min(1, 'กรุณากรอกชื่อแพ็กเกจ').max(255),
  priceAdult: z.number().min(0),
  priceChild: z.number().min(0),
  priceSenior: z.number().min(0),
  durationMinutes: z.number().int().min(30).max(480),
  description: z.string().max(1000).optional(),
});

export const updatePackageSchema = packageSchema.extend({
  id: z.string().uuid(),
});

export type PackageInput = z.infer<typeof packageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
