import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getStoreSettings } from '@/lib/actions/store';
import { StoreSettingsForm } from '@/components/admin/StoreSettingsForm';

export const metadata = { title: 'ตั้งค่า — ร้านชาบู ERP' };

export default async function Settings() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings')) redirect('/login');

  const result = await getStoreSettings();
  const settings = result.ok ? result.data : null;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">ตั้งค่า</h1>

      {settings && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">ข้อมูลร้านและหัวบิล</h2>
          <StoreSettingsForm initialData={settings} />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">ข้อมูลระบบ</h2>
        <Row label="เวอร์ชัน" value="Phase 9 — Production Ready" />
        <Row label="Framework" value="Next.js 15 App Router" />
        <Row label="Database" value="Neon Postgres + Drizzle ORM" />
        <Row label="Auth" value="Auth.js v5 (JWT)" />
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
