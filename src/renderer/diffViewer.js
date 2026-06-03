/**
 * Diff Viewer Overlay (read-only)
 *
 * Requests a unified-diff text from main via `GET_GIT_DIFF`, renders it with
 * diff2html into `#diff-viewer-host`, and supports a side-by-side / unified
 * mode toggle. Esc or backdrop click closes the overlay.
 */

const { ipcRenderer } = require('electron');
const { html: renderDiffHtml } = require('diff2html');
const { IPC } = require('../shared/ipcChannels');

let overlay = null;
let host = null;
let emptyEl = null;
let filenameEl = null;
let pillEl = null;
let modeButtons = [];

let currentDiffText = '';
let currentMode = 'side-by-side';
let currentRequest = null; // de-dupes overlapping requests

function init() {
  overlay = document.getElementById('diff-viewer-overlay');
  host = document.getElementById('diff-viewer-host');
  emptyEl = document.getElementById('diff-viewer-empty');
  filenameEl = document.getElementById('diff-viewer-filename');
  pillEl = document.getElementById('diff-viewer-pill');
  modeButtons = Array.from(document.querySelectorAll('.btn-diff-mode'));

  if (!overlay) return;

  const closeBtn = document.getElementById('btn-diff-viewer-close');
  if (closeBtn) closeBtn.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Capture phase + stopPropagation so Esc doesn't leak through to a focused
  // terminal underneath and cancel an in-flight CLI tool.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay.classList.contains('visible')) return;
    e.stopPropagation();
    close();
  }, true);

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.diffMode;
      if (!mode || mode === currentMode) return;
      setMode(mode);
    });
  }
}

/**
 * Open the diff viewer for the given file.
 * @param {{ projectPath: string, relPath: string, staged: boolean }} opts
 */
async function open(opts) {
  if (!overlay) return;
  const { projectPath, relPath, staged } = opts || {};
  if (!projectPath || !relPath) return;

  filenameEl.textContent = relPath;
  pillEl.dataset.pill = staged ? 'staged' : 'working';
  pillEl.textContent = staged ? 'Staged' : 'Working';

  host.innerHTML = '';
  showLoading();
  overlay.classList.add('visible');

  const requestId = Symbol('diff-request');
  currentRequest = requestId;

  let result;
  try {
    result = await ipcRenderer.invoke(IPC.GET_GIT_DIFF, {
      projectPath,
      relPath,
      staged: !!staged
    });
  } catch (err) {
    if (currentRequest !== requestId) return;
    showEmpty(`Failed to load diff: ${err && err.message ? err.message : err}`);
    return;
  }

  // A newer open() superseded this request — drop the result.
  if (currentRequest !== requestId) return;

  if (result && result.isBinary) {
    currentDiffText = '';
    showEmpty('Binary file — diff not shown');
    return;
  }

  currentDiffText = (result && result.diff) || '';
  if (!currentDiffText.trim()) {
    showEmpty('No changes to show');
    return;
  }

  renderCurrent();
}

function close() {
  if (!overlay) return;
  overlay.classList.remove('visible');
  currentRequest = null;
  currentDiffText = '';
  host.innerHTML = '';
  emptyEl.style.display = 'none';
}

function setMode(mode) {
  currentMode = mode;
  for (const btn of modeButtons) {
    btn.classList.toggle('active', btn.dataset.diffMode === mode);
  }
  if (currentDiffText) renderCurrent();
}

function renderCurrent() {
  if (!host) return;
  emptyEl.style.display = 'none';
  host.style.display = '';
  host.innerHTML = renderDiffHtml(currentDiffText, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: currentMode
  });
}

function showLoading() {
  emptyEl.style.display = '';
  emptyEl.textContent = 'Loading diff…';
  host.style.display = 'none';
}

function showEmpty(message) {
  emptyEl.style.display = '';
  emptyEl.textContent = message;
  host.style.display = 'none';
}

module.exports = { init, open };
