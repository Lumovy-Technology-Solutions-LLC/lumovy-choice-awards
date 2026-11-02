import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Mail, RotateCcw, Save, Send } from 'lucide-react';
import { api } from '../../api';
import type { Contest } from '../../types';
import { errMsg, useToast, useAuth } from '../../lib';
import { ErrorState, Field, PageLoader, Spinner } from '../../components/ui';

interface Tpl { key: string; label: string; sentTo: string; when: string; tokens: string[]; subject: string; body: string; custom: boolean; defaultSubject: string; defaultBody: string; sent: number }
const TOKEN_HELP: Record<string, string> = { name: 'Employee’s name', contest_name: 'Contest name', theme: 'Theme', deadline: 'Voting end time', vote_link: 'Vote now button', results_link: 'Results button', picks: 'Their three picks', winners: 'Top 3 winners' };

export default function EmailsTab({ c }: { c: Contest }) {
  const qc = useQueryClient(); const toast = useToast(); const { user } = useAuth();
  const q = useQuery({ queryKey: ['admin-emails', c.id], queryFn: () => api.get<{ templates: Tpl[] }>(`/api/admin/contests/${c.id}/emails`) });
  const [key, setKey] = useState('contest_started');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const t = q.data?.templates.find((x) => x.key === key);

  useEffect(() => { if (t) { setSubject(t.subject); setBody(t.body); setPreview(null); } }, [t?.key, t?.subject, t?.body]); // eslint-disable-line
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => api.post<{ subject: string; html: string }>(`/api/admin/contests/${c.id}/emails/preview`, { key, subject, body }).then(setPreview).catch(() => {}), 350);
    return () => clearTimeout(h);
  }, [key, subject, body, c.id, !!t]); // eslint-disable-line

  const dirty = !!t && (subject !== t.subject || body !== t.body);
  const save = useMutation({ mutationFn: () => api.put(`/api/admin/contests/${c.id}/emails/${key}`, { subject, body }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-emails', c.id] }); toast('Email wording saved.'); }, onError: (e) => toast(errMsg(e), 'error') });
  const reset = useMutation({ mutationFn: () => api.del(`/api/admin/contests/${c.id}/emails/${key}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-emails', c.id] }); toast('Back to the standard wording.'); }, onError: (e) => toast(errMsg(e), 'error') });
  const test = useMutation({ mutationFn: () => api.post<{ sentTo: string }>(`/api/admin/contests/${c.id}/emails/${key}/test`, { subject, body }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['outbox'] }); toast(`Test email sent to ${r.sentTo} only.`); }, onError: (e) => toast(errMsg(e), 'error') });

  function insert(tok: string) {
    const el = ta.current; const s = `{{${tok}}}`;
    if (!el) { setBody((b) => b + s); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    setBody(body.slice(0, a) + s + body.slice(b));
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = a + s.length; }, 0);
  }

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(240px,320px) minmax(0,1fr)', alignItems: 'start' }}>
      <div className="stack" style={{ gap: 8 }} role="tablist" aria-label="Email templates">
        {q.data!.templates.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === key} onClick={() => setKey(x.key)} className="link-card" style={{ textAlign: 'left', borderColor: x.key === key ? 'var(--brand)' : undefined, boxShadow: x.key === key ? '0 0 0 3px var(--brand-soft)' : undefined }}>
            <Mail size={18} color="var(--brand)" style={{ flex: 'none' }} />
            <div className="grow"><b style={{ fontWeight: 600 }}>{x.label}</b><div className="hint">{x.sentTo}</div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>{x.custom && <span className="badge brand">Edited</span>}{x.sent > 0 && <span className="badge good">{x.sent} sent</span>}</div></div>
          </button>
        ))}
        <p className="hint" style={{ padding: '4px 6px' }}>Nothing is sent until you click Start contest. The reminder and deadline emails are optional and only sent when you choose.</p>
      </div>

      {t && (
        <div className="stack">
          <div className="card">
            <div className="card-h"><div><h3>{t.label}</h3><div className="hint">Sent to: {t.sentTo}. When: {t.when}.</div></div></div>
            <div className="stack">
              <Field label="Subject" htmlFor="m-sub"><input id="m-sub" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
              <Field label="Message" htmlFor="m-body" hint="Leave a blank line between paragraphs. Insert details with the buttons below.">
                <textarea id="m-body" ref={ta} className="input" rows={11} value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              <div className="chips" aria-label="Insert a detail">
                <span className="hint" style={{ alignSelf: 'center' }}>Insert:</span>
                {t.tokens.map((tok) => <button key={tok} className="token" onClick={() => insert(tok)} title={TOKEN_HELP[tok]}>{`{{${tok}}}`}</button>)}
              </div>
              <div className="row between">
                <div className="row">
                  <button className="btn btn-ghost btn-sm" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <Spinner /> : <Send size={14} />} Send test to me</button>
                  {t.custom && <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('Go back to the standard wording?')) reset.mutate(); }}><RotateCcw size={14} /> Reset wording</button>}
                </div>
                <button className="btn btn-primary btn-sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save size={14} /> Save wording</button>
              </div>
              <p className="hint">Test emails go only to you ({user?.email}).</p>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3><Eye size={16} style={{ verticalAlign: -3 }} /> Preview</h3></div>
            {preview && <><p className="hint" style={{ marginBottom: 8 }}>Subject: <b>{preview.subject}</b></p><div className="mail-prev"><iframe title="Email preview" sandbox="" srcDoc={preview.html} /></div></>}
          </div>
        </div>
      )}
    </div>
  );
}
