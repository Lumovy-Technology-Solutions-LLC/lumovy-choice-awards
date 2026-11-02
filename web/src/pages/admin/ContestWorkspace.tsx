import { useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Square, ArrowLeft, Check, CalendarPlus, Eye, Megaphone, Play, Send, Trash2, Download, Info } from 'lucide-react';
import { api } from '../../api';
import type { Contest } from '../../types';
import { ago, errMsg, fmtDateTime, useToast } from '../../lib';
import { Countdown, ErrorState, Field, Modal, PageLoader, StatusPill, useConfirm } from '../../components/ui';
import { ContestFormLoader } from './ContestForm';
import EntriesTab from './EntriesTab';
import EmailsTab from './EmailsTab';
import LiveTab from './LiveTab';
import ResultsTab from './ResultsTab';

export interface Readiness { checks: { key: string; ok: boolean; label: string }[]; ready: boolean; recipients: number }
interface Res { contest: Contest; readiness: Readiness; timezones: string[] }

const STAGES = ['Create', 'Add entries', 'Set schedule', 'Voting', 'Check results', 'Publish'];
function stageIndex(c: Contest, r: Readiness) {
  if (c.status === 'published') return 6;
  if (c.status === 'closed') return 4;
  if (c.status === 'live') return 3;
  const ok = (k: string) => r.checks.find((x) => x.key === k)?.ok;
  if (!ok('details')) return 0;
  if (!ok('entries') || !ok('complete') || !ok('names')) return 1;
  return 2;
}

function ExtendModal({ c, onClose }: { c: Contest; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [end, setEnd] = useState(c.endLocal);
  const [notify, setNotify] = useState(true);
  const m = useMutation({
    mutationFn: () => api.post<{ emailsQueued: number }>(`/api/admin/contests/${c.id}/extend`, { endLocal: end, notify }),
    onSuccess: (r) => { qc.invalidateQueries(); toast(`Deadline extended.${r.emailsQueued ? ` ${r.emailsQueued} emails are on their way.` : ''}`); onClose(); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  return (
    <Modal title="Extend the deadline" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={m.isPending || end === c.endLocal} onClick={() => m.mutate()}>Extend deadline</button></>}>
      <div className="stack">
        <p className="hint">Currently closes <b>{c.deadlineLabel}</b>. The portal and countdown update straight away.</p>
        <Field label="New end date and time" htmlFor="ext"><input id="ext" className="input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email everyone in the region about the new deadline</label>
      </div>
    </Modal>
  );
}

function Overview({ c, r }: { c: Contest; r: Readiness }) {
  const q = useQuery({ queryKey: ['audit', c.id], queryFn: () => api.get<{ items: { id: number; actor: string; action: string; at: string }[] }>(`/api/admin/audit?contest=${c.id}`) });
  return (
    <div className="grid-2">
      <div className="stack">
        {c.status === 'draft' && (
          <div className="card">
            <div className="card-h"><h3>Before you start</h3><span className={`badge ${r.ready ? 'good' : 'warn'}`}>{r.ready ? 'Ready' : `${r.checks.filter((x) => !x.ok).length} to do`}</span></div>
            {r.checks.map((x) => <div key={x.key} className={`check-row ${x.ok ? 'ok' : ''}`}><span className="ck"><Check size={13} /></span><span>{x.label}</span></div>)}
          </div>
        )}
        <div className="card">
          <div className="card-h"><h3>At a glance</h3></div>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 18px', fontSize: 14 }}>
            <dt className="muted">Theme</dt><dd style={{ margin: 0 }}>{c.theme || '—'}</dd>
            <dt className="muted">Entries</dt><dd style={{ margin: 0 }} className="num">{c.entryCount}</dd>
            <dt className="muted">Places</dt><dd style={{ margin: 0 }}>Top {c.places}</dd>
            <dt className="muted">Regions</dt><dd style={{ margin: 0 }}>{c.regionLabel} <span className="badge" style={{ marginLeft: 6 }}>{c.scope === 'global' ? 'Global' : c.scope === 'selected' ? 'Selected regions' : 'Regional'}</span></dd>
            <dt className="muted">Voting ends</dt><dd style={{ margin: 0 }}>{c.endAt ? c.deadlineLabel : 'Not set yet'}</dd>
            {c.startedAt && <><dt className="muted">Started</dt><dd style={{ margin: 0 }}>{fmtDateTime(c.startedAt, c.timezone)}</dd></>}
            {c.publishedAt && <><dt className="muted">Published</dt><dd style={{ margin: 0 }}>{fmtDateTime(c.publishedAt, c.timezone)}</dd></>}
          </dl>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Activity on this contest</h3></div>
        <div className="log">
          {(q.data?.items ?? []).slice(0, 12).map((a) => <div className="log-i" key={a.id}><div className="dot"><Info size={14} /></div><div><b style={{ fontWeight: 500 }}>{a.action}</b><span>{a.actor} · {ago(a.at)}</span></div></div>)}
          {q.data && q.data.items.length === 0 && <p className="hint">Nothing yet.</p>}
        </div>
      </div>
    </div>
  );
}

export default function ContestWorkspace() {
  const { id = '' } = useParams();
  const nav = useNavigate(); const qc = useQueryClient(); const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [extend, setExtend] = useState(false);
  const q = useQuery({ queryKey: ['admin-contest', id], queryFn: () => api.get<Res>(`/api/admin/contests/${id}`), refetchInterval: (qq) => (qq.state.data?.contest.status === 'live' ? 20_000 : false) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-contest', id] }); qc.invalidateQueries({ queryKey: ['admin-contests'] }); qc.invalidateQueries({ queryKey: ['admin-overview'] }); qc.invalidateQueries({ queryKey: ['audit'] }); };
  const onErr = (e: unknown) => toast(errMsg(e), 'error');

  const start = useMutation({ mutationFn: () => api.post<{ emailsQueued: number }>(`/api/admin/contests/${id}/start`), onSuccess: (r) => { refresh(); toast(`Voting is open. ${r.emailsQueued} emails are on their way.`); nav(`/admin/contests/${id}/live`); }, onError: onErr });
  const publish = useMutation({ mutationFn: () => api.post<{ emailsQueued: number }>(`/api/admin/contests/${id}/publish`), onSuccess: (r) => { refresh(); toast(`Results published. ${r.emailsQueued} emails are on their way.`); }, onError: onErr });
  const close = useMutation({ mutationFn: () => api.post(`/api/admin/contests/${id}/close`), onSuccess: () => { refresh(); toast('Voting is closed. Check the results, then publish.'); nav(`/admin/contests/${id}/results`); }, onError: onErr });
  const del = useMutation({ mutationFn: () => api.del(`/api/admin/contests/${id}`), onSuccess: () => { refresh(); toast('Draft deleted.'); nav('/admin/contests'); }, onError: onErr });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { contest: c, readiness: r } = q.data!;
  const stage = stageIndex(c, r);
  const base = `/admin/contests/${id}`;

  async function onStart() {
    const ok = await confirm({
      title: 'Start this contest?', confirm: 'Start contest and open voting',
      body: <>Voting opens <b>right now</b> and <b>{r.recipients}</b> employees in {c.regions.join(', ')} get the “Contest started” email. Entries will be locked. Voting closes automatically on <b>{c.deadlineLabel}</b>.</>,
    });
    if (ok) start.mutate();
  }
  async function onClose() {
    if (await confirm({ title: 'Close voting now?', danger: true, confirm: 'Close voting now', body: <>Voting stops immediately, before the scheduled end of <b>{c.deadlineLabel}</b>. Saved but unsubmitted picks will not count. You cannot reopen it (you can only extend a deadline while voting is open).</> })) close.mutate();
  }
  async function onPublish() {
    const ok = await confirm({ title: 'Publish the results?', confirm: 'Publish and email everyone', body: <>The winners, their names and points become visible on the portal and <b>{r.recipients}</b> employees get the “Results declared” email. You cannot undo this.</> });
    if (ok) publish.mutate();
  }
  async function onDelete() {
    if (await confirm({ title: 'Delete this draft?', danger: true, confirm: 'Delete draft', body: 'The contest and all of its uploaded entries will be removed. This cannot be undone.' })) del.mutate();
  }

  const tabs = [
    { to: base, label: 'Overview', end: true }, { to: `${base}/details`, label: 'Details' }, { to: `${base}/entries`, label: `Entries (${c.entryCount})` }, { to: `${base}/emails`, label: 'Emails' },
    ...(c.status !== 'draft' ? [{ to: `${base}/live`, label: 'Live tracking' }, { to: `${base}/results`, label: 'Results' }] : []),
  ];

  return (
    <>
      <div>
        <div className="crumbs"><Link to="/admin/contests"><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Contests</Link></div>
        <div className="admin-top">
          <div><div className="row" style={{ gap: 10 }}><h1>{c.name}</h1><StatusPill status={c.status} /></div><p className="hint" style={{ marginTop: 4 }}>{c.theme}</p>{c.status === 'live' && <div className="row" style={{ gap: 8, marginTop: 8 }}><span className="hint">Closes automatically in</span><Countdown compact endAt={c.endAt} onDone={refresh} /></div>}</div>
          <div className="row">
            {c.status === 'draft' && <>
              <Link className="btn btn-ghost btn-sm" to={`/admin/contests/${id}/preview`}><Eye size={15} /> See it as an employee</Link>
              <button className="btn btn-accent" disabled={!r.ready || start.isPending} onClick={onStart} title={r.ready ? '' : 'Finish the checklist on the Overview tab first'}><Play size={15} /> Start contest</button>
              <button className="icon-btn" onClick={onDelete} aria-label="Delete draft" title="Delete draft"><Trash2 size={16} /></button>
            </>}
            {c.status === 'live' && <>
              <Link className="btn btn-ghost btn-sm" to={`/admin/contests/${id}/preview`}><Eye size={15} /> Preview</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => setExtend(true)}><CalendarPlus size={15} /> Extend deadline</button>
              <button className="btn btn-danger btn-sm" disabled={close.isPending} onClick={onClose}><Square size={14} /> Close voting now</button>
            </>}
            {c.status === 'closed' && <button className="btn btn-accent" disabled={publish.isPending} onClick={onPublish}><Megaphone size={15} /> Publish results</button>}
            {c.status === 'published' && <a className="btn btn-ghost btn-sm" href={`/api/admin/contests/${id}/export/results.xlsx`}><Download size={15} /> Results (Excel)</a>}
          </div>
        </div>
      </div>

      <div className="phase" aria-label="Contest stages">
        <div className="steps">
          {STAGES.map((s, i) => (
            <div key={s} style={{ display: 'contents' }}>
              <div className={`step ${i < stage ? 'done' : i === stage ? 'now' : ''}`} aria-current={i === stage ? 'step' : undefined}><i>{i < stage ? <Check size={14} /> : i + 1}</i><span className="step-label">{s}</span></div>
              {i < STAGES.length - 1 && <span className="step-line" />}
            </div>
          ))}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Contest sections">
        {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} role="tab" className={({ isActive }) => `tablink ${isActive ? 'on' : ''}`}>{t.label}</NavLink>)}
      </div>

      <Routes>
        <Route index element={<Overview c={c} r={r} />} />
        <Route path="details" element={<ContestFormLoader id={id} />} />
        <Route path="entries" element={<EntriesTab c={c} />} />
        <Route path="emails" element={<EmailsTab c={c} />} />
        <Route path="live" element={<LiveTab c={c} />} />
        <Route path="results" element={<ResultsTab c={c} onPublish={onPublish} />} />
      </Routes>

      {extend && <ExtendModal c={c} onClose={() => setExtend(false)} />}
      {confirmNode}
    </>
  );
}

export { Send };
