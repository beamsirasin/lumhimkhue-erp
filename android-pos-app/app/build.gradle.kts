plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.shabu.posapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.shabu.posapp"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        // AGP 8+ disables BuildConfig by default; enable it so MainActivity
        // can check BuildConfig.DEBUG to gate WebView remote debugging.
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Coroutines for non-blocking network / USB I/O from the JS bridge
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
}
