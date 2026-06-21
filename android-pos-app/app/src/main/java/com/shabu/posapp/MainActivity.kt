package com.shabu.posapp

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

private const val TAG = "MainActivity"

/**
 * Single-activity WebView wrapper for the Shabu POS webapp.
 *
 * Architecture:
 *   - Loads the Vercel-hosted Next.js POS webapp in a full-screen WebView.
 *   - Injects PrinterBridge as window.AndroidPrinter.
 *   - The webapp detects window.AndroidPrinter and uses it for printing instead
 *     of the direct Network transport (which cannot reach LAN printers from Vercel).
 *   - USB/OTG (WebUSB) and Browser printing in the webapp remain unchanged.
 *
 * Configure the URL in Config.kt before building.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)

        webView.settings.apply {
            javaScriptEnabled = true     // required — the POS webapp is a React SPA
            domStorageEnabled = true     // localStorage + IndexedDB (printer config)
            allowFileAccess = false      // no local file access needed
            useWideViewPort = true       // respect the webapp's viewport meta tag
            loadWithOverviewMode = true
            setSupportZoom(false)        // POS UI has fixed layout; disable pinch-zoom
            builtInZoomControls = false
        }

        // Inject the printer bridge BEFORE loadUrl so window.AndroidPrinter is
        // available as soon as the page's JavaScript runs.
        // Use applicationContext to avoid leaking the Activity via the bridge reference.
        webView.addJavascriptInterface(PrinterBridge(applicationContext), "AndroidPrinter")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // Keep all navigation inside the WebView (Next.js client-side routing)
                return false
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                Log.e(TAG, "WebView error: ${error.errorCode} ${error.description} for ${request.url}")
            }
        }

        // Forward console.log / console.error from the webapp to Logcat for debugging
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                val level = when (message.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR   -> Log.ERROR
                    ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                    else                                -> Log.DEBUG
                }
                Log.println(level, "WebConsole", "${message.message()} — ${message.sourceId()}:${message.lineNumber()}")
                return true
            }
        }

        // Enable Chrome DevTools remote debugging in debug builds
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
            Log.d(TAG, "WebView remote debugging enabled")
        }

        Log.d(TAG, "Loading POS URL: ${Config.POS_URL}")
        webView.loadUrl(Config.POS_URL)
    }

    override fun onBackPressed() {
        // Navigate back within the webapp instead of closing the activity
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
