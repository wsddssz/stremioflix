// MkvMediaEngine class — Layer A (native/HLS) + Layer B (WASM remux -> MSE).
import Hls from 'hls.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { probeUrl, parseSubtitleText, loadExternalCues, guessInputExt, UNSUPPORTED_AUDIO } from './MkvMediaEngine';
import type { EngineMode, AudioTrackInfo, SubtitleTrackInfo, Cue } from './MkvMediaEngine';

export interface EngineCallbacks {
  onMode?: (mode: EngineMode, reason: string) => void;
  onError?: (message: string, recoverable: boolean) => void;
  onAudioTracks?: (tracks: AudioTrackInfo[]) => void;
  onSubtitleTracks?: (tracks: SubtitleTrackInfo[]) => void;
  onCues?: (cues: Cue[]) => void;
}

export class MkvMediaEngine {
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private objectUrls: string[] = [];
  private ffmpeg: FFmpeg | null = null;
  private ffmpegLoaded = false;
  private cb: EngineCallbacks = {};
  private activeSubCues: Cue[] = [];
  private activeSubId: string | null = null;
  private embeddedSubs = new Map<string, Cue[]>();

  attach(video: HTMLVideoElement, cb: EngineCallbacks = {}): void {
    this.detach();
    this.video = video;
    this.cb = cb;
  }

  detach(): void {
    try { this.hls?.destroy(); } catch { /* noop */ }
    this.hls = null;
    for (const u of this.objectUrls) {
      try { URL.revokeObjectURL(u); } catch { /* noop */ }
    }
    this.objectUrls = [];
    if (this.video) {
      try { this.video.removeAttribute('src'); this.video.load(); } catch { /* noop */ }
    }
    this.video = null;
    this.activeSubCues = [];
    this.activeSubId = null;
    this.embeddedSubs.clear();
  }

  async load(url: string, hints?: { filename?: string }): Promise<EngineMode> {
    if (!this.video) throw new Error('Engine not attached');
    const probe = probeUrl(url, hints);
    this.cb.onMode?.(probe.mode, probe.reason);
    if (probe.mode === 'hls') { await this.loadHls(url); return 'hls'; }
    if (probe.mode === 'native') {
      try { await this.loadNative(url); return 'native'; }
      catch (e) {
        this.cb.onError?.('Native failed (' + (e instanceof Error ? e.message : '?') + '), using remux.', true);
        return this.loadRemux(url);
      }
    }
    return this.loadRemux(url);
  }

  private loadNative(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const v = this.video!;
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('Native load timed out')); }, 12000);
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error('Element rejected source')); };
      const cleanup = () => {
        window.clearTimeout(timer);
        v.removeEventListener('canplay', ok);
        v.removeEventListener('error', bad);
      };
      v.addEventListener('canplay', ok);
      v.addEventListener('error', bad);
      v.src = url;
      v.load();
    });
  }

  private async loadHls(url: string): Promise<void> {
    const v = this.video!;
    if (Hls.isSupported()) {
      this.hls?.destroy();
      this.hls = new Hls({ enableWorker: true });
      this.hls.loadSource(url);
      this.hls.attachMedia(v);
      await new Promise<void>((resolve, reject) => {
        const to = window.setTimeout(() => reject(new Error('HLS timeout')), 15000);
        this.hls!.on(Hls.Events.MANIFEST_PARSED, () => { window.clearTimeout(to); resolve(); });
        this.hls!.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) { window.clearTimeout(to); reject(new Error('HLS fatal: ' + d.details)); }
        });
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url; v.load();
    } else throw new Error('HLS unsupported');
  }

  private async ensureFfmpeg(): Promise<FFmpeg> {
    if (this.ffmpeg && this.ffmpegLoaded) return this.ffmpeg;
    const ff = new FFmpeg();
    await ff.load();
    this.ffmpeg = ff;
    this.ffmpegLoaded = true;
    return ff;
  }

  private async loadRemux(url: string): Promise<EngineMode> {
    const v = this.video!;
    if (!('MediaSource' in window)) {
      v.src = url; v.load();
      this.cb.onMode?.('progressive', 'MSE unsupported, progressive fallback');
      return 'progressive';
    }
    try {
      const ff = await this.ensureFfmpeg();
      const inputName = 'input' + guessInputExt(url);
      const outName = 'output.mp4';
      const data = await fetchFile(url);
      await ff.writeFile(inputName, data);
      await this.probeTracks(ff, inputName);
      await this.extractSubs(ff, inputName);
      const audioArgs = await this.audioArgs(ff, inputName);
      await ff.exec(['-i', inputName, '-c:v', 'copy', ...audioArgs,
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', outName]);
      const out = (await ff.readFile(outName)) as Uint8Array;
      try { await ff.deleteFile(inputName); } catch { /* noop */ }
      try { await ff.deleteFile(outName); } catch { /* noop */ }
      const blob = new Blob([out.buffer as ArrayBuffer], { type: 'video/mp4' });
      const objUrl = URL.createObjectURL(blob);
      this.objectUrls.push(objUrl);
      const mime = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
      if (MediaSource.isTypeSupported(mime)) {
        await this.feedMse(objUrl, mime);
        this.cb.onMode?.('mkv-remux', 'MKV demuxed + audio to AAC, fed via MSE');
        return 'mkv-remux';
      }
      v.src = objUrl; v.load();
      this.cb.onMode?.('progressive', 'Remuxed to MP4, progressive playback');
      return 'progressive';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'remux failed';
      this.cb.onError?.('Remux failed (' + msg + '). Progressive fallback.', true);
      v.src = url; v.load();
      this.cb.onMode?.('progressive', 'Remux failed, progressive fallback');
      return 'progressive';
    }
  }

  private async probeTracks(ff: FFmpeg, input: string): Promise<void> {
    let logs = '';
    const onLog = ({ message }: { message: string }) => { logs += message + '\n'; };
    ff.on('log', onLog);
    try { await ff.exec(['-hide_banner', '-i', input]); } catch { /* probe exits nonzero */ }
    ff.off('log', onLog);
    const audio: AudioTrackInfo[] = [];
    const re = /Stream #\d+:(\d+)(?:\(([^)]+)\))?: Audio: ([a-z0-9_\-]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(logs)) !== null) {
      const idx = parseInt(m[1], 10);
      const codec = m[3];
      const bad = UNSUPPORTED_AUDIO.includes(codec.toLowerCase());
      audio.push({
        id: 'audio-' + idx,
        label: (m[2] || 'Audio').trim() + ' · ' + codec.toUpperCase() + (bad ? ' → AAC' : ''),
        language: m[2]?.trim(), codec, index: idx,
      });
    }
    if (audio.length > 0) this.cb.onAudioTracks?.(audio);
  }

  private async audioArgs(ff: FFmpeg, input: string): Promise<string[]> {
    let logs = '';
    const onLog = ({ message }: { message: string }) => { logs += message + '\n'; };
    ff.on('log', onLog);
    try { await ff.exec(['-hide_banner', '-i', input]); } catch { /* noop */ }
    ff.off('log', onLog);
    const hasBad = UNSUPPORTED_AUDIO.some((c) => new RegExp('Audio:\\s*' + c, 'i').test(logs));
    return hasBad ? ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'] : ['-c:a', 'aac', '-b:a', '160k'];
  }

  private async extractSubs(ff: FFmpeg, input: string): Promise<void> {
    const found: SubtitleTrackInfo[] = [];
    for (let i = 0; i < 8; i++) {
      const out = 'sub' + i + '.srt';
      try {
        await ff.exec(['-i', input, '-map', '0:s:' + i, out]);
        const raw = (await ff.readFile(out)) as Uint8Array;
        const text = new TextDecoder().decode(raw);
        try { await ff.deleteFile(out); } catch { /* noop */ }
        if (!text || text.length < 10) continue;
        const cues = parseSubtitleText(text, 'srt');
        if (cues.length === 0) continue;
        const id = 'embedded-' + i;
        this.embeddedSubs.set(id, cues);
        found.push({ id, label: 'Embedded ' + (i + 1), kind: 'embedded' });
      } catch { break; }
    }
    if (found.length > 0) {
      this.cb.onSubtitleTracks?.(found);
      void this.selectSubtitle(found[0].id);
    }
  }

  private feedMse(objUrl: string, mime: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const v = this.video!;
        const ms = new MediaSource();
        const msUrl = URL.createObjectURL(ms);
        this.objectUrls.push(msUrl);
        v.src = msUrl;
        ms.addEventListener('sourceopen', () => {
          void (async () => {
            try {
              const sb = ms.addSourceBuffer(mime);
              const res = await fetch(objUrl);
              const buf = await res.arrayBuffer();
              sb.addEventListener('updateend', () => {
                try { if (ms.readyState === 'open') ms.endOfStream(); } catch { /* noop */ }
                resolve();
              }, { once: true });
              sb.appendBuffer(buf);
            } catch (e) { reject(e); }
          })();
        }, { once: true });
      } catch (e) { reject(e); }
    });
  }

  async selectSubtitle(id: string | null): Promise<Cue[]> {
    this.activeSubId = id;
    if (!id) { this.activeSubCues = []; this.cb.onCues?.([]); return []; }
    const emb = this.embeddedSubs.get(id);
    if (emb) { this.activeSubCues = emb; this.cb.onCues?.(emb); return emb; }
    return [];
  }

  async selectExternalSubtitle(url: string): Promise<Cue[]> {
    const cues = await loadExternalCues(url);
    this.activeSubCues = cues;
    this.cb.onCues?.(cues);
    return cues;
  }

  cuesAt(time: number): Cue[] {
    return this.activeSubCues.filter((c) => time >= c.start && time <= c.end).slice(0, 3);
  }

  getActiveSubtitleId(): string | null { return this.activeSubId; }
}
