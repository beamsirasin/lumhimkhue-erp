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

// ── Mark Paid ────────────────────────────────────────────────────────────

export const markPaidSchema = z.object({
  payrollItemId: z.string().uuid(),
  paidMethod: z.enum(['cash', 'transfer']),
  paymentProofUrl: z.string().optional().nullable(),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;
