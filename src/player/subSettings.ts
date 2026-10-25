// Subtitle appearance settings — shared by browser engine, desktop mpv shell,
// and persisted across sessions (the Android player reads the same defaults
// through its own SharedPreferences).
export interface SubStyle {
  font: string;
  size: number; // multiplier 0.5 – 2.0 (mpv sub-scale)
  color: string; // #RRGGBB
  delay: number; // seconds, positive = subtitles later
}

export const SUB_FONTS = ['Arial', 'Segoe UI', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS'];
export const SUB_COLORS = ['#FFFFFF', '#FFFF00', '#00FFFF', '#00FF66', '#FF6666', '#FF8C00', '#000000'];

export const DEFAULT_SUB_STYLE: SubStyle = {
  font: 'Arial',
  size: 1,
  color: '#FFFFFF',
  delay: 0,
};

const KEY = 'stremioflix.substyle';

export function loadSubStyle(): SubStyle {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SUB_STYLE };
    const p = JSON.parse(raw) as Partial<SubStyle>;
    return {
      font: typeof p.font === 'string' && p.font ? p.font : DEFAULT_SUB_STYLE.font,
      size: typeof p.size === 'number' && p.size >= 0.5 && p.size <= 2 ? p.size : 1,
      color: typeof p.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(p.color) ? p.color : DEFAULT_SUB_STYLE.color,
      delay: typeof p.delay === 'number' && Math.abs(p.delay) <= 300 ? p.delay : 0,
    };
  } catch {
    return { ...DEFAULT_SUB_STYLE };
  }
}

export function saveSubStyle(s: SubStyle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* noop */ }
}
