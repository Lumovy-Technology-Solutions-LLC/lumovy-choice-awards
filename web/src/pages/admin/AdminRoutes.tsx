import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Trophy, Users as UsersIcon, Mail, ScrollText, Settings as SettingsIcon, MailX } from 'lucide-react';
import { api } from '../../api';
import Settings, { settingsKey, type AdminSettings } from './Settings';
import Overview from './Overview';
import ContestList from './ContestList';
import ContestForm from './ContestForm';
import ContestWorkspace from './ContestWorkspace';
import Users from './Users';
import Outbox from './Outbox';
import Audit from './Audit';
import { PreviewVote } from '../Vote';

const nav = [
  { to: '/admin', end: true, label: 'Overview', icon: LayoutDashboard },
  { to: '/admin/contests', label: 'Contests', icon: Trophy },
  { to: '/admin/users', label: 'Users & regions', icon: UsersIcon },
  { to: '/admin/outbox', label: 'Email outbox', icon: Mail },
  { to: '/admin/audit', label: 'Activity log', icon: ScrollText },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

export default function AdminRoutes() {
  const loc = useLocation();
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => api.get<AdminSettings>('/api/admin/settings'), staleTime: 30_000 });
  const off = settings.data && [!settings.data.emailNotifications && 'Email notifications', !settings.data.emailSignIn && 'Email sign-in codes'].filter(Boolean).join(' and ');
  // The employee preview is full-width, exactly like the real voting page.
  if (/\/contests\/\d+\/preview$/.test(loc.pathname)) {
    return <Routes><Route path="contests/:id/preview" element={<PreviewVote />} /></Routes>;
  }
  return (
    <div className="wrap">
      <div className="admin">
        <nav className="side" aria-label="HR admin">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}><n.icon size={18} />{n.label}</NavLink>
          ))}
          <div className="side-foot">Everything about a contest is set here. Nothing is hard-coded.<br /><Link to="/admin/contests/new" style={{ fontWeight: 500 }}>+ New contest</Link></div>
        </nav>
        <div className="ws">
          {off && <div className="notice warn" role="status" style={{ marginBottom: 16 }}><MailX size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>{off}</b> are switched off, so those emails are not being sent.<Link to="/admin/settings" style={{ fontWeight: 500 }}>Change in Settings</Link></span></div>}
          <Routes>
            <Route index element={<Overview />} />
            <Route path="contests" element={<ContestList />} />
            <Route path="contests/new" element={<ContestForm />} />
            <Route path="contests/:id/*" element={<ContestWorkspace />} />
            <Route path="users" element={<Users />} />
            <Route path="outbox" element={<Outbox />} />
            <Route path="audit" element={<Audit />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<div className="empty"><h2>Page not found</h2></div>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
