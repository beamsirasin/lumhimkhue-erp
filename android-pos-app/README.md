# Shabu POS — Android App

A minimal Android WebView wrapper for the Shabu POS webapp hosted on Vercel.

## Why this exists

Vercel's cloud servers cannot reach printers on the restaurant's private LAN.
This Android app runs on the POS tablet, opens the hosted webapp in a WebView,
and injects `window.AndroidPrinter` so the webapp can send print jobs directly
to a USB OTG or LAN/WiFi printer — all on-device, no Vercel server involved.

Other printer methods (USB/OTG via WebUSB, Network TCP relay, Browser) in the
webapp remain untouched and work independently of this app.

---

## Prerequisites

- **Android Studio** Hedgehog (2023.1) or newer
- **Android tablet** with USB Host support (for OTG printing)
- OTG adapter cable (USB-A female → USB-C or micro-USB male) if printer uses USB-A
- Printer that supports: USB/OTG *or* LAN/WiFi TCP port 9100

---

## Setup

### 1. Set the POS URL

Edit [`app/src/main/java/com/shabu/posapp/Config.kt`](app/src/main/java/com/shabu/posapp/Config.kt):

```kotlin
const val POS_URL = "https://your-project.vercel.app"
```

Replace `your-project` with your actual Vercel deployment subdomain.

### 2. Open in Android Studio

`File → Open` → select the `android-pos-app` folder.
Android Studio downloads the Gradle wrapper and syncs dependencies automatically.

### 3. Build and install

Connect the tablet via USB, then click **Run ▶** or:

```bash
# If you have the Gradle wrapper JAR (gradle/wrapper/gradle-wrapper.jar)
./gradlew installDebug
```

> **Note:** `gradle-wrapper.jar` is excluded from git (binary file).
> Android Studio downloads it automatically on first sync.
> For command-line builds, run `gradle wrapper --gradle-version=8.6` once.

---

## How it works

```
POS webapp (Next.js/Vercel)
  └─ window.AndroidPrinter.print(JSON.stringify(payload))
       │
       ▼
PrinterBridge.kt  (@JavascriptInterface)
  ├─ parse JSON payload
  ├─ Base64.decode(escposBase64) → byte[]
  └─ dispatch on payload.target:
       ├─ "network" → NetworkPrinter.print(host, port, bytes)
       │                TCP socket to printer on LAN/WiFi
       └─ "usb_otg" → UsbPrinter.print(context, bytes)
                        USB Host API → OTG cable → printer
```

### Payload fields (from webapp → Android)

| Field | Type | Description |
|---|---|---|
| `printerId` | String | Printer config ID from webapp IndexedDB |
| `printerName` | String | Human-readable printer name |
| `method` | String | Always `"android_bridge"` |
| `target` | String | `"usb_otg"` or `"network"` |
| `host` | String? | Printer IP (network target only) |
| `port` | Int? | TCP port, default 9100 (network target only) |
| `paperWidth` | Int | `58` or `80` (mm) |
| `jobType` | String | `receipt` \| `kitchen_order` \| `table_qr` \| `queue_qr` \| `test` |
| `escposBase64` | String | Base64-encoded ESC/POS byte sequence |

---

## Printing via USB OTG

1. Connect an OTG adapter to the tablet.
2. Plug the USB printer cable into the adapter.
3. Android detects the USB printer (class 0x07) via `device_filter.xml`.
4. A system dialog asks whether to open **Shabu POS** and grant USB access.
   Tick "Always open with this app" for permanent permission.
5. The app is now the default handler for that printer device.
6. `UsbPrinter.kt` sends data in 16 KB chunks over bulk transfer endpoint.

**If permission is denied at first print:** The app requests permission at print
time via `UsbManager.requestPermission()` and retries after the user approves.

---

## Printing via Network (LAN/WiFi)

1. Configure the printer's IP address in the webapp's Printer Settings page
   (choose "Android POS App" → "Network LAN/WiFi" as the target).
2. The Android app opens a TCP socket to `host:port` (default 9100) and streams
   the ESC/POS bytes. Connection timeout: 10 seconds.
3. The tablet and the printer must be on the same WiFi network.

---

## Logcat tags

| Tag | Content |
|---|---|
| `AndroidPrinter` | Bridge entry, payload parsed, routing decisions |
| `NetworkPrinter` | TCP connection, success/failure |
| `UsbPrinter` | Device found/not found, permission, bulk transfer |
| `MainActivity` | WebView load, console messages forwarded from JS |
| `WebConsole` | JavaScript `console.log/warn/error` from the webapp |

Filter in Android Studio Logcat: `tag:AndroidPrinter OR tag:NetworkPrinter OR tag:UsbPrinter`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `window.AndroidPrinter` is `undefined` | Not running inside this app | Open the URL through this app, not a browser |
| "ไม่พบ USB printer" | OTG cable not connected or printer off | Connect cable, power on printer |
| "USB permission not yet granted" | First time using printer | Approve the system USB dialog |
| "claim USB interface ไม่สำเร็จ" | Another app holds the USB interface | Close other printing apps |
| Network timeout | Wrong IP/port or different WiFi network | Check printer IP and that tablet and printer are on the same network |
| Garbled Thai text | Wrong Thai codepage in webapp printer settings | Adjust codepage in the webapp's Printer Settings page |

---

## Project structure

```
android-pos-app/
├── app/src/main/
│   ├── AndroidManifest.xml        — permissions, USB host feature, device filter
│   ├── java/com/shabu/posapp/
│   │   ├── Config.kt              — POS_URL (edit before building)
│   │   ├── MainActivity.kt        — WebView setup, bridge injection
│   │   ├── PrintPayload.kt        — data class mirroring AndroidPrintPayload (TS)
│   │   ├── PrinterBridge.kt       — @JavascriptInterface → routes to printers
│   │   └── printing/
│   │       ├── NetworkPrinter.kt  — TCP socket to LAN/WiFi printer
│   │       └── UsbPrinter.kt      — USB Host API, OTG cable, permission flow
│   └── res/
│       ├── layout/activity_main.xml
│       ├── values/strings.xml
│       ├── values/colors.xml
│       └── xml/device_filter.xml  — USB printer class filter (0x07)
├── app/build.gradle.kts
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```
