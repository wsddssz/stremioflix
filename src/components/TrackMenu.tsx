import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MpTrack } from '../services/nativeBridge';

interface Props {
  tracks: MpTrack[];
  selectedId: string;
  title: string;
  loading?: boolean;
  onSelect: (id: string) => void;
  extra?: ReactNode;
}

/** Netflix-style radio list used by the audio & subtitle pickers (desktop shell). */
export default function TrackMenu({ tracks, selectedId, title, loading, onSelect, extra }: Props) {
  return (
    <div className="absolute bottom-11 right-0 w-64 bg-[#181818]/98 border border-white/10 rounded shadow-modal p-1.5 text-sm max-h-72 overflow-y-auto z-40">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-white/40 font-semibold">{title}</div>
      {loading && tracks.length === 0 && <div className="px-3 py-2 text-white/50 text-xs">Loading tracks…</div>}
      {!loading && tracks.length === 0 && <div className="px-3 py-2 text-white/50 text-xs">No tracks in this stream</div>}
      {tracks.map((t) => {
        const id = String(t.id);
        const isOn = selectedId === id;
        const label = [t.lang, t.title, t.codec?.toUpperCase()].filter(Boolean).join(' · ') || 'Track ' + t.id;
        return (
          <button
            key={t.type + '-' + t.id}
            onClick={() => onSelect(id)}
            className={'w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-white/10 transition ' + (isOn ? 'text-white font-semibold' : 'text-white/80')}
          >
            <Check size={15} className={isOn ? 'text-[#E50914] shrink-0' : 'opacity-0 shrink-0'} />
            <span className="truncate">{label}</span>
            {t.external && <span className="ml-auto text-[10px] text-white/40 border border-white/20 px-1 rounded shrink-0">ext</span>}
          </button>
        );
      })}
      {extra}
    </div>
  );
}
