'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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

const tierFormSchema = z.object({
  code: z
    .string()
    .min(1, 'กรุณากรอกรหัส')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'ตัวอักษรพิมพ์เล็ก ตัวเลข หรือ _'),
  name: z.string().min(1, 'กรุณากรอกชื่อ').max(255),
  price: z.number({ message: 'กรุณากรอกตัวเลข' }).min(0),
  vatRate: z.number().min(0).max(100),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
  notes: z.string().max(500).optional(),
});

type TierFormValues = z.infer<typeof tierFormSchema>;

interface PricingPageProps {
  initialTiers: PricingTileRow[];
}

export function PricingPage({ initialTiers }: PricingPageProps) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PricingTileRow | null>(null);

  const { data: tiers = initialTiers } = useQuery({
    queryKey: ['pricing-tiles'],
    queryFn: () => getPricingTiles('guest').then((r) => (r.ok ? r.data : [])),
    initialData: initialTiers,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ['pricing-tiles'] });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TierFormValues>({
    resolver: zodResolver(tierFormSchema),
    defaultValues: { price: 0, vatRate: 7, sortOrder: 0, isActive: true, notes: '' },
  });

  function openCreate() {
    setEditingTier(null);
    reset({ code: '', name: '', price: 0, vatRate: 7, sortOrder: 0, isActive: true, notes: '' });
    setDialogOpen(true);
  }

  function openEdit(tier: PricingTileRow) {
    setEditingTier(tier);
    reset({
      code: tier.code,
      name: tier.name,
      price: Number(tier.price),
      vatRate: Number(tier.vatRate),
      sortOrder: Number(tier.sortOrder),
      isActive: tier.isActive,
      notes: tier.notes ?? '',
    });
    setDialogOpen(true);
  }

  async function onSubmit(values: TierFormValues) {
    const payload = {
      code: values.code,
      name: values.name,
      category: 'guest' as const,
      price: values.price,
      vatIncluded: true,
      vatRate: values.vatRate,
      sortOrder: values.sortOrder,
      isActive: values.isActive,
      notes: values.notes || undefined,
    };

    const result = editingTier
      ? await updatePricingTile({ ...payload, id: editingTier.id })
      : await createPricingTile(payload);

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
    <div className="page-shell max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">ราคาตามประเภทคน</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">กำหนดราคาบุฟเฟ่ต์แยกตามประเภทผู้เข้าใช้บริการ</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 size-4" />
          เพิ่มประเภท
        </Button>
      </div>

      <div className="section-card overflow-hidden">
        {tiers.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">ลำดับ</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">รหัส</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">ชื่อ</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">ราคา (฿)</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{tier.sortOrder}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{tier.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{tier.name}</p>
                    {tier.notes && <p className="text-xs text-muted-foreground">{tier.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
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
                        <><ToggleLeft className="size-5 text-muted-foreground" /><span className="text-muted-foreground">ปิด</span></>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label="แก้ไข"
                      onClick={() => openEdit(tier)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
                  {...register('code')}
                  placeholder="adult"
                  disabled={!!editingTier}
                />
                {errors.code && (
                  <p className="text-xs text-red-600">{errors.code.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-order">ลำดับ</Label>
                <Input
                  id="f-order"
                  type="number"
                  min={0}
                  {...register('sortOrder', { valueAsNumber: true })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-name">ชื่อแสดงผล *</Label>
              <Input
                id="f-name"
                {...register('name')}
                placeholder="ผู้ใหญ่"
              />
              {errors.name && (
                <p className="text-xs text-red-600">{errors.name.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-price">ราคา (฿)</Label>
                <Input
                  id="f-price"
                  type="number"
                  min={0}
                  step={0.01}
                  {...register('price', { valueAsNumber: true })}
                />
                {errors.price && (
                  <p className="text-xs text-red-600">{errors.price.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-vat">VAT (%)</Label>
                <Input
                  id="f-vat"
                  type="number"
                  min={0}
                  max={100}
                  {...register('vatRate', { valueAsNumber: true })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-notes">หมายเหตุ (ไม่บังคับ)</Label>
              <Input
                id="f-notes"
                {...register('notes')}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...register('isActive')}
                className="h-4 w-4 rounded border-border"
              />
              เปิดใช้งาน
            </label>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/30"
            >
              ยกเลิก
            </button>
            <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>
              {isSubmitting ? 'กำลังบันทึก...' : editingTier ? 'บันทึก' : 'เพิ่ม'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
