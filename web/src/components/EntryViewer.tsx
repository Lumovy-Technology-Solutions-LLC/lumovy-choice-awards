import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Maximize2, Minimize2, Minus, Pause, Plus, Play, X } from 'lucide-react';
import { api } from '../api';
import type { Entry } from '../types';
import { Modal, PageLoader } from './ui';

const PdfPages = lazy(() => import('./PdfPages'));

function DocShell({ fileName, kind, pages, zoom, setZoom, children, estimated }: { fileName: string; kind: 'PDF' | 'DOC'; pages: number | null; zoom: number; setZoom: (z: number) => void; children: React.ReactNode; estimated?: boolean }) {
  return (
    <div className="docv" style={{ ['--z' as any]: zoom }}>
      <div className="docv-bar">
        <span className="docv-file"><span className="docv-pdf" style={kind === 'DOC' ? { background: '#2D6BE0' } : undefined}>{kind}</span>{fileName}</span>
        <span className="docv-tools">
          <span className="docv-pages num">{pages ? `${estimated ? '~' : ''}${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}</span>
          <button className="icon-btn docv-btn" onClick={() => setZoom(Math.max(0.5, +(zoom - 0.25).toFixed(2)))} aria-label="Zoom out" disabled={zoom <= 0.5}><Minus size={14} /></button>
          <span className="num" style={{ minWidth: 44, textAlign: 'center' }} aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn docv-btn" onClick={() => setZoom(Math.min(3, +(zoom + 0.25).toFixed(2)))} aria-label="Zoom in" disabled={zoom >= 3}><Plus size={14} /></button>
        </span>
      </div>
      <div className="docv-scroll" tabIndex={0} aria-label={`Document ${fileName}`}>{children}</div>
    </div>
  );
}

function DocxView({ entry }: { entry: Entry }) {
  const [zoom, setZoom] = useState(1);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api.get<{ html: string }>(`${entry.url}/html`).then((r) => {
      if (!live) return;
      // Strip anything executable; mammoth output has none, this is defence in depth.
      const doc = new DOMParser().parseFromString(r.html, 'text/html');
      doc.querySelectorAll('script,iframe,object,embed,link,style').forEach((n) => n.remove());
      doc.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || (a.name === 'href' && /^javascript:/i.test(a.value))) n.removeAttribute(a.name); }));
      // Links inside an entry must not be clickable: they could leave the portal or hint at who wrote it.
      doc.querySelectorAll('a').forEach((a) => { const s = doc.createElement('span'); s.innerHTML = a.innerHTML; a.replaceWith(s); });
      setHtml(doc.body.innerHTML);
    }).catch(() => live && setErr('This document could not be opened.'));
    return () => { live = false; };
  }, [entry.url]);
  return (
    <DocShell fileName={entry.fileName || entry.label} kind="DOC" pages={entry.pageCount} estimated zoom={zoom} setZoom={setZoom}>
      {err ? <p style={{ color: '#fff', padding: 24 }}>{err}</p> : html === null ? <PageLoader /> : <div className="docx-page" dangerouslySetInnerHTML={{ __html: html }} />}
    </DocShell>
  );
}

function PdfView({ entry }: { entry: Entry }) {
  const [zoom, setZoom] = useState(1);
  return (
    <DocShell fileName={entry.fileName || entry.label} kind="PDF" pages={entry.pageCount} zoom={zoom} setZoom={setZoom}>
      <Suspense fallback={<PageLoader label="Opening document…" />}><PdfPages url={entry.url!} zoom={zoom} /></Suspense>
    </DocShell>
  );
}

function Details({ entry, footer }: { entry: Entry; footer?: React.ReactNode }) {
  return (
    <div className="lightbox-side">
      <span className="pill pill-pub" style={{ alignSelf: 'flex-start' }}>{entry.label}</span>
      <h3 style={{ fontSize: 20 }}>{entry.title || 'Untitled'}</h3>
      <p className="hint" style={{ fontSize: 14, lineHeight: 1.7 }}>{entry.description}</p>
      {footer}
    </div>
  );
}

const MIN_Z = 1, MAX_Z = 6;

/** A photo you can look at closely: zoom with the buttons, + / - keys, the mouse wheel, a double click or a pinch; drag to move around. */
function ImageStage({ src, alt }: { src: string; alt: string }) {
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; d: number } | null>(null);

  useEffect(() => { setZ(1); setPos({ x: 0, y: 0 }); }, [src]);

  // keep the picture from being dragged away from the frame
  const clamp = (x: number, y: number, zz: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return { x, y };
    const mx = (r.width * (zz - 1)) / 2, my = (r.height * (zz - 1)) / 2;
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  const zoomTo = (next: number) => {
    const zz = Math.max(MIN_Z, Math.min(MAX_Z, +next.toFixed(2)));
    setZ(zz);
    setPos((p) => (zz === 1 ? { x: 0, y: 0 } : clamp(p.x, p.y, zz)));
  };

  useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomTo(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(z * 1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(z / 1.25); }
      else if (e.key === '0') { e.preventDefault(); zoomTo(1); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last.current = { x: e.clientX, y: e.clientY, d: 0 };
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const list = [...pts.current.values()];
    if (list.length === 2) { // pinch
      const d = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
      if (last.current?.d) zoomTo(z * (d / last.current.d));
      last.current = { x: e.clientX, y: e.clientY, d };
    } else if (z > 1 && last.current) { // drag
      const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY, d: 0 };
      setPos((p) => clamp(p.x + dx, p.y + dy, z));
    }
  };
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); last.current = null; };

  return (
    <div className="xv-stage-wrap">
      <div ref={box} className={`xv-stage ${z > 1 ? 'zoomed' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={() => (z > 1 ? zoomTo(1) : zoomTo(2.5))} role="img" aria-label={alt}>
        <img src={src} alt="" draggable={false} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})` }} />
      </div>
      <div className="xv-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" onClick={() => zoomTo(z / 1.25)} disabled={z <= MIN_Z} aria-label="Zoom out"><Minus size={16} /></button>
        <button type="button" className="xv-pct num" onClick={() => zoomTo(1)} aria-label="Fit to screen">{Math.round(z * 100)}%</button>
        <button type="button" className="icon-btn" onClick={() => zoomTo(z * 1.25)} disabled={z >= MAX_Z} aria-label="Zoom in"><Plus size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => zoomTo(z > 1 ? 1 : 2.5)} aria-label={z > 1 ? 'Fit to screen' : 'Zoom to 250%'}>{z > 1 ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      {z === 1 && <div className="xv-tip" aria-hidden>Scroll or double-click to zoom in</div>}
    </div>
  );
}

/** Large view of an entry: fills the screen so voters can look closely. Works for photos, writing, PDF/Word documents and video. Shows no entrant details. */
export default function EntryViewer({ entry, onClose, footer }: { entry: Entry; onClose: () => void; footer?: React.ReactNode }) {
  // photo entries can hold several angles of the same subject: the first is the entry's own file
  const photos = entry.type === 'image' ? [{ url: entry.url!, thumbUrl: entry.thumbUrl, alt: entry.altText }, ...(entry.images ?? []).map((i) => ({ url: i.url, thumbUrl: i.thumbUrl, alt: i.altText }))] : [];
  const [pi, setPi] = useState(0);
  // Auto-advance like a carousel. It stops for people who prefer reduced motion, while the pointer is over the photo,
  // while zoomed in, and when the viewer presses Pause or picks a photo themselves.
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [playing, setPlaying] = useState(!reduce);
  const [hover, setHover] = useState(false);
  const n = photos.length;
  useEffect(() => {
    if (n < 2 || !playing || hover) return;
    const t = setInterval(() => setPi((i) => (i + 1) % n), 5000);
    return () => clearInterval(t);
  }, [n, playing, hover, pi]);
  const go = (i: number) => { setPi(((i % n) + n) % n); setPlaying(false); };
  useEffect(() => {
    if (n < 2) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(pi + 1);
      else if (e.key === 'ArrowLeft') go(pi - 1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  let main: React.ReactNode;
  if (entry.type === 'image') {
    const cur = photos[pi] ?? photos[0];
    const alt = cur.alt || `${entry.label}: ${entry.title}${n > 1 ? ` (photo ${pi + 1} of ${n})` : ''}`;
    main = (
      <div className="xv-photo" onPointerDown={() => setPlaying(false)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <ImageStage src={cur.url} alt={alt} />
        {n > 1 && (
          <div className="xv-strip" role="group" aria-roledescription="carousel" aria-label={`Photos of ${entry.label}`}>
            <button type="button" className="icon-btn" aria-label="Previous photo" onClick={() => go(pi - 1)}><ChevronLeft size={18} /></button>
            <div className="angles">
              {photos.map((p, i) => (
                <button key={p.url} type="button" className="angle" aria-pressed={i === pi} aria-label={`Photo ${i + 1} of ${n}`} onClick={() => go(i)}><img src={p.thumbUrl || p.url} alt="" /></button>
              ))}
            </div>
            <button type="button" className="icon-btn" aria-label="Next photo" onClick={() => go(pi + 1)}><ChevronRight size={18} /></button>
            <button type="button" className="icon-btn" aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} onClick={() => setPlaying((v) => !v)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <span className="num xv-count" aria-live="polite">{pi + 1} / {n}</span>
          </div>
        )}
      </div>
    );
  } else if (entry.type === 'video') main = <div className="xv-video"><video src={entry.url!} controls playsInline preload="metadata" aria-label={`${entry.label}: ${entry.title}`} /></div>;
  else if (entry.type === 'writing') main = (
    <div className="reading xv-reading" tabIndex={0}>
      <div className="eyebrow">{entry.label}</div>
      <h2>{entry.title}</h2>
      <div className="body">{entry.body}</div>
    </div>
  );
  else main = entry.fileName?.toLowerCase().endsWith('.pdf') ? <PdfView entry={entry} /> : <DocxView entry={entry} />;

  return (
    <Modal wide onClose={onClose} labelledBy="frame-title" className="xv-modal">
      <span id="frame-title" className="sr-only">{entry.label}: {entry.title}</span>
      <div className="xv">
        <div className="xv-main">{main}</div>
        <aside className="xv-side">
          <button type="button" className="icon-btn xv-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          <Details entry={entry} footer={footer} />
        </aside>
      </div>
    </Modal>
  );
}

/** Card picture for a photo entry. It stays still (no flicker); a small badge says when the entry has more photos. */
function PhotoTile({ entry }: { entry: Entry }) {
  const more = entry.images?.length ?? 0;
  return (
    <>
      <img src={entry.thumbUrl!} alt={entry.altText || `${entry.label}: ${entry.title}`} loading="lazy" />
      {more > 0 && <span className="tile-count"><ImageIcon size={12} /> {more + 1} photos</span>}
    </>
  );
}

export function EntryThumb({ entry }: { entry: Entry }) {
  if (entry.type === 'image' && entry.thumbUrl) return <PhotoTile entry={entry} />;
  if (entry.type === 'writing') return <div className="entry-text"><p>{entry.excerpt}</p></div>;
  if (entry.type === 'video') return (
    <>
      <video src={`${entry.url}#t=0.5`} preload="metadata" muted playsInline aria-hidden tabIndex={-1} />
      <div className="entry-play"><span><Play size={22} fill="#fff" /></span></div>
    </>
  );
  return (
    <div className="entry-doc" aria-label={`Document, ${entry.pageCount ?? ''} pages`}>
      <div className="sheet"><i style={{ top: '24%' }} /><i style={{ top: '38%' }} /><i style={{ top: '52%' }} /><FileText size={22} style={{ position: 'absolute', bottom: 8 }} /></div>
      <span className="tag">{entry.pageCount ? `${entry.pageCount} ${entry.pageCount === 1 ? 'page' : 'pages'}` : 'Document'}</span>
    </div>
  );
}
