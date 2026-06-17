'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Pencil, Plus, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

function typeLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function isAllowed(method: PaymentMethod, account: ReceivingAccount) {
  if (method.type === 'welfare') return account.type === 'welfare';
  if (method.type === 'promptpay' || method.type === 'cash') return account.type === 'bank_cash_group';
  if (method.type === 'mixed_legacy') return account.type === 'other';
  return account.type !== 'welfare';
}

function MethodDialog({
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
    const payload = {
      ...form,
      sortOrder: Number(form.sortOrder) || 0,
    };
    const result = editing
      ? await updatePaymentMethod({ ...payload, id: editing.id })
      : await createPaymentMethod(payload);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Saved');
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Payment Method' : 'Add Payment Method'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="method-code">Code</Label>
              <Input id="method-code" value={form.code} onChange={(e) => setField('code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="method-sort">Sort</Label>
              <Input id="method-sort" type="number" value={form.sortOrder} onChange={(e) => setField('sortOrder', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method-name">Name</Label>
            <Input id="method-name" value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method-type">Type</Label>
            <select
              id="method-type"
              value={form.type}
              onChange={(e) => setField('type', e.target.value as PaymentMethodType)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              {METHOD_TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.requiresReference} onChange={(e) => setField('requiresReference', e.target.checked)} />
            Requires reference
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allowOverpay} onChange={(e) => setField('allowOverpay', e.target.checked)} />
            Allows cash over-tender
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.code || !form.name}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountDialog({
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
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Saved');
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Receiving Account' : 'Add Receiving Account'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-code">Code</Label>
              <Input id="account-code" value={form.code} onChange={(e) => setField('code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-sort">Sort</Label>
              <Input id="account-sort" type="number" value={form.sortOrder} onChange={(e) => setField('sortOrder', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-name">Name</Label>
            <Input id="account-name" value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-type">Type</Label>
            <select
              id="account-type"
              value={form.type}
              onChange={(e) => setField('type', e.target.value as ReceivingAccountType)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-name">Bank</Label>
            <Input id="bank-name" value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-label">Account label</Label>
              <Input id="account-label" value={form.accountLabel} onChange={(e) => setField('accountLabel', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-last4">Last 4</Label>
              <Input id="account-last4" maxLength={4} value={form.accountLast4} onChange={(e) => setField('accountLast4', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.code || !form.name}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
    else {
      toast.success(method.isActive ? 'Disabled' : 'Enabled');
      refetch();
    }
  }

  async function toggleAccount(account: ReceivingAccount) {
    const result = await toggleReceivingAccountActive(account.id);
    if (!result.ok) toast.error(result.error);
    else {
      toast.success(account.isActive ? 'Disabled' : 'Enabled');
      refetch();
    }
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
    const result = await updateMethodAccountMappings({
      paymentMethodId: selectedMethod.id,
      mappings: nextMappings,
    });
    setSavingMappings(false);
    if (!result.ok) toast.error(result.error);
    else {
      toast.success('Mappings saved');
      refetch();
    }
  }

  async function setDefault(account: ReceivingAccount) {
    if (!selectedMethod) return;
    setSavingMappings(true);
    const result = await setDefaultReceivingAccount({
      paymentMethodId: selectedMethod.id,
      receivingAccountId: account.id,
    });
    setSavingMappings(false);
    if (!result.ok) toast.error(result.error);
    else {
      toast.success('Default updated');
      refetch();
    }
  }

  return (
    <div className="page-shell max-w-6xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Payment Settings</h1>
          <p className="text-sm text-muted-foreground">Methods, receiving accounts, and POS mappings</p>
        </div>
      </div>

      <div className="flex w-fit gap-px rounded-lg border border-border bg-muted/40 p-1">
        {([
          ['methods', 'Payment Methods'],
          ['accounts', 'Receiving Accounts'],
          ['mappings', 'Mappings'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              activeTab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'methods' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setMethodDialog('new')}>
              <Plus className="mr-1.5 size-4" />
              Add Method
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.methods.map((method) => (
              <div key={method.id} className={`rounded-lg border border-border bg-card p-4 ${method.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{method.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{method.code}</p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{typeLabel(method.type)}</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Sort {method.sortOrder}</span>
                  <div className="flex gap-1">
                    <button type="button" aria-label="Edit" onClick={() => setMethodDialog(method)} className="rounded-md p-2 hover:bg-muted">
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label="Toggle active" onClick={() => void toggleMethod(method)} className="rounded-md p-2 hover:bg-muted">
                      {method.isActive ? <ToggleRight className="size-5 text-emerald-600" /> : <ToggleLeft className="size-5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'accounts' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAccountDialog('new')}>
              <Plus className="mr-1.5 size-4" />
              Add Account
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.accounts.map((account) => (
              <div key={account.id} className={`rounded-lg border border-border bg-card p-4 ${account.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{account.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{account.code}</p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{typeLabel(account.type)}</span>
                </div>
                {(account.bankName || account.accountLabel || account.accountLast4) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {[account.bankName, account.accountLabel, account.accountLast4 ? `*${account.accountLast4}` : null].filter(Boolean).join(' / ')}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Sort {account.sortOrder}</span>
                  <div className="flex gap-1">
                    <button type="button" aria-label="Edit" onClick={() => setAccountDialog(account)} className="rounded-md p-2 hover:bg-muted">
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label="Toggle active" onClick={() => void toggleAccount(account)} className="rounded-md p-2 hover:bg-muted">
                      {account.isActive ? <ToggleRight className="size-5 text-emerald-600" /> : <ToggleLeft className="size-5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'mappings' && selectedMethod && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {data.methods.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => setSelectedMethodId(method.id)}
                className={`w-full rounded-lg border px-3 py-3 text-left ${
                  selectedMethod.id === method.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'
                }`}
              >
                <p className="text-sm font-semibold text-foreground">{method.name}</p>
                <p className="text-xs text-muted-foreground">{typeLabel(method.type)}</p>
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">{selectedMethod.name}</h2>
                <p className="text-sm text-muted-foreground">Allowed receiving accounts</p>
              </div>
              {savingMappings && <Save className="size-4 animate-pulse text-muted-foreground" />}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {data.accounts.filter((account) => isAllowed(selectedMethod, account)).map((account) => {
                const mapping = selectedMappings.find((m) => m.receivingAccountId === account.id);
                const active = mapping?.isActive ?? false;
                const isDefault = mapping?.isDefault ?? false;
                return (
                  <div key={account.id} className={`rounded-lg border border-border bg-card p-4 ${account.isActive ? '' : 'opacity-60'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{account.name}</p>
                        <p className="text-xs text-muted-foreground">{typeLabel(account.type)}</p>
                      </div>
                      {isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          <Check className="size-3" />
                          Default
                        </span>
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
                        {active ? 'Mapped' : 'Map'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void setDefault(account)}
                        disabled={savingMappings || !account.isActive || !active}
                      >
                        Set Default
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <MethodDialog
        key={methodDialog === 'new' ? 'new-method' : methodDialog?.id ?? 'method-closed'}
        open={!!methodDialog}
        editing={methodDialog && methodDialog !== 'new' ? methodDialog : null}
        onClose={() => setMethodDialog(null)}
        onSaved={refetch}
      />
      <AccountDialog
        key={accountDialog === 'new' ? 'new-account' : accountDialog?.id ?? 'account-closed'}
        open={!!accountDialog}
        editing={accountDialog && accountDialog !== 'new' ? accountDialog : null}
        onClose={() => setAccountDialog(null)}
        onSaved={refetch}
      />
    </div>
  );
}
