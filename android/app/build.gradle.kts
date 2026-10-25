plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.stremioflix.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.stremioflix.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
    sourceSets {
        getByName("main") {
            // Bundled Netflix web UI (synced from ../dist by the bundleWebUi task)
            assets.srcDir(layout.buildDirectory.dir("generated/assets"))
        }
    }
}

// Keeps app/src/main/assets in sync with the web build output.
val bundleWebUi by tasks.registering(Sync::class) {
    description = "Copies the built web UI (../../dist) into the Android assets."
    from(rootProject.layout.projectDirectory.dir("../dist"))
    into(layout.buildDirectory.dir("generated/assets"))
}

afterEvaluate {
    tasks.named("preBuild").configure { dependsOn(bundleWebUi) }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.webkit)
    implementation(libs.material)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)
    implementation(libs.media3.exoplayer.hls)
}
