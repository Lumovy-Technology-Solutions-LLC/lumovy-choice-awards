// Checks that uploads lose hidden author details before anyone else can see them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-files-'));
process.env.UPLOAD_DIR = path.join(tmp, 'up');
const { processUpload, filePath } = await import('../src/lib/files.js');

test('photo: EXIF author and GPS are removed', async () => {
  const src = path.join(tmp, 'a.jpg');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2D31C4' } })
    .withExif({ IFD0: { Artist: 'Secret Author', Copyright: 'Secret Author' } }).jpeg().toFile(src);
  assert.ok(fs.readFileSync(src).includes('Secret Author'), 'fixture has the author');
  const info = await processUpload({ tmpPath: src, originalName: 'Jane Doe photo.jpg', contestId: 1, allowedTypes: ['image'] });
  const out = fs.readFileSync(filePath(info.file_key));
  assert.ok(!out.includes('Secret Author'), 'author removed from stored photo');
  assert.ok(!(await sharp(out).metadata()).exif, 'no EXIF block');
  assert.ok(!info.file_key.includes('Jane'), 'original file name is not kept');
  assert.ok(info.thumb_key);
});

test('pdf: author, title and creator are blanked', async () => {
  const doc = await PDFDocument.create();
  doc.addPage(); doc.setAuthor('Secret Author'); doc.setTitle('Secret Title'); doc.setCreator('Secret Tool');
  const src = path.join(tmp, 'a.pdf'); fs.writeFileSync(src, await doc.save());
  const info = await processUpload({ tmpPath: src, originalName: 'x.pdf', contestId: 1, allowedTypes: ['document'] });
  const out = fs.readFileSync(filePath(info.file_key));
  assert.ok(!out.includes('Secret Author') && !out.includes('Secret Title') && !out.includes('Secret Tool'));
  assert.equal(info.page_count, 1);
});

test('word: creator, last editor, company and tracked-change authors are blanked', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins w:id="1" w:author="Secret Author"><w:r><w:t>Hello world</w:t></w:r></w:ins></w:p></w:body></w:document>');
  zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="a" xmlns:dc="b"><dc:creator>Secret Author</dc:creator><cp:lastModifiedBy>Secret Author</cp:lastModifiedBy></cp:coreProperties>');
  zip.file('docProps/app.xml', '<?xml version="1.0"?><Properties><Company>Secret Corp</Company></Properties>');
  const src = path.join(tmp, 'a.docx'); fs.writeFileSync(src, await zip.generateAsync({ type: 'nodebuffer' }));
  const info = await processUpload({ tmpPath: src, originalName: 'x.docx', contestId: 1, allowedTypes: ['document'] });
  const z = await JSZip.loadAsync(fs.readFileSync(filePath(info.file_key)));
  for (const f of ['docProps/core.xml', 'docProps/app.xml', 'word/document.xml']) assert.ok(!(await z.file(f).async('string')).includes('Secret'), f);
  assert.ok(fs.existsSync(filePath(info.file_key + '.html')), 'viewer copy created');
});

test('wrong type for the contest is rejected', async () => {
  const src = path.join(tmp, 'b.pdf'); fs.writeFileSync(src, '%PDF-1.4');
  await assert.rejects(processUpload({ tmpPath: src, originalName: 'b.pdf', contestId: 1, allowedTypes: ['image'] }), /does not accept/);
  await assert.rejects(processUpload({ tmpPath: src, originalName: 'b.exe', contestId: 1, allowedTypes: ['image', 'document', 'video'] }), /not a supported/);
});
