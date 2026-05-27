'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  getStaffList,
  createStaff,
  updateStaff,
  resetStaffPassword,
  toggleStaffActive,
} from '@/lib/actions/staff';
import {
  createStaffSchema,
  updateStaffSchema,
  resetPasswordSchema,
  type CreateStaffInput,
  type UpdateStaffInput,
  type ResetPasswordInput,
} from '@/lib/validations/staff';
import type { StaffMember } from '@/lib/actions/staff';

const ROLE_LABEL: Record<string, string> = {
  owner: 'เจ้าของ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
  host: 'Host',
};

const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  cashier: 'bg-blue-100 text-blue-700',
  kitchen: 'bg-orange-100 text-orange-700',
  host: 'bg-teal-100 text-teal-700',
};

interface StaffPageProps {
  initialData: StaffMember[];
}

type Modal =
  | { type: 'add' }
  | { type: 'edit'; member: StaffMember }
  | { type: 'resetPwd'; member: StaffMember };

export function StaffPage({ initialData }: StaffPageProps) {
  const [modal, setModal] = useState<Modal | null>(null);
  const queryClient = useQueryClient();

  const { data: staff = [] } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => getStaffList().then((r) => (r.ok ? r.data : [])),
    initialData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff-list'] });

  const { mutate: toggleActive } = useMutation({
    mutationFn: (id: string) => toggleStaffActive(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">จัดการพนักงาน</h1>
        <button
          type="button"
          onClick={() => setModal({ type: 'add' })}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          + เพิ่มพนักงาน
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ชื่อ</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">อีเมล</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ตำแหน่ง</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">สมัครเมื่อ</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((member) => (
              <tr key={member.id} className={`hover:bg-slate-50 ${!member.isActive ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3 font-medium text-slate-900">{member.name}</td>
                <td className="px-4 py-3 text-slate-500">{member.email}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLOR[member.role] ?? 'bg-slate-100 text-slate-500'}`}>
                    {ROLE_LABEL[member.role] ?? member.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {format(new Date(member.createdAt), 'd MMM yy', { locale: th })}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => toggleActive(member.id)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      member.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {member.isActive ? 'เปิด' : 'ปิด'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'edit', member })}
                      className="text-xs text-slate-400 hover:text-slate-700"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'resetPwd', member })}
                      className="text-xs text-slate-400 hover:text-slate-700"
                    >
                      รีเซ็ตรหัสผ่าน
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            {modal.type === 'add' && (
              <StaffForm
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {modal.type === 'edit' && (
              <StaffForm
                initial={modal.member}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {modal.type === 'resetPwd' && (
              <ResetPasswordForm
                member={modal.member}
                onClose={() => setModal(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ROLES = Object.entries(ROLE_LABEL) as [string, string][];
const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500';
const BTN = 'w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

function StaffForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: StaffMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const schema = initial ? updateStaffSchema : createStaffSchema;
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<
    CreateStaffInput | UpdateStaffInput
  >({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? { id: initial.id, email: initial.email, name: initial.name, role: initial.role }
      : { role: 'cashier' },
  });

  async function onSubmit(data: CreateStaffInput | UpdateStaffInput) {
    const result = initial ? await updateStaff(data) : await createStaff(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขข้อมูลแล้ว' : 'เพิ่มพนักงานแล้ว');
    onSaved();
  }

  return (
    <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{initial ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อ</label>
          <input {...register('name')} className={INPUT} />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">อีเมล</label>
          <input {...register('email')} type="email" className={INPUT} />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ตำแหน่ง</label>
          <select {...register('role')} className={INPUT}>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {'password' in (errors as object) && !initial && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">รหัสผ่าน</label>
            <input {...register('password' as keyof (CreateStaffInput | UpdateStaffInput))} type="password" className={INPUT} />
          </div>
        )}
        {!initial && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">รหัสผ่าน</label>
            <input {...register('password' as keyof (CreateStaffInput | UpdateStaffInput))} type="password" className={INPUT} />
            {(errors as { password?: { message?: string } }).password && (
              <p className="mt-1 text-xs text-red-600">{(errors as { password?: { message?: string } }).password?.message}</p>
            )}
          </div>
        )}
        <button type="submit" disabled={isSubmitting} className={BTN}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}

function ResetPasswordForm({
  member,
  onClose,
}: {
  member: StaffMember;
  onClose: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { id: member.id },
  });

  async function onSubmit(data: ResetPasswordInput) {
    const result = await resetStaffPassword(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success('รีเซ็ตรหัสผ่านแล้ว');
    onClose();
  }

  return (
    <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">รีเซ็ตรหัสผ่าน — {member.name}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <input type="hidden" {...register('id')} />
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">รหัสผ่านใหม่</label>
          <input {...register('password')} type="password" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>
        <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {isSubmitting ? 'กำลังรีเซ็ต…' : 'ยืนยันรีเซ็ตรหัสผ่าน'}
        </button>
      </form>
    </div>
  );
}
