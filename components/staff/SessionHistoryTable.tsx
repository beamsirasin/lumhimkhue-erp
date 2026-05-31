'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { differenceInMinutes } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import type { SessionHistoryRow } from '@/lib/actions/history';
import { SessionDetailDialog } from './SessionDetailDialog';

interface SessionHistoryTableProps {
  rows: SessionHistoryRow[];
  date: string;
}

const LINK_COLORS: { border: string; badge: string }[] = [
  { border: '#8b5cf6', badge: 'bg-violet-100 text-violet-700' },
  { border: '#f97316', badge: 'bg-orange-100 text-orange-700' },
  { border: '#14b8a6', badge: 'bg-teal-100 text-teal-700'    },
  { border: '#ec4899', badge: 'bg-pink-100 text-pink-700'    },
  { border: '#d97706', badge: 'bg-amber-100 text-amber-700'  },
  { border: '#06b6d4', badge: 'bg-cyan-100 text-cyan-700'    },
];

export function SessionHistoryTable({ rows, date }: SessionHistoryTableProps) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);

  const totalGuests      = rows.reduce((s, r) => s + r.guestCount,      0);
  const totalAdults      = rows.reduce((s, r) => s + r.adultCount,      0);
  const totalChildren    = rows.reduce((s, r) => s + r.childCount,      0);
  const totalToddlers    = rows.reduce((s, r) => s + r.toddlerCount,    0);
  const totalStaff       = rows.reduce((s, r) => s + r.staffCount,      0);
  const totalStaffGuests = rows.reduce((s, r) => s + r.staffGuestCount, 0);

  // Build link groups: sessionId → { color, peerLabels }
  const linkInfo = useMemo(() => {
    const map = new Map<string, { border: string; badge: string; peers: string[] }>();
    let colorIdx = 0;

    // Find all primary sessions that have at least one secondary
    const primariesWithChildren = new Set(
      rows.filter((r) => r.parentSessionId).map((r) => r.parentSessionId!),
    );

    for (const primaryId of primariesWithChildren) {
      const primary = rows.find((r) => r.sessionId === primaryId);
      const children = rows.filter((r) => r.parentSessionId === primaryId);
      const group = [...(primary ? [primary] : []), ...children];
      if (group.length < 2) continue;

      const color = LINK_COLORS[colorIdx % LINK_COLORS.length];
      colorIdx++;

      for (const row of group) {
        const peers = group
          .filter((r) => r.sessionId !== row.sessionId)
          .map((r) => r.tableLabel);
        map.set(row.sessionId, { ...color, peers });
      }
    }

    return map;
  }, [rows]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary — fixed */}
      <div className="shrink-0 grid grid-cols-2 gap-3 p-6 pb-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">จำนวน session</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">ผู้เข้าใช้รวม</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totalGuests} คน</p>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            {[
              totalAdults      > 0 && `ผู้ใหญ่ ${totalAdults}`,
              totalChildren    > 0 && `เด็ก ${totalChildren}`,
              totalToddlers    > 0 && `เด็กเล็ก ${totalToddlers}`,
              totalStaff       > 0 && `พนักงาน ${totalStaff}`,
              totalStaffGuests > 0 && `พนักงานพา ${totalStaffGuests}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* Table — scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">
              ไม่มีข้อมูลในวันที่ {format(new Date(date), 'd MMMM yyyy', { locale: th })}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">โต๊ะ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">เริ่ม</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">สิ้นสุด</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">เวลา</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ผู้เข้าใช้</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const durationMin = row.closedAt
                    ? differenceInMinutes(new Date(row.closedAt), new Date(row.startedAt))
                    : null;
                  const isOpen = row.status !== 'closed';
                  const link   = linkInfo.get(row.sessionId);

                  return (
                    <tr
                      key={row.sessionId}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setDetailSessionId(row.sessionId)}
                    >
                      {/* Table label + link indicator */}
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-0">
                          {/* Colored left accent bar for linked groups */}
                          <div
                            className="w-1 self-stretch rounded-r-full mr-3 shrink-0"
                            style={{ backgroundColor: link ? link.border : 'transparent' }}
                          />
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-slate-900">
                              {row.tableLabel}
                              {row.zone !== 'ทั่วไป' && (
                                <span className="ml-1 text-xs font-normal text-slate-400">
                                  ({row.zone})
                                </span>
                              )}
                            </span>
                            {link && link.peers.length > 0 && (
                              <span
                                className={`self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${link.badge}`}
                              >
                                ⊞ {link.peers.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 tabular-nums text-slate-600">
                        {format(new Date(row.startedAt), 'HH:mm', { locale: th })}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">
                        {row.closedAt
                          ? format(new Date(row.closedAt), 'HH:mm', { locale: th })
                          : isOpen
                            ? <span className="text-green-600 text-xs font-medium">ยังเปิดอยู่</span>
                            : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-500 text-xs">
                        {durationMin !== null
                          ? durationMin >= 60
                            ? `${Math.floor(durationMin / 60)}ชม. ${durationMin % 60}น.`
                            : `${durationMin}น.`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {row.guestCount === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {row.adultCount      > 0 && <div>ผู้ใหญ่ {row.adultCount}</div>}
                            {row.childCount      > 0 && <div>เด็ก {row.childCount}</div>}
                            {row.toddlerCount    > 0 && <div>เด็กเล็ก {row.toddlerCount}</div>}
                            {row.staffCount      > 0 && <div>พนักงาน {row.staffCount}</div>}
                            {row.staffGuestCount > 0 && <div>พนักงานพา {row.staffGuestCount}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="size-4 text-slate-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <SessionDetailDialog
        sessionId={detailSessionId}
        onClose={() => setDetailSessionId(null)}
      />
    </div>
  );
}
