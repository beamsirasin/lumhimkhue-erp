import { z } from 'zod';

export const SOUP_OPTIONS = ['น้ำดำ', 'น้ำใส', 'หมาล่า'] as const;
export type SoupOption = (typeof SOUP_OPTIONS)[number];

export const soupPotSchema = z.object({
  soups: z
    .array(z.enum(SOUP_OPTIONS))
    .min(1, 'กรุณาเลือกน้ำซุปอย่างน้อย 1 อย่าง')
    .max(2, 'เลือกได้สูงสุด 2 อย่างต่อหม้อ'),
});

export const CUSTOMER_TYPES = ['normal', 'foreigner', 'staff'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  normal: 'ลูกค้าทั่วไป',
  foreigner: 'ต่างชาติ',
  staff: 'พนักงาน',
};

// Compact display labels for the queue board row
export const CUSTOMER_TYPE_SHORT: Record<CustomerType, string> = {
  normal: 'ทั่วไป',
  foreigner: 'ต่างชาติ',
  staff: 'พนักงาน',
};

export const SEATING_FIT_OPTIONS = [
  'small_ok',
  'need_big',
  'need_adjacent',
  'split_ok',
  'no_split',
  'cramped_ok',
] as const;
export type SeatingFit = (typeof SEATING_FIT_OPTIONS)[number];

// Updated to use simplified Phase 15Q-B wording
export const SEATING_FIT_LABELS: Record<SeatingFit, string> = {
  small_ok:     'โต๊ะเล็กได้',
  need_big:     'โต๊ะเดียวได้',
  need_adjacent:'โต๊ะติดกัน',
  split_ok:     'แยกโต๊ะได้',
  no_split:     'ไม่แยกโต๊ะ',
  cramped_ok:   'ยอมรับนั่งแน่นได้',
};

// 4-option simplified UI for Phase 15Q-B (maps to existing SeatingFit values)
export const SIMPLIFIED_SEATING_UI = [
  { label: 'โต๊ะเดียวได้', value: 'need_big'      as SeatingFit },
  { label: 'โต๊ะติดกัน',   value: 'need_adjacent' as SeatingFit },
  { label: 'แยกโต๊ะได้',   value: 'split_ok'      as SeatingFit },
  { label: 'โต๊ะเล็กได้',  value: 'small_ok'      as SeatingFit },
] as const;

// Display label for any SeatingFit value including legacy (no_split, cramped_ok)
export function seatingDisplayLabel(fit: string | null | undefined): string {
  if (!fit) return '';
  return SEATING_FIT_LABELS[fit as SeatingFit] ?? fit;
}

export const PLANNED_TABLE_PRESETS = [
  'ยังไม่กำหนด',
  'โต๊ะเล็ก 1',
  'โต๊ะเล็ก 2',
  'โต๊ะใหญ่ 1',
  'โต๊ะใหญ่ 2',
  'โต๊ะใหญ่ 3',
  'โต๊ะใหญ่ 4',
  'ใหญ่ + เล็ก',
  'ใหญ่ + ใหญ่',
] as const;

export const SKIP_REASON_PRESETS = [
  'ลูกค้าไม่อยู่',
  'ลูกค้ายังไม่พร้อม',
  'ลูกค้าขอรอ',
  'อื่น ๆ',
] as const;

export const addQueueSchema = z.object({
  customerName: z.string().max(255).optional(),
  phone: z.string().max(20).optional(),
  adultCount: z.number().int().min(0).default(1),
  childCount: z.number().int().min(0).default(0),
  customerType: z.enum(CUSTOMER_TYPES).default('normal'),
  soupPots: z.array(soupPotSchema).min(1, 'กรุณาเลือกน้ำซุปอย่างน้อย 1 หม้อ').default([{ soups: ['น้ำดำ'] }]),
  seatingFit: z.enum(SEATING_FIT_OPTIONS).optional(),
  plannedTableNote: z.string().max(255).optional(),
  preferredZone: z.string().max(100).optional(),
});

export type AddQueueInput = z.infer<typeof addQueueSchema>;

export const updateQueueSchema = addQueueSchema.extend({
  id: z.string().uuid(),
});
export type UpdateQueueInput = z.infer<typeof updateQueueSchema>;

export const skipQueueSchema = z.object({
  id: z.string().uuid(),
  skipReason: z.string().max(255).optional(),
});
export type SkipQueueInput = z.infer<typeof skipQueueSchema>;

export const admitQueueSchema = z.object({
  id: z.string().uuid(),
  plannedTableNote: z.string().max(255).optional(),
  billIssued: z.boolean().default(false),
});
export type AdmitQueueInput = z.infer<typeof admitQueueSchema>;

export const updatePlannedTableSchema = z.object({
  id: z.string().uuid(),
  plannedTableNote: z.string().max(255),
});
export type UpdatePlannedTableInput = z.infer<typeof updatePlannedTableSchema>;
