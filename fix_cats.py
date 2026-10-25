import io
p = 'src/services/catalogService.ts'
t = io.open(p, encoding='utf-8').read()
start = t.find("export function searchCatalogsWithAddons")
assert start > 0, "anchor missing"
head = t[:start]
tail = t[start:]
tail = tail.replace("for (const c of loadCustomCatalogs()) {", "for (const c of loadPinnedCustomCatalogRows()) {")
old_loader = """export function loadCustomCatalogs(): CustomCatalogRow[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATALOGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CustomCatalogRow[]) : [];
  } catch {
    return [];
  }
}"""
new_loader = """export function loadPinnedCustomCatalogRows(): CustomCatalogRow[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATALOGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CustomCatalogRow[]) : [];
  } catch {
    return [];
  }
}"""
assert old_loader in tail, "loader block missing"
tail = tail.replace(old_loader, new_loader)
io.open(p, 'w', encoding='utf-8').write(head + tail)
print("OK unified")
