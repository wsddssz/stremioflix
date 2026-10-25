import io
p = 'src/services/catalogService.ts'
t = io.open(p, encoding='utf-8').read()

# 3. Fix loadCustomCatalogDisabledKeys - implement loadCustomCatalogDisabled directly
old_disabled = """export function loadCustomCatalogDisabledKeys(): string[] {
  return loadCustomCatalogDisabled();
}

export function setCustomCatalogEnabled(key: string, enabled: boolean): void {
  const cur = new Set(loadCustomCatalogDisabled());
  if (enabled) cur.delete(key);
  else cur.add(key);
  try { localStorage.setItem(CUSTOM_CATALOGS_KEY, JSON.stringify([...cur])); } catch { /* noop */ }
}"""

new_disabled = """const CUSTOM_CATALOG_DISABLED_KEY = 'stremioflix.customCatalogs.disabled';

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
}"""

assert old_disabled in t, 'disabled block not found'
t = t.replace(old_disabled, new_disabled)

# 4. Add CustomCatalogDef interface before discoverCustomCatalogs
old_disc = """/** Discover plain-display catalogs (no required extras) from user addons. */
export async function discoverCustomCatalogs(): Promise<CustomCatalogDef[]> {"""

new_disc = """/** Catalog definition discovered from an addon manifest. */
export interface CustomCatalogDef extends CatalogRowDef {
  addonName: string;
}

/** Discover plain-display catalogs (no required extras) from user addons. */
export async function discoverCustomCatalogs(): Promise<CustomCatalogDef[]> {"""

assert old_disc in t, 'discover block not found'
t = t.replace(old_disc, new_disc)

# 5. Fix loadCustomCatalogRows to use loadCustomCatalogDisabledKeys
old_rows = """  const disabled = new Set(loadCustomCatalogDisabled());"""
new_rows = """  const disabled = new Set(loadCustomCatalogDisabledKeys());"""
assert old_rows in t, 'loadCustomCatalogRows disabled line not found'
t = t.replace(old_rows, new_rows)

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('edits 3-5 done')
