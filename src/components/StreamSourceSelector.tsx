import { useMemo, useState } from 'react';
import { ShieldCheck, Download, Film, Play, Circle, Loader2 } from 'lucide-react';
import type { StreamObject, AddonStreamGroup } from '../stremio/types';
import { streamLabel, filterStreamsByAddon, groupStreamsByAddon, getAddonFilterOptions } from '../services/catalogService';

interface Props {
  streams: StreamObject[];
  onSelect: (stream: StreamObject) => void;
  loading?: boolean;
  className?: string;
}

/** Multi-addon stream source selector with addon filtering chips.
 * Shows streams grouped by their source addon, with filter chips to show
 * sources from a specific addon (like Stremio's catalog/addon filtering).
 */
export default function StreamSourceSelector({ streams, onSelect, loading = false, className }: Props) {
  const [filterAddon, setFilterAddon] = useState<string | null>(null);
  const groups = useMemo(() => groupStreamsByAddon(filterStreamsByAddon(streams, filterAddon)), [streams, filterAddon]);
  const filterOptions = useMemo(() => getAddonFilterOptions(streams), [streams]);

  const totalStreams = groups.reduce((sum, g) => sum + g.streams.length, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-white/50">
        <Loader2 size={20} className="animate-spin mr-2" /> Resolving streams from addons…
      </div>
    );
  }

  if (totalStreams === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-white/50">
        <Film size={32} className="mb-2 opacity-50" />
        <p className="text-sm">No playable streams available.</p>
        {filterAddon && (
          <button
            onClick={() => setFilterAddon(null)}
            className="mt-3 text-xs text-[#E50914] hover:text-white underline"
          >
            Clear addon filter
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={['space-y-3', className].filter(Boolean).join(' ')}>
      {/* Addon filter chips */}
      <div className="flex flex-wrap gap-2 mb-1">
        <button
          onClick={() => setFilterAddon(null)}
          className={`px-3 py-1.5 rounded text-sm border transition ${
            filterAddon === null
              ? 'bg-[#E50914] text-white border-[#E50914]'
              : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
          }`}
        >
          All addons ({totalStreams})
        </button>
        {filterOptions.map((opt) => (
          <button
            key={opt.addonUrl}
            onClick={() => setFilterAddon(opt.addonUrl === (filterAddon || '') ? null : opt.addonUrl)}
            className={`px-3 py-1.5 rounded text-sm border transition ${
              filterAddon === opt.addonUrl
                ? 'bg-[#E50914] text-white border-[#E50914]'
                : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
          >
            {opt.addonName}
          </button>
        ))}
      </div>

      {/* Stream groups by addon */}
      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.addonUrl} className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-[#141414] border-b border-white/10">
              <span className="text-xs font-bold">{group.icon}</span>
              <span className="text-xs font-semibold text-white">{group.addonName}</span>
              <span className="ml-auto text-[10px] text-white/40 bg-white/10 px-1.5 py-0.5 rounded">
                {group.streams.length}
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {group.streams.map((s: StreamObject, i: number) => {
                const lbl = streamLabel(s);
                const isTrailer = !!s.ytId;
                return (
                  <button
                    key={i}
                    onClick={() => onSelect(s)}
                    className="w-full text-left px-3 py-2.5 transition hover:bg-white/10 focus:outline-none"
                  >
                    <div className="flex items-center gap-2">
                      {isTrailer ? (
                        <Circle size={10} className="text-[#E50914]" />
                      ) : (
                        <ShieldCheck size={10} className="text-green-400/70" />
                      )}
                      <span className="block text-[12px] font-semibold text-white truncate">
                        {lbl.name}
                      </span>
                      {isTrailer && <span className="ml-auto text-[10px] text-[#E50914]/80">TRAILER</span>}
                    </div>
                    <span className="block text-[10px] text-white/50 truncate">{lbl.detail}</span>
                    {s.behaviorHints?.filename && (
                      <span className="block text-[10px] text-white/40 truncate mt-0.5">
                        {s.behaviorHints.filename}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}