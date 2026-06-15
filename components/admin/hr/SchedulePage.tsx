'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Printer, ChevronDown, Eye } from 'lucide-react';
import {
  createScheduleCycle,
  setScheduleEntry,
  getScheduleGrid,
  publishSchedule,
} from '@/lib/actions/hr';
import type { ScheduleCycle, ScheduleEntry, Employee, HrSettings } from '@/lib/db/schema';

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
  day_off: 'bg-muted/50 text-muted-foreground border-border',
  leave: 'bg-orange-100 text-orange-700 border-orange-200',
};

function entryKey(employeeId: string, date: string) {
  return `${employeeId}|${date}`;
}

function CellDisplay({ entry }: { entry?: ScheduleEntry }) {
  if (!entry || entry.status === 'day_off') {
    return <span className="text-muted-foreground/60 text-xs">หยุด</span>;
  }
  if (entry.status === 'leave') {
    return <span className="text-orange-600 text-xs font-medium">ลา</span>;
  }
  const shiftLabel = entry.shiftType === 'morning' ? 'เช้า' : entry.shiftType === 'afternoon' ? 'บ่าย' : 'กำหนด';
  return (
    <div className="text-center leading-tight">
      <div className="text-xs font-semibold">{shiftLabel}</div>
      {entry.startTime && <div className="text-[10px] text-muted-foreground">{entry.startTime}</div>}
    </div>
  );
}

export function SchedulePage({ initialCycles, settings, initialEmployees }: Props) {
  const router = useRouter();
  const [cycles, setCycles] = useState(initialCycles);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(cycles[0]?.id ?? null);
  const [grid, setGrid] = useState<GridData>(null);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // New cycle form
  const [cycleForm, setCycleForm] = useState({ name: '', startDate: '', endDate: '', notes: '' });

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
    if (selectedCycleId) loadGrid(selectedCycleId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPopover(employeeId: string, date: string) {
    const key = entryKey(employeeId, date);
    const existing = grid?.entryMap[key];
    setEntryForm({
      status: existing?.status ?? 'working',
      shiftType: (existing?.shiftType as 'morning' | 'afternoon' | 'custom') ?? 'morning',
      startTime: existing?.startTime ?? (settings.morningShiftStart),
      endTime: existing?.endTime ?? (settings.morningShiftEnd),
      leaveReason: existing?.leaveReason ?? '',
    });
    setPopoverKey(key);
  }

  function handleShiftChange(shiftType: 'morning' | 'afternoon' | 'custom') {
    setEntryForm((prev) => ({
      ...prev,
      shiftType,
      startTime: shiftType === 'morning' ? settings.morningShiftStart : shiftType === 'afternoon' ? settings.afternoonShiftStart : prev.startTime,
      endTime: shiftType === 'morning' ? settings.morningShiftEnd : shiftType === 'afternoon' ? settings.afternoonShiftEnd : prev.endTime,
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
    startTransition(async () => {
      const result = await createScheduleCycle(cycleForm);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('สร้างรอบตารางงานแล้ว');
      setCreateOpen(false);
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

  function handlePrint() {
    window.print();
  }

  const selectedCycle = cycles.find((c) => c.id === selectedCycleId);
  const days = selectedCycle
    ? eachDayOfInterval({ start: parseISO(selectedCycle.startDate), end: parseISO(selectedCycle.endDate) })
    : [];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="text-lg font-semibold text-foreground">ตารางงาน</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="size-4 mr-1.5" />
            พิมพ์ A4
          </Button>
          {selectedCycle?.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={handlePublish} disabled={pending}>
              <Eye className="size-4 mr-1.5" />
              เผยแพร่
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            สร้างรอบใหม่
          </Button>
        </div>
      </div>

      {/* Cycle selector */}
      <div className="mb-4 print:hidden">
        <Select value={selectedCycleId ?? ''} onValueChange={(v) => { if (v) handleCycleChange(v); }}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="เลือกรอบตารางงาน" />
          </SelectTrigger>
          <SelectContent>
            {cycles.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.status === 'published' && ' ✓'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold">ตารางงาน</h1>
        {selectedCycle && (
          <p className="text-sm text-muted-foreground">
            {selectedCycle.name} | {selectedCycle.startDate} ถึง {selectedCycle.endDate}
          </p>
        )}
      </div>

      {/* Grid */}
      {loadingGrid ? (
        <div className="py-12 text-center text-muted-foreground">กำลังโหลด...</div>
      ) : !grid ? (
        <div className="py-12 text-center text-muted-foreground">เลือกรอบตารางงานหรือสร้างรอบใหม่</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs w-full print:text-[10px]">
            <thead>
              <tr className="bg-muted/30">
                <th className="border border-border px-3 py-2 text-left font-semibold text-foreground sticky left-0 bg-muted/30 z-10 min-w-[120px]">
                  พนักงาน
                </th>
                {days.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="border border-border px-1 py-2 font-medium text-muted-foreground min-w-[56px] text-center"
                  >
                    <div>{format(day, 'd', { locale: th })}</div>
                    <div className="text-[10px] text-muted-foreground">{format(day, 'EEE', { locale: th })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-muted/30/50">
                  <td className="border border-border px-3 py-2 font-medium text-foreground sticky left-0 bg-card z-10">
                    {emp.firstName} {emp.lastName}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {emp.type === 'part_time' ? '(PT)' : ''}
                    </span>
                  </td>
                  {days.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const key = entryKey(emp.id, dateStr);
                    const entry = grid.entryMap[key];
                    const bg = entry
                      ? entry.status === 'leave'
                        ? SHIFT_COLORS.leave
                        : entry.status === 'day_off'
                        ? SHIFT_COLORS.day_off
                        : SHIFT_COLORS[entry.shiftType ?? 'morning']
                      : '';

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
                            className={`w-full h-full min-h-[44px] flex items-center justify-center rounded transition-colors hover:opacity-80 print:pointer-events-none ${bg || 'hover:bg-muted/50'}`}
                          >
                            <CellDisplay entry={entry} />
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3 print:hidden" side="right">
                            <p className="text-xs font-semibold mb-2">
                              {emp.firstName} — {format(day, 'd MMM', { locale: th })}
                            </p>
                            {/* Status select */}
                            <div className="flex gap-1 mb-3">
                              {(['working', 'day_off', 'leave'] as const).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => setEntryForm((prev) => ({ ...prev, status: s }))}
                                  className={`flex-1 rounded py-1 text-xs font-medium border transition-colors ${
                                    entryForm.status === s
                                      ? 'bg-primary text-white border-primary'
                                      : 'border-border text-muted-foreground hover:border-border'
                                  }`}
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
                                      className={`flex-1 rounded py-1 text-xs border transition-colors ${
                                        entryForm.shiftType === t
                                          ? t === 'morning' ? 'bg-sky-100 border-sky-300 text-sky-800'
                                            : t === 'afternoon' ? 'bg-violet-100 border-violet-300 text-violet-800'
                                            : 'bg-emerald-100 border-emerald-300 text-emerald-800'
                                          : 'border-border text-muted-foreground'
                                      }`}
                                    >
                                      {t === 'morning' ? 'เช้า' : t === 'afternoon' ? 'บ่าย' : 'กำหนด'}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">เริ่ม</Label>
                                    <Input
                                      type="time"
                                      value={entryForm.startTime}
                                      onChange={(e) => setEntryForm((p) => ({ ...p, startTime: e.target.value }))}
                                      className="h-7 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">สิ้นสุด</Label>
                                    <Input
                                      type="time"
                                      value={entryForm.endTime}
                                      onChange={(e) => setEntryForm((p) => ({ ...p, endTime: e.target.value }))}
                                      className="h-7 text-xs"
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
            </tbody>
          </table>
        </div>
      )}

      {/* Print legend */}
      <div className="hidden print:flex gap-4 mt-4 text-[10px]">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-sky-100 border border-sky-200 rounded" /> เช้า (ช)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-violet-100 border border-violet-200 rounded" /> บ่าย (บ)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-100 border border-emerald-200 rounded" /> กำหนดเอง (ก)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-orange-100 border border-orange-200 rounded" /> ลา (ล)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-muted/50 border border-border rounded" /> หยุด (ห)</span>
        <span className="ml-auto">พิมพ์: {new Date().toLocaleDateString('th-TH')}</span>
      </div>

      {/* Create cycle dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>สร้างรอบตารางงานใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>ชื่อรอบ *</Label>
              <Input
                value={cycleForm.name}
                onChange={(e) => setCycleForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="เช่น รอบ 1-14 มิ.ย. 69"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>วันเริ่ม *</Label>
                <Input type="date" value={cycleForm.startDate} onChange={(e) => setCycleForm((p) => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>วันสิ้นสุด *</Label>
                <Input type="date" value={cycleForm.endDate} onChange={(e) => setCycleForm((p) => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>หมายเหตุ</Label>
              <Input value={cycleForm.notes} onChange={(e) => setCycleForm((p) => ({ ...p, notes: e.target.value }))} placeholder="หมายเหตุ (ถ้ามี)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>ยกเลิก</Button>
            <Button onClick={createCycle} disabled={pending}>สร้างรอบ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
