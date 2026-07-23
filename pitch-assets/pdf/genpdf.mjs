import fs from 'fs';
import path from 'path';

const root = path.resolve('.');
const html = fs.readFileSync(path.join(root, 'frame-pitch.html'), 'utf8');

// Split into slide sections and pull the .notes-src text from each
const sections = html.split('<section class="slide">').slice(1);
const notes = sections.map(sec => {
  const m = sec.match(/<div class="notes-src">([\s\S]*?)<\/div>/);
  if (!m) return '';
  return m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
});

const n = 16;
let pages = '';
for (let i = 0; i < n; i++) {
  const img = `slide-${i}.png`;
  const note = notes[i] || '';
  pages += `
  <div class="page">
    <div class="slidewrap"><img src="${img}"/></div>
    <div class="notes">
      <div class="nlabel">Speaker notes — ${i + 1}/${n}</div>
      <div class="ntext">${note}</div>
    </div>
  </div>`;
}

const out = `<!doctype html><html><head><meta charset="utf8"><style>
  @page { size: 11in 8.5in; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { background:#fff; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif; color:#1a1a1a; }
  .page { width:11in; height:8.5in; padding:0.45in 0.55in; page-break-after:always; display:flex; flex-direction:column; }
  .page:last-child { page-break-after:auto; }
  .slidewrap { flex:0 0 auto; }
  .slidewrap img { width:100%; height:auto; display:block; border:1px solid #e2e2e2; border-radius:6px; }
  .notes { margin-top:0.28in; flex:1 1 auto; }
  .nlabel { font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#b08050; font-weight:700; margin-bottom:7px; }
  .ntext { font-size:12.5px; line-height:1.55; color:#333; }
</style></head><body>${pages}</body></html>`;

fs.writeFileSync(path.join(root, 'pitch-assets/pdf/print.html'), out);
console.log('print.html written,', notes.filter(Boolean).length, 'notes found');
