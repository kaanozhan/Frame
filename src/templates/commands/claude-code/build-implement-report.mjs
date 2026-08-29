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
import { execFileSync, spawn } from 'node:child_process';
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

// Frame's app icon (assets/icon.png), inlined as vector rather than
// referenced, because the report must stay a single self-contained file: it is
// opened from disk and attached to PRs, so a relative asset path would break
// the moment it leaves the repo. Vector rather than a downscaled raster so it
// stays crisp on any display and costs ~700 bytes instead of nine kilobytes.
// The badge's two colours are literal on purpose — a logo does not answer to
// the theme. Regenerate the geometry from assets/icon.png if the icon changes.
export const FRAME_MARK_SVG = '<svg class="rpt-mark" viewBox="0 0 24 24" aria-hidden="true">'
  + '<rect x="1" y="1" width="22" height="22" rx="5" fill="#14120e" stroke="currentColor" stroke-width="0.75"/><g fill="#f2eee4" transform="translate(5.4 5.4) scale(0.55)"><path d="M2 2h9v2.6H4.6V11H2V2Z"/><path d="M22 2v9h-2.6V4.6H13V2h9Z"/><path d="M2 22v-9h2.6v6.4H11V22H2Z"/><path d="M22 22h-9v-2.6h6.4V13H22v9Z"/></g>'
  + '</svg>';

/**
 * The shared report shell: Frame's tokens in both themes plus the header
 * rules, carried identically here and in plan-report-template.html. Kept as
 * one string so the block this file emits is the same bytes the parity test
 * reads out of the template.
 */
export const REPORT_SHELL_CSS = `/* ── frame report shell v1 ── */
/* Frame's design tokens and report header, carried byte-for-byte by both
   report assets: build-implement-report.mjs and plan-report-template.html.
   test/implementReport.test.js asserts the two copies are identical — edit
   both, or edit neither. The markers are load-bearing three times over: the
   parity test finds the block by them, the in-app viewer detects a pre-shell
   report by their absence, and a future revision bumps the version in one grep.

   Values are copied from src/renderer/styles/variables.css, so a report
   rendered inside Frame is the same colour as the window around it. Dark sits
   on the bare :root; light arrives two ways — an explicit data-theme="light"
   (what the in-app viewer stamps on this document) and the reader's own system
   preference when the file is opened straight from disk. The light values are
   written twice because CSS cannot share a declaration block between two
   selectors and light-dark() is Chromium 123+, above the Electron 28 runtime
   this has to render in.

   Header classes are prefixed rpt- so they cannot collide with either
   report's own body CSS. */
:root{
  color-scheme:light dark;
  --bg-deep:#0c0b09;--bg-primary:#14120e;--bg-secondary:#1c1915;--bg-tertiary:#242019;
  --bg-elevated:#2a2620;--bg-hover:#332e25;
  --text-primary:#f2eee4;--text-secondary:#c4bcac;--text-tertiary:#948c7c;--text-muted:#5c564a;
  --accent-primary:#8ff0ae;--accent-secondary:#6fd693;
  --accent-subtle:rgba(143,240,174,0.15);--accent-glow:rgba(143,240,174,0.08);
  --success:#9bdca8;--success-subtle:rgba(155,220,168,0.15);
  --warning:#e5cd8e;--warning-ink:#e5cd8e;
  --error:#e8938a;--error-subtle:rgba(232,147,138,0.15);--info:#a6c0f0;
  --diff-ins-bg:rgba(63,185,80,0.15);--diff-ins-fg:#c9d1d9;
  --diff-del-bg:rgba(248,81,73,0.15);--diff-del-fg:#c9d1d9;
  --border-subtle:#221e18;--border-default:#2a2620;--border-strong:#3a342b;
  --shadow-sm:0 1px 2px rgba(0,0,0,0.3);--shadow-md:0 4px 12px rgba(0,0,0,0.4);
  --space-xs:4px;--space-sm:6px;--space-md:10px;--space-lg:14px;--space-xl:20px;
  --radius-sm:4px;--radius-md:5px;--radius-lg:6px;--radius-xl:8px;
  --font-sans:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --font-mono:'JetBrains Mono','SF Mono','Consolas',monospace;
}
:root[data-theme="light"]{
  --bg-deep:#f0ede8;--bg-primary:#f7f5f2;--bg-secondary:#ede9e3;--bg-tertiary:#e5e0d8;
  --bg-elevated:#dbd5cb;--bg-hover:#d4cdc2;
  --text-primary:#1c1a18;--text-secondary:#5a5550;--text-tertiary:#8a8480;--text-muted:#b0aba5;
  --accent-primary:#286b44;--accent-secondary:#1f5a37;
  --accent-subtle:rgba(47,125,79,0.12);--accent-glow:rgba(47,125,79,0.08);
  --success:#3e6843;--success-subtle:rgba(74,124,80,0.12);
  --warning:#c07820;--warning-ink:#815015;
  --error:#a43939;--error-subtle:rgba(184,64,64,0.12);--info:#376090;
  --diff-ins-bg:#e6ffec;--diff-ins-fg:#24292f;
  --diff-del-bg:#ffebe9;--diff-del-fg:#24292f;
  --border-subtle:rgba(0,0,0,0.07);--border-default:rgba(0,0,0,0.10);--border-strong:rgba(0,0,0,0.15);
  --shadow-sm:0 1px 2px rgba(0,0,0,0.08);--shadow-md:0 4px 12px rgba(0,0,0,0.12);
}
@media (prefers-color-scheme:light){
  :root:not([data-theme="dark"]){
    --bg-deep:#f0ede8;--bg-primary:#f7f5f2;--bg-secondary:#ede9e3;--bg-tertiary:#e5e0d8;
    --bg-elevated:#dbd5cb;--bg-hover:#d4cdc2;
    --text-primary:#1c1a18;--text-secondary:#5a5550;--text-tertiary:#8a8480;--text-muted:#b0aba5;
    --accent-primary:#286b44;--accent-secondary:#1f5a37;
    --accent-subtle:rgba(47,125,79,0.12);--accent-glow:rgba(47,125,79,0.08);
    --success:#3e6843;--success-subtle:rgba(74,124,80,0.12);
    --warning:#c07820;--warning-ink:#815015;
    --error:#a43939;--error-subtle:rgba(184,64,64,0.12);--info:#376090;
    --diff-ins-bg:#e6ffec;--diff-ins-fg:#24292f;
    --diff-del-bg:#ffebe9;--diff-del-fg:#24292f;
    --border-subtle:rgba(0,0,0,0.07);--border-default:rgba(0,0,0,0.10);--border-strong:rgba(0,0,0,0.15);
    --shadow-sm:0 1px 2px rgba(0,0,0,0.08);--shadow-md:0 4px 12px rgba(0,0,0,0.12);
  }
}

/* Header — a stable brand strip (mark, wordmark, document type, slug) on the
   left, the report's own headline pills on the right; the document title gets
   its own scale below in .rpt-head rather than crowding the bar. */
.rpt-topbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-md);
  flex-wrap:wrap;padding:var(--space-lg) var(--space-xl);
  border-bottom:1px solid var(--border-subtle);
  background:linear-gradient(180deg,var(--bg-secondary) 0%,var(--bg-primary) 100%);}
.rpt-ident{display:flex;align-items:center;gap:var(--space-md);min-width:0;}
/* The app icon (assets/icon.png), drawn as vector: a fixed charcoal badge
   with parchment brackets — a logo, so it does not answer to the theme. Only
   its hairline edge does, via currentColor, because the badge fill is exactly
   --bg-primary in dark and would otherwise vanish into the page. */
.rpt-mark{width:26px;height:26px;display:block;flex-shrink:0;color:var(--border-strong);}
.rpt-brand{font-size:16px;font-weight:700;letter-spacing:-0.2px;color:var(--accent-primary);}
.rpt-sep{width:1px;align-self:stretch;background:var(--border-strong);flex-shrink:0;}
.rpt-doc{display:flex;flex-direction:column;align-items:flex-start;gap:5px;}
.rpt-doc-type{font-size:14px;font-weight:600;color:var(--text-primary);
  text-transform:uppercase;letter-spacing:.08em;}
.rpt-slug{font-family:var(--font-mono);font-size:11.5px;font-weight:600;
  color:var(--accent-primary);background:var(--accent-subtle);
  border:1px solid var(--accent-primary);padding:3px 10px;border-radius:999px;}
.rpt-meta{display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;}
.rpt-pill{display:inline-block;font-size:11px;color:var(--text-secondary);
  background:var(--bg-tertiary);border:1px solid var(--border-default);
  padding:3px 10px;border-radius:999px;}
.rpt-pill.good{color:var(--success);border-color:var(--success);}
.rpt-pill.warn{color:var(--warning-ink);border-color:var(--warning);}
.rpt-pill.bad{color:var(--error);border-color:var(--error);}
.rpt-chip{font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);
  background:var(--bg-tertiary);border:1px solid var(--border-subtle);
  padding:3px 8px;border-radius:var(--radius-sm);}
.rpt-head{padding:var(--space-md) 0 var(--space-xs);}
.rpt-head h1{font-size:27px;font-weight:700;letter-spacing:-0.6px;line-height:1.25;
  color:var(--text-primary);max-width:900px;}
@media (max-width:560px){.rpt-head h1{font-size:20px;}}
/* Embedded in Frame (the viewer stamps data-host on this document, the same
   way it stamps data-theme). The app already names the document in its chip
   and its section header, so the report's own brand strip and headline would
   be the second and third telling. The file on disk is untouched: opened
   standalone, or attached to a PR, none of this applies. */
:root[data-host="frame"] .rpt-mark,
:root[data-host="frame"] .rpt-brand,
:root[data-host="frame"] .rpt-sep,
:root[data-host="frame"] .rpt-doc-type{display:none;}
:root[data-host="frame"] .rpt-topbar{padding:var(--space-sm) var(--space-lg);}
:root[data-host="frame"] .rpt-head h1{display:none;}
:root[data-host="frame"] .rpt-head:empty,
:root[data-host="frame"] .rpt-head{padding-top:0;}
/* ── end frame report shell v1 ── */`;

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

/**
 * The run-status banner at the top of the report — the one thing that makes a
 * report worth reloading. `progress` is the pure { total, completed, current }
 * shape from computeProgress; main() reads it from tasks.json so this stays a
 * function of its argument. No progress (no data, no matching tasks) → no
 * banner, which is exactly right for a report opened outside a live run.
 *
 * While tasks remain the banner names how far along the run is and which task
 * is next, and tells the reader the page is regenerated so a reload follows the
 * run live. Once every task is done that note would be stale advice, so the
 * complete state drops it.
 */
// Inline (no external asset — the report is one self-contained file) info
// glyph for the reload note; `currentColor` lets it inherit the note's colour.
const INFO_ICON = '<svg class="rs-info" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
  + '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<circle cx="8" cy="4.7" r="1" fill="currentColor"/>'
  + '<rect x="7.15" y="6.9" width="1.7" height="5.2" rx="0.85" fill="currentColor"/></svg>';

// Task titles can run long — a spec's tasks.json title is often a full
// sentence — and the banner is a one-line status, not a description. Clamp on a
// word boundary so "next: T09 — …" stays scannable.
export function truncateTitle(title, max = 72) {
  const text = String(title == null ? '' : title).trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s—–,.:;-]+$/, '') + '…';
}

export function renderProgress(progress) {
  if (!progress || typeof progress.total !== 'number' || progress.total <= 0) return '';
  const total = progress.total;
  const completed = typeof progress.completed === 'number' ? progress.completed : 0;

  if (completed >= total) {
    return `<div class="run-status done">
  <span class="rs-badge">Complete</span>
  <span class="rs-count">${completed} of ${total} task${total === 1 ? '' : 's'} done</span>
</div>`;
  }

  const cur = progress.current;
  const title = cur && cur.title ? truncateTitle(cur.title) : '';
  const next = cur && cur.id
    ? ` · next: <span class="rs-task">${escapeHtml(cur.id)}${title ? ' — ' + escapeHtml(title) : ''}</span>`
    : '';
  return `<div class="run-status live">
  <span class="rs-badge">In progress</span>
  <span class="rs-count">${completed} of ${total} tasks done${next}</span>
  <span class="rs-note">${INFO_ICON}Regenerated after each task. Reload for the latest.</span>
</div>`;
}

/**
 * The empty state — what the report shows before its first task lands. In the
 * report modes Frame writes an empty report-data.json and opens this page
 * before the run starts, so the reader sees the report waiting rather than a
 * dead "No tasks recorded yet" line. It names what will appear here as the run
 * turns, so an empty page reads as "ready", not "broken". The run-status
 * banner above still shows 0-of-N when tasks.json already holds the spec's
 * tasks, so the two together say "created, nothing done yet".
 */
// Inline (no external asset — the report is one self-contained file) document
// glyph; `currentColor` lets it inherit the empty-state's accent colour.
const EMPTY_ICON = '<svg class="es-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">'
  + '<rect x="9" y="6" width="30" height="36" rx="4" stroke="currentColor" stroke-width="2"/>'
  + '<path d="M16 16h16M16 24h16M16 32h10" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" opacity="0.55"/></svg>';

export function renderEmptyState() {
  return `<section class="empty-state">
  ${EMPTY_ICON}
  <h2>No tasks recorded yet</h2>
  <p>The report is ready and waiting for the run to begin. Each task appears here
  the moment it lands — what changed, why it changed that way, whether its check
  passed, and the exact diff read from the commit.</p>
  <p class="es-note">The page regenerates after every task, so reload to watch the run fill in.</p>
</section>`;
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
  const progress = data && data.progress;
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
${REPORT_SHELL_CSS}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:var(--font-sans);background:var(--bg-deep);color:var(--text-primary);line-height:1.55;}

  .wrap{max-width:1100px;margin:0 auto;padding:var(--space-xl) var(--space-lg);
    display:flex;flex-direction:column;gap:var(--space-lg);}

  .chip{font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);
    background:var(--bg-tertiary);border:1px solid var(--border-subtle);
    padding:3px 8px;border-radius:var(--radius-sm);}
  .pill{display:inline-block;font-size:11px;color:var(--text-secondary);
    background:var(--bg-tertiary);border:1px solid var(--border-subtle);
    padding:3px 10px;border-radius:999px;}
  .pill.good{color:var(--success);border-color:var(--success);}
  .pill.warn{color:var(--warning-ink);border-color:var(--warning);}
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
    border:1px solid var(--accent-primary);border-radius:var(--radius-sm);
    padding:6px 14px;list-style:none;user-select:none;}
  summary::-webkit-details-marker{display:none;}
  summary::before{content:'\\25B8';font-size:11px;line-height:1;}
  details[open] summary::before{content:'\\25BE';}
  summary:hover{border-color:var(--accent-secondary);background:var(--accent-glow);}
  pre.diff{background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--radius-md);
    padding:var(--space-md) 0;font-size:12px;font-family:var(--font-mono);line-height:1.5;
    overflow-x:auto;margin-top:var(--space-sm);display:flex;flex-direction:column;}
  pre.diff span{white-space:pre;padding:0 var(--space-lg);min-width:100%;width:max-content;}
  .dl-add{background:var(--diff-ins-bg);color:var(--diff-ins-fg);}
  .dl-del{background:var(--diff-del-bg);color:var(--diff-del-fg);}
  .dl-ctx{color:var(--text-secondary);}
  .dl-hunk{color:var(--info);}
  .dl-file{color:var(--text-primary);}
  .dl-meta{color:var(--text-tertiary);}

  /* Run-status banner — a live run's progress at the top of the report, the
     reason a terminal-launched run's report is worth reloading. Live borrows
     the accent tint; complete switches to success. */
  .run-status{display:flex;align-items:center;gap:var(--space-sm) var(--space-md);flex-wrap:wrap;
    padding:var(--space-md) var(--space-lg);border-radius:var(--radius-lg);
    border:1px solid var(--border-default);background:var(--bg-secondary);font-size:13px;}
  .run-status.live{border-color:var(--accent-primary);background:var(--accent-subtle);}
  .run-status.done{border-color:var(--success);background:var(--success-subtle);}
  .rs-badge{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
    padding:3px 10px;border-radius:999px;flex-shrink:0;}
  .run-status.live .rs-badge{color:var(--accent-primary);background:var(--accent-subtle);
    border:1px solid var(--accent-primary);}
  .run-status.done .rs-badge{color:var(--success);background:var(--success-subtle);
    border:1px solid var(--success);}
  .rs-count{color:var(--text-primary);font-weight:500;min-width:0;}
  .rs-task{font-family:var(--font-mono);font-size:12px;color:var(--accent-primary);}
  .rs-note{color:var(--text-primary);font-size:12px;margin-left:auto;
    display:inline-flex;align-items:center;gap:6px;}
  .rs-info{flex-shrink:0;opacity:0.85;}

  /* Empty state — the report before its first task. A dashed border reads as
     a placeholder rather than a finished card; the icon and copy tell the
     reader the page is waiting, not empty by mistake. */
  .empty-state{display:flex;flex-direction:column;align-items:center;text-align:center;
    gap:var(--space-md);padding:var(--space-xl) var(--space-lg);
    background:var(--bg-secondary);border:1px dashed var(--border-default);
    border-radius:var(--radius-lg);color:var(--accent-primary);}
  .es-icon{width:44px;height:44px;opacity:0.85;}
  .empty-state h2{font-size:16px;font-weight:600;letter-spacing:-0.2px;color:var(--text-primary);}
  .empty-state p{font-size:13.5px;color:var(--text-secondary);max-width:480px;line-height:1.6;}
  .empty-state .es-note{font-size:12px;color:var(--text-tertiary);}

  /* Embedded, these two are not noise but wrong: the viewer follows the file
     on its own and carries a Refresh button, so nobody reloads anything. */
  :root[data-host="frame"] .rs-note,
  :root[data-host="frame"] .es-note{display:none;}

  footer{color:var(--text-tertiary);font-size:11.5px;text-align:center;
    padding:var(--space-lg);border-top:1px solid var(--border-subtle);}
  @media (max-width:560px){.card-head{gap:var(--space-sm);}.rs-note{margin-left:0;}}
</style>
</head>
<body>

<header class="rpt-topbar">
  <div class="rpt-ident">
    ${FRAME_MARK_SVG}
    <span class="rpt-brand">Frame</span>
    <span class="rpt-sep"></span>
    <div class="rpt-doc">
      <span class="rpt-doc-type">Spec Implementation Report</span>
      ${spec.slug ? `<span class="rpt-slug">${escapeHtml(spec.slug)}</span>` : ''}
    </div>
  </div>
  <div class="rpt-meta">
    <span class="rpt-pill">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>
    <span class="rpt-pill good">${verified} verified</span>
    ${unverified ? `<span class="rpt-pill warn">${unverified} unverified</span>` : ''}
    ${generatedAt ? `<span class="rpt-chip">${generatedAt}</span>` : ''}
  </div>
</header>

<div class="wrap">
${renderProgress(progress)}
<section class="rpt-head">
  <h1>${title}</h1>
</section>
${tasks.length ? tasks.map(renderTask).join('\n\n') : renderEmptyState()}
</div>

<footer>Generated by Frame from <code>report-data.json</code> · diffs read from git, never transcribed</footer>
</body>
</html>
`;
}

/**
 * Reduce a parsed tasks.json `tasks` array to the report's progress shape for
 * one spec: how many of its tasks are done, and which one is live. Pure — main()
 * reads the file and hands the array in, so this is testable without disk.
 *
 * `current` is the in-progress task if one is marked, else the next pending one
 * — at report-generation time (right after a commit) the just-finished task is
 * already `completed` and the next isn't `in_progress` yet, so "next pending" is
 * what the reader actually wants to see coming. No matching tasks → null, and
 * the banner disappears rather than inventing a run.
 */
export function computeProgress(tasks, slug) {
  if (!Array.isArray(tasks) || !slug) return null;
  const prefix = `spec:${slug}:`;
  const specTasks = tasks.filter(
    (t) => t && typeof t.source === 'string' && t.source.startsWith(prefix)
  );
  if (!specTasks.length) return null;

  const idOf = (t) => t.source.slice(prefix.length);          // "spec:slug:T09" → "T09"
  const numOf = (t) => { const m = /T(\d+)/.exec(idOf(t)); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };
  specTasks.sort((a, b) => numOf(a) - numOf(b));

  const total = specTasks.length;
  const completed = specTasks.filter((t) => t.status === 'completed').length;
  const active = specTasks.find((t) => t.status === 'in_progress')
    || specTasks.find((t) => t.status === 'pending')
    || null;
  const current = active ? { id: idOf(active), title: active.title || '' } : null;
  return { total, completed, current };
}

// Split argv into the two positionals (data path, optional out path) and the
// `--open` flag, which may sit anywhere. Pure so the parsing is testable.
export function parseArgs(argv) {
  const positional = [];
  let open = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--open') open = true;
    else positional.push(arg);
  }
  return { dataPath: positional[0], outPath: positional[1], open };
}

// The platform's "open this file in its default app" command. Pure so the
// per-platform mapping is testable without spawning anything.
export function openCommand(platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', ''] };
  return { cmd: 'xdg-open', args: [] };
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

// The repo's tasks.json `tasks` array, or [] if it can't be read — the banner
// is a convenience layered on the report, never a reason to fail it. `.frame/`
// first, the project root second: a project that has not migrated yet still
// keeps its tasks.json where it always was.
export function readTasks(repoRoot) {
  for (const candidate of [path.join(repoRoot, '.frame', 'tasks.json'), path.join(repoRoot, 'tasks.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return Array.isArray(parsed.tasks) ? parsed.tasks : [];
    } catch (_) {
      /* try the next one */
    }
  }
  return [];
}

// Open the finished report in the default browser, detached so it never blocks
// the implement loop and best-effort so a headless box (no `open`/`xdg-open`)
// costs the convenience, not the run. Nothing downstream depends on it.
function openInBrowser(filePath, platform = process.platform) {
  try {
    const { cmd, args } = openCommand(platform);
    const child = spawn(cmd, [...args, filePath], { stdio: 'ignore', detached: true });
    child.on('error', () => {});   // ENOENT etc. must not throw past here
    child.unref();
  } catch (_) { /* best effort */ }
}

function main(argv) {
  const { dataPath, outPath: outArg, open } = parseArgs(argv);
  if (!dataPath) {
    console.error('usage: build-implement-report.mjs [--open] <report-data.json> [out.html]');
    return 1;
  }
  const absData = path.resolve(dataPath);
  const outPath = outArg ? path.resolve(outArg) : path.join(path.dirname(absData), 'implement-report.html');

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

  // Progress is read from tasks.json — the canonical run state — not transcribed
  // into report-data.json, for the same reason diffs are read from git: the one
  // source that can't drift is the one that isn't copied.
  const slug = (data.spec && data.spec.slug) || '';
  const progress = slug ? computeProgress(readTasks(repoRoot), slug) : null;

  // Stamped here, not in the transform — renderReport stays a pure function
  // of its input, which is what makes it testable without a clock.
  const generatedAt = data.generatedAt || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(outPath, renderReport({ ...data, generatedAt, tasks, progress }), 'utf8');
  console.log(outPath);

  // Opening is the last thing and never gates success — the report is already
  // written and its path already printed by the time we try.
  if (open) openInBrowser(outPath);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
