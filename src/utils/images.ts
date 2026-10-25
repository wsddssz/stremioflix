// Image helpers: Cinemeta images come from images.metahub.space which blocks
// hotlinking / has flaky CORS. Route through the weserv image proxy with a
// direct-load fallback and a generated gradient placeholder as last resort.

export function proxiedImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.includes('images.weserv.nl')) return url;
  const stripped = url.replace(/^https?:\/\//, '');
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(stripped) + '&w=500&h=750&fit=cover';
}

export function proxiedBackdrop(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.includes('images.weserv.nl')) return url;
  const stripped = url.replace(/^https?:\/\//, '');
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(stripped) + '&w=1280&h=720&fit=cover';
}

/** Deterministic gradient placeholder so cards never render empty. */
export function placeholderFor(name: string): string {
  const palettes: Array<[string, string]> = [
    ['#8E0E00', '#1F1C18'],
    ['#0F2027', '#2C5364'],
    ['#41295a', '#2F0743'],
    ['#134E5E', '#71B280'],
    ['#561423', '#a50000'],
    ['#232526', '#414345'],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const [a, b] = palettes[h % palettes.length];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='750'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
    `</linearGradient></defs>` +
    `<rect width='500' height='750' fill='url(#g)'/>` +
    `<text x='50%' y='52%' font-family='Arial' font-size='120' font-weight='bold' fill='rgba(255,255,255,0.85)' text-anchor='middle'>${initials}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function withFallback(e: React.SyntheticEvent<HTMLImageElement>, name: string, direct?: string): void {
  const img = e.currentTarget;
  const stage = img.dataset.stage ?? 'proxy';
  if (stage === 'proxy' && direct) {
    img.dataset.stage = 'direct';
    img.src = direct;
  } else {
    img.dataset.stage = 'placeholder';
    img.onerror = null;
    img.src = placeholderFor(name);
  }
}
