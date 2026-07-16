import type { BadgeVariant } from '@/components/ui/status-badge';

export type DeptOption = { value: string; label: string; variant: BadgeVariant };

// Built-in departments keep english codes; custom ones (hr_lookup_options)
// store their Thai label as the value directly.
export const DEFAULT_DEPARTMENTS: DeptOption[] = [
  { value: 'kitchen',  label: 'ครัว',      variant: 'orange' },
  { value: 'service',  label: 'เสิร์ฟ',    variant: 'info' },
  { value: 'dishwash', label: 'ล้างจาน',   variant: 'cyan' },
  { value: 'cashier',  label: 'แคชเชียร์', variant: 'success' },
  { value: 'icecream', label: 'ไอศกรีม',  variant: 'purple' },
];

/** Display label for a stored department value (custom values are their own label). */
export function deptLabelOf(value: string | null | undefined): string {
  if (!value) return 'ไม่ระบุแผนก';
  return DEFAULT_DEPARTMENTS.find((d) => d.value === value)?.label ?? value;
}

/** Group ordering: built-ins first (their order), customs next, unassigned last. */
export function deptRank(value: string | null | undefined): number {
  if (!value) return 999;
  const i = DEFAULT_DEPARTMENTS.findIndex((d) => d.value === value);
  return i >= 0 ? i : 100;
}
