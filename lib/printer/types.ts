/* ─── Printer Configuration ─────────────────────────────────────────────── */

export type PrinterType = 'usb' | 'network' | 'browser';

export type PrinterConfig = {
  id: string;
  name: string;
  type: PrinterType;
  /** USB: vendor ID from WebUSB */
  usbVendorId?: number;
  /** USB: product ID from WebUSB */
  usbProductId?: number;
  /** Network: printer IP address */
  ipAddress?: string;
  /** Network: port (default 9100) */
  port?: number;
  paperWidth: 58 | 80;
  /**
   * ESC/POS codepage number for Thai (CP874).
   * Epson / most generic printers: 21 (default).
   * Star Micronics: 13.  Citizen: 21.
   */
  thaiCodepage: number;
  isDefault: boolean;
  /** ISO string of last successful test */
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
  shopName: string;
  shopAddress?: string;
  taxId?: string;
  tableNumber: string;
  cashierName: string;
  /** Display string, e.g. "27 พ.ค. 69 14:32" */
  paidAt: string;
  items: Array<{
    name: string;
    quantity: number;
    /** Total line price (qty × unit price) */
    total: number;
  }>;
  subtotal: number;
  discount: number;
  serviceCharge: number;
  total: number;
  receivedAmount: number;
  changeAmount: number;
  paymentMethod: string;
  /** Used for QR on receipt */
  sessionId: string;
};

export type TableQrData = {
  tableNumber: string;
  /** Full URL the QR encodes */
  url: string;
  /** Display string */
  startedAt: string;
  /** Optional — unlimited session has no end time */
  endsAt?: string;
  durationMinutes?: number;
};

export type QueueQrData = {
  /** e.g. "Q001" */
  queueNumber: string;
  partySize: number;
  /** Full URL the QR encodes */
  url: string;
  /** Display string */
  createdAt: string;
};

export type KitchenOrderData = {
  tableNumber: string;
  /** e.g. "meat", "seafood" */
  station: string;
  /** Display string */
  orderedAt: string;
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
  }>;
};
