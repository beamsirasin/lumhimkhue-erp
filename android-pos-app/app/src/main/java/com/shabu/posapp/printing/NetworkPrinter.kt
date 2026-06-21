package com.shabu.posapp.printing

import android.util.Log
import java.net.InetSocketAddress
import java.net.Socket

private const val TAG = "NetworkPrinter"
private const val TIMEOUT_MS = 10_000

/**
 * Sends ESC/POS bytes to a network printer over TCP (port 9100 by default).
 *
 * WHY: Vercel's cloud server cannot reach printers on a private LAN.
 * This runs on the Android tablet — same local network as the printer —
 * so the connection is direct and reliable.
 *
 * All calls must come from a background thread (IO dispatcher or Thread).
 * Never call from the main thread.
 */
object NetworkPrinter {

    fun print(host: String, port: Int, bytes: ByteArray): Result<Unit> {
        Log.d(TAG, "Connecting to $host:$port (${bytes.size} bytes)")
        return try {
            // Use explicit connect() so we can set a connection timeout.
            // The Socket(host, port) constructor uses the platform default (~75 s).
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), TIMEOUT_MS)
                socket.soTimeout = TIMEOUT_MS
                val out = socket.getOutputStream()
                out.write(bytes)
                out.flush()
            }
            Log.i(TAG, "Network print success → $host:$port")
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Network print failed → $host:$port: ${e.message}")
            Result.failure(e)
        }
    }
}
