/**
 * WebUSB transport for ESC/POS printers.
 * Requires Chrome/Edge on Android (OTG cable) or Desktop.
 * Always call getCapabilities().usb before using these functions.
 */

const CHUNK_SIZE = 16_384; // 16 KB — safe for most USB printer buffers

/* ─── Device pairing ────────────────────────────────────────────────────── */

/**
 * Open the browser's USB device picker filtered to printer class (0x07).
 * Returns the selected device, or null if the user cancelled.
 */
export async function requestUSBDevice(): Promise<USBDevice | null> {
  if (!('usb' in navigator)) {
    throw new Error('Browser ไม่รองรับ WebUSB');
  }
  try {
    return await navigator.usb.requestDevice({
      filters: [{ classCode: 7 }], // USB Printing class
    });
  } catch {
    return null; // user cancelled → DOMException 'NotFoundError'
  }
}

/**
 * Find a previously-paired device by vendorId + productId without prompting.
 * Returns null if the device is not currently connected.
 */
export async function findPairedDevice(
  vendorId: number,
  productId: number,
): Promise<USBDevice | null> {
  const devices = await navigator.usb.getDevices();
  return (
    devices.find((d) => d.vendorId === vendorId && d.productId === productId) ??
    null
  );
}

/* ─── Data transfer ─────────────────────────────────────────────────────── */

/**
 * Open `device`, send all `bytes`, then release and close.
 * Splits data into 16 KB chunks to avoid USB buffer overruns.
 */
export async function sendUSB(device: USBDevice, bytes: Uint8Array): Promise<void> {
  await device.open();

  try {
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const iface = device.configuration!.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);

    try {
      // Prefer bulk-out endpoint; fall back to any out endpoint
      const endpoint =
        iface.alternate.endpoints.find(
          (e) => e.direction === 'out' && e.type === 'bulk',
        ) ?? iface.alternate.endpoints.find((e) => e.direction === 'out');

      if (!endpoint) throw new Error('ไม่พบ endpoint สำหรับส่งข้อมูล');

      // Send in chunks
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
        await device.transferOut(endpoint.endpointNumber, chunk);
      }
    } finally {
      await device.releaseInterface(iface.interfaceNumber);
    }
  } finally {
    await device.close();
  }
}
