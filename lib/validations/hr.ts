import { z } from 'zod';

// ── HR Settings ────────────────────────────────────────────────────────────

export const hrSettingsSchema = z.object({
  absenceRatePerDay: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0'),
  lateRatePerMinute: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0'),
  morningShiftStart: z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบ HH:MM'),
  morningShiftEnd: z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบ HH:MM'),
  afternoonShiftStart: z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบ HH:MM'),
  afternoonShiftEnd: z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบ HH:MM'),
  defaultBreakMinutes: z.coerce.number().int().min(0),
});

export type HrSettingsInput = z.infer<typeof hrSettingsSchema>;

// ── Employee ───────────────────────────────────────────────────────────────

export const employeeSchema = z
  .object({
    firstName: z.string().min(1, 'กรุณากรอกชื่อ'),
    lastName: z.string().min(1, 'กรุณากรอกนามสกุล'),
    phone: z.string().optional(),
    // Built-in codes (kitchen/service/dishwash/cashier/icecream) or a custom
    // label added via hr_lookup_options — validated as bounded free text.
    department: z.string().trim().min(1).max(50).optional().nullable(),
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    nationalId: z.string().max(13).optional().nullable(),
    taxId: z.string().max(13).optional().nullable(),
    socialSecurityNumber: z.string().max(15).optional().nullable(),
    employmentEndDate: z.string().optional().nullable(),
    ssfRegistered: z.boolean().default(true),
    type: z.enum(['full_time', 'part_time']),
    status: z.enum(['active', 'inactive']).default('active'),
    baseSalaryPerCycle: z.coerce.number().min(0).optional().nullable(),
    incentivePerDay: z.coerce.number().min(0).default(0),
    hourlyRate: z.coerce.number().min(0).optional().nullable(),
    startDate: z.string().optional().nullable(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'full_time' && !data.baseSalaryPerCycle) {
      ctx.addIssue({ code: 'custom', path: ['baseSalaryPerCycle'], message: 'กรุณากรอกเงินเดือนต่อรอบ' });
    }
    if (data.type === 'part_time' && !data.hourlyRate) {
      ctx.addIssue({ code: 'custom', path: ['hourlyRate'], message: 'กรุณากรอกเรทต่อชั่วโมง' });
    }
  });

export type EmployeeInput = z.infer<typeof employeeSchema>;

// ── Schedule Cycle ─────────────────────────────────────────────────────────

export const scheduleCycleSchema = z.object({
  name: z.string().min(1, 'กรุณากรอกชื่อรอบ'),
  startDate: z.string().min(1, 'กรุณาเลือกวันเริ่ม'),
  endDate: z.string().min(1, 'กรุณาเลือกวันสิ้นสุด'),
  notes: z.string().optional(),
});

export type ScheduleCycleInput = z.infer<typeof scheduleCycleSchema>;

// ── Schedule Entry ─────────────────────────────────────────────────────────

export const scheduleEntrySchema = z.object({
  cycleId: z.string().uuid(),
  employeeId: z.string().uuid(),
  workDate: z.string().min(1),
  status: z.enum(['working', 'day_off', 'leave']),
  shiftType: z.enum(['morning', 'afternoon', 'custom']).optional().nullable(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  leaveReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type ScheduleEntryInput = z.infer<typeof scheduleEntrySchema>;

// ── Time Entry ─────────────────────────────────────────────────────────────

export const timeEntrySchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().min(1),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบ HH:MM'),
  clockOut: z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบ HH:MM'),
  breakMinutes: z.coerce.number().int().min(0).default(0),
  notes: z.string().optional(),
});

export type TimeEntryInput = z.infer<typeof timeEntrySchema>;

// ── Payroll Cycle ──────────────────────────────────────────────────────────

export const payrollCycleSchema = z.object({
  name: z.string().min(1, 'กรุณากรอกชื่องวด'),
  workStartDate: z.string().min(1),
  workEndDate: z.string().min(1),
  payDate: z.string().min(1),
  notes: z.string().optional(),
});

export type PayrollCycleInput = z.infer<typeof payrollCycleSchema>;

// ── Payroll Deduction ─────────────────────────────────────────────────────

export const payrollDeductionSchema = z.object({
  payrollItemId: z.string().uuid(),
  type: z.enum(['advance', 'damage']),
  amount: z.coerce.number().positive('จำนวนเงินต้องมากกว่า 0'),
  reason: z.string().min(1, 'กรุณากรอกเหตุผล'),
  occurredDate: z.string().optional().nullable(),
});

export type PayrollDeductionInput = z.infer<typeof payrollDeductionSchema>;

// ── Payroll Absence ───────────────────────────────────────────────────────

export const payrollAbsenceSchema = z.object({
  payrollItemId: z.string().uuid(),
  type: z.enum(['absence', 'late']),
  occurredDate: z.string().min(1),
  lateMinutes: z.coerce.number().int().min(1).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type PayrollAbsenceInput = z.infer<typeof payrollAbsenceSchema>;

// ── Payroll Item Earnings ────────────────────────────────────────────────

export const payrollEarningsSchema = z.object({
  payrollItemId: z.string().uuid(),
  baseSalary: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0'),
  workDays: z.coerce.number().int('ต้องเป็นจำนวนเต็ม').min(0, 'ต้องมากกว่าหรือเท่ากับ 0'),
  incentivePerDay: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0'),
});

export type PayrollEarningsInput = z.infer<typeof payrollEarningsSchema>;

// ── Employee Incident (รายงานพนักงาน) ───────────────────────────────────

export const INCIDENT_TYPES = ['late', 'absence', 'damage', 'behavior'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const employeeIncidentSchema = z
  .object({
    employeeId: z.string().uuid(),
    type: z.enum(INCIDENT_TYPES),
    occurredDate: z.string().min(1, 'กรุณาเลือกวันที่'),
    lateMinutes: z.coerce.number().int('ต้องเป็นจำนวนเต็ม').min(1, 'ต้องมากกว่า 0').optional().nullable(),
    damageItemId: z.string().uuid().optional().nullable(),
    damageQuantity: z.coerce.number().int('ต้องเป็นจำนวนเต็ม').min(1, 'ต้องมากกว่า 0').optional().nullable(),
    description: z.string().trim().max(500, 'ไม่เกิน 500 ตัวอักษร').optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'late' && !data.lateMinutes) {
      ctx.addIssue({ code: 'custom', path: ['lateMinutes'], message: 'กรุณาระบุนาทีที่สาย' });
    }
    if (data.type === 'damage' && !data.damageItemId) {
      ctx.addIssue({ code: 'custom', path: ['damageItemId'], message: 'กรุณาเลือกรายการของเสียหาย' });
    }
    if (data.type === 'damage' && !data.damageQuantity) {
      ctx.addIssue({ code: 'custom', path: ['damageQuantity'], message: 'กรุณาระบุจำนวนชิ้นที่เสียหาย' });
    }
    if (data.type === 'behavior' && !data.description?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'กรุณากรอกรายละเอียด' });
    }
  });

export type EmployeeIncidentInput = z.infer<typeof employeeIncidentSchema>;

// ── Damage Item (แคตตาล็อกของเสียหาย) ───────────────────────────────────

export const damageItemSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อรายการ').max(100, 'ไม่เกิน 100 ตัวอักษร'),
  pricePerUnit: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0'),
});

export type DamageItemInput = z.infer<typeof damageItemSchema>;

// ── Mark Paid ────────────────────────────────────────────────────────────

export const markPaidSchema = z
  .object({
    payrollItemId: z.string().uuid(),
    paidMethod: z.enum(['cash', 'transfer', 'mixed']),
    paidCashAmount: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0').optional().nullable(),
    paidTransferAmount: z.coerce.number().min(0, 'ต้องมากกว่าหรือเท่ากับ 0').optional().nullable(),
    paymentProofUrl: z.string().optional().nullable(),
    paymentProofUrl2: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if ((data.paidMethod === 'cash' || data.paidMethod === 'mixed') && !data.paidCashAmount) {
      ctx.addIssue({ code: 'custom', path: ['paidCashAmount'], message: 'กรุณาระบุจำนวนเงินสด' });
    }
    if ((data.paidMethod === 'transfer' || data.paidMethod === 'mixed') && !data.paidTransferAmount) {
      ctx.addIssue({ code: 'custom', path: ['paidTransferAmount'], message: 'กรุณาระบุจำนวนเงินโอน' });
    }
  });

export type MarkPaidInput = z.infer<typeof markPaidSchema>;
