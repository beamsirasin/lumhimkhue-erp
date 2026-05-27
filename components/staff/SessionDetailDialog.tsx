'use client';

import { useQuery } from '@tanstack/react-query';
import { format, differenceInMinutes } from 'date-fns';
import { th } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getSessionDetail } from '@/lib/actions/history';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

interface SessionDetailDialogProps {
  sessionId: string | null;
  onClose: () => void;
}

export function SessionDetailDialog({ sessionId, onClose }: SessionDetailDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: () => getSessionDetail(sessionId!).then((r) => (r.ok ? r.data : null)),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  return (
    <Dialog open={!!sessionId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>รายละเอียด Session</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-slate-400">กำลังโหลด...</div>
        )}

        {!isLoading && !data && (
          <div className="py-8 text-center text-sm text-slate-400">ไม่พบข้อมูล</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Session header */}
            <div className="rounded-lg bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">โต๊ะ</span>
                <span className="font-semibold text-slate-900">
                  {data.session.table.label}
                  {data.session.table.zone !== 'ทั่วไป' && (
                    <span className="ml-1 font-normal text-slate-400">({data.session.table.zone})</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">เริ่มต้น</span>
                <span className="tabular-nums text-slate-900">
                  {format(new Date(data.session.startedAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                </span>
              </div>
              {data.session.closedAt && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">สิ้นสุด</span>
                    <span className="tabular-nums text-slate-900">
                      {format(new Date(data.session.closedAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">เวลาที่ใช้</span>
                    <span className="tabular-nums text-slate-900">
                      {(() => {
                        const min = differenceInMinutes(
                          new Date(data.session.closedAt!),
                          new Date(data.session.startedAt),
                        );
                        return min >= 60
                          ? `${Math.floor(min / 60)} ชม. ${min % 60} น.`
                          : `${min} น.`;
                      })()}
                    </span>
                  </div>
                </>
              )}
              {data.session.notes && (
                <div className="flex justify-between">
                  <span className="text-slate-500">หมายเหตุ</span>
                  <span className="text-slate-900">{data.session.notes}</span>
                </div>
              )}
            </div>

            {/* Guests */}
            {data.session.guests.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  ผู้เข้าใช้บริการ
                </p>
                <div className="space-y-1.5">
                  {data.session.guests.map((g) => (
                    <div key={g.id} className="flex justify-between text-sm">
                      <span className="text-slate-700">
                        {g.pricingTier.name} ×{g.quantity}
                      </span>
                      <span className="tabular-nums font-medium text-slate-900">
                        ฿{(Number(g.pricingTier.price) * g.quantity).toLocaleString('th-TH')}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-100 pt-1.5 text-sm font-semibold">
                    <span className="text-slate-700">รวม</span>
                    <span className="tabular-nums text-slate-900">
                      ฿{data.session.guests
                        .reduce((s, g) => s + Number(g.pricingTier.price) * g.quantity, 0)
                        .toLocaleString('th-TH')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Payment */}
            {data.session.payment && (
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  การชำระเงิน
                </p>
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">ยอดชำระ</span>
                    <span className="tabular-nums font-bold text-slate-900">
                      ฿{Number(data.session.payment.total).toLocaleString('th-TH')}
                    </span>
                  </div>
                  {Number(data.session.payment.discount) > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">ส่วนลด</span>
                      <span className="tabular-nums text-green-700">
                        −฿{Number(data.session.payment.discount).toLocaleString('th-TH')}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">วิธีชำระ</span>
                    <span className="text-slate-700">
                      {METHOD_LABEL[data.session.payment.paymentMethod] ?? data.session.payment.paymentMethod}
                    </span>
                  </div>
                  {Number(data.session.payment.changeAmount) > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">เงินทอน</span>
                      <span className="tabular-nums text-slate-700">
                        ฿{Number(data.session.payment.changeAmount).toLocaleString('th-TH')}
                      </span>
                    </div>
                  )}
                  {data.session.payment.notes && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">หมายเหตุ</span>
                      <span className="text-slate-700">{data.session.payment.notes}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Orders */}
            {data.orders.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  รายการอาหาร ({data.orders.flatMap((o) => o.items).length} รายการ)
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {data.orders.flatMap((o) =>
                    o.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-xs text-slate-700">
                        <span>
                          {item.menuItem.name}
                          {item.notes && (
                            <span className="ml-1 text-slate-400">({item.notes})</span>
                          )}
                          {item.status === 'cancelled' && (
                            <span className="ml-1 text-red-400">[ยกเลิก]</span>
                          )}
                        </span>
                        <div className="flex gap-2 shrink-0">
                          <span className="tabular-nums text-slate-500">×{item.quantity}</span>
                          {!item.menuItem.isBuffet && (
                            <span className="tabular-nums text-red-600">
                              +฿{(Number(item.menuItem.extraPrice) * item.quantity).toLocaleString('th-TH')}
                            </span>
                          )}
                        </div>
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
