'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Banknote,
  ChefHat,
  Construction,
  LayoutGrid,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

type ReportStatus = 'active' | 'soon' | 'disabled';
type ReportTone = 'primary' | 'info' | 'success' | 'warning' | 'purple' | 'neutral';

interface ReportCategory {
  id: string;
  title: string;
  description: string;
  note?: string;
  icon: React.ElementType;
  href: string | null;
  status: ReportStatus;
  tone: ReportTone;
}

const CATEGORIES: ReportCategory[] = [
  {
    id: 'revenue',
    title: 'รายได้',
    description:
      'สรุปรายได้รวม ยอดรับจริงแยกตามช่องทางชำระและบัญชีรับเงิน ตารางรายวัน และส่งออก CSV',
    icon: Banknote,
    href: '/reports/revenue',
    status: 'active',
    tone: 'primary',
  },
  {
    id: 'tables',
    title: 'โต๊ะ',
    description:
      'วิเคราะห์การเปิด-ปิดโต๊ะ รอบโต๊ะ จำนวนลูกค้า เวลานั่งเฉลี่ย และรายได้ต่อโต๊ะ',
    note: 'รายงานโต๊ะจะใช้ข้อมูลจาก session เปิด/ปิดโต๊ะ เพื่อสรุปรอบโต๊ะและเวลานั่งโดยเฉลี่ย',
    icon: LayoutGrid,
    href: '/reports/tables',
    status: 'soon',
    tone: 'info',
  },
  {
    id: 'queue',
    title: 'คิว',
    description:
      'วิเคราะห์คิวลูกค้า จำนวนที่รับเข้า ออกบิล ข้าม ยกเลิก เวลารอเฉลี่ย และน้ำซุปที่เลือก',
    icon: Users,
    href: '/reports/queue',
    status: 'active',
    tone: 'success',
  },
  {
    id: 'kitchen',
    title: 'ครัว',
    description:
      'วิเคราะห์ออเดอร์ครัว รายการเสร็จ รายการค้าง และเมนูยอดนิยมจากระบบ KDS',
    note: 'รายงานครัวจะรวม: ออเดอร์เข้าครัว รายการเสร็จ และเวลาทำเฉลี่ย',
    icon: ChefHat,
    href: '/reports/kitchen',
    status: 'soon',
    tone: 'warning',
  },
  {
    id: 'audit',
    title: 'ตรวจสอบ',
    description:
      'บันทึกการกระทำของผู้ใช้ การปรับปรุงชำระเงิน รายงานกะแคชเชียร์ และประวัติการตรวจสอบ',
    icon: ShieldCheck,
    href: '/reports/audit',
    status: 'active',
    tone: 'purple',
  },
  {
    id: 'food-cost',
    title: 'ต้นทุนอาหาร',
    description:
      'คำนวณต้นทุนอาหารจากสูตร วัตถุดิบ และการสั่งซื้อจริง พร้อมกราฟแนวโน้มรายวัน',
    note: 'ต้องเชื่อมระบบสต็อก สูตรอาหาร และบัญชีต้นทุนก่อนจึงจะแสดงผลที่ถูกต้อง',
    icon: BarChart3,
    href: null,
    status: 'disabled',
    tone: 'neutral',
  },
];

const ICON_TONE_CLASSES: Record<ReportTone, string> = {
  primary:
    'bg-primary text-primary-foreground',
  info:
    'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border border-[var(--status-info-border)]',
  success:
    'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border border-[var(--status-success-border)]',
  warning:
    'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border border-[var(--status-warning-border)]',
  purple:
    'bg-[var(--status-purple-bg)] text-[var(--status-purple-fg)] border border-[var(--status-purple-border)]',
  neutral:
    'bg-[var(--surface-2)] text-muted-foreground border border-border',
};

const BADGE_CLASSES: Record<ReportStatus, string> = {
  active:
    'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border border-[var(--status-success-border)]',
  soon:
    'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border border-[var(--status-warning-border)]',
  disabled:
    'bg-[var(--surface-2)] text-muted-foreground border border-border',
};

const BADGE_LABELS: Record<ReportStatus, string> = {
  active: 'พร้อมใช้งาน',
  soon: 'เร็วๆ นี้',
  disabled: 'ยังไม่พร้อม',
};

const ACTION_LABEL_CLASSES: Record<ReportTone, string> = {
  primary: 'text-primary',
  info: 'text-[var(--status-info-fg)]',
  success: 'text-[var(--status-success-fg)]',
  warning: 'text-[var(--status-warning-fg)]',
  purple: 'text-[var(--status-purple-fg)]',
  neutral: 'text-muted-foreground',
};

function ReportCategoryCard({ category }: { category: ReportCategory }) {
  const Icon = category.icon;
  const isDisabled = category.status === 'disabled';
  const isSoon = category.status === 'soon';

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col rounded-xl border border-border bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card)] transition-all duration-200',
        !isDisabled && 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]',
        isDisabled && 'opacity-55 cursor-not-allowed select-none',
      )}
    >
      {/* Icon + badge row */}
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-xl',
            ICON_TONE_CLASSES[category.tone],
          )}
        >
          <Icon className="size-6" />
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider',
            BADGE_CLASSES[category.status],
          )}
        >
          {BADGE_LABELS[category.status]}
        </span>
      </div>

      {/* Title + description */}
      <div className="mt-4 flex-1">
        <h3 className="text-base font-semibold text-foreground">{category.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {category.description}
        </p>
        {category.note && (
          <p
            className={cn(
              'mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed',
              isDisabled
                ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
                : 'border-border bg-[var(--surface-2)] text-muted-foreground',
            )}
          >
            {category.note}
          </p>
        )}
      </div>

      {/* Action footer */}
      <div className="mt-5 border-t border-border pt-4">
        {isDisabled ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Construction className="size-3.5" />
            อยู่ระหว่างพัฒนา
          </span>
        ) : isSoon ? (
          <span className="text-xs text-muted-foreground">
            พร้อมสำหรับ phase ถัดไป
          </span>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-sm font-medium transition-transform',
              ACTION_LABEL_CLASSES[category.tone],
            )}
          >
            เปิดรายงาน
            <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
          </span>
        )}
      </div>
    </div>
  );

  if (isDisabled || !category.href) return inner;

  return (
    <Link href={category.href} className="block h-full">
      {inner}
    </Link>
  );
}

export function ReportHub() {
  return (
    <AppShell>
      <PageHeader
        title="รายงาน"
        subtitle="ศูนย์รวมรายงานรายได้ การปฏิบัติงาน และการตรวจสอบของร้าน"
      />

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((category) => (
          <ReportCategoryCard key={category.id} category={category} />
        ))}
      </div>
    </AppShell>
  );
}
