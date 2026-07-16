'use client';

import { Fragment, useState, useEffect, useTransition } from 'react';
import { format, eachDayOfInterval, parseISO, differenceInCalendarDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Time24Select } from '@/components/ui/time-24-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus,
  Eye,
  CalendarDays,
  CalendarRange,
  ChevronUp,
  ChevronDown,
  Loader2,
  Download,
  Trash2,
} from 'lucide-react';
import {
  createScheduleCycle,
  setScheduleEntry,
  getScheduleGrid,
  publishSchedule,
} from '@/lib/actions/hr';
import { setEmployeeOrder, deleteScheduleCycle } from '@/lib/actions/hr-options';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { deptLabelOf, deptRank } from '@/lib/hr/departments';
import type { ScheduleCycle, ScheduleEntry, Employee, HrSettings } from '@/lib/db/schema';
import { formatThaiDate, formatThaiShortDateRange } from '@/lib/date-time';
import { cn } from '@/lib/utils';

type EntryMap = Record<string, ScheduleEntry>;
type GridData = { cycle: ScheduleCycle; employees: Employee[]; entryMap: EntryMap } | null;

interface Props {
  initialCycles: ScheduleCycle[];
  settings: HrSettings;
  initialEmployees: Employee[];
}

const SHIFT_COLORS = {
  morning: 'bg-sky-100 text-sky-800 border-sky-200',
  afternoon: 'bg-violet-100 text-violet-800 border-violet-200',
  custom: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  day_off: 'bg-destructive/10 text-destructive border-destructive/20 [&_span]:text-destructive [&_span]:font-medium',
  leave: 'bg-orange-100 text-orange-700 border-orange-200',
};

const SHIFT_TEMPLATES = {
  morning: { startTime: '09:00', endTime: '18:00' },
  afternoon: { startTime: '14:30', endTime: '23:30' },
} as const;

function entryKey(employeeId: string, date: string) {
  return `${employeeId}|${date}`;
}

type DeptGroup = { key: string; label: string; list: Employee[] };

/** Group employees by department, ordered by manual sort_order within groups. */
function buildGroups(emps: Employee[]): DeptGroup[] {
  const sorted = [...emps].sort(
    (a, b) => (a.sortOrder - b.sortOrder) || a.firstName.localeCompare(b.firstName, 'th'),
  );
  const map = new Map<string, Employee[]>();
  for (const e of sorted) {
    const k = e.department ?? '';
    const arr = map.get(k) ?? [];
    arr.push(e);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, label: deptLabelOf(key || null), list }))
    .sort(
      (a, b) =>
        deptRank(a.key || null) - deptRank(b.key || null) ||
        a.label.localeCompare(b.label, 'th'),
    );
}

/* ─── Full-schedule image renderer (canvas, no external deps) ────────────── */

const IMG_COLORS = {
  morning:   { bg: '#e0f2fe', fg: '#075985', sub: '#0369a1' },
  afternoon: { bg: '#ede9fe', fg: '#5b21b6', sub: '#6d28d9' },
  custom:    { bg: '#d1fae5', fg: '#065f46', sub: '#047857' },
  day_off:   { bg: '#fee2e2', fg: '#dc2626', sub: '#dc2626' },
  leave:     { bg: '#ffedd5', fg: '#c2410c', sub: '#c2410c' },
} as const;

/**
 * Draws the ENTIRE schedule (every department, employee, and day) onto one
 * high-resolution PNG — nothing is cropped, so the downloaded image is a
 * complete standalone copy of the schedule.
 */
async function renderScheduleImage(opts: {
  rangeLabel: string;
  days: Date[];
  groups: DeptGroup[];
  entryMap: EntryMap;
}): Promise<string> {
  const { rangeLabel, days, groups, entryMap } = opts;
  // Make sure the Thai webfont is available to the canvas before measuring/drawing
  await document.fonts.ready;
  const font = "'IBM Plex Sans Thai', 'Noto Sans Thai', sans-serif";

  const scale = 2; // 2x for crisp text when zoomed/printed
  const pad = 28;
  const titleH = 62;
  const legendH = 34;
  const headH = 52;
  const groupH = 30;
  const rowH = 54;
  const nameW = 210;
  const cellW = 78;

  const rowsCount = groups.reduce((sum, g) => sum + g.list.length, 0);
  const gridW = nameW + days.length * cellW;
  const gridH = headH + groups.length * groupH + rowsCount * rowH;
  const width = pad * 2 + gridW;
  const height = pad + titleH + legendH + gridH + pad + 18;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas not supported');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Title + range
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 22px ${font}`;
  ctx.fillText('ตารางงาน', pad, pad + 14);
  ctx.fillStyle = '#64748b';
  ctx.font = `400 14px ${font}`;
  ctx.fillText(rangeLabel, pad, pad + 42);

  // Legend
  const legendY = pad + titleH + legendH / 2 - 4;
  let lx = pad;
  const legendItems: { label: string; c: { bg: string; fg: string } }[] = [
    { label: 'เช้า', c: IMG_COLORS.morning },
    { label: 'บ่าย', c: IMG_COLORS.afternoon },
    { label: 'กำหนดเอง', c: IMG_COLORS.custom },
    { label: 'หยุด', c: IMG_COLORS.day_off },
    { label: 'ลา', c: IMG_COLORS.leave },
  ];
  ctx.font = `400 12px ${font}`;
  for (const item of legendItems) {
    ctx.fillStyle = item.c.bg;
    ctx.fillRect(lx, legendY - 6, 14, 12);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(lx + 0.5, legendY - 5.5, 13, 11);
    ctx.fillStyle = '#475569';
    ctx.fillText(item.label, lx + 20, legendY);
    lx += 20 + ctx.measureText(item.label).width + 22;
  }

  const gridX = pad;
  const gridY = pad + titleH + legendH;
  const hLines: number[] = [gridY];

  // Header row
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(gridX, gridY, gridW, headH);
  ctx.fillStyle = '#0f172a';
  ctx.font = `600 13px ${font}`;
  ctx.textAlign = 'left';
  ctx.fillText('พนักงาน', gridX + 12, gridY + headH / 2);
  ctx.textAlign = 'center';
  days.forEach((day, i) => {
    const x = gridX + nameW + i * cellW;
    const dow = day.getDay();
    if (dow === 0 || dow === 6) {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(x, gridY, cellW, headH);
    }
    ctx.fillStyle = '#0f172a';
    ctx.font = `600 14px ${font}`;
    ctx.fillText(format(day, 'd'), x + cellW / 2, gridY + 18);
    ctx.fillStyle = '#64748b';
    ctx.font = `400 11px ${font}`;
    ctx.fillText(format(day, 'EEE', { locale: th }), x + cellW / 2, gridY + 37);
  });
  hLines.push(gridY + headH);

  // Rows
  let y = gridY + headH;
  for (const group of groups) {
    ctx.fillStyle = '#eef2f7';
    ctx.fillRect(gridX, y, gridW, groupH);
    ctx.fillStyle = '#334155';
    ctx.font = `600 12px ${font}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${group.label} · ${group.list.length} คน`, gridX + 12, y + groupH / 2);
    y += groupH;
    hLines.push(y);

    for (const emp of group.list) {
      ctx.fillStyle = '#0f172a';
      ctx.font = `500 13px ${font}`;
      ctx.textAlign = 'left';
      const name = `${emp.firstName} ${emp.lastName}${emp.type === 'part_time' ? ' (PT)' : ''}`;
      ctx.fillText(name, gridX + 12, y + rowH / 2, nameW - 24);

      days.forEach((day, i) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const entry = entryMap[entryKey(emp.id, dateStr)];
        const x = gridX + nameW + i * cellW;

        let c: { bg: string; fg: string; sub: string };
        let line1 = '';
        let line2 = '';
        if (!entry || entry.status === 'day_off') {
          c = IMG_COLORS.day_off; line1 = 'หยุด';
        } else if (entry.status === 'leave') {
          c = IMG_COLORS.leave; line1 = 'ลา';
        } else if (entry.shiftType === 'custom') {
          c = IMG_COLORS.custom; line1 = entry.startTime ?? 'กำหนด'; line2 = entry.endTime ?? '';
        } else if (entry.shiftType === 'afternoon') {
          c = IMG_COLORS.afternoon; line1 = 'บ่าย'; line2 = entry.startTime ?? '';
        } else {
          c = IMG_COLORS.morning; line1 = 'เช้า'; line2 = entry.startTime ?? '';
        }

        ctx.fillStyle = c.bg;
        ctx.fillRect(x + 3, y + 4, cellW - 6, rowH - 8);
        ctx.textAlign = 'center';
        if (line2) {
          ctx.fillStyle = c.fg;
          ctx.font = `600 13px ${font}`;
          ctx.fillText(line1, x + cellW / 2, y + rowH / 2 - 9);
          ctx.fillStyle = c.sub;
          ctx.font = `400 11px ${font}`;
          ctx.fillText(line2, x + cellW / 2, y + rowH / 2 + 10);
        } else {
          ctx.fillStyle = c.fg;
          ctx.font = `600 13px ${font}`;
          ctx.fillText(line1, x + cellW / 2, y + rowH / 2);
        }
      });

      y += rowH;
      hLines.push(y);
    }
  }

  // Grid lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  for (const ly of hLines) {
    ctx.beginPath();
    ctx.moveTo(gridX, ly + 0.5);
    ctx.lineTo(gridX + gridW, ly + 0.5);
    ctx.stroke();
  }
  for (let i = 0; i <= days.length + 1; i++) {
    const vx = i === 0 ? gridX : gridX + nameW + (i - 1) * cellW;
    ctx.beginPath();
    ctx.moveTo(vx + 0.5, gridY);
    ctx.lineTo(vx + 0.5, y);
    ctx.stroke();
  }
  // Right outer border
  ctx.beginPath();
  ctx.moveTo(gridX + gridW - 0.5, gridY);
  ctx.lineTo(gridX + gridW - 0.5, y);
  ctx.stroke();

  // Footer stamp
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = `400 11px ${font}`;
  ctx.fillText(`สร้างเมื่อ ${formatThaiDate(new Date())}`, gridX + gridW, y + 18);

  return canvas.toDataURL('image/png');
}

function CellDisplay({ entry }: { entry?: ScheduleEntry }) {
  if (!entry || entry.status === 'day_off') {
    return <span className="text-destructive text-xs font-medium">หยุด</span>;
  }
  if (entry.status === 'leave') {
    return <span className="text-orange-600 text-xs font-medium">ลา</span>;
  }
  if (entry.shiftType === 'custom') {
    return (
      <div className="text-center leading-tight">
        {entry.startTime && <div className="text-xs font-semibold">{entry.startTime}</div>}
        {entry.endTime && <div className="text-[10px] text-muted-foreground">{entry.endTime}</div>}
      </div>
    );
  }
  const shiftLabel = entry.shiftType === 'morning' ? 'เช้า' : 'บ่าย';
  return (
    <div className="text-center leading-tight">
      <div className="text-xs font-semibold">{shiftLabel}</div>
      {entry.startTime && <div className="text-[10px] text-muted-foreground">{entry.startTime}</div>}
    </div>
  );
}

export function SchedulePage({ initialCycles }: Props) {
  const [cycles, setCycles] = useState(initialCycles);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(cycles[0]?.id ?? null);
  const [grid, setGrid] = useState<GridData>(null);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  // Download-image preview
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // New cycle form
  const [cycleForm, setCycleForm] = useState({ startDate: '', endDate: '', notes: '' });

  const cycleDateOrderInvalid = Boolean(
    cycleForm.startDate && cycleForm.endDate && cycleForm.endDate < cycleForm.startDate,
  );
  const cycleDurationDays = cycleForm.startDate && cycleForm.endDate && !cycleDateOrderInvalid
    ? differenceInCalendarDays(parseISO(cycleForm.endDate), parseISO(cycleForm.startDate)) + 1
    : 0;
  const generatedCycleName = cycleForm.startDate && cycleForm.endDate && !cycleDateOrderInvalid
    ? formatThaiShortDateRange(cycleForm.startDate, cycleForm.endDate)
    : '';

  // Entry popover state
  const [popoverKey, setPopoverKey] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState({
    status: 'working' as 'working' | 'day_off' | 'leave',
    shiftType: 'morning' as 'morning' | 'afternoon' | 'custom',
    startTime: '',
    endTime: '',
    leaveReason: '',
  });

  async function loadGrid(cycleId: string) {
    setLoadingGrid(true);
    const data = await getScheduleGrid(cycleId);
    setGrid(data ? { ...data, entryMap: data.entryMap as EntryMap } : null);
    setLoadingGrid(false);
  }

  function handleCycleChange(id: string) {
    setSelectedCycleId(id);
    loadGrid(id);
  }

  // Auto-load first cycle on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedCycleId) loadGrid(selectedCycleId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPopover(employeeId: string, date: string) {
    const key = entryKey(employeeId, date);
    const existing = grid?.entryMap[key];
    setEntryForm({
      status: existing?.status ?? 'working',
      shiftType: (existing?.shiftType as 'morning' | 'afternoon' | 'custom') ?? 'morning',
      startTime: existing?.startTime ?? SHIFT_TEMPLATES.morning.startTime,
      endTime: existing?.endTime ?? SHIFT_TEMPLATES.morning.endTime,
      leaveReason: existing?.leaveReason ?? '',
    });
    setPopoverKey(key);
  }

  function handleShiftChange(shiftType: 'morning' | 'afternoon' | 'custom') {
    const template = shiftType === 'custom' ? null : SHIFT_TEMPLATES[shiftType];
    setEntryForm((prev) => ({
      ...prev,
      shiftType,
      startTime: template?.startTime ?? prev.startTime,
      endTime: template?.endTime ?? prev.endTime,
    }));
  }

  function saveEntry(employeeId: string, workDate: string) {
    if (!selectedCycleId || !grid) return;
    startTransition(async () => {
      const result = await setScheduleEntry({
        cycleId: selectedCycleId,
        employeeId,
        workDate,
        status: entryForm.status,
        shiftType: entryForm.status === 'working' ? entryForm.shiftType : null,
        startTime: entryForm.status === 'working' ? entryForm.startTime : null,
        endTime: entryForm.status === 'working' ? entryForm.endTime : null,
        leaveReason: entryForm.status === 'leave' ? entryForm.leaveReason : null,
      });
      if (!result.ok) { toast.error(result.error); return; }

      // Optimistic update
      const key = entryKey(employeeId, workDate);
      setGrid((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entryMap: {
            ...prev.entryMap,
            [key]: {
              id: prev.entryMap[key]?.id ?? key,
              cycleId: selectedCycleId,
              employeeId,
              workDate,
              status: entryForm.status,
              shiftType: entryForm.status === 'working' ? entryForm.shiftType : null,
              startTime: entryForm.status === 'working' ? entryForm.startTime : null,
              endTime: entryForm.status === 'working' ? entryForm.endTime : null,
              leaveReason: entryForm.status === 'leave' ? entryForm.leaveReason : null,
              notes: null,
            } as ScheduleEntry,
          },
        };
      });
      setPopoverKey(null);
    });
  }

  function createCycle() {
    if (!cycleForm.startDate || !cycleForm.endDate) {
      toast.error('กรุณาเลือกวันที่เริ่มและวันที่สิ้นสุด');
      return;
    }
    if (cycleDateOrderInvalid) {
      toast.error('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
      return;
    }

    startTransition(async () => {
      const result = await createScheduleCycle({
        ...cycleForm,
        name: generatedCycleName,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('สร้างรอบตารางงานแล้ว');
      setCreateOpen(false);
      setCycleForm({ startDate: '', endDate: '', notes: '' });
      const newCycle = result.data as ScheduleCycle;
      setCycles((prev) => [newCycle, ...prev]);
      setSelectedCycleId(newCycle.id);
      loadGrid(newCycle.id);
    });
  }

  function handlePublish() {
    if (!selectedCycleId) return;
    startTransition(async () => {
      const result = await publishSchedule(selectedCycleId);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('เผยแพร่ตารางงานแล้ว');
      setCycles((prev) => prev.map((c) => c.id === selectedCycleId ? { ...c, status: 'published' } : c));
    });
  }

  /** Render the full schedule to a PNG and show the preview dialog. */
  async function handleOpenDownload() {
    if (!grid || !selectedCycle) return;
    setDownloadUrl(null);
    setDownloadOpen(true);
    try {
      const url = await renderScheduleImage({
        rangeLabel: formatThaiShortDateRange(selectedCycle.startDate, selectedCycle.endDate),
        days,
        groups: buildGroups(grid.employees),
        entryMap: grid.entryMap,
      });
      setDownloadUrl(url);
    } catch (e) {
      console.error('[SchedulePage] render image failed', e);
      toast.error('สร้างภาพตารางงานไม่สำเร็จ');
      setDownloadOpen(false);
    }
  }

  function handleDownloadImage() {
    if (!downloadUrl || !selectedCycle) return;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `ตารางงาน_${selectedCycle.startDate}_ถึง_${selectedCycle.endDate}.png`;
    a.click();
    toast.success('ดาวน์โหลดรูปตารางงานแล้ว');
  }

  function handleDeleteCycle() {
    if (!selectedCycle) return;
    const rangeLabel = formatThaiShortDateRange(selectedCycle.startDate, selectedCycle.endDate);
    openConfirm(
      `ลบรอบตารางงาน "${rangeLabel}"? กะและวันหยุดทั้งหมดในรอบนี้จะถูกลบถาวร`,
      () => {
        startTransition(async () => {
          const result = await deleteScheduleCycle({ cycleId: selectedCycle.id });
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ลบรอบตารางงานแล้ว');
          const remaining = cycles.filter((c) => c.id !== selectedCycle.id);
          setCycles(remaining);
          const next = remaining[0] ?? null;
          setSelectedCycleId(next?.id ?? null);
          if (next) loadGrid(next.id);
          else setGrid(null);
        });
      },
      { confirmLabel: 'ลบรอบนี้' },
    );
  }

  /** Move an employee up/down within its department group and persist the order. */
  function moveEmployee(empId: string, dir: -1 | 1) {
    if (!grid) return;
    const groups = buildGroups(grid.employees);
    const group = groups.find((g) => g.list.some((e) => e.id === empId));
    if (!group) return;
    const i = group.list.findIndex((e) => e.id === empId);
    const j = i + dir;
    if (j < 0 || j >= group.list.length) return;

    const newList = [...group.list];
    [newList[i], newList[j]] = [newList[j], newList[i]];
    group.list = newList;

    const updated = groups.flatMap((g) => g.list).map((e, idx) => ({ ...e, sortOrder: idx }));
    setGrid((prev) => (prev ? { ...prev, employees: updated } : prev));

    startTransition(async () => {
      const result = await setEmployeeOrder({ orderedIds: updated.map((e) => e.id) });
      if (!result.ok) {
        toast.error(result.error);
        if (selectedCycleId) loadGrid(selectedCycleId);
      }
    });
  }

  const selectedCycle = cycles.find((c) => c.id === selectedCycleId);
  const days = selectedCycle
    ? eachDayOfInterval({ start: parseISO(selectedCycle.startDate), end: parseISO(selectedCycle.endDate) })
    : [];

  return (
    <AppShell>
      {confirmDialog}

      <PageHeader
        title="ตารางงาน"
        subtitle={
          selectedCycle
            ? `${formatThaiShortDateRange(selectedCycle.startDate, selectedCycle.endDate)} — แตะช่องในตารางเพื่อกำหนดกะ หยุด หรือลา`
            : 'เลือกหรือสร้างรอบตารางงาน'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenDownload} disabled={!grid || loadingGrid}>
              <Download className="size-4" />
              ดาวน์โหลด
            </Button>
            {selectedCycle?.status === 'draft' && (
              <Button variant="outline" size="sm" onClick={handlePublish} disabled={pending}>
                <Eye className="size-4" />
                เผยแพร่
              </Button>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              สร้างรอบใหม่
            </Button>
          </div>
        }
      />

      {/* Cycle selector + legend toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedCycleId ?? ''}
          onValueChange={(v) => { if (v) handleCycleChange(v); }}
        >
          <SelectTrigger className="w-80 max-w-full">
            <span className="min-w-0 flex-1 truncate text-left">
              {selectedCycle
                ? formatThaiShortDateRange(selectedCycle.startDate, selectedCycle.endDate)
                : 'เลือกรอบตารางงาน'}
            </span>
          </SelectTrigger>
          <SelectContent>
            {cycles.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {formatThaiShortDateRange(c.startDate, c.endDate)}{c.status === 'published' && ' ✓'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCycle && (
          <StatusBadge
            label={selectedCycle.status === 'published' ? 'เผยแพร่แล้ว' : 'ร่าง'}
            variant={selectedCycle.status === 'published' ? 'success' : 'neutral'}
            dot
          />
        )}
        {selectedCycle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteCycle}
            disabled={pending}
            className="text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
          >
            <Trash2 className="size-4" />
            ลบรอบนี้
          </Button>
        )}

        {/* Legend */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {([
            ['เช้า', 'morning'],
            ['บ่าย', 'afternoon'],
            ['กำหนดเอง', 'custom'],
            ['หยุด', 'day_off'],
            ['ลา', 'leave'],
          ] as const).map(([label, k]) => (
            <span
              key={k}
              className={cn('rounded-md border px-2 py-0.5 text-[11px] font-medium', SHIFT_COLORS[k])}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loadingGrid ? (
        <DataCard>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={cn('h-10 w-full rounded-lg', i === 0 && 'h-8')} />
            ))}
          </div>
        </DataCard>
      ) : !grid ? (
        <DataCard>
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="เลือกรอบตารางงาน"
            description="เลือกรอบจากรายการด้านบน หรือสร้างรอบใหม่"
          />
        </DataCard>
      ) : (
        <div className="rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs w-full print:text-[10px]">
              <thead>
                <tr className="bg-[var(--surface-2)]">
                  <th className="border border-border px-3 py-2 text-left font-semibold text-foreground sticky left-0 bg-[var(--surface-2)] z-10 min-w-[120px]">
                    พนักงาน
                  </th>
                  {days.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                    const dow = day.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <th
                        key={day.toISOString()}
                        className={cn(
                          'border border-border px-1 py-2 font-medium min-w-[56px] text-center',
                          isToday
                            ? 'bg-[var(--surface-primary-subtle)] text-primary'
                            : isWeekend
                              ? 'bg-muted text-muted-foreground'
                              : 'text-muted-foreground',
                        )}
                      >
                        <div className={cn(isToday && 'font-bold')}>{format(day, 'd', { locale: th })}</div>
                        <div className={cn('text-[10px]', isToday ? 'text-primary' : 'text-muted-foreground')}>
                          {format(day, 'EEE', { locale: th })}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {buildGroups(grid.employees).map((group) => (
                <Fragment key={group.key || '__none__'}>
                  {/* Department group header */}
                  <tr>
                    <td className="border border-border bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-semibold text-muted-foreground sticky left-0 z-10 whitespace-nowrap">
                      {group.label} · {group.list.length} คน
                    </td>
                    <td colSpan={days.length} className="border border-border bg-[var(--surface-2)]" />
                  </tr>
                  {group.list.map((emp, idx) => (
                  <tr key={emp.id} className="hover:bg-muted/20">
                    <td className="border border-border px-2 py-1.5 font-medium text-foreground sticky left-0 bg-[var(--surface-1)] z-10">
                      <div className="flex items-center gap-1">
                        <div className="flex flex-col print:hidden">
                          <button
                            type="button"
                            aria-label={`เลื่อน ${emp.firstName} ขึ้น`}
                            disabled={idx === 0 || pending}
                            onClick={() => moveEmployee(emp.id, -1)}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                          >
                            <ChevronUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`เลื่อน ${emp.firstName} ลง`}
                            disabled={idx === group.list.length - 1 || pending}
                            onClick={() => moveEmployee(emp.id, 1)}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        </div>
                        <span className="min-w-0 truncate">
                          {emp.firstName} {emp.lastName}
                          {emp.type === 'part_time' && (
                            <span className="ml-1 text-[10px] text-muted-foreground">(PT)</span>
                          )}
                        </span>
                      </div>
                    </td>
                    {days.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const key = entryKey(emp.id, dateStr);
                      const entry = grid.entryMap[key];
                      const bg = !entry || entry.status === 'day_off'
                        ? SHIFT_COLORS.day_off
                        : entry.status === 'leave'
                          ? SHIFT_COLORS.leave
                          : SHIFT_COLORS[entry.shiftType ?? 'morning'];

                      return (
                        <td
                          key={dateStr}
                          className="border border-border p-0"
                        >
                          <Popover
                            open={popoverKey === key}
                            onOpenChange={(o) => {
                              if (o) openPopover(emp.id, dateStr);
                              else setPopoverKey(null);
                            }}
                          >
                            <PopoverTrigger
                              className={cn(
                                'w-full h-full min-h-[44px] flex items-center justify-center rounded transition-colors print:pointer-events-none',
                                bg || 'hover:bg-muted/50',
                              )}
                            >
                              <CellDisplay entry={entry} />
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-3 print:hidden" side="right">
                              <p className="text-xs font-semibold mb-2">
                                {emp.firstName} — {formatThaiDate(day)}
                              </p>
                              {/* Status select */}
                              <div className="flex gap-1 mb-3">
                                {(['working', 'day_off', 'leave'] as const).map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => setEntryForm((prev) => ({ ...prev, status: s }))}
                                    className={cn(
                                      'flex-1 rounded py-1 text-xs font-medium border transition-colors',
                                      entryForm.status === s
                                        ? 'bg-primary text-white border-primary'
                                        : 'border-border text-muted-foreground hover:border-border',
                                    )}
                                  >
                                    {s === 'working' ? 'ทำงาน' : s === 'day_off' ? 'หยุด' : 'ลา'}
                                  </button>
                                ))}
                              </div>

                              {entryForm.status === 'working' && (
                                <div className="space-y-2">
                                  <div className="flex gap-1">
                                    {(['morning', 'afternoon', 'custom'] as const).map((t) => (
                                      <button
                                        key={t}
                                        onClick={() => handleShiftChange(t)}
                                        className={cn(
                                          'flex-1 rounded py-1 text-xs border transition-colors',
                                          entryForm.shiftType === t
                                            ? t === 'morning' ? 'bg-sky-100 border-sky-300 text-sky-800'
                                              : t === 'afternoon' ? 'bg-violet-100 border-violet-300 text-violet-800'
                                              : 'bg-emerald-100 border-emerald-300 text-emerald-800'
                                            : 'border-border text-muted-foreground',
                                        )}
                                      >
                                        {t === 'morning' ? 'เช้า' : t === 'afternoon' ? 'บ่าย' : 'กำหนด'}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-xs">เริ่ม</Label>
                                      <Time24Select
                                        label="เริ่ม"
                                        value={entryForm.startTime}
                                        onValueChange={(startTime) => setEntryForm((prev) => ({ ...prev, startTime }))}
                                        className="[&_[data-slot=select-trigger]]:h-7"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">สิ้นสุด</Label>
                                      <Time24Select
                                        label="สิ้นสุด"
                                        value={entryForm.endTime}
                                        onValueChange={(endTime) => setEntryForm((prev) => ({ ...prev, endTime }))}
                                        className="[&_[data-slot=select-trigger]]:h-7"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}

                              {entryForm.status === 'leave' && (
                                <div>
                                  <Label className="text-xs">เหตุผลลา</Label>
                                  <Input
                                    value={entryForm.leaveReason}
                                    onChange={(e) => setEntryForm((p) => ({ ...p, leaveReason: e.target.value }))}
                                    placeholder="เหตุผล"
                                    className="h-7 text-xs"
                                  />
                                </div>
                              )}

                              <Button
                                size="sm"
                                className="w-full mt-3 h-7 text-xs"
                                onClick={() => saveEntry(emp.id, dateStr)}
                                disabled={pending}
                              >
                                บันทึก
                              </Button>
                            </PopoverContent>
                          </Popover>
                        </td>
                      );
                    })}
                  </tr>
                  ))}
                </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Download preview dialog */}
      <Dialog
        open={downloadOpen}
        onOpenChange={(o) => { if (!o) { setDownloadOpen(false); setDownloadUrl(null); } }}
      >
        <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-5xl">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Download className="size-4 text-primary" />
              ดาวน์โหลดตารางงาน
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              ตรวจสอบภาพก่อนบันทึกลงเครื่อง — ภาพนี้เก็บรายละเอียดครบทุกแผนก ทุกคน ทุกวันในรอบ
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
            {downloadUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={downloadUrl}
                alt="ตัวอย่างภาพตารางงานที่จะดาวน์โหลด"
                className="w-full rounded-lg border border-border bg-white shadow-sm"
              />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                กำลังสร้างภาพตารางงาน…
              </div>
            )}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-muted/30 px-6 py-4">
            <Button variant="outline" onClick={() => { setDownloadOpen(false); setDownloadUrl(null); }}>
              ยกเลิก
            </Button>
            <Button onClick={handleDownloadImage} disabled={!downloadUrl} className="min-w-36">
              <Download className="size-4" />
              บันทึกรูปลงเครื่อง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create cycle Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!pending) setCreateOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          className="max-h-[min(90vh,720px)] gap-0 overflow-hidden p-0 sm:max-w-[680px]"
        >
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-5 sm:px-7">
            <div className="flex items-start gap-3.5 pr-10">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-[var(--surface-primary-subtle)] text-primary shadow-sm">
                <CalendarRange className="size-5" />
              </div>
              <div className="min-w-0 pt-0.5">
                <DialogTitle className="text-lg font-semibold">สร้างรอบตารางงานใหม่</DialogTitle>
                <DialogDescription className="mt-1 text-sm">
                  เลือกวันที่เริ่มและวันที่สิ้นสุดของรอบ
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-6 sm:px-7">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">ช่วงวันที่ของรอบ</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">ช่วงวันที่จะแสดงเป็น พ.ศ. และใช้ระบุรอบโดยอัตโนมัติ</p>
                </div>
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  จำเป็น
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-xl border border-border bg-background p-3.5 shadow-sm">
                  <Label className="text-xs font-semibold text-muted-foreground">วันที่เริ่ม</Label>
                  <ThaiDateInput
                    value={cycleForm.startDate}
                    onValueChange={(startDate) => setCycleForm((previous) => ({
                      ...previous,
                      startDate,
                      endDate: !startDate || (previous.endDate && previous.endDate < startDate)
                        ? ''
                        : previous.endDate,
                    }))}
                    className="h-10 bg-card"
                    ariaLabel="เลือกวันเริ่มรอบ"
                  />
                </div>
                <div className="space-y-1.5 rounded-xl border border-border bg-background p-3.5 shadow-sm">
                  <Label className="text-xs font-semibold text-muted-foreground">วันที่สิ้นสุด</Label>
                  <ThaiDateInput
                    value={cycleForm.endDate}
                    onValueChange={(endDate) => setCycleForm((previous) => ({ ...previous, endDate }))}
                    min={cycleForm.startDate || undefined}
                    disabled={!cycleForm.startDate}
                    placeholder={cycleForm.startDate ? 'วว/ดด/พ.ศ.' : 'เลือกวันที่เริ่มก่อน'}
                    className="h-10 bg-card"
                    ariaLabel="เลือกวันสิ้นสุดรอบ"
                  />
                </div>
              </div>

              <div
                className={cn(
                  'flex min-h-20 items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors',
                  generatedCycleName
                    ? 'border-primary/20 bg-[var(--surface-primary-subtle)]'
                    : 'border-dashed border-border bg-muted/25',
                )}
              >
                <div className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  generatedCycleName ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}>
                  <CalendarDays className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">รอบที่จะสร้าง</p>
                  <p className={cn('mt-0.5 truncate text-sm font-semibold', generatedCycleName ? 'text-foreground' : 'text-muted-foreground')}>
                    {generatedCycleName || 'เลือกวันที่เริ่มและวันที่สิ้นสุด'}
                  </p>
                </div>
                {cycleDurationDays > 0 && (
                  <span className="shrink-0 rounded-lg border border-primary/15 bg-background/80 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-primary">
                    {cycleDurationDays} วัน
                  </span>
                )}
              </div>
            </section>

            <div className="space-y-1.5">
              <Label htmlFor="cycle-notes" className="text-sm font-semibold">หมายเหตุ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span></Label>
              <Textarea
                id="cycle-notes"
                value={cycleForm.notes}
                onChange={(event) => setCycleForm((previous) => ({ ...previous, notes: event.target.value }))}
                placeholder="เช่น รอบวันหยุดเทศกาล หรือข้อมูลที่ทีมควรรู้"
                className="min-h-24 resize-none"
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-muted/30 px-6 py-4 sm:px-7">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button
              onClick={createCycle}
              disabled={pending || !generatedCycleName}
              className="min-w-32"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {pending ? 'กำลังสร้าง...' : 'สร้างรอบ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
