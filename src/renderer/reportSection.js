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

/** The two report kinds, as the reader should see them named. */
const DOC_TYPE = {
  plan: 'Plan Report',
  implement: 'Implementation Report'
};

function setHost(h) {
  host = h;
}

/**
 * Open a spec's report — reuses the open report viewport (navigates it) or
 * creates one if none.
 * @param {{ projectPath: string, slug: string, title?: string, kind: 'plan'|'implement' }} ref
 */
function open(ref) {
  if (!host || !ref || !ref.slug || !DOC_TYPE[ref.kind]) return;
  host.openSection('report', ref, api, { newTab: false });
}

function createViewport() {
  const key = `report-vp:${++seq}`;
  let cur = null;        // { projectPath, slug, title, kind }
  let reportHtml = '';
  let mtimeMs = 0;
  let loading = false;
  let message = '';      // shown in place of the frame: not generated yet, or a read error
  let reqId = 0;
  let container = null;

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
   * position — the same posture diffSection takes on a git refresh.
   */
  async function _load(silent) {
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
      if (host) host.notifySectionChanged();
      return;
    }
    if (id !== reqId) return; // superseded by a newer navigate

    loading = false;
    if (result && result.success) {
      reportHtml = result.html || '';
      mtimeMs = result.mtimeMs || 0;
      message = reportHtml ? '' : 'The report file is empty.';
    } else {
      reportHtml = '';
      message = (result && result.error) || 'The report could not be read.';
    }
    if (host) host.notifySectionChanged();
  }

  function getChip() {
    return { type: 'report', title: (cur && DOC_TYPE[cur.kind]) || 'Report' };
  }

  function render(el) {
    container = el;
    const docType = (cur && DOC_TYPE[cur.kind]) || 'Report';

    el.innerHTML = `
      <div class="report-section">
        <div class="report-section-header">
          <span class="report-section-doctype">${_escape(docType)}</span>
          <span class="report-section-title">${_escape(cur ? cur.title : '')}</span>
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

    if (!loading && !message && reportHtml) {
      const frame = el.querySelector('.rpt-frame');
      // `allow-same-origin` without `allow-scripts` is the whole contract:
      // the frame stays on the app's origin so the theme can be stamped onto
      // the report's own documentElement from here, while nothing inside the
      // file can execute — reports carry no JavaScript today and this keeps
      // that true even if one ever grew some.
      frame.srcdoc = reportHtml;
    }
  }

  function dispose() {
    container = null;
  }

  /** The file's mtime as of the last read — what tells a rewrite from a redundant push. */
  function lastMtime() {
    return mtimeMs;
  }

  return { type: 'report', key, viewClass: 'section-view', navigate, getChip, render, dispose, lastMtime };
}

function _escape(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const api = { setHost, open, createViewport };
module.exports = api;
