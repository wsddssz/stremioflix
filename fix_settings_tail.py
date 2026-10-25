import io
p = 'src/components/SettingsPanel.tsx'
lines = io.open(p, encoding='utf-8').readlines()
# Keep lines 1-273 (0-indexed: 0-272), which ends with Custom Catalogs section close
tail = """        {/* ---- Addons ---- */}
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
          Local streaming server: <span className="text-white/70 font-mono">http://127.0.0.1:11470</span> — MKV/Debrid links resolve automatically when reachable.</span>
        </div>
      </div>
    </div>
  );
}
"""
new_content = ''.join(lines[:273]) + tail
io.open(p, 'w', encoding='utf-8', newline='').write(new_content)
print('Rewrote tail from line 273')
