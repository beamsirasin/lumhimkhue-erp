/**
 * Detect which print transports are available in the current environment.
 * Safe to call during SSR — returns sensible defaults when `navigator` is absent.
 */

export type PrinterCapabilities = {
  /** WebUSB API available (Chrome on Android/Desktop via OTG or direct USB) */
  usb: boolean;
  /** Network transport always theoretically available; warn user in production */
  network: boolean;
  /** window.print() always available in browsers */
  browser: boolean;
};

export function getCapabilities(): PrinterCapabilities {
  if (typeof navigator === 'undefined') {
    // SSR: USB not available server-side
    return { usb: false, network: true, browser: true };
  }

  return {
    usb: 'usb' in navigator,
    network: true,
    browser: true,
  };
}

/**
 * Returns true when running on localhost / 127.0.0.1 / ::1.
 * Network printer only works in this environment (printer is on LAN, not reachable from Vercel).
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
