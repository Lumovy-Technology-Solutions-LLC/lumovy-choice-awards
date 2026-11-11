import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { User } from './types';

// ---------- auth ----------
interface AuthCtx { user: User | null; loading: boolean; mailMode: string; emailSignIn: boolean; refresh: () => Promise<void>; signOut: () => Promise<void> }
const Auth = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Auth);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: User | null; mailMode: string; emailSignIn: boolean }>('/api/auth/me'), staleTime: 60_000, retry: false });
  const refresh = useCallback(async () => { await qc.invalidateQueries({ queryKey: ['me'] }); }, [qc]);
  const signOut = useCallback(async () => {
    const prev = qc.getQueryData<any>(['me']);
    try { await api.post('/api/auth/logout'); } catch { /* cookie may already be gone */ }
    // Flip to signed-out first so the login screen shows at once, then drop everything else cached.
    // (Never qc.clear(): it detaches the live 'me' query, so the screen would not update.)
    qc.setQueryData(['me'], { mailMode: prev?.mailMode ?? 'dev', emailSignIn: prev?.emailSignIn ?? true, user: null });
    await qc.cancelQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  }, [qc]);
  useEffect(() => {
    const h = () => { qc.setQueryData(['me'], (d: any) => ({ ...d, user: null })); };
    window.addEventListener('lcw:signed-out', h);
    return () => window.removeEventListener('lcw:signed-out', h);
  }, [qc]);
  const v = useMemo(() => ({ user: q.data?.user ?? null, loading: q.isLoading, mailMode: q.data?.mailMode ?? 'dev', emailSignIn: q.data?.emailSignIn ?? true, refresh, signOut }), [q.data, q.isLoading, refresh, signOut]);
  return <Auth.Provider value={v}>{children}</Auth.Provider>;
}

// ---------- toasts ----------
const Toast = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(Toast);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: string; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    window.clearTimeout(timer.current);
    setT({ msg, kind, id: Date.now() });
    timer.current = window.setTimeout(() => setT(null), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <Toast.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">{t && <div className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`} key={t.id}>{t.msg}</div>}</div>
    </Toast.Provider>
  );
}

// ---------- theme ----------
export type Theme = 'system' | 'light' | 'dark';
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem('lcw-theme') as Theme) || 'system'; } catch { return 'system'; } });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme'); else el.dataset.theme = theme;
    try { if (theme === 'system') localStorage.removeItem('lcw-theme'); else localStorage.setItem('lcw-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const next = () => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));
  return [theme, next];
}

// ---------- time ----------
/** Clock that follows the server's time, so a wrong laptop clock cannot show the wrong countdown. */
export function useServerClock(serverTime?: string) {
  const offset = useRef(0);
  const seen = useRef<string | undefined>(undefined);
  if (serverTime && serverTime !== seen.current) { seen.current = serverTime; offset.current = new Date(serverTime).getTime() - Date.now(); }
  return useCallback(() => Date.now() + offset.current, []);
}

export function useCountdown(endAt: string | null | undefined, serverTime?: string, onDone?: () => void) {
  const now = useServerClock(serverTime);
  const [, tick] = useState(0);
  const done = useRef(false);
  const cb = useRef(onDone); cb.current = onDone;
  useEffect(() => { done.current = false; }, [endAt]);
  useEffect(() => {
    const i = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(i);
  }, []);
  if (!endAt) return { d: 0, h: 0, m: 0, s: 0, total: 0, over: false, ready: false };
  const total = Math.max(0, new Date(endAt).getTime() - now());
  const over = total <= 0;
  if (over && !done.current) { done.current = true; setTimeout(() => cb.current?.(), 0); }
  const s = Math.floor(total / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, total, over, ready: true };
}

export const fmtDateTime = (iso?: string | null, tz = 'Asia/Kolkata') =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '';
export const fmtDate = (iso?: string | null, tz = 'Asia/Kolkata') =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '';
export const ago = (iso?: string | null) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
};
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const ordinal = (n: number) => ['1st', '2nd', '3rd'][n - 1] || `${n}th`;
export const entryTypeLabel: Record<string, string> = { image: 'Photo or poster', writing: 'Writing', document: 'Document (PDF or Word)', video: 'Video' };
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
