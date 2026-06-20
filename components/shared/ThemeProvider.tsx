'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark' | undefined;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: undefined,
  setTheme: () => {},
});

const STORAGE_KEY = 'lumhimkhue-theme';

type Snapshot = { theme: Theme; resolved: 'light' | 'dark' | undefined };

// Server snapshot: resolved is undefined so ThemeToggle renders the same
// disabled <button> on server and first-client hydration pass.
const SERVER_SNAPSHOT: Snapshot = { theme: 'system', resolved: undefined };

// Module-level cache keeps getClientSnapshot() referentially stable across calls.
let _cache: Snapshot | null = null;

// Same-tab subscribers — useSyncExternalStore registers one; we notify it manually
// on setTheme since the storage event is not fired for the originating tab.
const _subs = new Set<() => void>();

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

function resolveTheme(preference: Theme): 'light' | 'dark' {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

function subscribe(cb: () => void): () => void {
  _subs.add(cb);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    _cache = null;
    cb();
  };
  const onMq = () => { _cache = null; cb(); };
  window.addEventListener('storage', onStorage);
  mq.addEventListener('change', onMq);
  return () => {
    _subs.delete(cb);
    window.removeEventListener('storage', onStorage);
    mq.removeEventListener('change', onMq);
  };
}

function getClientSnapshot(): Snapshot {
  if (!_cache) {
    const theme = readStoredTheme();
    _cache = { theme, resolved: resolveTheme(theme) };
  }
  return _cache;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snap = useSyncExternalStore(subscribe, getClientSnapshot, () => SERVER_SNAPSHOT);

  // Apply .dark class + colorScheme when resolved theme changes.
  // No setState here — just a DOM side effect.
  useEffect(() => {
    if (snap.resolved) applyTheme(snap.resolved);
  }, [snap.resolved]);

  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    // Bust cache and notify same-tab subscribers (cross-tab is handled by the storage event)
    _cache = null;
    _subs.forEach((fn) => fn());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: snap.theme, resolvedTheme: snap.resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
