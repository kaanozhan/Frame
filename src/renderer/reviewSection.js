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
 * A click on a new-side line number opens an inline comment box under that
 * line; saved comments wait in the pending list (left column) with edit and
 * remove, and their rows carry a marker. Pending comments live in memory for
 * as long as the tab is open. "Send review" hands them to an agent as one
 * prompt: to one of the workspace's agent lanes (default the most recently
 * active) or a new one, then clears the list.
 *
 * Git runs in main (REVIEW_FILES / REVIEW_FILE_DIFF) as the user's own git;
 * this module only draws. A workspace switch disposes section tabs, so one
 * review tab always belongs to one workspace.
 */

const { ipcRenderer } = require('electron');
const { html: renderDiffHtml } = require('diff2html');
const { IPC } = require('../shared/ipcChannels');
const { reconcileViewed, viewedSummary, lineAnchor, composeReviewPrompt } = require('../shared/reviewModel');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');
const laneStatus = require('./laneStatus');

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
  let comments = [];         // [{ id, path, line, text, body }]
  let editing = null;        // { id?, path, line, text, body } — the open comment box
  let commentSeq = 0;
  let diffScroll = { path: null, top: 0 };
  let sideScroll = 0;
  let sendTarget = null;     // terminal id, 'new', or null for the default
  let sending = false;

  const onGitStatus = () => {
    if (!ref) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadFiles(true), REFRESH_DEBOUNCE_MS);
  };
  ipcRenderer.on(IPC.GIT_STATUS_DATA, onGitStatus);

  // An update from base (or any commit, push or abort) changes the branch
  // under the review: reload when this workspace's row state moves.
  let rowKey = null;
  const unsubscribeRow = require('./workspacePr').onChange(() => {
    if (!ref) return;
    const s = require('./workspacePr').rowState(ref.workspaceId);
    const key = s ? [s.unpushed, s.behind, s.dirty, s.merging].join('|') : null;
    if (key === rowKey) return;
    const first = rowKey === null;
    rowKey = key;
    if (!first) loadFiles(true);
  });

  function changed() {
    if (host) host.notifySectionChanged();
  }

  function navigate(next) {
    if (!next) return;
    const same = ref && ref.workspaceId === next.workspaceId && ref.projectPath === next.projectPath;
    ref = next;
    scope = viewedScope(ref.projectPath, ref.workspaceId);
    if (!same) {
      comments = [];
      editing = null;
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
    editing = null;
    loadDiff(false);
  }

  // ─── Comments ──────────────────────────────────────────────

  function openComment(anchor) {
    const existing = comments.find((c) => c.path === selected && c.line === anchor.line);
    editing = existing
      ? { id: existing.id, path: existing.path, line: existing.line, text: existing.text, body: existing.body }
      : { path: selected, line: anchor.line, text: anchor.text, body: '' };
    changed();
  }

  function saveComment() {
    if (!editing) return;
    const body = String(editing.body || '').trim();
    if (!body) { cancelComment(); return; }
    if (editing.id) {
      const c = comments.find((x) => x.id === editing.id);
      if (c) c.body = body;
    } else {
      comments.push({ id: `c${++commentSeq}`, path: editing.path, line: editing.line, text: editing.text, body });
    }
    editing = null;
    changed();
  }

  function cancelComment() {
    editing = null;
    changed();
  }

  function removeComment(id) {
    comments = comments.filter((c) => c.id !== id);
    if (editing && editing.id === id) editing = null;
    changed();
  }

  function editComment(id) {
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    if (c.path !== selected) { selected = c.path; loadDiff(false); }
    editing = { id: c.id, path: c.path, line: c.line, text: c.text, body: c.body };
    changed();
  }

  /** New-side rows of the rendered diff: Map(line → <tr>). */
  function newSideRows(hostEl) {
    const rows = new Map();
    if (mode === 'line-by-line') {
      hostEl.querySelectorAll('td.d2h-code-linenumber .line-num2').forEach((n) => {
        const line = parseInt(n.textContent.trim(), 10);
        if (line > 0) rows.set(line, n.closest('tr'));
      });
    } else {
      const sides = hostEl.querySelectorAll('.d2h-file-side-diff');
      const right = sides[sides.length - 1];
      if (!right) return rows;
      right.querySelectorAll('td.d2h-code-side-linenumber').forEach((td) => {
        const line = parseInt(td.textContent.trim(), 10);
        if (line > 0) rows.set(line, td.closest('tr'));
      });
    }
    return rows;
  }

  /** The clicked new-side line number cell → anchor, or null. */
  function anchorFromClick(target, hostEl) {
    let newLine = '';
    let tr = null;
    const unified = target.closest('td.d2h-code-linenumber');
    const side = target.closest('td.d2h-code-side-linenumber');
    if (unified && hostEl.contains(unified)) {
      const n = unified.querySelector('.line-num2');
      newLine = n ? n.textContent : '';
      tr = unified.closest('tr');
    } else if (side && hostEl.contains(side)) {
      const sides = [...hostEl.querySelectorAll('.d2h-file-side-diff')];
      if (sides.indexOf(side.closest('.d2h-file-side-diff')) !== sides.length - 1) return null; // old side
      newLine = side.textContent;
      tr = side.closest('tr');
    } else {
      return null;
    }
    const prefix = tr && tr.querySelector('.d2h-code-line-prefix');
    const ctn = tr && tr.querySelector('.d2h-code-line-ctn');
    const code = `${prefix ? prefix.textContent : ''}${ctn ? ctn.textContent : ''}`.replace(/\u00a0/g, ' ');
    return lineAnchor({ newLine, code });
  }

  /** Markers on commented rows and the open comment box under its row. */
  function decorateDiff(hostEl) {
    const rows = newSideRows(hostEl);
    hostEl.querySelectorAll('tr').forEach((tr) => {
      const num = tr.querySelector('td.d2h-code-linenumber, td.d2h-code-side-linenumber');
      if (num) num.title = '';
    });
    for (const [line, tr] of rows) {
      const num = tr.querySelector('td.d2h-code-linenumber, td.d2h-code-side-linenumber');
      if (num) { num.classList.add('review-commentable'); num.title = `Comment on line ${line}`; }
    }
    for (const c of comments) {
      if (c.path !== selected) continue;
      const tr = rows.get(c.line);
      if (tr) { tr.classList.add('review-commented'); tr.title = c.body; }
    }
    if (!editing || editing.path !== selected) return;
    const tr = rows.get(editing.line);
    if (!tr) return;
    const cols = tr.children.length || 2;
    const boxRow = document.createElement('tr');
    boxRow.className = 'review-comment-row';
    boxRow.innerHTML = `
      <td colspan="${cols}">
        <div class="review-comment-box">
          <div class="review-comment-label">Comment on line ${editing.line}</div>
          <textarea class="review-comment-input" rows="3" placeholder="What should change here? (⌘↵ to save, Esc to cancel)">${escapeHtml(editing.body)}</textarea>
          <div class="review-comment-actions">
            ${editing.id ? '<button type="button" class="review-btn danger" data-act="remove">Remove</button>' : ''}
            <span class="review-spacer"></span>
            <button type="button" class="review-btn" data-act="cancel">Cancel</button>
            <button type="button" class="review-btn primary" data-act="save">${editing.id ? 'Save' : 'Add comment'}</button>
          </div>
        </div>
      </td>`;
    tr.after(boxRow);
    // Split view: a spacer of the same height keeps the old side aligned.
    if (mode !== 'line-by-line') {
      const sides = hostEl.querySelectorAll('.d2h-file-side-diff');
      const leftRows = sides.length > 1 ? sides[0].querySelectorAll('tbody tr') : [];
      const idx = [...tr.parentElement.children].indexOf(tr);
      const leftTr = leftRows[idx];
      if (leftTr) {
        const spacer = document.createElement('tr');
        spacer.className = 'review-comment-spacer';
        spacer.innerHTML = `<td colspan="${leftTr.children.length || 2}"></td>`;
        leftTr.after(spacer);
        requestAnimationFrame(() => { spacer.style.height = `${boxRow.offsetHeight}px`; });
      }
    }
    const input = boxRow.querySelector('textarea');
    input.addEventListener('input', () => { if (editing) editing.body = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveComment(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelComment(); }
    });
    boxRow.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'save') saveComment();
      else if (b.dataset.act === 'cancel') cancelComment();
      else if (b.dataset.act === 'remove') removeComment(editing.id);
    }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // ─── Sending ───────────────────────────────────────────────

  /** The workspace's terminals running an agent, most recently active first. */
  function agentLanes() {
    if (!ref) return [];
    let terms = [];
    try {
      const ui = require('./terminal').getMultiTerminalUI();
      terms = ui ? ui.getManager().getTerminalsInScope(ref.projectPath, ref.workspaceId) : [];
    } catch (_) {
      terms = [];
    }
    return terms
      .map((t) => ({ id: t.id, name: t.customName || t.name || 'Terminal', st: laneStatus.getStatus(t.id) }))
      .filter((l) => l.st && l.st.agentName)
      .sort((a, b) => (b.st.lastActivityAt || 0) - (a.st.lastActivityAt || 0));
  }

  function resolvedTarget(lanes) {
    if (sendTarget === 'new') return 'new';
    if (sendTarget && lanes.some((l) => l.id === sendTarget)) return sendTarget;
    return lanes.length ? lanes[0].id : 'new';
  }

  async function sendReview() {
    if (sending || !comments.length || !ref) return;
    const target = resolvedTarget(agentLanes());
    const prompt = composeReviewPrompt({ branch: ref.branch || ref.name, comments });
    sending = true;
    changed();
    let res;
    try {
      res = await require('./agentDispatch').dispatch({
        ...(target === 'new' ? { createNew: true } : { terminalId: target }),
        prompt,
        assignment: { kind: 'task', label: `review: ${ref.branch || ref.name}`, ref: `review-${ref.workspaceId}` }
      });
    } catch (err) {
      res = { success: false, error: (err && err.message) || String(err) };
    }
    sending = false;
    if (res && res.success) {
      const n = comments.length;
      comments = [];
      editing = null;
      notify.success(`Sent ${n} review comment${n === 1 ? '' : 's'} to the agent`);
    } else {
      notify.error(`Could not send the review: ${(res && res.error) || 'unknown error'}`);
    }
    changed();
  }

  function sendHtml() {
    const lanes = agentLanes();
    const target = resolvedTarget(lanes);
    const options = lanes.map((l) => `<option value="${escapeHtml(l.id)}"${l.id === target ? ' selected' : ''}>${escapeHtml(l.name)} · ${escapeHtml(l.st.agentName)}</option>`).join('')
      + `<option value="new"${target === 'new' ? ' selected' : ''}>New agent</option>`;
    return `
      <div class="review-send">
        <label class="review-send-label">Send to
          <select class="review-send-target">${options}</select>
        </label>
        <button type="button" class="review-btn primary review-send-btn" ${sending ? 'disabled' : ''}>${sending ? 'Sending…' : `Send review (${comments.length})`}</button>
      </div>`;
  }

  function pendingHtml() {
    if (!comments.length) return '';
    const sorted = comments.slice().sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)));
    return `
      <div class="review-pending">
        <div class="review-pending-header">Comments <span class="review-pending-count">${comments.length}</span></div>
        <ul class="review-comments">
          ${sorted.map((c) => `
            <li class="review-comment" data-id="${c.id}">
              <div class="review-comment-where" data-act="goto">${escapeHtml(c.path)}:${c.line}</div>
              ${c.text ? `<div class="review-comment-code">${escapeHtml(c.text)}</div>` : ''}
              <div class="review-comment-body">${escapeHtml(c.body)}</div>
              <div class="review-comment-tools">
                <button type="button" class="review-link" data-act="edit">Edit</button>
                <button type="button" class="review-link" data-act="remove">Remove</button>
              </div>
            </li>`).join('')}
        </ul>
        ${sendHtml()}
      </div>`;
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
          <div class="review-side-body">${listHtml()}${pendingHtml()}</div>
        </div>
        <div class="review-main">${diffHtml()}</div>
      </div>`;

    const f = currentFile();
    const hostEl = el.querySelector('.review-diff-host');
    if (hostEl && f && diff.path === f.path && diff.text) {
      hostEl.innerHTML = renderDiffHtml(diff.text, { drawFileList: false, matching: 'lines', outputFormat: mode });
      decorateDiff(hostEl);
      hostEl.addEventListener('click', (e) => {
        const anchor = anchorFromClick(e.target, hostEl);
        if (anchor) openComment(anchor);
      });
    }

    // Re-renders replace the DOM; keep both columns where the user left them.
    const diffBody = el.querySelector('.review-diff-body');
    if (diffBody) {
      if (f && diffScroll.path === f.path) diffBody.scrollTop = diffScroll.top;
      diffBody.addEventListener('scroll', () => { diffScroll = { path: selected, top: diffBody.scrollTop }; });
    }
    const sideBody = el.querySelector('.review-side-body');
    if (sideBody) {
      sideBody.scrollTop = sideScroll;
      sideBody.addEventListener('scroll', () => { sideScroll = sideBody.scrollTop; });
    }

    const targetSel = el.querySelector('.review-send-target');
    if (targetSel) targetSel.addEventListener('change', () => { sendTarget = targetSel.value; });
    const sendBtn = el.querySelector('.review-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendReview);

    el.querySelectorAll('.review-comment [data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.closest('.review-comment').dataset.id;
        if (b.dataset.act === 'remove') removeComment(id);
        else editComment(id);
      });
    });

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
    unsubscribeRow();
    clearTimeout(refreshTimer);
    ref = null;
  }

  return { type: 'review', key, viewClass: 'section-view', navigate, getChip, render, dispose };
}

const api = { setHost, open, createViewport };
module.exports = api;
