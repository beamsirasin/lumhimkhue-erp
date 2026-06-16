'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { GripVertical, Pencil, Plus, X } from 'lucide-react';
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
import { updateMenuLabels } from '@/lib/actions/store';
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
  tablet:      'Tablet',
};

const UI_LAYOUT_COLOR: Record<string, string> = {
  touchscreen: 'bg-cyan-100 text-cyan-700',
  desktop:     'bg-muted/50 text-muted-foreground',
  tablet:      'bg-violet-100 text-violet-700',
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
      { id: 'printers', label: 'เครื่องพิมพ์' },
      { id: 'system',   label: 'ข้อมูลระบบ' },
    ],
  },
];

interface StaffPageProps {
  initialData: StaffMember[];
  initialMenuLabels?: Record<string, string>;
}

type Modal =
  | { type: 'add' }
  | { type: 'edit'; member: StaffMember }
  | { type: 'resetPwd'; member: StaffMember }
  | { type: 'delete'; member: StaffMember };

export function StaffPage({ initialData, initialMenuLabels = {} }: StaffPageProps) {
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
    <div className="page-shell">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">บัญชีผู้ใช้</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{staff.length} บัญชี</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: 'add' })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <span className="text-base leading-none">+</span> เพิ่ม User
        </button>
      </div>

      <div className="section-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ชื่อ</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">UI</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">เมนู</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">สมัครเมื่อ</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">สถานะ</th>
              <th className="px-4 py-3 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.map((member) => (
              <tr key={member.id} className={`hover:bg-muted/30 transition-colors ${!member.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-semibold text-foreground">{member.name}</td>
                <td className="px-4 py-3 text-muted-foreground text-[13px]">{member.email}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ROLE_COLOR[member.role] ?? 'bg-muted text-muted-foreground ring-border'}`}>
                    {ROLE_LABEL[member.role] ?? member.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {member.uiLayout ? (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${UI_LAYOUT_COLOR[member.uiLayout]}`}>
                      {UI_LAYOUT_LABEL[member.uiLayout]}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">ค่าเดิม</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {member.allowedModules?.length ? (
                    <span className="text-[13px] text-foreground font-medium">{member.allowedModules.length} เมนู</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">ค่าเดิม</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(member.createdAt), 'd MMM yy', { locale: th })}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    disabled={isTogglingActive && toggleActiveVar === member.id}
                    onClick={() => toggleActive(member.id)}
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset disabled:opacity-50 transition-colors ${
                      member.isActive
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900'
                        : 'bg-muted text-muted-foreground ring-border hover:bg-muted/80'
                    }`}
                  >
                    {isTogglingActive && toggleActiveVar === member.id ? '…' : member.isActive ? 'เปิด' : 'ปิด'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'edit', member })}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'resetPwd', member })}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      รีเซ็ตรหัสผ่าน
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'delete', member })}
                      className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors"
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
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 backdrop-blur-[2px] px-4 py-8 overflow-y-auto"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="my-auto">
            {modal.type === 'add' && (
              <StaffForm
                initialMenuLabels={initialMenuLabels}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {modal.type === 'edit' && (
              <StaffForm
                initial={modal.member}
                initialMenuLabels={initialMenuLabels}
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
                  <h2 className="text-[13px] font-semibold text-foreground">ยืนยันการลบ</h2>
                  <button
                    type="button"
                    aria-label="ปิด"
                    onClick={() => setModal(null)}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-sm"
                  >
                    ✕
                  </button>
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
                    className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
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
const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground transition-colors';
const BTN   = 'w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors';

/* ─── UI Layout picker ──────────────────────────────────────── */

function UiLayoutPicker({
  value,
  onChange,
}: {
  value: 'touchscreen' | 'desktop' | 'tablet' | '';
  onChange: (v: 'touchscreen' | 'desktop' | 'tablet') => void;
}) {
  const options: {
    key: 'touchscreen' | 'desktop' | 'tablet';
    label: string;
    desc: string;
    preview: React.ReactNode;
  }[] = [
    {
      key: 'touchscreen',
      label: 'Touchscreen',
      desc: 'Bottom tab bar\nเหมาะ POS / จอครัว',
      preview: (
        <div className="rounded-lg bg-muted border border-border overflow-hidden h-[60px] flex flex-col">
          <div className="flex-1 bg-muted/60" />
          <div className="h-[18px] border-t border-border flex items-center justify-around px-1">
            {['▪','▪','▪','▪'].map((d, i) => (
              <span key={i} className="text-[6px] text-muted-foreground">{d}</span>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'desktop',
      label: 'Desktop',
      desc: 'Sidebar เต็ม\nเหมาะ PC / owner',
      preview: (
        <div className="rounded-lg bg-muted border border-border overflow-hidden h-[60px] flex flex-row">
          <div className="w-[32px] border-r border-border bg-slate-700/80 flex flex-col gap-1.5 py-1.5 px-1.5">
            {[1,2,3,4].map((i) => (
              <div key={i} className="h-1.5 rounded-sm bg-white/30" />
            ))}
          </div>
          <div className="flex-1 bg-muted/60" />
        </div>
      ),
    },
    {
      key: 'tablet',
      label: 'Tablet',
      desc: 'Sidebar + tap ใหญ่\nเหมาะ tablet',
      preview: (
        <div className="rounded-lg bg-muted border border-border overflow-hidden h-[60px] flex flex-row">
          <div className="w-[22px] border-r border-border bg-violet-700/80 flex flex-col gap-1.5 py-1.5 px-1">
            {[1,2,3].map((i) => (
              <div key={i} className="h-1.5 rounded-sm bg-white/30" />
            ))}
          </div>
          <div className="flex-1 bg-muted/60" />
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {options.map(({ key, label, desc, preview }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all duration-150 ${
            value === key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
          }`}
        >
          {preview}
          <div>
            <p className="text-xs font-semibold text-foreground">{label}</p>
            <p className="text-[10px] text-muted-foreground leading-snug whitespace-pre-line">{desc}</p>
          </div>
          {value === key && (
            <span className="self-start rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">เลือก</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ─── Module map (flat) ─────────────────────────────────────── */

const ALL_MODULE_MAP = new Map<string, { id: string; label: string }>(
  MODULE_GROUPS.flatMap((g) => g.modules.map((m) => [m.id, m])),
);

/* ─── Sortable row for ordering ─────────────────────────────── */

type NavLayoutSection = { heading: string; modules: string[] };

function buildDefaultNavLayout(modules: string[]): NavLayoutSection[] {
  return MODULE_GROUPS
    .map((group) => ({
      heading: group.label,
      modules: modules.filter((m) => group.modules.some((gm) => gm.id === m)),
    }))
    .filter((s) => s.modules.length > 0);
}

function SortableModuleRowWithMove({
  id,
  displayLabel,
  sections,
  currentSection,
  onMove,
}: {
  id: string;
  displayLabel: string;
  sections: string[];
  currentSection: string;
  onMove: (targetSection: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const otherSections = sections.filter((s) => s !== currentSection);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 border-b border-border last:border-0 bg-card px-3 py-2 ${isDragging ? 'opacity-60 shadow-sm z-10' : ''}`}
    >
      <button
        type="button"
        aria-label="ลากย้าย"
        {...attributes}
        {...listeners}
        className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none transition-colors"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="flex-1 min-w-0 text-xs text-foreground truncate">{displayLabel}</span>
      {otherSections.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onMove(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[10px] text-muted-foreground bg-card border border-border rounded px-1 py-0.5 cursor-pointer hover:bg-muted/50"
        >
          <option value="">ย้าย…</option>
          {otherSections.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ─── Sortable section container (render-prop for drag handle) ── */

function SortableSectionContainer({
  id,
  children,
}: {
  id: string;
  children: (dragProps: Record<string, unknown>) => React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-50 relative z-10' : ''}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

/* ─── Module checkboxes ─────────────────────────────────────── */

const ALL_MODULES_FLAT = MODULE_GROUPS.flatMap((g) => g.modules);

function ModulePicker({
  value,
  onChange,
  navLayout,
  onNavLayoutChange,
  menuLabels,
  onMenuLabelsChange,
  error,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  navLayout: NavLayoutSection[];
  onNavLayoutChange: (nl: NavLayoutSection[]) => void;
  menuLabels: Record<string, string>;
  onMenuLabelsChange: (l: Record<string, string>) => void;
  error?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editingHeading, setEditingHeading] = useState('');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  const allSelected = ALL_MODULES_FLAT.every((m) => value.includes(m.id));

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((m) => m !== id));
      onNavLayoutChange(navLayout.map((s) => ({ ...s, modules: s.modules.filter((m) => m !== id) })));
    } else {
      onChange([...value, id]);
      const defaultGroup = MODULE_GROUPS.find((g) => g.modules.some((m) => m.id === id));
      const defaultHeading = defaultGroup?.label ?? navLayout[0]?.heading ?? '';
      const sIdx = navLayout.findIndex((s) => s.heading === defaultHeading);
      if (sIdx >= 0) {
        onNavLayoutChange(navLayout.map((s, i) => i === sIdx ? { ...s, modules: [...s.modules, id] } : s));
      } else if (navLayout.length > 0) {
        onNavLayoutChange(navLayout.map((s, i) => i === 0 ? { ...s, modules: [...s.modules, id] } : s));
      } else {
        onNavLayoutChange([{ heading: defaultHeading || 'หน้าบ้าน', modules: [id] }]);
      }
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
      onNavLayoutChange(navLayout.map((s) => ({ ...s, modules: [] })));
    } else {
      const allIds = ALL_MODULES_FLAT.map((m) => m.id);
      onChange(allIds);
      onNavLayoutChange(buildDefaultNavLayout(allIds));
    }
  };

  const startLabelEdit = (id: string) => {
    setLabelDraft(menuLabels[id] || ALL_MODULE_MAP.get(id)?.label || '');
    setEditingLabelId(id);
  };

  const saveLabelEdit = (id: string) => {
    const trimmed = labelDraft.trim();
    const defaultLabel = ALL_MODULE_MAP.get(id)?.label || '';
    const updated = { ...menuLabels };
    if (!trimmed || trimmed === defaultLabel) {
      delete updated[id];
    } else {
      updated[id] = trimmed;
    }
    onMenuLabelsChange(updated);
    setEditingLabelId(null);
  };

  const handleSectionDragEnd = (event: DragEndEvent, sectionIdx: number) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const updated = navLayout.map((s) => ({ ...s, modules: [...s.modules] }));
    const mods = updated[sectionIdx].modules;
    const oldIdx = mods.indexOf(active.id as string);
    const newIdx = mods.indexOf(over.id as string);
    if (oldIdx < 0 || newIdx < 0) return;
    updated[sectionIdx].modules = arrayMove(mods, oldIdx, newIdx);
    onNavLayoutChange(updated);
    const newOrder = updated.flatMap((s) => s.modules);
    onChange([...value].sort((a, b) => {
      const ia = newOrder.indexOf(a);
      const ib = newOrder.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    }));
  };

  const saveHeading = (sectionIdx: number) => {
    const trimmed = editingHeading.trim();
    if (trimmed) {
      onNavLayoutChange(navLayout.map((s, i) => i === sectionIdx ? { ...s, heading: trimmed } : s));
    }
    setEditingSection(null);
  };

  const deleteSection = (sectionIdx: number) => {
    const updated = navLayout.map((s) => ({ ...s, modules: [...s.modules] }));
    const [removed] = updated.splice(sectionIdx, 1);
    if (updated.length > 0 && removed.modules.length > 0) {
      updated[0].modules = [...updated[0].modules, ...removed.modules];
    }
    onNavLayoutChange(updated);
  };

  const addSection = () => {
    const updated = [...navLayout, { heading: 'หมวดใหม่', modules: [] }];
    onNavLayoutChange(updated);
    setEditingSection(updated.length - 1);
    setEditingHeading('หมวดใหม่');
  };

  const moveModule = (moduleId: string, fromSectionIdx: number, toHeading: string) => {
    const updated = navLayout.map((s) => ({ ...s, modules: [...s.modules] }));
    updated[fromSectionIdx].modules = updated[fromSectionIdx].modules.filter((m) => m !== moduleId);
    const toIdx = updated.findIndex((s) => s.heading === toHeading);
    if (toIdx >= 0) updated[toIdx].modules.push(moduleId);
    onNavLayoutChange(updated);
  };

  const sectionNames = navLayout.map((s) => s.heading);

  return (
    <div className="space-y-3">
      {/* Flat module list with inline label editing */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between bg-muted/50 px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-foreground">เลือกเมนู</span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors"
          >
            {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
          </button>
        </div>
        <div className="divide-y divide-border">
          {ALL_MODULES_FLAT.map(({ id, label: defaultLabel }) => {
            const displayLabel = menuLabels[id] || defaultLabel;
            const hasCustom = !!menuLabels[id];
            const isEditing = editingLabelId === id;
            return (
              <div key={id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30">
                <input
                  type="checkbox"
                  id={`mod-${id}`}
                  checked={value.includes(id)}
                  onChange={() => toggle(id)}
                  className="size-3.5 shrink-0 rounded accent-primary cursor-pointer"
                />
                {isEditing ? (
                  <input
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onBlur={() => saveLabelEdit(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveLabelEdit(id); }
                      if (e.key === 'Escape') setEditingLabelId(null);
                    }}
                    autoFocus
                    className="flex-1 min-w-0 bg-transparent border-b border-primary text-xs text-foreground outline-none py-0"
                  />
                ) : (
                  <label
                    htmlFor={`mod-${id}`}
                    className="flex-1 min-w-0 text-xs text-foreground cursor-pointer select-none truncate"
                  >
                    {displayLabel}
                  </label>
                )}
                {!isEditing && (
                  <button
                    type="button"
                    aria-label={`แก้ไขชื่อเมนู ${displayLabel}`}
                    onClick={() => startLabelEdit(id)}
                    className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
                {hasCustom && !isEditing && (
                  <button
                    type="button"
                    aria-label="รีเซ็ตชื่อ"
                    onClick={() => { const u = { ...menuLabels }; delete u[id]; onMenuLabelsChange(u); }}
                    className="shrink-0 text-muted-foreground/50 hover:text-red-400 transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Nav layout editor */}
      {value.length >= 2 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-foreground">จัดลำดับแสดงในแถบนำทาง</span>
            <span className="text-[10px] text-muted-foreground">ลาก / เปลี่ยนชื่อ / ย้ายหมวด</span>
          </div>

          {/* Outer DndContext handles section reordering */}
          <DndContext
            id="nav-sections"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              const sectionIds = navLayout.map((_, i) => `scd-${i}`);
              const oldIdx = sectionIds.indexOf(active.id as string);
              const newIdx = sectionIds.indexOf(over.id as string);
              if (oldIdx < 0 || newIdx < 0) return;
              onNavLayoutChange(arrayMove(navLayout, oldIdx, newIdx));
            }}
          >
            <SortableContext
              items={navLayout.map((_, i) => `scd-${i}`)}
              strategy={verticalListSortingStrategy}
            >
              {navLayout.map((section, sectionIdx) => {
                const modulesInSection = section.modules.filter((m) => value.includes(m));
                return (
                  <SortableSectionContainer key={`${section.heading}-${sectionIdx}`} id={`scd-${sectionIdx}`}>
                    {(dragHandleProps) => (
                      <div className="border-b border-border last:border-0">
                        <div className="bg-muted/30 px-3 py-1.5 border-b border-border flex items-center gap-1">
                          {/* Section drag handle */}
                          <button
                            type="button"
                            aria-label="ลากย้ายหมวด"
                            {...(dragHandleProps as React.HTMLAttributes<HTMLButtonElement>)}
                            className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
                          >
                            <GripVertical className="size-3.5" />
                          </button>

                          {editingSection === sectionIdx ? (
                            <>
                              <input
                                value={editingHeading}
                                onChange={(e) => setEditingHeading(e.target.value)}
                                onBlur={() => saveHeading(sectionIdx)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); saveHeading(sectionIdx); }
                                  if (e.key === 'Escape') setEditingSection(null);
                                }}
                                autoFocus
                                className="flex-1 bg-transparent border-b border-primary text-[10px] font-semibold text-foreground uppercase tracking-wide outline-none py-0"
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); saveHeading(sectionIdx); }}
                                className="shrink-0 text-[10px] text-primary hover:underline"
                              >
                                บันทึก
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                {section.heading}
                              </span>
                              <button
                                type="button"
                                aria-label={`เปลี่ยนชื่อหมวด ${section.heading}`}
                                onClick={() => { setEditingSection(sectionIdx); setEditingHeading(section.heading); }}
                                className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
                              >
                                <Pencil className="size-3" />
                              </button>
                            </>
                          )}
                          {navLayout.length > 1 && (
                            <button
                              type="button"
                              aria-label={`ลบหมวด ${section.heading}`}
                              onClick={() => deleteSection(sectionIdx)}
                              className="shrink-0 text-muted-foreground/50 hover:text-red-400 transition-colors"
                            >
                              <X className="size-3" />
                            </button>
                          )}
                        </div>

                        {/* Inner DndContext handles module reordering within this section */}
                        <DndContext
                          id={`nav-dnd-${sectionIdx}`}
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(e) => handleSectionDragEnd(e, sectionIdx)}
                        >
                          <SortableContext items={modulesInSection} strategy={verticalListSortingStrategy}>
                            {modulesInSection.map((id) => {
                              const info = ALL_MODULE_MAP.get(id);
                              if (!info) return null;
                              return (
                                <SortableModuleRowWithMove
                                  key={id}
                                  id={id}
                                  displayLabel={menuLabels[id] || info.label}
                                  sections={sectionNames}
                                  currentSection={section.heading}
                                  onMove={(targetHeading) => moveModule(id, sectionIdx, targetHeading)}
                                />
                              );
                            })}
                          </SortableContext>
                        </DndContext>

                        {modulesInSection.length === 0 && (
                          <p className="px-3 py-2 text-[10px] text-muted-foreground/50 italic">
                            ว่าง — ใช้ปุ่ม &ldquo;ย้าย…&rdquo; บนแต่ละเมนูเพื่อย้ายมาที่นี่
                          </p>
                        )}
                      </div>
                    )}
                  </SortableSectionContainer>
                );
              })}
            </SortableContext>
          </DndContext>

          <div className="px-3 py-2">
            <button
              type="button"
              onClick={addSection}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="size-3" />
              เพิ่มหมวด
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ─── Staff Form ────────────────────────────────────────────── */

function StaffForm({
  initial,
  initialMenuLabels = {},
  onClose,
  onSaved,
}: {
  initial?: StaffMember;
  initialMenuLabels?: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const schema = initial ? updateStaffSchema : createStaffSchema;

  const defaultModules = initial?.allowedModules ?? [];

  const [navLayout, setNavLayout] = useState<NavLayoutSection[]>(() =>
    initial?.navLayout?.sections ?? buildDefaultNavLayout(defaultModules),
  );
  const [menuLabels, setMenuLabels] = useState<Record<string, string>>(() => initialMenuLabels);

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
    const cleanSections = navLayout.filter((s) => s.modules.length > 0);
    const payload = {
      ...data,
      navLayout: cleanSections.length > 0 ? { sections: cleanSections } : null,
    };
    const [result] = await Promise.all([
      initial ? updateStaff(payload) : createStaff(payload),
      updateMenuLabels(menuLabels),
    ]);
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
        <h2 className="text-[13px] font-semibold text-foreground">{initial ? 'แก้ไข User' : 'เพิ่ม User'}</h2>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-sm"
        >
          ✕
        </button>
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
                  value={(field.value ?? '') as 'touchscreen' | 'desktop' | 'tablet' | ''}
                  onChange={(v) => field.onChange(v)}
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
                  navLayout={navLayout}
                  onNavLayoutChange={setNavLayout}
                  menuLabels={menuLabels}
                  onMenuLabelsChange={setMenuLabels}
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
