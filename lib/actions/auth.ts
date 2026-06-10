'use server';

import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
import { signIn, signOut } from '@/auth';
import { loginSchema } from '@/lib/validations/auth';
import { isLoginRateLimited } from '@/lib/auth/ratelimit';

export async function loginAction(
  data: unknown,
): Promise<{ ok: false; error: string }> {
  const parsed = loginSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'ข้อมูลไม่ถูกต้อง' };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    '127.0.0.1';

  if (await isLoginRateLimited(ip)) {
    return { ok: false, error: 'บัญชีถูกล็อคชั่วคราว กรุณาลองใหม่ใน 15 นาที' };
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
