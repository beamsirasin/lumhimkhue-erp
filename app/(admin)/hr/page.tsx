import Link from 'next/link';
import { getHrDashboardStats } from '@/lib/actions/hr';
import { Users, Clock, Wallet, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BadgeVariant } from '@/components/ui/status-badge';

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00'), 'd MMM yy', { locale: th }); }
  catch { return d; }
}

const STATUS_LABELS: Record<string, string> = { draft: 'ร่าง', finalized: 'อนุมัติ', paid: 'จ่ายแล้ว' };
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'neutral', finalized: 'info', paid: 'success',
};

export default async function HrDashboardPage() {
  const stats = await getHrDashboardStats();

  return (
    <div className="page-shell">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">ภาพรวม HR</h1>
      </div>

      {/* KPI Cards */}
      <StatCardGrid cols={4}>
        <StatCard
          label="พนักงานประจำ (active)"
          value={stats.fullTimeCount}
          unit="คน"
          icon={<Users className="size-4" />}
          accent="info"
        />
        <StatCard
          label="พาร์ทไทม์ (active)"
          value={stats.partTimeCount}
          unit="คน"
          icon={<Clock className="size-4" />}
          accent="default"
        />
        <StatCard
          label="รอบจ่ายค้างอยู่"
          value={stats.unpaidCycles}
          unit="รอบ"
          subLabel="รอดำเนินการ"
          icon={<Wallet className="size-4" />}
          accent={stats.unpaidCycles > 0 ? 'warning' : 'default'}
        />
        <div className="section-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            ลิงก์ด่วน
          </p>
          <div className="space-y-1.5">
            {[
              { href: '/hr/employees', label: 'จัดการพนักงาน' },
              { href: '/hr/schedule', label: 'ตารางงาน' },
              { href: '/hr/payroll', label: 'เงินเดือน' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center justify-between text-sm text-primary hover:text-primary/80 transition-colors"
              >
                {label}
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      </StatCardGrid>

      {/* Recent payroll cycles */}
      {stats.recentCycles.length > 0 && (
        <SectionCard title="รอบจ่ายล่าสุด" noPadding>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ชื่องวด</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ช่วงงาน</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">สถานะ</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.recentCycles.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {fmtDate(c.workStartDate)} – {fmtDate(c.workEndDate)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge
                      label={STATUS_LABELS[c.status] ?? c.status}
                      variant={STATUS_VARIANT[c.status] ?? 'neutral'}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/hr/payroll/${c.id}`}
                      className="flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronRight className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}
    </div>
  );
}
