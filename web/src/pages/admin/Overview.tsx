import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mail, Plus, Trophy, Users, Vote, Hourglass, FileText, Megaphone } from 'lucide-react';
import { api } from '../../api';
import type { Contest } from '../../types';
import { ago, useAuth } from '../../lib';
import { Countdown, ErrorState, PageLoader, Stat, StatusPill } from '../../components/ui';

interface OverviewData {
  serverTime: string;
  totals: { contests: number; live: number; drafts: number; finished: number; awaitingPublish: number; employees: number; queuedEmails: number };
  live: (Contest & { eligible: number; voted: number; turnout: number })[];
  awaitingPublish: Contest[];
  recentAudit: { id: number; actor: string; action: string; contestId: number | null; at: string }[];
}

export default function Overview() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get<OverviewData>('/api/admin/overview'), refetchInterval: 15_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <>
      <div className="admin-top">
        <div><div className="eyebrow">HR admin</div><h1>Hello, {user?.name.split(' ')[0]}</h1></div>
        <Link to="/admin/contests/new" className="btn btn-primary"><Plus size={16} /> New contest</Link>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Stat icon={<Vote size={18} />} value={d.totals.live} label="Voting open now" tone="good" />
        <Stat icon={<Hourglass size={18} />} value={d.totals.awaitingPublish} label="Results to publish" tone="warn" />
        <Stat icon={<FileText size={18} />} value={d.totals.drafts} label="Drafts being set up" />
        <Stat icon={<Users size={18} />} value={d.totals.employees} label="Active employees" />
      </div>

      {d.awaitingPublish.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <div className="card-h"><h3><Megaphone size={16} style={{ verticalAlign: -3 }} /> Ready for you to check and publish</h3></div>
          {d.awaitingPublish.map((c) => (
            <div className="row between" key={c.id} style={{ padding: '8px 0' }}>
              <div><b>{c.name}</b><div className="hint">Voting closed. Check the results, then publish.</div></div>
              <Link className="btn btn-accent btn-sm" to={`/admin/contests/${c.id}/results`}>Review results</Link>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-h"><h3>Voting open</h3><Link to="/admin/contests" className="btn-link">All contests</Link></div>
        {d.live.length === 0 ? <p className="hint">No contest is open for voting. Start one from a draft contest once its entries are uploaded.</p> : d.live.map((c) => (
          <Link key={c.id} to={`/admin/contests/${c.id}/live`} className="link-card" style={{ marginBottom: 10 }}>
            <div className="grow">
              <div className="row" style={{ gap: 8 }}><b>{c.name}</b><StatusPill status={c.status} /></div>
              <div className="progress" style={{ margin: '10px 0 6px' }} role="progressbar" aria-valuenow={c.turnout} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, c.turnout)}%` }} /></div>
              <div className="hint num">{c.voted} of {c.eligible} have voted ({c.turnout}% turnout)</div>
            </div>
            <div style={{ textAlign: 'right' }}><div className="hint">Closes in</div><Countdown compact endAt={c.endAt} serverTime={d.serverTime} /></div>
          </Link>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h"><h3>Recent activity</h3><Link to="/admin/audit" className="btn-link">View all</Link></div>
          <div className="log">
            {d.recentAudit.length === 0 && <p className="hint">Nothing yet.</p>}
            {d.recentAudit.map((a) => (
              <div className="log-i" key={a.id}><div className="dot"><Trophy size={14} /></div><div><b style={{ fontWeight: 500 }}>{a.action}</b><span>{a.actor} · {ago(a.at)}</span></div></div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Quick links</h3></div>
          <div className="stack">
            <Link to="/admin/contests/new" className="link-card"><Trophy size={18} color="var(--brand)" /><div><b>Create a contest</b><div className="hint">Or copy an earlier one to launch in minutes</div></div></Link>
            <Link to="/admin/users" className="link-card"><Users size={18} color="var(--brand)" /><div><b>Manage employees</b><div className="hint">Upload a spreadsheet, switch people off, add regions</div></div></Link>
            <Link to="/admin/outbox" className="link-card"><Mail size={18} color="var(--brand)" /><div><b>Email outbox</b><div className="hint">{d.totals.queuedEmails} waiting to send</div></div></Link>
          </div>
        </div>
      </div>
    </>
  );
}
