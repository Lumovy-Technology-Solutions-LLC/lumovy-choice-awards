import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { PDFDocument, PDFName } from 'pdf-lib';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { config } from '../config.js';
import { bad } from './util.js';

export const ENTRY_TYPES = ['image', 'writing', 'document', 'video'];
export const ALLOWED_EXT = {
  image: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  document: ['.pdf', '.docx'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
};
export const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
};

export const typeForExt = (ext) => Object.entries(ALLOWED_EXT).find(([, v]) => v.includes(ext))?.[0] || null;
export const filePath = (key) => path.join(config.uploadDir, key);
export const newKey = (dir, ext) => `${dir}/${crypto.randomUUID()}${ext}`;

function ensureDir(key) { fs.mkdirSync(path.dirname(filePath(key)), { recursive: true }); }

export function removeFiles(...keys) {
  for (const k of keys) {
    if (!k) continue;
    try { fs.rmSync(filePath(k), { force: true }); } catch { /* ignore */ }
  }
}

/** Remove metadata (author, camera, GPS, etc.) and store the file. Returns info for the entries row. */
export async function processUpload({ tmpPath, originalName, contestId, allowedTypes }) {
  let ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  const type = typeForExt(ext);
  if (!type) throw bad(`“${originalName}” is not a supported file type.`);
  if (!allowedTypes.includes(type)) throw bad(`This contest does not accept ${type} entries.`);
  const dir = `entries/${contestId}`;
  const buf = await fs.promises.readFile(tmpPath);

  if (type === 'image') {
    let img;
    try {
      img = sharp(buf, { animated: false }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
      const meta = await sharp(buf).metadata();
      const keepPng = meta.format === 'png';
      const outExt = keepPng ? '.png' : meta.format === 'webp' ? '.webp' : '.jpg';
      const key = newKey(dir, outExt);
      ensureDir(key);
      // sharp drops EXIF/XMP/ICC author and GPS data unless withMetadata() is called
      const out = keepPng ? img.png() : meta.format === 'webp' ? img.webp({ quality: 88 }) : img.jpeg({ quality: 88, mozjpeg: true });
      const info = await out.toFile(filePath(key));
      const thumbKey = newKey(dir, '.webp');
      await sharp(buf).rotate().resize({ width: 720, height: 720, fit: 'inside' }).webp({ quality: 80 }).toFile(filePath(thumbKey));
      return { type, file_key: key, thumb_key: thumbKey, mime: MIME[outExt], ext: outExt, size: info.size, page_count: null };
    } catch (e) {
      if (e.status) throw e;
      throw bad(`“${originalName}” could not be read as an image.`);
    }
  }

  if (type === 'document' && ext === '.pdf') {
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw bad(`“${originalName}” is not a valid PDF.`);
    let doc;
    try { doc = await PDFDocument.load(buf, { updateMetadata: false }); }
    catch { throw bad(`“${originalName}” could not be read. Password-protected or damaged PDFs are not supported.`); }
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
    doc.setProducer(''); doc.setCreator('');
    doc.catalog.delete(PDFName.of('Metadata')); // XMP packet
    const out = Buffer.from(await doc.save());
    const key = newKey(dir, '.pdf');
    ensureDir(key);
    await fs.promises.writeFile(filePath(key), out);
    return { type, file_key: key, mime: MIME['.pdf'], ext: '.pdf', size: out.length, page_count: doc.getPageCount() };
  }

  if (type === 'document' && ext === '.docx') {
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch { throw bad(`“${originalName}” is not a valid Word document.`); }
    if (!zip.file('word/document.xml')) throw bad(`“${originalName}” is not a valid Word document.`);
    const rewrite = async (name, fn) => { const f = zip.file(name); if (f) zip.file(name, fn(await f.async('string'))); };
    await rewrite('docProps/core.xml', (x) => x
      .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, '<dc:creator></dc:creator>')
      .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy></cp:lastModifiedBy>')
      .replace(/<dc:title>[\s\S]*?<\/dc:title>/, '<dc:title></dc:title>')
      .replace(/<dc:subject>[\s\S]*?<\/dc:subject>/, '<dc:subject></dc:subject>')
      .replace(/<cp:keywords>[\s\S]*?<\/cp:keywords>/, '<cp:keywords></cp:keywords>'));
    await rewrite('docProps/app.xml', (x) => x
      .replace(/<Company>[\s\S]*?<\/Company>/, '<Company></Company>')
      .replace(/<Manager>[\s\S]*?<\/Manager>/, '<Manager></Manager>'));
    for (const name of Object.keys(zip.files).filter((n) => /^word\/.*\.xml$/.test(n)))
      await rewrite(name, (x) => x.replace(/ w:author="[^"]*"/g, ' w:author=""').replace(/ w:initials="[^"]*"/g, ' w:initials=""'));
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const key = newKey(dir, '.docx');
    ensureDir(key);
    await fs.promises.writeFile(filePath(key), out);
    // readable copy for the in-portal viewer
    let words = 0;
    try {
      const { value } = await mammoth.convertToHtml({ buffer: out });
      words = value.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      await fs.promises.writeFile(filePath(key + '.html'), value);
    } catch { throw bad(`“${originalName}” could not be converted for viewing.`); }
    return { type, file_key: key, mime: MIME['.docx'], ext: '.docx', size: out.length, page_count: Math.max(1, Math.ceil(words / 400)) };
  }

  if (type === 'video') {
    const key = newKey(dir, ext);
    ensureDir(key);
    const stripped = await stripVideoMetadata(tmpPath, filePath(key), ext);
    if (!stripped) await fs.promises.copyFile(tmpPath, filePath(key));
    const st = await fs.promises.stat(filePath(key));
    return { type, file_key: key, mime: MIME[ext], ext, size: st.size, page_count: null, metadata_stripped: stripped };
  }
  throw bad('Unsupported file.');
}

// Best-effort: needs ffmpeg on the server PATH. Without it the video is stored as uploaded.
function stripVideoMetadata(input, output, ext) {
  return new Promise((resolve) => {
    try {
      const p = spawn('ffmpeg', ['-y', '-i', input, '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-fflags', '+bitexact', output], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
}

export async function saveBanner({ tmpPath, contestId }) {
  const buf = await fs.promises.readFile(tmpPath);
  const key = newKey(`banners/${contestId}`, '.webp');
  ensureDir(key);
  try {
    await sharp(buf).rotate().resize({ width: 1800, height: 700, fit: 'cover' }).webp({ quality: 82 }).toFile(filePath(key));
  } catch { throw bad('That banner could not be read as an image.'); }
  return key;
}
