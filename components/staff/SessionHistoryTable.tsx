'use client';

import { useMemo, useState } from 'react';
import { differenceInMinutes, format } from 'date-fns';
import { th } from 'date-fns/locale';
import { ChevronRight, Timer, UsersRound } from 'lucide-react';
import type { SessionHistoryRow } from '@/lib/actions/history';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SessionDetailDialog } from './SessionDetailDialog';

interface SessionHistoryTableProps {
  rows: SessionHistoryRow[];
  date: string;
}

const LINK_COLORS: { border: string; badge: string }[] = [
  { border: '#8b5cf6', badge: 'bg-violet-100 text-violet-700' },
  { border: '#f97316', badge: 'bg-orange-100 text-orange-700' },
  { border: '#14b8a6', badge: 'bg-teal-100 text-teal-700' },
  { border: '#ec4899', badge: 'bg-pink-100 text-pink-700' },
  { border: '#d97706', badge: 'bg-amber-100 text-amber-700' },
  { border: '#06b6d4', badge: 'bg-cyan-100 text-cyan-700' },
];

export function SessionHistoryTable({ rows, date }: SessionHistoryTableProps) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);

  const totalGuests = rows.reduce((s, r) => s + r.guestCount, 0);
  const totalAdults = rows.reduce((s, r) => s + r.adultCount, 0);
  const totalChildren = rows.reduce((s, r) => s + r.childCount, 0);
  const totalToddlers = rows.reduce((s, r) => s + r.toddlerCount, 0);
  const totalStaff = rows.reduce((s, r) => s + r.staffCount, 0);
  const totalStaffGuests = rows.reduce((s, r) => s + r.staffGuestCount, 0);

  const guestBreakdown = [
    totalAdults > 0 && `ผู้ใหญ่ ${totalAdults}`,
    totalChildren > 0 && `เด็ก ${totalChildren}`,
    totalToddlers > 0 && `เด็กเล็ก ${totalToddlers}`,
    totalStaff > 0 && `พนักงาน ${totalStaff}`,
    totalStaffGuests > 0 && `พนักงานพา ${totalStaffGuests}`,
  ].filter(Boolean).join(' · ');

  const linkInfo = useMemo(() => {
    const map = new Map<string, { border: string; badge: string; peers: string[]; isSplit: boolean; seqIndex: number; groupSize: number }>();
    let colorIdx = 0;

    const primariesWithChildren = new Set(
      rows.filter((r) => r.parentSessionId).map((r) => r.parentSessionId!),
    );

    for (const primaryId of primariesWithChildren) {
      const primary = rows.find((r) => r.sessionId === primaryId);
      const children = rows.filter((r) => r.parentSessionId === primaryId);
      const group = [...(primary ? [primary] : []), ...children];
      if (group.length < 2) continue;

      const isSplit = group.every((r) => r.tableLabel === group[0].tableLabel);
      const color = LINK_COLORS[colorIdx % LINK_COLORS.length];
      colorIdx++;

      group.forEach((row, idx) => {
        const peers = group
          .filter((r) => r.sessionId !== row.sessionId)
          .map((r) => r.tableLabel);
        map.set(row.sessionId, { ...color, peers, isSplit, seqIndex: idx + 1, groupSize: group.length });
      });
    }

    return map;
  }, [rows]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 pb-4">
        <StatCardGrid cols={2}>
          <StatCard label="จำนวน session" value={rows.length} icon={<Timer className="size-4" />} />
          <StatCard
            label="ผู้เข้าใช้รวม"
            value={totalGuests}
            unit="คน"
            subLabel={guestBreakdown || 'ยังไม่มีข้อมูลผู้เข้าใช้'}
            icon={<UsersRound className="size-4" />}
            accent="info"
          />
        </StatCardGrid>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataCard title="รายการ Session" subtitle={`${format(new Date(date), 'd MMMM yyyy', { locale: th })} · ${rows.length} รายการ`} noPadding>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Timer className="size-5" />}
              title="ไม่มีข้อมูล Session"
              description={`ไม่พบข้อมูลในวันที่ ${format(new Date(date), 'd MMMM yyyy', { locale: th })}`}
              size="lg"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">โต๊ะ</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">เริ่ม</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">สิ้นสุด</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">เวลา</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">ผู้เข้าใช้</TableHead>
                  <TableHead className="px-4 py-3" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const durationMin = row.closedAt
                    ? differenceInMinutes(new Date(row.closedAt), new Date(row.startedAt))
                    : null;
                  const isOpen = row.status !== 'closed';
                  const link = linkInfo.get(row.sessionId);

                  return (
                    <TableRow
                      key={row.sessionId}
                      className="cursor-pointer border-border/60 hover:bg-muted/30"
                      onClick={() => setDetailSessionId(row.sessionId)}
                    >
                      <TableCell className="py-3 pr-4">
                        <div className="flex items-center gap-0">
                          <div
                            className="mr-3 w-1 self-stretch rounded-r-full shrink-0"
                            style={{ backgroundColor: link && !link.isSplit ? link.border : 'transparent' }}
                          />
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-foreground">
                              {row.tableLabel}
                              {row.zone !== 'ทั่วไป' && (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  ({row.zone})
                                </span>
                              )}
                            </span>
                            {link && !link.isSplit && (
                              <span className={`self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${link.badge}`}>
                                {`⊞ ${link.peers.join(', ')}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 tabular-nums text-muted-foreground">
                        {format(new Date(row.startedAt), 'HH:mm', { locale: th })}
                      </TableCell>
                      <TableCell className="px-4 py-3 tabular-nums text-muted-foreground">
                        {row.closedAt ? (
                          format(new Date(row.closedAt), 'HH:mm', { locale: th })
                        ) : isOpen ? (
                          <StatusBadge label="ยังเปิดอยู่" variant="success" dot />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                        {durationMin !== null
                          ? durationMin >= 60
                            ? `${Math.floor(durationMin / 60)}ชม. ${durationMin % 60}น.`
                            : `${durationMin}น.`
                          : '—'}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                        {row.guestCount === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {row.adultCount > 0 && <div>ผู้ใหญ่ {row.adultCount}</div>}
                            {row.childCount > 0 && <div>เด็ก {row.childCount}</div>}
                            {row.toddlerCount > 0 && <div>เด็กเล็ก {row.toddlerCount}</div>}
                            {row.staffCount > 0 && <div>พนักงาน {row.staffCount}</div>}
                            {row.staffGuestCount > 0 && <div>พนักงานพา {row.staffGuestCount}</div>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DataCard>
      </div>

      <SessionDetailDialog
        sessionId={detailSessionId}
        onClose={() => setDetailSessionId(null)}
      />
    </div>
  );
}
