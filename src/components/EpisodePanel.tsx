import { useEffect, useMemo, useState } from 'react';
import { X, Play } from 'lucide-react';
import type { PosterMeta, VideoMeta } from '../stremio/types';
import SmartImage from './SmartImage';

interface Props {
  meta: PosterMeta;
  current?: VideoMeta;
  onSelect: (v: VideoMeta) => void;
  onClose: () => void;
}

/** Netflix/Stremio-style episode sheet: season dropdown + episode list with
 *  thumbnails, numbers and summaries. Click an episode to play it. */
export default function EpisodePanel({ meta, current, onSelect, onClose }: Props) {
  // Only real seasons (season >= 1). Season 0 = specials, excluded from the
  // main season dropdown so users never land on an empty "Season 0" or a
  // synthetic season filled with specials + retelling episodes.
  const allSeasons = useMemo(
    () => Array.from(new Set((meta.videos ?? []).map((v) => v.season ?? 1))).sort((a, b) => a - b),
    [meta],
  );
  const seasons = useMemo(
    () => allSeasons.filter((s) => s >= 1),
    [allSeasons],
  );
  const [season, setSeason] = useState(() => {
    const def = current?.season ?? current?.number;
    return (def && def >= 1 ? def : seasons[0]) ?? 1;
  });

  // Keep the selected season in sync with the currently playing episode so the
  // dropdown and filtered list always reflect the real season (never a stale
  // or synthetic Season 0 default) when the episode changes.
  useEffect(() => {
    const def = current?.season ?? current?.number;
    setSeason((def && def >= 1 ? def : seasons[0]) ?? 1);
  }, [current, seasons]);

  const episodes = useMemo(
    () =>
      (meta.videos ?? [])
        .filter((v) => (v.season ?? 1) >= 1 && (v.season ?? 1) === season) // exclude Season 0 specials
        .sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)),
    [meta, season],
  );

  return (
    <div className="fixed inset-0 z-[70] bg-black/60" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full sm:w-[440px] bg-[#181818] shadow-modal flex flex-col animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">Episodes</h3>
            {seasons.length > 1 && (
              <select
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
                aria-label="Season"
                className="bg-[#222] border border-white/20 rounded px-2 py-1 text-sm outline-none"
              >
                {seasons.map((s) => (<option key={s} value={s}>Season {s}</option>))}
              </select>
            )}
          </div>
          <button onClick={onClose} aria-label="Close episodes" className="p-2 text-white/60 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {episodes.length === 0 && (
            <div className="p-6 text-sm text-white/50">No episodes available for this title.</div>
          )}
          {episodes.map((ep, i) => {
            const isCurrent = !!current && current.id === ep.id;
            return (
              <button
                key={ep.id}
                onClick={() => { onSelect(ep); onClose(); }}
                className={
                  'w-full flex items-start gap-3 p-4 text-left border-b border-white/10 transition hover:bg-white/5 ' +
                  (isCurrent ? 'bg-white/10' : '')
                }
              >
                <span className={'text-lg font-bold w-7 shrink-0 pt-1 ' + (isCurrent ? 'text-[#E50914]' : 'text-white/50')}>
                  {ep.episode ?? ep.number ?? i + 1}
                </span>
                <span className="relative shrink-0 w-32">
                  {ep.thumbnail ? (
                    <SmartImage src={ep.thumbnail} alt="" kind="backdrop" className="w-32 aspect-video object-cover rounded" />
                  ) : (
                    <span className="w-32 aspect-video bg-[#222] rounded flex items-center justify-center">
                      <Play size={18} className="text-white/50" />
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute inset-0 rounded flex items-center justify-center bg-black/50">
                      <span className="text-[10px] font-bold bg-[#E50914] px-2 py-0.5 rounded">NOW PLAYING</span>
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white/90 truncate">{ep.title || 'Episode ' + (ep.episode ?? i + 1)}</span>
                  <span className="block text-xs text-white/50 line-clamp-2 mt-0.5">{ep.overview || ep.released || ''}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
