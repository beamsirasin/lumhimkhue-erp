'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { GripVertical } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getStaffList,
  createStaff,
  updateStaff,
  resetStaffPassword,
  toggleStaffActive,
  deleteStaff,
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
  owner:   'เจ้าของ',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

const ROLE_COLOR: Record<string, string> = {
  owner:   'bg-purple-100 text-purple-700',
  manager: 'bg-indigo-100 text-indigo-700',
  cashier: 'bg-blue-100 text-blue-700',
  kitchen: 'bg-orange-100 text-orange-700',
};

const UI_LAYOUT_LABEL: Record<string, string> = {
  touchscreen: 'Touchscreen',
  desktop:     'Desktop',
};

const UI_LAYOUT_COLOR: Record<string, string> = {
  touchscreen: 'bg-cyan-100 text-cyan-700',
  desktop:     'bg-muted/50 text-muted-foreground',
};

/* ─── Module groups (for the checkbox UI) ───────────────────── */

export const MODULE_GROUPS = [
  {
    label: 'หน้าบ้าน',
    modules: [
      { id: 'pos',    label: 'POS / แคชเชียร์' },
      { id: 'kds',    label: 'ครัว (KDS)' },
      { id: 'queue',  label: 'จัดการคิว' },
      { id: 'tables', label: 'จัดการโต๊ะ' },
    ],
  },
  {
    label: 'จัดการ',
    modules: [
      { id: 'dashboard',      label: 'แดชบอร์ด' },
      { id: 'reservations',   label: 'จองโต๊ะ' },
      { id: 'menu',           label: 'เมนูอาหาร' },
      { id: 'recipes',        label: 'สูตรอาหาร' },
      { id: 'pricing-tiles',  label: 'Pricing Tiles' },
      { id: 'inventory',      label: 'สต็อก/วัตถุดิบ' },
      { id: 'reports',        label: 'รายงาน' },
      { id: 'hr',             label: 'HR / พนักงาน' },
    ],
  },
  {
    label: 'ตั้งค่า / Admin',
    modules: [
      { id: 'settings', label: 'ตั้งค่าบิล' },
      { id: 'users',    label: 'บัญชีผู้ใช้' },
      { id: 'branches', label: 'สาขา' },
      { id: 'printers', label: 'เครื่องพิมพ์' },
      { id: 'system',   label: 'ข้อมูลระบบ' },
    ],
  },
];

interface StaffPageProps {
  initialData: StaffMember[];
}

type Modal =
  | { type: 'add' }
  | { type: 'edit'; member: StaffMember }
  | { type: 'resetPwd'; member: StaffMember }
  | { type: 'delete'; member: StaffMember };

export function StaffPage({ initialData }: StaffPageProps) {
  const [modal, setModal] = useState<Modal | null>(null);
  const queryClient = useQueryClient();

  const { data: staff = [] } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => getStaffList().then((r) => (r.ok ? r.data : [])),
    initialData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff-list'] });

  const { mutate: toggleActive, isPending: isTogglingActive, variables: toggleActiveVar } = useMutation({
    mutationFn: (id: string) => toggleStaffActive(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  const { mutate: deleteMember, isPending: isDeleting } = useMutation({
    mutationFn: (id: string) => deleteStaff(id),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบ User แล้ว');
      setModal(null);
      invalidate();
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">จัดการ User</h1>
        <button
          type="button"
          onClick={() => setModal({ type: 'add' })}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + เพิ่ม User
        </button>
      </div>

      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">ชื่อ</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Username (Email)</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">UI</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">เมนู</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">สมัครเมื่อ</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.map((member) => (
              <tr key={member.id} className={`hover:bg-muted/30 transition-colors ${!member.isActive ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3 font-medium text-foreground">{member.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[member.role] ?? 'bg-muted text-muted-foreground'}`}>
                    {ROLE_LABEL[member.role] ?? member.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {member.uiLayout ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${UI_LAYOUT_COLOR[member.uiLayout]}`}>
                      {UI_LAYOUT_LABEL[member.uiLayout]}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">ค่าเดิม</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {member.allowedModules?.length ? (
                    <span className="text-xs text-foreground">{member.allowedModules.length} เมนู</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">ค่าเดิม</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {format(new Date(member.createdAt), 'd MMM yy', { locale: th })}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    disabled={isTogglingActive && toggleActiveVar === member.id}
                    onClick={() => toggleActive(member.id)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-50 transition-colors ${
                      member.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {isTogglingActive && toggleActiveVar === member.id ? '...' : member.isActive ? 'เปิด' : 'ปิด'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'edit', member })}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'resetPwd', member })}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      รีเซ็ตรหัสผ่าน
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'delete', member })}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      ลบ
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
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 backdrop-blur-sm px-4 py-6 overflow-y-auto"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="my-auto">
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
            {modal.type === 'delete' && (
              <div className="w-80 rounded-xl bg-card border border-border p-6 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">ยืนยันการลบ</h2>
                  <button type="button" aria-label="ปิด" onClick={() => setModal(null)} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
                </div>
                <p className="mb-1 text-sm text-foreground">
                  ลบ <span className="font-semibold">{modal.member.name}</span> ออกจากระบบ?
                </p>
                <p className="mb-5 text-xs text-muted-foreground">{modal.member.email}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => deleteMember(modal.member.id)}
                    className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {isDeleting ? 'กำลังลบ…' : 'ลบ'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ROLES = Object.entries(ROLE_LABEL) as [string, string][];
const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors';
const BTN   = 'w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors';

/* ─── UI Layout picker ──────────────────────────────────────── */

function UiLayoutPicker({
  value,
  onChange,
}: {
  value: 'touchscreen' | 'desktop' | '';
  onChange: (v: 'touchscreen' | 'desktop') => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Touchscreen card */}
      <button
        type="button"
        onClick={() => onChange('touchscreen')}
        className={`flex flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all duration-150 ${
          value === 'touchscreen'
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/40'
        }`}
      >
        {/* Mini bottom-tab preview */}
        <div className="rounded-lg bg-muted border border-border overflow-hidden h-[60px] flex flex-col">
          <div className="flex-1 bg-muted/60" />
          <div className="h-[18px] border-t border-border flex items-center justify-around px-1">
            {['▪','▪','▪','▪'].map((d, i) => (
              <span key={i} className="text-[6px] text-muted-foreground">{d}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Touchscreen</p>
          <p className="text-[10px] text-muted-foreground leading-snug">Bottom tab bar<br/>เหมาะ POS / tablet ครัว</p>
        </div>
        {value === 'touchscreen' && (
          <span className="self-start rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">เลือก</span>
        )}
      </button>

      {/* Desktop card */}
      <button
        type="button"
        onClick={() => onChange('desktop')}
        className={`flex flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all duration-150 ${
          value === 'desktop'
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/40'
        }`}
      >
        {/* Mini sidebar preview */}
        <div className="rounded-lg bg-muted border border-border overflow-hidden h-[60px] flex flex-row">
          <div className="w-[18px] border-r border-border bg-primary/80 flex flex-col gap-1 py-1 px-0.5">
            {[1,2,3].map((i) => (
              <div key={i} className="h-1 rounded-sm bg-primary-foreground/30" />
            ))}
          </div>
          <div className="flex-1 bg-muted/60" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Desktop / Sidebar</p>
          <p className="text-[10px] text-muted-foreground leading-snug">Left sidebar nav<br/>เหมาะ tablet / คอม</p>
        </div>
        {value === 'desktop' && (
          <span className="self-start rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">เลือก</span>
        )}
      </button>
    </div>
  );
}

/* ─── Module map (flat) ─────────────────────────────────────── */

const ALL_MODULE_MAP = new Map<string, { id: string; label: string }>(
  MODULE_GROUPS.flatMap((g) => g.modules.map((m) => [m.id, m])),
);

/* ─── Sortable row for ordering ─────────────────────────────── */

function SortableModuleRow({ id, label }: { id: string; label: string }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border-b border-border last:border-0 bg-card px-3 py-2 ${
        isDragging ? 'opacity-60 shadow-sm z-10' : ''
      }`}
    >
      <button
        type="button"
        aria-label="ลากย้าย"
        {...attributes}
        {...listeners}
        className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none transition-colors"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="text-xs text-foreground">{label}</span>
    </div>
  );
}

/* ─── Module checkboxes ─────────────────────────────────────── */

function ModulePicker({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((m) => m !== id) : [...value, id]);
  };

  const groupAllSelected = (ids: string[]) => ids.every((id) => value.includes(id));
  const toggleGroup = (ids: string[]) => {
    if (groupAllSelected(ids)) {
      onChange(value.filter((m) => !ids.includes(m)));
    } else {
      const merged = [...new Set([...value, ...ids])];
      onChange(merged);
    }
  };

  return (
    <div className="space-y-3">
      {MODULE_GROUPS.map((group) => {
        const ids = group.modules.map((m) => m.id);
        const allSelected = groupAllSelected(ids);
        return (
          <div key={group.label} className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between bg-muted/50 px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold text-foreground">{group.label}</span>
              <button
                type="button"
                onClick={() => toggleGroup(ids)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors"
              >
                {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-0 p-2">
              {group.modules.map(({ id, label }) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 select-none transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(id)}
                    onChange={() => toggle(id)}
                    className="size-3.5 rounded accent-primary"
                  />
                  <span className="text-xs text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {/* Drag-to-reorder: split by group, only shows groups with ≥1 selected module */}
      {value.length >= 2 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-foreground">จัดลำดับแสดงในแถบนำทาง</span>
            <span className="text-[10px] text-muted-foreground">ลากเพื่อจัดเรียง</span>
          </div>
          {MODULE_GROUPS.map((group) => {
            const groupIds = group.modules.map((m) => m.id);
            const selectedInGroup = value.filter((id) => groupIds.includes(id));
            if (selectedInGroup.length < 1) return null;
            return (
              <div key={group.label} className="border-b border-border last:border-0">
                <div className="bg-muted/30 px-3 py-1.5 border-b border-border">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</span>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;
                    const oldIdx = value.indexOf(active.id as string);
                    const newIdx = value.indexOf(over.id as string);
                    if (oldIdx < 0 || newIdx < 0) return;
                    onChange(arrayMove(value, oldIdx, newIdx));
                  }}
                >
                  <SortableContext items={selectedInGroup} strategy={verticalListSortingStrategy}>
                    {selectedInGroup.map((id) => {
                      const info = ALL_MODULE_MAP.get(id);
                      if (!info) return null;
                      return <SortableModuleRow key={id} id={id} label={info.label} />;
                    })}
                  </SortableContext>
                </DndContext>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ─── Staff Form ────────────────────────────────────────────── */

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

  const defaultModules = initial?.allowedModules ?? [];
  const defaultUiLayout = initial?.uiLayout ?? ('' as '');

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateStaffInput | UpdateStaffInput>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          id: initial.id,
          email: initial.email,
          name: initial.name,
          role: initial.role,
          uiLayout: initial.uiLayout ?? undefined,
          allowedModules: defaultModules,
        }
      : {
          role: 'cashier',
          allowedModules: [],
        },
  });

  async function onSubmit(data: CreateStaffInput | UpdateStaffInput) {
    const result = initial ? await updateStaff(data) : await createStaff(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขข้อมูลแล้ว' : 'เพิ่ม User แล้ว');
    if ('selfUpdated' in result && result.selfUpdated) {
      setTimeout(() => window.location.reload(), 400);
      return;
    }
    onSaved();
  }

  return (
    <div className="w-[560px] max-w-[calc(100vw-2rem)] rounded-xl bg-card border border-border shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{initial ? 'แก้ไข User' : 'เพิ่ม User'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ</label>
              <input {...register('name')} className={INPUT} />
              {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-foreground mb-1.5">Role</label>
              <select {...register('role')} className={INPUT}>
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1.5">Username (Email)</label>
              <input {...register('email')} type="email" className={INPUT} placeholder="user@example.com" />
              {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
            </div>
            {!initial && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">รหัสผ่าน</label>
                <input
                  {...register('password' as keyof (CreateStaffInput | UpdateStaffInput))}
                  type="password"
                  className={INPUT}
                />
                {(errors as { password?: { message?: string } }).password && (
                  <p className="mt-1 text-xs text-red-600">{(errors as { password?: { message?: string } }).password?.message}</p>
                )}
              </div>
            )}
          </div>

          {/* UI Layout selector */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-2">รูปแบบ UI</label>
            <Controller
              control={control}
              name="uiLayout"
              render={({ field }) => (
                <UiLayoutPicker
                  value={(field.value ?? '') as 'touchscreen' | 'desktop' | ''}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.uiLayout && (
              <p className="mt-1 text-xs text-red-600">{errors.uiLayout.message}</p>
            )}
          </div>

          {/* Module picker */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-2">เมนูที่เข้าถึงได้</label>
            <Controller
              control={control}
              name="allowedModules"
              render={({ field }) => (
                <ModulePicker
                  value={field.value ?? []}
                  onChange={field.onChange}
                  error={errors.allowedModules?.message ?? (errors.allowedModules as { root?: { message?: string } })?.root?.message}
                />
              )}
            />
          </div>

        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4">
          <button type="submit" disabled={isSubmitting} className={BTN}>
            {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─── Reset password form ───────────────────────────────────── */

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
    <div className="w-80 rounded-xl bg-card p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">รีเซ็ตรหัสผ่าน — {member.name}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-muted-foreground">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <input type="hidden" {...register('id')} />
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">รหัสผ่านใหม่</label>
          <input {...register('password')} type="password" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary" />
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>
        <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {isSubmitting ? 'กำลังรีเซ็ต…' : 'ยืนยันรีเซ็ตรหัสผ่าน'}
        </button>
      </form>
    </div>
  );
}
