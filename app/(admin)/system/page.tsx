import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';

export const metadata = { title: 'ข้อมูลระบบ — ร้านชาบู ERP' };

export default async function SystemPage() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings')) redirect('/login');

  return (
    <div className="p-6 max-w-xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">ข้อมูลระบบ</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <Row label="เวอร์ชัน"     value="Phase 9 — Production Ready" />
        <Row label="Framework"    value="Next.js 16 App Router" />
        <Row label="Database"     value="Neon Postgres + Drizzle ORM" />
        <Row label="Auth"         value="Auth.js v5 (JWT)" />
        <Row label="Styling"      value="Tailwind CSS 4 + shadcn/ui" />
        <Row label="State"        value="Zustand + TanStack Query v5" />
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
