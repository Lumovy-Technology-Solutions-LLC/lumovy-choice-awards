import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageLoader } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function PageCanvas({ doc, n, zoom, width }: { doc: pdfjs.PDFDocumentProxy; n: number; zoom: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const cssW = Math.max(180, Math.min(820, width)) * zoom;
      const scale = cssW / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = `${vp.width / dpr}px`; canvas.style.height = `${vp.height / dpr}px`;
      task = page.render({ canvas, viewport: vp } as any);
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, n, zoom, width]);
  return <canvas ref={ref} className="docv-canvas" role="img" aria-label={`Page ${n}`} />;
}

export default function PdfPages({ url, zoom }: { url: string; zoom: number }) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [err, setErr] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrap.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth - 32)));
    ro.observe(el); setWidth(Math.round(el.clientWidth - 32));
    return () => ro.disconnect();
  }, [doc]);
  useEffect(() => {
    let cancelled = false;
    setDoc(null); setErr('');
    const task = pdfjs.getDocument({ url, withCredentials: true });
    task.promise.then((d) => { if (!cancelled) setDoc(d); }).catch(() => { if (!cancelled) setErr('This document could not be opened.'); });
    return () => { cancelled = true; task.destroy(); };
  }, [url]);
  if (err) return <p style={{ color: '#fff', padding: 24 }}>{err}</p>;
  if (!doc) return <PageLoader label="Opening document…" />;
  return (
    <div className="docv-pages-wrap" style={{ padding: 16 }} ref={wrap}>
      {Array.from({ length: doc.numPages }, (_, i) => <PageCanvas key={i} doc={doc} n={i + 1} zoom={zoom} width={width} />)}
    </div>
  );
}
