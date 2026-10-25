// Core Stremio protocol types (manifest / catalog / meta / streams / subtitles)

export interface ManifestCatalog {
  type: string;
  id: string;
  name?: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
}

export interface AddonManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  types: string[];
  resources: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>;
  catalogs: ManifestCatalog[];
  idPrefixes?: string[];
}

export interface PosterMeta {
  id: string;
  type: string; // 'movie' | 'series' | 'channel' | 'tv'
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
  genres?: string[];
  imdbRating?: string | number;
  directors?: string[];
  cast?: string[];
  trailers?: Array<{ source: string; type: string }>;
  videos?: VideoMeta[];
  behaviorHints?: Record<string, unknown>;
}

export interface VideoMeta {
  id: string;
  title?: string;
  overview?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  streams?: unknown;
  trailerStreams?: Array<{ ytId?: string; url?: string }>;
}

export interface CatalogResponse {
  metas: PosterMeta[];
}

export interface MetaResponse {
  meta: PosterMeta;
}

export interface StreamObject {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  title?: string;
  name?: string;
  description?: string;
  subtitles?: SubtitleObject[];
  addonUrl?: string;      // source addon manifest URL (for filtering by addon)
  addonName?: string;     // human-readable addon name (for filter chips)
  behaviorHints?: {
    bingeGroup?: string;
    countryWhitelist?: string[];
    notWebReady?: boolean;
    proxyHeaders?: Record<string, string>;
    filename?: string;
  };
}

/** Player UI mode: 'mobile' (touch-friendly) or 'tv' (D-pad/leanback). */
export type PlayerUIMode = 'mobile' | 'tv';

/** A stream source grouped by its addon for the multi-addon selector. */
export interface AddonStreamGroup {
  addonUrl: string;
  addonName: string;
  icon: string;
  streams: StreamObject[];
}

export interface StreamsResponse {
  streams: StreamObject[];
  addonUrl?: string;
  addonName?: string;
}

export interface SubtitleObject {
  id: string;
  url: string;
  lang: string;
}

export interface SubtitlesResponse {
  subtitles: SubtitleObject[];
}

export interface CatalogRequest {
  addonUrl: string;
  type: string;
  id: string;
  extra?: Record<string, string>;
}

export type AddonKind = 'cinemeta' | 'catalogs' | 'opensubtitles' | 'youtube' | 'anime' | 'custom';
