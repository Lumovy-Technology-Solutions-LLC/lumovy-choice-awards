import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mail, Lock, ArrowRight, Eye, EyeOff, Trophy, ShieldCheck, Info } from 'lucide-react';
import { api } from '../api';
import { useAuth, useTheme, errMsg } from '../lib';
import { Field, Logo, Spinner } from '../components/ui';
import { Moon, Sun, SunMoon } from 'lucide-react';

export default function Login() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [sent, setSent] = useState(false);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const [cool, setCool] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [theme, nextTheme] = useTheme();
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;

  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(t); }, [cool]);

  async function loadDevCode(addr: string) {
    try {
      const r = await api.get<{ items: { kind: string; text: string }[] }>(`/api/dev/mailbox?email=${encodeURIComponent(addr)}`);
      const m = r.items.find((i) => i.kind === 'otp')?.text.match(/\b(\d{6})\b/);
      setDevCode(m?.[1] ?? '');
    } catch { setDevCode(''); }
  }

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    if (!email.trim()) { setError('Enter your work email.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post<{ devMailbox: boolean }>('/api/auth/otp/request', { email });
      setSent(true); setCool(30); setDigits(['', '', '', '', '', '']);
      if (r.devMailbox) setTimeout(() => loadDevCode(email.trim().toLowerCase()), 500);
      setTimeout(() => refs.current[0]?.focus(), 50);
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  async function verify(code: string) {
    setBusy(true); setError('');
    try { await api.post('/api/auth/otp/verify', { email, code }); await refresh(); }
    catch (err) { setError(errMsg(err)); setDigits(['', '', '', '', '', '']); refs.current[0]?.focus(); }
    finally { setBusy(false); }
  }

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, '');
    if (clean.length > 1) { // paste
      const d = clean.slice(0, 6).split('');
      const next = [...'      '].map((_, k) => d[k] ?? '');
      setDigits(next);
      if (d.length === 6) verify(d.join(''));
      else refs.current[Math.min(d.length, 5)]?.focus();
      return;
    }
    const next = [...digits]; next[i] = clean; setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) verify(next.join(''));
  }

  async function passwordLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api.post('/api/auth/login', { email, password }); await refresh(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <button className="icon-btn" style={{ position: 'fixed', top: 16, right: 16 }} onClick={nextTheme} aria-label={`Theme: ${theme}. Click to change.`}><ThemeIcon size={18} /></button>
      <div className="login">
        <div className="login-art" aria-hidden>
          <Logo onDark height={34} />
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="pod3d">
              <div className="trophy"><Trophy size={64} color="#F5B83D" strokeWidth={1.6} /></div>
              <div className="pod3d-row">
                <div className="st s2"><span className="st-n">2</span><span className="st-p">pts</span></div>
                <div className="st s1"><span className="st-n">1</span><span className="st-p">winner</span></div>
                <div className="st s3"><span className="st-n">3</span><span className="st-p">pts</span></div>
              </div>
              <div className="pod3d-floor" />
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Employee Choice Awards</div>
            <h2 style={{ fontSize: 24, fontWeight: 600, marginTop: 6 }}>Vote for the work, not the person.</h2>
            <p style={{ opacity: 0.8, marginTop: 6, fontSize: 14 }}>Every entry is anonymous. One vote each, counted once.</p>
          </div>
        </div>

        <div className="login-form">
          <div>
            <h1>Welcome back</h1>
            <p className="hint" style={{ marginTop: 4, fontSize: 14 }}>Sign in with your Lumovy work email.</p>
          </div>

          <div className="login-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'otp'} onClick={() => { setMode('otp'); setError(''); }}>Email code</button>
            <button role="tab" aria-selected={mode === 'password'} onClick={() => { setMode('password'); setError(''); }}>Password</button>
          </div>

          {mode === 'otp' && !sent && (
            <form className="form" onSubmit={requestCode} noValidate>
              <Field label="Work email" htmlFor="email">
                <input id="email" className="input" type="email" autoComplete="username" inputMode="email" placeholder="you@lumovy.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </Field>
              {error && <div className="notice bad" role="alert">{error}</div>}
              <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : <Mail size={16} />} Send me a code</button>
              <p className="hint center">We will email a 6-digit code. No password needed.</p>
            </form>
          )}

          {mode === 'otp' && sent && (
            <div className="form">
              <div className="notice"><Info size={16} style={{ flex: 'none', marginTop: 2 }} /><span>If <b>{email}</b> is on the eligible list, a 6-digit code is on its way. It works for 10 minutes.</span></div>
              <div className="otp" role="group" aria-label="6-digit code">
                {digits.map((d, i) => (
                  <input key={i} ref={(el) => { refs.current[i] = el; }} className="input" inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6} value={d}
                    aria-label={`Digit ${i + 1}`} onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} />
                ))}
              </div>
              {devCode && <div className="notice warn"><Info size={16} style={{ flex: 'none', marginTop: 2 }} /><span>Test mode: no real email is sent. Your code is <b className="num">{devCode}</b>. <button className="btn-link" onClick={() => { setDigits(devCode.split('')); verify(devCode); }}>Use it</button></span></div>}
              {error && <div className="notice bad" role="alert">{error}</div>}
              <button className="btn btn-primary" disabled={busy || digits.some((d) => !d)} onClick={() => verify(digits.join(''))}>{busy ? <Spinner /> : <ArrowRight size={16} />} Sign in</button>
              <div className="row between">
                <button className="btn-link" onClick={() => { setSent(false); setError(''); setDevCode(''); }}>Use a different email</button>
                <button className="btn-link" disabled={cool > 0 || busy} onClick={() => requestCode()} style={{ opacity: cool > 0 ? 0.5 : 1 }}>{cool > 0 ? `Resend in ${cool}s` : 'Resend code'}</button>
              </div>
            </div>
          )}

          {mode === 'password' && (
            <form className="form" onSubmit={passwordLogin} noValidate>
              <Field label="Work email" htmlFor="email2">
                <input id="email2" className="input" type="email" autoComplete="username" inputMode="email" placeholder="you@lumovy.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Password" htmlFor="pw">
                <div style={{ position: 'relative' }}>
                  <input id="pw" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 44 }} />
                  <button type="button" className="btn-link" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 12, top: 11, color: 'var(--muted)' }}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </Field>
              {error && <div className="notice bad" role="alert">{error}</div>}
              <button className="btn btn-primary" disabled={busy || !email || !password}>{busy ? <Spinner /> : <Lock size={16} />} Sign in</button>
              <p className="hint center">No password yet? Use the <button type="button" className="btn-link" onClick={() => setMode('otp')}>email code</button>, then set one from your account menu.</p>
            </form>
          )}

          <div className="hint row" style={{ justifyContent: 'center', gap: 6 }}><ShieldCheck size={14} /> Only employees marked eligible by HR can sign in.</div>
        </div>
      </div>
    </div>
  );
}
