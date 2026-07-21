'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus, Siren, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createEmergencyPurchase,
  getPurchaseOrderFormData,
  type POListData,
} from '@/lib/actions/inventory';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type EmergencyLine = {
  ingredientId: string;
  quantity: number;
  unit: string;
  purchaseUnit: string;
  conversion: number;
  priceStatus: 'pending' | 'confirmed';
  actualUnitCost: number | null;
};

type PurchaseOrderFormData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderFormData>>, { ok: true }>['data']
>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: POListData['suppliers'];
  orders: POListData['orders'];
  onSaved: () => void;
};

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function EmergencyPurchaseDialog({
  open,
  onOpenChange,
  suppliers,
  orders,
  onSaved,
}: Props) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const [businessDate, setBusinessDate] = useState(today);
  const [vendorName, setVendorName] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [sourcePurchaseOrderId, setSourcePurchaseOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EmergencyLine[]>([]);
  const [ingredients, setIngredients] = useState<PurchaseOrderFormData['ingredients']>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();

  async function loadIngredients() {
    if (ingredients.length > 0) return;
    const result = await getPurchaseOrderFormData();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setIngredients(result.data.ingredients);
  }

  function addLine() {
    const ingredient = ingredients.find(
      (candidate) => !lines.some((line) => line.ingredientId === candidate.id),
    );
    if (!ingredient) {
      toast.error(ingredients.length === 0 ? 'กำลังโหลดวัตถุดิบ กรุณาลองอีกครั้ง' : 'เพิ่มวัตถุดิบครบแล้ว');
      loadIngredients();
      return;
    }
    setLines((current) => current.concat({
      ingredientId: ingredient.id,
      quantity: 1,
      unit: ingredient.unit,
      purchaseUnit: ingredient.orderUnit ?? ingredient.unit,
      conversion: Number(ingredient.orderUnitConversion) || 1,
      priceStatus: 'pending',
      actualUnitCost: null,
    }));
  }

  function reset() {
    setVendorName('');
    setSupplierId('');
    setSourcePurchaseOrderId('');
    setReason('');
    setNotes('');
    setLines([]);
    setIdempotencyKey(crypto.randomUUID());
  }

  function submit() {
    startTransition(async () => {
      const result = await createEmergencyPurchase({
        businessDate,
        purchasedAt: new Date().toISOString(),
        supplierId: supplierId || null,
        vendorName,
        sourcePurchaseOrderId: sourcePurchaseOrderId || null,
        reason,
        notes: notes || null,
        idempotencyKey,
        items: lines,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.duplicate ? 'รายการนี้ถูกบันทึกแล้ว ระบบไม่สร้างซ้ำ' : 'บันทึกซื้อฉุกเฉินและรับของแล้ว');
      reset();
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (nextOpen) loadIngredients();
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Siren className="size-5 text-[var(--status-orange-fg)]" />
            ซื้อฉุกเฉิน / ซื้อหน้างาน
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-sm text-[var(--status-warning-fg)]">
          ระบบจะสร้างหลักฐานการซื้อ ใบรับของ และยอดรับเข้าสต็อกพร้อมกันแบบ atomic
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>วันทำการ</Label>
            <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>ชื่อร้าน/ผู้ขาย *</Label>
            <Input value={vendorName} onChange={(event) => setVendorName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>ผูก Supplier (ถ้ามี)</Label>
            <Select value={supplierId || 'none'} onValueChange={(v) => setSupplierId(v === 'none' || v == null ? '' : v)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue>
                  {(v) => (!v || v === 'none' ? 'ไม่ผูก Supplier' : (suppliers.find((s) => s.id === v)?.name ?? 'ไม่ผูก Supplier'))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">ไม่ผูก Supplier</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>PO ต้นทางที่ของขาด/ส่งไม่ทัน (ถ้ามี)</Label>
            <Select value={sourcePurchaseOrderId || 'none'} onValueChange={(v) => setSourcePurchaseOrderId(v === 'none' || v == null ? '' : v)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue>
                  {(v) => {
                    if (!v || v === 'none') return 'ไม่ผูก PO ต้นทาง';
                    const o = orders.find((order) => order.id === v);
                    return o ? `${o.poNumber} · ${o.displaySupplierName}` : 'ไม่ผูก PO ต้นทาง';
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">ไม่ผูก PO ต้นทาง</SelectItem>
                {orders.filter((order) => order.status === 'ordered' || order.status === 'partial_received').map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    {order.poNumber} · {order.displaySupplierName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>เหตุผล *</Label>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น ของขาดระหว่างวัน" />
          </div>
        </div>

        <div className="rounded-xl border">
          <div className="flex items-center justify-between border-b p-3">
            <div>
              <div className="font-medium">รายการซื้อ</div>
              <div className="text-xs text-muted-foreground">ราคาจริงคิดต่อหน่วยสต็อกหลังแปลงหน่วย</div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addLine}>
              <Plus className="size-4" />
              เพิ่มรายการ
            </Button>
          </div>
          <div className="space-y-2 p-3">
            {lines.map((line, index) => (
              <div
                key={String(index)}
                className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[2fr_100px_120px_110px_140px_150px_40px]"
              >
                <Select
                  value={line.ingredientId || null}
                  onValueChange={(value) => {
                    const ingredient = ingredients.find((candidate) => candidate.id === value);
                    setLines((current) => current.map((candidate, candidateIndex) => (
                      candidateIndex === index
                        ? {
                            ...candidate,
                            ingredientId: value ?? '',
                            unit: ingredient?.unit ?? candidate.unit,
                            purchaseUnit: ingredient?.orderUnit ?? ingredient?.unit ?? candidate.purchaseUnit,
                            conversion: Number(ingredient?.orderUnitConversion) || 1,
                          }
                        : candidate
                    )));
                  }}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="เลือกวัตถุดิบ">
                      {(v) => ingredients.find((i) => i.id === v)?.name ?? 'เลือกวัตถุดิบ'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ingredients.map((ingredient) => (
                      <SelectItem key={ingredient.id} value={ingredient.id}>{ingredient.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.quantity}
                  onChange={(event) => setLines((current) => current.map((candidate, candidateIndex) => (
                    candidateIndex === index ? { ...candidate, quantity: numeric(event.target.value) } : candidate
                  )))}
                />
                <Input
                  value={line.purchaseUnit}
                  onChange={(event) => setLines((current) => current.map((candidate, candidateIndex) => (
                    candidateIndex === index ? { ...candidate, purchaseUnit: event.target.value } : candidate
                  )))}
                  placeholder="หน่วยซื้อ"
                />
                <Input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={line.conversion}
                  onChange={(event) => setLines((current) => current.map((candidate, candidateIndex) => (
                    candidateIndex === index ? { ...candidate, conversion: numeric(event.target.value) } : candidate
                  )))}
                  title="ตัวคูณเป็นหน่วยสต็อก"
                />
                <Select
                  value={line.priceStatus}
                  onValueChange={(value) => setLines((current) => current.map((candidate, candidateIndex) => (
                    candidateIndex === index
                      ? { ...candidate, priceStatus: (value as 'pending' | 'confirmed') ?? 'pending' }
                      : candidate
                  )))}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue>
                      {(v) => (v === 'confirmed' ? 'ราคาจริง' : 'รอราคา')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">รอราคา</SelectItem>
                    <SelectItem value="confirmed">ราคาจริง</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={line.priceStatus === 'pending'}
                  value={line.actualUnitCost ?? ''}
                  onChange={(event) => setLines((current) => current.map((candidate, candidateIndex) => (
                    candidateIndex === index
                      ? {
                          ...candidate,
                          actualUnitCost: event.target.value === '' ? null : numeric(event.target.value),
                        }
                      : candidate
                  )))}
                  placeholder="ราคาจริง/หน่วยสต็อก"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setLines((current) => current.filter((_, candidateIndex) => candidateIndex !== index))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {lines.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีรายการ</div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>หมายเหตุเพิ่มเติม</Label>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        <DialogFooter>
          <Button
            disabled={isPending || vendorName.trim() === '' || reason.trim().length < 3 || lines.length === 0}
            onClick={submit}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            บันทึกซื้อฉุกเฉิน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


