'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ToggleLeft, ToggleRight, GitBranch, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { getBranches, createBranch, updateBranch, toggleBranchActive } from '@/lib/actions/branches';
import type { Branch } from '@/lib/db/schema';

export function BranchesPage({ initialBranches }: { initialBranches: Branch[] }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '', taxId: '' });

  const { data: branches = initialBranches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const r = await getBranches();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData: initialBranches,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? updateBranch(editing.id, form)
      : createBranch(form),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(editing ? 'อัปเดตสาขาแล้ว' : 'สร้างสาขาใหม่แล้ว');
      qc.invalidateQueries({ queryKey: ['branches'] });
      setShowForm(false);
      setEditing(null);
      setForm({ name: '', address: '', phone: '', taxId: '' });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      toggleBranchActive(id, isActive),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  function openCreate() {
    setEditing(null);
    setForm({ name: '', address: '', phone: '', taxId: '' });
    setShowForm(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({ name: b.name, address: b.address ?? '', phone: b.phone ?? '', taxId: b.taxId ?? '' });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  return (
    <AppShell>
      <PageHeader
        title="จัดการสาขา"
        subtitle={`${branches.length} สาขา`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4 mr-1.5" />
            เพิ่มสาขา
          </Button>
        }
      />

      {branches.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="size-5" />}
          title="ยังไม่มีสาขา"
          description="เพิ่มสาขาแรกเพื่อเริ่มใช้งานระบบ"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <div
              key={b.id}
              className={cn(
                'rounded-xl bg-card p-5 shadow-sm ring-1 ring-border/40',
                !b.isActive && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{b.name}</p>
                  {b.address && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{b.address}</p>}
                  {b.phone && <p className="text-xs text-muted-foreground mt-1">{b.phone}</p>}
                  {b.taxId && <p className="text-xs text-muted-foreground">เลขภาษี: {b.taxId}</p>}
                </div>
                <StatusBadge
                  label={b.isActive ? 'ใช้งาน' : 'ปิด'}
                  variant={b.isActive ? 'success' : 'neutral'}
                />
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(b)}>
                  <Pencil className="size-3.5 mr-1" />
                  แก้ไข
                </Button>
                <button
                  type="button"
                  onClick={() => toggleMut.mutate({ id: b.id, isActive: !b.isActive })}
                  aria-label={b.isActive ? 'ปิดสาขา' : 'เปิดสาขา'}
                  className="ml-auto text-muted-foreground hover:text-muted-foreground transition-colors"
                >
                  {b.isActive
                    ? <ToggleRight className="size-6 text-[var(--status-success-fg)]" />
                    : <ToggleLeft className="size-6" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={showForm} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <SheetContent side="right" showCloseButton={false} className="flex flex-col gap-0 p-0 sm:max-w-[420px]">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <p className="text-base font-semibold text-foreground">
              {editing ? 'แก้ไขสาขา' : 'เพิ่มสาขาใหม่'}
            </p>
            <Button variant="ghost" size="icon" aria-label="ปิด" onClick={closeForm}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label>ชื่อสาขา *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="สาขาสยาม"
              />
            </div>
            <div className="space-y-1.5">
              <Label>ที่อยู่</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="123 ถนน..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>เบอร์โทร</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="02-xxx-xxxx"
                />
              </div>
              <div className="space-y-1.5">
                <Label>เลขภาษี</Label>
                <Input
                  value={form.taxId}
                  onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
                  placeholder="0-0000-00000"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={closeForm}>ยกเลิก</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim()}>
              {saveMut.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
