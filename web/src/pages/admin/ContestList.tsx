import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Search, Trophy } from 'lucide-react';
import { api } from '../../api';
import type { Contest } from '../../types';
import { errMsg, fmtDateTime, useToast } from '../../lib';
import { Empty, ErrorState, PageLoader, StatusPill } from '../../components/ui';

export default function ContestList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['admin-contests'], queryFn: () => api.get<{ contests: Contest[] }>('/api/admin/contests') });
  const copy = useMutation({
    mutationFn: (id: number) => api.post<{ id: number }>(`/api/admin/contests/${id}/copy`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin-contests'] }); toast('Copied. Add the new entries and set the end date.'); nav(`/admin/contests/${r.id}/details`); },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  if (list.isLoading) return <PageLoader />;
  if (list.isError) return <ErrorState error={list.error} retry={() => list.refetch()} />;
  const rows = list.data!.contests.filter((c) => (!status || c.status === status) && (!q || `${c.name} ${c.theme}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="admin-top"><div><div className="eyebrow">HR admin</div><h1>Contests</h1></div><Link to="/admin/contests/new" className="btn btn-primary"><Plus size={16} /> New contest</Link></div>
      <div className="toolbar">
        <div className="search"><Search size={16} /><input className="input" placeholder="Search contests" aria-label="Search contests" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="draft">Draft</option><option value="live">Voting open</option><option value="closed">Voting closed</option><option value="published">Published</option>
        </select>
      </div>
      <div className="table-wrap" style={{ marginTop: 4 }}>
        <div className="contest-row contest-head"><span>Contest</span><span>Status</span><span>Entries</span><span>Voting ends</span><span className="right">Votes</span></div>
        {rows.length === 0 && <Empty icon={<Trophy size={30} />} title="No contests found">Create your first contest, or copy an earlier one.</Empty>}
        {rows.map((c) => (
          <div key={c.id} style={{ position: 'relative' }}>
            <Link to={`/admin/contests/${c.id}`} className="contest-row">
              <span><b>{c.name}</b><span className="hint">{c.regionLabel} · {c.theme || 'No theme'}</span></span>
              <span><StatusPill status={c.status} /></span>
              <span className="num">{c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}</span>
              <span className="hint">{c.endAt ? fmtDateTime(c.endAt, c.timezone) : 'Not set'}</span>
              <span className="right num" style={{ paddingRight: 44 }}>{c.voterCount}</span>
            </Link>
            <button className="icon-btn" style={{ position: 'absolute', right: 10, top: 10, width: 34, height: 34 }} title="Copy as a starting point" aria-label={`Copy ${c.name} as a new contest`} onClick={() => copy.mutate(c.id)} disabled={copy.isPending}><Copy size={15} /></button>
          </div>
        ))}
      </div>
    </>
  );
}
