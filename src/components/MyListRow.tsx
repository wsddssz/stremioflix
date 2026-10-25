import { BookmarkX } from 'lucide-react';
import type { PosterMeta } from '../stremio/types';
import type { MyListItem } from '../services/mylist';
import SmartImage from './SmartImage';

interface Props {
  items: MyListItem[];
  onSelect: (m: PosterMeta) => void;
  onRemove: (m: PosterMeta) => void;
}

export default function MyListRow({ items, onSelect, onRemove }: Props) {
  if (items.length === 0) {
    return (
      <section className="px-4 md:px-12 mb-8">
        <h2 className="text-base md:text-lg font-semibold mb-2">My List</h2>
        <div className="bg-[#181818] rounded-lg p-8 text-center text-white/60 text-sm">
          Your list is empty. Hover any title and hit <span className="text-white font-semibold">+</span> to save it here.
        </div>
      </section>
    );
  }
  return (
    <section className="mb-8">
      <h2 className="text-base md:text-lg font-semibold text-[#e5e5e5] px-4 md:px-12 mb-2">My List</h2>
      <div className="nf-row-scroll flex gap-2 overflow-x-auto px-4 md:px-12 pb-2 scroll-smooth">
        {items.map((i) => {
          const meta: PosterMeta = { id: i.id, type: i.type, name: i.name, poster: i.poster, background: i.background, releaseInfo: i.releaseInfo };
          return (
            <div key={i.type + ':' + i.id} className="relative shrink-0 w-[160px] md:w-[220px] cursor-pointer group" onClick={() => onSelect(meta)}>
              <div className="rounded overflow-hidden bg-[#222] shadow-card aspect-[2/3]">
                {i.poster ? (
                  <SmartImage src={i.poster} alt={i.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/40 text-sm p-4 text-center">{i.name}</div>
                )}
              </div>
              <button
                aria-label="Remove from list"
                onClick={(e) => { e.stopPropagation(); onRemove(meta); }}
                className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#E50914] transition"
              >
                <BookmarkX size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
