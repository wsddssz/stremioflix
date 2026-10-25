import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Navbar from './components/Navbar';
import type { NavCategory } from './components/Navbar';
import HeroBanner from './components/HeroBanner';
import CatalogRow from './components/CatalogRow';
import DetailsModal from './components/DetailsModal';
import NetflixPlayer from './components/NetflixPlayer';
import SettingsPanel from './components/SettingsPanel';
import SmartImage from './components/SmartImage';
import MyListRow from './components/MyListRow';
import { useMyList } from './services/mylist';
import { getAutoPlayPref, pickAutoStream, setAutoPlayPref, type AutoPlayPref } from './services/playbackStore';
import { loadAllCatalogRows, searchCatalogs, searchCatalogsWithAddons, resolveStreamsForVideo, nextRealEpisode, type SearchResult } from './services/catalogService';
import type { CatalogRow as Row } from './services/catalogService';
import type { PosterMeta, StreamObject, SubtitleObject, VideoMeta, PlayerUIMode } from './stremio/types';

interface PlayState {
  stream: StreamObject;
  meta: PosterMeta;
  video?: VideoMeta;
  subs: SubtitleObject[];
}

export default function App() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PosterMeta[] | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'catalog' | 'addons'>('catalog');
  const [selected, setSelected] = useState<PosterMeta | null>(null);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [category, setCategory] = useState<NavCategory>('home');
  const [playerUIMode, setPlayerUIMode] = useState<PlayerUIMode>('mobile');
  const { items: myList, toggle: toggleList } = useMyList();

  useEffect(() => {
    let live = true;
    // Custom addon catalogs are appended after the built-in Cinemeta rows.
    loadAllCatalogRows().then((r) => {
      if (!live) return;
      setRows(r);
      setLoading(false);
    }).catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  // ---- Search with request-ordering guard and simple cache ----
  const searchSeqRef = useRef(0);
  const searchCacheRef = useRef<Map<string, PosterMeta[] | SearchResult[]>>(new Map());

  useEffect(() => {
    if (!query.trim()) { setResults(null); setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeqRef.current;
    const cacheKey = searchMode + ':' + query.trim().toLowerCase();
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setSearching(false);
      if (searchMode === 'addons') { setSearchResults(cached as SearchResult[]); setResults(null); }
      else { setResults(cached as PosterMeta[]); setSearchResults(null); }
      return;
    }
    const t = window.setTimeout(() => {
      const p = searchMode === 'addons' ? searchCatalogsWithAddons(query) : searchCatalogs(query);
      p.then((r) => {
        if (seq !== searchSeqRef.current) return; // stale response
        searchCacheRef.current.set(cacheKey, r);
        if (searchCacheRef.current.size > 30) {
          const firstKey = searchCacheRef.current.keys().next().value;
          if (firstKey) searchCacheRef.current.delete(firstKey);
        }
        if (searchMode === 'addons') { setSearchResults(r as SearchResult[]); setResults(null); }
        else { setResults(r as PosterMeta[]); setSearchResults(null); }
        setSearching(false);
      }).catch(() => { if (seq === searchSeqRef.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, searchMode]);

  const visibleRows = useMemo(() => {
    if (category === 'home' || category === 'new') return rows;
    if (category === 'mylist') return rows; // My List renders as its own section
    return rows
      .map((r) => ({ ...r, items: r.items.filter((m) => (category === 'movies' ? m.type === 'movie' : m.type !== 'movie')) }))
      .filter((r) => r.items.length > 0);
  }, [rows, category]);

  const hero = useMemo(() => {
    const all = visibleRows.flatMap((r) => r.items);
    if (all.length === 0) return null;
    const withBg = all.filter((m) => m.background);
    return withBg[Math.floor(withBg.length / 2)] ?? all[0];
  }, [visibleRows]);

  const quickPlay = useCallback((m: PosterMeta) => {
    setSelected(m);
  }, []);

  const onPlayStream = useCallback((stream: StreamObject, meta: PosterMeta, video?: VideoMeta, subs?: SubtitleObject[]) => {
    setSelected(null);
    setPlay({ stream, meta, video, subs: subs ?? [] });
  }, []);

  /**
   * Auto-play for a video when the title has a default-addon preference:
   * resolve that video's streams, pick via the pref, and return them.
   * Returns null when there is no pref or the addon has no streams for this
   * video (caller falls back to the source selector).
   */
  const autoPlayFor = useCallback(async (meta: PosterMeta, video?: VideoMeta) => {
    const pref = getAutoPlayPref(meta.id);
    if (!pref) return null;
    try {
      const res = await resolveStreamsForVideo(meta.type, meta.id, video?.id ?? meta.id);
      const stream = pickAutoStream(res.streams, pref);
      if (!stream) return null;
      return { stream, subs: res.subtitles };
    } catch {
      return null;
    }
  }, []);

  /**
   * Play a video honoring the title's default-addon pref: when the pref
   * resolves, start immediately like Netflix; otherwise return false so the
   * caller shows the source selector instead.
   */
  const playWithPref = useCallback(async (meta: PosterMeta, video?: VideoMeta) => {
    const hit = await autoPlayFor(meta, video);
    if (hit) {
      setSelected(null);
      setPlay({ stream: hit.stream, meta, video, subs: hit.subs });
      return true;
    }
    return false;
  }, [autoPlayFor]);

  /** Jump to another episode of the currently playing title (episode panel / next-episode).
   *  Honors the title's default-addon pref so the source selector is skipped
   *  when autoplay is set. Falls back to the raw streams payload so the player
   *  can open the selector when the preferred addon has nothing. */
  const playEpisode = useCallback(async (ep: VideoMeta, streamsHint?: StreamObject[], subsHint?: SubtitleObject[]) => {
    if (!play) return;
    try {
      const res = streamsHint
        ? { streams: streamsHint, subtitles: subsHint ?? [] }
        : await resolveStreamsForVideo(play.meta.type, play.meta.id, ep.id);
      const pref = getAutoPlayPref(play.meta.id);
      const picked = pref ? pickAutoStream(res.streams, pref) : null;
      const stream = picked ?? res.streams.find((s) => !s.ytId) ?? res.streams[0];
      if (!stream) return;
      setPlay({ stream, meta: play.meta, video: ep, subs: res.subtitles });
    } catch { /* keep current episode if resolution fails */ }
  }, [play]);

  const playNextEpisode = useCallback(() => {
    if (!play?.video) return;
    const next = nextRealEpisode(play.meta.videos ?? [], play.video);
    if (next) void playEpisode(next);
  }, [play, playEpisode]);

  /** Switch the currently playing video to a different stream (in-player source picker). */
  const selectStream = useCallback((s: StreamObject) => {
    setPlay((p) => {
      if (!p) return p;
      const pref: AutoPlayPref = { addonUrl: s.addonUrl || '' , addonName: s.addonName || '', resolution: 'auto' };
      setAutoPlayPref(p.meta.id, pref);
      return { ...p, stream: s };
    });
  }, []);

  /** Episode + stream picked together from the in-player source selector:
   *  switch episode and source in one atomic state update (no intermediate
   *  auto-picked stream starts playing). External subs resolved for the new
   *  episode ride along so subtitle tracks stay in sync. */
  const selectEpisodeStream = useCallback((ep: VideoMeta, s: StreamObject, subs?: SubtitleObject[]) => {
    setPlay((p) => {
      if (!p) return p;
      const pref: AutoPlayPref = { addonUrl: s.addonUrl || '' , addonName: s.addonName || '', resolution: 'auto' };
      setAutoPlayPref(p.meta.id, pref);
      return { stream: s, meta: p.meta, video: ep, subs: subs ?? [] };
    });
  }, []);

  // Only advertise "next episode" when the series actually has one after current.
  let nextForPlay: (() => void) | undefined;
  if (play?.video) {
    const vids = play.meta.videos ?? [];
    const curId = play.video.id;
    const i = vids.findIndex((v) => v.id === curId);
    if (i >= 0 && i + 1 < vids.length) nextForPlay = playNextEpisode;
  }

  return (
    <div className="nf-app min-h-screen bg-[#141414] text-[#e5e5e5] font-netflix">
      <Navbar
        query={query}
        onQuery={setQuery}
        onHome={() => { setQuery(''); setResults(null); setSelected(null); setCategory('home'); }}
        onOpenSettings={() => setSettingsOpen(true)}
        category={category}
        onCategory={setCategory}
      />

      {results !== null ? (
        <main className="pt-24 px-4 md:px-12 pb-16 min-h-screen">
          <h1 className="text-xl font-semibold mb-4">
            {searching ? 'Searching…' : results.length + ' results for "' + query + '"'}
          </h1>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {results.map((m) => (
              <button key={m.type + ':' + m.id} onClick={() => setSelected(m)} className="text-left group">
                <span className="block rounded overflow-hidden bg-[#222] aspect-[2/3] group-hover:ring-2 group-hover:ring-white/60">
                  {m.poster ? <SmartImage src={m.poster} alt={m.name} className="w-full h-full object-cover" /> : <span className="flex h-full items-center justify-center p-3 text-sm text-white/50">{m.name}</span>}
                </span>
                <span className="block text-xs mt-1.5 text-white/80 truncate">{m.name}</span>
                <span className="block text-[11px] text-white/40">{m.releaseInfo || m.type}</span>
              </button>
            ))}
          </div>
          {!searching && results.length === 0 && (
            <p className="text-white/60 mt-8">No titles found. Try another search across Cinemeta catalogs.</p>
          )}
        </main>
      ) : (
        <main className="pb-16">
          <HeroBanner item={hero} onPlay={quickPlay} onMoreInfo={setSelected} />
          <div className="-mt-20 relative z-10">
            {category === 'mylist' && (
              <div className="pt-24">
                <MyListRow items={myList} onSelect={setSelected} onRemove={toggleList} />
              </div>
            )}
            {category !== 'mylist' && (
            <>
            {category === 'new' && (
              <div className="px-4 md:px-12 mb-4">
                <h2 className="text-xl md:text-2xl font-bold">New & Popular</h2>
                <p className="text-sm text-white/60">Fresh and trending titles across all catalogs.</p>
              </div>
            )}
            {loading && (
              <div className="px-4 md:px-12 space-y-6">
                {[0, 1, 2].map((r) => (
                  <div key={r}>
                    <div className="h-5 w-48 bg-white/10 rounded mb-3 animate-pulse" />
                    <div className="flex gap-2 overflow-hidden">
                      {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="w-[160px] md:w-[220px] aspect-[2/3] bg-white/5 rounded animate-pulse shrink-0" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {visibleRows.map((r) => (
              <CatalogRow key={r.def.key} title={r.def.title} items={r.items} onSelect={setSelected} onPlay={quickPlay} inMyList={myList} onToggleList={toggleList} />
            ))}
            {!loading && rows.length === 0 && (
              <div className="px-4 md:px-12 py-16 text-center text-white/60">
                <p className="text-lg mb-2">Couldn&apos;t reach Stremio addons.</p>
                <p className="text-sm">Check your connection — Cinemeta catalogs will load automatically when reachable.</p>
              </div>
            )}
            </>
            )}
          </div>
        </main>
      )}

      <footer className="px-4 md:px-12 pb-10 text-xs text-white/40">
        <p className="mb-2 text-white/50">StremioFlix — Stremio addons (Cinemeta · OpenSubtitles) with a Netflix experience.</p>
        <p>MKV / AC3 / DTS / ASS handled in-browser by the Universal MKV Media Engine. Local streaming server: http://127.0.0.1:11470</p>
      </footer>

      {selected && (
        <DetailsModal base={selected} onClose={() => setSelected(null)} onPlayStream={onPlayStream} />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {play && (
        <NetflixPlayer
          stream={play.stream}
          meta={play.meta}
          video={play.video}
          externalSubs={play.subs}
          onClose={() => setPlay(null)}
          onNextEpisode={nextForPlay}
          onEpisodeSelect={playEpisode}
          onStreamSelect={selectStream}
          onEpisodeStreamSelect={selectEpisodeStream}
          playerUIMode={playerUIMode}
          onPlayerUIModeChange={setPlayerUIMode}
        />
      )}
    </div>
  );
}
