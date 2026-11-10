/**
 * Review Section — review a workspace's changes before the PR
 * (workspace-review spec).
 *
 * A section tab in the center. The left column lists every file the
 * workspace changes since the merge base with its base branch (committed,
 * uncommitted and untracked) with status and +/-, and a "N files · M left"
 * header. The right column shows the selected file's diff (split/unified).
 * A file can be ticked as viewed; the tick is remembered per workspace on
 * this machine and drops when the file's content changes (reviewModel).
 *
 * Git runs in main (REVIEW_FILES / REVIEW_FILE_DIFF) as the user's own git;
 * this module only draws. A workspace switch disposes section tabs, so one
 * review tab always belongs to one workspace.
 */

const { ipcRenderer } = require('electron');
const { html: renderDiffHtml } = require('diff2html');
const { IPC } = require('../shared/ipcChannels');
const { reconcileViewed, viewedSummary } = require('../shared/reviewModel');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');

const VIEWED_KEY = 'frame-review-viewed';
const REFRESH_DEBOUNCE_MS = 600;

let host = null; // multiTerminalUI
let seq = 0;

function setHost(h) {
  host = h;
}

// ─── Viewed state (localStorage) ──────────────────────────────

function viewedScope(projectPath, workspaceId) {
  return `${projectPath}#${workspaceId}`;
}

function readAllViewed() {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWED_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function loadViewed(scope) {
  const v = readAllViewed()[scope];
  return v && typeof v === 'object' ? v : {};
}

function saveViewed(scope, viewed) {
  const all = readAllViewed();
  if (viewed && Object.keys(viewed).length) all[scope] = viewed;
  else delete all[scope];
  try { localStorage.setItem(VIEWED_KEY, JSON.stringify(all)); } catch (_) { /* private mode */ }
}

// ─── Opening ──────────────────────────────────────────────────

/**
 * Open the review of a workspace record (`{ id, name, path, branch, base }`).
 * Selects the workspace first, so the tab lives in that workspace's scope.
 */
function open(ws) {
  if (!host || !ws || ws.missing || !ws.path) return;
  require('./workspaceSection').select(ws);
  host.openSection('review', {
    projectPath: state.getProjectPath(),
    workspaceId: ws.id,
    root: ws.path,
    name: ws.name,
    branch: ws.branch,
    base: ws.base || 'main'
  }, api, { newTab: false });
}

const STATUS_LABEL = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', U: 'Untracked' };

function createViewport() {
  const key = `review-vp:${++seq}`;
  let ref = null;            // { projectPath, workspaceId, root, name, branch, base }
  let scope = null;
  let files = [];
  let mergeBase = null;
  let listError = '';
  let listLoading = false;
  let viewed = {};
  let selected = null;       // path
  let mode = 'side-by-side';
  let diff = { path: null, text: '', message: '', loading: false };
  let listReq = 0;
  let diffReq = 0;
  let refreshTimer = null;

  const onGitStatus = () => {
    if (!ref) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadFiles(true), REFRESH_DEBOUNCE_MS);
  };
  ipcRenderer.on(IPC.GIT_STATUS_DATA, onGitStatus);

  function changed() {
    if (host) host.notifySectionChanged();
  }

  function navigate(next) {
    if (!next) return;
    const same = ref && ref.workspaceId === next.workspaceId && ref.projectPath === next.projectPath;
    ref = next;
    scope = viewedScope(ref.projectPath, ref.workspaceId);
    if (!same) {
      files = [];
      selected = null;
      diff = { path: null, text: '', message: '', loading: false };
      viewed = loadViewed(scope);
    }
    loadFiles(same);
  }

  async function loadFiles(silent) {
    if (!ref) return;
    const id = ++listReq;
    if (!silent) { listLoading = true; changed(); }
    let res;
    try {
      res = await ipcRenderer.invoke(IPC.REVIEW_FILES, { root: ref.root, base: ref.base });
    } catch (err) {
      res = { error: (err && err.message) || String(err), files: [] };
    }
    if (id !== listReq) return;
    listLoading = false;
    listError = (res && res.error) || '';
    const prevBase = mergeBase;
    mergeBase = (res && res.mergeBase) || null;
    const prevHash = selected ? (files.find((f) => f.path === selected) || {}).hash : undefined;
    files = (res && res.files) || [];
    viewed = reconcileViewed(files, viewed);
    saveViewed(scope, viewed);
    if (!selected || !files.some((f) => f.path === selected)) {
      const first = files.find((f) => !isViewed(f)) || files[0];
      selected = first ? first.path : null;
      diff = { path: null, text: '', message: '', loading: false };
    }
    const cur = currentFile();
    // Reload the open diff when it is new, or its content or base moved.
    if (cur && (diff.path !== cur.path || cur.hash !== prevHash || mergeBase !== prevBase)) {
      loadDiff(diff.path === cur.path);
    } else {
      changed();
    }
  }

  async function loadDiff(silent) {
    const f = currentFile();
    if (!f || !ref) return;
    const id = ++diffReq;
    if (!silent) {
      diff = { path: f.path, text: '', message: '', loading: true };
      changed();
    }
    let res;
    try {
      res = await ipcRenderer.invoke(IPC.REVIEW_FILE_DIFF, {
        root: ref.root, mergeBase, path: f.path, oldPath: f.oldPath, untracked: f.status === 'U'
      });
    } catch (err) {
      res = { diff: '', error: (err && err.message) || String(err) };
    }
    if (id !== diffReq) return;
    let message = '';
    if (res && res.error) message = `Failed to load diff: ${res.error}`;
    else if (res && res.tooLarge) message = 'This diff is too large to show here (over 2 MB).';
    else if (res && res.isBinary) message = 'Binary file — diff not shown';
    else if (!res || !String(res.diff || '').trim()) message = f.status === 'R' ? 'Renamed without changes' : 'No changes to show';
    diff = { path: f.path, text: message ? '' : res.diff, message, loading: false };
    changed();
  }

  function currentFile() {
    return files.find((f) => f.path === selected) || null;
  }

  function isViewed(f) {
    return Object.prototype.hasOwnProperty.call(viewed, f.path) && viewed[f.path] === f.hash;
  }

  function select(p) {
    if (!p || p === selected) return;
    selected = p;
    loadDiff(false);
  }

  function toggleViewed(p) {
    const f = files.find((x) => x.path === p);
    if (!f) return;
    if (isViewed(f)) {
      delete viewed[f.path];
    } else {
      viewed[f.path] = f.hash;
      // Ticking the open file moves on to the next one still to review.
      if (f.path === selected) {
        const idx = files.indexOf(f);
        const next = files.slice(idx + 1).concat(files.slice(0, idx)).find((x) => !isViewed(x));
        if (next) { saveViewed(scope, viewed); select(next.path); return; }
      }
    }
    saveViewed(scope, viewed);
    changed();
  }

  function getChip() {
    return { type: 'review', title: ref ? `Review · ${ref.name || ref.branch || 'workspace'}` : 'Review' };
  }

  function fileRowHtml(f) {
    const v = isViewed(f);
    const counts = f.binary ? '<span class="review-bin">bin</span>'
      : `${f.added ? `<span class="review-add">+${f.added}</span>` : ''}${f.removed ? `<span class="review-del">−${f.removed}</span>` : ''}`;
    const slash = f.path.lastIndexOf('/');
    const dir = slash >= 0 ? f.path.slice(0, slash + 1) : '';
    const base = slash >= 0 ? f.path.slice(slash + 1) : f.path;
    return `
      <li class="review-file${f.path === selected ? ' active' : ''}${v ? ' viewed' : ''}" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}">
        <input type="checkbox" class="review-viewed" data-path="${escapeHtml(f.path)}" ${v ? 'checked' : ''} title="Viewed" aria-label="Mark ${escapeHtml(f.path)} viewed">
        <span class="review-status s-${f.status}" title="${STATUS_LABEL[f.status] || f.status}">${f.status}</span>
        <span class="review-name"><span class="review-dir">${escapeHtml(dir)}</span>${escapeHtml(base)}</span>
        <span class="review-counts">${counts}</span>
      </li>`;
  }

  function listHtml() {
    if (listLoading && !files.length) return '<div class="review-empty">Loading changes…</div>';
    if (listError) return `<div class="review-empty">${escapeHtml(listError)}</div>`;
    if (!files.length) return `<div class="review-empty">No changes against ${escapeHtml(ref ? ref.base : 'the base')}.</div>`;
    return `<ul class="review-files">${files.map(fileRowHtml).join('')}</ul>`;
  }

  function diffHtml() {
    const f = currentFile();
    if (!f) return '<div class="review-empty">Select a file to see its diff.</div>';
    const v = isViewed(f);
    const head = `
      <div class="review-diff-header">
        <span class="review-status s-${f.status}">${f.status}</span>
        <span class="review-diff-path">${escapeHtml(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}</span>
        <label class="review-diff-viewed"><input type="checkbox" class="review-viewed" data-path="${escapeHtml(f.path)}" ${v ? 'checked' : ''}> Viewed</label>
        <div class="diff-section-modes" role="group" aria-label="Diff display mode">
          <button class="diff-section-mode ${mode === 'side-by-side' ? 'active' : ''}" data-mode="side-by-side">Split</button>
          <button class="diff-section-mode ${mode === 'line-by-line' ? 'active' : ''}" data-mode="line-by-line">Unified</button>
        </div>
      </div>`;
    let body;
    if (diff.loading || diff.path !== f.path) body = '<div class="review-empty">Loading diff…</div>';
    else if (diff.message) body = `<div class="review-empty">${escapeHtml(diff.message)}</div>`;
    else body = '<div class="review-diff-host frame-diff"></div>';
    return `${head}<div class="review-diff-body">${body}</div>`;
  }

  function render(el) {
    const sum = viewedSummary(files, viewed);
    const header = files.length
      ? `${sum.total} file${sum.total === 1 ? '' : 's'} · ${sum.remaining ? `${sum.remaining} left` : 'all viewed'}`
      : '';
    el.innerHTML = `
      <div class="review-section">
        <div class="review-side">
          <div class="review-side-header">
            <div class="review-title">
              <span class="review-branch">${escapeHtml(ref ? ref.branch || ref.name || '' : '')}</span>
              <span class="review-base">vs ${escapeHtml(ref ? ref.base : '')}</span>
            </div>
            <div class="review-summary">${escapeHtml(header)}</div>
          </div>
          <div class="review-side-body">${listHtml()}</div>
        </div>
        <div class="review-main">${diffHtml()}</div>
      </div>`;

    const f = currentFile();
    const hostEl = el.querySelector('.review-diff-host');
    if (hostEl && f && diff.path === f.path && diff.text) {
      hostEl.innerHTML = renderDiffHtml(diff.text, { drawFileList: false, matching: 'lines', outputFormat: mode });
    }

    el.querySelectorAll('.review-file').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.review-viewed')) return;
        select(row.dataset.path);
      });
    });
    el.querySelectorAll('.review-viewed').forEach((box) => {
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => toggleViewed(box.dataset.path));
    });
    el.querySelectorAll('.diff-section-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        changed();
      });
    });
  }

  function dispose() {
    ipcRenderer.removeListener(IPC.GIT_STATUS_DATA, onGitStatus);
    clearTimeout(refreshTimer);
    ref = null;
  }

  return { type: 'review', key, viewClass: 'section-view', navigate, getChip, render, dispose };
}

const api = { setHost, open, createViewport };
module.exports = api;
