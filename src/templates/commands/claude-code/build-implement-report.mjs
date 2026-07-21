#!/usr/bin/env node
/**
 * Frame implementation report generator.
 *
 * Reads `.frame/specs/<slug>/report-data.json` — written by the autonomous
 * implement mode, one entry per finished task — pulls each commit's real
 * unified diff out of git by hash, and emits a self-contained
 * `implement-report.html` next to it.
 *
 * The agent never transcribes a diff. That is the one place a hallucination
 * would silently corrupt the artifact, which is the whole reason this is
 * generated rather than written.
 *
 * Usage:  node build-implement-report.mjs <path/to/report-data.json> [out.html]
 *
 * report-data.json — this shape is the contract with the prompt template:
 *   {
 *     "spec": { "slug": "...", "title": "..." },
 *     "generatedAt": "YYYY-MM-DD",            // optional; stamped if absent
 *     "tasks": [{
 *       "id": "T01",
 *       "title": "...",
 *       "commit": "abc1234",                  // "" until the amend fills it
 *       "whatChanged": "...",
 *       "whyChanged": "...",                  // optional
 *       "verification": {                     // status "none" = not run
 *         "command": "npm test", "status": "pass|fail|none", "detail": "..."
 *       }
 *     }]
 *   }
 *
 * Node 18, no dependencies — Frame's bundled runtime is 18.18.2 even where
 * the repo's own CI runs something newer. Everything above `main()` is pure:
 * no git, no filesystem, so it can be tested directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Frame's own bookkeeping, kept out of every diff so the report shows the
// implementation rather than the trail it leaves behind. `.frame` covers the
// spec folder, the outcome entry and this report's own data; tasks.json and
// STRUCTURE.json are machine-written state that rides along in the same
// atomic commit — a regenerated module map is noise, not a change anyone
// reads. PROJECT_NOTES.md and AGENTS.md are deliberately *not* excluded:
// they are written by hand, so a change there is a real one.
export const EXCLUDED_PATHS = ['.frame', 'tasks.json', 'STRUCTURE.json'];

// ─── Pure: rendering ──────────────────────────────────────────

// assets/logo.png downscaled to 96px and inlined, because the report must
// stay a single self-contained file — it gets opened from disk and attached
// to PRs, so a relative asset path would break the moment it leaves the repo.
// Regenerate after a logo change:
//   sips -z 96 96 assets/logo.png --out /tmp/logo-96.png && base64 -i /tmp/logo-96.png
const FRAME_LOGO_DATA_URI = 'data:image/png;base64,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';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Classify a unified-diff line so the reader can scan it. Order matters:
 * `+++`/`---` are file headers, not additions and deletions.
 */
export function diffLineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'dl-file';
  if (line.startsWith('diff --git') || line.startsWith('index ')
    || line.startsWith('new file') || line.startsWith('deleted file')
    || line.startsWith('similarity ') || line.startsWith('rename ')) return 'dl-meta';
  if (line.startsWith('@@')) return 'dl-hunk';
  if (line.startsWith('+')) return 'dl-add';
  if (line.startsWith('-')) return 'dl-del';
  return 'dl-ctx';
}

export function renderDiff(diffText) {
  const text = typeof diffText === 'string' ? diffText.replace(/\n$/, '') : '';
  if (!text) return '<p class="muted">No diff — this commit touched only Frame bookkeeping.</p>';
  const lines = text.split('\n').map(
    (line) => `<span class="${diffLineClass(line)}">${escapeHtml(line) || '&nbsp;'}</span>`
  );
  return `<pre class="diff">${lines.join('\n')}</pre>`;
}

// A task is only as trustworthy as its check. "not run" is stated plainly
// rather than dressed up as a pass — see the missing-verification rule.
export function renderVerification(verification) {
  if (!verification || !verification.status || verification.status === 'none') {
    return '<span class="pill warn">not verified</span>';
  }
  const cls = verification.status === 'pass' ? 'good' : verification.status === 'fail' ? 'bad' : 'warn';
  const command = verification.command ? ` <code>${escapeHtml(verification.command)}</code>` : '';
  const detail = verification.detail ? ` <span class="muted">${escapeHtml(verification.detail)}</span>` : '';
  return `<span class="pill ${cls}">${escapeHtml(verification.status)}</span>${command}${detail}`;
}

export function renderTask(task) {
  const id = escapeHtml(task.id || '');
  const commit = task.commit
    ? `<span class="chip">${escapeHtml(task.commit)}</span>`
    : '<span class="pill warn">uncommitted</span>';
  const why = task.whyChanged
    ? `<div class="field"><span class="label">Why</span><p>${escapeHtml(task.whyChanged)}</p></div>`
    : '';
  return `<section class="card">
  <header class="card-head">
    <span class="card-id">${id}</span>
    <h2>${escapeHtml(task.title || '')}</h2>
    <span class="card-meta">${commit}${renderVerification(task.verification)}</span>
  </header>
  <div class="card-body">
    <div class="field"><span class="label">What changed</span><p>${escapeHtml(task.whatChanged || '')}</p></div>
    ${why}
    <details${task.diff ? '' : ' open'}>
      <summary>Diff</summary>
      ${renderDiff(task.diff)}
    </details>
  </div>
</section>`;
}

/**
 * The whole transform: report data (each task carrying its already-fetched
 * `diff` string) in, one self-contained HTML document out.
 */
export function renderReport(data) {
  const spec = (data && data.spec) || {};
  const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  const title = escapeHtml(spec.title || spec.slug || 'Spec');
  const generatedAt = escapeHtml(data && data.generatedAt ? data.generatedAt : '');
  const verified = tasks.filter((t) => t.verification && t.verification.status === 'pass').length;
  const unverified = tasks.length - verified;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Implementation Report</title>
<style>
  /* Frame's design system, dark theme — variable names and values copied
     from src/renderer/styles/variables.css so a drift there is a one-line
     diff here. Layout follows the app's dashboards: a gradient header bar
     over a bg-deep page, content in bordered cards with a tinted head strip.
     Diff rows use the system's dedicated diff colours rather than the
     semantic success/error pair — a changed line is not a status. */
  :root{
    --bg-deep:#0f0f10;--bg-primary:#151516;--bg-secondary:#1a1a1c;--bg-tertiary:#222225;
    --text-primary:#e8e6e3;--text-secondary:#a09b94;--text-tertiary:#6b6660;
    --accent-primary:#d4a574;--accent-subtle:rgba(212,165,116,0.15);
    --success:#7cb382;--warning:#e0a458;--error:#d47878;--info:#78a5d4;
    --diff-ins-bg:rgba(63,185,80,0.15);--diff-del-bg:rgba(248,81,73,0.15);--diff-fg:#c9d1d9;
    --border-subtle:rgba(255,255,255,0.06);--border-default:rgba(255,255,255,0.08);
    --shadow-sm:0 1px 2px rgba(0,0,0,0.3);
    --space-xs:4px;--space-sm:8px;--space-md:12px;--space-lg:16px;--space-xl:24px;
    --radius-sm:6px;--radius-md:8px;--radius-lg:12px;
    --font-sans:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;
    --font-mono:'JetBrains Mono','SF Mono',Consolas,monospace;
    color-scheme:dark;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:var(--font-sans);background:var(--bg-deep);color:var(--text-primary);line-height:1.55;}

  /* Header bar — the app's dashboard header, verbatim in spirit. */
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-md);flex-wrap:wrap;
    padding:var(--space-lg) var(--space-xl);border-bottom:1px solid var(--border-subtle);
    background:linear-gradient(180deg,var(--bg-secondary) 0%,var(--bg-primary) 100%);}
  .topbar-title{display:flex;align-items:center;gap:var(--space-md);min-width:0;}
  .logo{width:28px;height:28px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);
    display:block;flex-shrink:0;}
  .brand{font-size:16px;font-weight:700;letter-spacing:-0.2px;color:var(--accent-primary);}
  .brand-sep{width:1px;align-self:stretch;background:var(--border-default);flex-shrink:0;}
  .doc-block{display:flex;flex-direction:column;align-items:flex-start;gap:5px;}
  .doc-type{font-size:14px;font-weight:600;color:var(--text-primary);
    text-transform:uppercase;letter-spacing:.08em;}
  .topbar-meta{display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;}

  .wrap{max-width:1100px;margin:0 auto;padding:var(--space-xl) var(--space-lg);
    display:flex;flex-direction:column;gap:var(--space-lg);}

  /* Report head — the spec's full name lives here, not in the topbar, so the
     bar stays a stable brand strip while the title gets document scale. */
  .report-head{padding:var(--space-md) 0 var(--space-xs);}
  .slug-chip{font-family:var(--font-mono);font-size:11.5px;font-weight:600;
    color:var(--accent-primary);background:var(--accent-subtle);
    border:1px solid rgba(212,165,116,0.35);padding:3px 10px;border-radius:999px;}
  .report-head h1{font-size:27px;font-weight:700;letter-spacing:-0.6px;
    line-height:1.25;color:var(--text-primary);max-width:900px;}

  .chip{font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);
    background:var(--bg-tertiary);border:1px solid var(--border-subtle);
    padding:3px 8px;border-radius:var(--radius-sm);}
  .pill{display:inline-block;font-size:11px;color:var(--text-secondary);
    background:var(--bg-tertiary);border:1px solid var(--border-subtle);
    padding:3px 10px;border-radius:999px;}
  .pill.good{color:var(--success);border-color:var(--success);}
  .pill.warn{color:var(--warning);border-color:var(--warning);}
  .pill.bad{color:var(--error);border-color:var(--error);}

  .card{background:var(--bg-secondary);border:1px solid var(--border-default);
    border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);overflow:hidden;}
  .card-head{display:flex;align-items:center;gap:var(--space-md);flex-wrap:wrap;
    padding:var(--space-md) var(--space-lg);background:var(--bg-tertiary);
    border-bottom:1px solid var(--border-subtle);}
  .card-id{font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--accent-primary);
    background:var(--accent-subtle);padding:2px 8px;border-radius:var(--radius-sm);}
  .card-head h2{font-size:14px;font-weight:600;letter-spacing:-0.2px;color:var(--text-primary);flex:1;min-width:180px;}
  .card-meta{display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;}
  .card-body{padding:var(--space-lg);}

  .field{margin-bottom:var(--space-md);}
  .label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
    color:var(--text-tertiary);margin-bottom:2px;}
  .field p{font-size:13.5px;color:var(--text-primary);}
  .muted{color:var(--text-secondary);font-size:13px;}
  code{background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:1px 5px;
    font-size:12px;font-family:var(--font-mono);}

  details{border-top:1px solid var(--border-subtle);padding-top:var(--space-md);}
  summary{cursor:pointer;display:inline-flex;align-items:center;gap:var(--space-sm);
    font-size:12px;font-weight:600;color:var(--accent-primary);text-transform:uppercase;
    letter-spacing:.06em;background:var(--accent-subtle);
    border:1px solid rgba(212,165,116,0.35);border-radius:var(--radius-sm);
    padding:6px 14px;list-style:none;user-select:none;}
  summary::-webkit-details-marker{display:none;}
  summary::before{content:'\\25B8';font-size:11px;line-height:1;}
  details[open] summary::before{content:'\\25BE';}
  summary:hover{border-color:var(--accent-primary);background:rgba(212,165,116,0.22);}
  pre.diff{background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--radius-md);
    padding:var(--space-md) 0;font-size:12px;font-family:var(--font-mono);line-height:1.5;
    overflow-x:auto;margin-top:var(--space-sm);display:flex;flex-direction:column;}
  pre.diff span{white-space:pre;padding:0 var(--space-lg);min-width:100%;width:max-content;}
  .dl-add{background:var(--diff-ins-bg);color:var(--diff-fg);}
  .dl-del{background:var(--diff-del-bg);color:var(--diff-fg);}
  .dl-ctx{color:var(--text-secondary);}
  .dl-hunk{color:var(--info);}
  .dl-file{color:var(--text-primary);}
  .dl-meta{color:var(--text-tertiary);}

  footer{color:var(--text-tertiary);font-size:11.5px;text-align:center;
    padding:var(--space-lg);border-top:1px solid var(--border-subtle);}
  @media (max-width:560px){.card-head{gap:var(--space-sm);}.report-head h1{font-size:20px;}}
</style>
</head>
<body>

<header class="topbar">
  <div class="topbar-title">
    <img class="logo" src="${FRAME_LOGO_DATA_URI}" alt="Frame logo">
    <span class="brand">Frame</span>
    <span class="brand-sep"></span>
    <div class="doc-block">
      <span class="doc-type">Spec Implementation Report</span>
      ${spec.slug ? `<span class="slug-chip">${escapeHtml(spec.slug)}</span>` : ''}
    </div>
  </div>
  <div class="topbar-meta">
    <span class="pill">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>
    <span class="pill good">${verified} verified</span>
    ${unverified ? `<span class="pill warn">${unverified} unverified</span>` : ''}
    ${generatedAt ? `<span class="chip">${generatedAt}</span>` : ''}
  </div>
</header>

<div class="wrap">
<section class="report-head">
  <h1>${title}</h1>
</section>
${tasks.length ? tasks.map(renderTask).join('\n\n') : '<section class="card"><div class="card-body"><p class="muted">No tasks recorded yet.</p></div></section>'}
</div>

<footer>Generated by Frame from <code>report-data.json</code> · diffs read from git, never transcribed</footer>
</body>
</html>
`;
}

// ─── Impure: git + filesystem ─────────────────────────────────

/**
 * The commit's diff with Frame's bookkeeping excluded. A hash that git
 * doesn't know — an entry written before its commit landed — yields an
 * empty diff rather than killing the whole report.
 */
export function readCommitDiff(commit, repoRoot) {
  if (!commit) return '';
  const excludes = EXCLUDED_PATHS.map((p) => `:(exclude)${p}`);
  try {
    return execFileSync(
      'git',
      ['show', '--format=', '--no-color', commit, '--', '.', ...excludes],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (err) {
    console.error(`build-implement-report: could not read commit ${commit} — ${err.message}`);
    return '';
  }
}

function repoRootFrom(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch (_) {
    return dir;
  }
}

function main(argv) {
  const dataPath = argv[2];
  if (!dataPath) {
    console.error('usage: build-implement-report.mjs <report-data.json> [out.html]');
    return 1;
  }
  const absData = path.resolve(dataPath);
  const outPath = argv[3] ? path.resolve(argv[3]) : path.join(path.dirname(absData), 'implement-report.html');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(absData, 'utf8'));
  } catch (err) {
    console.error(`build-implement-report: cannot read ${absData} — ${err.message}`);
    return 1;
  }

  const repoRoot = repoRootFrom(path.dirname(absData));
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).map(
    (task) => ({ ...task, diff: readCommitDiff(task.commit, repoRoot) })
  );

  // Stamped here, not in the transform — renderReport stays a pure function
  // of its input, which is what makes it testable without a clock.
  const generatedAt = data.generatedAt || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(outPath, renderReport({ ...data, generatedAt, tasks }), 'utf8');
  console.log(outPath);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
