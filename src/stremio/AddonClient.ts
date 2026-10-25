import type {
  AddonManifest,
  CatalogRequest,
  CatalogResponse,
  MetaResponse,
  StreamsResponse,
  SubtitlesResponse,
} from './types';

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 5 * 60 * 1000;

function key(parts: string[]): string {
  return parts.join('|');
}

async function fetchJson<T>(url: string, useCache = true): Promise<T> {
  const k = key([url]);
  if (useCache) {
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL) return hit.data as T;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Addon request failed (${res.status}): ${url}`);
  const data = (await res.json()) as T;
  cache.set(k, { at: Date.now(), data });
  return data;
}

function base(addonUrl: string): string {
  return addonUrl.replace(/\/+$/, '');
}

/** Accept a bare host or a full /manifest.json URL; always return the addon root. */
export function normalizeAddonUrl(input: string): string {
  let u = input.trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/manifest\.json\/?$/i, '').replace(/\/+$/, '');
  return u;
}

/** Map HTTP failures to short human-readable errors for the UI. */
export function describeFetchError(e: unknown, url: string): string {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (e instanceof TypeError) return `Cannot reach ${host} (network/CORS blocked)`;
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\((\d{3})\)/);
  if (m) {
    const code = m[1];
    if (code === '404') return `${host}: manifest not found (404) — addon may be offline or moved`;
    if (code === '500') return `${host}: server error (500) — addon is temporarily down`;
    return `${host}: request failed (${code})`;
  }
  return `${host}: ${msg}`;
}

export async function fetchManifest(addonUrl: string): Promise<AddonManifest> {
  const normalized = normalizeAddonUrl(addonUrl);
  return fetchJson<AddonManifest>(`${base(normalized)}/manifest.json`);
}

function extraPath(extra?: Record<string, string>): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  return (
    '/' +
    Object.entries(extra)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
  );
}

export async function fetchCatalog(req: CatalogRequest): Promise<CatalogResponse> {
  const url = `${base(req.addonUrl)}/catalog/${encodeURIComponent(req.type)}/${encodeURIComponent(
    req.id,
  )}${extraPath(req.extra)}.json`;
  try {
    const data = await fetchJson<CatalogResponse>(url);
    return { metas: Array.isArray(data.metas) ? data.metas : [] };
  } catch {
    return { metas: [] };
  }
}

export async function fetchMeta(
  addonUrl: string,
  type: string,
  id: string,
): Promise<MetaResponse | null> {
  const url = `${base(addonUrl)}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  try {
    const data = await fetchJson<MetaResponse>(url);
    if (!data || !data.meta) return null;
    return data;
  } catch {
    return null;
  }
}

const addonNameCache = new Map<string, string>();

/** Human-readable addon name from its manifest.json (session-cached).
 *  Stream responses don't carry the addon name, and the URL's last path
 *  segment is usually config junk (e.g. "providers=yts|sort=qualitysize"),
 *  so the manifest is the only reliable source. Falls back to the host. */
export async function addonDisplayName(addonUrl: string): Promise<string> {
  const root = base(normalizeAddonUrl(addonUrl));
  const hit = addonNameCache.get(root);
  if (hit) return hit;
  let name = '';
  try {
    const m = await fetchManifest(root);
    name = (m && typeof m.name === 'string' && m.name.trim()) || '';
  } catch { /* manifest unreachable — fall back to host */ }
  if (!name) {
    try { name = new URL(root).host; } catch { /* invalid url */ }
  }
  if (!name) name = 'Unknown addon';
  addonNameCache.set(root, name);
  return name;
}

export async function fetchStreams(
  addonUrl: string,
  type: string,
  id: string,
): Promise<StreamsResponse> {
  const url = `${base(addonUrl)}/stream/${encodeURIComponent(type)}/${encodeURIComponent(
    id,
  )}.json`;
  // Kick off the manifest name lookup concurrently with the stream request so
  // the extra round-trip doesn't add latency to the first result.
  const namePromise = addonDisplayName(addonUrl);
  try {
    const data = await fetchJson<StreamsResponse>(url, false);
    return {
      streams: Array.isArray(data.streams) ? data.streams : [],
      addonUrl,
      addonName: await namePromise,
    };
  } catch {
    return { streams: [], addonUrl, addonName: await namePromise.catch(() => 'Unknown addon') };
  }
}

export async function fetchSubtitles(
  addonUrl: string,
  type: string,
  id: string,
): Promise<SubtitlesResponse> {
  const url = `${base(addonUrl)}/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(
    id,
  )}.json`;
  try {
    const data = await fetchJson<SubtitlesResponse>(url, false);
    return { subtitles: Array.isArray(data.subtitles) ? data.subtitles : [] };
  } catch {
    return { subtitles: [] };
  }
}

export function clearAddonCache(): void {
  cache.clear();
}
