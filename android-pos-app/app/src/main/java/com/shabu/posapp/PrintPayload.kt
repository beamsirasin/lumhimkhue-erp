package com.shabu.posapp

/**
 * Mirrors AndroidPrintPayload from lib/printer/types.ts in the webapp.
 *
 * Fields:
 *   printerId    — printer config ID stored in the webapp's IndexedDB
 *   printerName  — human-readable printer name
 *   method       — always "android_bridge"
 *   target       — "usb_otg" or "network" (how the Android app reaches the printer)
 *   host         — printer IP address (only when target == "network")
 *   port         — printer TCP port, default 9100 (only when target == "network")
 *   paperWidth   — 58 or 80 (mm)
 *   jobType      — "receipt" | "kitchen_order" | "table_qr" | "queue_qr" | "test"
 *   escposBase64 — Base64-encoded ESC/POS byte sequence ready to send to the printer
 */
data class PrintPayload(
    val printerId: String,
    val printerName: String,
    val method: String,
    val target: String,
    val host: String?,
    val port: Int?,
    val paperWidth: Int,
    val jobType: String,
    val escposBase64: String,
)
