package com.shabu.posapp

import android.content.Context
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import com.shabu.posapp.printing.NetworkPrinter
import com.shabu.posapp.printing.UsbPrinter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

private const val TAG = "AndroidPrinter"

/**
 * JavaScript bridge injected into the WebView as window.AndroidPrinter.
 *
 * The POS webapp (lib/printer/transports/android-bridge.ts) calls:
 *   window.AndroidPrinter.print(JSON.stringify(payload))
 *
 * IMPORTANT: @JavascriptInterface only works with primitive Java types.
 * The webapp MUST pass JSON.stringify(payload) — not the raw object —
 * because a JavaScript object argument becomes the string "[object Object]".
 *
 * This bridge:
 *   1. Receives the JSON string from JavaScript
 *   2. Parses it into PrintPayload
 *   3. Decodes the base64 ESC/POS bytes
 *   4. Dispatches to NetworkPrinter or UsbPrinter based on payload.target
 *
 * All I/O runs on Dispatchers.IO — never blocks the WebView / main thread.
 */
class PrinterBridge(private val context: Context) {

    // SupervisorJob: a failure in one print job doesn't cancel others
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Entry point called by the webapp:
     *   window.AndroidPrinter.print(JSON.stringify(payload))
     *
     * @param payloadJson JSON string matching AndroidPrintPayload from types.ts
     */
    @JavascriptInterface
    fun print(payloadJson: String) {
        Log.d(TAG, "Bridge called — payload length: ${payloadJson.length}")

        scope.launch {
            try {
                val payload = parsePayload(payloadJson)
                Log.d(TAG, "Payload parsed: job=${payload.jobType} target=${payload.target} printer=\"${payload.printerName}\"")

                val bytes = Base64.decode(payload.escposBase64, Base64.DEFAULT)
                Log.d(TAG, "Decoded ${bytes.size} ESC/POS bytes")

                when (payload.target) {
                    "network"  -> handleNetwork(payload, bytes)
                    "usb_otg"  -> handleUsb(payload, bytes)
                    else       -> Log.w(TAG, "Unknown target: \"${payload.target}\" — ignoring")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Print failed: ${e.message}", e)
            }
        }
    }

    /* ── Routing ──────────────────────────────────────────────────────────── */

    private fun handleNetwork(payload: PrintPayload, bytes: ByteArray) {
        val host = payload.host
        val port = payload.port ?: 9100

        if (host.isNullOrBlank()) {
            Log.e(TAG, "Network print failed — payload missing host")
            return
        }

        Log.d(TAG, "Network print → $host:$port")
        val result = NetworkPrinter.print(host, port, bytes)

        if (result.isSuccess) {
            Log.i(TAG, "Network print success → $host:$port")
        } else {
            Log.e(TAG, "Network print failed → $host:$port: ${result.exceptionOrNull()?.message}")
        }
    }

    private fun handleUsb(payload: PrintPayload, bytes: ByteArray) {
        Log.d(TAG, "USB OTG print → \"${payload.printerName}\" (${bytes.size} bytes)")

        val result = UsbPrinter.print(context, bytes)

        when {
            result.isSuccess -> {
                Log.i(TAG, "USB print success")
            }
            result.exceptionOrNull()?.message == UsbPrinter.PERMISSION_REQUIRED -> {
                // USB device found but no permission yet — show system dialog and retry
                Log.w(TAG, "USB permission missing — requesting")
                UsbPrinter.requestPermission(context) {
                    Log.d(TAG, "USB permission granted — retrying print")
                    val retry = UsbPrinter.print(context, bytes)
                    if (retry.isSuccess) {
                        Log.i(TAG, "USB print success (after permission grant)")
                    } else {
                        Log.e(TAG, "USB print failed after permission: ${retry.exceptionOrNull()?.message}")
                    }
                }
            }
            else -> {
                Log.e(TAG, "USB print failed: ${result.exceptionOrNull()?.message}")
            }
        }
    }

    /* ── JSON parsing ─────────────────────────────────────────────────────── */

    private fun parsePayload(json: String): PrintPayload {
        val obj = JSONObject(json)
        return PrintPayload(
            printerId    = obj.optString("printerId"),
            printerName  = obj.optString("printerName"),
            method       = obj.optString("method"),
            target       = obj.optString("target"),
            host         = obj.optString("host").takeIf { it.isNotEmpty() },
            port         = if (obj.has("port") && !obj.isNull("port")) obj.getInt("port") else null,
            paperWidth   = obj.optInt("paperWidth", 80),
            jobType      = obj.optString("jobType"),
            escposBase64 = obj.getString("escposBase64"),
        )
    }
}
