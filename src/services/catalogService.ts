import { fetchCatalog, fetchManifest, fetchMeta } from '../stremio/AddonClient';
import type { ManifestCatalog } from '../stremio/types';
import { DEFAULT_ROWS, LOCAL_STREAMING_SERVER } from '../stremio/defaultAddons';
import type { CatalogRowDef } from '../stremio/defaultAddons';
import type { PosterMeta, StreamObject, SubtitleObject, AddonStreamGroup, VideoMeta } from '../stremio/types';
import { fetchStreams, fetchSubtitles } from '../stremio/AddonClient';

export interface CatalogRow {
  def: CatalogRowDef;
  items: PosterMeta[];
}

export async function loadCatalogRows(rows: CatalogRowDef[] = DEFAULT_ROWS): Promise<CatalogRow[]> {
  const settled = await Promise.allSettled(
    rows.map(async (def) => {
      const res = await fetchCatalog({
        addonUrl: def.addonUrl,
        type: def.type,
        id: def.catalogId,
        extra: def.extra,
      });
      return { def, items: res.metas } as CatalogRow;
    }),
  );
  return settled
    .filter((r): r is PromiseFulfilledResult<CatalogRow> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r) => r.items.length > 0);
}

export async function searchCatalogs(query: string): Promise<PosterMeta[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const targets = [
    { addonUrl: 'https://v3-cinemeta.strem.io', type: 'movie', id: 'top', extra: { search: q } },
    { addonUrl: 'https://v3-cinemeta.strem.io', type: 'series', id: 'top', extra: { search: q } },
    { addonUrl: 'https://v3-cinemeta.strem.io', type: 'channel', id: 'top', extra: { search: q } },
  ];
  const settled = await Promise.allSettled(targets.map((t) => fetchCatalog(t)));
  const seen = new Set<string>();
  const out: PosterMeta[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const m of s.value.metas) {
      const k = `${m.type}:${m.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
  }
  return out.slice(0, 60);
}

export async function loadFullMeta(
  type: string,
  id: string,
): Promise<PosterMeta | null> {
  const res = await fetchMeta('https://v3-cinemeta.strem.io', type, id);
  if (res?.meta) return res.meta;
  // Fall back to user addons so custom-catalog items resolve their own meta
  // (episodes, posters, descriptions) and stay playable via DetailsModal.
  for (const addonUrl of loadStreamAddonUrls()) {
    try {
      const r = await fetchMeta(addonUrl, type, id);
      if (r?.meta) return r.meta;
    } catch { /* try next addon */ }
  }
  return null;
}

export interface ResolvedStreams {
  streams: StreamObject[];
  subtitles: SubtitleObject[];
  trailerStreams: Array<{ ytId?: string; url?: string; title?: string }>;
}

// ---- Seasonal filtering: cross-season "retellings" / recap compilations ----
/** Normalize a season value. Cinemeta-style specials use season 0; some addons use ''/null. */
export function normSeason(v?: VideoMeta | null): number | null {
  if (!v) return null;
  const s = v.season ?? v.number;
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** True if a video looks like a recap/retelling compilation, not a real episode. */
function looksLikeRetelling(v: VideoMeta): boolean {
  const t = `${v.title || ''} ${v.overview || ''}`.toLowerCase();
  return /recap|retelling|compilation|movie version|recap movie|digest|special edition|the movie$/.test(t);
}

/**
 * Keep only real episodes of `season`:
 * - same season number (Season 0/specials handled separately by callers)
 * - fills/padding whose absolute episode number exceeds the season's real max
 *   (i.e. the E1..E10 "retelling" packed after the specials) are dropped by
 *   capping the accepted episode numbers to a contiguous 1..N block when the
 *   gap analysis shows a hard break.
 */
export function realEpisodesOfSeason(videos: VideoMeta[] | undefined, season: number): VideoMeta[] {
  const inSeason = (videos ?? []).filter((v) => (v.season ?? 1) === season);
  const sorted = [...inSeason].sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
  const reals = sorted.filter((v) => !looksLikeRetelling(v));
  const nums = reals.map((v) => v.episode ?? v.number ?? 0).filter((n) => n >= 1).sort((a, b) => a - b);
  if (nums.length === 0) return reals;
  // Find the first hard break (gap >= 3) — anything from that point on is filler.
  let cutoff = nums[nums.length - 1];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] >= 3) { cutoff = nums[i - 1]; break; }
  }
  return reals.filter((v) => (v.episode ?? v.number ?? 0) <= cutoff);
}

/** Sorted list of real seasons (>= 1) present in a video list. */
export function realSeasonsOf(videos: VideoMeta[] | undefined): number[] {
  const set = new Set<number>();
  for (const v of videos ?? []) {
    const s = v.season ?? 1;
    if (s >= 1) set.add(s);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Next real episode after `current` — same season first, then the first episode
 * of the next real season (skips retelling tails via realEpisodesOfSeason).
 */
export function nextRealEpisode(videos: VideoMeta[] | undefined, current?: VideoMeta | null): VideoMeta | null {
  if (!current) return null;
  const season = current.season ?? 1;
  const eps = realEpisodesOfSeason(videos, season);
  const idx = eps.findIndex((v) => v.id === current.id);
  if (idx >= 0 && idx + 1 < eps.length) return eps[idx + 1];
  for (const s of realSeasonsOf(videos)) {
    if (s <= season) continue;
    const first = realEpisodesOfSeason(videos, s)[0];
    if (first) return first;
  }
  return null;
}

export interface CustomCatalogEntry {
  addonUrl: string;
  addonName: string;
  type: string;
  catalogId: string;
  label: string;
}

const CUSTOM_CATALOG_LIST_KEY = 'stremioflix.customCatalogs';

/** User-pinned addon catalogs (shown as home rows). */
export function loadCustomCatalogs(): CustomCatalogEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATALOG_LIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e) =>
        e && typeof e.addonUrl === 'string' && typeof e.type === 'string' &&
        typeof e.catalogId === 'string' && typeof e.label === 'string',
    ) as CustomCatalogEntry[];
  } catch {
    return [];
  }
}

function saveCustomCatalogs(list: CustomCatalogEntry[]): void {
  try { localStorage.setItem(CUSTOM_CATALOG_LIST_KEY, JSON.stringify(list)); } catch { }
}

export function customCatalogKey(addonUrl: string, type: string, catalogId: string): string {
  return `custom|${addonUrl}|${type}|${catalogId}`;
}

export function addCustomCatalog(entry: CustomCatalogEntry): CustomCatalogEntry[] {
  const list = loadCustomCatalogs();
  const k = customCatalogKey(entry.addonUrl, entry.type, entry.catalogId);
  if (list.some((e) => customCatalogKey(e.addonUrl, e.type, e.catalogId) === k)) return list;
  const next = [...list, entry];
  saveCustomCatalogs(next);
  return next;
}

export function removeCustomCatalog(addonUrl: string, type: string, catalogId: string): CustomCatalogEntry[] {
  const k2 = customCatalogKey(addonUrl, type, catalogId);
  const next = loadCustomCatalogs().filter(
    (e) => customCatalogKey(e.addonUrl, e.type, e.catalogId) !== k2,
  );
  saveCustomCatalogs(next);
  return next;
}

const CUSTOM_CATALOG_DISABLED_KEY = 'stremioflix.customCatalogs.disabled';

export function loadCustomCatalogDisabled(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATALOG_DISABLED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function loadCustomCatalogDisabledKeys(): string[] {
  return loadCustomCatalogDisabled();
}

export function setCustomCatalogEnabled(key: string, enabled: boolean): void {
  const cur = new Set(loadCustomCatalogDisabled());
  if (enabled) cur.delete(key);
  else cur.add(key);
  try { localStorage.setItem(CUSTOM_CATALOG_DISABLED_KEY, JSON.stringify([...cur])); } catch { /* noop */ }
}

/** Catalog definition discovered from an addon manifest. */
export interface CustomCatalogDef extends CatalogRowDef {
  addonName: string;
}

/** Discover plain-display catalogs (no required extras) from user addons. */
export async function discoverCustomCatalogs(): Promise<CustomCatalogDef[]> {
  const addons = loadStreamAddonUrls();
  const settled = await Promise.allSettled(addons.map(async (addonUrl) => {
    try {
      const manifest = await fetchManifest(addonUrl);
      const addonName = manifest.name || addonUrl;
      const out: CustomCatalogDef[] = [];
      for (const c of manifest.catalogs ?? []) {
        const required = (c.extra ?? []).filter((e) => e.isRequired && e.name !== 'search' && e.name !== 'skip');
        if (required.length > 0) continue;
        out.push({
          key: 'custom:' + customCatalogKey(addonUrl, c.type, c.id),
          title: `${addonName} — ${c.name || c.id}`,
          addonUrl,
          type: c.type,
          catalogId: c.id,
          addonName,
        });
      }
      return out;
    } catch {
      return [] as CustomCatalogDef[];
    }
  }));
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}

/** Load home-page rows from enabled custom addon catalogs. */
export async function loadCustomCatalogRows(): Promise<CatalogRow[]> {
  const disabled = new Set(loadCustomCatalogDisabledKeys());
  const defs = (await discoverCustomCatalogs()).filter(
    (d) => !disabled.has(customCatalogKey(d.addonUrl, d.type, d.catalogId)),
  );
  return loadCatalogRows(defs);
}

function loadAddonUrls(): string[] {
  try {
    const raw = localStorage.getItem('stremioflix.addons');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((u) => typeof u === 'string' && !u.includes('cinemeta') && !u.includes('opensubtitles'));
  } catch {
    return [];
  }
}

/** Back-compat alias: every custom addon URL (stream or catalog). */
function loadStreamAddonUrls(): string[] {
  return loadAddonUrls();
}

export async function resolveStreamsForVideo(
  type: string,
  metaId: string,
  videoId: string,
): Promise<ResolvedStreams> {
  const streamId = videoId && videoId !== metaId ? videoId : metaId;
  // Real watchable streams come from user-installed stream addons (e.g. Torrentio).
  // Cinemeta itself only carries YouTube trailers — surfaced as fallback entries.
  const addons = [...loadStreamAddonUrls()];
  const streamLists = await Promise.allSettled(
    addons.map((a) => fetchStreams(a, type, streamId)),
  );
  const seen = new Set<string>();
  const streams: StreamObject[] = [];
  for (const s of streamLists) {
    if (s.status !== 'fulfilled') continue;
    for (const st of s.value.streams) {
      const k = (st.url || '') + '|' + (st.ytId || '') + '|' + (st.infoHash || '') + '|' + (st.fileIdx ?? '');
      if (seen.has(k)) continue;
      seen.add(k);
      streams.push({
        ...st,
        addonUrl: s.value.addonUrl || '',
        addonName: s.value.addonName || 'Unknown addon',
      });
    }
  }
  sortStreams(streams);
  let trailerStreams: ResolvedStreams['trailerStreams'] = [];
  try {
    const full = await fetchMeta('https://v3-cinemeta.strem.io', type, metaId);
    trailerStreams = (full?.meta?.trailers ?? [])
      .map((t) => ({ ytId: (t as { source?: string }).source, title: (t as { title?: string }).title }))
      .filter((t) => t.ytId) as ResolvedStreams['trailerStreams'];
    for (const t of trailerStreams) {
      if (t.ytId && !streams.some((s) => s.ytId === t.ytId)) {
        streams.push({ ytId: t.ytId, name: 'Trailer', title: t.title || 'Trailer', behaviorHints: {} });
      }
    }
  } catch {
    /* trailers optional */
  }
  const subs = await fetchSubtitles('https://opensubtitles.strem.io', type, streamId).catch(() => ({
    subtitles: [],
  }));
  return { streams, subtitles: subs.subtitles, trailerStreams };
}

function qualityRank(s: StreamObject): number {
  const t = ((s.name || '') + ' ' + (s.title || '') + ' ' + (s.description || '')).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(t)) return 0;
  if (/\b1080p\b/.test(t)) return 1;
  if (/\b720p\b/.test(t)) return 2;
  if (/\b480p\b/.test(t)) return 3;
  if (/\bcam\b|\bhdcam\b|\bts\b/.test(t)) return 5;
  return 4;
}

function sortStreams(streams: StreamObject[]): void {
  streams.sort((a, b) => {
    const aTrailer = a.ytId ? 1 : 0;
    const bTrailer = b.ytId ? 1 : 0;
    if (aTrailer !== bTrailer) return aTrailer - bTrailer; // real streams first, trailers last
    return qualityRank(a) - qualityRank(b);
  });
}

/** Human label for a stream source row. */
export function streamLabel(s: StreamObject): { name: string; detail: string } {
  if (s.ytId) return { name: 'Trailer', detail: s.title || 'YouTube trailer' };
  if (s.infoHash) {
    const tag = s.name || 'Torrent';
    const file = s.behaviorHints?.filename || s.title || '';
    return { name: '⚡ ' + tag, detail: file + (s.fileIdx != null ? ' · file ' + (s.fileIdx + 1) : '') };
  }
  if (s.url) {
    const lower = s.url.toLowerCase();
    const kind = lower.includes('.m3u8') ? 'HLS' : lower.includes('.mkv') ? 'MKV' : lower.includes('.mp4') ? 'MP4' : 'HTTP';
    return { name: (s.name || 'Direct') + ' · ' + kind, detail: s.title || s.url.split('?')[0].slice(0, 80) };
  }
  return { name: s.name || s.title || 'Source', detail: s.description || '' };
}

/** Build a local streaming-server URL shortcut when the server is reachable. */
export function toLocalServerUrl(stream: StreamObject): string | null {
  if (stream.infoHash) {
    const fileIdx = typeof stream.fileIdx === 'number' ? `/${stream.fileIdx}` : '';
    return `${LOCAL_STREAMING_SERVER}/${encodeURIComponent(stream.infoHash)}${fileIdx}`;
  }
  return null;
}

/** All catalogs an addon advertises in its manifest (for the settings picker). */
export async function listAddonCatalogs(addonUrl: string): Promise<ManifestCatalog[]> {
  try {
    const m = await fetchManifest(addonUrl);
    return Array.isArray(m.catalogs) ? m.catalogs : [];
  } catch {
    return [];
  }
}

/** Home rows: built-ins first, then user-enabled custom addon catalogs. */
export async function loadAllCatalogRows(base: CatalogRowDef[] = DEFAULT_ROWS): Promise<CatalogRow[]> {
  const rows: CatalogRowDef[] = [...base];
  for (const c of loadCustomCatalogs()) {
    rows.push({
      key: 'custom:' + customCatalogKey(c.addonUrl, c.type, c.catalogId),
      title: c.label,
      addonUrl: c.addonUrl,
      type: c.type,
      catalogId: c.catalogId,
    });
  }
  return loadCatalogRows(rows);
}

export function playableUrl(stream: StreamObject): string | null {
  if (stream.url) return stream.url;
  if (stream.ytId) return `https://www.youtube.com/watch?v=${stream.ytId}`;
  return toLocalServerUrl(stream);
}

/** Group streams by their source addon for the multi-addon source selector. */
export function groupStreamsByAddon(streams: StreamObject[]): AddonStreamGroup[] {
  const byAddon = new Map<string, AddonStreamGroup>();
  const icons: Record<string, string> = {
    'torrentio': '🧲',
    'eztv': '📺',
    'yts': '🎬',
    'rarbg': '💾',
    '1337x': '🔍',
    'youtube': '▶️',
  };
  for (const s of streams) {
    const key = s.addonUrl || 'unknown';
    if (!byAddon.has(key)) {
      const host = (() => {
        try { return new URL(s.addonUrl || 'https://unknown').host; } catch { return 'unknown'; }
      })();
      const name = s.addonName || host || 'Unknown addon';
      const icon = Object.entries(icons).find(([k]) => host.toLowerCase().includes(k))?.[1] || '🔗';
      byAddon.set(key, { addonUrl: s.addonUrl || 'unknown', addonName: name, icon, streams: [] });
    }
    byAddon.get(key)!.streams.push(s);
  }
  // Sort: real (non-trailer) streams first, then by group name
  return Array.from(byAddon.values()).sort((a, b) => a.addonName.localeCompare(b.addonName));
}

/** Get unique addon names for filter chips. */
export function getAddonFilterOptions(streams: StreamObject[]): { addonUrl: string; addonName: string }[] {
  const seen = new Set<string>();
  const out: { addonUrl: string; addonName: string }[] = [];
  for (const s of streams) {
    const key = s.addonUrl || 'unknown';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ addonUrl: key, addonName: s.addonName || 'Unknown addon' });
  }
  return out.sort((a, b) => a.addonName.localeCompare(b.addonName));
}

/** Filter streams by addon URL. 'all' means no filtering. */
export function filterStreamsByAddon(streams: StreamObject[], addonUrl: string | null): StreamObject[] {
  if (!addonUrl || addonUrl === 'all') return streams;
  return streams.filter((s) => (s.addonUrl || 'unknown') === addonUrl);
}

/** Enhanced search across Stremio catalogs with optional addon/catalog filter. */
export interface SearchResult {
  meta: PosterMeta;
  sourceAddon: string;
  sourceCatalog: string;
}

export async function searchCatalogsWithAddons(
  query: string,
  addonFilter?: string | null,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const targets = [
    { addonUrl: 'https://v3-cinemeta.strem.io', type: 'movie', id: 'top', extra: { search: q } },
    { addonUrl: 'https://v3-cinemeta.strem.io', type: 'series', id: 'top', extra: { search: q } },
    { addonUrl: 'https://v3-cinemeta.strem.io', type: 'channel', id: 'top', extra: { search: q } },
  ];
  const settled = await Promise.allSettled(targets.map((t) => fetchCatalog(t)));
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const m of s.value.metas) {
      const k = `${m.type}:${m.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ meta: m, sourceAddon: 'https://v3-cinemeta.strem.io', sourceCatalog: 'cinemeta' });
    }
  }
  return out.slice(0, 60);
}
