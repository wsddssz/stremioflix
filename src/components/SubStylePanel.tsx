import { RotateCcw, X } from 'lucide-react';
import type { SubStyle } from '../player/subSettings';
import { SUB_COLORS, SUB_FONTS, DEFAULT_SUB_STYLE } from '../player/subSettings';

interface Props {
  style: SubStyle;
  onChange: (patch: Partial<SubStyle>) => void;
  onReset: () => void;
  onClose: () => void;
}

/** Font / size / color / delay settings for subtitles — applies to the desktop
 *  mpv engine (via nativeSetSubOption) and the browser engine (inline styles). */
export default function SubStylePanel({ style, onChange, onReset, onClose }: Props) {
  return (
    <div className="absolute bottom-11 right-0 w-72 bg-[#181818]/98 border border-white/10 rounded shadow-modal p-3 text-sm z-40">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wide text-white/40 font-semibold">Subtitle style</span>
        <button onClick={onClose} aria-label="Close" className="p-1 text-white/60 hover:text-white"><X size={15} /></button>
      </div>

      <label className="block text-white/70 text-xs mb-1">Font</label>
      <select
        value={style.font}
        onChange={(e) => onChange({ font: e.target.value })}
        className="w-full bg-[#222] border border-white/15 rounded px-2 py-1.5 mb-3 outline-none focus:border-white/40"
        style={{ fontFamily: style.font }}
      >
        {SUB_FONTS.map((f) => (<option key={f} value={f}>{f}</option>))}
      </select>

      <div className="flex items-center justify-between mb-1">
        <label className="text-white/70 text-xs">Size</label>
        <span className="text-white/50 text-xs">{Math.round(style.size * 100)}%</span>
      </div>
      <input
        type="range" min={0.5} max={2} step={0.05} value={style.size}
        onChange={(e) => onChange({ size: Number(e.target.value) })}
        className="nf-range w-full mb-3" aria-label="Subtitle size"
      />

      <label className="block text-white/70 text-xs mb-1">Color</label>
      <div className="flex gap-2 mb-3">
        {SUB_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange({ color: c })}
            aria-label={'Color ' + c}
            className={'w-7 h-7 rounded-full border-2 transition ' + (style.color.toUpperCase() === c ? 'border-[#E50914] scale-110' : 'border-white/20 hover:border-white/60')}
            style={{ background: c }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between mb-1">
        <label className="text-white/70 text-xs">Delay</label>
        <span className={'text-xs ' + (style.delay !== 0 ? 'text-[#E50914] font-semibold' : 'text-white/50')}>
          {style.delay > 0 ? '+' : ''}{style.delay.toFixed(2)}s
        </span>
      </div>
      <input
        type="range" min={-5} max={5} step={0.1} value={style.delay}
        onChange={(e) => onChange({ delay: Number(e.target.value) })}
        className="nf-range w-full mb-1" aria-label="Subtitle delay"
      />
      <div className="flex justify-between text-[10px] text-white/40 mb-3"><span>earlier</span><span>later</span></div>

      <div className="flex gap-2">
        <button onClick={() => onChange({ delay: Math.max(-5, Number((style.delay - 0.1).toFixed(2))) })} className="flex-1 bg-[#222] hover:bg-[#2c2c2c] rounded py-1.5 text-xs">-0.1s</button>
        <button onClick={() => onChange({ delay: Math.min(5, Number((style.delay + 0.1).toFixed(2))) })} className="flex-1 bg-[#222] hover:bg-[#2c2c2c] rounded py-1.5 text-xs">+0.1s</button>
        <button
          onClick={onReset}
          title={'Reset to defaults (' + DEFAULT_SUB_STYLE.font + ', 100%, white, 0s)'}
          className="flex items-center justify-center gap-1 bg-[#222] hover:bg-[#2c2c2c] rounded px-2 py-1.5 text-xs"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      <div className="mt-2 text-[10px] text-white/40">
        Delay works live: mpv on desktop, engine cues in the browser.
      </div>
    </div>
  );
}
