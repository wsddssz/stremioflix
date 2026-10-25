import { useEffect, useMemo, useState } from 'react';
import { X, Play, Plus, Check, ThumbsUp, Loader2 } from 'lucide-react';
import type { PosterMeta, StreamObject, SubtitleObject, VideoMeta } from '../stremio/types';
import { loadFullMeta, resolveStreamsForVideo, streamLabel } from '../services/catalogService';
import { useMyList } from '../services/mylist';
import SmartImage from './SmartImage';

interface Props {
  base: PosterMeta;
  onClose: () => void;
  onPlayStream: (stream: StreamObject, meta: PosterMeta, video?: VideoMeta, subs?: SubtitleObject[]) => void;
}

export default function DetailsModal({ base, onClose, onPlayStream }: Props) {
  const [meta, setMeta] = useState<PosterMeta | null>(null);
  const [season, setSeason] = useState<number>(1);
  const [streams, setStreams] = useState<StreamObject[]>([]);
  const [subs, setSubs] = useState<SubtitleObject[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [activeVideo, setActiveVideo] = useState<VideoMeta | null>(null);
  const [noAddons, setNoAddons] = useState(false);
  const { has, toggle } = useMyList();

  useEffect(() => {
    let live = true;
    loadFullMeta(base.type, base.id).then((m) => {
      if (!live) return;
      const full = m ?? base;
      setMeta(full);
      const ss = Array.from(new Set((full.videos ?? []).map((v) => v.season ?? 1)));
      if (ss.length > 0) setSeason(Math.min(...ss));
    });
    return () => { live = false; };
  }, [base]);

  const allSeasons = useMemo(() => {
    return Array.from(new Set((meta?.videos ?? []).map((v) => v.season ?? 1))).sort((a, b) => a - b);
  }, [meta]);
  const seasons = useMemo(() => allSeasons.filter((s) => s >= 1), [allSeasons]);

  const episodes = useMemo(() => {
    return (meta?.videos ?? [])
      .filter((v) => (v.season ?? 1) >= 1 && (v.season ?? 1) === season) // exclude Season 0 specials
      .sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
  }, [meta, season]);

  const loadStreams = async (video?: VideoMeta | null) => {
    setLoadingStreams(true);
    setActiveVideo(video ?? null);
    try {
      const id = video?.id ?? meta?.id ?? base.id;
      const type = meta?.type ?? base.type;
      const metaId = meta?.id ?? base.id;
      const res = await resolveStreamsForVideo(type, metaId, id);
      setStreams(res.streams);
      setSubs(res.subtitles);
      try {
        const raw = localStorage.getItem('stremioflix.addons');
        const arr = raw ? JSON.parse(raw) : [];
        setNoAddons(res.streams.filter((s) => !s.ytId).length === 0 && (!Array.isArray(arr) || arr.length === 0));
      } catch {
        setNoAddons(res.streams.filter((s) => !s.ytId).length === 0);
      }
    } finally {
      setLoadingStreams(false);
    }
  };

  useEffect(() => {
    if (meta && (meta.type === 'movie' || (meta.videos ?? []).length === 0)) {
      void loadStreams(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const m = meta ?? base;
  const playFirst = () => {
    if (streams[0]) onPlayStream(streams[0], m, activeVideo ?? undefined, subs);
    else void loadStreams(activeVideo);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-2 md:p-6" onClick={onClose}>
      <div className="relative w-full max-w-3xl bg-[#181818] rounded-lg shadow-modal overflow-hidden animate-scale-in my-8" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-video bg-black">
          {m.background ? <SmartImage src={m.background} alt={m.name} kind="backdrop" eager className="w-full h-full object-cover" /> : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
          <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-[#181818] flex items-center justify-center hover:bg-[#222]">
            <X size={20} />
          </button>
          <div className="absolute bottom-6 left-6 md:left-10 right-6">
            <h2 className="text-2xl md:text-4xl font-extrabold mb-4 text-shadow-lg">{m.name}</h2>
            <div className="flex items-center gap-3">
              <button onClick={playFirst} className="flex items-center gap-2 bg-white text-black font-bold px-6 py-2 rounded hover:bg-white/80">
                <Play size={20} fill="currentColor" /> Play
              </button>
              <button
                aria-label={has(m.id, m.type) ? 'Remove from My List' : 'Add to My List'}
                onClick={() => toggle(m)}
                className="w-10 h-10 rounded-full border border-white/40 flex items-center justify-center hover:border-white"
              >
                {has(m.id, m.type) ? <Check size={20} className="text-green-400" /> : <Plus size={20} />}
              </button>
              <button aria-label="Like" className="w-10 h-10 rounded-full border border-white/40 flex items-center justify-center hover:border-white">
                <ThumbsUp size={18} />
              </button>
            </div>
          </div>
        </div>
        <div className="p-6 md:p-10 pt-4 grid md:grid-cols-[2fr_1fr] gap-8">
          <div>
            <div className="flex items-center gap-3 text-sm mb-3">
              <span className="text-green-400 font-bold">{m.imdbRating ? Math.round(Number(m.imdbRating) * 10) + '% Match' : '97% Match'}</span>
              {m.releaseInfo && <span>{m.releaseInfo}</span>}
              {m.runtime && <span className="border border-white/40 px-1 rounded text-xs">{m.runtime}</span>}
              <span className="border border-white/40 px-1 rounded text-xs">HD</span>
            </div>
            <p className="text-sm text-white/90 leading-relaxed">{m.description || 'No synopsis available.'}</p>
            {seasons.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Episodes</h3>
                  <select value={season} onChange={(e) => setSeason(Number(e.target.value))} className="bg-[#222] border border-white/20 rounded px-3 py-1.5 text-sm outline-none">
                    {seasons.map((s) => (<option key={s} value={s}>Season {s}</option>))}
                  </select>
                </div>
                <div className="divide-y divide-white/10 border-y border-white/10 max-h-96 overflow-y-auto">
                  {episodes.map((ep, i) => (
                    <button key={ep.id} onClick={() => void loadStreams(ep)} className={'w-full flex items-center gap-4 p-3 text-left hover:bg-white/5 ' + (activeVideo?.id === ep.id ? 'bg-white/5' : '')}>
                      <span className="text-white/50 w-6 text-center">{ep.episode ?? i + 1}</span>
                      {ep.thumbnail
                        ? <SmartImage src={ep.thumbnail} alt="" kind="backdrop" className="w-28 aspect-video object-cover rounded" />
                        : <span className="w-28 aspect-video bg-[#222] rounded flex items-center justify-center"><Play size={18} className="text-white/50" /></span>}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold truncate">{ep.title || 'Episode ' + (ep.episode ?? i + 1)}</span>
                        <span className="block text-xs text-white/60 line-clamp-2">{ep.overview || ep.released || ''}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="text-xs space-y-2 text-white/70">
            <div><span className="text-white/40">Cast: </span>{(m.cast ?? []).slice(0, 6).join(', ') || '—'}</div>
            <div><span className="text-white/40">Genres: </span>{(m.genres ?? []).join(', ') || m.type}</div>
            <div className="pt-4">
              <h4 className="text-white font-semibold text-sm mb-2">Stream sources</h4>
              {noAddons && (
                <div className="mb-2 text-[11px] leading-relaxed text-amber-200/90 bg-amber-900/30 border border-amber-500/30 rounded p-2.5">
                  Only trailers available. Install a stream addon (profile → Settings / Addons → paste a Torrentio manifest URL) for full movies & episodes.
                </div>
              )}
              {loadingStreams
                ? <div className="flex items-center gap-2 text-white/60"><Loader2 size={16} className="animate-spin" /> Resolving…</div>
                : streams.length === 0
                  ? <div className="text-white/50">No streams yet — select an episode to resolve sources.</div>
                  : <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {streams.map((s, i) => {
                        const lbl = streamLabel(s);
                        return (
                        <button key={i} onClick={() => onPlayStream(s, m, activeVideo ?? undefined, subs)} className="w-full text-left bg-[#222] hover:bg-[#2c2c2c] rounded p-2.5 transition">
                          <span className="block text-[13px] font-semibold text-white truncate">{lbl.name}</span>
                          {lbl.detail && <span className="block text-[11px] text-white/60 truncate">{lbl.detail}</span>}
                          {s.behaviorHints?.filename && <span className="block text-[11px] text-white/40 truncate">{s.behaviorHints.filename}</span>}
                        </button>
                        );
                      })}
                    </div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
