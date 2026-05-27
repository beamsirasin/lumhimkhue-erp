import { z } from 'zod';

const roleEnum = z.enum(['owner', 'manager', 'cashier', 'kitchen']);

export const createStaffSchema = z.object({
  email: z.string().email('อีเมลไม่ถูกต้อง'),
  name: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  role: roleEnum,
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
});

export const updateStaffSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email('อีเมลไม่ถูกต้อง'),
  name: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  role: roleEnum,
});

export const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
