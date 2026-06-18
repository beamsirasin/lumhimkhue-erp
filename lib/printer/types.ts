/* ─── Printer Configuration ─────────────────────────────────────────────── */

export type PrinterType = 'usb' | 'network' | 'browser';

export type PrinterConfig = {
  id: string;
  name: string;
  type: PrinterType;
  usbVendorId?: number;
  usbProductId?: number;
  ipAddress?: string;
  port?: number;
  paperWidth: 58 | 80;
  thaiCodepage: number;
  /** Render Thai text as bitmap image instead of codepage bytes.
   *  Use when the printer lacks Thai glyph shaping (raw character rendering). */
  thaiImageMode?: boolean;
  isDefault: boolean;
  testedAt?: string;
};

/* ─── Print Jobs ────────────────────────────────────────────────────────── */

export type PrintJob =
  | { type: 'receipt'; payment: ReceiptData }
  | { type: 'table_qr'; table: TableQrData }
  | { type: 'queue_qr'; queueEntry: QueueQrData }
  | { type: 'kitchen_order'; order: KitchenOrderData };

/* ─── Job Payloads ──────────────────────────────────────────────────────── */

export type BuyerInfo = {
  companyName: string;
  address: string;
  taxId: string;
};

export type ReceiptData = {
  /** 'bill' = preview before payment (no VAT/payment info), 'receipt' = full paid receipt */
  receiptType: 'bill' | 'receipt';
  /** Document label: 'food' | 'receipt_short' | 'tax_full' */
  billTypeLabel?: 'food' | 'receipt_short' | 'tax_full';

  /* ── Shop info (from store settings) ── */
  logoUrl?: string;
  logoHeight?: number;
  paperWidth?: 58 | 80;
  shopNameTh: string;
  shopNameEn?: string;
  companyName?: string;
  shopAddress?: string;
  phone?: string;
  taxId?: string;
  branch?: string;
  registerNo?: string;
  footerNote?: string;
  vatPercent?: number;

  /* ── Tax invoice buyer info (tax_full only) ── */
  buyerInfo?: BuyerInfo;

  /* ── Transaction ── */
  receiptNo?: string;
  tableNumber: string;
  cashierName: string;
  paidAt: string;
  sessionId: string;

  items: Array<{
    name: string;
    quantity: number;
    total: number;
  }>;

  subtotal: number;
  discount: number;
  serviceCharge: number;
  total: number;

  /* ── Payment (receipt only) ── */
  settlementType?: 'partial' | 'final';
  billTotal?: number;
  paidBefore?: number;
  paidThisTime?: number;
  paidTotal?: number;
  remainingAfter?: number;

  receivedAmount: number;
  changeAmount: number;
  paymentMethod: string;
  /** Phase 2B-4: per-row breakdown for true draft-row payments. Optional — legacy callers omit. */
  paymentRows?: Array<{
    label: string;
    accountName: string;
    amount: number;
    amountTendered?: number | null;
    changeAmount?: number | null;
    payerLabel?: string | null;
  }>;
};

export type TableQrData = {
  tableNumber: string;
  url: string;
  startedAt: string;
  endsAt?: string;
  durationMinutes?: number;
};

export type QueueQrData = {
  queueNumber: string;
  partySize: number;
  url: string;
  createdAt: string;
};

export type KitchenOrderData = {
  tableNumber: string;
  station: string;
  orderedAt: string;
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
  }>;
};
