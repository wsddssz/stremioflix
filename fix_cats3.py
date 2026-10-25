import io
p = 'src/services/catalogService.ts'
t = io.open(p, encoding='utf-8').read()

# 1. Add VideoMeta to import
t = t.replace(
    "import type { PosterMeta, StreamObject, SubtitleObject, AddonStreamGroup } from '../stremio/types';",
    "import type { PosterMeta, StreamObject, SubtitleObject, AddonStreamGroup, VideoMeta } from '../stremio/types';"
)

# 2. Fix removeCustomCatalog: k -> k2
t = t.replace(
    "(e) => customCatalogKey(e.addonUrl, e.type, e.catalogId) !== k,",
    "(e) => customCatalogKey(e.addonUrl, e.type, e.catalogId) !== k2,"
)

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('edits 1-2 done')
