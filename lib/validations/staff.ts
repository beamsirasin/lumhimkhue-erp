import { z } from 'zod';

const roleEnum = z.enum(['owner', 'manager', 'cashier', 'kitchen']);
const uiLayoutEnum = z.enum(['touchscreen', 'desktop', 'tablet']);
const navLayoutSchema = z.object({
  sections: z.array(z.object({ heading: z.string(), modules: z.array(z.string()) })),
});

export const createStaffSchema = z.object({
  email: z.string().email('อีเมลไม่ถูกต้อง'),
  name: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  role: roleEnum,
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
  uiLayout: uiLayoutEnum,
  allowedModules: z.array(z.string()).min(1, 'กรุณาเลือกอย่างน้อย 1 เมนู'),
  navLayout: navLayoutSchema.optional().nullable(),
});

export const updateStaffSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email('อีเมลไม่ถูกต้อง'),
  name: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  role: roleEnum,
  uiLayout: uiLayoutEnum,
  allowedModules: z.array(z.string()).min(1, 'กรุณาเลือกอย่างน้อย 1 เมนู'),
  navLayout: navLayoutSchema.optional().nullable(),
});

export const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
