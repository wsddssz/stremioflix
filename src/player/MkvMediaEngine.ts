// Universal MKV Media Engine — Part 1: probing + subtitle parsing.
// Dual-layer playback: (A) native HTML5 / HLS, (B) FFmpeg.wasm MKV demux + MSE.

import Hls from 'hls.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export type EngineMode = 'native' | 'hls' | 'mkv-remux' | 'progressive';

export interface AudioTrackInfo {
  id: string;
  label: string;
  language?: string;
  codec?: string;
  index: number;
}

export interface SubtitleTrackInfo {
  id: string;
  label: string;
  language?: string;
  kind: 'embedded' | 'external';
  url?: string;
}

export interface ProbeResult {
  mode: EngineMode;
  container: string;
  needsRemux: boolean;
  reason: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const UNSUPPORTED_AUDIO = ['ac3', 'e-ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'mlp'];

export function extOf(url: string): string {
  try {
    const clean = url.split('?')[0].split('#')[0];
    const parts = clean.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
  } catch {
    return '';
  }
}

export function probeUrl(url: string, behaviorHints?: { filename?: string }): ProbeResult {
  const ext = extOf(behaviorHints?.filename ?? url);
  if (ext === 'm3u8') {
    return { mode: 'hls', container: 'hls', needsRemux: false, reason: 'HLS manifest detected' };
  }
  if (ext === 'mkv') {
    return { mode: 'mkv-remux', container: 'matroska', needsRemux: true, reason: 'MKV container requires demux/remux' };
  }
  if (ext === 'avi' || ext === 'ts' || ext === 'm2ts' || ext === 'vob') {
    return { mode: 'mkv-remux', container: ext, needsRemux: true, reason: 'Legacy container requires remux' };
  }
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov' || ext === 'webm') {
    return { mode: 'native', container: ext, needsRemux: false, reason: 'Browser-compatible container' };
  }
  return { mode: 'native', container: ext || 'unknown', needsRemux: false, reason: 'Unknown container, trying native first' };
}

function toSeconds(t: string): number {
  const m = t.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
  if (!m) {
    const m2 = t.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})/);
    if (!m2) return 0;
    const h = m2[1] ? parseInt(m2[1], 10) : 0;
    return h * 3600 + parseInt(m2[2], 10) * 60 + parseInt(m2[3], 10);
  }
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const ms = parseInt(m[4].padEnd(3, '0').slice(0, 3), 10);
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + ms / 1000;
}

function stripAssTags(s: string): string {
  return s
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeIdx = /-->/.test(lines[0]) ? 0 : 1;
    const tm = lines[timeIdx]?.match(/(.+?)\s*-->\s*(.+)/);
    if (!tm) continue;
    cues.push({ start: toSeconds(tm[1]), end: toSeconds(tm[2]), text: lines.slice(timeIdx + 1).join('\n') });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseVtt(text: string): Cue[] {
  const body = text.replace(/^WEBVTT[^\n]*\n/, '');
  return parseSrt(body);
}

export function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('Dialogue:')) continue;
    const payload = t.slice('Dialogue:'.length);
    const parts = payload.split(',');
    if (parts.length < 10) continue;
    const start = toSeconds(parts[1]);
    const end = toSeconds(parts[2]);
    const clean = stripAssTags(parts.slice(9).join(','));
    if (clean) cues.push({ start, end, text: clean });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitleText(text: string, hint?: string): Cue[] {
  const h = (hint ?? '').toLowerCase();
  if (h.includes('ass') || text.includes('[V4+ Styles]') || text.includes('Dialogue:')) return parseAss(text);
  if (h.includes('vtt') || text.trimStart().startsWith('WEBVTT')) return parseVtt(text);
  return parseSrt(text);
}

export async function loadExternalCues(url: string): Promise<Cue[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Subtitle fetch failed: ' + res.status);
  const text = await res.text();
  return parseSubtitleText(text, extOf(url));
}

export function isUnsupportedAudioCodec(codec?: string): boolean {
  if (!codec) return false;
  return UNSUPPORTED_AUDIO.includes(codec.toLowerCase());
}

export function guessInputExt(url: string): string {
  const e = extOf(url);
  if (e === 'mkv') return '.mkv';
  if (e === 'avi') return '.avi';
  if (e === 'ts' || e === 'm2ts') return '.ts';
  if (e === 'webm') return '.webm';
  return '.mp4';
}

// Re-exported for tree-shaking friendliness; engine class lives in MkvEngine.ts.
export type { Hls as HlsType };
export { FFmpeg, fetchFile };
