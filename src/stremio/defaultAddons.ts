import type { AddonKind } from './types';

export interface AddonEntry {
  url: string;
  kind: AddonKind;
  label: string;
}

export const DEFAULT_ADDONS: AddonEntry[] = [
  { url: 'https://v3-cinemeta.strem.io', kind: 'cinemeta', label: 'Cinemeta' },
  { url: 'https://opensubtitles.strem.io', kind: 'opensubtitles', label: 'OpenSubtitles' },
];

export const LOCAL_STREAMING_SERVER = 'http://127.0.0.1:11470';

export interface CatalogRowDef {
  key: string;
  title: string;
  addonUrl: string;
  type: string;
  catalogId: string;
  extra?: Record<string, string>;
}

export const DEFAULT_ROWS: CatalogRowDef[] = [
  { key: 'movie-top', title: 'Top Movies', addonUrl: 'https://v3-cinemeta.strem.io', type: 'movie', catalogId: 'top' },
  { key: 'movie-imdb', title: 'IMDb Top Movies', addonUrl: 'https://v3-cinemeta.strem.io', type: 'movie', catalogId: 'imdb_top' },
  { key: 'series-top', title: 'Top Series', addonUrl: 'https://v3-cinemeta.strem.io', type: 'series', catalogId: 'top' },
  { key: 'series-imdb', title: 'IMDb Top Series', addonUrl: 'https://v3-cinemeta.strem.io', type: 'series', catalogId: 'imdb_top' },
  { key: 'anime-top', title: 'Top Anime', addonUrl: 'https://v3-cinemeta.strem.io', type: 'series', catalogId: 'top', extra: { genre: 'Animation' } },
];
