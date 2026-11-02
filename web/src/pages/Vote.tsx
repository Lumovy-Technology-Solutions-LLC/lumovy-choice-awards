import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Eye, HelpCircle, Lock, Mail, Save, Send, TriangleAlert, FileText, Video, PenLine, Image as ImageIcon } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Contest, Entry, Pick } from '../types';
import { errMsg, ordinal, useToast } from '../lib';
import { Countdown, Empty, ErrorState, Medal, Modal, PageLoader } from '../components/ui';
import EntryViewer, { EntryThumb } from '../components/EntryViewer';
import { HowItWorks } from './Home';

interface EntriesRes { serverTime: string; contest: Contest; entries: Entry[] }
interface Ballot { status: 'draft' | 'submitted'; picks: any[]; submittedAt?: string }
const RANK_CLASS = ['', 'r1', 'r2', 'r3'];
const TYPE_ICON = { image: ImageIcon, writing: PenLine, document: FileText, video: Video } as const;

function Receipt({ contest, picks }: { contest: Contest; picks: { rank: number; entry: Entry }[] }) {
  return (
    <div className="receipt">
      <div className="success">
        <div className="check"><CheckCircle2 size={40} /></div>
        <h1 style={{ fontSize: 28, fontWeight: 600 }}>Thanks, your vote is in</h1>
        <p style={{ opacity: 0.85, marginTop: 6 }}>{contest.name}</p>
      </div>
      <div className="card">
        <div className="card-h"><h3>Your picks</h3><span className="badge"><Lock size={12} /> Final</span></div>
        <div className="review-list">
          {[...picks].sort((a, b) => a.rank - b.rank).map((p) => (
            <div className="review-item" key={p.rank}>
              <Medal rank={p.rank} />
              {p.entry.thumbUrl ? <img src={p.entry.thumbUrl} alt="" /> : <div className="thumb-ph" style={{ width: 64, height: 48 }}><FileText size={18} /></div>}
              <div className="grow"><b>{p.entry.label}</b><div className="hint">{p.entry.title}</div></div>
              <span className="pts">{ordinal(p.rank)} place</span>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 14 }}><Mail size={13} style={{ verticalAlign: -2 }} /> We have emailed you a copy. Votes cannot be changed once submitted.</p>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" to={`/contests/${contest.id}`}>Back to contest</Link></div>
    </div>
  );
}

export default function Vote({ preview = false }: { preview?: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const base = preview ? `/api/admin/contests/${id}` : `/api/portal/contests/${id}`;

  const entriesQ = useQuery({
    queryKey: [preview ? 'preview' : 'entries', id],
    queryFn: () => api.get<EntriesRes>(preview ? `${base}/preview` : `${base}/entries`),
    retry: false, refetchOnWindowFocus: !preview,
  });
  const ballotQ = useQuery({ queryKey: ['ballot', id], enabled: !preview, queryFn: () => api.get<Ballot>(`${base}/ballot`), retry: false });

  const [picks, setPicks] = useState<Record<number, number>>({}); // rank -> entryId
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<Entry | null>(null);
  const [review, setReview] = useState(false);
  const [how, setHow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ rank: number; entry: Entry }[] | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [closedMsg, setClosedMsg] = useState(false);

  useEffect(() => {
    if (loaded || !ballotQ.data) return;
    if (ballotQ.data.status === 'draft') {
      const m: Record<number, number> = {};
      (ballotQ.data.picks as Pick[]).forEach((p) => { m[p.rank] = p.entryId; });
      setPicks(m);
    }
    setLoaded(true);
  }, [ballotQ.data, loaded]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const entries = entriesQ.data?.entries ?? [];
  const contest = entriesQ.data?.contest;
  const places = contest?.places ?? 3;
  const rankOf = useMemo(() => { const m = new Map<number, number>(); Object.entries(picks).forEach(([r, e]) => m.set(e, Number(r))); return m; }, [picks]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const count = Object.keys(picks).length;

  const setRank = useCallback((entryId: number, rank: number) => {
    setPicks((cur) => {
      const next = { ...cur };
      if (next[rank] === entryId) { delete next[rank]; return next; }
      for (const [r, e] of Object.entries(next)) if (e === entryId) delete next[Number(r)];
      next[rank] = entryId;
      return next;
    });
    setDirty(true);
  }, []);
  const clearRank = (rank: number) => { setPicks((c) => { const n = { ...c }; delete n[rank]; return n; }); setDirty(true); };

  const pickList: Pick[] = Object.entries(picks).map(([r, e]) => ({ rank: Number(r), entryId: e }));

  async function saveForLater() {
    if (preview) { toast('Preview only: nothing is saved.'); return; }
    setSaving(true);
    try { await api.put(`${base}/ballot`, { picks: pickList }); setDirty(false); setSavedAt(new Date()); toast('Saved. Your picks will be here when you come back.'); }
    catch (e) { handleClosed(e) || toast(errMsg(e), 'error'); } finally { setSaving(false); }
  }
  function handleClosed(e: unknown) {
    if (e instanceof ApiError && (e.code === 'closed' || e.code === 'not_live')) { setClosedMsg(true); setReview(false); qc.invalidateQueries(); return true; }
    if (e instanceof ApiError && e.code === 'already_voted') { qc.invalidateQueries({ queryKey: ['ballot', id] }); setReview(false); return true; }
    return false;
  }
  async function submit() {
    if (preview) { toast('This is a preview. Employees will submit here.'); setReview(false); return; }
    setSubmitting(true);
    try {
      const r = await api.post<{ ballot: { picks: { rank: number; entry: Entry }[] } }>(`${base}/vote`, { picks: pickList });
      setDirty(false); setReview(false); setReceipt(r.ballot.picks);
      qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['contest'] });
    } catch (e) { if (!handleClosed(e)) toast(errMsg(e), 'error'); setReview(false); } finally { setSubmitting(false); }
  }
  const onTimeUp = useCallback(() => {
    if (preview) return;
    setClosedMsg(true); setReview(false); setDirty(false);
    qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['contest'] });
  }, [preview, qc]);

  // ----- states -----
  if (entriesQ.isLoading || (!preview && ballotQ.isLoading)) return <div className="wrap"><PageLoader label="Loading entries…" /></div>;

  const submittedBallot = ballotQ.data?.status === 'submitted' ? ballotQ.data : null;
  if (!preview && (receipt || submittedBallot)) {
    const c = contest ?? ({ id: Number(id), name: 'Your vote' } as Contest);
    return <div className="wrap"><Receipt contest={c} picks={receipt ?? submittedBallot!.picks} /></div>;
  }
  if (entriesQ.isError) {
    const e = entriesQ.error as ApiError;
    if (e.code === 'not_eligible') {
      return (
        <div className="wrap"><Empty icon={<Lock size={30} />} title="Not open to your region" action={<Link className="btn btn-primary" to={`/contests/${id}`}>Back to contest</Link>}>
          {e.message}</Empty></div>
      );
    }
    if (e.code === 'not_live') {
      return (
        <div className="wrap"><Empty icon={<Lock size={30} />} title="Voting is not open" action={<Link className="btn btn-primary" to={`/contests/${id}`}>Back to contest</Link>}>
          Entries can only be seen while voting is open. If voting has closed, results will be published on the contest page.</Empty></div>
      );
    }
    return <div className="wrap"><ErrorState error={e} retry={() => entriesQ.refetch()} /></div>;
  }
  if (closedMsg) {
    return (
      <div className="wrap"><Empty icon={<Lock size={30} />} title="Voting has closed" action={<Link className="btn btn-primary" to={`/contests/${id}`}>Back to contest</Link>}>
        The end time has passed, so votes can no longer be submitted. Picks that were saved but not submitted do not count.</Empty></div>
    );
  }
  if (!contest) return null;

  const types = [...new Set(entries.map((e) => e.type))];
  const shown = filter === 'all' ? entries : entries.filter((e) => e.type === filter);
  const slotEntry = (rank: number) => (picks[rank] ? byId.get(picks[rank]) : undefined);
  const complete = count === places;

  return (
    <div className="wrap">
      {preview && (
        <div className="preview-banner" role="note">
          <Eye size={18} /> <span className="grow">Preview: this is exactly what employees will see. Nothing you do here is saved or counted.</span>
          <Link className="btn btn-sm btn-ghost" to={`/admin/contests/${id}/entries`}><ArrowLeft size={14} /> Back to entries</Link>
        </div>
      )}
      <div className="vote-head">
        <div>
          {!preview && <Link to={`/contests/${id}`} className="hint row" style={{ gap: 4, marginBottom: 6 }}><ArrowLeft size={14} /> {contest.name}</Link>}
          <h1>Pick your top {places}</h1>
          <p className="hint" style={{ marginTop: 4 }}>{entries.length} entries · names are hidden so you vote for the work.</p>
        </div>
        <div className="row">
          {contest.status === 'live' || preview ? <Countdown compact endAt={contest.endAt} serverTime={entriesQ.data?.serverTime} onDone={onTimeUp} /> : null}
          <button className="btn btn-ghost btn-sm" onClick={() => setHow(true)}><HelpCircle size={15} /> How it works</button>
        </div>
      </div>
      <div className="howto" style={{ marginBottom: 14 }}>
        <span><b>1st</b> = {places} points</span><span><b>2nd</b> = {places - 1} points</span><span><b>3rd</b> = 1 point</span><span>Tap a card to see it larger</span>
      </div>
      {types.length > 1 && (
        <div className="chips" role="group" aria-label="Filter entries by type" style={{ marginBottom: 16 }}>
          <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({entries.length})</button>
          {types.map((t) => <button key={t} className="chip" aria-pressed={filter === t} onClick={() => setFilter(t)}>{{ image: 'Photos & posters', writing: 'Writing', document: 'Documents', video: 'Videos' }[t]}</button>)}
        </div>
      )}

      {entries.length === 0 ? (
        <Empty icon={<ImageIcon size={30} />} title="No entries yet">Upload entries in the HR admin area to see them here.</Empty>
      ) : (
        <div className="gallery">
          {shown.map((e) => {
            const r = rankOf.get(e.id);
            const TypeIcon = TYPE_ICON[e.type];
            return (
              <article key={e.id} className={`entry ${r ? 'picked' : ''}`} aria-label={`${e.label}: ${e.title}`}>
                <button className="entry-img entry-btn" onClick={() => setView(e)} aria-label={`Open ${e.label}: ${e.title}`}>
                  <EntryThumb entry={e} />
                  <span className="entry-no">{e.label}</span>
                  {e.type !== 'image' && <span className="entry-type-tag"><TypeIcon size={12} />{{ writing: 'Writing', document: 'Document', video: 'Video', image: '' }[e.type]}</span>}
                  {r && <span className={`rank-badge ${RANK_CLASS[r] || 'r3'}`} aria-hidden>{ordinal(r)}</span>}
                </button>
                <div className="entry-body">
                  <div className="entry-title">{e.title}</div>
                  <p className="entry-desc">{e.description}</p>
                  <div className="rank-row" role="group" aria-label={`Place for ${e.label}`}>
                    {Array.from({ length: places }, (_, i) => i + 1).map((rk) => (
                      <button key={rk} aria-pressed={r === rk} onClick={() => setRank(e.id, rk)} aria-label={`${ordinal(rk)} place for ${e.label}${r === rk ? ' (selected)' : ''}`}>{ordinal(rk)}</button>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {entries.length > 0 && (
        <div className="ballot" role="region" aria-label="Your ballot">
          <div className="slots">
            {Array.from({ length: places }, (_, i) => i + 1).map((rk) => {
              const e = slotEntry(rk);
              return (
                <button key={rk} className={`slot ${e ? 'filled' : 'slot-empty'}`} onClick={() => (e ? clearRank(rk) : undefined)} aria-label={e ? `${ordinal(rk)}: ${e.label}. Remove` : `${ordinal(rk)} place: empty`} title={e ? 'Click to remove' : undefined}>
                  <span className={`slot-ic ${RANK_CLASS[rk] || 'r3'}`}>{ordinal(rk)}</span>
                  <span className="slot-t"><b>{e ? e.label : 'Empty'}</b><span>{e ? e.title : `Pick ${ordinal(rk)}`}</span></span>
                </button>
              );
            })}
          </div>
          <div className="ballot-actions">
            {savedAt && !dirty && <span className="saved-note">Saved</span>}
            <button className="btn btn-glass" onClick={saveForLater} disabled={saving || (!preview && count === 0)}><Save size={15} /> Save for later</button>
            <button className="btn btn-accent" disabled={!complete} onClick={() => setReview(true)} title={complete ? '' : `Pick ${places} entries to continue`}><Send size={15} /> Review</button>
          </div>
        </div>
      )}

      {view && (
        <EntryViewer entry={view} onClose={() => setView(null)}
          footer={
            <div className="stack" style={{ marginTop: 'auto' }}>
              <div className="hint">Choose a place for this entry</div>
              <div className="rank-row" role="group" aria-label={`Place for ${view.label}`}>
                {Array.from({ length: places }, (_, i) => i + 1).map((rk) => (
                  <button key={rk} aria-pressed={rankOf.get(view.id) === rk} onClick={() => setRank(view.id, rk)}>{ordinal(rk)}</button>
                ))}
              </div>
            </div>
          } />
      )}

      {review && (
        <Modal title="Check your picks" onClose={() => setReview(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setReview(false)}>Go back and change</button>
            <button className="btn btn-primary" onClick={submit} disabled={submitting}><Send size={15} /> {preview ? 'Submit (preview)' : 'Submit my vote'}</button></>}>
          <div className="review-list">
            {Array.from({ length: places }, (_, i) => i + 1).map((rk) => { const e = slotEntry(rk)!; return e && (
              <div className="review-item" key={rk}>
                <Medal rank={rk} />
                {e.thumbUrl ? <img src={e.thumbUrl} alt="" /> : <div className="thumb-ph" style={{ width: 64, height: 48 }}><FileText size={18} /></div>}
                <div className="grow"><b>{e.label}</b><div className="hint">{e.title}</div></div>
                <span className="pts">{places - rk + 1} pts</span>
              </div>); })}
          </div>
          <div className="notice warn" style={{ marginTop: 14 }}><TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} /> Votes are final. You cannot change them after you submit.</div>
        </Modal>
      )}
      {how && <HowItWorks places={places} onClose={() => setHow(false)} />}
    </div>
  );
}

export function PreviewVote() { return <Vote preview />; }
