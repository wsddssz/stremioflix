import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Plus, Check, ThumbsUp, ChevronDown } from 'lucide-react';
import type { PosterMeta } from '../stremio/types';
import type { MyListItem } from '../services/mylist';
import SmartImage from './SmartImage';

interface RowProps {
  title: string;
  items: PosterMeta[];
  onSelect: (m: PosterMeta) => void;
  onPlay: (m: PosterMeta) => void;
  inMyList?: MyListItem[];
  onToggleList?: (m: PosterMeta) => void;
}

function saved(ids: MyListItem[] | undefined, m: PosterMeta): boolean {
  return !!ids?.some((i) => i.id === m.id && i.type === m.type);
}

export default function CatalogRow({ title, items, onSelect, onPlay, inMyList, onToggleList }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (!items.length) return null;

  return (
    <section className="relative mb-6 md:mb-8 group/row">
      <h2 className="text-base md:text-lg font-semibold text-[#e5e5e5] px-4 md:px-12 mb-2 hover:text-white cursor-pointer w-fit">
        {title} <span className="text-xs text-sky-400 opacity-0 group-hover/row:opacity-100 transition ml-2">Explore All ›</span>
      </h2>
      <div className="relative">
        <button
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
          className="hidden md:flex absolute left-0 top-0 bottom-0 z-20 w-12 items-center justify-center bg-black/50 opacity-0 group-hover/row:opacity-100 hover:bg-black/70 transition rounded-r"
        >
          <ChevronLeft size={32} />
        </button>
        <div ref={ref} className="nf-row-scroll flex gap-2 overflow-x-auto px-4 md:px-12 pb-6 pt-2 scroll-smooth">
          {items.map((m) => (
            <div
              key={m.type + ':' + m.id}
              className="relative shrink-0 w-[160px] md:w-[220px] cursor-pointer transition-transform duration-200 hover:scale-[1.04] hover:z-10"
              onMouseEnter={() => setHover(m.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(m)}
            >
              <div className="rounded overflow-hidden bg-[#222] shadow-card aspect-[2/3]">
                {m.poster ? (
                  <SmartImage src={m.poster} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/40 text-sm p-4 text-center">{m.name}</div>
                )}
              </div>
              {hover === m.id && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-2 w-[260px] bg-[#181818] rounded-lg shadow-modal p-3 z-30 animate-scale-in hidden md:block">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onPlay(m); }}
                      aria-label="Play"
                      className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/80"
                    >
                      <Play size={18} fill="currentColor" />
                    </button>
                    <button
                      aria-label={saved(inMyList, m) ? 'Remove from My List' : 'Add to My List'}
                      onClick={(e) => { e.stopPropagation(); onToggleList?.(m); }}
                      className="w-9 h-9 rounded-full border border-white/40 flex items-center justify-center hover:border-white"
                    >
                      {saved(inMyList, m) ? <Check size={18} className="text-green-400" /> : <Plus size={18} />}
                    </button>
                    <button aria-label="Like" className="w-9 h-9 rounded-full border border-white/40 flex items-center justify-center hover:border-white">
                      <ThumbsUp size={16} />
                    </button>
                    <div className="flex-1" />
                    <button aria-label="Details" onClick={(e) => { e.stopPropagation(); onSelect(m); }} className="w-9 h-9 rounded-full border border-white/40 flex items-center justify-center hover:border-white">
                      <ChevronDown size={18} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="text-green-400 font-bold">
                      {m.imdbRating ? Math.round(Number(m.imdbRating) * 10) + '% Match' : '97% Match'}
                    </span>
                    <span className="border border-white/40 px-1 rounded text-[10px]">HD</span>
                    {m.releaseInfo && <span className="text-white/70">{m.releaseInfo}</span>}
                  </div>
                  <div className="text-[11px] text-white/70">
                    {(m.genres ?? []).slice(0, 3).join(' · ') || m.type}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => scroll(1)}
          aria-label="Scroll right"
          className="hidden md:flex absolute right-0 top-0 bottom-0 z-20 w-12 items-center justify-center bg-black/50 opacity-0 group-hover/row:opacity-100 hover:bg-black/70 transition rounded-l"
        >
          <ChevronRight size={32} />
        </button>
      </div>
    </section>
  );
}
