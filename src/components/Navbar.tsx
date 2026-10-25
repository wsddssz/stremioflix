import { useEffect, useRef, useState } from 'react';
import { Search, Bell, ChevronDown, User, Settings, HelpCircle, LogOut, Pencil } from 'lucide-react';

export type NavCategory = 'home' | 'series' | 'movies' | 'new' | 'mylist';

interface Props {
  query: string;
  onQuery: (q: string) => void;
  onHome: () => void;
  onOpenSettings: () => void;
  category: NavCategory;
  onCategory: (c: NavCategory) => void;
}

const PROFILES = [
  { name: 'Kepdns', color: 'from-blue-500 to-purple-600' },
  { name: 'Kids', color: 'from-green-500 to-teal-600' },
  { name: 'Guest', color: 'from-orange-500 to-red-600' },
];

export default function Navbar({ query, onQuery, onHome, onOpenSettings, category, onCategory }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    fn();
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <header
      className={
        'fixed top-0 left-0 right-0 z-40 transition-colors duration-300 ' +
        (scrolled ? 'bg-[#141414]' : 'bg-gradient-to-b from-black/80 to-transparent')
      }
    >
      <div className="flex items-center gap-8 px-4 md:px-12 h-[68px]">
        <button onClick={onHome} className="text-[#E50914] font-black text-2xl md:text-3xl tracking-tighter leading-none">
          STREMI<span className="text-white">O</span>FLIX
        </button>
        <nav className="hidden lg:flex items-center gap-5 text-[13px] text-[#e5e5e5]">
          {(
            [
              { label: 'Home', value: 'home' },
              { label: 'TV Shows', value: 'series' },
              { label: 'Movies', value: 'movies' },
              { label: 'New & Popular', value: 'new' },
              { label: 'My List', value: 'mylist' },
            ] as const
          ).map((l) => (
            <button
              key={l.label}
              onClick={() => { onCategory(l.value); onQuery(''); }}
              className={category === l.value ? 'font-semibold text-white' : 'hover:text-white/70 transition'}
            >
              {l.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {searchOpen ? (
            <div className="flex items-center gap-2 border border-white/60 bg-black/80 px-2 py-1 animate-fade-in">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Titles, people, genres"
                className="bg-transparent outline-none text-sm w-44 md:w-56 placeholder:text-white/60"
                onBlur={() => { if (!query) setSearchOpen(false); }}
              />
            </div>
          ) : (
            <button aria-label="Search" onClick={() => setSearchOpen(true)} className="p-2 hover:text-white/70">
              <Search size={20} />
            </button>
          )}
          <button aria-label="Notifications" onClick={() => { setNotifOpen(!notifOpen); setMenuOpen(false); }} className="p-2 hover:text-white/70 hidden sm:block relative">
            <Bell size={20} />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E50914]" />
          </button>
          {notifOpen && (
            <div className="absolute top-[60px] right-20 w-80 bg-[#181818]/95 border border-white/10 rounded shadow-modal p-2 text-sm animate-fade-in z-50">
              <div className="px-3 py-2 text-white/50 text-xs font-semibold">Notifications</div>
              {['New episodes added to your list', 'Top 10 movies updated today', 'Continue watching: Top Series'].map((n) => (
                <div key={n} className="px-3 py-2.5 hover:bg-white/5 rounded text-white/85">{n}</div>
              ))}
            </div>
          )}
          <div className="relative" ref={menuRef}>
            <button onClick={() => { setMenuOpen(!menuOpen); setNotifOpen(false); }} className="flex items-center gap-1 p-1" aria-label="Profiles">
              <span className={'w-7 h-7 rounded bg-gradient-to-br flex items-center justify-center text-xs font-bold ' + PROFILES[activeProfile].color}>
                {PROFILES[activeProfile].name[0]}
              </span>
              <ChevronDown size={14} className={'transition-transform ' + (menuOpen ? 'rotate-180' : '')} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 w-52 bg-black/95 border border-white/10 shadow-modal animate-fade-in z-50">
                {PROFILES.map((p, i) => (
                  <button
                    key={p.name}
                    onClick={() => { setActiveProfile(i); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] hover:underline text-white/85"
                  >
                    <span className={'w-6 h-6 rounded bg-gradient-to-br flex items-center justify-center text-[11px] font-bold ' + p.color}>{p.name[0]}</span>
                    {p.name}
                    {i === activeProfile && <span className="ml-auto text-[#E50914]">●</span>}
                  </button>
                ))}
                <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-white/85 hover:underline">
                  <Pencil size={15} /> Manage Profiles
                </button>
                <div className="border-t border-white/15 mt-1 pt-1 pb-1">
                  <button className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/85 hover:underline">
                    <User size={15} /> Account
                  </button>
                  <button onClick={() => { setMenuOpen(false); onOpenSettings(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/85 hover:underline">
                    <Settings size={15} /> Settings / Addons
                  </button>
                  <button className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/85 hover:underline">
                    <HelpCircle size={15} /> Help Center
                  </button>
                  <button onClick={() => { setMenuOpen(false); onHome(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/85 hover:underline">
                    <LogOut size={15} /> Sign out of StremioFlix
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
