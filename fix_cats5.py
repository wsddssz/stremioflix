import io
p = 'src/services/catalogService.ts'
t = io.open(p, encoding='utf-8').read()

old_block = """export interface CustomCatalogRow {
  /** Stable key: addonUrl + type + catalogId. */
  key: string;
  addonUrl: string;
  addonName: string;
  type: string;
  catalogId: string;
  title: string;
}

const CUSTOM_CATALOGS_KEY = 'stremioflix.customCatalogs';

/** User-enabled custom catalog rows (persisted). */
export function loadCustomCatalogs(): CustomCatalogRow[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATALOGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((r) => r && r.key && r.addonUrl && r.catalogId) : [];
  } catch {
    return [];
  }
}

export function saveCustomCatalogs(rows: CustomCatalogRow[]): void {
  try { localStorage.setItem(CUSTOM_CATALOGS_KEY, JSON.stringify(rows)); } catch { /* noop */ }
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

export function customCatalogKey(addonUrl: string, type: string, catalogId: string): string {
  return `custom|${addonUrl}|${type}|${catalogId}`;
}

/** Home rows: built-ins first, then user-enabled custom addon catalogs. */
export async function loadAllCatalogRows(base: CatalogRowDef[] = DEFAULT_ROWS): Promise<CatalogRow[]> {
  const rows: CatalogRowDef[] = [...base];
  for (const c of loadCustomCatalogs()) {
    rows.push({
      key: c.key,
      title: c.title,
      addonUrl: c.addonUrl,
      type: c.type,
      catalogId: c.catalogId,
    });
  }
  return loadCatalogRows(rows);
}"""

new_block = """/** All catalogs an addon advertises in its manifest (for the settings picker). */
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
}"""

assert old_block in t, 'legacy block not found'
t = t.replace(old_block, new_block)

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('edit 6-7 done: legacy block replaced')
