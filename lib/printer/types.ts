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

export type ReceiptData = {
  /** 'bill' = preview before payment (no VAT/payment info), 'receipt' = full paid receipt */
  receiptType: 'bill' | 'receipt';

  /* ── Shop info (from store settings) ── */
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
  receivedAmount: number;
  changeAmount: number;
  paymentMethod: string;
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
