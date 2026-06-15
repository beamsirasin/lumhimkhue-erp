import Link from 'next/link';
import { getHrDashboardStats } from '@/lib/actions/hr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Clock, Wallet, Calendar, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00'), 'd MMM yy', { locale: th }); }
  catch { return d; }
}

const STATUS_LABELS: Record<string, string> = { draft: 'ร่าง', finalized: 'อนุมัติ', paid: 'จ่ายแล้ว' };
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline', finalized: 'secondary', paid: 'default',
};

export default async function HrDashboardPage() {
  const stats = await getHrDashboardStats();

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold text-foreground">ภาพรวม HR</h2>

      {/* Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="size-4" />
              ประจำ (active)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{stats.fullTimeCount}</p>
            <p className="text-xs text-muted-foreground">คน</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="size-4" />
              พาร์ทไทม์ (active)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{stats.partTimeCount}</p>
            <p className="text-xs text-muted-foreground">คน</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="size-4" />
              รอบจ่ายค้างอยู่
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{stats.unpaidCycles}</p>
            <p className="text-xs text-muted-foreground">รอบ (draft)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="size-4" />
              ลิงก์ด่วน
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {[
              { href: '/hr/employees', label: 'จัดการพนักงาน' },
              { href: '/hr/schedule', label: 'ตารางงาน' },
              { href: '/hr/payroll', label: 'เงินเดือน' },
            ].map(({ href, label }) => (
              <Link key={href} href={href} className="flex items-center justify-between text-xs text-blue-600 hover:underline">
                {label} <ChevronRight className="size-3" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent payroll cycles */}
      {stats.recentCycles.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">รอบจ่ายล่าสุด</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">ชื่องวด</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">ช่วงงาน</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">สถานะ</th>
                  <th className="px-4 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {stats.recentCycles.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium text-foreground">{c.name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {fmtDate(c.workStartDate)} – {fmtDate(c.workEndDate)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/hr/payroll/${c.id}`} className="text-muted-foreground hover:text-foreground">
                        <ChevronRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
