// Native shell bridge client used by the web UI.
//
// Two modes:
// 1. INSIDE the StremioFlix desktop app (WebView2): window.chrome.webview is
//    injected by the host. We post {cmd} messages (mpv-play, mpv-seek, ...)
//    and receive {type,value} events (mpv-time, mpv-duration, mpv-ended, ...)
//    from the embedded libmpv engine rendering behind the transparent UI.
// 2. IN A BROWSER: fall back to the localhost bridge (127.0.0.1:11471) if a
//    standalone native helper is running; otherwise the HTML5 engine is used.

export const NATIVE_BRIDGE = 'http://127.0.0.1:11471';

interface WV {
  postMessage(msg: unknown): void;
  addEventListener(type: string, cb: (e: { data: unknown }) => void): void;
  removeEventListener(type: string, cb: (e: { data: unknown }) => void): void;
}

/** Injected by the Android app (MainActivity) via addJavascriptInterface. */
interface AndroidNative {
  play(url: string, title: string, subs: string): void;
  version(): string;
}

function wv(): WV | null {
  const c = (window as unknown as { chrome?: { webview?: WV } }).chrome;
  const v = c?.webview;
  return v && typeof v.postMessage === 'function' ? v : null;
}

function android(): AndroidNative | null {
  const a = (window as unknown as { StremioFlixNative?: AndroidNative }).StremioFlixNative;
  return a && typeof a.play === 'function' ? a : null;
}

/** True when running inside the Android app (WebView + native ExoPlayer handoff). */
export function isAndroidShell(): boolean {
  return android() !== null;
}

/** True when running inside the StremioFlix desktop shell. */
export function isNativeShell(): boolean {
  return wv() !== null;
}

export interface NativeEvent {
  type: string;
  value: string;
}

/** Subscribe to native events (mpv-time / mpv-duration / mpv-pause / mpv-ended / mpv-error). Returns unsubscribe. */
export function onNativeEvent(cb: (ev: NativeEvent) => void): () => void {
  const v = wv();
  if (!v) return () => undefined;
  const handler = (e: { data: unknown }) => {
    try {
      const d: unknown = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (d && typeof (d as NativeEvent).type === 'string') cb(d as NativeEvent);
    } catch { /* ignore malformed frames */ }
  };
  v.addEventListener('message', handler);
  return () => v.removeEventListener('message', handler);
}

function send(cmd: string, extra?: Record<string, unknown>): boolean {
  const v = wv();
  if (!v) return false;
  v.postMessage({ cmd, ...(extra ?? {}) });
  return true;
}

export async function nativeAvailable(): Promise<boolean> {
  if (isNativeShell() || isAndroidShell()) return true;
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(NATIVE_BRIDGE + '/status', { signal: ctl.signal });
    window.clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json();
    return j?.ok === true && j?.mpv === true;
  } catch {
    return false;
  }
}

export async function nativePlay(url: string, title?: string, subsJson?: string): Promise<boolean> {
  const a = android();
  if (a) {
    // Android: hand the stream to the native ExoPlayer activity (MKV/AC3/DTS...).
    try { a.play(url, title ?? url, subsJson ?? '[]'); return true; } catch { return false; }
  }
  if (send('mpv-play', { url, title: title ?? url })) return true;
  try {
    const res = await fetch(NATIVE_BRIDGE + '/mpv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'play', url, title: title ?? url }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function nativeStop(): Promise<void> {
  if (android()) return; // Android player owns its own lifecycle
  if (send('mpv-stop')) return;
  try {
    await fetch(NATIVE_BRIDGE + '/mpv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'stop' }),
    });
  } catch { /* noop */ }
}

export function nativePause(): void {
  if (!send('mpv-pause')) void fetch(NATIVE_BRIDGE + '/mpv', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'pause' }),
  }).catch(() => undefined);
}

export function nativeSeek(seconds: number): void {
  send('mpv-seek', { value: seconds });
}

export function nativeSeekRel(delta: number): void {
  send('mpv-seek-rel', { value: delta });
}

export function nativeVolume(percent: number): void {
  send('mpv-volume', { value: percent });
}

export function nativeSpeed(rate: number): void {
  send('mpv-speed', { value: rate });
}

export function nativeCycleAudio(): void {
  send('mpv-audio');
}

export function nativeCycleSub(): void {
  send('mpv-sub');
}

/** Toggle true borderless-maximized fullscreen of the desktop app window. */
export function nativeAppFullscreen(): void {
  send('app-fullscreen');
}

// ---------- mpv track/subtitle GUI protocol (desktop shell) ----------

export interface MpTrack {
  type: string; // video | audio | sub
  id: number;
  lang?: string;
  title?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
}

export interface MpTracks {
  tracks: MpTrack[];
  aid: string;
  sid: string;
}

/** Ask the host for the current mpv track list; reply arrives as a 'mpv-tracks' event. */
export function nativeRequestTracks(): void {
  send('mpv-tracks');
}

/** Select a track: kind 'aid'|'sid'|'vsid', id numeric string or 'no' (subtitles off). */
export function nativeSelectTrack(kind: 'aid' | 'sid', id: string): void {
  send('mpv-select-track', { a: kind, b: id });
}

/** Whitelisted mpv subtitle options: sub-font | sub-color | sub-border-color | sub-scale | sub-delay. */
export function nativeSetSubOption(name: string, value: string): void {
  send('mpv-set', { a: name, b: value });
}

