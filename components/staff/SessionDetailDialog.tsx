'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { format, differenceInMinutes } from 'date-fns';
import { th } from 'date-fns/locale';
import { Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getSessionDetail, deletePaymentRecord, reopenSessionForPayment } from '@/lib/actions/history';

const METHOD_LABEL: Record<string, string> = {
  cash:         'เงินสด',
  cash_qr:      'เงินสด + QR',
  qr_promptpay: 'QR PromptPay',
  transfer:     'โอนเงิน',
  card:         'บัตรเครดิต',
};

interface SessionDetailDialogProps {
  sessionId: string | null;
  onClose: () => void;
  showPayment?: boolean;
}

export function SessionDetailDialog({ sessionId, onClose, showPayment = false }: SessionDetailDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: () => getSessionDetail(sessionId!).then((r) => (r.ok ? r.data : null)),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  const [delConfirm,  setDelConfirm]  = useState(false);
  const [editConfirm, setEditConfirm] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDelConfirm(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditConfirm(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitting(false);
  }, [sessionId]);

  async function handleDelete() {
    if (!data?.session.payment) return;
    setSubmitting(true);
    const result = await deletePaymentRecord({ paymentId: data.session.payment.id });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success('ลบประวัติการชำระเงินแล้ว');
    queryClient.invalidateQueries({ queryKey: ['payment-history'] });
    queryClient.invalidateQueries({ queryKey: ['session-history'] });
    onClose();
  }

  async function handleReopen() {
    if (!data?.session.payment) return;
    setSubmitting(true);
    const result = await reopenSessionForPayment({ paymentId: data.session.payment.id });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success('เปิดบิลใหม่แล้ว — กำลังไปหน้า POS');
    queryClient.invalidateQueries({ queryKey: ['payment-history'] });
    queryClient.invalidateQueries({ queryKey: ['pos-sessions'] });
    onClose();
    router.push('/pos');
  }

  return (
    <Dialog open={!!sessionId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>รายละเอียด Session</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        )}

        {!isLoading && !data && (
          <div className="py-8 text-center text-sm text-muted-foreground">ไม่พบข้อมูล</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Session header */}
            <div className="rounded-lg bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">โต๊ะ</span>
                <span className="font-semibold text-foreground">
                  {data.session.table.label}
                  {data.session.table.zone !== 'ทั่วไป' && (
                    <span className="ml-1 font-normal text-muted-foreground">({data.session.table.zone})</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">เริ่มต้น</span>
                <span className="tabular-nums text-foreground">
                  {format(new Date(data.session.startedAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                </span>
              </div>
              {data.session.closedAt && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">สิ้นสุด</span>
                    <span className="tabular-nums text-foreground">
                      {format(new Date(data.session.closedAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">เวลาที่ใช้</span>
                    <span className="tabular-nums text-foreground">
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
                  <span className="text-muted-foreground">หมายเหตุ</span>
                  <span className="text-foreground">{data.session.notes}</span>
                </div>
              )}
            </div>

            {/* Guests */}
            {data.session.guests.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  ผู้เข้าใช้บริการ
                </p>
                <div className="space-y-1.5">
                  {data.session.guests.map((g) => (
                    <div key={g.id} className="flex justify-between text-sm">
                      <span className="text-foreground">{g.pricingTile.name} ×{g.quantity}</span>
                      <span className="tabular-nums font-medium text-foreground">
                        ฿{(Number(g.pricingTile.price) * g.quantity).toLocaleString('th-TH')}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
                    <span className="text-foreground">รวม</span>
                    <span className="tabular-nums text-foreground">
                      ฿{data.session.guests
                        .reduce((s, g) => s + Number(g.pricingTile.price) * g.quantity, 0)
                        .toLocaleString('th-TH')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Payment */}
            {showPayment && data.session.payment && (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  การชำระเงิน
                </p>

                {/* Payment details */}
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ยอดชำระ</span>
                    <span className="tabular-nums font-bold text-foreground">
                      ฿{Number(data.session.payment.total).toLocaleString('th-TH')}
                    </span>
                  </div>
                  {Number(data.session.payment.discount) > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">ส่วนลด</span>
                      <span className="tabular-nums text-green-700">
                        −฿{Number(data.session.payment.discount).toLocaleString('th-TH')}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">วิธีชำระ</span>
                    <span className="text-foreground">
                      {METHOD_LABEL[data.session.payment.paymentMethod] ?? data.session.payment.paymentMethod}
                    </span>
                  </div>
                  {Number(data.session.payment.changeAmount) > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">เงินทอน</span>
                      <span className="tabular-nums text-foreground">
                        ฿{Number(data.session.payment.changeAmount).toLocaleString('th-TH')}
                      </span>
                    </div>
                  )}
                  {data.session.payment.notes && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">หมายเหตุ</span>
                      <span className="text-right text-foreground max-w-[60%]">
                        {data.session.payment.notes}
                      </span>
                    </div>
                  )}
                </div>

                {/* Action buttons / confirmations */}
                {!delConfirm && !editConfirm && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditConfirm(true)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-3 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
                    >
                      <Pencil className="size-4" />แก้ไขการชำระเงิน
                    </button>
                    <button
                      type="button"
                      onClick={() => setDelConfirm(true)}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="size-4" />ลบ
                    </button>
                  </div>
                )}

                {/* Edit confirm */}
                {editConfirm && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-sm font-semibold text-amber-800">ยืนยันแก้ไขการชำระเงิน?</p>
                    <p className="text-xs text-amber-600">
                      การชำระเงินเดิมจะถูกยกเลิก บิลจะกลับสู่หน้า POS เพื่อชำระใหม่
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditConfirm(false)}
                        disabled={submitting}
                        className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-card disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={handleReopen}
                        disabled={submitting}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {submitting && <Loader2 className="size-3 animate-spin" />}
                        ยืนยัน → ไปหน้า POS
                      </button>
                    </div>
                  </div>
                )}

                {/* Delete confirm */}
                {delConfirm && (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-sm font-semibold text-red-700">ยืนยันลบประวัติการชำระเงิน?</p>
                    <p className="text-xs text-red-500">
                      ประวัติจะถูกลบถาวร session จะถูกปิดโดยไม่มีการชำระเงิน
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDelConfirm(false)}
                        disabled={submitting}
                        className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-card disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={submitting}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {submitting && <Loader2 className="size-3 animate-spin" />}
                        ยืนยันลบ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Orders */}
            {data.orders.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  รายการอาหาร ({data.orders.flatMap((o) => o.items).length} รายการ)
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {data.orders.flatMap((o) =>
                    o.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-xs text-foreground">
                        <span>
                          {item.menuItem?.name ?? (item as typeof item & { itemName?: string | null }).itemName ?? '-'}
                          {item.notes && <span className="ml-1 text-muted-foreground">({item.notes})</span>}
                          {item.status === 'cancelled' && <span className="ml-1 text-red-400">[ยกเลิก]</span>}
                        </span>
                        <div className="flex gap-2 shrink-0">
                          <span className="tabular-nums text-muted-foreground">×{item.quantity}</span>
                          {!item.menuItem?.isBuffet && (
                            <span className="tabular-nums text-red-600">
                              +฿{(Number(item.menuItem?.extraPrice ?? 0) * item.quantity).toLocaleString('th-TH')}
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
