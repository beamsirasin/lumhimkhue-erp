'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
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
import {
  getPricingTiles,
  createPricingTile,
  updatePricingTile,
  togglePricingTileActive,
  type PricingTileRow,
} from '@/lib/actions/pricing';

interface TierFormState {
  code: string;
  name: string;
  price: string;
  vatIncluded: boolean;
  vatRate: string;
  sortOrder: string;
  isActive: boolean;
  notes: string;
}

const EMPTY_FORM: TierFormState = {
  code: '',
  name: '',
  price: '0',
  vatIncluded: true,
  vatRate: '7',
  sortOrder: '0',
  isActive: true,
  notes: '',
};

interface PricingPageProps {
  initialTiers: PricingTileRow[];
}

export function PricingPage({ initialTiers }: PricingPageProps) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PricingTileRow | null>(null);
  const [form, setForm] = useState<TierFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const { data: tiers = initialTiers } = useQuery({
    queryKey: ['pricing-tiles'],
    queryFn: () => getPricingTiles('guest').then((r) => (r.ok ? r.data : [])),
    initialData: initialTiers,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ['pricing-tiles'] });

  function openCreate() {
    setEditingTier(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(tier: PricingTileRow) {
    setEditingTier(tier);
    setForm({
      code: tier.code,
      name: tier.name,
      price: String(tier.price),
      vatIncluded: tier.vatIncluded,
      vatRate: String(tier.vatRate),
      sortOrder: String(tier.sortOrder),
      isActive: tier.isActive,
      notes: tier.notes ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setSubmitting(true);
    const payload = {
      code: form.code,
      name: form.name,
      category: 'guest' as const,
      price: Number(form.price),
      vatIncluded: form.vatIncluded,
      vatRate: Number(form.vatRate),
      sortOrder: Number(form.sortOrder),
      isActive: form.isActive,
      notes: form.notes || undefined,
    };

    const result = editingTier
      ? await updatePricingTile({ ...payload, id: editingTier.id })
      : await createPricingTile(payload);

    setSubmitting(false);
    if (result.ok) {
      toast.success(editingTier ? 'แก้ไขสำเร็จ' : 'เพิ่มสำเร็จ');
      setDialogOpen(false);
      refetch();
    } else {
      toast.error(result.error);
    }
  }

  async function handleToggle(tier: PricingTileRow) {
    const result = await togglePricingTileActive(tier.id);
    if (result.ok) {
      toast.success(tier.isActive ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว');
      refetch();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-slate-900">ราคาตามประเภทคน</h1>
          <p className="mt-0.5 text-sm text-slate-500">กำหนดราคาบุฟเฟ่ต์แยกตามประเภทผู้เข้าใช้บริการ</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 size-4" />
          เพิ่มประเภท
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {tiers.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">ยังไม่มีข้อมูล</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500">ลำดับ</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500">รหัส</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500">ชื่อ</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">ราคา (฿)</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 tabular-nums text-slate-400">{tier.sortOrder}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{tier.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{tier.name}</p>
                    {tier.notes && <p className="text-xs text-slate-400">{tier.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                    ฿{Number(tier.price).toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void handleToggle(tier)}
                      aria-label={tier.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      {tier.isActive ? (
                        <><ToggleRight className="size-5 text-green-500" /><span className="text-green-700">ใช้งาน</span></>
                      ) : (
                        <><ToggleLeft className="size-5 text-slate-400" /><span className="text-slate-400">ปิด</span></>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label="แก้ไข"
                      onClick={() => openEdit(tier)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingTier ? 'แก้ไขประเภทราคา' : 'เพิ่มประเภทราคา'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-code">รหัส (code) *</Label>
                <Input
                  id="f-code"
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="adult"
                  disabled={!!editingTier}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-order">ลำดับ</Label>
                <Input
                  id="f-order"
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-name">ชื่อแสดงผล *</Label>
              <Input
                id="f-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="ผู้ใหญ่"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-price">ราคา (฿)</Label>
                <Input
                  id="f-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-vat">VAT (%)</Label>
                <Input
                  id="f-vat"
                  type="number"
                  min={0}
                  max={100}
                  value={form.vatRate}
                  onChange={(e) => setForm((p) => ({ ...p, vatRate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-notes">หมายเหตุ (ไม่บังคับ)</Label>
              <Input
                id="f-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300"
              />
              เปิดใช้งาน
            </label>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <Button onClick={handleSubmit} disabled={submitting || !form.code || !form.name}>
              {submitting ? 'กำลังบันทึก...' : editingTier ? 'บันทึก' : 'เพิ่ม'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
