'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  getPackagesCRUD,
  createPackage,
  updatePackage,
  togglePackageActive,
} from '@/lib/actions/packages';
import {
  packageSchema,
  updatePackageSchema,
  type PackageInput,
  type UpdatePackageInput,
} from '@/lib/validations/packages';
import type { PackageCRUD } from '@/lib/actions/packages';

interface PackagesPageProps {
  initialData: PackageCRUD[];
}

export function PackagesPage({ initialData }: PackagesPageProps) {
  const [editing, setEditing] = useState<PackageCRUD | null | 'new'>(null);
  const queryClient = useQueryClient();

  const { data: packages = [] } = useQuery({
    queryKey: ['packages-crud'],
    queryFn: () => getPackagesCRUD().then((r) => (r.ok ? r.data : [])),
    initialData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['packages-crud'] });

  const { mutate: toggleActive } = useMutation({
    mutationFn: (id: string) => togglePackageActive(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">จัดการแพ็กเกจ</h1>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          + เพิ่มแพ็กเกจ
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ชื่อแพ็กเกจ</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">ผู้ใหญ่</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">เด็ก</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">ผู้สูงอายุ</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">เวลา</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {packages.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">ยังไม่มีแพ็กเกจ</td></tr>
            )}
            {packages.map((pkg) => (
              <tr key={pkg.id} className={`hover:bg-slate-50 ${!pkg.isActive ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{pkg.name}</p>
                  {pkg.description && <p className="text-xs text-slate-400 truncate max-w-xs">{pkg.description}</p>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">฿{Number(pkg.priceAdult).toLocaleString('th-TH')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">฿{Number(pkg.priceChild).toLocaleString('th-TH')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">฿{Number(pkg.priceSenior).toLocaleString('th-TH')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{pkg.durationMinutes} นาที</td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => toggleActive(pkg.id)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      pkg.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {pkg.isActive ? 'เปิด' : 'ปิด'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(pkg)}
                    className="text-xs text-slate-400 hover:text-slate-700"
                  >
                    แก้ไข
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setEditing(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PackageForm
              initial={editing !== 'new' ? editing : undefined}
              onClose={() => setEditing(null)}
              onSaved={() => { invalidate(); setEditing(null); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PackageForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: PackageCRUD;
  onClose: () => void;
  onSaved: () => void;
}) {
  const schema = initial ? updatePackageSchema : packageSchema;
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<
    PackageInput | UpdatePackageInput
  >({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          id: initial.id,
          name: initial.name,
          priceAdult: Number(initial.priceAdult),
          priceChild: Number(initial.priceChild),
          priceSenior: Number(initial.priceSenior),
          durationMinutes: initial.durationMinutes,
          description: initial.description ?? '',
        }
      : { priceAdult: 0, priceChild: 0, priceSenior: 0, durationMinutes: 90 },
  });

  async function onSubmit(data: PackageInput | UpdatePackageInput) {
    const result = initial ? await updatePackage(data) : await createPackage(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขแพ็กเกจแล้ว' : 'เพิ่มแพ็กเกจแล้ว');
    onSaved();
  }

  const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500';

  return (
    <div className="w-96 rounded-xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{initial ? 'แก้ไขแพ็กเกจ' : 'เพิ่มแพ็กเกจ'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อแพ็กเกจ</label>
          <input {...register('name')} className={INPUT} />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['priceAdult', 'priceChild', 'priceSenior'] as const).map((field, i) => (
            <div key={field}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {['ผู้ใหญ่', 'เด็ก', 'ผู้สูงอายุ'][i]} (฿)
              </label>
              <input {...register(field, { valueAsNumber: true })} type="number" min={0} step="0.01" className={INPUT} />
            </div>
          ))}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ระยะเวลา (นาที)</label>
          <input {...register('durationMinutes', { valueAsNumber: true })} type="number" min={30} max={480} className={INPUT} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">คำอธิบาย</label>
          <input {...register('description')} className={INPUT} placeholder="ไม่บังคับ" />
        </div>
        <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}
