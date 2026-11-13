import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Globe2, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, UploadCloud, UserPlus, X } from 'lucide-react';
import { api } from '../../api';
import { ago, errMsg, useToast } from '../../lib';
import { Empty, ErrorState, Field, Modal, PageLoader, Spinner, Switch, Tabs, useConfirm } from '../../components/ui';

interface U { id: number; name: string; email: string; team: string; region: string; role: 'employee' | 'admin'; active: boolean; hasPassword: boolean; lastLoginAt: string | null }
interface BulkResult { deleted: number; skipped: { id: number | string; name: string; reason: string }[] }
interface Region { code: string; name: string; timezone: string; enabled: boolean; employees: number }

function UserModal({ user, regions, onClose, onSaved }: { user: U | null; regions: Region[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', team: user?.team ?? '', region: user?.region ?? regions.find((r) => r.enabled)?.code ?? 'IN', role: user?.role ?? 'employee', active: user?.active ?? true });
  const [err, setErr] = useState('');
  const m = useMutation({
    mutationFn: () => (user ? api.put(`/api/admin/users/${user.id}`, f) : api.post('/api/admin/users', f)),
    onSuccess: () => { toast(user ? 'Saved.' : 'Person added.'); onSaved(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title={user ? 'Edit person' : 'Add a person'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={m.isPending} onClick={() => { setErr(''); m.mutate(); }}>Save</button></>}>
      <div className="stack">
        <div className="form-row">
          <Field label="Name" htmlFor="u-name"><input id="u-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Work email" htmlFor="u-email"><input id="u-email" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="Team" htmlFor="u-team"><input id="u-team" className="input" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /></Field>
          <Field label="Region" htmlFor="u-reg"><select id="u-reg" className="input" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>{regions.map((r) => <option key={r.code} value={r.code}>{r.name}{r.enabled ? '' : ' (off)'}</option>)}</select></Field>
        </div>
        <div className="row between card" style={{ padding: 14 }}>
          <div><b style={{ fontWeight: 500 }}>HR admin</b><div className="hint">Can run contests and manage people, as well as vote.</div></div>
          <Switch checked={f.role === 'admin'} onChange={(v) => setF({ ...f, role: v ? 'admin' : 'employee' })} label="HR admin" />
        </div>
        <div className="row between card" style={{ padding: 14 }}>
          <div><b style={{ fontWeight: 500 }}>Active</b><div className="hint">Switch off for people who have left the company. They can no longer sign in or vote.</div></div>
          <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
        </div>
        {err && <div className="notice bad" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<{ created: number; updated: number; skipped: number; errors: { line: number; error: string }[]; dryRun: boolean } | null>(null);
  const [err, setErr] = useState('');
  const run = useMutation({
    mutationFn: async (dry: boolean) => { const fd = new FormData(); fd.append('file', file!); return api.upload<NonNullable<typeof res>>('POST', `/api/admin/users/import${dry ? '?dryRun=1' : ''}`, fd); },
    onSuccess: (r) => { setRes(r); setErr(''); if (!r.dryRun) { toast(`Imported: ${r.created} added, ${r.updated} updated.`); onDone(); } },
    onError: (e) => setErr(errMsg(e)),
  });
  const choose = (f?: File | null) => { if (f) { setFile(f); setRes(null); setErr(''); } };
  useEffect(() => { if (file) run.mutate(true); }, [file]); // eslint-disable-line
  return (
    <Modal wide title="Import employees from a spreadsheet" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{res && !res.dryRun ? 'Close' : 'Cancel'}</button>{res?.dryRun && <button className="btn btn-primary" disabled={run.isPending || (res.created + res.updated === 0)} onClick={() => run.mutate(false)}>{run.isPending ? <Spinner /> : null} Import {res.created + res.updated} people</button>}</>}>
      <div className="stack">
        <p className="hint">Use an Excel (.xlsx) or CSV file with the columns <b>name, email, team, region</b>. Existing people (matched by email) are updated. People missing from the file are left alone.</p>
        <div className="row"><a className="btn btn-ghost btn-sm" href="/api/admin/users/template.xlsx"><Download size={14} /> Download template</a></div>
        <div className="drop big" onClick={() => ref.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
          <input ref={ref} type="file" hidden accept=".xlsx,.csv" onChange={(e) => choose(e.target.files?.[0])} />
          <UploadCloud size={34} color="var(--brand)" /><b style={{ fontWeight: 500 }}>{file ? file.name : 'Drop the spreadsheet here, or click to choose'}</b>
        </div>
        {run.isPending && !res && <p className="hint"><Spinner /> Checking the file…</p>}
        {err && <div className="notice bad" role="alert">{err}</div>}
        {res && (
          <div className="stack">
            <div className={`notice ${res.dryRun ? '' : 'good'}`}>{res.dryRun ? 'Check before importing: ' : 'Done: '}<b>{res.created}</b> new, <b>{res.updated}</b> to update{res.skipped ? `, ${res.skipped} duplicate rows skipped` : ''}{res.errors.length ? `, ${res.errors.length} rows with problems` : ''}.</div>
            {res.errors.length > 0 && <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}><table className="simple"><thead><tr><th>Row</th><th>Problem (this row will be skipped)</th></tr></thead><tbody>{res.errors.slice(0, 100).map((e) => <tr key={e.line}><td className="num">{e.line}</td><td>{e.error}</td></tr>)}</tbody></table></div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SelectionBar({ count, noun, busy, onDelete, onClear }: { count: number; noun: string; busy: boolean; onDelete: () => void; onClear: () => void }) {
  if (!count) return null;
  return (
    <div className="notice" role="status" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span><b>{count}</b> {noun} selected</span>
      <span className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClear}><X size={14} /> Clear</button>
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete}>{busy ? <Spinner /> : <Trash2 size={14} />} Delete selected</button>
      </span>
    </div>
  );
}

function SkippedNotice({ r, noun, onClose }: { r: BulkResult; noun: string; onClose: () => void }) {
  if (!r.skipped.length) return null;
  return (
    <div className="notice warn" style={{ display: 'block' }} role="status">
      <div className="row between"><b>{r.deleted} deleted, {r.skipped.length} kept:</b><button className="btn-link" onClick={onClose}>Dismiss</button></div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.skipped.slice(0, 20).map((x) => <li key={x.id}>{x.name}: {x.reason}</li>)}</ul>
      {r.skipped.length > 20 && <div className="hint">and {r.skipped.length - 20} more {noun}.</div>}
    </div>
  );
}

function Regions() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['admin-regions'], queryFn: () => api.get<{ regions: Region[] }>('/api/admin/regions') });
  const [code, setCode] = useState(''); const [name, setName] = useState('');
  const [sel, setSel] = useState<string[]>([]); const [skipped, setSkipped] = useState<BulkResult | null>(null);
  const [confirm, confirmNode] = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-regions'] });
  const toggle = useMutation({ mutationFn: (r: Region) => api.put(`/api/admin/regions/${r.code}`, { enabled: !r.enabled }), onSuccess: refresh, onError: (e) => toast(errMsg(e), 'error') });
  const add = useMutation({ mutationFn: () => api.post('/api/admin/regions', { code, name }), onSuccess: () => { setCode(''); setName(''); refresh(); toast('Region added. Switch it on when you are ready.'); }, onError: (e) => toast(errMsg(e), 'error') });
  const del = useMutation({
    mutationFn: (codes: string[]) => api.post<BulkResult>('/api/admin/regions/bulk-delete', { codes }),
    onSuccess: (r) => { setSel([]); setSkipped(r); refresh(); if (r.deleted) toast(`${r.deleted} ${r.deleted === 1 ? 'region' : 'regions'} deleted.`); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  if (q.isLoading) return <PageLoader />;
  const all = q.data!.regions;
  const askDelete = async () => { if (await confirm({ title: `Delete ${sel.length} ${sel.length === 1 ? 'region' : 'regions'}?`, danger: true, confirm: 'Delete', body: 'This cannot be undone. A region that still has people or is used by a contest is kept.' })) del.mutate(sel); };
  return (
    <div className="stack">
      <div className="notice"><Globe2 size={16} style={{ flex: 'none', marginTop: 2 }} /> Each contest is set to one or more regions. Only active employees in those regions can vote and get its emails. At launch only India is switched on.</div>
      <SelectionBar count={sel.length} noun={sel.length === 1 ? 'region' : 'regions'} busy={del.isPending} onDelete={askDelete} onClear={() => setSel([])} />
      {skipped && <SkippedNotice r={skipped} noun="regions" onClose={() => setSkipped(null)} />}
      <div className="table-wrap"><table><thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Select all regions" checked={all.length > 0 && sel.length === all.length} onChange={(e) => setSel(e.target.checked ? all.map((r) => r.code) : [])} /></th><th>Region</th><th>Code</th><th className="right">Active employees</th><th className="right">Switched on</th></tr></thead>
        <tbody>{all.map((r) => <tr key={r.code}><td><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.code)} onChange={(e) => setSel(e.target.checked ? [...sel, r.code] : sel.filter((c) => c !== r.code))} /></td><td><b style={{ fontWeight: 500 }}>{r.name}</b></td><td><span className="badge">{r.code}</span></td><td className="right num">{r.employees}</td><td className="right"><Switch checked={r.enabled} onChange={() => toggle.mutate(r)} label={`${r.name} switched on`} /></td></tr>)}</tbody></table></div>
      <div className="card"><div className="card-h"><h3>Add a region</h3></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Code" htmlFor="rc"><input id="rc" className="input" style={{ width: 100 }} maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SG" /></Field>
          <Field label="Name" htmlFor="rn"><input id="rn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Singapore" /></Field>
          <button className="btn btn-primary" disabled={!code || !name || add.isPending} onClick={() => add.mutate()}><Plus size={15} /> Add</button>
        </div></div>
      {confirmNode}
    </div>
  );
}

export default function Users() {
  const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState<'people' | 'regions'>('people');
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [region, setRegion] = useState(''); const [status, setStatus] = useState(''); const [role, setRole] = useState(''); const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<U | 'new' | null>(null); const [imp, setImp] = useState(false);
  const [sel, setSel] = useState<number[]>([]); const [skipped, setSkipped] = useState<BulkResult | null>(null);
  const [confirm, confirmNode] = useConfirm();
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const regionsQ = useQuery({ queryKey: ['admin-regions'], queryFn: () => api.get<{ regions: Region[] }>('/api/admin/regions') });
  const list = useQuery({ queryKey: ['admin-users', dq, region, status, role, page], placeholderData: keepPreviousData, queryFn: () => api.get<{ total: number; pageSize: number; users: U[]; totals: { active: number; inactive: number; admins: number } }>(`/api/admin/users?q=${encodeURIComponent(dq)}&region=${region}&status=${status}&role=${role}&page=${page}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['admin-regions'] }); };
  const toggleActive = useMutation({ mutationFn: (u: U) => api.put(`/api/admin/users/${u.id}`, { active: !u.active }), onSuccess: refresh, onError: (e) => toast(errMsg(e), 'error') });
  const regions = regionsQ.data?.regions ?? [];
  const del = useMutation({
    mutationFn: (ids: number[]) => api.post<BulkResult>('/api/admin/users/bulk-delete', { ids }),
    onSuccess: (r) => { setSel([]); setSkipped(r); refresh(); if (r.deleted) toast(`${r.deleted} ${r.deleted === 1 ? 'person' : 'people'} deleted.`); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const askDelete = async () => { if (await confirm({ title: `Delete ${sel.length} ${sel.length === 1 ? 'person' : 'people'}?`, danger: true, confirm: 'Delete', body: 'They are removed for good and can no longer sign in. Anyone who has already voted, you, and the last HR admin are kept. To stop someone voting but keep their history, switch them off instead.' })) del.mutate(sel); };
  const resetSel = () => { setSel([]); setSkipped(null); };

  return (
    <>
      <div className="admin-top">
        <div><div className="eyebrow">HR admin</div><h1>Users & regions</h1></div>
        {tab === 'people' && <div className="row"><button className="btn btn-ghost" onClick={() => setImp(true)}><FileSpreadsheet size={16} /> Import spreadsheet</button><button className="btn btn-primary" onClick={() => setEdit('new')}><UserPlus size={16} /> Add person</button></div>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'people', label: 'People', badge: list.data?.totals.active }, { key: 'regions', label: 'Regions' }]} />
      {tab === 'regions' ? <Regions /> : (
        <>
          <div className="toolbar">
            <div className="search"><Search size={16} /><input className="input" placeholder="Search name, email or team" aria-label="Search people" value={q} onChange={(e) => { setQ(e.target.value); resetSel(); }} /></div>
            <select className="input" aria-label="Region" value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); resetSel(); }}><option value="">All regions</option>{regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
            <select className="input" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); resetSel(); }}><option value="">Active and inactive</option><option value="active">Active</option><option value="inactive">Switched off</option></select>
            <select className="input" aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); resetSel(); }}><option value="">Everyone</option><option value="admin">HR admins</option><option value="employee">Employees</option></select>
          </div>
          <SelectionBar count={sel.length} noun={sel.length === 1 ? 'person' : 'people'} busy={del.isPending} onDelete={askDelete} onClear={() => setSel([])} />
          {skipped && <SkippedNotice r={skipped} noun="people" onClose={() => setSkipped(null)} />}
          {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} retry={() => list.refetch()} /> : (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Select everyone on this page" checked={list.data!.users.length > 0 && list.data!.users.every((u) => sel.includes(u.id))} onChange={(e) => setSel(e.target.checked ? list.data!.users.map((u) => u.id) : [])} /></th><th>Name</th><th>Team</th><th>Region</th><th>Last sign-in</th><th className="right">Active</th><th /></tr></thead>
                  <tbody>
                    {list.data!.users.map((u) => (
                      <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                        <td><input type="checkbox" aria-label={`Select ${u.name}`} checked={sel.includes(u.id)} onChange={(e) => setSel(e.target.checked ? [...sel, u.id] : sel.filter((i) => i !== u.id))} /></td>
                        <td><div className="row" style={{ gap: 8 }}><b style={{ fontWeight: 500 }}>{u.name}</b>{u.role === 'admin' && <span className="badge brand"><ShieldCheck size={11} /> HR admin</span>}</div><div className="muted-sm">{u.email}</div></td>
                        <td>{u.team || '—'}</td><td><span className="badge">{u.region}</span></td>
                        <td className="hint">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                        <td className="right"><Switch checked={u.active} onChange={() => toggleActive.mutate(u)} label={`${u.name} active`} /></td>
                        <td className="right"><button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Edit ${u.name}`} onClick={() => setEdit(u)}><Pencil size={15} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {list.data!.users.length === 0 && <Empty icon={<UserPlus size={30} />} title="No people found">Try a different search, or import a spreadsheet to add everyone at once.</Empty>}
              </div>
              <div className="pager"><span className="hint num">{list.data!.total} people · page {page} of {Math.max(1, Math.ceil(list.data!.total / list.data!.pageSize))}</span>
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => { setPage(page - 1); setSel([]); }}>Previous</button>
                <button className="btn btn-ghost btn-sm" disabled={page * list.data!.pageSize >= list.data!.total} onClick={() => { setPage(page + 1); setSel([]); }}>Next</button></div>
            </>
          )}
        </>
      )}
      {edit && regions.length > 0 && <UserModal user={edit === 'new' ? null : edit} regions={regions} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {confirmNode}
      {imp && <ImportModal onClose={() => setImp(false)} onDone={refresh} />}
    </>
  );
}

export { Upload };
