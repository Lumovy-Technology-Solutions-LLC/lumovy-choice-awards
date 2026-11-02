import PageBackdrop from '../components/PageBackdrop';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Lock, Clock, ListChecks, ScrollText, CalendarClock, CheckCircle2, ChevronRight, HelpCircle, Trophy, Vote as VoteIcon, Trophy as TrophyIcon, History } from 'lucide-react';
import { api } from '../api';
import type { Contest, Results } from '../types';
import { useAuth, ordinal } from '../lib';
import { Countdown, Empty, ErrorState, Medal, Modal, PageLoader, StatusPill } from '../components/ui';

const CONFETTI: [number, number, string, number][] = [[8, 20, '#FF7A2F', 20], [22, 8, '#F5B83D', -30], [78, 12, '#5A5FF5', 40], [90, 30, '#FF7A2F', -15], [14, 52, '#18A874', 60], [86, 58, '#F5B83D', 10], [50, 4, '#fff', 25], [66, 24, '#FF7A2F', -50]];

interface HomeData { serverTime: string; featured: Contest | null; alsoOpen: Contest[]; upcoming: Contest[]; past: { id: number; name: string; month: string; votes: number; status: string; statusLabel: string }[] }

const Step = ({ badge, title, children }: { badge: React.ReactNode; title: string; children: React.ReactNode }) => (
  <div className="review-item" style={{ padding: 14, alignItems: 'center', gap: 14 }}>{badge}<div><b>{title}</b><div className="hint" style={{ marginTop: 2 }}>{children}</div></div></div>
);
const Bubble = ({ r, label }: { r: number; label: string }) => <span className={`medal r${r}`} style={{ width: 44, height: 44, fontSize: 13 }}>{label}</span>;

export function HowItWorks({ places = 3, onClose }: { places?: number; onClose: () => void }) {
  return (
    <Modal title="How voting works" onClose={onClose}>
      <div className="review-list">
        <Step badge={<Bubble r={1} label="1st" />} title={`Rank ${places} different entries`}>1st gets {places} points, 2nd gets {places - 1}, 3rd gets 1.</Step>
        <Step badge={<Bubble r={2} label="2" />} title="Not sure yet? Save">Pick one or two and save. Your picks are here when you come back.</Step>
        <Step badge={<Bubble r={3} label="3" />} title="Submit once">After you submit, your vote is final and you get an email receipt.</Step>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>Entries show only an entry number and description, so nobody knows whose work it is. Ties go to the entry with more 1st-place picks.</p>
    </Modal>
  );
}

function PastResultsModal({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['results', id], queryFn: () => api.get<Results>(`/api/portal/contests/${id}/results`), retry: false });
  // Your own vote is available even before HR publishes the results.
  const mine = useQuery({ queryKey: ['ballot', String(id)], enabled: q.isError, queryFn: () => api.get<{ status: string; picks: { rank: number; entry: { label: string; title: string; thumbUrl: string | null } }[] }>(`/api/portal/contests/${id}/ballot`), retry: false });
  return (
    <Modal title={name} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button>{q.data && <Link className="btn btn-primary" to={`/contests/${id}/results`}>See full results</Link>}</>}>
      {q.isLoading && <PageLoader />}
      {q.isError && <p className="hint">The results for this contest have not been published yet.</p>}
      {q.data && (
        <div className="review-list">
          {q.data.winners.map((w) => (
            <div className="review-item" key={w.id}>
              <Medal rank={w.place} />
              {w.thumbUrl ? <img src={w.thumbUrl} alt={w.altText || w.title} loading="lazy" /> : <div className="thumb-ph" style={{ width: 64, height: 48 }}><TrophyIcon size={18} /></div>}
              <div className="grow"><b>{w.competitorName}</b><div className="hint">{w.label}: {w.title}</div></div>
              <span className="pts num">{w.points} pts</span>
            </div>
          ))}
          {!q.data.winners.length && <p className="hint">No votes were cast.</p>}
        </div>
      )}
      {q.data?.myVoted && q.data.myPicks && q.data.myPicks.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Your vote</div>
          <div className="row" style={{ gap: 8 }}>
            {[...q.data.myPicks].sort((a, b) => a.rank - b.rank).map((p) => {
              const e = [...q.data!.winners, ...q.data!.others].find((x) => x.id === p.entryId);
              return e && <span key={p.rank} className="badge" style={{ padding: '6px 12px' }}><Medal rank={p.rank} /> {e.label} · {e.title}</span>;
            })}
          </div>
        </div>
      )}
      {q.isError && mine.data?.status === 'submitted' && (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Your vote</div>
          <div className="row" style={{ gap: 8 }}>
            {[...mine.data.picks].sort((a, b) => a.rank - b.rank).map((p) => <span key={p.rank} className="badge" style={{ padding: '6px 12px' }}><Medal rank={p.rank} /> {p.entry.label} · {p.entry.title}</span>)}
          </div>
        </div>
      )}
      {q.isError && mine.data?.status === 'draft' && <p className="hint" style={{ marginTop: 14 }}>You did not submit a vote in this contest.</p>}
    </Modal>
  );
}

export default function Home() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [how, setHow] = useState(false);
  const [rules, setRules] = useState(false);
  const [pastOpen, setPastOpen] = useState<{ id: number; name: string } | null>(null);
  const [idx, setIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const count = useRef(0);
  const modalOpen = how || rules || !!pastOpen;
  useEffect(() => {
    if (hover || modalOpen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => { if (count.current > 1) setIdx((i) => (i + 1) % count.current); }, 8000);
    return () => clearInterval(t);
  }, [hover, modalOpen]);

  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/api/portal/home'), refetchInterval: 60_000 });
  const detail = useQuery({ queryKey: ['contest', id], enabled: !!id, queryFn: () => api.get<{ serverTime: string; contest: Contest }>(`/api/portal/contests/${id}`) });

  if (home.isLoading || (id && detail.isLoading)) return <div className="wrap"><PageLoader /></div>;
  if (home.isError) return <div className="wrap"><ErrorState error={home.error} retry={() => home.refetch()} /></div>;
  if (id && detail.isError) return <div className="wrap"><ErrorState error={detail.error} retry={() => detail.refetch()} /></div>;

  const h = home.data!;
  // Every contest running right now gets its own slide: open for voting first, then coming soon.
  const slides: Contest[] = id ? [detail.data!.contest] : [h.featured, ...h.alsoOpen].filter((x): x is Contest => !!x);
  count.current = slides.length;
  const c: Contest | null = slides[Math.min(idx, slides.length - 1)] ?? null;
  const go = (n: number) => setIdx((n + slides.length) % slides.length);
  const serverTime = id ? detail.data!.serverTime : h.serverTime;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['contest'] }); };
  const first = user?.name.split(' ')[0];

  return (
    <div className="wrap home">
      <PageBackdrop contests={slides} active={Math.min(idx, Math.max(slides.length - 1, 0))} />
      {!c ? (
        <Empty icon={<TrophyIcon size={34} />} title="No contest is open for voting">When HR starts a contest you will get an email and it will appear here.</Empty>
      ) : (
        <>
          <div className="hero-viewport" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
            <div className="hero-track" style={{ transform: `translateX(-${Math.min(idx, slides.length - 1) * 100}%)` }}>
              {slides.map((x) => (
                <section key={x.id} className={`hero slide ${x.bannerUrl ? 'has-banner' : ''}`} style={x.bannerUrl ? { backgroundImage: `url(${x.bannerUrl})` } : undefined} aria-roledescription="slide" aria-label={x.name} aria-hidden={x !== c}>
            {x.bannerUrl && <div className="banner-scrim" />}
            <div className="hero-grid">
              <div>
                <div className="greet">Hey {first},</div>
                <div className="row" style={{ marginBottom: 14, gap: 10 }}>
                  <StatusPill status={x.status} />
                  <span className="hero-meta">{x.regionLabel} · {x.entryCount ?? 0} {x.entryCount === 1 ? 'entry' : 'entries'}</span>
                </div>
                <h1 >{x.name}</h1>

                {x.status === 'live' && <Countdown endAt={x.endAt} serverTime={serverTime} onDone={refresh} />}
                {x.status === 'draft' && <p className="sub" style={{ marginTop: 18 }}><CalendarClock size={16} style={{ verticalAlign: -3 }} /> Voting opens soon. We will email you when it starts.</p>}
                {x.status === 'closed' && <p className="sub" style={{ marginTop: 18 }}>Voting is closed. Results will be published here soon.</p>}

                <div className="hero-actions">
                  {x.status === 'live' && x.canVote === false && <span className="pill" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', padding: '10px 16px' }}><Lock size={14} /> Open to {x.regionLabel} · view only</span>}
                  {x.status === 'live' && x.canVote !== false && x.myStatus !== 'submitted' && <Link tabIndex={x === c ? 0 : -1} className="btn btn-white" to={`/contests/${x.id}/vote`}>{x.myStatus === 'draft' ? 'Continue voting' : 'Start voting'}</Link>}
                  {x.status === 'live' && x.canVote !== false && x.myStatus === 'submitted' && <Link tabIndex={x === c ? 0 : -1} className="btn btn-white" to={`/contests/${x.id}/vote`}><CheckCircle2 size={16} /> See my vote</Link>}
                  {x.status === 'published' && <Link tabIndex={x === c ? 0 : -1} className="btn btn-white" to={`/contests/${x.id}/results`}><Trophy size={16} /> See the winners</Link>}
                  {x.status === 'closed' && x.myStatus === 'submitted' && <span className="pill" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}><CheckCircle2 size={14} /> Your vote is in</span>}
                  <button tabIndex={x === c ? 0 : -1} className="btn btn-glass" onClick={() => setHow(true)}>How it works</button>
                </div>
              </div>
              <div className="hero-podium" aria-hidden>
                {CONFETTI.map((k, i) => <i key={i} className="cf" style={{ left: `${k[0]}%`, top: `${k[1]}%`, background: k[2], animationDelay: `${i * 0.3}s`, transform: `rotate(${k[3]}deg)` }} />)}
                <div className="pod3d">
                  <div className="trophy"><Trophy size={72} color="#F5B83D" strokeWidth={1.5} fill="rgba(245,184,61,.25)" /></div>
                  <div className="pod3d-row">
                    <div className="st s2"><span className="st-n">2</span><span className="st-p">{x.places - 1} pts</span></div>
                    <div className="st s1"><span className="st-n">1</span><span className="st-p">{x.places} pts</span></div>
                    <div className="st s3"><span className="st-n">3</span><span className="st-p">1 pt</span></div>
                  </div>
                  <div className="pod3d-floor" />
                </div>
              </div>
            </div>
                </section>
              ))}
            </div>
            {slides.length > 1 && (
              <div className="carousel-ctl">
                <button className="icon-btn glass" onClick={() => go(idx - 1)} aria-label="Previous contest"><ChevronLeft size={18} /></button>
                <div className="dots" role="tablist" aria-label="Contests">
                  {slides.map((x, i) => <button key={x.id} role="tab" aria-selected={i === idx} aria-label={x.name} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />)}
                </div>
                <button className="icon-btn glass" onClick={() => go(idx + 1)} aria-label="Next contest"><ChevronRight size={18} /></button>
              </div>
            )}
          </div>

          <div className="quick">
            <Link className="qa" to={c.status === 'live' && c.canVote !== false ? `/contests/${c.id}/vote` : `/contests/${c.id}`} aria-disabled={c.status !== 'live' || c.canVote === false}><span className="qa-ic"><ListChecks size={20} /></span><span><b>My ballot</b><span>{c.myStatus === 'submitted' ? 'Submitted · locked' : c.canVote === false ? 'Not in your region' : c.myStatus === 'draft' ? 'Saved, not submitted' : c.status === 'live' ? `0 of ${c.places} picked` : '—'}</span></span></Link>
            <Link className="qa" to={`/contests/${c.id}/results`}><span className="qa-ic"><Trophy size={20} /></span><span><b>Results</b><span>{c.status === 'published' ? 'Winners announced' : 'After voting closes'}</span></span></Link>
            <button className="qa" onClick={() => setRules(true)}><span className="qa-ic"><ScrollText size={20} /></span><span><b>Rules</b><span>{c.places}, {c.places - 1}, 1 points</span></span></button>
            <div className="qa"><span className="qa-ic"><Clock size={20} /></span><span><b>Deadline</b><span>{c.endAt ? c.deadlineLabel : '—'}</span></span></div>
          </div>

          {c.status === 'live' && c.myStatus === 'submitted' && (
            <div className="notice good" style={{ marginTop: 16 }}><CheckCircle2 size={18} style={{ flex: 'none' }} /> Thanks, your vote is in. You can look at your picks, but votes cannot be changed.</div>
          )}
          {c.status === 'live' && c.myStatus === 'draft' && (
            <div className="notice warn" style={{ marginTop: 16 }}>You have saved picks that are not submitted yet. They only count once you press Submit.</div>
          )}
        </>
      )}

      {!id && h.upcoming.length > 0 && (
        <>
          <div className="section-h"><h2>Upcoming contests</h2></div>
          <div className="past">
            {h.upcoming.map((x) => (
              <Link key={x.id} to={`/contests/${x.id}`} className="past-card">
                <div className="past-thumb" style={{ background: 'linear-gradient(135deg,var(--brand-2),var(--hero-b))' }}><CalendarClock size={22} /></div>
                <div className="grow"><b>{x.name}</b><span>Coming soon · {x.regionLabel}{x.theme ? ` · ${x.theme}` : ''}</span></div>
                <ChevronRight size={18} color="var(--muted)" />
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="section-h"><h2>Past contests</h2></div>
      {h.past.length === 0 ? (
        <Empty icon={<History size={30} />} title="No past contests yet">Finished contests will be listed here.</Empty>
      ) : (
        <div className="past">
          {h.past.map((p, i) => (
            <button key={p.id} className="past-card" onClick={() => setPastOpen({ id: p.id, name: p.name })} aria-label={`${p.name}, ${p.month}, ${p.votes} votes. Show winners`}>
              <div className="past-thumb" style={{ background: ['linear-gradient(135deg,#FF7A2F,#FFB36B)', 'linear-gradient(135deg,#2D31C4,#5A5FF0)', 'linear-gradient(135deg,#18A874,#6FD6B0)'][i % 3] }}><TrophyIcon size={22} /></div>
              <div className="grow"><b>{p.name}</b><span>{p.month} · {p.votes} {p.votes === 1 ? 'vote' : 'votes'}</span></div>
              <span className="go">{p.status === 'published' ? 'See winners' : 'Results soon'}</span>
            </button>
          ))}
        </div>
      )}

      {rules && c && (
        <Modal title="Contest rules" onClose={() => setRules(false)} footer={<button className="btn btn-primary" onClick={() => setRules(false)}>Got it</button>}>
          <div className="review-list">
            <Step badge={<span className="qa-ic"><ScrollText size={20} /></span>} title="The contest">{c.rules || 'No extra rules for this contest.'}</Step>
            <Step badge={<span className="qa-ic"><Trophy size={20} /></span>} title="Scoring">1st place = {c.places} points, 2nd = {c.places - 1}, 3rd = 1. The entry with the most points wins.</Step>
            <Step badge={<span className="qa-ic"><ListChecks size={20} /></span>} title="Tie-breaks">More 1st-place picks wins, then more 2nd-place picks. Still level? The place is shared.</Step>
            <Step badge={<span className="qa-ic"><Lock size={20} /></span>} title="Fair and anonymous">One vote each, final once submitted. Names stay hidden until results are published, and nobody sees who voted for what.</Step>
            <Step badge={<span className="qa-ic"><Clock size={20} /></span>} title="Deadline">{c.endAt ? `Voting closes ${c.deadlineLabel}. Nothing can be submitted after that.` : 'Set when voting starts.'}</Step>
          </div>
        </Modal>
      )}
      {how && <HowItWorks places={c?.places} onClose={() => setHow(false)} />}
      {pastOpen && <PastResultsModal {...pastOpen} onClose={() => setPastOpen(null)} />}
    </div>
  );
}

