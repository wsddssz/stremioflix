import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings,
  Captions, SkipForward, ChevronLeft, Loader2, Gauge, AudioLines, MonitorPlay,
  ListVideo, Check, ShieldCheck, Download, Film, Layout, Smartphone, Tv,
} from 'lucide-react';
import type { PosterMeta, StreamObject, SubtitleObject, VideoMeta, PlayerUIMode } from '../stremio/types';
import { MkvMediaEngine } from '../player/MkvEngine';
import type { AudioTrackInfo, Cue, EngineMode, SubtitleTrackInfo } from '../player/MkvMediaEngine';
import { playableUrl, resolveStreamsForVideo, filterStreamsByAddon, groupStreamsByAddon, getAddonFilterOptions, streamLabel } from '../services/catalogService';
import { getResume, saveResume, clearResume, resumeKey, getAutoPlayPref, setAutoPlayPref } from '../services/playbackStore';
import TrackMenu from './TrackMenu';
import SubStylePanel from './SubStylePanel';
import EpisodePanel from './EpisodePanel';
import NextEpisodeFloating from './NextEpisodeFloating';
import StreamSourceSelector from './StreamSourceSelector';
import { loadSubStyle, saveSubStyle, DEFAULT_SUB_STYLE, type SubStyle } from '../player/subSettings';
import {
  isAndroidShell, isNativeShell, nativeAppFullscreen, nativeAvailable,
  nativePause, nativePlay, nativeRequestTracks, nativeSeek, nativeSeekRel, nativeSelectTrack,
  nativeSetSubOption, nativeSpeed, nativeStop, nativeVolume, onNativeEvent,
} from '../services/nativeBridge';
import type { MpTrack, MpTracks } from '../services/nativeBridge';

interface Props {
  stream: StreamObject;
  meta: PosterMeta;
  video?: VideoMeta;
  externalSubs: SubtitleObject[];
  onClose: () => void;
  onNextEpisode?: () => void;
  /** Episode switch; when the player pre-resolved the episode's streams (via
   *  the source selector) they ride along as a hint so App doesn't refetch. */
  onEpisodeSelect?: (v: VideoMeta, streams?: StreamObject[], subs?: SubtitleObject[]) => void;
  onStreamSelect?: (s: StreamObject) => void;
  /** Episode picked together with a chosen stream from the in-player source
   *  selector (episode panel → choose source → switch). Subs resolved for the
   *  new episode are passed along so external subtitles stay in sync. */
  onEpisodeStreamSelect?: (v: VideoMeta, s: StreamObject, subs?: SubtitleObject[]) => void;
  playerUIMode?: PlayerUIMode;
  onPlayerUIModeChange?: (mode: PlayerUIMode) => void;
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return (h > 0 ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

export default function NetflixPlayer({ stream, meta, video, externalSubs, onClose, onNextEpisode, onEpisodeSelect, onStreamSelect, onEpisodeStreamSelect, playerUIMode: propPlayerUIMode, onPlayerUIModeChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<MkvMediaEngine | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<EngineMode>('native');
  const [modeReason, setModeReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [resumePos, setResumePos] = useState<number | null>(null);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [subTracks, setSubTracks] = useState<SubtitleTrackInfo[]>([]);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [liveCues, setLiveCues] = useState<Cue[]>([]);
  const [menu, setMenu] = useState<'none' | 'subs' | 'audio' | 'speed' | 'substyle'>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [mpvReady, setMpvReady] = useState(false);
  const [mpvActive, setMpvActive] = useState(false);
  const nativeShell = useMemo(() => isNativeShell(), []);
  const androidShell = useMemo(() => isAndroidShell(), []);
  const [nTime, setNTime] = useState(0);
  const [nDur, setNDur] = useState(0);
  const [nPlaying, setNPlaying] = useState(true);
  const [nVol, setNVol] = useState(1);
  const [nToast, setNToast] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [subStyle, setSubStyleState] = useState<SubStyle>(() => loadSubStyle());
  const [epOpen, setEpOpen] = useState(false);
  const [tracks, setTracks] = useState<MpTrack[]>([]);
  const [trackSel, setTrackSel] = useState({ aid: '', sid: 'no' });
  const [tracksLoading, setTracksLoading] = useState(false);
  const [nextCount, setNextCount] = useState<number | null>(null);
  const subStyleRef = useRef(subStyle);
  const closingRef = useRef(false);
  const styleAppliedRef = useRef(false);
  const closeRef = useRef(onClose);
  const nextRef = useRef(onNextEpisode);
  const episodeRef = useRef(onEpisodeSelect);
  const streamSelectRef = useRef(onStreamSelect);
  const episodeStreamSelectRef = useRef(onEpisodeStreamSelect);

  // ---- Android native-player state (must live at top level per Rules of Hooks) ----
  const [aTime, setATime] = useState(0);
  const [aDur, setADur] = useState(0);
  const [aPlaying, setAPlaying] = useState(false);
  const [aError, setAError] = useState<string | null>(null);
  const [aLoading, setALoading] = useState(true);
  const [aTracks, setATracks] = useState<MpTrack[]>([]);
  const [aTrackSel, setATrackSel] = useState({ aid: '', sid: 'no' });
  const androidUrl = useMemo(() => playableUrl(stream), [stream]);
  const androidSubsJson = useMemo(
    () => JSON.stringify((externalSubs ?? []).map((s) => ({ url: s.url, lang: s.lang || 'und' }))),
    [externalSubs],
  );

  // ---- TV / Mobile player UI mode ----
  // Detect Android TV vs mobile phone/tablet from the native shell, default to mobile.
  const detectedTV = useMemo(() => {
    if (!androidShell) return false;
    // UI mode type: 1=car, 2=desk, 3=television, 4=appliance, 5=watch
    try {
      // @ts-ignore - available on Android
      const uiMode = window.android?.uiMode ? window.android.uiMode() : 0;
      return uiMode === 3;
    } catch { return false; }
  }, [androidShell]);
  const playerUIMode = propPlayerUIMode ?? (detectedTV ? 'tv' : 'mobile');

  // ---- Stream source selector (multi-addon) ----
  const [streamSelectorOpen, setStreamSelectorOpen] = useState(false);
  const [addonFilter, setAddonFilter] = useState<string | null>(null);

  // When set, the source selector is choosing a stream for THIS episode
  // (set by the episode panel); null = switching source of the current video.
  const [pendingEpisode, setPendingEpisode] = useState<VideoMeta | null>(null);
  // Subs resolved alongside pendingEpisode's streams, passed up on selection.
  const pendingSubsRef = useRef<SubtitleObject[]>([]);
  const [pendingStreams, setPendingStreams] = useState<StreamObject[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  // All streams resolved for the current video (populated when streams are loaded).
  const [allStreams, setAllStreams] = useState<StreamObject[]>([]);
  const [allStreamsLoading, setAllStreamsLoading] = useState(true);

  const url = useMemo(() => playableUrl(stream), [stream]);
  const isYouTube = useMemo(() => {
    if (stream.ytId) return true;
    if (!url) return false;
    return /youtube\.com|youtu\.be/.test(url);
  }, [stream, url]);
  const youTubeId = useMemo(() => {
    if (stream.ytId) return stream.ytId;
    if (!url) return null;
    const m = url.match(/[?&]v=([\w-]{6,})|\/embed\/([\w-]{6,})|youtu\.be\/([\w-]{6,})/);
    return m ? m[1] || m[2] || m[3] : null;
  }, [stream, url]);
  const title = video?.title || meta.name;
  const subTitle = video && (video.season || video.episode)
    ? 'S' + (video.season ?? 1) + ':E' + (video.episode ?? video.number ?? 1)
    : (stream.title || stream.name || '');

  // Listen to native ExoPlayer events (Android only). Guard inside effect.
  useEffect(() => {
    if (!androidShell || isYouTube) return;
    const off = onNativeEvent((ev) => {
      if (ev.type === 'mpv-time') setATime(Number(ev.value) || 0);
      else if (ev.type === 'mpv-duration') setADur(Number(ev.value) || 0);
      else if (ev.type === 'mpv-pause') setAPlaying(ev.value !== '1');
      else if (ev.type === 'mpv-error') { setAError(ev.value || 'Native player failed.'); setALoading(false); }
      else if (ev.type === 'mpv-tracks') {
        try {
          const d = JSON.parse(ev.value) as MpTracks;
          setATracks(Array.isArray(d.tracks) ? d.tracks : []);
          setATrackSel({ aid: d.aid || '', sid: d.sid || 'no' });
        } catch { /* malformed */ }
      }
      else if (ev.type === 'mpv-ended') {
        if (nextRef.current) setNextCount(5);
        else closeRef.current();
      }
    });
    setALoading(true);
    setAError(null);
    void nativePlay(androidUrl!, title, androidSubsJson);
    void nativeRequestTracks();
    // The Android handoff is fire-and-forget: the native ExoPlayer activity owns
    // playback and (in this build) sends no events back, so treat the handoff as
    // immediately complete — otherwise the overlay stays stuck on "Loading…".
    setALoading(false);
    return () => { off(); void nativeStop(); };
  }, [androidShell, isYouTube, androidUrl, title, androidSubsJson]);

  const poke = () => setShowControls(true);
  const menuOpen = menu !== 'none' || epOpen;
  const hasVideos = (meta.videos ?? []).length > 0;

  // Open the source selector for a specific episode (episode panel). Streams
  // and subs are resolved for THAT episode; picking a row switches episode and
  // source atomically via onEpisodeStreamSelect. Selecting the episode that is
  // already playing degrades to a plain source switch for the current video.
  const openSourceSelectorForEpisode = (v: VideoMeta) => {
    setEpOpen(false);
    setNextCount(null);
    if (v.id === video?.id) {
      setPendingEpisode(null);
      setStreamSelectorOpen(true);
      return;
    }
    setPendingEpisode(v);
    setPendingStreams([]);
    setPendingLoading(true);
    setStreamSelectorOpen(true);
    resolveStreamsForVideo(meta.type, meta.id, v.id)
      .then((res) => { setPendingStreams(res.streams); pendingSubsRef.current = res.subtitles; })
      .catch(() => { setPendingStreams([]); })
      .finally(() => setPendingLoading(false));
  };

  // Latest-closure handles so async events never call stale props.
  closeRef.current = onClose;
  nextRef.current = onNextEpisode;
  episodeRef.current = onEpisodeSelect;
  streamSelectRef.current = onStreamSelect;
  episodeStreamSelectRef.current = onEpisodeStreamSelect;
  subStyleRef.current = subStyle;

  const requestClose = () => { closingRef.current = true; void nativeStop(); closeRef.current(); };

  const pushStyleToMpv = () => {
    const s = subStyleRef.current;
    nativeSetSubOption('sub-font', s.font);
    nativeSetSubOption('sub-scale', String(s.size));
    nativeSetSubOption('sub-color', s.color);
    nativeSetSubOption('sub-delay', String(s.delay));
  };

  const applySubStyle = (patch: Partial<SubStyle>) => {
    const next = { ...subStyleRef.current, ...patch };
    subStyleRef.current = next;
    setSubStyleState(next);
    saveSubStyle(next);
    if (nativeShell && !isYouTube) pushStyleToMpv();
    if (!nativeShell && engineRef.current && videoRef.current) {
      setLiveCues(engineRef.current.cuesAt(videoRef.current.currentTime - next.delay));
    }
  };

  const requestTracks = () => {
    setTracksLoading(true);
    nativeRequestTracks();
    window.setTimeout(() => setTracksLoading(false), 1500);
  };

  useEffect(() => {
    let live = true;
    nativeAvailable().then((ok) => { if (live) setMpvReady(ok); });
    return () => { live = false; };
  }, []);

  const playInMpv = async () => {
    if (!url) return;
    const ok = await nativePlay(url, title);
    if (ok) {
      setMpvActive(true);
      const v = videoRef.current;
      if (v) { try { v.pause(); } catch { /* noop */ } }
    }
  };

  useEffect(() => {
    return () => { if (mpvActive) void nativeStop(); };
  }, [mpvActive]);

  const flashTimer = useRef<number | null>(null);
  const flash = (msg: string) => {
    setNToast(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setNToast(null), 1500);
  };

  // Desktop shell playback: embedded libmpv renders behind this transparent overlay.
  useEffect(() => {
    if (!nativeShell || isYouTube) return;
    if (!url) { setError('No playable URL for this source.'); setLoading(false); return; }
    closingRef.current = false;
    styleAppliedRef.current = false;
    setNTime(0);
    setNDur(0);
    setNextCount(null);
    const off = onNativeEvent((ev) => {
      if (ev.type === 'mpv-time') {
        setNTime(Number(ev.value) || 0);
        setLoading(false);
        if (!styleAppliedRef.current) { styleAppliedRef.current = true; pushStyleToMpv(); }
      }
      else if (ev.type === 'mpv-duration') setNDur(Number(ev.value) || 0);
      else if (ev.type === 'mpv-pause') setNPlaying(ev.value !== '1');
      else if (ev.type === 'mpv-error') { setError(ev.value || 'Native player failed.'); setLoading(false); }
      else if (ev.type === 'mpv-tracks') {
        try {
          const d = JSON.parse(ev.value) as MpTracks;
          setTracks(Array.isArray(d.tracks) ? d.tracks : []);
          setTrackSel({ aid: d.aid || '', sid: d.sid || 'no' });
        } catch { /* malformed payload */ }
        setTracksLoading(false);
      }
      else if (ev.type === 'mpv-ended') {
        if (closingRef.current) return;
        if (nextRef.current) setNextCount(5);
        else closeRef.current();
      }
    });
    setLoading(true);
    setError(null);
    nativePlay(url, title);
    nativeRequestTracks();
    poke();
    return () => { off(); if (closingRef.current) void nativeStop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nativeShell, isYouTube]);

  // Hide the entire app behind this overlay while the native mpv surface plays;
  // without this the catalog stays painted over the transparent WebView2 and the
  // video (which renders in a child window behind the page) is invisible.
  useEffect(() => {
    if (!nativeShell || isYouTube) return;
    document.documentElement.classList.add('native-mpv');
    return () => document.documentElement.classList.remove('native-mpv');
  }, [nativeShell, isYouTube]);

  // Switching to a YouTube trailer on the desktop shell must stop the embedded
  // mpv player — the playback effect early-returns for YouTube, so without this
  // the previous stream keeps playing (audio) behind the iframe.
  useEffect(() => {
    if (nativeShell && isYouTube) void nativeStop();
  }, [nativeShell, isYouTube]);

  // Resolve all streams for the current video so the multi-addon source
  // selector can show sources grouped by addon with addon filtering.
  // Movies have no `video` — resolve by meta id so the picker works there too.
  useEffect(() => {
    let live = true;
    setAllStreamsLoading(true);
    const resolve = async () => {
      if (!meta) return;
      const videoId = video?.id ?? meta.id;
      try {
        const res = await resolveStreamsForVideo(meta.type, meta.id, videoId);
        if (live) setAllStreams(res.streams);
      } catch { /* streams optional */ }
      finally { if (live) setAllStreamsLoading(false); }
    };
    void resolve();
    return () => { live = false; };
  }, [meta, video]);

  // Auto-hide controls after 3.5 s of inactivity â€” never while a menu/panel is
  // open, and never while paused (Netflix keeps controls visible when paused).

  // Auto-hide controls after 3.5 s of inactivity — never while a menu/panel is
  // open, and never while paused (Netflix keeps controls visible when paused).
  useEffect(() => {
    if (!showControls) return;
    if (menuOpen) return;
    const active = nativeShell && !isYouTube ? nPlaying : playing;
    if (!active) return;
    const t = window.setTimeout(() => setShowControls(false), 3500);
    return () => window.clearTimeout(t);
  }, [showControls, menuOpen, nPlaying, playing, nativeShell, isYouTube]);

  // 5-second next-episode countdown after a natural end-of-file.
  useEffect(() => {
    if (nextCount === null) return;
    if (nextCount <= 0) { nextRef.current?.(); return; }
    const t = window.setTimeout(() => setNextCount((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [nextCount]);

  // Keyboard shortcuts for the desktop shell player.
  useEffect(() => {
    if (!nativeShell || isYouTube) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); nativePause(); poke(); }
      else if (e.key === 'ArrowRight') { nativeSeekRel(10); poke(); }
      else if (e.key === 'ArrowLeft') { nativeSeekRel(-10); poke(); }
      else if (e.key === 'Escape') requestClose();
      else if (e.key === 'f' || e.key === 'F') { nativeAppFullscreen(); setIsFullscreen((s) => !s); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeShell, isYouTube, onClose]);

  useEffect(() => {
    if (nativeShell && !isYouTube) return; // desktop shell: embedded mpv handles playback
    if (isYouTube) {
      setLoading(false);
      setPlaying(true);
      return;
    }
    // Android playback is driven exclusively by the dedicated native handoff
    // effect above (deps: androidUrl/title/subs). A second nativePlay here would
    // startActivity() a duplicate PlayerActivity on every URL change.
    if (androidShell) return;
    const v = videoRef.current;
    if (!v || !url) { setError('No playable URL for this source.'); setLoading(false); return; }
    const resumeK = resumeKey(meta.type, meta.id, video?.id ?? meta.id);
    const saved = getResume(resumeK);
    if (saved) setResumePos(saved.pos);
    const engine = new MkvMediaEngine();
    engineRef.current = engine;
    setLoading(true);
    setError(null);
    engine.attach(v, {
      onMode: (m, reason) => { setMode(m); setModeReason(reason); },
      onError: (msg) => setError(msg),
      onAudioTracks: (t) => setAudioTracks(t),
      onSubtitleTracks: (t) => {
        setSubTracks((prev) => {
          const ext = prev.filter((p) => p.kind === 'external');
          return [...t, ...ext];
        });
      },
      onCues: () => setCues([...(engineRef.current ? (engineRef.current as unknown as { activeSubCues: Cue[] }).activeSubCues : [])]),
    });
    engine.load(url, { filename: stream.behaviorHints?.filename }).then(() => {
      setLoading(false);
      v.play().catch(() => { /* autoplay blocked */ });
    }).catch((e) => {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'Playback failed');
    });

    const extTracks: SubtitleTrackInfo[] = (externalSubs ?? []).map((s, i) => ({
      id: 'ext-' + i, label: (s.lang || 'Subtitle') + ' ' + (i + 1), language: s.lang, kind: 'external', url: s.url,
    }));
    setSubTracks(extTracks);

    let lastResumeSave = 0;
    const onTime = () => {
      setTime(v.currentTime);
      setDur(v.duration || 0);
      const eng = engineRef.current;
      if (eng) setLiveCues(eng.cuesAt(v.currentTime - subStyleRef.current.delay));
      if (onNextEpisode && v.duration && v.duration - v.currentTime < 30 && v.duration > 60) setShowNext(true);
      else setShowNext(false);
      const now = Date.now();
      if (now - lastResumeSave > 2000) {
        lastResumeSave = now;
        saveResume(resumeK, v.currentTime, v.duration || 0);
      }
    };
    const onPlay = () => { setPlaying(true); poke(); };
    const onPause = () => {
      setPlaying(false);
      saveResume(resumeK, v.currentTime, v.duration || 0);
    };
    const onEnded = () => {
      if (closingRef.current) return;
      clearResume(resumeK);
      setResumePos(null);
      if (nextRef.current) setNextCount(5);
      else closeRef.current();
    };
    const onCanPlay = () => {
      const r = resumePos;
      if (r !== null) { v.currentTime = r; setResumePos(null); }
    };
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    poke();
    return () => {
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      engine.detach();
      engineRef.current = null;
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play(); } else v.pause();
    poke();
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
    poke();
  };

  const toggleFs = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) { void el.requestFullscreen().catch(() => undefined); setIsFullscreen(true); }
    else { void document.exitFullscreen().catch(() => undefined); setIsFullscreen(false); }
  };

  const pickSub = async (t: SubtitleTrackInfo | null) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (!t) { await eng.selectSubtitle(null); setActiveSub(null); setLiveCues([]); setMenu('none'); return; }
    if (t.kind === 'embedded') { await eng.selectSubtitle(t.id); setActiveSub(t.id); }
    else if (t.url) { await eng.selectExternalSubtitle(t.url); setActiveSub(t.id); }
    setMenu('none');
  };

  void cues;
  const progress = dur > 0 ? (time / dur) * 100 : 0;

  const episodePanel = epOpen && hasVideos ? (
    <EpisodePanel
      key={String(video?.id)}
      meta={meta}
      current={video}
      onClose={() => setEpOpen(false)}
      onSelect={openSourceSelectorForEpisode}
    />
  ) : null;

  const nextCard = nextCount !== null && nextRef.current ? (
    <div className="absolute inset-0 z-[75] flex items-center justify-center pointer-events-none">
      <div className="bg-[#181818]/95 border border-white/10 rounded-lg px-6 py-5 flex items-center gap-4 shadow-modal pointer-events-auto animate-scale-in">
        <div className="text-center">
          <div className="text-[11px] text-white/50 uppercase tracking-wide">Next episode in</div>
          <div className="text-3xl font-black text-[#E50914] leading-none mt-1">{nextCount}</div>
        </div>
        <button onClick={() => { setNextCount(null); nextRef.current?.(); }} className="flex items-center gap-2 bg-white text-black font-bold px-5 py-2.5 rounded hover:bg-white/85">
          <Play size={18} fill="currentColor" /> Play Now
        </button>
        <button onClick={() => { setNextCount(null); closeRef.current(); }} className="text-white/60 hover:text-white text-sm px-2">Cancel</button>
      </div>
    </div>
  ) : null;

  // Shared "Stream Sources" modal used by every shell (Android overlay, desktop
  // native overlay, browser fallback). Selecting a row updates the play state in
  // App via onStreamSelect so url/androidUrl recompute and the shell's playback
  // effect restarts the native player with the new source. When opened from the
  // episode panel (pendingEpisode set) it resolves THAT episode's streams and
  // the pick switches episode + source together via onEpisodeStreamSelect.
  const selectorStreams = pendingEpisode ? pendingStreams : allStreams;
  const selectorLoading = pendingEpisode ? pendingLoading : (allStreamsLoading && allStreams.length === 0);
  const streamSelectorModal = streamSelectorOpen ? (
    <div className="absolute inset-0 z-[80] bg-black/90 flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-white/10 bg-[#141414]">
          <h3 className="text-lg font-bold">Stream Sources</h3>
          <p className="text-xs text-white/50 mt-1">
            {pendingEpisode
              ? `Choose a source for ${pendingEpisode.season != null ? `S${pendingEpisode.season}:E${pendingEpisode.episode ?? pendingEpisode.number ?? ''}` : pendingEpisode.title || 'this episode'}`
              : 'Select a source from your installed addons'}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <StreamSourceSelector
            streams={selectorStreams}
            loading={selectorLoading}
            className="max-h-full"
            onSelect={(s) => {
              setStreamSelectorOpen(false);
              setNextCount(null);
              if (pendingEpisode) {
                const ep = pendingEpisode;
                setPendingEpisode(null);
                episodeStreamSelectRef.current?.(ep, s, pendingSubsRef.current);
              } else {
                streamSelectRef.current?.(s);
              }
            }}
          />
        </div>
        <div className="px-6 py-3 border-t border-white/10">
          <button onClick={() => { setStreamSelectorOpen(false); setPendingEpisode(null); }} className="w-full px-6 py-3 bg-[#222] hover:bg-[#2c2c2c] rounded font-semibold text-white text-center">
            Close
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ---- Android shell render: full Netflix-style UI overlay on top of
  // the native ExoPlayer surface. All controls are React-based and drive
  // the native player via the JavaScript bridge. ---
  if (androidShell && !isYouTube) {
    const isTV = playerUIMode === 'tv';
    const ctrlSize = isTV ? 32 : 26;

    const androidProgress = aDur > 0 ? (aTime / aDur) * 100 : 0;

    const seekAndroid = (t: number) => {
      const v = Math.max(0, Math.min(aDur, t));
      setATime(v);
      void nativeSeek(v);
      poke();
    };

    const seekRelAndroid = (delta: number) => {
      void nativeSeekRel(delta);
      poke();
    };

    const togglePlayAndroid = () => {
      void nativePause();
      setAPlaying((p) => !p);
      poke();
    };

    const setVolAndroid = (v: number) => {
      setVol(v);
      setMuted(v === 0);
      void nativeVolume(v * 100);
      poke();
    };

    const selectTrackAndroid = (type: 'aid' | 'sid', id: string) => {
      void nativeSelectTrack(type, id);
      setATrackSel((s) => ({ ...s, [type]: id }));
      poke();
    };

    const androidNearEnd = !!nextRef.current && aDur > 60 && aDur - aTime < 40;

    const episodePanelAndroid = epOpen && hasVideos ? (
      <EpisodePanel
        key={String(video?.id)}
        meta={meta}
        current={video}
        onClose={() => setEpOpen(false)}
        onSelect={openSourceSelectorForEpisode}
      />
    ) : null;

    return (
      <div className="nf-native-player fixed inset-0 z-[60] bg-black flex flex-col" onTouchStart={poke} onTouchEnd={poke}>
        {/* Video surface - native ExoPlayer renders behind this overlay */}
        <div className="flex-1 bg-black relative overflow-hidden">
          <div className="absolute inset-0 bg-black flex items-center justify-center">
            <div className="text-center">
              <MonitorPlay size={isTV ? 64 : 40} className="text-[#E50914]/40 mb-3" />
              <div className="text-sm text-white/30">{aLoading ? 'Loading…' : 'Ready'}</div>
            </div>
          </div>
        </div>
        {/* Top bar */}
        <div className={'absolute top-0 inset-x-0 z-30 bg-gradient-to-b from-black/80 to-transparent px-4 md:px-8 py-4 flex items-center gap-3 transition-opacity ' + (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          <button onClick={onClose} aria-label="Back" className={`p-3 hover:text-white/70 ${isTV ? 'w-12 h-12' : ''}`}><ChevronLeft size={ctrlSize} /></button>
          <div className={`text-sm ${isTV ? 'text-base' : ''} text-white/85 truncate flex-1`}>{title} {subTitle && <span className="text-white/50">· {subTitle}</span>}</div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => onPlayerUIModeChange?.(isTV ? 'mobile' : 'tv')} aria-label="Toggle TV/Mobile UI" className="p-3 hover:text-white/70"><Tv size={20} /></button>
            <button onClick={() => setStreamSelectorOpen(true)} aria-label="Stream sources" className="p-3 hover:text-white/70"><ShieldCheck size={20} /></button>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/80">EXOPLAYER</span>
          </div>
        </div>

        {/* Bottom controls */}
        <div className={'absolute bottom-0 inset-x-0 z-30 bg-gradient-to-t from-black via-black/70 to-transparent px-4 md:px-8 pb-6 pt-12 transition-opacity ' + (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          {/* Progress bar */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-white/80 w-12">{fmt(aTime)}</span>
            <input type="range" min={0} max={aDur || 0} step={0.5} value={aTime} onChange={(e) => seekAndroid(Number(e.target.value))} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} className="nf-range flex-1" aria-label="Seek" style={{ background: 'linear-gradient(to right, #E50914 ' + androidProgress + '%, rgba(255,255,255,0.3) ' + androidProgress + '%)' }} />
            <span className="text-xs text-white/80 w-12 text-right">{aDur > 0 ? fmt(aDur) : '--:--'}</span>
          </div>
          {/* Control row */}
          <div className="flex items-center gap-1 md:gap-2">
            <button onClick={onClose} aria-label="Back" className="p-2 hover:text-white/70"><ChevronLeft size={ctrlSize} /></button>
            <button onClick={togglePlayAndroid} aria-label="Play/Pause" className="p-2 hover:text-white/70">{aPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}</button>
            <button onClick={() => seekRelAndroid(10)} aria-label="Forward" className="p-2 hover:text-white/70"><SkipForward size={22} /></button>
            <div className="flex items-center gap-2 group/vol">
              <button onClick={() => setVolAndroid(0)} aria-label="Mute" className="p-2 hover:text-white/70">{vol === 0 || muted ? <VolumeX size={22} /> : <Volume2 size={22} />}</button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} onChange={(e) => setVolAndroid(Number(e.target.value))} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} className="nf-range w-0 group-hover/vol:w-20 transition-all" aria-label="Volume" />
            </div>
            <div className="text-xs text-white/70 ml-1 truncate max-w-[200px] md:max-w-xs">{title}</div>
            <div className="flex-1" />
            {hasVideos && (
              <button onClick={() => { setEpOpen(true); poke(); }} aria-label="Episodes" title="Episodes" className="p-2 hover:text-white/70"><ListVideo size={22} /></button>
            )}
            <div className="relative">
              <button onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')} aria-label="Audio track" className="p-2 hover:text-white/70"><AudioLines size={22} /></button>
              {menu === 'audio' && (
                <div className="absolute bottom-11 right-0 w-56 bg-[#181818]/95 rounded shadow-modal p-2 text-sm max-h-64 overflow-y-auto">
                  {aTracks.length === 0 && <div className="px-3 py-2 text-white/50 text-xs">Default audio</div>}
                  {aTracks.filter((t) => t.type === 'audio').map((t) => (
                    <button key={t.id} onClick={() => { selectTrackAndroid('aid', String(t.id)); }} className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (aTrackSel.aid === String(t.id) ? 'text-[#E50914] font-semibold' : '')}>{t.title || t.lang || 'Track ' + t.id}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => setMenu(menu === 'subs' ? 'none' : 'subs')} aria-label="Subtitles" className="p-2 hover:text-white/70"><Captions size={22} /></button>
              {menu === 'subs' && (
                <div className="absolute bottom-11 right-0 w-56 bg-[#181818]/95 rounded shadow-modal p-2 text-sm max-h-64 overflow-y-auto">
                  <button onClick={() => { selectTrackAndroid('sid', 'no'); }} className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (aTrackSel.sid === 'no' ? 'text-[#E50914] font-semibold' : '')}>Off</button>
                  {aTracks.filter((t) => t.type === 'sub').map((t) => (
                    <button key={t.id} onClick={() => { selectTrackAndroid('sid', String(t.id)); }} className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (aTrackSel.sid === String(t.id) ? 'text-[#E50914] font-semibold' : '')}>{t.title || t.lang || 'Track ' + t.id}</button>
                  ))}
                  {aTracks.filter((t) => t.type === 'sub').length === 0 && <div className="px-3 py-2 text-white/50 text-xs">No subtitle tracks</div>}
                  <div className="border-t border-white/10 my-1" />
                  <button onClick={() => { setMenu('substyle'); poke(); }} className="w-full text-left px-3 py-2 rounded hover:bg-white/10">Subtitle settings…</button>
                </div>
              )}
              {menu === 'substyle' && (
                <SubStylePanel style={subStyle} onChange={applySubStyle} onReset={() => applySubStyle(DEFAULT_SUB_STYLE)} onClose={() => { setMenu('none'); poke(); }} />
              )}
            </div>
            <div className="relative">
              <button onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')} aria-label="Speed" className="p-2 hover:text-white/70"><Gauge size={22} /></button>
              {menu === 'speed' && (
                <div className="absolute bottom-11 right-0 w-40 bg-[#181818]/95 rounded shadow-modal p-2 text-sm">
                  {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} onClick={() => { void nativeSpeed(r); setMenu('none'); }} className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (rate === r ? 'text-[#E50914] font-semibold' : '')}>{r}x</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => onPlayerUIModeChange?.(playerUIMode === 'tv' ? 'mobile' : 'tv')} aria-label="Toggle TV/Mobile UI" className="p-2 hover:text-white/70"><Tv size={20} /></button>
            <button onClick={() => setStreamSelectorOpen(true)} aria-label="Stream sources" className="p-2 hover:text-white/70"><ShieldCheck size={20} /></button>
            <button onClick={toggleFs} aria-label="Fullscreen" className="p-2 hover:text-white/70">{isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}</button>
          </div>
          {aError && <div className="mt-2 text-xs text-amber-300 bg-amber-900/40 rounded px-3 py-1.5">{aError}</div>}
          {androidNearEnd && !menuOpen && !nextCard && (
            <button onClick={() => nextRef.current?.()} className="absolute bottom-28 right-6 z-30 bg-white text-black font-bold px-5 py-2.5 rounded flex items-center gap-2 hover:bg-white/85 animate-slide-up">
              Next Episode <SkipForward size={18} />
            </button>
          )}
        </div>

        {streamSelectorModal}
        {episodePanelAndroid}
        <NextEpisodeFloating
          meta={meta}
          current={video}
          onPlay={(v) => {
            setEpOpen(false);
            episodeRef.current?.(v);
          }}
          onDismiss={() => { /* dismissed */ }}
        />
      </div>
    );
  }

  // ---- Desktop shell render: transparent overlay; the video surface is the
  // native mpv child window rendering behind this WebView2 page. ----
  if (nativeShell && !isYouTube) {
    const nProgress = nDur > 0 ? (nTime / nDur) * 100 : 0;
    const nClose = requestClose;
    const nearEnd = !!nextRef.current && nDur > 60 && nDur - nTime < 40;
    const isTV = playerUIMode === 'tv';
    const ctrlSize = isTV ? 32 : 26;
    return (
      <div className={'nf-native-player fixed inset-0 z-[60] flex flex-col ' + (showControls ? '' : 'cursor-none')} style={{ background: 'transparent' }} onMouseMove={poke} onClick={poke} onTouchStart={poke} onTouchEnd={poke}>
        <div className={'absolute top-0 inset-x-0 z-30 bg-gradient-to-b from-black/80 to-transparent px-4 md:px-8 py-4 flex items-center gap-3 transition-opacity ' + (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          <button onClick={nClose} aria-label="Back" className={`p-3 hover:text-white/70 ${isTV ? 'w-12 h-12' : ''}`}><ChevronLeft size={ctrlSize} /></button>
          <div className={`text-sm ${isTV ? 'text-base' : ''} text-white/85 truncate`}>{title} {subTitle && <span className="text-white/50">· {subTitle}</span>}</div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => onPlayerUIModeChange?.(isTV ? 'mobile' : 'tv')} aria-label="Toggle TV/Mobile UI" className="p-3 hover:text-white/70"><Tv size={20} /></button>
            <button onClick={() => setStreamSelectorOpen(true)} aria-label="Stream sources" className="p-3 hover:text-white/70"><ShieldCheck size={20} /></button>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/80">NATIVE MPV</span>
          </div>
        </div>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <Loader2 size={48} className="animate-spin text-[#E50914]" />
            <div className="text-sm text-white/80">Starting native player…</div>
          </div>
        )}
        {nToast && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/70 text-white text-lg font-semibold px-6 py-3 rounded animate-fade-in">{nToast}</div>
          </div>
        )}
        {nearEnd && !menuOpen && !nextCard && (
          <button onClick={() => nextRef.current?.()} className="absolute bottom-28 right-6 z-30 bg-white text-black font-bold px-5 py-2.5 rounded flex items-center gap-2 hover:bg-white/85 animate-slide-up">
            Next Episode <SkipForward size={18} />
          </button>
        )}
        <div className="flex-1" />
        <div className={'absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/70 to-transparent px-4 md:px-8 pb-4 pt-12 transition-opacity ' + (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs text-white/80 w-12">{fmt(nTime)}</span>
            <input
              type="range" min={0} max={nDur || 0} step={0.5} value={nTime}
              onChange={(e) => nativeSeek(Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              className="nf-range flex-1" aria-label="Seek"
              style={{ background: 'linear-gradient(to right, #E50914 ' + nProgress + '%, rgba(255,255,255,0.3) ' + nProgress + '%)' }}
            />
            <span className="text-xs text-white/80 w-12 text-right">{nDur > 0 ? fmt(nDur) : '--:--'}</span>
          </div>
          <div className="flex items-center gap-1 md:gap-2">
            <button onClick={nClose} aria-label="Back" className="p-2 hover:text-white/70"><ChevronLeft size={26} /></button>
            <button onClick={() => { nativePause(); poke(); }} aria-label="Play/Pause" className="p-2 hover:text-white/70">
              {nPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
            </button>
            <button onClick={() => { nativeSeekRel(10); poke(); }} aria-label="Forward" className="p-2 hover:text-white/70"><SkipForward size={22} /></button>
            <div className="flex items-center gap-2 group/vol">
              <button onClick={() => { const nv = nVol > 0 ? 0 : 1; setNVol(nv); nativeVolume(nv * 100); }} aria-label="Mute" className="p-2 hover:text-white/70">
                {nVol === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
              </button>
              <input type="range" min={0} max={1} step={0.05} value={nVol}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => { const nv = Number(e.target.value); setNVol(nv); nativeVolume(nv * 100); }}
                className="nf-range w-0 group-hover/vol:w-20 transition-all" aria-label="Volume" />
            </div>
            <div className="text-xs text-white/70 ml-1 truncate max-w-[200px] md:max-w-xs">{title} {subTitle && <span className="text-white/50">· {subTitle}</span>}</div>
            <div className="flex-1" />
            <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/80 mr-1">MPV</span>
            {hasVideos && (
              <button onClick={() => { setEpOpen(true); poke(); }} aria-label="Episodes" title="Episodes" className="p-2 hover:text-white/70"><ListVideo size={22} /></button>
            )}
            <div className="relative">
              <button onClick={() => { const open = menu !== 'audio'; setMenu(open ? 'audio' : 'none'); if (open) requestTracks(); poke(); }} aria-label="Audio track" className="p-2 hover:text-white/70"><AudioLines size={22} /></button>
              {menu === 'audio' && (
                <TrackMenu
                  tracks={tracks.filter((t) => t.type === 'audio')}
                  selectedId={trackSel.aid}
                  title="Audio track"
                  loading={tracksLoading}
                  onSelect={(id) => {
                    nativeSelectTrack('aid', id);
                    setTrackSel((s) => ({ ...s, aid: id }));
                    setTracks((prev) => prev.map((t) => (t.type === 'audio' ? { ...t, selected: String(t.id) === id } : t)));
                    setMenu('none');
                    poke();
                  }}
                />
              )}
            </div>
            <div className="relative">
              <button onClick={() => { const open = menu !== 'subs'; setMenu(open ? 'subs' : 'none'); if (open) requestTracks(); poke(); }} aria-label="Subtitles" className="p-2 hover:text-white/70"><Captions size={22} /></button>
              {menu === 'subs' && (
                <TrackMenu
                  tracks={tracks.filter((t) => t.type === 'sub')}
                  selectedId={trackSel.sid}
                  title="Subtitles"
                  loading={tracksLoading}
                  onSelect={(id) => {
                    nativeSelectTrack('sid', id);
                    setTrackSel((s) => ({ ...s, sid: id }));
                    setTracks((prev) => prev.map((t) => (t.type === 'sub' ? { ...t, selected: String(t.id) === id } : t)));
                    setMenu('none');
                    poke();
                  }}
                  extra={
                    <>
                      <button
                        onClick={() => {
                          nativeSelectTrack('sid', 'no');
                          setTrackSel((s) => ({ ...s, sid: 'no' }));
                          setTracks((prev) => prev.map((t) => (t.type === 'sub' ? { ...t, selected: false } : t)));
                          setMenu('none');
                          poke();
                        }}
                        className={'w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-white/10 ' + (trackSel.sid === 'no' ? 'text-white font-semibold' : 'text-white/80')}
                      >
                        <Check size={15} className={trackSel.sid === 'no' ? 'text-[#E50914] shrink-0' : 'opacity-0 shrink-0'} /> Off
                      </button>
                      <div className="border-t border-white/10 my-1" />
                      <button onClick={() => { setMenu('substyle'); poke(); }} className="w-full text-left px-3 py-2 rounded text-white/80 hover:bg-white/10">Subtitle settings…</button>
                    </>
                  }
                />
              )}
              {menu === 'substyle' && (
                <SubStylePanel style={subStyle} onChange={applySubStyle} onReset={() => applySubStyle(DEFAULT_SUB_STYLE)} onClose={() => { setMenu('none'); poke(); }} />
              )}
            </div>
            <div className="relative">
              <button onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')} aria-label="Speed" className="p-2 hover:text-white/70"><Gauge size={22} /></button>
              {menu === 'speed' && (
                <div className="absolute bottom-11 right-0 w-40 bg-[#181818]/95 rounded shadow-modal p-2 text-sm">
                  {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} onClick={() => { setRate(r); nativeSpeed(r); setMenu('none'); }}
                      className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (rate === r ? 'text-[#E50914] font-semibold' : '')}>{r}x</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { nativeAppFullscreen(); setIsFullscreen((s) => !s); }} aria-label="Fullscreen" className="p-2 hover:text-white/70">
              {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
            </button>
          </div>
          {error && <div className="mt-2 text-xs text-amber-300 bg-amber-900/40 rounded px-3 py-1.5">{error}</div>}
          <div className="mt-1 text-[11px] text-white/40">Native engine: mpv (libmpv-2) — MKV, AC3/DTS/TrueHD and ASS subtitles play natively. Space play/pause · ←→ seek · F fullscreen · Esc exit.</div>
        </div>
        {nextCard}
        {episodePanel}
        {streamSelectorModal}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={'fixed inset-0 z-[60] bg-black flex flex-col ' + (showControls ? '' : 'cursor-none')} onMouseMove={poke} onClick={poke}>
      <div className="relative flex-1 min-h-0">
        {isYouTube && youTubeId ? (
          <iframe
            key={youTubeId}
            src={'https://www.youtube.com/embed/' + youTubeId + '?autoplay=1&rel=0'}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0"
          />
        ) : (
        <>
        <video ref={videoRef} className="absolute inset-0 w-full h-full bg-black" playsInline crossOrigin="anonymous" onClick={togglePlay} />
        <div
          className="nf-sub-cues"
          style={{ '--sub-scale': String(subStyle.size), '--sub-color': subStyle.color, '--sub-font': subStyle.font } as CSSProperties}
        >
          {liveCues.map((c, i) => (<div key={i} className="nf-sub-cue">{c.text}</div>))}
        </div>
        </>
        )}
        {loading && !isYouTube && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
            <Loader2 size={48} className="animate-spin text-[#E50914]" />
            <div className="text-sm text-white/80">Loading {mode === 'mkv-remux' ? 'MKV remux pipeline…' : 'stream…'} {modeReason}</div>
          </div>
        )}
        {showNext && onNextEpisode && !isYouTube && (
          <button onClick={onNextEpisode} className="absolute bottom-28 right-6 z-30 bg-white text-black font-bold px-5 py-2.5 rounded flex items-center gap-2 hover:bg-white/85 animate-slide-up">
            Next Episode <SkipForward size={18} />
          </button>
        )}
        {!isYouTube && (
        <div className="absolute bottom-28 left-6 z-30 flex gap-2">
          <button onClick={() => seek(time + 90)} className="bg-white/20 hover:bg-white/30 backdrop-blur px-4 py-2 rounded text-sm font-semibold">Skip Intro</button>
          <button onClick={() => seek(time + 45)} className="bg-white/20 hover:bg-white/30 backdrop-blur px-4 py-2 rounded text-sm font-semibold">Skip Recap</button>
        </div>
        )}
      </div>

      {!isYouTube && (
      <div className={'absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/70 to-transparent px-4 md:px-8 pb-4 pt-12 transition-opacity ' + (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-white/80 w-12">{fmt(time)}</span>
          <input
            type="range" min={0} max={dur || 0} step={0.5} value={time}
            onChange={(e) => seek(Number(e.target.value))}
            className="nf-range flex-1" aria-label="Seek"
            style={{ background: 'linear-gradient(to right, #E50914 ' + progress + '%, rgba(255,255,255,0.3) ' + progress + '%)' }}
          />
          <span className="text-xs text-white/80 w-12 text-right">{fmt(dur)}</span>
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          <button onClick={requestClose} aria-label="Back" className="p-2 hover:text-white/70"><ChevronLeft size={26} /></button>
          <button onClick={togglePlay} aria-label="Play/Pause" className="p-2 hover:text-white/70">
            {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <button onClick={() => seek(time + 10)} aria-label="Forward" className="p-2 hover:text-white/70"><SkipForward size={22} /></button>
          <div className="flex items-center gap-2 group/vol">
            <button onClick={() => setMuted(!muted)} aria-label="Mute" className="p-2 hover:text-white/70">
              {muted || vol === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol}
              onChange={(e) => { const vv = Number(e.target.value); setVol(vv); if (videoRef.current) videoRef.current.volume = vv; setMuted(vv === 0); }}
              className="nf-range w-0 group-hover/vol:w-20 transition-all" aria-label="Volume" />
          </div>
          <div className="text-xs text-white/70 ml-1 truncate max-w-[200px] md:max-w-xs">{title} {subTitle && <span className="text-white/50">· {subTitle}</span>}</div>
          <div className="flex-1" />
          <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/80 mr-1">{mode === 'mkv-remux' ? 'MKV · AAC' : mode.toUpperCase()}</span>
          <div className="relative">
            <button onClick={() => setMenu(menu === 'subs' ? 'none' : 'subs')} aria-label="Subtitles" className="p-2 hover:text-white/70"><Captions size={22} /></button>
            {menu === 'subs' && (
              <div className="absolute bottom-11 right-0 w-56 bg-[#181818]/95 rounded shadow-modal p-2 text-sm max-h-64 overflow-y-auto">
                <button onClick={() => void pickSub(null)} className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (!activeSub ? 'text-[#E50914] font-semibold' : '')}>Off</button>
                {subTracks.map((t) => (
                  <button key={t.id} onClick={() => void pickSub(t)} className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (activeSub === t.id ? 'text-[#E50914] font-semibold' : '')}>{t.label}</button>
                ))}
                {subTracks.length === 0 && <div className="px-3 py-2 text-white/50 text-xs">No subtitle tracks</div>}
                <div className="border-t border-white/10 my-1" />
                <button onClick={() => { setMenu('substyle'); poke(); }} className="w-full text-left px-3 py-2 rounded hover:bg-white/10">Subtitle settings…</button>
              </div>
            )}
            {menu === 'substyle' && (
              <SubStylePanel style={subStyle} onChange={applySubStyle} onReset={() => applySubStyle(DEFAULT_SUB_STYLE)} onClose={() => { setMenu('none'); poke(); }} />
            )}
          </div>
          <div className="relative">
            <button onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')} aria-label="Audio" className="p-2 hover:text-white/70"><AudioLines size={22} /></button>
            {menu === 'audio' && (
              <div className="absolute bottom-11 right-0 w-56 bg-[#181818]/95 rounded shadow-modal p-2 text-sm max-h-64 overflow-y-auto">
                {audioTracks.length === 0 && <div className="px-3 py-2 text-white/50 text-xs">Default audio</div>}
                {audioTracks.map((t) => (<div key={t.id} className="px-3 py-2 text-white/80">{t.label}</div>))}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')} aria-label="Speed" className="p-2 hover:text-white/70"><Gauge size={22} /></button>
            {menu === 'speed' && (
              <div className="absolute bottom-11 right-0 w-40 bg-[#181818]/95 rounded shadow-modal p-2 text-sm">
                {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                  <button key={r} onClick={() => { setRate(r); if (videoRef.current) videoRef.current.playbackRate = r; setMenu('none'); }}
                    className={'w-full text-left px-3 py-2 rounded hover:bg-white/10 ' + (rate === r ? 'text-[#E50914] font-semibold' : '')}>{r}x</button>
                ))}
              </div>
            )}
          </div>
          {hasVideos && (
            <button onClick={() => { setEpOpen(true); poke(); }} aria-label="Episodes" title="Episodes" className="p-2 hover:text-white/70"><ListVideo size={22} /></button>
          )}
          <button aria-label="Settings" className="p-2 hover:text-white/70 hidden md:block"><Settings size={22} /></button>
          <button onClick={() => onPlayerUIModeChange?.(playerUIMode === 'tv' ? 'mobile' : 'tv')} aria-label="Toggle TV/Mobile UI" className="p-2 hover:text-white/70"><Tv size={20} /></button>
          <button onClick={() => setStreamSelectorOpen(true)} aria-label="Stream sources" className="p-2 hover:text-white/70"><ShieldCheck size={20} /></button>
          {mpvReady && !isYouTube && (
            <button onClick={() => void playInMpv()} aria-label="Play in mpv (native)" title="Play in native mpv player" className="p-2 hover:text-white/70">
              <MonitorPlay size={22} />
            </button>
          )}
          <button onClick={toggleFs} aria-label="Fullscreen" className="p-2 hover:text-white/70">{isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}</button>
        </div>
        {error && <div className="mt-2 text-xs text-amber-300 bg-amber-900/40 rounded px-3 py-1.5">{error}</div>}
        {!error && modeReason && <div className="mt-1 text-[11px] text-white/40">Engine: {mode} — {modeReason}</div>}
        {mpvActive && <div className="mt-1 text-[11px] text-green-300">Playing in native mpv window — close it or press Back to return.</div>}
        {nextCard}
        {episodePanel}
        {streamSelectorModal}
        <NextEpisodeFloating
          meta={meta}
          current={video}
          onPlay={(v) => {
            setEpOpen(false);
            episodeRef.current?.(v);
          }}
          onDismiss={() => { /* dismissed */ }}
        />
      </div>
      )}
      {isYouTube && (
        <div className="absolute top-0 inset-x-0 z-30 bg-gradient-to-b from-black/80 to-transparent px-4 md:px-8 py-4 flex items-center gap-3">
          <button onClick={onClose} aria-label="Back" className="p-2 hover:text-white/70"><ChevronLeft size={26} /></button>
          <div className="text-sm text-white/85 truncate">{title} {subTitle && <span className="text-white/50">· {subTitle}</span>}</div>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/80">TRAILER</span>
        </div>
      )}
    </div>
  );
}
