/**
 * Report Section Module
 *
 * Opens a spec's generated HTML report — `plan-report.html` from /spec.plan or
 * `implement-report.html` from /spec.implement — as a *section viewport* (a tab
 * next to Home / Frames), instead of handing the file to the system browser.
 * One report tab is reused and navigated in place, the way a diff tab is: open
 * another spec's report and this viewport switches to it rather than spawning
 * a second chip.
 *
 * The file's text comes from main (`READ_SPEC_REPORT`) — the renderer never
 * touches fs — and is handed to an iframe as `srcdoc`. The report itself is
 * unchanged markup and CSS: nothing is parsed, rewritten or sanitised here,
 * so what the reader sees in the app is byte-for-byte the file on disk.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let host = null; // multiTerminalUI
let seq = 0;

/**
 * The shared report shell's opening marker. Its presence is what says a report
 * carries both palettes and will answer to a data-theme; the ~23 reports
 * generated before this spec do not, and are shown as they are.
 */
const SHELL_MARKER = '── frame report shell v1 ──';

/**
 * The app's current theme. terminalTabBar always writes the attribute (it
 * defaults to 'dark' on boot), so the fallback is belt-and-braces rather than
 * a second source of truth.
 */
function appTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

/** The two report kinds, as the reader should see them named. */
const DOC_TYPE = {
  plan: 'Plan Report',
  implement: 'Implementation Report'
};

/**
 * The chip's version of the same names. Two reports from different specs can
 * be open at once, so the chip has to say *which* — and the doc type leads,
 * because the label truncates from the right and the tooltip carries the rest.
 */
const CHIP_TYPE = {
  plan: 'Plan',
  implement: 'Implementation'
};

function setHost(h) {
  host = h;
}

/**
 * Open a spec's report.
 *
 * A report is identified by the spec it belongs to *and* which of the two
 * documents it is. Re-opening the same one returns to its tab; anything else
 * gets its own. That is deliberately not diffSection's rule, which navigates
 * one viewport in place: a diff tab browses one ordered set of files, whereas
 * a plan report and an implementation report are two different documents about
 * the same spec, and reports from two specs are unrelated entirely. Reusing one
 * viewport for all of them meant every open overwrote the last.
 *
 * `background: true` opens the tab without taking the foreground — the chip
 * appears in the rail and the user's current view is left alone. A report the
 * user asked for by clicking comes to the front; one that arrives because some
 * run elsewhere finished does not.
 *
 * @param {{ projectPath: string, slug: string, title?: string, kind: 'plan'|'implement' }} ref
 * @param {{ background?: boolean }} [opts]
 */
function open(ref, opts) {
  if (!host || !ref || !ref.slug || !DOC_TYPE[ref.kind]) return;
  const background = !!(opts && opts.background);

  const already = (host.sections || []).find(
    (s) => s && s.type === 'report' && typeof s.matches === 'function' && s.matches(ref)
  );
  if (already) {
    // Already open: a background call leaves it exactly where it is rather
    // than yanking the user to a tab they already have.
    if (!background) host.activateSection(already.key);
    return;
  }
  host.openSection('report', ref, api, { newTab: true, activate: !background });
}

function createViewport() {
  const key = `report-vp:${++seq}`;
  let cur = null;        // { projectPath, slug, title, kind }
  let reportHtml = '';
  let reportPath = '';   // the file on disk, for the Open in browser hatch
  let mtimeMs = 0;
  let loading = false;
  let message = '';      // shown in place of the frame: not generated yet, or a read error
  let reqId = 0;
  let container = null;
  let frameEl = null;      // the live iframe, so the observer can re-stamp it
  let hasShell = false;    // does this report answer to a data-theme at all?

  /**
   * Put the app's theme on the report's own documentElement.
   *
   * This is the whole reason the frame is same-origin. Guarded because the
   * document may not be there yet (a frame torn down mid-load) and because a
   * cross-origin read throws: a report that cannot be stamped should render
   * unthemed, never take the section's render down with it.
   */
  function _stampTheme() {
    if (!frameEl || !hasShell) return;
    try {
      const doc = frameEl.contentDocument;
      if (!doc || !doc.documentElement) return;
      doc.documentElement.setAttribute('data-theme', appTheme());
      // Says "you are embedded". The shell drops its brand strip and headline
      // under this, because the chip and the section header already name the
      // document — three tellings before a word of content. The file on disk
      // never carries the attribute, so standalone and PR views are untouched.
      doc.documentElement.setAttribute('data-host', 'frame');
    } catch (_) { /* unthemed is a fine outcome; a thrown render is not */ }
  }

  // The toggle lives in the top bar and writes data-theme on the app's root —
  // the same signal terminalManager watches for the xterm theme. Watching it
  // means an open report follows the toggle with no reload of the file.
  const themeObserver = new MutationObserver(_stampTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /**
   * The autonomous implement mode regenerates implement-report.html after
   * every task. SPEC_DATA is the closest thing to a signal that it happened —
   * tasks.json changes with each task, so the push does arrive during a run —
   * but the payload carries no report mtime, so the push says "something
   * about this spec moved", not "the report was rewritten". Re-read on it and
   * let mtimeMs decide: a push that did not touch the file re-renders nothing,
   * so the reader's scroll survives an unrelated status change.
   */
  const onSpecData = () => { _refresh(true); };
  ipcRenderer.on(IPC.SPEC_DATA, onSpecData);

  function navigate(ref) {
    if (!ref) return;
    cur = {
      projectPath: ref.projectPath,
      slug: ref.slug,
      title: ref.title || ref.slug,
      kind: ref.kind
    };
    _load(false);
  }

  /**
   * Read the report and re-render through the host.
   *
   * `silent` keeps the current report on screen while a re-read runs, so a
   * background refresh never flickers a "Loading…" over the reader's scroll
   * position — the same posture diffSection takes on a git refresh. `notify`
   * is what lets _refresh decide *afterwards* whether the result was worth a
   * re-render; without it every background read would redraw the frame and
   * throw the reader's scroll away, which is exactly what the mtime gate is
   * there to prevent.
   */
  async function _load(silent, notify = true) {
    if (!cur) return;
    const id = ++reqId;
    if (!silent) {
      loading = true;
      message = '';
      reportHtml = '';
      if (host) host.notifySectionChanged();
    }

    let result;
    try {
      result = await ipcRenderer.invoke(IPC.READ_SPEC_REPORT, {
        projectPath: cur.projectPath,
        slug: cur.slug,
        kind: cur.kind
      });
    } catch (err) {
      if (id !== reqId) return;
      loading = false;
      reportHtml = '';
      message = `Failed to read the report: ${err && err.message ? err.message : err}`;
      if (host && notify) host.notifySectionChanged();
      return;
    }
    if (id !== reqId) return; // superseded by a newer navigate

    loading = false;
    reportPath = (result && result.path) || '';
    if (result && result.success) {
      reportHtml = result.html || '';
      hasShell = reportHtml.includes(SHELL_MARKER);
      mtimeMs = result.mtimeMs || 0;
      message = reportHtml ? '' : 'The report file is empty.';
    } else {
      reportHtml = '';
      hasShell = false;
      message = (result && result.error) || 'The report could not be read.';
    }
    if (host && notify) host.notifySectionChanged();
  }

  /**
   * Re-read the file and re-render only if it actually changed.
   * `quiet` is the background case (a SPEC_DATA push): no spinner, and no
   * re-render at all when mtimeMs has not moved. The Refresh button passes
   * false, so an explicit click always redraws — a button that sometimes does
   * nothing visible reads as broken even when it is right.
   */
  async function _refresh(quiet) {
    if (!cur) return;
    const wasMtime = mtimeMs;
    const wasMessage = message;
    await _load(true, false);
    // Nothing moved and nothing broke — leave the reader where they are.
    if (quiet && mtimeMs === wasMtime && message === wasMessage) return;
    if (host) host.notifySectionChanged();
  }

  /** Is this viewport already showing that exact report? */
  function matches(ref) {
    return !!cur && !!ref
      && cur.projectPath === ref.projectPath
      && cur.slug === ref.slug
      && cur.kind === ref.kind;
  }

  function getChip() {
    if (!cur) return { type: 'report', title: 'Report' };
    return { type: 'report', title: `${CHIP_TYPE[cur.kind]} · ${cur.title}` };
  }

  function render(el) {
    container = el;
    const docType = (cur && DOC_TYPE[cur.kind]) || 'Report';

    el.innerHTML = `
      <div class="report-section">
        <div class="report-section-header">
          <span class="report-section-doctype">${_escape(docType)}</span>
          <span class="report-section-title">${_escape(cur ? cur.title : '')}</span>
          ${!loading && !message && reportHtml && !hasShell
            ? '<span class="report-section-note" title="Regenerate the report to pick up the current design">Generated before the shared report shell — shown as it is</span>'
            : ''}
          <button class="btn btn-secondary report-section-refresh"
            title="Re-read the report from disk">Refresh</button>
          <button class="btn btn-secondary report-section-open" ${reportPath ? '' : 'disabled'}
            title="Open the file in the system browser">Open in browser</button>
        </div>
        <div class="report-section-body">
          ${loading
            ? '<div class="report-section-empty">Loading report…</div>'
            : message
              ? `<div class="report-section-empty">${_escape(message)}</div>`
              : '<iframe class="rpt-frame" sandbox="allow-same-origin" title="Spec report"></iframe>'}
        </div>
      </div>
    `;

    // Routing the six spec-surface buttons here took the browser away as the
    // default, not as an option: a report is still a file, and sending it to
    // the browser is how you print it, share it, or read it beside the app.
    // The manual path, for the run where no push arrives — a plan report
    // regenerated by hand moves no task, so nothing announces it.
    el.querySelector('.report-section-refresh')?.addEventListener('click', () => { _refresh(false); });

    el.querySelector('.report-section-open')?.addEventListener('click', () => {
      if (reportPath) require('electron').shell.openPath(reportPath);
    });

    if (!loading && !message && reportHtml) {
      const frame = el.querySelector('.rpt-frame');
      // `allow-same-origin` without `allow-scripts` is the whole contract:
      // the frame stays on the app's origin so the theme can be stamped onto
      // the report's own documentElement from here, while nothing inside the
      // file can execute — reports carry no JavaScript today and this keeps
      // that true even if one ever grew some.
      frameEl = frame;
      // srcdoc paints asynchronously, so the stamp rides the load event rather
      // than following the assignment; it fires again on every re-render.
      frame.addEventListener('load', _stampTheme);
      frame.srcdoc = reportHtml;
    } else {
      frameEl = null;
    }
  }

  function dispose() {
    ipcRenderer.removeListener(IPC.SPEC_DATA, onSpecData);
    themeObserver.disconnect();
    frameEl = null;
    container = null;
  }

  /** The file's mtime as of the last read — what tells a rewrite from a redundant push. */
  function lastMtime() {
    return mtimeMs;
  }

  return { type: 'report', key, viewClass: 'section-view', navigate, matches, getChip, render, dispose, lastMtime };
}

function _escape(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const api = { setHost, open, createViewport };
module.exports = api;
