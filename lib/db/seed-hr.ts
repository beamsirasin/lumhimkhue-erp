import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function seedHr() {
  console.log('🌱 Seeding HR data...');

  // ── hrSettings (singleton) ────────────────────────────────────────────────
  const existing = await db.select().from(schema.hrSettings).limit(1);
  if (existing.length === 0) {
    await db.insert(schema.hrSettings).values({
      id: 'singleton',
      absenceRatePerDay: '0',
      lateRatePerMinute: '0',
      morningShiftStart: '10:00',
      morningShiftEnd: '18:00',
      afternoonShiftStart: '14:00',
      afternoonShiftEnd: '22:00',
      defaultBreakMinutes: 0,
    });
    console.log('✅ hrSettings created (rates = 0 — ตั้งค่าเองใน /hr/settings)');
  } else {
    console.log('⚠️  hrSettings already exists — skipped');
  }

  // ── Sample employees ─────────────────────────────────────────────────────
  const existingEmp = await db.select().from(schema.employees).limit(1);
  if (existingEmp.length > 0) {
    console.log('⚠️  Employees already exist — skipped');
    console.log('\n🎉 HR seed done!');
    return;
  }

  await db.insert(schema.employees).values([
    {
      firstName: 'สมศรี',
      lastName: 'ใจดี',
      phone: '081-111-1111',
      bankName: 'กสิกรไทย',
      bankAccountNumber: '123-4-56789-0',
      type: 'full_time',
      status: 'active',
      baseSalaryPerCycle: '9000.00',
      incentivePerDay: '30.00',
      hourlyRate: null,
      startDate: '2024-01-01',
      notes: 'พนักงานบริการ',
    },
    {
      firstName: 'วิชัย',
      lastName: 'สมบูรณ์',
      phone: '082-222-2222',
      bankName: 'ไทยพาณิชย์',
      bankAccountNumber: '456-7-89012-3',
      type: 'full_time',
      status: 'active',
      baseSalaryPerCycle: '10000.00',
      incentivePerDay: '30.00',
      hourlyRate: null,
      startDate: '2023-06-01',
      notes: 'พนักงานครัว',
    },
    {
      firstName: 'นิดา',
      lastName: 'มีสุข',
      phone: '083-333-3333',
      bankName: 'กรุงไทย',
      bankAccountNumber: '789-0-12345-6',
      type: 'part_time',
      status: 'active',
      baseSalaryPerCycle: null,
      incentivePerDay: '0',
      hourlyRate: '65.00',
      startDate: '2024-03-15',
      notes: 'พาร์ทไทม์ วันหยุดสุดสัปดาห์',
    },
  ]);
  console.log('✅ Sample employees created (2 ประจำ, 1 พาร์ทไทม์)');

  console.log('\n🎉 HR seed done!');
  console.log('\nSample employees:');
  console.log('  สมศรี ใจดี     — ประจำ ฿9,000/รอบ + ฿30 incentive/วัน');
  console.log('  วิชัย สมบูรณ์  — ประจำ ฿10,000/รอบ + ฿30 incentive/วัน');
  console.log('  นิดา มีสุข     — พาร์ทไทม์ ฿65/ชม.');
}

seedHr().catch((err) => {
  console.error('❌ HR seed failed:', err);
  process.exit(1);
});
