'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginSchema, type LoginInput } from '@/lib/validations/auth';
import { loginAction } from '@/lib/actions/auth';
import { AlertCircle } from 'lucide-react';

export function LoginForm() {
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setServerError('');
    const result = await loginAction(data);
    setServerError(result.error);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-xs font-semibold text-foreground">
          Username / อีเมล
        </Label>
        <Input
          id="email"
          type="text"
          placeholder="username หรือ email"
          autoComplete="username"
          aria-invalid={!!errors.email}
          className="h-10"
          {...register('email')}
        />
        {errors.email && (
          <p className="text-[11px] text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-xs font-semibold text-foreground">
          รหัสผ่าน
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          className="h-10"
          {...register('password')}
        />
        {errors.password && (
          <p className="text-[11px] text-destructive">{errors.password.message}</p>
        )}
      </div>

      {serverError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-destructive/8 border border-destructive/20 px-3 py-2.5">
          <AlertCircle className="size-4 shrink-0 text-destructive mt-px" />
          <p className="text-sm text-destructive">{serverError}</p>
        </div>
      )}

      <Button
        type="submit"
        className="w-full h-10 font-semibold mt-2"
        disabled={isSubmitting}
      >
        {isSubmitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </Button>
    </form>
  );
}
