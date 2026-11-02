import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, ArrowLeft, ArrowRight, Check, FileText, Image as ImageIcon, PenLine, Upload, Video, Lock } from 'lucide-react';
import { api } from '../../api';
import type { Contest, EntryType } from '../../types';
import { errMsg, useToast } from '../../lib';
import { Field, PageLoader, Switch } from '../../components/ui';

interface Region { code: string; name: string; enabled: boolean; employees: number }
const TZ_LABEL: Record<string, string> = { 'Asia/Kolkata': 'India time (IST)', UTC: 'UTC', 'Europe/London': 'London', 'America/New_York': 'New York', 'Asia/Dubai': 'Dubai', 'Asia/Singapore': 'Singapore', 'Australia/Sydney': 'Sydney' };
const TYPES: { key: EntryType; label: string; hint: string; icon: any }[] = [
  { key: 'image', label: 'Photo or poster', hint: 'One image per entry', icon: ImageIcon },
  { key: 'writing', label: 'Writing', hint: 'Text pasted by HR', icon: PenLine },
  { key: 'document', label: 'Document', hint: 'PDF or Word (.docx)', icon: FileText },
  { key: 'video', label: 'Video', hint: 'MP4, WebM or MOV', icon: Video },
];

type Scope = 'regional' | 'selected' | 'global';
interface FormState { scope: Scope; name: string; theme: string; description: string; rules: string; entryTypes: EntryType[]; regions: string[]; places: number; timezone: string; announced: boolean; endLocal: string }
const blank: FormState = { scope: 'regional', name: '', theme: '', description: '', rules: '', entryTypes: ['image'], regions: ['IN'], places: 3, timezone: 'Asia/Kolkata', announced: false, endLocal: '' };
const fromContest = (c: Contest): FormState => ({ scope: c.scope, name: c.name, theme: c.theme, description: c.description, rules: c.rules, entryTypes: c.entryTypes, regions: c.regions, places: c.places, timezone: c.timezone, announced: c.announced, endLocal: c.endLocal });

function BannerPicker({ current, file, onFile, disabled }: { current?: string | null; file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : current || null), [file, current]);
  return (
    <div>
      <div className="banner-prev" style={url ? { backgroundImage: `url(${url})` } : undefined}>{!url && 'No banner yet. A generic trophy design is shown instead.'}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => ref.current?.click()}><Upload size={14} /> {url ? 'Change banner' : 'Upload banner'}</button>
        {file && <button type="button" className="btn-link" onClick={() => onFile(null)}>Undo</button>}
        <span className="hint">Wide image, at least 1600 px across. It is shown behind the contest title.</span>
      </div>
    </div>
  );
}

export default function ContestForm({ contest, timezones }: { contest?: Contest; timezones?: string[] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const edit = !!contest;
  const locked = edit && contest!.status !== 'draft'; // live: wording only
  const finished = edit && ['closed', 'published'].includes(contest!.status);
  const [f, setF] = useState<FormState>(contest ? fromContest(contest) : blank);
  const [step, setStep] = useState(0);
  const [banner, setBanner] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const regions = useQuery({ queryKey: ['admin-regions'], queryFn: () => api.get<{ regions: Region[] }>('/api/admin/regions') });
  useEffect(() => { if (contest) setF(fromContest(contest)); }, [contest]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };

  function validate(upTo: number) {
    const e: Record<string, string> = {};
    if (upTo >= 0 && f.name.trim().length < 2) e.name = 'Give the contest a name.';
    if (upTo >= 0 && !f.description.trim()) e.description = 'Add a short description so employees know what it is about.';
    if (upTo >= 1 && !f.entryTypes.length) e.entryTypes = 'Choose at least one entry type.';
    if (upTo >= 1 && f.scope !== 'global' && !f.regions.length) e.regions = 'Choose at least one region.';
    if (upTo >= 1 && f.scope === 'regional' && f.regions.length > 1) e.regions = 'A regional contest has one region. Use Selected regions for several.';
    if (upTo >= 2 && f.endLocal && new Date(f.endLocal) < new Date(Date.now() - 864e5)) e.endLocal = 'The end date is in the past.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const save = useMutation({
    mutationFn: async () => {
      let id = contest?.id;
      const body = { ...f, endLocal: f.endLocal || null };
      if (edit) await api.put(`/api/admin/contests/${id}`, body);
      else id = (await api.post<{ id: number }>('/api/admin/contests', body)).id;
      if (banner) { const fd = new FormData(); fd.append('file', banner); await api.upload('POST', `/api/admin/contests/${id}/banner`, fd); }
      return id!;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['admin-contest', String(id)] }); qc.invalidateQueries({ queryKey: ['admin-contests'] });
      toast(edit ? 'Saved.' : 'Contest created. Now add the entries.');
      if (!edit) nav(`/admin/contests/${id}/entries`);
      setBanner(null);
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const regionList = regions.data?.regions ?? [];

  const basics = (
    <div className="stack">
      <Field label="Contest name" error={errors.name} htmlFor="c-name"><input id="c-name" className="input" value={f.name} disabled={locked} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Photography Contest, November" /></Field>
      <Field label="Theme" htmlFor="c-theme" hint="Shown under the name on the contest page and in emails."><input id="c-theme" className="input" value={f.theme} disabled={finished} onChange={(e) => set('theme', e.target.value)} placeholder="e.g. A day at work, through your lens" /></Field>
      <Field label="Short description" error={errors.description} htmlFor="c-desc"><textarea id="c-desc" className="input" value={f.description} disabled={finished} aria-invalid={!!errors.description} onChange={(e) => set('description', e.target.value)} placeholder="What is this contest about?" /></Field>
      <Field label="Rules" htmlFor="c-rules" hint="Optional. Shown on the contest page."><textarea id="c-rules" className="input" rows={4} value={f.rules} disabled={finished} onChange={(e) => set('rules', e.target.value)} /></Field>
      {!edit || !finished ? <Field label="Banner image"><BannerPicker current={contest?.bannerUrl} file={banner} onFile={setBanner} /></Field> : null}
    </div>
  );

  const audience = (
    <div className="stack">
      <Field label="What kind of entries?" error={errors.entryTypes} hint="You can allow more than one kind.">
        <div className="type-grid">
          {TYPES.map((t) => (
            <button type="button" key={t.key} className="type-card" disabled={locked} aria-pressed={f.entryTypes.includes(t.key)} onClick={() => set('entryTypes', toggle(f.entryTypes, t.key))}>
              <t.icon size={22} /><div><b>{t.label}</b><span>{t.hint}</span></div>
              {f.entryTypes.includes(t.key) && <Check size={16} style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Who takes part?" hint="Everyone at Lumovy can see the contest and its results. Only employees in the regions below can vote and get its emails.">
        <div className="type-grid" role="radiogroup" aria-label="Contest reach">
          {([['regional', 'Regional', 'One region, e.g. India only'], ['selected', 'Selected regions', 'Pick two or more regions'], ['global', 'Global', 'Every region that is switched on']] as [Scope, string, string][]).map(([k, label, hint]) => (
            <button type="button" key={k} role="radio" aria-checked={f.scope === k} aria-pressed={f.scope === k} className="type-card" disabled={locked}
              onClick={() => setF((s) => ({ ...s, scope: k, regions: k === 'global' ? [] : k === 'regional' ? s.regions.slice(0, 1).length ? s.regions.slice(0, 1) : ['IN'] : s.regions }))}>
              <Globe2 size={22} /><div><b>{label}</b><span>{hint}</span></div>{f.scope === k && <Check size={16} style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
        </div>
      </Field>
      {f.scope !== 'global' && <Field label={f.scope === 'regional' ? 'Region' : 'Regions'} error={errors.regions} hint="Switch on more regions under Users & regions.">
        <div className="chips" role="group" aria-label="Regions">
          {regionList.map((r) => (
            <button type="button" key={r.code} className="chip" disabled={locked || !r.enabled} aria-pressed={f.regions.includes(r.code)} onClick={() => set('regions', f.scope === 'regional' ? [r.code] : toggle(f.regions, r.code))} title={r.enabled ? '' : 'Switch this region on under Users & regions first'}>
              {r.name} <span className="muted num">({r.employees})</span>{!r.enabled && ' · off'}
            </button>
          ))}
        </div>
      </Field>}
      <Field label="Places to vote for" hint="Each voter ranks this many different entries. 1st gets the most points.">
        <select className="input" style={{ maxWidth: 200 }} value={f.places} disabled={locked} onChange={(e) => set('places', Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 3 ? ' (default)' : ''}</option>)}
        </select>
      </Field>
    </div>
  );

  const schedule = (
    <div className="stack">
      <div className="notice"><Lock size={16} style={{ flex: 'none', marginTop: 2 }} /> Voting does not open on a date. It opens the moment you click <b>Start contest</b>, after all entries are uploaded. It closes by itself at the time below.</div>
      <div className="form-row">
        <Field label="Voting ends" error={errors.endLocal} htmlFor="c-end" hint={locked && !finished ? 'To change the deadline while voting is open, use “Extend deadline” on the contest page.' : undefined}>
          <input id="c-end" type="datetime-local" className="input" value={f.endLocal} disabled={locked} aria-invalid={!!errors.endLocal} onChange={(e) => set('endLocal', e.target.value)} />
        </Field>
        <Field label="Time zone" htmlFor="c-tz">
          <select id="c-tz" className="input" value={f.timezone} disabled={locked} onChange={(e) => set('timezone', e.target.value)}>
            {(timezones ?? Object.keys(TZ_LABEL)).map((z) => <option key={z} value={z}>{TZ_LABEL[z] ?? z}</option>)}
          </select>
        </Field>
      </div>
      <div className="row between card" style={{ padding: 14 }}>
        <div><b style={{ fontWeight: 500 }}>Show as “Coming soon” to employees</b><div className="hint">Lets people see the contest name and theme before voting opens. Entries stay hidden.</div></div>
        <Switch checked={f.announced} onChange={(v) => set('announced', v)} label="Show as coming soon" disabled={locked} />
      </div>
    </div>
  );

  if (edit) {
    return (
      <div className="stack">
        {finished && <div className="notice warn"><Lock size={16} style={{ flex: 'none' }} /> This contest has finished, so its details are locked.</div>}
        {locked && !finished && <div className="notice warn"><Lock size={16} style={{ flex: 'none' }} /> Voting is open. Only the theme, description and rules can still be changed.</div>}
        <section className="card"><div className="card-h"><h3>Basics</h3></div>{basics}</section>
        <section className="card"><div className="card-h"><h3>Entries and audience</h3></div>{audience}</section>
        <section className="card"><div className="card-h"><h3>Schedule</h3></div>{schedule}</section>
        {!finished && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={save.isPending} onClick={() => validate(2) && save.mutate()}>Save changes</button></div>}
      </div>
    );
  }

  const steps = ['Basics', 'Entries & audience', 'Schedule'];
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="crumbs"><Link to="/admin/contests"><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Contests</Link></div>
      <div className="admin-top"><div><h1>New contest</h1><p className="hint">Three quick steps. You can change everything until you start the contest.</p></div></div>
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <div key={s} className={`step ${i < step ? 'done' : i === step ? 'now' : ''}`}><i>{i < step ? <Check size={14} /> : i + 1}</i>{s}</div>
        ))}
      </div>
      <section className="card">{step === 0 ? basics : step === 1 ? audience : schedule}</section>
      <div className="row between">
        <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={15} /> Back</button>
        {step < 2
          ? <button className="btn btn-primary" onClick={() => validate(step) && setStep(step + 1)}>Next <ArrowRight size={15} /></button>
          : <button className="btn btn-accent" disabled={save.isPending} onClick={() => validate(2) && save.mutate()}>Create contest</button>}
      </div>
    </div>
  );
}

export function ContestFormLoader({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin-contest', id], queryFn: () => api.get<{ contest: Contest; timezones: string[] }>(`/api/admin/contests/${id}`) });
  if (!q.data) return <PageLoader />;
  return <ContestForm contest={q.data.contest} timezones={q.data.timezones} />;
}
