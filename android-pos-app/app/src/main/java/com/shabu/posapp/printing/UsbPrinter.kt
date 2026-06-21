package com.shabu.posapp.printing

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log

private const val TAG = "UsbPrinter"
private const val ACTION_USB_PERMISSION = "com.shabu.posapp.USB_PERMISSION"
private const val CHUNK_SIZE = 16_384      // 16 KB — safe for most USB printer buffers
private const val TRANSFER_TIMEOUT_MS = 5_000

/**
 * Sends ESC/POS bytes to a USB/OTG-connected printer via the Android USB Host API.
 *
 * NOTE: USB/OTG printing must NOT be removed — it is a core supported method
 * alongside Network and Browser printing in the webapp.
 *
 * Permission flow:
 *   1. print() checks hasPermission(). If the device was connected while the app
 *      was already running it may not have permission yet.
 *   2. On failure with PERMISSION_REQUIRED, call requestPermission() which shows
 *      the system USB permission dialog.
 *   3. After the user approves, onGranted() is called and the caller can retry.
 *
 * All calls must come from a background thread (IO dispatcher or Thread).
 */
object UsbPrinter {

    /** Sentinel error message returned when USB permission is not yet granted */
    const val PERMISSION_REQUIRED = "USB_PERMISSION_REQUIRED"

    /**
     * Print bytes to the first detected USB printer device.
     * Returns Result.failure(Exception(PERMISSION_REQUIRED)) if not yet permitted.
     */
    fun print(context: Context, bytes: ByteArray): Result<Unit> {
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        val device = findPrinterDevice(usbManager) ?: run {
            Log.w(TAG, "No USB printer found — is OTG cable connected?")
            return Result.failure(Exception("ไม่พบ USB printer — กรุณาเสียบสาย OTG"))
        }

        Log.d(TAG, "Found USB printer: ${device.deviceName} (${device.vendorId}:${device.productId})")

        if (!usbManager.hasPermission(device)) {
            Log.w(TAG, "USB permission not granted for ${device.deviceName}")
            return Result.failure(Exception(PERMISSION_REQUIRED))
        }

        return sendBytes(usbManager, device, bytes)
    }

    /**
     * Show the system USB permission dialog for the first detected printer.
     * [onGranted] is invoked (on a background receiver thread) when the user approves.
     */
    fun requestPermission(context: Context, onGranted: () -> Unit) {
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val device = findPrinterDevice(usbManager) ?: run {
            Log.w(TAG, "requestPermission: no USB printer found")
            return
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            PendingIntent.FLAG_MUTABLE
        else
            0

        val permissionIntent = PendingIntent.getBroadcast(
            context, 0, Intent(ACTION_USB_PERMISSION), flags,
        )

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != ACTION_USB_PERMISSION) return
                context.unregisterReceiver(this)
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                Log.d(TAG, "USB permission result: granted=$granted for ${device.deviceName}")
                if (granted) onGranted()
            }
        }

        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        Log.d(TAG, "Requesting USB permission for ${device.deviceName}")
        usbManager.requestPermission(device, permissionIntent)
    }

    /* ── Private helpers ──────────────────────────────────────────────────── */

    private fun findPrinterDevice(usbManager: UsbManager): UsbDevice? =
        usbManager.deviceList.values.firstOrNull { device ->
            (0 until device.interfaceCount).any { i ->
                device.getInterface(i).interfaceClass == UsbConstants.USB_CLASS_PRINTER
            }
        }

    private fun sendBytes(usbManager: UsbManager, device: UsbDevice, bytes: ByteArray): Result<Unit> {
        val connection = usbManager.openDevice(device)
            ?: return Result.failure(Exception("เปิด USB device ไม่ได้"))

        // Find the printer interface (class 0x07)
        val printerInterface = (0 until device.interfaceCount)
            .map { device.getInterface(it) }
            .firstOrNull { it.interfaceClass == UsbConstants.USB_CLASS_PRINTER }
            ?: run {
                connection.close()
                return Result.failure(Exception("ไม่พบ Printer USB interface (class 0x07)"))
            }

        if (!connection.claimInterface(printerInterface, true)) {
            connection.close()
            return Result.failure(Exception("claim USB interface ไม่สำเร็จ"))
        }

        // Find bulk-out endpoint for data output to printer
        val endpoint = (0 until printerInterface.endpointCount)
            .map { printerInterface.getEndpoint(it) }
            .firstOrNull {
                it.direction == UsbConstants.USB_DIR_OUT &&
                it.type == UsbConstants.USB_ENDPOINT_XFER_BULK
            }
            ?: run {
                connection.releaseInterface(printerInterface)
                connection.close()
                return Result.failure(Exception("ไม่พบ bulk-out endpoint บน USB interface"))
            }

        Log.d(TAG, "Sending ${bytes.size} bytes via USB bulk transfer")

        return try {
            var offset = 0
            while (offset < bytes.size) {
                val end = minOf(offset + CHUNK_SIZE, bytes.size)
                val chunk = bytes.copyOfRange(offset, end)
                val transferred = connection.bulkTransfer(endpoint, chunk, chunk.size, TRANSFER_TIMEOUT_MS)
                if (transferred < 0) throw Exception("USB bulk transfer ล้มเหลวที่ offset $offset")
                offset = end
            }
            Log.i(TAG, "USB print success (${bytes.size} bytes sent)")
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "USB print failed: ${e.message}")
            Result.failure(e)
        } finally {
            connection.releaseInterface(printerInterface)
            connection.close()
        }
    }
}
