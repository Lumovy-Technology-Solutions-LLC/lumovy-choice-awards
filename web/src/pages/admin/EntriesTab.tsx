import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, FileText, Image as ImageIcon, Lock, Pencil, PenLine, Plus, Trash2, Upload, UploadCloud, Video } from 'lucide-react';
import { api } from '../../api';
import type { Contest, Entry } from '../../types';
import { errMsg, useToast } from '../../lib';
import { Empty, ErrorState, Field, Modal, PageLoader, Spinner, useConfirm } from '../../components/ui';

const ACCEPT: Record<string, string> = { image: '.jpg,.jpeg,.png,.webp,.gif', document: '.pdf,.docx', video: '.mp4,.webm,.mov,.m4v' };
const ICON = { image: ImageIcon, writing: PenLine, document: FileText, video: Video } as const;
const fmtSize = (n?: number) => (n ? (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`) : '');

function EntryEditor({ c, entry, onClose, onSaved }: { c: Contest; entry: Entry | null; onClose: () => void; onSaved: (savedId?: number) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const canWrite = c.entryTypes.includes('writing');
  const fileTypes = c.entryTypes.filter((t) => t !== 'writing');
  const isWriting = entry ? entry.type === 'writing' : false;
  const [mode, setMode] = useState<'file' | 'text'>(entry ? (isWriting ? 'text' : 'file') : fileTypes.length ? 'file' : 'text');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [desc, setDesc] = useState(entry?.description ?? '');
  const [alt, setAlt] = useState(entry?.altText ?? '');
  const [who, setWho] = useState(entry?.competitorName ?? '');
  const [body, setBody] = useState(entry?.body ?? '');
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const accept = fileTypes.map((t) => ACCEPT[t]).join(',');
  const previewUrl = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !desc.trim()) throw new Error('Add a title and a short description (without naming the entrant).');
      if (!who.trim()) throw new Error('Enter the competitor’s name. It stays hidden from voters until results are published.');
      if (!entry && mode === 'file' && !file) throw new Error('Choose a file to upload.');
      if (mode === 'text' && !body.trim()) throw new Error('Paste the writing.');
      const fd = new FormData();
      fd.append('title', title); fd.append('description', desc); fd.append('altText', alt); fd.append('competitorName', who);
      if (mode === 'text') fd.append('body', body);
      if (file && mode === 'file') fd.append('file', file);
      if (entry) return api.upload<{ id: number }>('PUT', `/api/admin/entries/${entry.id}`, fd).then(() => ({ id: entry.id }));
      return api.upload<{ id: number }>('POST', `/api/admin/contests/${c.id}/entries`, fd);
    },
    onSuccess: (r) => { toast(entry ? 'Entry saved.' : 'Entry added.'); onSaved(r.id); },
    onError: (e) => setErr(errMsg(e)),
  });

  const pick = (f?: File | null) => { if (f) { setFile(f); setErr(''); } };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); };
  const showAlt = (entry ? entry.type === 'image' : file?.type.startsWith('image/')) || false;

  return (
    <Modal wide title={entry ? `Edit ${entry.label}` : 'Add an entry'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending} onClick={() => { setErr(''); save.mutate(); }}>{save.isPending ? <Spinner /> : null} {entry ? 'Save entry' : 'Add entry'}</button></>}>
      <div className="stack">
        {!entry && canWrite && fileTypes.length > 0 && (
          <div className="chips" role="group" aria-label="Entry source">
            <button className="chip" aria-pressed={mode === 'file'} onClick={() => setMode('file')}><Upload size={13} style={{ verticalAlign: -2 }} /> Upload a file</button>
            <button className="chip" aria-pressed={mode === 'text'} onClick={() => setMode('text')}><PenLine size={13} style={{ verticalAlign: -2 }} /> Paste writing</button>
          </div>
        )}
        {mode === 'file' ? (
          <div>
            <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
              onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()} aria-label="Choose or drop a file">
              <input ref={fileRef} type="file" hidden accept={accept} onChange={(e) => pick(e.target.files?.[0])} />
              {previewUrl ? <img src={previewUrl} alt="Preview" /> : entry && !file && entry.thumbUrl ? <img src={entry.thumbUrl} alt={entry.altText || 'Current file'} /> : <UploadCloud size={32} color="var(--brand)" />}
              <b style={{ fontWeight: 500 }}>{file ? file.name : entry ? `Current file: ${entry.fileName}. Drop a new one to replace it.` : 'Drop the file here, or click to choose'}</b>
              <span className="hint">{c.entryTypes.filter((t) => t !== 'writing').map((t) => ({ image: 'Photo or poster', document: 'PDF or Word', video: 'Video' }[t])).join(' · ')} · up to 100 MB · hidden details such as author names are removed automatically</span>
            </div>
          </div>
        ) : (
          <Field label="The writing" htmlFor="e-body" hint="Paste the text exactly as submitted. Do not include the author’s name."><textarea id="e-body" className="input" rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        )}
        <div className="form-row">
          <Field label="Title" htmlFor="e-title" hint="Shown to voters"><input id="e-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
          <Field label="Competitor’s name" htmlFor="e-who" hint={<span className="hidden-name"><EyeOff size={13} /> Hidden from voters everywhere until results are published</span>}><input id="e-who" className="input" value={who} onChange={(e) => setWho(e.target.value)} maxLength={160} /></Field>
        </div>
        <Field label="Short description" htmlFor="e-desc" hint="A line about the work. Do not name the entrant."><textarea id="e-desc" className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} /></Field>
        {showAlt && <Field label="Image description (alt text)" htmlFor="e-alt" hint="Read aloud by screen readers. Describe what is in the picture."><input id="e-alt" className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} /></Field>}
        {err && <div className="notice bad" role="alert"><AlertCircle size={16} style={{ flex: 'none', marginTop: 2 }} /> {err}</div>}
      </div>
    </Modal>
  );
}

export default function EntriesTab({ c }: { c: Contest }) {
  const qc = useQueryClient(); const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const q = useQuery({ queryKey: ['admin-entries', c.id], queryFn: () => api.get<{ locked: boolean; entries: Entry[] }>(`/api/admin/contests/${c.id}/entries`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-entries', c.id] }); qc.invalidateQueries({ queryKey: ['admin-contest', String(c.id)] }); };
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/admin/entries/${id}`), onSuccess: () => { refresh(); toast('Entry removed.'); }, onError: (e) => toast(errMsg(e), 'error') });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { locked, entries } = q.data!;
  const incomplete = entries.filter((e) => !e.complete || !e.competitorName?.trim());

  return (
    <div className="stack">
      {locked ? <div className="notice warn"><Lock size={16} style={{ flex: 'none' }} /> Voting has started, so entries are locked and cannot be edited or removed.</div>
        : <div className="notice"><EyeOff size={16} style={{ flex: 'none', marginTop: 2 }} /> Competitor names are saved against each entry but stay hidden from voters on every screen, file and email until you publish the results. You can edit or remove entries until you start the contest.</div>}
      <div className="row between">
        <div className="hint num">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}{incomplete.length ? ` · ${incomplete.length} need details` : ''}</div>
        <div className="row">
          <Link className="btn btn-ghost btn-sm" to={`/admin/contests/${c.id}/preview`}><Eye size={15} /> See it as an employee</Link>
          {!locked && <>
            <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus size={15} /> Add entry</button>
          </>}
        </div>
      </div>

      {entries.length === 0 ? (
        <Empty icon={<UploadCloud size={32} />} title="No entries yet" action={!locked ? <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Add the first entry</button> : undefined}>
          Employees send their entries to HR. Upload them here, one at a time. Each gets a permanent entry number.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {entries.map((e) => {
            const Icon = ICON[e.type];
            return (
              <div className="entry-admin" key={e.id}>
                {e.thumbUrl ? <img className="th" src={e.thumbUrl} alt={e.altText || ''} loading="lazy" /> : <div className="th"><Icon size={26} /></div>}
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}><span className="pill pill-pub">{e.label}</span><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || <span className="warn-dot">Needs a title</span>}</b></div>
                  <div className="hint" style={{ margin: '4px 0', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{e.description || <span className="warn-dot">Needs a description</span>}</div>
                  <div className="meta">
                    <span className="hidden-name"><EyeOff size={12} /> {e.competitorName?.trim() ? <>{e.competitorName} <small>hidden</small></> : <span className="warn-dot">Needs competitor name</span>}</span>
                    <span>{{ image: 'Photo', writing: 'Writing', document: e.fileName?.endsWith('.pdf') ? 'PDF' : 'Word', video: 'Video' }[e.type]}{e.pageCount ? ` · ${e.pageCount} pp` : ''}{e.size ? ` · ${fmtSize(e.size)}` : ''}</span>
                  </div>
                </div>
                {!locked && <div className="acts row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}><Pencil size={14} /> Edit</button>
                  <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Remove ${e.label}`} onClick={async () => { if (await confirm({ title: `Remove ${e.label}?`, danger: true, confirm: 'Remove entry', body: 'The entry and its file are deleted. Its number is not reused.' })) del.mutate(e.id); }}><Trash2 size={15} /></button>
                </div>}
              </div>
            );
          })}
        </div>
      )}

      {editing && <EntryEditor key={editing === 'new' ? 'new' : editing.id} c={c} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); }} />}
      {confirmNode}
    </div>
  );
}
