import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Trophy, KeyRound, LogOut, Moon, Settings2, Sun, SunMoon, ShieldCheck } from 'lucide-react';
import { useAuth, useTheme, initials } from './lib';
import { Logo, PageLoader } from './components/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import Vote from './pages/Vote';
import ResultsPage from './pages/Results';
import PasswordDialog from './pages/PasswordDialog';

const Admin = lazy(() => import('./pages/admin/AdminRoutes'));

function ThemeButton() {
  const [theme, next] = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;
  const label = theme === 'system' ? 'Theme: match device' : `Theme: ${theme}`;
  return <button className="icon-btn" onClick={next} title={label} aria-label={`${label}. Click to change.`}><Icon size={18} /></button>;
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  if (!user) return null;
  return (
    <div className="menu" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Your account"><span className="avatar">{initials(user.name)}</span></button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="who"><b>{user.name}</b><span>{user.email}</span><span style={{ display: 'block' }}>{user.team} · {user.region}</span></div>
          <button role="menuitem" onClick={() => { setOpen(false); setPw(true); }}><KeyRound size={16} /> {user.hasPassword ? 'Change password' : 'Set a password'}</button>
          <button role="menuitem" onClick={() => signOut()}><LogOut size={16} /> Sign out</button>
        </div>
      )}
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
    </div>
  );
}

function Shell() {
  const { user } = useAuth();
  const loc = useLocation();
  const inAdmin = loc.pathname.startsWith('/admin');
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-in">
          <Link to={inAdmin ? '/admin' : '/'} className="tb-left" aria-label="Lumovy home"><Logo height={54} /></Link>
          <Link to={inAdmin ? '/admin' : '/'} className="brand" aria-label="Lumovy Choice Awards home">
            <span className="brand-badge" aria-hidden><Trophy size={22} strokeWidth={2} /></span>
            <span className="brand-text"><b>Lumovy Employee<br />Choice Awards</b></span>
          </Link>
          <div className="tb-right">
          {user?.role === 'admin' && (
            <div className="seg" role="group" aria-label="Switch view">
              <Link to="/" aria-current={!inAdmin ? 'true' : undefined}>Employee</Link>
              <Link to="/admin" aria-current={inAdmin ? 'true' : undefined}><ShieldCheck size={14} style={{ verticalAlign: -2 }} /> HR admin</Link>
            </div>
          )}
          <ThemeButton />
          <UserMenu />
          </div>
        </div>
      </header>
      <main id="main"><Outlet /></main>
    </>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Shell />;
}

function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <Suspense fallback={<div className="wrap"><PageLoader /></div>}><Admin /></Suspense>;
}

function LoginGate() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { if (user) nav((loc.state as any)?.from || (user.role === 'admin' ? '/admin' : '/'), { replace: true }); }, [user]); // eslint-disable-line
  if (loading) return <PageLoader />;
  return <Login />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Home />} />
        <Route path="/contests/:id" element={<Home />} />
        <Route path="/contests/:id/vote" element={<Vote />} />
        <Route path="/contests/:id/results" element={<ResultsPage />} />
        <Route path="/admin/*" element={<RequireAdmin />} />
        <Route path="*" element={<div className="wrap"><div className="empty"><h2>Page not found</h2><Link className="btn btn-primary" to="/">Go to home</Link></div></div>} />
      </Route>
    </Routes>
  );
}
