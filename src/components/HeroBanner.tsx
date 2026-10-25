import { Play, Info, Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import type { PosterMeta } from '../stremio/types';
import SmartImage from './SmartImage';

interface Props {
  item: PosterMeta | null;
  onPlay: (m: PosterMeta) => void;
  onMoreInfo: (m: PosterMeta) => void;
}

export default function HeroBanner({ item, onPlay, onMoreInfo }: Props) {
  const [muted, setMuted] = useState(true);
  if (!item) {
    return (
      <div className="relative h-[75vh] min-h-[480px] bg-[#141414] flex items-end">
        <div className="px-4 md:px-12 pb-24 animate-pulse">
          <div className="h-10 w-72 bg-white/10 rounded mb-4" />
          <div className="h-4 w-96 max-w-full bg-white/10 rounded mb-2" />
          <div className="h-4 w-64 bg-white/10 rounded" />
        </div>
      </div>
    );
  }
  const bg = item.background || item.poster;
  return (
    <section className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
      {bg ? (
        <SmartImage src={bg} alt={item.name} kind="backdrop" eager className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#222] to-black" />
      )}
      <div className="absolute inset-0 billboard-gradient" />
      <div className="absolute inset-x-0 bottom-0 h-56 bottom-fade" />
      <div className="absolute inset-x-0 top-0 h-24 top-fade" />

      <div className="relative z-10 h-full flex flex-col justify-end px-4 md:px-12 pb-28 max-w-3xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[#E50914] font-black text-lg leading-none">S</span>
          <span className="tracking-[0.3em] text-xs text-white/80 font-semibold">SERIES · FILM</span>
        </div>
        {item.logo ? (
          <img src={item.logo} alt={item.name} className="max-h-36 object-contain object-left mb-4 text-shadow-lg" />
        ) : (
          <h1 className="text-4xl md:text-6xl font-extrabold mb-4 text-shadow-lg leading-tight">{item.name}</h1>
        )}
        <div className="flex items-center gap-3 text-sm mb-3">
          <span className="text-green-400 font-semibold">
            {item.imdbRating ? Math.round(Number(item.imdbRating) * 10) + '% Match' : '98% Match'}
          </span>
          {item.releaseInfo && <span className="text-white/80">{item.releaseInfo}</span>}
          {item.runtime && <span className="border border-white/40 px-1.5 py-0.5 text-xs rounded">{item.runtime}</span>}
          <span className="border border-white/40 px-1.5 py-0.5 text-xs rounded">HD</span>
        </div>
        <p className="text-sm md:text-base text-white/90 line-clamp-3 mb-6 max-w-xl text-shadow-lg">
          {item.description || 'No synopsis available.'}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onPlay(item)}
            className="flex items-center gap-2 bg-white text-black font-bold px-6 md:px-8 py-2 md:py-2.5 rounded hover:bg-white/80 transition text-base"
          >
            <Play size={22} fill="currentColor" /> Play
          </button>
          <button
            onClick={() => onMoreInfo(item)}
            className="flex items-center gap-2 bg-[#6d6d6e]/80 text-white font-bold px-6 md:px-8 py-2 md:py-2.5 rounded hover:bg-[#6d6d6e]/60 transition text-base"
          >
            <Info size={22} /> More Info
          </button>
        </div>
      </div>

      <div className="absolute right-0 bottom-32 z-10 flex items-center gap-3">
        <button
          onClick={() => setMuted(!muted)}
          aria-label="Toggle mute"
          className="w-10 h-10 rounded-full border border-white/50 flex items-center justify-center hover:bg-white/10"
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <span className="bg-black/40 border-l-2 border-white pl-2 pr-8 py-1 text-sm">TV-MA</span>
      </div>
    </section>
  );
}
