/**
 * Phase 17C — Purchase-order lifecycle presentation (pure).
 * Plain-language labels, a linear stepper, and the single primary action per
 * status. RBAC is unchanged — this only decides which button to feature; the
 * server actions still enforce permission.
 */

export type PoStatus =
  | 'draft'
  | 'pending_approval'
  | 'ordered'
  | 'partial_received'
  | 'received'
  | 'cancelled';

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'ฉบับร่าง',
  pending_approval: 'รออนุมัติ',
  ordered: 'ส่งให้ผู้ขายแล้ว',
  partial_received: 'รับของบางส่วน',
  received: 'รับของครบแล้ว',
  cancelled: 'ยกเลิก',
};

export const PO_STATUS_DESCRIPTIONS: Record<PoStatus, string> = {
  draft: 'แก้ไขรายการได้ ยังไม่ส่งให้ผู้ขาย',
  pending_approval: 'รอเจ้าของร้านอนุมัติ',
  ordered: 'ส่งให้ผู้ขายแล้ว รอสินค้ามาส่ง',
  partial_received: 'รับของมาบางส่วน ยังเหลือรอรับ',
  received: 'รับสินค้าครบแล้ว',
  cancelled: 'ใบสั่งซื้อถูกยกเลิก',
};

/** Linear happy-path steps shown in the stepper (cancelled is off-path). */
export const PO_LIFECYCLE_STEPS: { status: PoStatus; label: string }[] = [
  { status: 'draft', label: 'ฉบับร่าง' },
  { status: 'pending_approval', label: 'รออนุมัติ' },
  { status: 'ordered', label: 'ส่งให้ผู้ขายแล้ว' },
  { status: 'partial_received', label: 'รับบางส่วน' },
  { status: 'received', label: 'รับครบ' },
];

export function poStepIndex(status: PoStatus): number {
  const idx = PO_LIFECYCLE_STEPS.findIndex((s) => s.status === status);
  return idx; // -1 for cancelled
}

export type PoPrimaryAction = {
  /** Which server action the button triggers. */
  action: 'submit' | 'approve' | 'receive' | 'none';
  label: string;
  /** Present when the action is gated by a permission the actor lacks. */
  blockedReason?: string;
} | null;

export type PoActorPerms = { canManage: boolean; canApprove: boolean };

/**
 * The single featured action for a PO given its status and the actor's rights.
 * Returns null when there is no forward action (received / cancelled).
 */
export function purchaseOrderPrimaryAction(status: PoStatus, perms: PoActorPerms): PoPrimaryAction {
  switch (status) {
    case 'draft':
      return perms.canManage
        ? { action: 'submit', label: 'ส่งขออนุมัติ' }
        : { action: 'none', label: 'ส่งขออนุมัติ', blockedReason: 'ไม่มีสิทธิ์จัดการใบสั่งซื้อ' };
    case 'pending_approval':
      return perms.canApprove
        ? { action: 'approve', label: 'อนุมัติใบสั่งซื้อ' }
        : { action: 'none', label: 'รอเจ้าของร้านอนุมัติ', blockedReason: 'เฉพาะเจ้าของร้านอนุมัติได้' };
    case 'ordered':
      return perms.canManage
        ? { action: 'receive', label: 'รับสินค้า' }
        : { action: 'none', label: 'รับสินค้า', blockedReason: 'ไม่มีสิทธิ์รับสินค้า' };
    case 'partial_received':
      return perms.canManage
        ? { action: 'receive', label: 'รับสินค้าเพิ่มเติม' }
        : { action: 'none', label: 'รับสินค้าเพิ่มเติม', blockedReason: 'ไม่มีสิทธิ์รับสินค้า' };
    case 'received':
    case 'cancelled':
      return null;
  }
}
