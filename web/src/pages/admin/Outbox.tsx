import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { api } from '../../api';
import { fmtDateTime } from '../../lib';
import { Empty, ErrorState, Modal, PageLoader } from '../../components/ui';

interface Msg { id: number; contest_id: number | null; kind: string; to_email: string; to_name: string; subject: string; status: string; attempts: number; error: string | null; created_at: string; sent_at: string | null }
const KIND: Record<string, string> = { contest_started: 'Contest started', vote_confirmation: 'Your vote is in', results_declared: 'Results declared', reminder: 'Reminder', deadline_extended: 'Deadline extended', otp: 'Sign-in code', test: 'Test email' };
const TONE: Record<string, string> = { sent: 'good', captured: 'brand', queued: 'warn', sending: 'warn', failed: 'bad' };

export default function Outbox() {
  const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['outbox', status, kind, page], placeholderData: keepPreviousData, refetchInterval: 8000, queryFn: () => api.get<{ total: number; items: Msg[]; stats: Record<string, number> }>(`/api/admin/outbox?status=${status}&kind=${kind}&page=${page}`) });
  const msg = useQuery({ queryKey: ['outbox-msg', open], enabled: open != null, queryFn: () => api.get<{ message: { subject: string; html: string; to_email: string; status: string } }>(`/api/admin/outbox/${open}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <>
      <div className="admin-top"><div><div className="eyebrow">HR admin</div><h1>Email outbox</h1><p className="hint" style={{ marginTop: 4 }}>Every email the portal sends is recorded here.</p></div></div>
      <div className="row">{Object.entries(d.stats).map(([k, v]) => <span key={k} className={`badge ${TONE[k] || ''}`}>{k}: {v}</span>)}</div>
      <div className="toolbar">
        <select className="input" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{['queued', 'sent', 'captured', 'failed'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" aria-label="Kind" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">All kinds</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>To</th><th>Subject</th><th>Kind</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{d.items.map((m) => (
            <tr key={m.id}><td><div>{m.to_name}</div><div className="muted-sm">{m.to_email}</div></td><td><button className="btn-link" style={{ textAlign: 'left' }} onClick={() => setOpen(m.id)}>{m.subject}</button>{m.error && <div className="muted-sm" style={{ color: 'var(--bad)' }}>{m.error}</div>}</td><td>{KIND[m.kind] || m.kind}</td><td><span className={`badge ${TONE[m.status] || ''}`}>{m.status}</span></td><td className="hint nowrap">{fmtDateTime(m.created_at)}</td></tr>
          ))}</tbody>
        </table>
        {d.items.length === 0 && <Empty icon={<Mail size={30} />} title="No emails yet">Emails appear here when a contest starts, when people vote, and when results are published.</Empty>}
      </div>
      <div className="pager"><span className="hint num">{d.total} emails</span><button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-ghost btn-sm" disabled={page * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</button></div>
      {open != null && <Modal wide title={msg.data?.message.subject ?? 'Email'} onClose={() => setOpen(null)}>{msg.data ? <div className="mail-prev"><iframe title="Email" sandbox="" srcDoc={msg.data.message.html} /></div> : <PageLoader />}</Modal>}
    </>
  );
}
