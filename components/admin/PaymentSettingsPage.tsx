'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CreditCard, Pencil, Plus, Save, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  createPaymentMethod,
  createReceivingAccount,
  getPaymentSettings,
  setDefaultReceivingAccount,
  togglePaymentMethodActive,
  toggleReceivingAccountActive,
  updateMethodAccountMappings,
  updatePaymentMethod,
  updateReceivingAccount,
  type PaymentSettingsData,
} from '@/lib/actions/payment-settings';
import type {
  PaymentMethod,
  PaymentMethodType,
  ReceivingAccount,
  ReceivingAccountType,
} from '@/lib/db/schema';

type Tab = 'methods' | 'accounts' | 'mappings';

type MethodForm = {
  code: string;
  name: string;
  type: PaymentMethodType;
  requiresReference: boolean;
  allowOverpay: boolean;
  isActive: boolean;
  sortOrder: string;
};

type AccountForm = {
  code: string;
  name: string;
  type: ReceivingAccountType;
  bankName: string;
  accountLabel: string;
  accountLast4: string;
  isActive: boolean;
  sortOrder: string;
};

const METHOD_TYPES: PaymentMethodType[] = ['promptpay', 'cash', 'welfare', 'mixed_legacy', 'other'];
const ACCOUNT_TYPES: ReceivingAccountType[] = ['bank_cash_group', 'welfare', 'cash_drawer', 'other'];

const EMPTY_METHOD: MethodForm = {
  code: '',
  name: '',
  type: 'promptpay',
  requiresReference: false,
  allowOverpay: false,
  isActive: true,
  sortOrder: '0',
};

const EMPTY_ACCOUNT: AccountForm = {
  code: '',
  name: '',
  type: 'bank_cash_group',
  bankName: '',
  accountLabel: '',
  accountLast4: '',
  isActive: true,
  sortOrder: '0',
};

// ─── Badge variant maps ───────────────────────────────────────────────────────

const METHOD_TYPE_VARIANTS: Record<PaymentMethodType, BadgeVariant> = {
  promptpay:    'info',
  cash:         'success',
  welfare:      'purple',
  mixed_legacy: 'warning',
  other:        'neutral',
};

const ACCOUNT_TYPE_VARIANTS: Record<ReceivingAccountType, BadgeVariant> = {
  bank_cash_group: 'info',
  welfare:         'purple',
  cash_drawer:     'success',
  other:           'neutral',
};

// ─── Thai label maps ──────────────────────────────────────────────────────────

const METHOD_TYPE_LABELS: Record<PaymentMethodType, string> = {
  promptpay:    'QR PromptPay',
  cash:         'เงินสด',
  welfare:      'สวัสดิการรัฐ',
  mixed_legacy: 'QR+เงินสด (เดิม)',
  other:        'อื่น ๆ',
};

const ACCOUNT_TYPE_LABELS: Record<ReceivingAccountType, string> = {
  bank_cash_group: 'บัญชีธนาคาร/เงินสด',
  welfare:         'บัญชีสวัสดิการรัฐ',
  cash_drawer:     'ลิ้นชักเงินสด',
  other:           'อื่น ๆ',
};

// ─── Helpers (unchanged) ─────────────────────────────────────────────────────

function methodToForm(method: PaymentMethod): MethodForm {
  return {
    code: method.code,
    name: method.name,
    type: method.type,
    requiresReference: method.requiresReference,
    allowOverpay: method.allowOverpay,
    isActive: method.isActive,
    sortOrder: String(method.sortOrder),
  };
}

function accountToForm(account: ReceivingAccount): AccountForm {
  return {
    code: account.code,
    name: account.name,
    type: account.type,
    bankName: account.bankName ?? '',
    accountLabel: account.accountLabel ?? '',
    accountLast4: account.accountLast4 ?? '',
    isActive: account.isActive,
    sortOrder: String(account.sortOrder),
  };
}

function isAllowed(method: PaymentMethod, account: ReceivingAccount) {
  if (method.type === 'welfare') return account.type === 'welfare';
  if (method.type === 'promptpay' || method.type === 'cash') return account.type === 'bank_cash_group';
  if (method.type === 'mixed_legacy') return account.type === 'other';
  return account.type !== 'welfare';
}

// ─── Native select class — consistent with Input component styling ────────────
const SELECT_CLS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

// ─── Sheets ───────────────────────────────────────────────────────────────────

function MethodSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: PaymentMethod | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MethodForm>(() => (editing ? methodToForm(editing) : EMPTY_METHOD));
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof MethodForm>(key: K, value: MethodForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function submit() {
    setSaving(true);
    const payload = { ...form, sortOrder: Number(form.sortOrder) || 0 };
    const result = editing
      ? await updatePaymentMethod({ ...payload, id: editing.id })
      : await createPaymentMethod(payload);
    setSaving(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success('บันทึกแล้ว');
    onSaved();
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" showCloseButton={false} className="flex flex-col gap-0 p-0 sm:max-w-[440px]">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <p className="text-base font-semibold text-foreground">
            {editing ? 'แก้ไขช่องทางชำระเงิน' : 'เพิ่มช่องทางชำระเงิน'}
          </p>
          <Button variant="ghost" size="icon" aria-label="ปิด" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="method-code">รหัส</Label>
              <Input id="method-code" value={form.code} onChange={(e) => setField('code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="method-sort">ลำดับ</Label>
              <Input id="method-sort" type="number" value={form.sortOrder} onChange={(e) => setField('sortOrder', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method-name">ชื่อ</Label>
            <Input id="method-name" value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method-type">ประเภท</Label>
            <select
              id="method-type"
              value={form.type}
              onChange={(e) => setField('type', e.target.value as PaymentMethodType)}
              className={SELECT_CLS}
            >
              {METHOD_TYPES.map((type) => <option key={type} value={type}>{METHOD_TYPE_LABELS[type]}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.requiresReference} onChange={(e) => setField('requiresReference', e.target.checked)} />
            ต้องการหมายเลขอ้างอิง
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allowOverpay} onChange={(e) => setField('allowOverpay', e.target.checked)} />
            อนุญาตรับเงินเกิน
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} />
            ใช้งาน
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={submit} disabled={saving || !form.code || !form.name}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AccountSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ReceivingAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AccountForm>(() => (editing ? accountToForm(editing) : EMPTY_ACCOUNT));
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function submit() {
    setSaving(true);
    const payload = {
      ...form,
      bankName: form.bankName || null,
      accountLabel: form.accountLabel || null,
      accountLast4: form.accountLast4 || null,
      sortOrder: Number(form.sortOrder) || 0,
    };
    const result = editing
      ? await updateReceivingAccount({ ...payload, id: editing.id })
      : await createReceivingAccount(payload);
    setSaving(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success('บันทึกแล้ว');
    onSaved();
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" showCloseButton={false} className="flex flex-col gap-0 p-0 sm:max-w-[440px]">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <p className="text-base font-semibold text-foreground">
            {editing ? 'แก้ไขบัญชีรับเงิน' : 'เพิ่มบัญชีรับเงิน'}
          </p>
          <Button variant="ghost" size="icon" aria-label="ปิด" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-code">รหัส</Label>
              <Input id="account-code" value={form.code} onChange={(e) => setField('code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-sort">ลำดับ</Label>
              <Input id="account-sort" type="number" value={form.sortOrder} onChange={(e) => setField('sortOrder', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-name">ชื่อ</Label>
            <Input id="account-name" value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-type">ประเภทบัญชี</Label>
            <select
              id="account-type"
              value={form.type}
              onChange={(e) => setField('type', e.target.value as ReceivingAccountType)}
              className={SELECT_CLS}
            >
              {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-name">ธนาคาร</Label>
            <Input id="bank-name" value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-label">ชื่อบัญชี</Label>
              <Input id="account-label" value={form.accountLabel} onChange={(e) => setField('accountLabel', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-last4">4 หลักสุดท้าย</Label>
              <Input id="account-last4" maxLength={4} value={form.accountLast4} onChange={(e) => setField('accountLast4', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} />
            ใช้งาน
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={submit} disabled={saving || !form.code || !form.name}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export function PaymentSettingsPage({ initialData }: { initialData: PaymentSettingsData }) {
  const [activeTab, setActiveTab] = useState<Tab>('methods');
  const [methodDialog, setMethodDialog] = useState<PaymentMethod | null | 'new'>(null);
  const [accountDialog, setAccountDialog] = useState<ReceivingAccount | null | 'new'>(null);
  const [selectedMethodId, setSelectedMethodId] = useState(initialData.methods[0]?.id ?? '');
  const [savingMappings, setSavingMappings] = useState(false);
  const queryClient = useQueryClient();

  const { data = initialData } = useQuery({
    queryKey: ['payment-settings'],
    queryFn: () => getPaymentSettings().then((r) => (r.ok ? r.data : initialData)),
    initialData,
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['payment-settings'] });
  const selectedMethod = data.methods.find((m) => m.id === selectedMethodId) ?? data.methods[0] ?? null;
  const selectedMappings = useMemo(
    () => data.mappings.filter((m) => m.paymentMethodId === selectedMethod?.id),
    [data.mappings, selectedMethod?.id],
  );

  async function toggleMethod(method: PaymentMethod) {
    const result = await togglePaymentMethodActive(method.id);
    if (!result.ok) toast.error(result.error);
    else { toast.success(method.isActive ? 'ปิดแล้ว' : 'เปิดแล้ว'); refetch(); }
  }

  async function toggleAccount(account: ReceivingAccount) {
    const result = await toggleReceivingAccountActive(account.id);
    if (!result.ok) toast.error(result.error);
    else { toast.success(account.isActive ? 'ปิดแล้ว' : 'เปิดแล้ว'); refetch(); }
  }

  async function saveMapping(account: ReceivingAccount, isActive: boolean, isDefault: boolean) {
    if (!selectedMethod) return;
    const existing = new Map(selectedMappings.map((m) => [m.receivingAccountId, m]));
    const nextMappings = data.accounts
      .filter((a) => isAllowed(selectedMethod, a))
      .map((a) => {
        const current = existing.get(a.id);
        if (a.id === account.id) return { receivingAccountId: a.id, isActive, isDefault };
        return {
          receivingAccountId: a.id,
          isActive: current?.isActive ?? false,
          isDefault: isDefault ? false : current?.isDefault ?? false,
        };
      });
    setSavingMappings(true);
    const result = await updateMethodAccountMappings({ paymentMethodId: selectedMethod.id, mappings: nextMappings });
    setSavingMappings(false);
    if (!result.ok) toast.error(result.error);
    else { toast.success('บันทึก mapping แล้ว'); refetch(); }
  }

  async function setDefault(account: ReceivingAccount) {
    if (!selectedMethod) return;
    setSavingMappings(true);
    const result = await setDefaultReceivingAccount({ paymentMethodId: selectedMethod.id, receivingAccountId: account.id });
    setSavingMappings(false);
    if (!result.ok) toast.error(result.error);
    else { toast.success('อัปเดตค่าเริ่มต้นแล้ว'); refetch(); }
  }

  return (
    <AppShell>
      <PageHeader
        title="ตั้งค่าการชำระเงิน"
        subtitle="ช่องทางชำระเงิน · บัญชีรับเงิน · การจับคู่"
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => { if (typeof v === 'string' && v) setActiveTab(v as Tab); }}
        className="gap-0"
      >
        <TabsList
          variant="line"
          className="w-full justify-start rounded-none border-b border-border px-0 h-auto"
        >
          <TabsTrigger value="methods"  className="px-4 py-2.5 h-auto rounded-none">ช่องทางชำระเงิน</TabsTrigger>
          <TabsTrigger value="accounts" className="px-4 py-2.5 h-auto rounded-none">บัญชีรับเงิน</TabsTrigger>
          <TabsTrigger value="mappings" className="px-4 py-2.5 h-auto rounded-none">การจับคู่</TabsTrigger>
        </TabsList>

        {/* ── Methods tab ── */}
        <TabsContent value="methods" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setMethodDialog('new')}>
              <Plus className="mr-1.5 size-4" />
              เพิ่มช่องทาง
            </Button>
          </div>
          {data.methods.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="size-5" />}
              title="ยังไม่มีช่องทางชำระเงิน"
              description="เพิ่มช่องทางชำระเงินแรกเพื่อเริ่มใช้งาน"
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.methods.map((method) => (
                <div
                  key={method.id}
                  className={cn(
                    'rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] p-4',
                    !method.isActive && 'opacity-60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{method.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{method.code}</p>
                    </div>
                    <StatusBadge label={METHOD_TYPE_LABELS[method.type]} variant={METHOD_TYPE_VARIANTS[method.type]} />
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">ลำดับ {method.sortOrder}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="แก้ไข"
                        onClick={() => setMethodDialog(method)}
                        className="rounded-md p-2 hover:bg-muted"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={method.isActive ? 'ปิดช่องทาง' : 'เปิดช่องทาง'}
                        onClick={() => void toggleMethod(method)}
                        className="rounded-md p-2 hover:bg-muted"
                      >
                        {method.isActive
                          ? <ToggleRight className="size-5 text-[var(--status-success-fg)]" />
                          : <ToggleLeft  className="size-5 text-muted-foreground" />
                        }
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Accounts tab ── */}
        <TabsContent value="accounts" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAccountDialog('new')}>
              <Plus className="mr-1.5 size-4" />
              เพิ่มบัญชี
            </Button>
          </div>
          {data.accounts.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="ยังไม่มีบัญชีรับเงิน"
              description="เพิ่มบัญชีรับเงินเพื่อเชื่อมกับช่องทางชำระเงิน"
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.accounts.map((account) => (
                <div
                  key={account.id}
                  className={cn(
                    'rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] p-4',
                    !account.isActive && 'opacity-60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{account.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{account.code}</p>
                    </div>
                    <StatusBadge label={ACCOUNT_TYPE_LABELS[account.type]} variant={ACCOUNT_TYPE_VARIANTS[account.type]} />
                  </div>
                  {(account.bankName || account.accountLabel || account.accountLast4) && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {[account.bankName, account.accountLabel, account.accountLast4 ? `*${account.accountLast4}` : null]
                        .filter(Boolean)
                        .join(' / ')}
                    </p>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">ลำดับ {account.sortOrder}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="แก้ไข"
                        onClick={() => setAccountDialog(account)}
                        className="rounded-md p-2 hover:bg-muted"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={account.isActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                        onClick={() => void toggleAccount(account)}
                        className="rounded-md p-2 hover:bg-muted"
                      >
                        {account.isActive
                          ? <ToggleRight className="size-5 text-[var(--status-success-fg)]" />
                          : <ToggleLeft  className="size-5 text-muted-foreground" />
                        }
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Mappings tab ── */}
        <TabsContent value="mappings" className="mt-4">
          {selectedMethod ? (
            <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
              {/* Method selector sidebar */}
              <div className="space-y-2">
                {data.methods.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setSelectedMethodId(method.id)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                      selectedMethod.id === method.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-[var(--surface-1)] hover:bg-muted/40',
                    )}
                  >
                    <p className="text-sm font-semibold text-foreground">{method.name}</p>
                    <p className="text-xs text-muted-foreground">{METHOD_TYPE_LABELS[method.type]}</p>
                  </button>
                ))}
              </div>

              {/* Account mapping grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{selectedMethod.name}</h2>
                    <p className="text-sm text-muted-foreground">บัญชีรับเงินที่เชื่อมได้</p>
                  </div>
                  {savingMappings && <Save className="size-4 animate-pulse text-muted-foreground" />}
                </div>
                {data.accounts.filter((a) => isAllowed(selectedMethod, a)).length === 0 ? (
                  <EmptyState
                    icon={<Building2 className="size-5" />}
                    title="ไม่มีบัญชีที่เข้ากันได้"
                    description="ไม่มีบัญชีรับเงินที่ตรงกับประเภทของช่องทางชำระเงินนี้"
                    size="sm"
                  />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.accounts.filter((account) => isAllowed(selectedMethod, account)).map((account) => {
                      const mapping  = selectedMappings.find((m) => m.receivingAccountId === account.id);
                      const active    = mapping?.isActive   ?? false;
                      const isDefault = mapping?.isDefault  ?? false;
                      return (
                        <div
                          key={account.id}
                          className={cn(
                            'rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] p-4',
                            !account.isActive && 'opacity-60',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground">{account.name}</p>
                              <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[account.type]}</p>
                            </div>
                            {isDefault && (
                              <StatusBadge label="ค่าเริ่มต้น" variant="success" dot />
                            )}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={active ? 'default' : 'outline'}
                              onClick={() => void saveMapping(account, !active, isDefault && !active)}
                              disabled={savingMappings || !account.isActive}
                            >
                              {active ? 'เชื่อมแล้ว' : 'เชื่อม'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void setDefault(account)}
                              disabled={savingMappings || !account.isActive || !active}
                            >
                              ตั้งค่าเริ่มต้น
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<CreditCard className="size-5" />}
              title="ยังไม่มีช่องทางชำระเงิน"
              description="เพิ่มช่องทางชำระเงินก่อนเพื่อตั้งค่า mapping"
            />
          )}
        </TabsContent>
      </Tabs>

      <MethodSheet
        key={methodDialog === 'new' ? 'new-method' : methodDialog?.id ?? 'method-closed'}
        open={!!methodDialog}
        editing={methodDialog && methodDialog !== 'new' ? methodDialog : null}
        onClose={() => setMethodDialog(null)}
        onSaved={refetch}
      />
      <AccountSheet
        key={accountDialog === 'new' ? 'new-account' : accountDialog?.id ?? 'account-closed'}
        open={!!accountDialog}
        editing={accountDialog && accountDialog !== 'new' ? accountDialog : null}
        onClose={() => setAccountDialog(null)}
        onSaved={refetch}
      />
    </AppShell>
  );
}
