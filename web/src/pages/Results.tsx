import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, Trophy } from 'lucide-react';
import { api, ApiError } from '../api';
import type { ResultEntry, Results } from '../types';
import { fmtDate, ordinal } from '../lib';
import { Empty, ErrorState, Medal, PageLoader } from '../components/ui';
import { useState } from 'react';
import EntryViewer from '../components/EntryViewer';

export function Podium({ winners, onOpen }: { winners: ResultEntry[]; onOpen: (e: ResultEntry) => void }) {
  // Visual order: 2nd, 1st, 3rd. Ties share a place, so group by place and lay out the first 3 groups.
  const byPlace = [1, 2, 3].map((p) => winners.filter((w) => w.place === p));
  const cols: { w: ResultEntry; p: number }[] = [];
  const order = [2, 1, 3];
  for (const p of order) for (const w of byPlace[p - 1]) cols.push({ w, p });
  return (
    <section className="podium" aria-label="Winners">
      <div className="podium-h"><h2>The winners</h2><p>Congratulations to everyone who entered</p></div>
      {cols.map(({ w, p }) => (
        <button key={w.id} className={`pod ${p === 1 ? 'first' : ''}`} onClick={() => onOpen(w)} style={{ textAlign: 'inherit', color: 'inherit', cursor: 'pointer', padding: 0 }} aria-label={`${p === 1 ? 'First' : p === 2 ? 'Second' : 'Third'} place: ${w.competitorName}, ${w.label}, ${w.points} points`}>
          {w.thumbUrl ? <img src={w.thumbUrl} alt={w.altText || w.title} /> : <div className="noimg"><Trophy size={44} color="#F5B83D" /></div>}
          <div className="pod-b">
            <span className={`medal-lg r${p}`}>{p}</span>
            <span className="pod-name">{w.competitorName}</span>
            <span className="pod-meta">{w.label}: {w.title}</span>
            <span className="pod-pts num">{w.points} points</span>
            {w.shared && <span className="tie-tag">Shared place</span>}
          </div>
        </button>
      ))}
    </section>
  );
}

export function ResultsTable({ rows, onOpen }: { rows: ResultEntry[]; onOpen: (e: ResultEntry) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Place</th><th>Entry</th><th>Description</th><th>Competitor</th><th className="right">Points</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="rank-num num">{r.place}{r.shared ? '=' : ''}</td>
              <td><button className="btn-link" onClick={() => onOpen(r)}>{r.label}</button></td>
              <td><b style={{ fontWeight: 500 }}>{r.title}</b><div className="muted-sm">{r.description}</div></td>
              <td>{r.competitorName}</td>
              <td className="right num"><b>{r.points}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MyVote({ r, onOpen }: { r: Results; onOpen: (e: ResultEntry) => void }) {
  const all = [...r.winners, ...r.others];
  const rows = [...(r.myPicks ?? [])].sort((a, b) => a.rank - b.rank).map((p) => ({ p, e: all.find((x) => x.id === p.entryId) })).filter((x) => x.e) as { p: { rank: number }; e: ResultEntry }[];
  if (!r.myVoted || !rows.length) return null;
  return (
    <section className="card my-vote" aria-label="Your vote">
      <div className="card-h"><h3>Your vote</h3><span className="hint">You gave {rows.reduce((n, x) => n + (r.contest.places - x.p.rank + 1), 0)} points in total</span></div>
      <div className="review-list">
        {rows.map(({ p, e }) => (
          <button key={p.rank} className="review-item" style={{ textAlign: 'left', width: '100%' }} onClick={() => onOpen(e)}>
            <Medal rank={p.rank} />
            {e.thumbUrl ? <img src={e.thumbUrl} alt="" /> : <div className="thumb-ph" style={{ width: 64, height: 48 }}><Trophy size={18} /></div>}
            <div className="grow"><b>{e.label}: {e.title}</b><div className="hint">Your {ordinal(p.rank)} pick · finished {ordinal(e.place)}{e.shared ? ' (shared)' : ''} with {e.points} points</div></div>
            {e.place <= 3 && e.points > 0 && <span className="badge good">Winner</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function ResultsPage({ admin = false }: { admin?: boolean }) {
  const { id } = useParams();
  const [open, setOpen] = useState<ResultEntry | null>(null);
  const q = useQuery({ queryKey: [admin ? 'admin-results' : 'results', id], queryFn: () => api.get<Results>(admin ? `/api/admin/contests/${id}/results` : `/api/portal/contests/${id}/results`), retry: false });
  if (q.isLoading) return <div className="wrap"><PageLoader /></div>;
  if (q.isError) {
    const e = q.error as ApiError;
    if (e.code === 'not_published') return <div className="wrap"><Empty icon={<Clock size={30} />} title="Results aren't out yet" action={<Link className="btn btn-ghost" to="/">Back to home</Link>}>Winners are shown here once voting has closed and HR publishes the results.</Empty></div>;
    return <div className="wrap"><ErrorState error={e} retry={() => q.refetch()} /></div>;
  }
  const r = q.data!;
  return (
    <div className="wrap">
      <Link to={`/contests/${id}`} className="hint row" style={{ gap: 4, marginBottom: 10 }}><ArrowLeft size={14} /> {r.contest.name}</Link>
      <div className="vote-head">
        <div><h1>{r.contest.name}: results</h1><p className="hint" style={{ marginTop: 4 }}>{r.totalVoters} {r.totalVoters === 1 ? 'person' : 'people'} voted{r.contest.publishedAt ? ` · published ${fmtDate(r.contest.publishedAt)}` : ''}</p></div>
        {r.myVoted && <span className="badge good">You voted</span>}
      </div>
      {r.winners.length ? <Podium winners={r.winners} onOpen={setOpen} /> : <Empty icon={<Trophy size={30} />} title="No votes were cast">There are no winners for this contest.</Empty>}
      {!admin && <div style={{ marginTop: 20 }}><MyVote r={r} onOpen={setOpen} /></div>}
      {r.others.length > 0 && (<><div className="section-h"><h2>Every other entry</h2><span className="hint">Points: 1st = {r.contest.places}, 2nd = {r.contest.places - 1}, 3rd = 1</span></div><ResultsTable rows={r.others} onOpen={setOpen} /></>)}
      {open && <EntryViewer entry={open} onClose={() => setOpen(null)} footer={<div className="stack"><div className="badge brand">By {open.competitorName}</div><div className="hint">{open.points} points · {open.firsts} first-place, {open.seconds} second-place picks</div></div>} />}
    </div>
  );
}
