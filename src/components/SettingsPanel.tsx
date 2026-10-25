import { useEffect, useState } from 'react';
import { X, Plus, Trash2, CheckCircle2, XCircle, Loader2, Puzzle, Play, Clock, RefreshCw, List, Menu } from 'lucide-react';
import { DEFAULT_ADDONS } from '../stremio/defaultAddons';
import { fetchManifest, normalizeAddonUrl, describeFetchError } from '../stremio/AddonClient';
import {
  loadCustomCatalogs, addCustomCatalog, removeCustomCatalog, customCatalogKey,
  discoverCustomCatalogs, loadCustomCatalogDisabledKeys, setCustomCatalogEnabled,
} from '../services/catalogService';
import {
  getAutoPlayPref, setAutoPlayPref, clearAutoPlayPref,
  getResume, clearResume, resumeKey,
} from '../services/playbackStore';
import type { AutoPlayPref } from '../services/playbackStore';

interface Props {
  onClose: () => void;
}

interface AddonStatus {
  url: string;
  ok: boolean | null;
  name?: string;
  error?: string;
}

const STORE_KEY = 'stremioflix.addons';
const RESOLUTION_CHOICES = ['auto', '2160p', '1080p', '720p', '480p'] as const;

export function loadCustomAddons(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

export default function SettingsPanel({ onClose }: Props) {
  const [custom, setCustom] = useState<string[]>(() => loadCustomAddons());
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<AddonStatus[]>([]);

  // --- Playback prefs ---
  const [autoPlayRes, setAutoPlayRes] = useState<'auto' | '2160p' | '1080p' | '720p' | '480p'>('auto');
  const [resumeEnabled, setResumeEnabled] = useState(true);
  const [savedPrefs, setSavedPrefs] = useState<{ metaId: string; pref: AutoPlayPref }[]>([]);
  const [savedResumes, setSavedResumes] = useState<{ key: string; entry: { pos: number; dur: number; at: number } }[]>([]);
  const [loadingPrefs, setLoadingPrefs] = useState(false);

  // --- Custom catalogs ---
  const [pinnedCatalogs, setPinnedCatalogs] = useState<{ addonUrl: string; addonName: string; type: string; catalogId: string; label: string }[]>([]);
  const [availableCatalogs, setAvailableCatalogs] = useState<{ key: string; title: string; addonUrl: string; type: string; catalogId: string; addonName: string }[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  const all = [...DEFAULT_ADDONS.map((a) => a.url), ...custom];
  const unique = Array.from(new Set(all));

  useEffect(() => {
    let live = true;
    setStatus(unique.map((u) => ({ url: u, ok: null })));
    unique.forEach((u) => {
      fetchManifest(u).then(
        (m) => { if (live) setStatus((s) => s.map((x) => (x.url === u ? { url: u, ok: true, name: m.name } : x))); },
        (e) => { if (live) setStatus((s) => s.map((x) => ({ ...x, url: x.url, ok: x.url === u ? false : x.ok, ...(x.url === u ? { error: describeFetchError(e, u) } : {}) }))); },
      );
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom.join('|')]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoadingPrefs(true);
      try {
        const defs = await discoverCustomCatalogs();
        const prefs: { metaId: string; pref: AutoPlayPref }[] = [];
        const resumes: { key: string; entry: { pos: number; dur: number; at: number } }[] = [];
        for (const d of defs) {
          const k = customCatalogKey(d.addonUrl, d.type, d.catalogId);
          const p = getAutoPlayPref(k);
          if (p) prefs.push({ metaId: k, pref: p });
          const r = getResume(k);
          if (r) resumes.push({ key: k, entry: r });
        }
        if (live) { setSavedPrefs(prefs); setSavedResumes(resumes); }
      } catch { /* noop */ }
      if (live) setLoadingPrefs(false);
    };
    load();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoadingCatalogs(true);
      try {
        const list = loadCustomCatalogs();
        setPinnedCatalogs(list);
        const disabled = new Set(loadCustomCatalogDisabledKeys());
        const defs = await discoverCustomCatalogs();
        setAvailableCatalogs(defs.filter((d) => !disabled.has(customCatalogKey(d.addonUrl, d.type, d.catalogId))));
      } catch { /* noop */ }
      if (live) setLoadingCatalogs(false);
    };
    load();
    return () => { live = false; };
  }, []);

  const add = () => {
    let u = draft.trim();
    if (!u) return;
    u = normalizeAddonUrl(u);
    if (custom.includes(u)) { setDraft(''); return; }
    const next = [...custom, u];
    setCustom(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* noop */ }
    setDraft('');
  };

  const remove = (u: string) => {
    const next = custom.filter((x) => x !== u);
    setCustom(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  const pinCatalog = async (entry: { addonUrl: string; addonName: string; type: string; catalogId: string; label: string }) => {
    setPinnedCatalogs(addCustomCatalog(entry));
    const disabled = new Set(loadCustomCatalogDisabledKeys());
    const defs = await discoverCustomCatalogs();
    setAvailableCatalogs(defs.filter((d) => !disabled.has(customCatalogKey(d.addonUrl, d.type, d.catalogId))));
  };

  const unpinCatalog = (addonUrl: string, type: string, catalogId: string) => {
    setPinnedCatalogs(removeCustomCatalog(addonUrl, type, catalogId));
    const disabled = new Set(loadCustomCatalogDisabledKeys());
    setAvailableCatalogs((prev) => prev.filter((d) => !(d.addonUrl === addonUrl && d.type === type && d.catalogId === catalogId)));
  };

  const toggleCatalogEnabled = (key: string, enabled: boolean) => {
    setCustomCatalogEnabled(key, enabled);
    const disabled = new Set(loadCustomCatalogDisabledKeys());
    setAvailableCatalogs((prev) => prev.filter((d) => !disabled.has(customCatalogKey(d.addonUrl, d.type, d.catalogId))));
  };

  const clearAllPrefs = () => {
    savedPrefs.forEach(({ metaId }) => clearAutoPlayPref(metaId));
    setSavedPrefs([]);
  };

  const clearAllResumes = () => {
    savedResumes.forEach(({ key }) => clearResume(key));
    setSavedResumes([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#181818] rounded-lg shadow-modal p-6 my-10 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold flex items-center gap-2"><Puzzle size={20} className="text-[#E50914]" /> Addons & Settings</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-white/60 mb-6">Catalogs, streams, playback preferences, and resume positions.</p>

        {/* ---- Playback preferences ---- */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Play size={16} className="text-[#E50914]" /> Playback</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-[#222] rounded p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center"><Clock size={18} /></div>
                <div>
                  <div className="text-sm font-medium text-white">Resume saved positions</div>
                  <div className="text-[11px] text-white/50">Auto-save watch position and resume where you left off.</div>
                </div>
              </div>
              <button
                onClick={() => setResumeEnabled(!resumeEnabled)}
                className="relative w-14 h-7 rounded-full bg-[#222] transition-colors p-1"
              >
                <div className={`w-5 h-5 rounded-full bg-white transition-transform ${resumeEnabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>
            <div className="flex items-center justify-between bg-[#222] rounded p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center"><Menu size={18} /></div>
                <div>
                  <div className="text-sm font-medium text-white">Default resolution</div>
                  <div className="text-[11px] text-white/50">Preferred stream quality for auto-play.</div>
                </div>
              </div>
              <select
                value={autoPlayRes}
                onChange={(e) => setAutoPlayRes(e.target.value as any)}
                className="bg-[#222] border border-white/15 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/40"
              >
                {RESOLUTION_CHOICES.map((r) => (
                  <option key={r} value={r}>{r === 'auto' ? 'Auto (best)' : r}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={clearAllResumes} disabled={savedResumes.length === 0} className="text-xs text-red-400 hover:text-red-300 underline">
                Clear all resume positions ({savedResumes.length})
              </button>
              <button onClick={clearAllPrefs} disabled={savedPrefs.length === 0} className="text-xs text-red-400 hover:text-red-300 underline">
                Clear auto-play prefs ({savedPrefs.length})
              </button>
            </div>
          </div>
        </div>

        {/* ---- Custom catalogs ---- */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><List size={16} className="text-[#E50914]" /> Custom Catalogs</h3>
          <p className="text-xs text-white/50 mb-3">Pinned addon catalogs appear as home rows. Discover catalogs from your installed addons below.</p>

          <div className="mb-4">
            <h4 className="text-xs font-semibold text-white/60 mb-2">Available catalogs</h4>
            {loadingCatalogs ? (
              <div className="flex items-center justify-center py-4 text-white/50"><Loader2 size={18} className="animate-spin mr-2" /> Loading…</div>
            ) : availableCatalogs.length === 0 ? (
              <p className="text-xs text-white/40">No discoverable catalogs from installed addons.</p>
            ) : (
              <div className="space-y-1">
                {availableCatalogs.map((d) => (
                  <div key={d.key} className="flex items-center justify-between bg-[#222] rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-white/70">{d.addonName}</span>
                      <span className="text-[10px] text-white/40">· {d.type} · {d.catalogId}</span>
                    </div>
                    <button
                      onClick={() => pinCatalog({ addonUrl: d.addonUrl, addonName: d.addonName, type: d.type, catalogId: d.catalogId, label: d.title })}
                      className="text-xs text-[#E50914] hover:text-red-400 underline font-medium"
                    >
                      Pin
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-4">
            <h4 className="text-xs font-semibold text-white/60 mb-2">Pinned catalogs (home rows)</h4>
            {pinnedCatalogs.length === 0 ? (
              <p className="text-xs text-white/40">No pinned custom catalogs.</p>
            ) : (
              <div className="space-y-1">
                {pinnedCatalogs.map((c) => (
                  <div key={customCatalogKey(c.addonUrl, c.type, c.catalogId)} className="flex items-center justify-between bg-[#222] rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{c.label}</span>
                      <span className="text-[10px] text-white/40">· {c.type} · {c.catalogId}</span>
                    </div>
                    <button
                      onClick={() => unpinCatalog(c.addonUrl, c.type, c.catalogId)}
                      className="text-xs text-[#E50914] hover:text-red-400 underline font-medium"
                    >
                      Unpin
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- Addons ---- */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Puzzle size={16} className="text-[#E50914]" /> Addon Catalogs</h3>
          <p className="text-xs text-white/50 mb-3">Catalogs, streams, and subtitles are powered by Stremio addons. Paste any manifest URL to add more.</p>

          <div className="flex gap-2 mb-5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="https://your-addon.strem.io/manifest.json"
              className="flex-1 bg-[#222] border border-white/15 rounded px-3 py-2 text-sm outline-none focus:border-white/40"
            />
            <button onClick={add} className="bg-[#E50914] hover:bg-[#F6121D] font-semibold text-sm px-4 rounded flex items-center gap-1">
              <Plus size={16} /> Add
            </button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {status.map((s) => {
              const isCustom = custom.includes(s.url);
              return (
                <div key={s.url} className="flex items-center gap-3 bg-[#222] rounded p-3">
                  {s.ok === null ? (
                    <Loader2 size={18} className="animate-spin text-white/50 shrink-0" />
                  ) : s.ok ? (
                    <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                  ) : (
                    <XCircle size={18} className="text-red-500 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{s.name ?? s.url}</div>
                    <div className="text-[11px] text-white/50 truncate">{s.url}</div>
                    {s.error && <div className="text-[11px] text-red-400 truncate">{s.error}</div>}
                  </div>
                  {isCustom && (
                    <button onClick={() => remove(s.url)} aria-label="Remove" className="p-1.5 text-white/50 hover:text-red-400">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 text-xs text-white/40">
          Local streaming server: <span className="text-white/70 font-mono">http://127.0.0.1:11470</span> — MKV/Debrid links resolve automatically when reachable.
        </div>
      </div>
    </div>
  );
}
