# StremioFlix Native (Windows, libmpv) + Android

## Windows native shell — real mpv playback for MKV/AC3/DTS/ASS

`native/windows/` is a .NET 8 console app that embeds **libmpv-2.dll** (already in
the workspace root) via P/Invoke and exposes a localhost bridge:

- `GET http://127.0.0.1:11471/status` → `{ ok, mpv }`
- `POST http://127.0.0.1:11471/mpv` → `{ cmd: play|stop|pause|seek, url, title, value }`

### Build & run

```powershell
cd native\windows
copy ..\..\libmpv-2.dll .            # put the DLL next to the exe
dotnet build -c Release
.\bin\Release\net8.0-windows\StremioFlix.Native.exe
```

Requires the .NET 8 SDK (`winget install Microsoft.DotNet.SDK.8`).
mpv plays everything natively: MKV containers, AC3/EAC3/DTS/TrueHD audio,
embedded ASS/SSA subtitles — no browser remux needed.

The web UI auto-detects the bridge: when it's running, the player shows a
**monitor icon (MonitorPlay)**. Clicking it hands the current stream URL to the
native mpv window and pauses the browser element (single-player guarantee —
no more overlapping players).

## Android app

`android/` is a Gradle project (AGP 8.7.3, Kotlin 2.0, compileSdk/targetSdk 35,
minSdk 26):

- `MainActivity` — WebView shell serving the bundled web UI from APK assets via
  WebViewAssetLoader (`https://appassets.androidplatform.net/`). JS can call
  `StremioFlixNative.play(url, title, subsJson)` (subsJson =
  `[{"url": "...", "lang": "en"}]`) to hand the stream to the native player.
- `PlayerActivity` — ExoPlayer (media3) with HLS, Matroska, MP4/WebM and external
  SRT/VTT/ASS subtitle tracks. Add the media3 FFmpeg extension for AC3/DTS audio.

### Build

The web UI is bundled automatically: `npm run build` populates `dist/`, and the
Gradle `bundleWebUi` task copies it into the APK. Then open `android/` in Android
Studio or run `gradlew assembleDebug` (the wrapper downloads Gradle 8.9; needs
Android SDK 35 — path configured in `local.properties`).

For on-device development without bundling, `MainActivity` falls back to
`http://10.0.2.2:5173` (Vite dev server on the host PC) when no bundled
`index.html` is present.
