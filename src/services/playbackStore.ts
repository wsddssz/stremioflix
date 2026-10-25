// Playback persistence: resume positions + per-title auto-play source prefs.
// Keys are stable across addons/sources: type:metaId:videoId (videoId = metaId for movies).
import type { StreamObject } from '../stremio/types';

const RESUME_KEY = 'stremioflix.resume';
const AUTOPLAY_KEY = 'stremioflix.autoplay';
const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // forget positions older than 30 days

export interface ResumeEntry {
  pos: number; // seconds
  dur: number; // seconds (0 = unknown)
  at: number; // last watched (epoch ms)
}

export function resumeKey(type: string, metaId: string, videoId: string): string {
  return `${type}:${metaId}:${videoId}`;
}

function readMap<T>(storageKey: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj as Record<string, T> : {};
  } catch {
    return {};
  }
}

function writeMap<T>(storageKey: string, map: Record<string, T>): void {
  try { localStorage.setItem(storageKey, JSON.stringify(map)); } catch { /* quota/private mode */ }
}

/** Last watched position for a video, or null (missing / stale / effectively finished). */
export function getResume(key: string): ResumeEntry | null {
  const e = readMap<ResumeEntry>(RESUME_KEY)[key];
  if (!e || typeof e.pos !== 'number' || e.pos < 10) return null;
  if (e.at && Date.now() - e.at > RESUME_MAX_AGE_MS) return null;
  // Treat ≥95% watched as finished — restart from the beginning like Netflix.
  if (e.dur > 0 && e.pos / e.dur >= 0.95) return null;
  return e;
}

export function saveResume(key: string, pos: number, dur: number): void {
  if (pos < 10) return; // ignore intros
  const map = readMap<ResumeEntry>(RESUME_KEY);
  map[key] = { pos, dur, at: Date.now() };
  writeMap(RESUME_KEY, map);
}

export function clearResume(key: string): void {
  const map = readMap<ResumeEntry>(RESUME_KEY);
  if (!(key in map)) return;
  delete map[key];
  writeMap(RESUME_KEY, map);
}

// ---- Per-title auto-play source (default addon + preferred resolution) ----

export interface AutoPlayPref {
  addonUrl: string;
  addonName: string;
  /** 'auto' = best available; otherwise a label like '2160p'/'1080p'/'720p'/'480p'. */
  resolution: string;
}

export const RESOLUTION_CHOICES = ['auto', '2160p', '1080p', '720p', '480p'] as const;

export function getAutoPlayPref(metaId: string): AutoPlayPref | null {
  const p = readMap<AutoPlayPref>(AUTOPLAY_KEY)[metaId];
  return p && p.addonUrl ? p : null;
}

export function setAutoPlayPref(metaId: string, pref: AutoPlayPref): void {
  const map = readMap<AutoPlayPref>(AUTOPLAY_KEY);
  map[metaId] = pref;
  writeMap(AUTOPLAY_KEY, map);
}

export function clearAutoPlayPref(metaId: string): void {
  const map = readMap<AutoPlayPref>(AUTOPLAY_KEY);
  if (!(metaId in map)) return;
  delete map[metaId];
  writeMap(AUTOPLAY_KEY, map);
}

function qualityRankOf(s: StreamObject): number {
  const t = ((s.name || '') + ' ' + (s.title || '') + ' ' + (s.description || '') + ' ' + (s.behaviorHints?.filename || '')).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(t)) return 0;
  if (/\b1080p\b/.test(t)) return 1;
  if (/\b720p\b/.test(t)) return 2;
  if (/\b480p\b/.test(t)) return 3;
  return 4;
}

function matchesResolution(s: StreamObject, res: string): boolean {
  const want = res.toLowerCase().replace(/p$/, ''); // '1080p' -> '1080'
  const t = ((s.name || '') + ' ' + (s.title || '') + ' ' + (s.description || '') + ' ' + (s.behaviorHints?.filename || '')).toLowerCase();
  return new RegExp(`\\b${want}p?\\b`).test(t);
}

/**
 * Pick a stream for a title's auto-play pref: streams from the preferred addon
 * only, best quality first. A specific resolution is matched by name; when the
 * addon has no such resolution (older movies/series), it falls back through
 * lower resolutions and finally to the best available (auto mode).
 */
export function pickAutoStream(streams: StreamObject[], pref: AutoPlayPref): StreamObject | null {
  const fromAddon = streams
    .filter((s) => !s.ytId && s.addonUrl === pref.addonUrl)
    .sort((a, b) => qualityRankOf(a) - qualityRankOf(b));
  if (fromAddon.length === 0) return null;
  if (!pref.resolution || pref.resolution === 'auto') return fromAddon[0];
  const exact = fromAddon.find((s) => matchesResolution(s, pref.resolution));
  if (exact) return exact;
  // No exact match — walk down through lower resolutions, then best available.
  const order = ['2160p', '1080p', '720p', '480p'];
  const wantIdx = order.indexOf(pref.resolution);
  for (let i = wantIdx + 1; i < order.length; i++) {
    const hit = fromAddon.find((s) => matchesResolution(s, order[i]));
    if (hit) return hit;
  }
  for (let i = wantIdx - 1; i >= 0; i--) {
    const hit = fromAddon.find((s) => matchesResolution(s, order[i]));
    if (hit) return hit;
  }
  return fromAddon[0];
}