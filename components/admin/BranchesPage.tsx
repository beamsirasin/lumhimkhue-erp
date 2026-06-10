'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ToggleLeft, ToggleRight, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
    initialDataUpdatedAt: Date.now(),
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

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">จัดการสาขา</h1>
          <p className="text-xs text-slate-400 mt-0.5">{branches.length} สาขา</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          เพิ่มสาขา
        </Button>
      </div>

      {branches.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-sm ring-1 ring-slate-900/5">
          <GitBranch className="size-10 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">ยังไม่มีสาขา</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <div key={b.id} className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 ${!b.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{b.name}</p>
                  {b.address && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{b.address}</p>}
                  {b.phone && <p className="text-xs text-slate-400 mt-1">{b.phone}</p>}
                  {b.taxId && <p className="text-xs text-slate-400">เลขภาษี: {b.taxId}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {b.isActive ? 'ใช้งาน' : 'ปิด'}
                </span>
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
                  className="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {b.isActive
                    ? <ToggleRight className="size-6 text-emerald-500" />
                    : <ToggleLeft className="size-6" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขสาขา' : 'เพิ่มสาขาใหม่'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>ชื่อสาขา *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="สาขาสยาม" />
            </div>
            <div className="space-y-1.5">
              <Label>ที่อยู่</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="123 ถนน..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>เบอร์โทร</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="02-xxx-xxxx" />
              </div>
              <div className="space-y-1.5">
                <Label>เลขภาษี</Label>
                <Input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} placeholder="0-0000-00000" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>ยกเลิก</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim()}>
              {saveMut.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
