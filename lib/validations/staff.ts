import { z } from 'zod';

const roleEnum = z.enum(['owner', 'manager', 'cashier', 'kitchen']);
const uiLayoutEnum = z.enum(['touchscreen', 'desktop', 'tablet']);
const navLayoutSchema = z.object({
  sections: z.array(z.object({ heading: z.string(), modules: z.array(z.string()) })),
});

// Login identifier: plain username or email — stored in users.email either way.
// Lowercased at create AND at login (lib/validations/auth.ts) so lookups match.
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username ต้องมีอย่างน้อย 3 ตัวอักษร')
  .max(255)
  .regex(/^[a-z0-9._@-]+$/, 'Username ใช้ได้เฉพาะ a-z, 0-9, จุด (.), ขีด (-), _ และ @');

export const createStaffSchema = z.object({
  email: usernameSchema,
  name: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  role: roleEnum,
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
  uiLayout: uiLayoutEnum,
  allowedModules: z.array(z.string()).min(1, 'กรุณาเลือกอย่างน้อย 1 เมนู'),
  navLayout: navLayoutSchema.optional().nullable(),
});

export const updateStaffSchema = z.object({
  id: z.string().uuid(),
  email: usernameSchema,
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
