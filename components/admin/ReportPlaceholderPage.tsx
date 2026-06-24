import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, Clock } from 'lucide-react';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';

interface PlannedMetric {
  label: string;
  description: string;
}

interface ReportPlaceholderPageProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconTone: 'info' | 'success' | 'warning';
  description: string;
  dataNote: string;
  plannedMetrics: PlannedMetric[];
}

const ICON_TONE_CLASSES: Record<ReportPlaceholderPageProps['iconTone'], string> = {
  info: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border border-[var(--status-info-border)]',
  success: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border border-[var(--status-success-border)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border border-[var(--status-warning-border)]',
};

export function ReportPlaceholderPage({
  title,
  subtitle,
  icon: Icon,
  iconTone,
  description,
  dataNote,
  plannedMetrics,
}: ReportPlaceholderPageProps) {
  return (
    <AppShell>
      <PageHeader
        title={title}
        subtitle={subtitle}
        breadcrumb={
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-3.5" />
            รายงาน
          </Link>
        }
      />

      <div className="mt-8 space-y-6">
        {/* Status card */}
        <DataCard>
          <div className="flex flex-col items-center py-8 text-center sm:py-12">
            <div className={`flex size-20 items-center justify-center rounded-2xl ${ICON_TONE_CLASSES[iconTone]}`}>
              <Icon className="size-10" />
            </div>

            <div className="mt-6 max-w-sm">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1 text-xs font-semibold text-[var(--status-warning-fg)]">
                <Clock className="size-3.5" />
                เร็วๆ นี้
              </div>
              <h2 className="mt-4 text-xl font-semibold text-foreground">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>

            <div className="mt-6 max-w-md rounded-xl border border-border bg-[var(--surface-2)] px-5 py-4 text-left">
              <p className="text-xs font-semibold text-muted-foreground">ข้อมูลที่จะใช้</p>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground">{dataNote}</p>
            </div>
          </div>
        </DataCard>

        {/* Planned metrics */}
        {plannedMetrics.length > 0 && (
          <DataCard title="ตัวชี้วัดที่วางแผนไว้" subtitle="จะปรากฏเมื่อรายงานนี้พร้อมใช้งาน">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plannedMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-lg border border-dashed border-border bg-[var(--surface-2)] p-4 opacity-60"
                >
                  <p className="text-sm font-semibold text-foreground">{metric.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.description}</p>
                </div>
              ))}
            </div>
          </DataCard>
        )}
      </div>
    </AppShell>
  );
}
