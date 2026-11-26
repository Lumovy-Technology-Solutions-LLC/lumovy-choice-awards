import { lazy, Suspense, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Minus, Pause, Plus, Play } from 'lucide-react';
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

/** Large view of an entry. Works for images, writing, PDF/Word documents and video. Shows no entrant details. */
export default function EntryViewer({ entry, onClose, footer }: { entry: Entry; onClose: () => void; footer?: React.ReactNode }) {
  const isDoc = entry.type === 'document';
  // photo entries can hold several angles of the same subject: the first is the entry's own file
  const photos = entry.type === 'image' ? [{ url: entry.url!, thumbUrl: entry.thumbUrl, alt: entry.altText }, ...(entry.images ?? []).map((i) => ({ url: i.url, thumbUrl: i.thumbUrl, alt: i.altText }))] : [];
  const [pi, setPi] = useState(0);
  // Auto-advance like a carousel. It stops for people who prefer reduced motion, while the pointer is over the photo,
  // and when the viewer presses Pause or picks a photo themselves.
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [playing, setPlaying] = useState(!reduce);
  const [hover, setHover] = useState(false);
  const n = photos.length;
  useEffect(() => {
    if (n < 2 || !playing || hover) return;
    const t = setInterval(() => setPi((i) => (i + 1) % n), 4000);
    return () => clearInterval(t);
  }, [n, playing, hover, pi]);
  const go = (i: number) => { setPi(((i % n) + n) % n); setPlaying(false); };
  let main: React.ReactNode;
  if (entry.type === 'image') main = (
    <div className="frame-main" style={photos.length > 1 ? { flexDirection: 'column', gap: 10 } : undefined} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} role={n > 1 ? 'group' : undefined} aria-roledescription={n > 1 ? 'carousel' : undefined} aria-label={n > 1 ? `Photos of ${entry.label}` : undefined}>
      <img key={pi} className="fade-in" src={photos[pi]?.url ?? entry.url!} alt={photos[pi]?.alt || `${entry.label}: ${entry.title}${photos.length > 1 ? ` (photo ${pi + 1} of ${photos.length})` : ''}`} style={photos.length > 1 ? { minHeight: 0, flex: '1 1 auto' } : undefined} />
      {photos.length > 1 && (
        <div className="angles" style={{ alignItems: 'center' }}>
          <button type="button" className="icon-btn" aria-label="Previous photo" onClick={() => go(pi - 1)}><ChevronLeft size={18} /></button>
          <button type="button" className="icon-btn" aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} onClick={() => setPlaying((v) => !v)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <button type="button" className="icon-btn" aria-label="Next photo" onClick={() => go(pi + 1)}><ChevronRight size={18} /></button>
        </div>
      )}
      {photos.length > 1 && (
        <div className="angles" role="group" aria-label="Photos of this entry">
          {photos.map((p, i) => (
            <button key={p.url} type="button" className="angle" aria-pressed={i === pi} aria-label={`Photo ${i + 1} of ${photos.length}`} onClick={() => go(i)}><img src={p.thumbUrl || p.url} alt="" /></button>
          ))}
        </div>
      )}
    </div>
  );
  else if (entry.type === 'video') main = <div className="frame-main"><video src={entry.url!} controls playsInline preload="metadata" aria-label={`${entry.label}: ${entry.title}`} /></div>;
  else if (entry.type === 'writing') main = (
    <div className="reading" tabIndex={0}>
      <div className="eyebrow">{entry.label}</div>
      <h2>{entry.title}</h2>
      <div className="body">{entry.body}</div>
    </div>
  );
  else main = entry.fileName?.toLowerCase().endsWith('.pdf') ? <PdfView entry={entry} /> : <DocxView entry={entry} />;

  return (
    <Modal wide onClose={onClose} labelledBy="frame-title" className={isDoc ? 'frame-doc' : ''}>
      <span id="frame-title" className="sr-only">{entry.label}: {entry.title}</span>
      <div className={isDoc ? 'frame-doc-grid' : 'lightbox frame'} style={{ margin: '-16px -22px' }}>
        {main}
        <Details entry={entry} footer={footer} />
      </div>
    </Modal>
  );
}

export function EntryThumb({ entry }: { entry: Entry }) {
  if (entry.type === 'image' && entry.thumbUrl) return <img src={entry.thumbUrl} alt={entry.altText || `${entry.label}: ${entry.title}`} loading="lazy" />;
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
