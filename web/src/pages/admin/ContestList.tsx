import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Search, Trash2, Trophy } from 'lucide-react';
import { api } from '../../api';
import type { Contest } from '../../types';
import { errMsg, fmtDateTime, useToast } from '../../lib';
import { Empty, ErrorState, PageLoader, StatusPill, useConfirm } from '../../components/ui';

const STATUS_FILTERS: [string, string][] = [['', 'All'], ['draft', 'Draft'], ['live', 'Voting open'], ['closed', 'Voting closed'], ['published', 'Published']];

export default function ContestList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [confirm, confirmNode] = useConfirm();
  const list = useQuery({ queryKey: ['admin-contests'], queryFn: () => api.get<{ contests: Contest[] }>('/api/admin/contests') });
  const copy = useMutation({
    mutationFn: (id: number) => api.post<{ id: number }>(`/api/admin/contests/${id}/copy`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin-contests'] }); toast('Copied. Add the new entries and set the end date.'); nav(`/admin/contests/${r.id}/details`); },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const del = useMutation({
    mutationFn: (ids: number[]) => api.post<{ deleted: number }>('/api/admin/contests/bulk-delete', { ids }),
    onSuccess: (r) => { setSel([]); qc.invalidateQueries({ queryKey: ['admin-contests'] }); qc.invalidateQueries({ queryKey: ['home'] }); toast(`${r.deleted} ${r.deleted === 1 ? 'contest' : 'contests'} deleted.`); },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  if (list.isLoading) return <PageLoader />;
  if (list.isError) return <ErrorState error={list.error} retry={() => list.refetch()} />;
  const all = list.data!.contests;
  const rows = all.filter((c) => (!status || c.status === status) && (!q || `${c.name} ${c.theme}`.toLowerCase().includes(q.toLowerCase())));
  const shownIds = rows.map((c) => c.id);
  const allOn = shownIds.length > 0 && shownIds.every((i) => sel.includes(i));
  const toggle = (i: number) => setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  async function onDeleteSelected() {
    const chosen = all.filter((c) => sel.includes(c.id));
    const started = chosen.filter((c) => c.status !== 'draft').length;
    if (await confirm({
      title: `Delete ${chosen.length} ${chosen.length === 1 ? 'contest' : 'contests'}?`, danger: true, confirm: `Delete ${chosen.length}`,
      body: `${chosen.map((c) => c.name).join(', ')}. Their entries, votes and voting history are removed for good${started ? ` (${started} already started, so their votes are lost too)` : ''}. This cannot be undone.`,
    })) del.mutate(chosen.map((c) => c.id));
  }
  return (
    <>
      {confirmNode}
      <div className="admin-top"><div><div className="eyebrow">HR admin</div><h1>Contests</h1></div><Link to="/admin/contests/new" className="btn btn-primary"><Plus size={16} /> New contest</Link></div>
      <div className="toolbar">
        <div className="search"><Search size={16} /><input className="input" placeholder="Search contests" aria-label="Search contests" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="chips" role="group" aria-label="Filter by status" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        {STATUS_FILTERS.map(([v, label]) => {
          const n = v ? all.filter((c) => c.status === v).length : all.length;
          return <button key={v} type="button" className={`chip ${status === v ? 'on' : ''}`} aria-pressed={status === v} onClick={() => setStatus(v)}>{label} <span className="num">{n}</span></button>;
        })}
      </div>
      {sel.length > 0 && (
        <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <b>{sel.length} selected</b>
          <button className="btn btn-danger btn-sm" onClick={onDeleteSelected} disabled={del.isPending}><Trash2 size={15} /> Delete selected</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSel([])}>Clear</button>
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 4 }}>
        <div className="contest-row contest-head" style={{ paddingLeft: 48, position: 'relative' }}><input type="checkbox" aria-label="Select all contests shown" checked={allOn} onChange={() => setSel(allOn ? sel.filter((i) => !shownIds.includes(i)) : [...new Set([...sel, ...shownIds])])} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }} /><span>Contest</span><span>Status</span><span>Entries</span><span>Voting ends</span><span className="right">Votes</span></div>
        {rows.length === 0 && <Empty icon={<Trophy size={30} />} title="No contests found">Create your first contest, or copy an earlier one.</Empty>}
        {rows.map((c) => (
          <div key={c.id} style={{ position: 'relative' }}>
            <input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.includes(c.id)} onChange={() => toggle(c.id)} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
            <Link to={`/admin/contests/${c.id}`} className="contest-row" style={{ paddingLeft: 48 }}>
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
