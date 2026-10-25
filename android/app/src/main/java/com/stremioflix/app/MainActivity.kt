package com.stremioflix.app

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader

/**
 * Netflix-style shell: loads the bundled StremioFlix web UI through
 * WebViewAssetLoader (secure https://appassets.androidplatform.net origin so
 * ES modules + fetch behave exactly like a normal web deployment).
 * Streams are handed to PlayerActivity (native ExoPlayer) through the
 * StremioFlixNative JavaScript interface.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Thread.setDefaultUncaughtExceptionHandler { _, e ->
            try {
                android.util.Log.e("StremioFlix", "FATAL", e)
            } catch (_: Exception) { }
        }
        web = WebView(this)
        setContentView(web)

        val s: WebSettings = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.loadWithOverviewMode = true
        s.useWideViewPort = true

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url.toString()
                if (url.startsWith("stremioflix://play?u=")) {
                    val video = android.net.Uri.decode(url.substringAfter("u="))
                    openPlayer(video, video, "[]")
                    return true
                }
                return false
            }
        }
        web.addJavascriptInterface(Bridge(), "StremioFlixNative")

        if (hasBundledUi()) {
            web.loadUrl("https://appassets.androidplatform.net/index.html?android=1")
        } else {
            // Dev fallback: Vite dev server running on the host PC (see npm run dev).
            web.loadUrl("http://10.0.2.2:5173/?android=1")
        }
    }

    private fun hasBundledUi(): Boolean = try {
        assets.open("index.html").close()
        true
    } catch (_: Exception) {
        false
    }

    private fun openPlayer(url: String, title: String, subs: String) {
        startActivity(
            Intent(this, PlayerActivity::class.java).apply {
                putExtra("url", url)
                putExtra("title", title)
                putExtra("subs", subs)
            }
        )
    }

    inner class Bridge {
        /** Called by the web UI: [subs] is a JSON array of {url, lang} subtitle objects. */
        @JavascriptInterface
        fun play(url: String, title: String, subs: String) {
            runOnUiThread { openPlayer(url, title, subs) }
        }

        @JavascriptInterface
        fun version(): String = "stremioflix-android/1.0.0"

        /** Returns the Android UI mode type: 1=car, 2=desk, 3=television, 4=appliance, 5=watch, 0=unknown */
        @JavascriptInterface
        fun uiMode(): Int {
            return when (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) {
                android.content.res.Configuration.UI_MODE_TYPE_TELEVISION -> 3
                android.content.res.Configuration.UI_MODE_TYPE_CAR -> 1
                android.content.res.Configuration.UI_MODE_TYPE_DESK -> 2
                android.content.res.Configuration.UI_MODE_TYPE_APPLIANCE -> 4
                android.content.res.Configuration.UI_MODE_TYPE_WATCH -> 5
                else -> 0
            }
        }

        /** Returns true if running on Android TV */
        @JavascriptInterface
        fun isTv(): Boolean {
            return (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
        }

        /** Returns true if the device has a touchscreen */
        @JavascriptInterface
        fun hasTouchscreen(): Boolean {
            return packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_TOUCHSCREEN)
        }
    }

    @Suppress("DEPRECATION")
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
