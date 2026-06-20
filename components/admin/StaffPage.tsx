'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  GripVertical, Pencil, Plus, X,
  MoreHorizontal, KeyRound, Trash2, Search, Users,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BadgeVariant } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/shared/ConfirmDialog';

/* ─── Label maps ─────────────────────────────────────────────── */

const ROLE_LABEL: Record<string, string> = {
  owner:   'เจ้าของ',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

const ROLE_VARIANT: Record<string, BadgeVariant> = {
  owner:   'purple',
  manager: 'info',
  cashier: 'neutral',
  kitchen: 'orange',
};

const UI_LAYOUT_LABEL: Record<string, string> = {
  touchscreen: 'Touchscreen',
  desktop:     'Desktop',
  tablet:      'Tablet',
};

const UI_LAYOUT_VARIANT: Record<string, BadgeVariant> = {
  touchscreen: 'cyan',
  desktop:     'neutral',
  tablet:      'info',
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

/* ─── Types ──────────────────────────────────────────────────── */

interface StaffPageProps {
  initialData: StaffMember[];
  initialMenuLabels?: Record<string, string>;
}

type SheetState =
  | { type: 'add' }
  | { type: 'edit'; member: StaffMember }
  | { type: 'resetPwd'; member: StaffMember }
  | null;

/* ─── Main page component ───────────────────────────────────── */

export function StaffPage({ initialData, initialMenuLabels = {} }: StaffPageProps) {
  const [sheet, setSheet] = useState<SheetState>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const { openConfirm, dialog: confirmDialog } = useConfirm();
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

  const { mutate: deleteMember } = useMutation({
    mutationFn: (id: string) => deleteStaff(id),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบ User แล้ว');
      invalidate();
    },
  });

  /* ─── Filter ─── */
  const hasFilter = search || roleFilter !== 'all' || statusFilter !== 'all';
  const filteredStaff = staff.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch = !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || m.role === roleFilter;
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' ? m.isActive : !m.isActive);
    return matchSearch && matchRole && matchStatus;
  });

  /* ─── DataTable columns ─── */
  const columns = [
    {
      key: 'user',
      header: 'ผู้ใช้',
      render: (m: StaffMember) => (
        <div>
          <p className="font-medium text-foreground">{m.name}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{m.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (m: StaffMember) => (
        <StatusBadge
          label={ROLE_LABEL[m.role] ?? m.role}
          variant={ROLE_VARIANT[m.role] ?? 'neutral'}
        />
      ),
    },
    {
      key: 'ui',
      header: 'UI Layout',
      render: (m: StaffMember) =>
        m.uiLayout ? (
          <StatusBadge
            label={UI_LAYOUT_LABEL[m.uiLayout] ?? m.uiLayout}
            variant={UI_LAYOUT_VARIANT[m.uiLayout] ?? 'neutral'}
          />
        ) : (
          <span className="text-[12px] text-muted-foreground/60">ค่าเดิม</span>
        ),
    },
    {
      key: 'modules',
      header: 'เมนู',
      render: (m: StaffMember) =>
        m.allowedModules?.length ? (
          <span className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-inset ring-border">
            {m.allowedModules.length} เมนู
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/60">ค่าเดิม</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'สมัครเมื่อ',
      render: (m: StaffMember) => (
        <span className="text-[12px] text-muted-foreground whitespace-nowrap">
          {format(new Date(m.createdAt), 'd MMM yy', { locale: th })}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      align: 'center' as const,
      render: (m: StaffMember) => (
        <button
          type="button"
          disabled={isTogglingActive && toggleActiveVar === m.id}
          onClick={() => toggleActive(m.id)}
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-opacity disabled:opacity-50 hover:opacity-75',
            m.isActive
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] ring-[var(--status-success-border)]'
              : 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)] ring-[var(--status-neutral-border)]',
          )}
        >
          {isTogglingActive && toggleActiveVar === m.id
            ? '…'
            : m.isActive
              ? 'เปิด'
              : 'ปิด'}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '52px',
      render: (m: StaffMember) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            aria-label="เมนูเพิ่มเติม"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem onClick={() => setSheet({ type: 'edit', member: m })}>
              <Pencil className="size-3.5" />
              แก้ไข
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSheet({ type: 'resetPwd', member: m })}>
              <KeyRound className="size-3.5" />
              รีเซ็ตรหัสผ่าน
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                openConfirm(
                  `ลบ "${m.name}" ออกจากระบบ? การกระทำนี้ไม่สามารถยกเลิกได้`,
                  () => deleteMember(m.id),
                  { confirmLabel: 'ลบ' },
                )
              }
            >
              <Trash2 className="size-3.5" />
              ลบ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <AppShell>
        <PageHeader
          title="บัญชีผู้ใช้"
          subtitle={`${staff.length} บัญชีในระบบ`}
          actions={
            <Button type="button" onClick={() => setSheet({ type: 'add' })}>
              <Plus className="size-4" />
              เพิ่ม User
            </Button>
          }
        />

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="ค้นหาชื่อหรือ Email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(INPUT, 'pl-8')}
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={cn(INPUT, 'w-auto')}
          >
            <option value="all">Role ทั้งหมด</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={cn(INPUT, 'w-auto')}
          >
            <option value="all">สถานะทั้งหมด</option>
            <option value="active">เปิดใช้งาน</option>
            <option value="inactive">ปิดใช้งาน</option>
          </select>
          {hasFilter && (
            <button
              type="button"
              onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); }}
              className="text-xs text-muted-foreground underline transition-colors hover:text-foreground"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={filteredStaff}
          keyFn={(m) => m.id}
          rowClassName={(m) => (!m.isActive ? 'opacity-60' : '')}
          emptyState={
            <EmptyState
              icon={<Users className="size-5" />}
              title={hasFilter ? 'ไม่พบผลลัพธ์' : 'ยังไม่มีบัญชีผู้ใช้'}
              description={
                hasFilter
                  ? 'ลองปรับตัวกรองใหม่อีกครั้ง'
                  : 'กดปุ่ม "เพิ่ม User" เพื่อสร้างบัญชีแรก'
              }
            />
          }
        />
      </AppShell>

      {/* Form sheet — add / edit / reset password */}
      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => { if (!open) setSheet(null); }}
      >
        <SheetContent
          side="right"
          className="sm:max-w-[580px] gap-0 p-0"
          showCloseButton={false}
        >
          {(sheet?.type === 'add' || sheet?.type === 'edit') && (
            <StaffForm
              key={sheet.type === 'edit' ? sheet.member.id : 'new'}
              initial={sheet.type === 'edit' ? sheet.member : undefined}
              initialMenuLabels={initialMenuLabels}
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
          {sheet?.type === 'resetPwd' && (
            <ResetPasswordForm
              key={sheet.member.id}
              member={sheet.member}
              onClose={() => setSheet(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {confirmDialog}
    </>
  );
}

/* ─── Shared form styles ─────────────────────────────────────── */

const ROLES = Object.entries(ROLE_LABEL) as [string, string][];

const INPUT =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors';

const FIELD_INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground transition-colors';

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
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <h2 className="text-sm font-semibold text-foreground">
          {initial ? 'แก้ไข User' : 'เพิ่ม User'}
        </h2>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Scrollable form content */}
      <div className="flex-1 space-y-5 overflow-y-auto p-5">

        {/* Basic info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1.5 block text-xs font-medium text-foreground">ชื่อ</label>
            <input {...register('name')} className={FIELD_INPUT} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1.5 block text-xs font-medium text-foreground">Role</label>
            <select {...register('role')} className={FIELD_INPUT}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-foreground">Username (Email)</label>
            <input {...register('email')} type="email" className={FIELD_INPUT} placeholder="user@example.com" />
            {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
          </div>
          {!initial && (
            <div className="col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-foreground">รหัสผ่าน</label>
              <input
                {...register('password' as keyof (CreateStaffInput | UpdateStaffInput))}
                type="password"
                className={FIELD_INPUT}
              />
              {(errors as { password?: { message?: string } }).password && (
                <p className="mt-1 text-xs text-destructive">
                  {(errors as { password?: { message?: string } }).password?.message}
                </p>
              )}
            </div>
          )}
        </div>

        {/* UI Layout selector */}
        <div>
          <label className="mb-2 block text-xs font-medium text-foreground">รูปแบบ UI</label>
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
            <p className="mt-1 text-xs text-destructive">{errors.uiLayout.message}</p>
          )}
        </div>

        {/* Module picker */}
        <div>
          <label className="mb-2 block text-xs font-medium text-foreground">เมนูที่เข้าถึงได้</label>
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
                error={
                  errors.allowedModules?.message ??
                  (errors.allowedModules as { root?: { message?: string } })?.root?.message
                }
              />
            )}
          />
        </div>

      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </form>
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">รีเซ็ตรหัสผ่าน</h2>
          <p className="text-[12px] text-muted-foreground">{member.name}</p>
        </div>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col p-5">
        <div className="flex-1 space-y-4">
          <div className="rounded-lg border border-border bg-[var(--surface-2)] p-3 text-[13px] text-muted-foreground">
            <span className="font-medium text-foreground">{member.name}</span>
            <span className="mx-1.5 text-border">·</span>
            {member.email}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">รหัสผ่านใหม่</label>
            <input
              {...register('password')}
              type="password"
              className={FIELD_INPUT}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>
        </div>
        <input type="hidden" {...register('id')} />

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังรีเซ็ต…' : 'ยืนยันรีเซ็ตรหัสผ่าน'}
          </button>
        </div>
      </form>
    </div>
  );
}
