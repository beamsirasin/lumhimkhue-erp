import { z } from 'zod';

export const loginSchema = z.object({
  // Username or email — lowercased to match how createStaff stores it.
  email: z.string().trim().toLowerCase().min(1, 'กรุณากรอก Username หรืออีเมล'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

export type LoginInput = z.infer<typeof loginSchema>;
