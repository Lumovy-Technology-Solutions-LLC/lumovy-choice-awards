import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Hourglass, Megaphone } from 'lucide-react';
import { api } from '../../api';
import type { Contest, ResultEntry, Results } from '../../types';
import { Empty, ErrorState, PageLoader } from '../../components/ui';
import { Podium, ResultsTable } from '../Results';
import EntryViewer from '../../components/EntryViewer';

export default function ResultsTab({ c, onPublish }: { c: Contest; onPublish: () => void }) {
  const [open, setOpen] = useState<ResultEntry | null>(null);
  const q = useQuery({ queryKey: ['admin-results', c.id, c.status], enabled: c.status !== 'draft', queryFn: () => api.get<Results>(`/api/admin/contests/${c.id}/results`) });
  if (c.status === 'live') return <Empty icon={<Hourglass size={30} />} title="Results are available when voting closes">Voting closes automatically on {c.deadlineLabel}. Until then, the live leaderboard is on the Live tracking tab (HR only).</Empty>;
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data!;
  const all = [...r.winners, ...r.others];
  return (
    <div className="stack">
      {c.status === 'closed' ? (
        <div className="notice warn" style={{ alignItems: 'center' }}><Megaphone size={18} style={{ flex: 'none' }} /><span className="grow">Check the results below. Nothing is visible to employees until you publish.</span><button className="btn btn-accent btn-sm" onClick={onPublish}>Publish results</button></div>
      ) : <div className="notice good">Published. Employees can see the results and have been emailed.</div>}
      <div className="row between">
        <span className="hint num">{r.totalVoters} people voted</span>
        <a className="btn btn-ghost btn-sm" href={`/api/admin/contests/${c.id}/export/results.xlsx`}><Download size={14} /> Download results (Excel)</a>
      </div>
      {r.winners.length ? <Podium winners={r.winners} onOpen={setOpen} /> : <Empty icon={<Hourglass size={30} />} title="No votes were cast">There are no winners to publish.</Empty>}
      {all.length > 0 && <>
        <div className="section-h" style={{ margin: '8px 0 0' }}><h2>All entries</h2><span className="hint">Ties: more 1st-place picks wins, then more 2nd-place picks, otherwise the place is shared.</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Place</th><th>Entry</th><th>Competitor</th><th className="right">1st</th><th className="right">2nd</th><th className="right">3rd</th><th className="right">Points</th></tr></thead>
            <tbody>{all.map((e) => (
              <tr key={e.id}><td className="rank-num num">{e.place}{e.shared ? '=' : ''}</td><td><button className="btn-link" onClick={() => setOpen(e)}>{e.label}</button><div className="muted-sm">{e.title}</div></td><td>{e.competitorName}</td><td className="right num">{e.firsts}</td><td className="right num">{e.seconds}</td><td className="right num">{e.thirds}</td><td className="right num"><b>{e.points}</b></td></tr>
            ))}</tbody>
          </table>
        </div>
      </>}
      {open && <EntryViewer entry={open} onClose={() => setOpen(null)} footer={<div className="badge brand">By {open.competitorName}</div>} />}
    </div>
  );
}

export { ResultsTable };
