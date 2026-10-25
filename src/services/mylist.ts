import { useCallback, useEffect, useState } from 'react';
import type { PosterMeta } from '../stremio/types';

const KEY = 'stremioflix.mylist';
const EVT = 'stremioflix:mylist';

export interface MyListItem {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  releaseInfo?: string;
  addedAt: number;
}

function read(): MyListItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isInMyList(id: string, type: string): boolean {
  return read().some((i) => i.id === id && i.type === type);
}

export function toggleMyListItem(meta: PosterMeta): boolean {
  const list = read();
  const idx = list.findIndex((i) => i.id === meta.id && i.type === meta.type);
  let added: boolean;
  if (idx >= 0) {
    list.splice(idx, 1);
    added = false;
  } else {
    list.unshift({
      id: meta.id,
      type: meta.type,
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      releaseInfo: meta.releaseInfo,
      addedAt: Date.now(),
    });
    added = true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent(EVT));
  return added;
}

export function useMyList(): { items: MyListItem[]; toggle: (m: PosterMeta) => boolean; has: (id: string, type: string) => boolean } {
  const [items, setItems] = useState<MyListItem[]>(() => read());
  useEffect(() => {
    const fn = () => setItems(read());
    window.addEventListener(EVT, fn);
    window.addEventListener('storage', fn);
    return () => {
      window.removeEventListener(EVT, fn);
      window.removeEventListener('storage', fn);
    };
  }, []);
  const toggle = useCallback((m: PosterMeta) => {
    const added = toggleMyListItem(m);
    setItems(read());
    return added;
  }, []);
  const has = useCallback((id: string, type: string) => items.some((i) => i.id === id && i.type === type), [items]);
  return { items, toggle, has };
}
