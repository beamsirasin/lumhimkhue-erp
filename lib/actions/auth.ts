'use server';

import { AuthError } from 'next-auth';
import { signIn, signOut } from '@/auth';
import { loginSchema } from '@/lib/validations/auth';

export async function loginAction(
  data: unknown,
): Promise<{ ok: false; error: string }> {
  const parsed = loginSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'ข้อมูลไม่ถูกต้อง' };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
    }
    throw error;
  }

  return { ok: false, error: '' };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
