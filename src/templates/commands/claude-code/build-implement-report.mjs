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
  .mark{font-size:18px;color:var(--accent-primary);line-height:1;}
  h1{font-size:18px;font-weight:600;letter-spacing:-0.3px;color:var(--text-primary);}
  .topbar-meta{display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;}

  .wrap{max-width:1100px;margin:0 auto;padding:var(--space-xl) var(--space-lg);
    display:flex;flex-direction:column;gap:var(--space-lg);}

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

  details{border-top:1px solid var(--border-subtle);padding-top:var(--space-sm);}
  summary{cursor:pointer;font-size:10.5px;color:var(--text-tertiary);text-transform:uppercase;
    letter-spacing:.06em;padding:var(--space-xs) 0;}
  summary:hover{color:var(--text-primary);}
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
  @media (max-width:560px){.card-head{gap:var(--space-sm);}h1{font-size:16px;}}
</style>
</head>
<body>

<header class="topbar">
  <div class="topbar-title">
    <span class="mark">&#10022;</span>
    <h1>${title}</h1>
    <span class="chip">implementation report</span>
  </div>
  <div class="topbar-meta">
    ${spec.slug ? `<span class="chip">.frame/specs/${escapeHtml(spec.slug)}/</span>` : ''}
    <span class="pill">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>
    <span class="pill good">${verified} verified</span>
    ${unverified ? `<span class="pill warn">${unverified} unverified</span>` : ''}
    ${generatedAt ? `<span class="chip">${generatedAt}</span>` : ''}
  </div>
</header>

<div class="wrap">
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
