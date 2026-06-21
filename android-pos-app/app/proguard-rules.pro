# Keep @JavascriptInterface methods — ProGuard would strip them otherwise
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
