import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';

export const metadata = { title: 'ตั้งค่า — ร้านชาบู ERP' };

const ROLE_LABEL: Record<string, string> = {
  owner: 'เจ้าของ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

const POLL_INFO = [
  { page: 'KDS', interval: '3 วินาที' },
  { page: 'คิว (ลูกค้า)', interval: '10 วินาที' },
  { page: 'คิว (พนักงาน)', interval: '5 วินาที' },
  { page: 'จัดการโต๊ะ', interval: '5 วินาที' },
  { page: 'POS', interval: '5 วินาที' },
  { page: 'ออเดอร์ (ลูกค้า)', interval: '10 วินาที' },
  { page: 'แดชบอร์ด', interval: '60 วินาที' },
];

const PERMISSIONS: Record<string, string[]> = {
  owner: ['ทุกอย่าง'],
  cashier: ['ชำระเงิน', 'จัดการโต๊ะ', 'จัดการคิว', 'ดู KDS'],
  kitchen: ['ดู KDS', 'จัดการคิว', 'จัดการโต๊ะ'],
};

export default async function Settings() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings')) redirect('/login');

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">ตั้งค่า</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">ข้อมูลระบบ</h2>
        <Row label="เวอร์ชัน" value="Phase 9 — Production Ready" />
        <Row label="Framework" value="Next.js 15 App Router" />
        <Row label="Database" value="Neon Postgres + Drizzle ORM" />
        <Row label="Auth" value="Auth.js v5 (JWT)" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">สิทธิ์การใช้งาน</h2>
        {Object.entries(PERMISSIONS).map(([role, perms]) => (
          <Row key={role} label={ROLE_LABEL[role] ?? role} value={perms.join(', ')} />
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">รอบการ Poll ข้อมูล</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {POLL_INFO.map((p) => (
              <tr key={p.page}>
                <td className="py-2 text-slate-600">{p.page}</td>
                <td className="py-2 text-right tabular-nums font-medium text-slate-900">{p.interval}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
