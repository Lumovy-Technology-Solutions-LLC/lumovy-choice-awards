import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api } from '../../api';
import { fmtDateTime } from '../../lib';
import { Empty, ErrorState, PageLoader } from '../../components/ui';

interface Item { id: number; actor: string; action: string; contestId: number | null; detail: Record<string, unknown>; at: string }

export default function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit-all', page], placeholderData: keepPreviousData, queryFn: () => api.get<{ total: number; items: Item[] }>(`/api/admin/audit?page=${page}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const summarize = (x: Record<string, unknown>) => Object.entries(x).filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? fmtDateTime(v) : String(v)}`).join(' · ');
  return (
    <>
      <div className="admin-top"><div><div className="eyebrow">HR admin</div><h1>Activity log</h1><p className="hint" style={{ marginTop: 4 }}>Every admin action is recorded with who did it and when. Entries cannot be edited or deleted.</p></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{d.items.map((a) => (
            <tr key={a.id}><td className="hint nowrap">{fmtDateTime(a.at)}</td><td>{a.actor}</td><td><b style={{ fontWeight: 500 }}>{a.action}</b>{a.contestId && <> · <Link to={`/admin/contests/${a.contestId}`}>contest {a.contestId}</Link></>}</td><td className="hint">{summarize(a.detail)}</td></tr>
          ))}</tbody>
        </table>
        {d.items.length === 0 && <Empty icon={<ScrollText size={30} />} title="Nothing logged yet">Actions will appear here.</Empty>}
      </div>
      <div className="pager"><span className="hint num">{d.total} entries</span><button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-ghost btn-sm" disabled={page * 100 >= d.total} onClick={() => setPage(page + 1)}>Next</button></div>
    </>
  );
}
