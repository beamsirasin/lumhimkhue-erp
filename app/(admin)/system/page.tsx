import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';

export const metadata = { title: 'ข้อมูลระบบ — ร้านชาบู ERP' };

export default async function SystemPage() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings')) redirect('/login');

  return (
    <AppShell>
      <PageHeader title="ข้อมูลระบบ" subtitle="เวอร์ชัน framework และ stack" />
      <div className="max-w-xl">
        <DataCard title="Stack">
          <div className="space-y-3">
            <Row label="เวอร์ชัน"     value="Phase 12 — V2 UI Revamp" />
            <Row label="Framework"    value="Next.js 16 App Router" />
            <Row label="Database"     value="Neon Postgres + Drizzle ORM" />
            <Row label="Auth"         value="Auth.js v5 (JWT)" />
            <Row label="Styling"      value="Tailwind CSS 4 + shadcn/ui" />
            <Row label="State"        value="Zustand + TanStack Query v5" />
          </div>
        </DataCard>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
