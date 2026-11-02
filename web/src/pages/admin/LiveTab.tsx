import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Download, EyeOff, FileText, Percent, Save, Users, Vote, Lock } from 'lucide-react';
import { api } from '../../api';
import type { Contest, ResultEntry } from '../../types';
import { errMsg, fmtDateTime, useToast } from '../../lib';
import { ErrorState, Medal, PageLoader, Stat, useConfirm } from '../../components/ui';

interface Dash {
  serverTime: string; eligible: number; voted: number; notVoted: number; turnout: number; savedDrafts: number;
  leaderboard: (ResultEntry & { pct: number })[]; timeline: { t: string; n: number }[]; bucketMs: number; byTeam: { team: string; eligible: number; voted: number }[];
}

function Ring({ pct }: { pct: number }) {
  const r = 54, circ = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 140 140" role="img" aria-label={`${pct}% turnout`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="14" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--brand)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(Math.min(100, pct) / 100) * circ} ${circ}`} transform="rotate(-90 70 70)" style={{ transition: 'stroke-dasharray .6s' }} />
      <text x="70" y="76" textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--text)" className="num">{pct}%</text>
    </svg>
  );
}

export default function LiveTab({ c }: { c: Contest }) {
  const qc = useQueryClient(); const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [showNon, setShowNon] = useState(false);
  const live = c.status === 'live';
  const q = useQuery({ queryKey: ['admin-dash', c.id], queryFn: () => api.get<Dash>(`/api/admin/contests/${c.id}/dashboard`), refetchInterval: live ? 5000 : false });
  const non = useQuery({ queryKey: ['admin-nonvoters', c.id], enabled: showNon, queryFn: () => api.get<{ users: { id: number; name: string; email: string; team: string }[] }>(`/api/admin/contests/${c.id}/non-voters`), refetchInterval: live ? 15000 : false });
  const remind = useMutation({ mutationFn: () => api.post<{ emailsQueued: number }>(`/api/admin/contests/${c.id}/reminder`), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['audit'] }); toast(`Reminder queued for ${r.emailsQueued} people.`); }, onError: (e) => toast(errMsg(e), 'error') });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const maxTl = Math.max(1, ...d.timeline.map((x) => x.n));

  async function onRemind() {
    if (await confirm({ title: 'Send a reminder?', confirm: `Remind ${d.notVoted} people`, body: <>This emails the <b>{d.notVoted}</b> people in the region who have not voted yet. People who already voted are not emailed.</> })) remind.mutate();
  }

  return (
    <div className="stack">
      <div className="notice"><EyeOff size={16} style={{ flex: 'none', marginTop: 2 }} /> {live ? 'You can see who has voted, but nobody, including HR, can see who voted for which entry. The leaderboard below is for HR only. Employees cannot see it until results are published.' : 'Voting is over. These are the final numbers.'}</div>
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Stat icon={<Users size={18} />} value={d.eligible} label="Eligible employees" />
        <Stat icon={<Vote size={18} />} tone="good" value={d.voted} label="Have voted" />
        <Stat icon={<Percent size={18} />} tone="brand" value={`${d.turnout}%`} label="Turnout" />
        <Stat icon={<Save size={18} />} tone="warn" value={live ? d.savedDrafts : '—'} label="Saved, not submitted" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h"><h3>Turnout</h3>{live && <span className="hint"><span className="live-dot" />Updating live</span>}</div>
          <div className="turnout">
            <Ring pct={d.turnout} />
            <div className="grow" style={{ minWidth: 200 }}>
              <div className="num" style={{ fontSize: 15 }}><b>{d.voted}</b> of {d.eligible} voted · <b>{d.notVoted}</b> to go</div>
              <div className="tl" aria-label="Votes over time" role="img">{d.timeline.slice(-24).map((x) => <i key={x.t} style={{ height: `${(x.n / maxTl) * 100}%` }} title={`${fmtDateTime(x.t, c.timezone)}: ${x.n} votes`} />)}</div>
              <div className="hint">Votes per {d.bucketMs >= 864e5 ? 'day' : 'hour'}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>By team</h3></div>
          <div className="stack" style={{ gap: 10, maxHeight: 220, overflow: 'auto' }}>
            {d.byTeam.map((t) => (
              <div key={t.team}><div className="row between" style={{ fontSize: 13 }}><span>{t.team}</span><span className="num muted">{t.voted}/{t.eligible}</span></div><div className="bar"><i style={{ width: `${t.eligible ? (t.voted / t.eligible) * 100 : 0}%` }} /></div></div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Leaderboard <span className="badge warn" style={{ marginLeft: 6 }}><Lock size={11} /> HR only</span></h3><span className="hint">1st = {c.places} · 2nd = {c.places - 1} · 3rd = 1 points</span></div>
        {d.leaderboard.map((e, i) => (
          <div className="lb-row" key={e.id}>
            <span className="lb-rank num">{i + 1}</span>
            {e.thumbUrl ? <img className="lb-thumb" src={e.thumbUrl} alt="" /> : <div className="lb-thumb"><FileText size={18} /></div>}
            <div className="lb-name"><b>{e.label}: {e.title}</b><span>{e.description}</span></div>
            <div className="bar"><i style={{ width: `${e.pct}%` }} /></div>
            <span className="lb-pts num">{e.points}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Who has not voted yet</h3>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNon((s) => !s)}>{showNon ? 'Hide list' : `Show ${d.notVoted} people`}</button>
            {live && <button className="btn btn-accent btn-sm" disabled={!d.notVoted || remind.isPending} onClick={onRemind}><BellRing size={14} /> Send reminder</button>}
          </div>
        </div>
        {showNon && (non.data ? (
          <div className="table-wrap"><table className="simple"><thead><tr><th>Name</th><th>Email</th><th>Team</th></tr></thead><tbody>{non.data.users.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.team}</td></tr>)}</tbody></table></div>
        ) : <p className="hint">Loading…</p>)}
        <div className="row" style={{ marginTop: showNon ? 12 : 0 }}>
          <a className="btn btn-ghost btn-sm" href={`/api/admin/contests/${c.id}/export/voters.xlsx`}><Download size={14} /> Voter list (Excel)</a>
          <a className="btn btn-ghost btn-sm" href={`/api/admin/contests/${c.id}/export/results.xlsx`}><Download size={14} /> Results (Excel)</a>
        </div>
      </div>
      {confirmNode}
    </div>
  );
}

export { Medal };
