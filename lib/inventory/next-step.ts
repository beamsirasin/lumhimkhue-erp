/**
 * Phase 17C — Inventory "What to do next" engine (pure).
 *
 * Maps the current inventory state to a SINGLE primary next action plus a few
 * optional secondary hints, so a non-expert owner/manager always knows the one
 * thing to do now. No business math here — only orchestration of existing state.
 */

export type CountStatus = 'draft' | 'submitted' | 'reviewed';

export type InventoryStateSignals = {
  /** Any active ingredient exists. */
  hasIngredients: boolean;
  /** The branch has at least one reviewed count (system is initialized). */
  hasReviewedCount: boolean;
  /** Status of the initial-setup count, if one exists and system not yet initialized. */
  initialSetupStatus: CountStatus | null;
  /** Status of today's daily count, if one exists. */
  todayCountStatus: CountStatus | null;
  /** Progress for a draft today-count. */
  todayCounted: number;
  todayTotal: number;
  /** Reorder recommendations from the latest reviewed count. */
  recommendationCount: number;
  /** Purchase orders by lifecycle bucket. */
  draftPoCount: number;
  pendingApprovalPoCount: number;
  awaitingReceiptCount: number; // ordered + partial_received
};

export type NextActionTone = 'primary' | 'info' | 'warning' | 'success';

export type NextAction = {
  key: string;
  /** Optional onboarding step label, e.g. "ขั้นที่ 1". */
  step?: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  tone: NextActionTone;
};

export type InventoryNextStep = {
  primary: NextAction;
  secondary: NextAction[];
};

const HREF = {
  ingredients: '/inventory/ingredients',
  setup: '/inventory/setup',
  count: '/inventory/count',
  reorder: '/inventory/reorder',
  orders: '/inventory/orders',
  overview: '/inventory',
} as const;

function receiveAction(count: number): NextAction {
  return {
    key: 'receive-goods',
    title: `มี ${count.toLocaleString('th-TH')} ใบสั่งซื้อรอรับสินค้า`,
    description: 'เมื่อผู้ขายส่งของถึงร้าน ให้บันทึกรับสินค้าเพื่อให้ของเข้าสต็อก',
    ctaLabel: 'บันทึกรับสินค้า',
    href: HREF.orders,
    tone: 'info',
  };
}

function draftPoAction(count: number): NextAction {
  return {
    key: 'review-draft-po',
    title: `มีใบสั่งซื้อฉบับร่าง ${count.toLocaleString('th-TH')} ใบรอตรวจ`,
    description: 'ตรวจและแก้จำนวนก่อนส่งขออนุมัติและส่งให้ผู้ขาย',
    ctaLabel: 'ตรวจใบสั่งซื้อ',
    href: HREF.orders,
    tone: 'info',
  };
}

function approvePoAction(count: number): NextAction {
  return {
    key: 'approve-po',
    title: `มีใบสั่งซื้อรออนุมัติ ${count.toLocaleString('th-TH')} ใบ`,
    description: 'เจ้าของร้านตรวจและอนุมัติก่อนส่งให้ผู้ขาย',
    ctaLabel: 'ดูใบสั่งซื้อ',
    href: HREF.orders,
    tone: 'warning',
  };
}

function recommendationAction(count: number): NextAction {
  return {
    key: 'view-recommendations',
    title: `มี ${count.toLocaleString('th-TH')} รายการแนะนำให้สั่ง`,
    description: 'ระบบคำนวณจากยอดนับล่าสุดและเป้าหมายสต็อก เลือกรายการเพื่อสร้างใบสั่งซื้อ',
    ctaLabel: 'ดูคำแนะนำสั่งซื้อ',
    href: HREF.reorder,
    tone: 'primary',
  };
}

/** Deterministic single primary next action + secondary hints. */
export function buildInventoryNextStep(signals: InventoryStateSignals): InventoryNextStep {
  const secondary: NextAction[] = [];

  // ── Onboarding path (system not yet initialized) ──────────────────────────
  if (!signals.hasIngredients) {
    return {
      primary: {
        key: 'setup-ingredients',
        step: 'ขั้นที่ 1',
        title: 'เพิ่มผู้ขายและวัตถุดิบ',
        description: 'เริ่มจากตั้งรายการวัตถุดิบ หน่วยนับ หน่วยสั่งซื้อ จุดสั่งซื้อ และผู้ขายหลัก',
        ctaLabel: 'ตั้งค่าวัตถุดิบ',
        href: HREF.ingredients,
        tone: 'primary',
      },
      secondary,
    };
  }

  if (!signals.hasReviewedCount) {
    if (signals.initialSetupStatus === null) {
      return {
        primary: {
          key: 'start-initial-setup',
          step: 'ขั้นที่ 2',
          title: 'นับยอดสต็อกเริ่มต้นจริง',
          description: 'นับของที่มีอยู่จริงครั้งแรกเพื่อกำหนดยอดเริ่มต้นของระบบ',
          ctaLabel: 'เริ่มนับยอดสต็อกเริ่มต้น',
          href: HREF.setup,
          tone: 'primary',
        },
        secondary,
      };
    }
    if (signals.initialSetupStatus === 'draft') {
      return {
        primary: {
          key: 'continue-initial-setup',
          step: 'ขั้นที่ 2',
          title: 'กรอกยอดเริ่มต้นให้ครบ',
          description: 'ยังกรอกยอดเริ่มต้นไม่ครบทุกวัตถุดิบ',
          ctaLabel: 'ทำต่อ',
          href: HREF.setup,
          tone: 'primary',
        },
        secondary,
      };
    }
    // submitted
    return {
      primary: {
        key: 'review-initial-setup',
        step: 'ขั้นที่ 3',
        title: 'รอตรวจและยืนยันยอดเริ่มต้น',
        description: 'เมื่อยืนยันแล้ว ยอดนี้จะกลายเป็นยอดเริ่มต้นของร้าน',
        ctaLabel: 'ตรวจยอดเริ่มต้น',
        href: HREF.setup,
        tone: 'warning',
      },
      secondary,
    };
  }

  // ── Daily operating path (system initialized) ─────────────────────────────
  // Build the secondary hints once (surfaced when not the primary).
  if (signals.awaitingReceiptCount > 0) secondary.push(receiveAction(signals.awaitingReceiptCount));
  if (signals.pendingApprovalPoCount > 0) secondary.push(approvePoAction(signals.pendingApprovalPoCount));
  if (signals.draftPoCount > 0) secondary.push(draftPoAction(signals.draftPoCount));

  const withoutPrimary = (key: string) => secondary.filter((a) => a.key !== key);

  if (signals.todayCountStatus === null) {
    return {
      primary: {
        key: 'count-today',
        title: 'ปิดร้านแล้ว กรุณานับสต็อก',
        description: 'นับของเหลือจริงตอนปิดร้านเพื่อคำนวณการใช้และคำแนะนำสั่งซื้อ',
        ctaLabel: 'เริ่มนับสต็อกวันนี้',
        href: HREF.count,
        tone: 'primary',
      },
      secondary,
    };
  }
  if (signals.todayCountStatus === 'draft') {
    return {
      primary: {
        key: 'continue-count',
        title: `นับแล้ว ${signals.todayCounted.toLocaleString('th-TH')}/${signals.todayTotal.toLocaleString('th-TH')} รายการ`,
        description: 'ยังนับไม่ครบ กดทำต่อเพื่อนับรายการที่เหลือ',
        ctaLabel: 'นับต่อ',
        href: HREF.count,
        tone: 'primary',
      },
      secondary,
    };
  }
  if (signals.todayCountStatus === 'submitted') {
    return {
      primary: {
        key: 'review-count',
        title: 'รอตรวจและยืนยันยอดปิดร้าน',
        description: 'ตรวจการนับแล้วยืนยันยอดปิดร้าน ยอดนี้จะเป็นยอดยกมาของรอบถัดไป',
        ctaLabel: 'ตรวจการนับ',
        href: HREF.count,
        tone: 'warning',
      },
      secondary,
    };
  }

  // today reviewed (or reviewed exists) → downstream procurement work
  if (signals.recommendationCount > 0) {
    return { primary: recommendationAction(signals.recommendationCount), secondary };
  }
  if (signals.draftPoCount > 0) {
    return { primary: draftPoAction(signals.draftPoCount), secondary: withoutPrimary('review-draft-po') };
  }
  if (signals.pendingApprovalPoCount > 0) {
    return { primary: approvePoAction(signals.pendingApprovalPoCount), secondary: withoutPrimary('approve-po') };
  }
  if (signals.awaitingReceiptCount > 0) {
    return { primary: receiveAction(signals.awaitingReceiptCount), secondary: withoutPrimary('receive-goods') };
  }

  // Everything is up to date.
  return {
    primary: {
      key: 'up-to-date',
      title: 'สต็อกเป็นปัจจุบันแล้ว',
      description: 'ยืนยันการนับล่าสุดแล้วและไม่มีรายการที่ต้องสั่งซื้อ นับอีกครั้งเมื่อปิดร้านรอบถัดไป',
      ctaLabel: 'ดูภาพรวมสต็อก',
      href: HREF.overview,
      tone: 'success',
    },
    secondary,
  };
}
