import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2, AlertTriangle, X } from 'lucide-react';
import type { Status } from '../types';
import { useCountdown } from '../lib';

export function Logo({ onDark = false, height = 26 }: { onDark?: boolean; height?: number }) {
  if (onDark) return <img src="/brand/logo-white.png" alt="Lumovy Technology Solutions" className="lg" style={{ height }} />;
  return (
    <>
      <img src="/brand/logo-blue.png" alt="Lumovy Technology Solutions" className="lg lg-blue" style={{ height }} />
      <img src="/brand/logo-white.png" alt="" aria-hidden className="lg lg-white" style={{ height }} />
    </>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spin" role="status" aria-label={label}><Loader2 size={18} /></span>;
}
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty" role="status"><Spinner /><p className="hint">{label}</p></div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="empty">
      <div className="big" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><AlertTriangle size={30} /></div>
      <h3>We could not load this</h3>
      <p className="hint">{error instanceof Error ? error.message : 'Please try again.'}</p>
      {retry && <button className="btn btn-primary btn-sm" onClick={retry}>Try again</button>}
    </div>
  );
}
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="hint" style={{ maxWidth: 420 }}>{children}</p>}
      {action}
    </div>
  );
}

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const map: Record<Status, [string, string]> = {
    draft: ['pill-draft', 'Coming soon'], live: ['pill-live', 'Voting open'], closed: ['pill-closed', 'Voting closed'], published: ['pill-pub', 'Winners announced'],
  };
  const [cls, text] = map[status];
  return <span className={`pill ${cls}`}>{label ?? text}</span>;
}

export function Countdown({ endAt, serverTime, onDone, compact }: { endAt?: string | null; serverTime?: string; onDone?: () => void; compact?: boolean }) {
  const c = useCountdown(endAt, serverTime, onDone);
  const p = (n: number) => String(n).padStart(2, '0');
  if (compact) return <span className="timer num" role="timer" aria-label="Time left to vote">{c.over ? 'Voting closed' : `${c.d}d ${p(c.h)}h ${p(c.m)}m ${p(c.s)}s left`}</span>;
  const cells: [number, string][] = [[c.d, 'Days'], [c.h, 'Hours'], [c.m, 'Min'], [c.s, 'Sec']];
  return (
    <div className="countdown" role="timer" aria-label={c.over ? 'Voting has closed' : `Time left: ${c.d} days ${c.h} hours ${c.m} minutes ${c.s} seconds`}>
      {cells.map(([n, l]) => <div className="cd" key={l}><b className="num">{p(n)}</b><span>{l}</span></div>)}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide, className = '', labelledBy }: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const body = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = body; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy || 'modal-title'} tabIndex={-1} ref={ref}>
        {title !== undefined && (
          <div className="modal-h">
            <h3 id="modal-title">{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        )}
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmOpts { title: string; body?: ReactNode; confirm?: string; danger?: boolean; cancel?: string }
export function useConfirm(): [(o: ConfirmOpts) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  const node = state && (
    <Modal title={state.title} onClose={() => done(false)}
      footer={<><button className="btn btn-ghost" onClick={() => done(false)}>{state.cancel ?? 'Cancel'}</button>
        <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>{state.confirm ?? 'Confirm'}</button></>}>
      {state.body && <div className="hint" style={{ fontSize: 14, lineHeight: 1.6 }}>{state.body}</div>}
    </Modal>
  );
  return [ask, node];
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="hint" style={{ color: 'var(--bad)' }} role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function Stat({ value, label, tone, icon }: { value: ReactNode; label: string; tone?: 'good' | 'warn' | 'brand'; icon?: ReactNode }) {
  return (
    <div className="stat">
      {icon && <div className={`stat-ic ${tone || ''}`}>{icon}</div>}
      <b className="num">{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function Check2() { return <Check size={16} />; }

export function Medal({ rank, size }: { rank: number; size?: 'lg' }) {
  return <span className={`${size === 'lg' ? 'medal-lg' : 'medal'} r${Math.min(rank, 3)}`}>{rank}</span>;
}

export function Avatar({ name }: { name: string }) {
  const i = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return <span className="avatar" aria-hidden>{i}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; badge?: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.badge != null && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
