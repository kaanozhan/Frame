/**
 * Diff Section Module
 *
 * Opens a git diff as a *section viewport* (a tab next to Home / Frames),
 * replacing the old read-only overlay. One diff tab is reused and navigated in
 * place: clicking another changed file — or the ◀ / ▶ arrows in the header —
 * switches the viewed file without spawning tabs. The arrow nav walks the same
 * ordered set of changed files the Changes sidebar shows (via
 * gitChangesPanel.getOrderedFiles()).
 *
 * Diff text comes from main (`GET_GIT_DIFF`) and is rendered with diff2html,
 * reusing the shared `.frame-diff` dark-theme styling.
 */

const { ipcRenderer } = require('electron');
const { html: renderDiffHtml } = require('diff2html');
const { IPC } = require('../shared/ipcChannels');
const { ChevronLeft, ChevronRight } = require('lucide');

let host = null; // multiTerminalUI
let seq = 0;

function lucideIcon(data, size = 16) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

function setHost(h) {
  host = h;
}

/**
 * Open the diff for a changed file — reuses the open diff viewport (navigates
 * it) or creates one if none.
 * @param {{ projectPath: string, relPath: string, staged: boolean }} ref
 */
function open(ref) {
  if (!host || !ref || !ref.relPath) return;
  host.openSection('diff', ref, api, { newTab: false });
}

function createViewport() {
  const key = `diff-vp:${++seq}`;
  let cur = null;           // { projectPath, relPath, staged }
  let files = [];           // ordered nav set (snapshot, refreshed on git status)
  let mode = 'side-by-side';
  let diffText = '';
  let loading = false;
  let message = '';         // empty/binary/error message in place of a diff
  let reqId = 0;
  let container = null;

  // Keep the nav set + the current diff fresh as the working tree changes.
  // Silent: the current diff stays on screen until the refreshed one arrives,
  // so a background git refresh never flickers a "Loading…" over your scroll.
  const onGitStatus = () => {
    files = _orderedFiles();
    if (cur) _load(true);
    else if (host) host.notifySectionChanged();
  };
  ipcRenderer.on(IPC.GIT_STATUS_DATA, onGitStatus);

  function navigate(ref) {
    if (!ref) return;
    cur = { projectPath: ref.projectPath, relPath: ref.relPath, staged: !!ref.staged };
    files = _orderedFiles();
    _load(false);
  }

  // Fetch the current file's diff, then re-render via the host.
  async function _load(silent) {
    if (!cur) return;
    const id = ++reqId;
    if (!silent) {
      loading = true;
      message = '';
      diffText = '';
      if (host) host.notifySectionChanged();
    }

    let result;
    try {
      result = await ipcRenderer.invoke(IPC.GET_GIT_DIFF, {
        projectPath: cur.projectPath,
        relPath: cur.relPath,
        staged: cur.staged
      });
    } catch (err) {
      if (id !== reqId) return;
      loading = false;
      message = `Failed to load diff: ${err && err.message ? err.message : err}`;
      if (host) host.notifySectionChanged();
      return;
    }
    if (id !== reqId) return; // superseded by a newer navigate

    loading = false;
    if (result && result.isBinary) {
      message = 'Binary file — diff not shown';
    } else {
      diffText = (result && result.diff) || '';
      if (!diffText.trim()) message = 'No changes to show';
    }
    if (host) host.notifySectionChanged();
  }

  function _currentIndex() {
    if (!cur) return -1;
    return files.findIndex((f) => f.relPath === cur.relPath && !!f.staged === !!cur.staged);
  }

  function _step(delta) {
    const idx = _currentIndex();
    if (idx === -1) return;
    const next = files[idx + delta];
    if (!next) return;
    navigate({ projectPath: cur.projectPath, relPath: next.relPath, staged: next.staged });
  }

  function getChip() {
    return { type: 'diff', title: cur ? _basename(cur.relPath) : 'Diff' };
  }

  function render(el) {
    container = el;
    const idx = _currentIndex();
    const total = files.length;
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < total - 1;
    const pos = idx >= 0 && total > 1 ? `${idx + 1} / ${total}` : '';

    el.innerHTML = `
      <div class="diff-section">
        <div class="diff-section-header">
          <div class="diff-section-nav">
            <button class="diff-section-arrow" data-step="-1" ${hasPrev ? '' : 'disabled'} title="Previous file">${lucideIcon(ChevronLeft, 18)}</button>
            <button class="diff-section-arrow" data-step="1" ${hasNext ? '' : 'disabled'} title="Next file">${lucideIcon(ChevronRight, 18)}</button>
          </div>
          <div class="diff-section-title">
            <span class="diff-section-filename">${_escape(cur ? cur.relPath : '')}</span>
            <span class="diff-section-pill" data-pill="${cur && cur.staged ? 'staged' : 'working'}">${cur && cur.staged ? 'Staged' : 'Unstaged'}</span>
            ${pos ? `<span class="diff-section-pos">${pos}</span>` : ''}
          </div>
          <div class="diff-section-modes" role="group" aria-label="Diff display mode">
            <button class="diff-section-mode ${mode === 'side-by-side' ? 'active' : ''}" data-mode="side-by-side">Split</button>
            <button class="diff-section-mode ${mode === 'line-by-line' ? 'active' : ''}" data-mode="line-by-line">Unified</button>
          </div>
        </div>
        <div class="diff-section-body">
          ${loading
            ? '<div class="diff-section-empty">Loading diff…</div>'
            : message
              ? `<div class="diff-section-empty">${_escape(message)}</div>`
              : `<div class="diff-section-host frame-diff"></div>`}
        </div>
      </div>
    `;

    if (!loading && !message && diffText) {
      const hostEl = el.querySelector('.diff-section-host');
      hostEl.innerHTML = renderDiffHtml(diffText, {
        drawFileList: false,
        matching: 'lines',
        outputFormat: mode
      });
    }

    el.querySelectorAll('.diff-section-arrow').forEach((btn) => {
      btn.addEventListener('click', () => _step(parseInt(btn.dataset.step, 10)));
    });
    el.querySelectorAll('.diff-section-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        if (host) host.notifySectionChanged();
      });
    });
  }

  function dispose() {
    ipcRenderer.removeListener(IPC.GIT_STATUS_DATA, onGitStatus);
    container = null;
  }

  return { type: 'diff', key, viewClass: 'section-view', navigate, getChip, render, dispose };
}

function _orderedFiles() {
  try {
    return require('./gitChangesPanel').getOrderedFiles();
  } catch (_) {
    return [];
  }
}

function _basename(p) {
  if (!p) return '';
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function _escape(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const api = { setHost, open, createViewport };
module.exports = api;
