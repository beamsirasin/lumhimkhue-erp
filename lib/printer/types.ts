/* ─── Printer Configuration ─────────────────────────────────────────────── */

/**
 * android_bridge: Routes ESC/POS bytes to window.AndroidPrinter.print().
 * The native Android POS wrapper app handles actual transmission over USB OTG
 * or LAN/WiFi locally — Vercel cannot reach private LAN printer IPs, making
 * this the production-safe method for one-tablet Android POS setups.
 * USB/OTG (WebUSB) and Network remain supported for other environments.
 */
export type PrinterType = 'usb' | 'network' | 'browser' | 'android_bridge';

/**
 * For android_bridge printers: whether the Android app should connect to the
 * printer via USB OTG cable or over LAN/WiFi.
 */
export type AndroidBridgeTarget = 'usb_otg' | 'network';

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
  /**
   * android_bridge only: whether the Android app connects to the printer
   * via USB OTG or over LAN/WiFi. Defaults to 'usb_otg'.
   */
  androidTarget?: AndroidBridgeTarget;
};

/* ─── Print Jobs ────────────────────────────────────────────────────────── */

export type PrintJob =
  | { type: 'receipt'; payment: ReceiptData }
  | { type: 'table_qr'; table: TableQrData }
  | { type: 'queue_qr'; queueEntry: QueueQrData }
  | { type: 'kitchen_order'; order: KitchenOrderData };

/* ─── Shared receipt layout constants ───────────────────────────────────── */

/** Column labels used in item-table header across all receipt renderers.
 *  Kept here so ESC/POS, bitmap, and HTML templates always stay in sync. */
export const RECEIPT_ITEM_COLUMNS = {
  name:  'สินค้า',
  qty:   'Qty',
  total: 'ราคารวม',
} as const;

/** Renderer-agnostic thermal receipt line.
 *  Shared between ESC/POS, bitmap, and HTML renderers so layout is identical. */
export type ThermalLine =
  | { t: 'text'; s: string; a: 'l' | 'c' | 'r'; bold?: boolean; big?: boolean }
  | { t: 'row';  l: string; r: string; bold?: boolean }
  | { t: 'hr' }
  | { t: 'sp';   n?: number }
  | { t: 'qr';   url: string };

/* ─── Job Payloads ──────────────────────────────────────────────────────── */

export type BuyerInfo = {
  companyName: string;
  address: string;
  taxId: string;
};

export type ReceiptData = {
  /** 'bill' = preview before payment (no VAT/payment info), 'receipt' = full paid receipt */
  receiptType: 'bill' | 'receipt';
  receiptKind?: 'payment_event' | 'full_bill';
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
  paymentId?: string;
  paymentEventNumber?: number;
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
  allocations?: Array<{
    chargeLineId?: string;
    chargeType?: string;
    label: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  allocationFallbackNote?: string;
  paymentEvents?: Array<{
    paymentId: string;
    paymentEventNumber: number;
    settlementType: 'partial' | 'final' | string;
    paidAt?: Date | string | null;
    total: number;
    paymentRows: Array<{
      methodName?: string;
      accountName?: string;
      amount: number;
    }>;
    allocations?: Array<{
      label: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;
  }>;
  fullBillSummary?: {
    billTotal: number;
    paidTotal: number;
    remaining: number;
    totalHeads?: number;
    hasUnallocatedPayments?: boolean;
  };
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
  adultCount?: number;
  childCount?: number;
  customerType?: string;
  soupSummary?: string;
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

/* ─── Android POS App / Local Bridge ────────────────────────────────────── */

/**
 * Payload sent to window.AndroidPrinter.print().
 *
 * The Android POS wrapper app receives this and transmits the ESC/POS bytes
 * to the physical printer over USB OTG or LAN/WiFi — entirely on-device,
 * so Vercel's cloud server is never involved in reaching the printer.
 */
export type AndroidPrintPayload = {
  printerId: string;
  printerName: string;
  method: 'android_bridge';
  /** How the Android app connects to the physical printer */
  target: AndroidBridgeTarget;
  /** Required when target === 'network' */
  host?: string;
  /** Required when target === 'network'; defaults to 9100 */
  port?: number;
  paperWidth: 58 | 80;
  jobType: 'receipt' | 'kitchen_order' | 'table_qr' | 'queue_qr' | 'test';
  /** Base64-encoded ESC/POS bytes ready to send to the printer */
  escposBase64: string;
};

/**
 * Interface injected by the native Android POS wrapper app as window.AndroidPrinter.
 * Only present when the webapp runs inside the Android POS App's WebView.
 */
export interface AndroidPrinterBridge {
  /**
   * Android @JavascriptInterface only accepts primitive types.
   * The webapp must pass JSON.stringify(payload) — a raw object becomes "[object Object]".
   */
  print(payloadJson: string): void;
}

declare global {
  interface Window {
    /**
     * Injected by the Android POS wrapper app.
     * Present only when the webapp runs inside the Android POS App WebView.
     *
     * NOTE: USB/OTG (WebUSB) and Network (TCP relay) remain supported and
     * must not be removed — other setups depend on them.
     * This bridge is the production-safe path when Vercel cannot reach LAN printers.
     */
    AndroidPrinter?: AndroidPrinterBridge;
  }
}
