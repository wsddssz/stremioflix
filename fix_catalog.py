import io
p = 'src/services/catalogService.ts'
t = io.open(p, encoding='utf-8').read()
t = t.replace("\\\\'string\\\\'", "'string'")
t = t.replace('export function customCatalogKeyexport function customCatalogKey', 'export function customCatalogKey')
io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('done')
