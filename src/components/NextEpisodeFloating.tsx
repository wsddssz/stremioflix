import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Play, SkipForward, ChevronRight, X, Clock } from 'lucide-react';
import type { VideoMeta, PosterMeta } from '../stremio/types';
import SmartImage from './SmartImage';

interface Props {
  meta: PosterMeta;
  current: VideoMeta | undefined;
  onPlay: (v: VideoMeta) => void;
  onDismiss: () => void;
  className?: string;
}

/** Floating PIP-style box that slides out from the episode currently being watched,
 * showing the next episode in the season with a smooth animation. Clicking it plays
 * the next episode immediately.
 */
export default function NextEpisodeFloating({ meta, current, onPlay, onDismiss, className }: Props) {
  const videos = useMemo(() => (meta?.videos ?? [])
    .filter((v) => (v.season ?? 1) >= 1) // exclude Season 0 specials
    .sort((a, b) => {
      const sa = a.season ?? 1;
      const sb = b.season ?? 1;
      if (sa !== sb) return sa - sb;
      return (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);
    }), [meta]);

  const currentIdx = videos.findIndex((v) => v.id === current?.id);
  const next = currentIdx >= 0 && currentIdx + 1 < videos.length ? videos[currentIdx + 1] : null;
  const [visible, setVisible] = useState(false);
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    if (next && !animateOut) setVisible(true);
    else if (!next) setVisible(false);
  }, [next, animateOut]);

  const handlePlay = () => {
    setAnimateOut(true);
    setTimeout(() => { setVisible(false); setAnimateOut(false); }, 200);
    onPlay(next!);
  };

  if (!visible || !next) return null;

  const style: CSSProperties = {
    transform: `translate3d(${animateOut ? '120%' : '0%'}, ${animateOut ? '-20px' : '0'}, 0) scale(${animateOut ? 0.9 : 1})`,
    opacity: animateOut ? 0 : 1,
  };

  return (
    <div
      className={['fixed bottom-6 right-6 z-[90] w-72 rounded-xl border border-white/10 bg-[#181818]/95 backdrop-blur-md shadow-2xl overflow-hidden animate-fade-in pointer-events-auto', className].filter(Boolean).join(' ')}
      style={{ ...style, transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
    >
      <div className="absolute top-2 right-2 z-10">
        <button onClick={onDismiss} className="p-1.5 text-white/60 hover:text-white rounded bg-black/40" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
      <div className="relative h-32 overflow-hidden">
        {next.thumbnail ? (
          <SmartImage src={next.thumbnail} alt={next.title || 'Next episode'} kind="backdrop" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[#222] flex items-center justify-center">
            <Play size={24} className="text-white/50" />
          </div>
        )}
        {/* Play button overlay on the thumbnail */}
        <button
          onClick={handlePlay}
          onMouseEnter={() => setVisible(true)}
          className="absolute inset-0 bg-black/40 hover:bg-black/20 transition flex items-center justify-center"
          aria-label={`Play next episode: ${next.title || next.episode || currentIdx + 2}`}
        >
          <Play size={36} fill="currentColor" className="text-white drop-shadow-lg" />
        </button>
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={12} className="text-[#E50914]" />
          <span className="text-[10px] text-[#E50914] font-bold uppercase tracking-wider">Next episode</span>
          <span className="ml-auto text-[10px] text-white/40">
            S{next.season ?? 1} · E{next.episode ?? next.number ?? currentIdx + 2}
          </span>
        </div>
        <h4 className="text-sm font-semibold text-white truncate">{next.title || `Episode ${next.episode ?? next.number ?? currentIdx + 2}`}</h4>
        {next.overview && <p className="text-[11px] text-white/50 line-clamp-1 mt-0.5">{next.overview}</p>}
        <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between">
          <button onClick={handlePlay} className="flex items-center gap-1.5 bg-[#E50914] text-black text-xs font-bold px-2.5 py-1.5 rounded hover:bg-[#f6121d]">
            <Play size={12} fill="currentColor" /> Play Now
          </button>
          <span className="text-[10px] text-white/40">Tap to play next</span>
        </div>
      </div>
    </div>
  );
}