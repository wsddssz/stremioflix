package com.stremioflix.app

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.TrackGroup
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Native player: ExoPlayer (media3) handles MKV/Matroska containers, HLS,
 * MP4/WebM and device-supported audio codecs; external subtitles (SRT/VTT/ASS)
 * arrive from the web UI as a JSON array extra. Errors render on screen.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView
    private var errorView: TextView? = null
    private var currentUrl: String = ""
    private var resumeOnStart = false

    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("player", MODE_PRIVATE) }

    // Subtitle style (persisted) + custom subtitle renderer state.
    private var subFontFamily = "sans-serif"
    private var subSizeFactor = 1f
    private var subTextColor = Color.WHITE
    private var subDelayMs = 0L
    private var subTextView: TextView? = null
    private var externalUrls = listOf<Pair<String, String>>() // url, lang
    private val customSubs = mutableListOf<CustomSubEntry>()
    private var customIdx = -1
    private var subMode = 0 // 0 = off, 1 = embedded (media3), 2 = custom external
    private var audioOverride: TrackSelectionOverride? = null
    private var textOverride: TrackSelectionOverride? = null
    private var fetchSeq = 0

    private fun setCrashSafeHandlers() {
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runOnUiThread {
                AlertDialog.Builder(this)
                    .setTitle("StremioFlix crashed")
                    .setMessage("The player encountered an unexpected error and had to close.\n\n${e.javaClass.simpleName}: ${e.message}\n\nIf this keeps happening, please reinstall the app or contact support.")
                    .setPositiveButton("OK") { _, _ -> finish() }
                    .setCancelable(false)
                    .show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setCrashSafeHandlers()
        try {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

            // Android TV / leanback: immersive fullscreen, hide system bars
            val isTV = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
            if (isTV) {
                window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                )
            }

            subFontFamily = prefs.getString("sf", "sans-serif") ?: "sans-serif"
            subSizeFactor = prefs.getFloat("sc", 1f)
            subTextColor = prefs.getInt("scol", Color.WHITE)
            subDelayMs = prefs.getLong("sd", 0L)

        val root = FrameLayout(this)
        playerView = PlayerView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            controllerShowTimeoutMs = 4000
        }
        root.addView(playerView)

        errorView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            setBackgroundColor(0xE6000000.toInt())
            visibility = View.GONE
            setPadding(dp(32), dp(32), dp(32), dp(32))
        }
        root.addView(
            errorView!!,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )

        // Attach the root layout to the Activity window so the player view is
        // actually rendered. Without this, the window hierarchy is empty, the
        // player never paints, and the subtitle fetch/tick threads run forever
        // until the system kills the process.
        setContentView(root)
        subTextView = TextView(this).apply {
            setTextColor(subTextColor)
            textSize = 18f * subSizeFactor
            typeface = Typeface.create(subFontFamily, Typeface.NORMAL)
            gravity = Gravity.CENTER
            setShadowLayer(4f, 0f, 0f, Color.BLACK)
            visibility = View.GONE
            setPadding(dp(16), dp(6), dp(16), dp(6))
        }
        root.addView(
            subTextView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            ).apply { bottomMargin = dp(110); leftMargin = dp(24); rightMargin = dp(24) }
        )

        // Top-right control chips: Audio track picker · Subtitles (CC) · Subtitle style.
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val chipLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dp(8) }
        bar.addView(chip("Audio") { showAudioDialog() }, chipLp)
        bar.addView(chip("CC") { showSubtitleDialog() }, chipLp)
        bar.addView(chip("Style") { showStyleDialog() }, chipLp)
        root.addView(
            bar,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            ).apply { topMargin = dp(34); rightMargin = dp(16) }
        )

        hideSystemBars()

        handler.post(tickRunnable)
        } catch (e: Exception) {
            runOnUiThread {
                AlertDialog.Builder(this)
                    .setTitle("StremioFlix crashed")
                    .setMessage("The player encountered an unexpected error and had to close.\n\n${e.javaClass.simpleName}: ${e.message}\n\nIf this keeps happening, please reinstall the app or contact support.")
                    .setPositiveButton("OK") { _, _ -> finish() }
                    .setCancelable(false)
                    .show()
            }
            finish()
        }

        val url = intent.getStringExtra("url")
        if (url.isNullOrEmpty()) { finish(); return }
        loadMedia(url, intent.getStringExtra("title") ?: url, intent.getStringExtra("subs") ?: "[]")
    }

    /**
     * Load [url] into the existing ExoPlayer. Called from onCreate and from
     * onNewIntent (singleTask) so episode/source switches from the web UI
     * replace the current stream in place instead of stacking a new activity.
     */
    private fun loadMedia(url: String, title: String, subsJson: String) {
        currentUrl = url
        val isNewPlayer = player == null
        val exo = player ?: ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this)))
            .build()
        player = exo
        playerView.player = exo

        // Reset per-stream state before attaching the new media item.
        fetchSeq++
        customSubs.clear()
        customIdx = -1
        subMode = 0
        audioOverride = null
        textOverride = null
        subTextView?.visibility = View.GONE
        errorView?.visibility = View.GONE

        val mime = guessMime(url)
        val item = MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
            .apply { if (mime != null) setMimeType(mime) }
            .build()

        // Attach the error listener only once per player instance — loadMedia
        // reuses the ExoPlayer across source/episode switches (onNewIntent).
        if (isNewPlayer) exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                errorView?.text = "Playback failed\n\n" +
                    error.errorCodeName + ": " + error.message + "\n\n" + currentUrl.take(200)
                errorView?.visibility = View.VISIBLE
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) errorView?.visibility = View.GONE
            }
        })
        exo.setMediaItem(item)
        exo.playWhenReady = true
        exo.prepare()

        // External subs are fetched + rendered by us (supports font/size/color/delay).
        externalUrls = parseSubUrls(subsJson)
        if (externalUrls.isNotEmpty()) fetchExternalSubs(externalUrls)

        // Subtitles default OFF; the CC menu enables embedded (media3) or custom tracks.
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .build()
    }

    /** singleTask re-delivery: the web UI called play() again (episode or source switched). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = intent.getStringExtra("url")
        if (url.isNullOrEmpty()) return
        loadMedia(url, intent.getStringExtra("title") ?: url, intent.getStringExtra("subs") ?: "[]")
    }

    override fun onStart() {
        super.onStart()
        if (resumeOnStart) {
            resumeOnStart = false
            player?.play()
        }
    }

    override fun onStop() {
        super.onStop()
        player?.let {
            if (it.isPlaying) {
                resumeOnStart = true
                it.pause()
            }
        }
    }

    override fun onDestroy() {
        fetchSeq++
        handler.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        super.onDestroy()
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    /** Subtitles JSON: [{"url":"...","lang":"en"}, ...] — bitmap formats skipped. */
    private fun parseSubUrls(json: String): List<Pair<String, String>> = try {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val u = o.optString("url")
            if (u.isEmpty()) return@mapNotNull null
            // Bitmap subs (PGS/SUP) cannot be rendered as text — skip them.
            if (u.endsWith(".sup", true) || u.endsWith(".pgs", true)) return@mapNotNull null
            u to o.optString("lang")
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun guessMime(url: String): String? = when {
        url.contains(".m3u8", ignoreCase = true) -> MimeTypes.APPLICATION_M3U8
        url.contains(".mkv", ignoreCase = true) -> MimeTypes.VIDEO_MATROSKA
        url.contains(".webm", ignoreCase = true) -> MimeTypes.VIDEO_WEBM
        url.contains(".mp4", ignoreCase = true) -> MimeTypes.VIDEO_MP4
        url.contains(".mp3", ignoreCase = true) -> MimeTypes.AUDIO_MPEG
        url.contains(".aac", ignoreCase = true) -> MimeTypes.AUDIO_AAC
        else -> null
    }

    private fun guessSubMime(url: String): String = when {
        url.endsWith(".vtt", true) || url.contains("format=vtt", true) -> "text/vtt"
        url.endsWith(".ass", true) || url.endsWith(".ssa", true) -> "text/x-ssa"
        else -> "application/x-subrip"
    }

    private fun chip(label: String, onClick: () -> Unit): TextView = TextView(this).apply {
        text = label
        setTextColor(Color.WHITE)
        textSize = 13f
        setPadding(dp(14), dp(8), dp(14), dp(8))
        setBackgroundColor(0xAA000000.toInt())
        setOnClickListener { onClick() }
    }

    /** Rebuild TrackSelectionParameters from our audio/subtitle state machine. */
    private fun applyParams() {
        val p = player ?: return
        var b = p.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
        audioOverride?.let { b = b.addOverride(it) }
        if (subMode == 1) textOverride?.let { b = b.addOverride(it) }
        p.trackSelectionParameters = b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subMode != 1).build()
    }

    private fun showAudioDialog() {
        val p = player ?: return
        val entries = mutableListOf<Pair<Tracks.Group, Int>>()
        val labels = mutableListOf<String>()
        p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.forEach { g ->
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                val f = g.getTrackFormat(i)
                val parts = mutableListOf<String>()
                f.language?.let { parts.add(it) }
                f.label?.let { if (!parts.contains(it)) parts.add(it) }
                f.sampleMimeType?.let { parts.add(it.substringAfterLast('/').uppercase()) }
                if (parts.isEmpty()) parts.add("Audio ${i + 1}")
                entries.add(g to i)
                labels.add(parts.joinToString(" · "))
            }
        }
        if (entries.isEmpty()) return
        val checked = entries.indexOfFirst { (g, i) -> g.isTrackSelected(i) }
        AlertDialog.Builder(this)
            .setTitle("Audio track")
            .setSingleChoiceItems(labels.toTypedArray(), checked) { d, which ->
                audioOverride = TrackSelectionOverride(entries[which].first.mediaTrackGroup, listOf(entries[which].second))
                applyParams()
                d.dismiss()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showSubtitleDialog() {
        val p = player ?: return
        val labels = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()
        labels.add("Off"); actions.add { subMode = 0; textOverride = null; customIdx = -1; applyParams() }
        var n = 0
        p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }.forEach { g ->
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                val f = g.getTrackFormat(i)
                val lbl = listOfNotNull(f.language, f.label).joinToString(" · ").ifEmpty { "Embedded ${n + 1}" }
                labels.add("Embedded · $lbl")
                actions.add { subMode = 1; textOverride = TrackSelectionOverride(g.mediaTrackGroup, listOf(i)); customIdx = -1; applyParams() }
                n++
            }
        }
        customSubs.forEachIndexed { idx, entry ->
            labels.add("Downloaded · ${entry.label}")
            actions.add { subMode = 2; textOverride = null; customIdx = idx; applyParams() }
        }
        if (externalUrls.isNotEmpty() && customSubs.size < externalUrls.size) {
            labels.add("Downloading subtitles… (${customSubs.size}/${externalUrls.size})")
            actions.add { }
        }
        labels.add("Subtitle settings…")
        actions.add { showStyleDialog() }
        AlertDialog.Builder(this)
            .setTitle("Subtitles")
            .setItems(labels.toTypedArray()) { d, i -> actions[i](); d.dismiss() }
            .show()
    }

    private fun showStyleDialog() {
        val labels = arrayOf("Font…", "Size…", "Color…", "Delay…")
        AlertDialog.Builder(this)
            .setTitle("Subtitle style")
            .setItems(labels) { _, i ->
                when (i) {
                    0 -> pickFont()
                    1 -> pickSize()
                    2 -> pickColor()
                    3 -> pickDelay()
                }
            }
            .show()
    }

    private fun pickFont() {
        val fonts = listOf(
            "sans-serif" to "Sans (Roboto)", "serif" to "Serif", "monospace" to "Monospace",
            "cursive" to "Cursive", "casual" to "Casual", "sans-serif-condensed" to "Condensed"
        )
        val checked = fonts.indexOfFirst { it.first == subFontFamily }.coerceAtLeast(0)
        AlertDialog.Builder(this).setTitle("Font")
            .setSingleChoiceItems(fonts.map { it.second }.toTypedArray(), checked) { d, which ->
                subFontFamily = fonts[which].first
                prefs.edit().putString("sf", subFontFamily).apply()
                subTextView?.typeface = Typeface.create(subFontFamily, Typeface.NORMAL)
                d.dismiss()
            }.show()
    }

    private fun pickSize() {
        val sizes = doubleArrayOf(0.7, 0.85, 1.0, 1.15, 1.3, 1.5, 1.7, 2.0)
        val checked = sizes.indexOfFirst { kotlin.math.abs(it - subSizeFactor) < 0.01 }.coerceAtLeast(0)
        AlertDialog.Builder(this).setTitle("Size")
            .setSingleChoiceItems(sizes.map { "${(it * 100).toInt()}%" }.toTypedArray(), checked) { d, which ->
                subSizeFactor = sizes[which].toFloat()
                prefs.edit().putFloat("sc", subSizeFactor).apply()
                subTextView?.textSize = 18f * subSizeFactor
                d.dismiss()
            }.show()
    }

    private fun pickColor() {
        val colors = listOf(
            "White" to Color.WHITE, "Yellow" to 0xFFFFFF00.toInt(), "Cyan" to 0xFF00FFFF.toInt(),
            "Green" to 0xFF00FF66.toInt(), "Red" to 0xFFFF6666.toInt(),
            "Orange" to 0xFFFF8C00.toInt(), "Black" to Color.BLACK
        )
        val checked = colors.indexOfFirst { it.second == subTextColor }.coerceAtLeast(0)
        AlertDialog.Builder(this).setTitle("Color")
            .setSingleChoiceItems(colors.map { it.first }.toTypedArray(), checked) { d, which ->
                subTextColor = colors[which].second
                prefs.edit().putInt("scol", subTextColor).apply()
                subTextView?.setTextColor(subTextColor)
                d.dismiss()
            }.show()
    }

    private fun pickDelay() {
        val delays = doubleArrayOf(
            -5.0, -3.0, -2.0, -1.5, -1.0, -0.5, -0.3, -0.2, -0.15, -0.1, -0.05,
            0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0
        )
        val checked = delays.indexOfFirst { kotlin.math.abs(it * 1000 - subDelayMs) < 25 }.coerceAtLeast(0)
        AlertDialog.Builder(this).setTitle("Subtitle delay (+ = subtitles later)")
            .setSingleChoiceItems(delays.map { String.format(Locale.US, "%+.2f s", it) }.toTypedArray(), checked) { d, which ->
                subDelayMs = (delays[which] * 1000).toLong()
                prefs.edit().putLong("sd", subDelayMs).apply()
                d.dismiss()
            }.show()
    }

    /** Fetch external subtitle files (SRT/VTT/ASS) on a worker thread. */
    private fun fetchExternalSubs(list: List<Pair<String, String>>) {
        val seq = ++fetchSeq
        Thread {
            // Only fetch custom-subtitle payloads when the custom-subtitle
            // renderer is active. Without this guard a null/empty "custom_sub"
            // extra from the web UI could stall the fetch loop and leak the
            // 80 ms tickRunnable's TextView dereference.
            if (subMode != 2) return@Thread
            for ((u, lang) in list.take(6)) {
                if (seq != fetchSeq) return@Thread
                try {
                    val conn = URL(u).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10000
                    conn.readTimeout = 10000
                    val text = conn.inputStream.bufferedReader().use { it.readText() }
                    conn.disconnect()
                    if (text.isBlank()) continue
                    val cues = parseCueText(text, u)
                    if (cues.isNotEmpty()) {
                        runOnUiThread {
                            if (seq != fetchSeq) return@runOnUiThread
                            customSubs.add(CustomSubEntry((lang.ifEmpty { "Sub" }) + " #${customSubs.size + 1}", lang, cues))
                        }
                    }
                } catch (_: Exception) { }
            }
        }.start()
    }

    /** SRT/VTT/ASS parsing into timed cues (ASS override tags stripped). */
    private fun parseCueText(text: String, url: String): List<TCue> {
        val out = mutableListOf<TCue>()
        if (text.contains("Dialogue:")) {
            val re = Regex("(\\d+):(\\d{1,2}):(\\d{1,2})[.:](\\d{1,2})")
            for (line in text.lines()) {
                if (!line.startsWith("Dialogue:")) continue
                val parts = line.substring("Dialogue:".length).split(",", limit = 10)
                if (parts.size < 10) continue
                val st = assTime(re, parts[1]) ?: continue
                val en = assTime(re, parts[2]) ?: continue
                val body = parts[9].replace(Regex("\\{[^}]*}"), "").replace("\\N", "\n").replace("\\n", "\n").trim()
                if (body.isNotEmpty()) out.add(TCue(st, en, body))
            }
            return out
        }
        val body = if (text.contains("WEBVTT")) text.substringAfter("WEBVTT") else text
        val timeRe = Regex("(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{1,3})\\s*-->\\s*(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{1,3})")
        for (block in body.split(Regex("\\r?\\n\\s*\\r?\\n"))) {
            val m = timeRe.find(block) ?: continue
            val g = m.groupValues
            fun ms(h: String, mi: String, s: String, frac: String): Long =
                h.toLong() * 3600000 + mi.toLong() * 60000 + s.toLong() * 1000 + frac.padEnd(3, '0').take(3).toLong()
            val start = ms(g[1], g[2], g[3], g[4])
            val end = ms(g[5], g[6], g[7], g[8])
            val content = block.substring(m.range.last + 1).lines()
                .filter { it.isNotBlank() && !it.all { ch -> ch.isDigit() } }
                .joinToString("\n").trim()
            if (content.isNotEmpty()) out.add(TCue(start, end, content))
        }
        return out
    }

    private fun assTime(re: Regex, s: String): Long? {
        val m = re.find(s.trim()) ?: return null
        val g = m.groupValues
        return g[1].toLong() * 3600000 + g[2].toLong() * 60000 + g[3].toLong() * 1000 + g[4].padEnd(2, '0').take(2).toLong() * 10
    }

    /** 80 ms render loop for custom subtitle cues with delay applied. */
    private val tickRunnable = object : Runnable {
        override fun run() {
            val p = player
            if (p != null && subMode == 2 && customIdx in customSubs.indices) {
                val cues = customSubs[customIdx].cues
                val pos = p.currentPosition - subDelayMs
                val hit = cues.firstOrNull { pos in it.s..it.e }
                val tv = subTextView
                if (hit != null) {
                    tv?.text = hit.t
                    if (tv?.visibility != View.VISIBLE) tv?.visibility = View.VISIBLE
                } else if (tv?.visibility != View.GONE) {
                    tv?.visibility = View.GONE
                }
            } else if (subMode != 0 && subTextView?.visibility != View.GONE) {
                subTextView?.visibility = View.GONE
            }
            handler.postDelayed(this, 80)
        }
    }

    data class TCue(val s: Long, val e: Long, val t: String)
    data class CustomSubEntry(val label: String, val lang: String, val cues: List<TCue>)

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    /** Handle Android TV remote / D-pad and media key events. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_BUTTON_A,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                player?.let { p ->
                    if (p.playWhenReady) p.pause() else p.play()
                }
                return true
            }
            KeyEvent.KEYCODE_MEDIA_PLAY -> { player?.play(); return true }
            KeyEvent.KEYCODE_MEDIA_PAUSE -> { player?.pause(); return true }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                val pos = (player?.currentPosition ?: 0L) + 10000L
                player?.seekTo(pos)
                return true
            }
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                val pos = (player?.currentPosition ?: 0L) - 10000L
                player?.seekTo(pos.coerceAtLeast(0))
                return true
            }
            KeyEvent.KEYCODE_BACK -> {
                finish()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }
}
