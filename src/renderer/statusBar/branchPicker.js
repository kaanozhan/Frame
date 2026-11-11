/**
 * Branch picker — the popover behind the status bar's branch indicator
 * (status-bar-branch-picker spec).
 *
 * VS Code's branch quick pick, anchored to the bar: click the branch name,
 * a popover opens upward with a filter focused; local branches first
 * (current pinned, then newest commit), remote branches without a local
 * twin below a divider, "Create new branch" from the filter text on top,
 * "Manage branches…" at the bottom handing off to the GitHub view.
 *
 * This is the DOM host. Everything it decides comes from
 * `branchPickerModel` (pure, tested); this file fetches, paints, and wires
 * events. Opening runs reads only — `LOAD_GIT_BRANCHES` and
 * `LOAD_GIT_WORKTREES`, in parallel, on every open, never cached. A switch
 * that git refuses (dirty tree, branch in another worktree, anything else)
 * stays inline in the popover, so the user can pick something else without
 * reopening; success toasts, asks main to refresh git status, and closes —
 * the indicator repaints from the same `GIT_STATUS_DATA` push it already
 * listens to.
 *
 * Every branch name and path goes through `escapeHtml`; the create row's
 * label is set with `textContent` because it carries the user's own text.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../../shared/ipcChannels');
// Branch calls name the selected workspace (server-hardening T6).
const wsCtx = () => {
  const ws = require('../state').getWorkspace();
  return ws && ws.id ? { workspaceId: ws.id } : {};
};
const { GitBranch, Cloud, Plus, Settings2, Check } = require('lucide');
const state = require('../state');
const dock = require('../dock');
const notify = require('../notify');
const { escapeHtml } = require('../htmlUtils');
const model = require('./branchPickerModel');

let anchorEl = null;
let rootEl = null;
let inputEl = null;
let noticeEl = null;
let listEl = null;
let onOpenCb = null;
let onManageCb = null;
let onCloseCb = null;

let opened = false;
let openSeq = 0;          // guards a late fetch against a reopen or project switch
let data = null;          // { branches, currentBranch, worktrees, projectPath } or null while loading
let items = [];           // flatten() output for the current filter
let highlight = -1;
let busy = false;         // a switch/create is in flight

const ICON = {
  branch: dock.lucideIcon(GitBranch, 13),
  remote: dock.lucideIcon(Cloud, 13),
  create: dock.lucideIcon(Plus, 13),
  manage: dock.lucideIcon(Settings2, 13),
  current: dock.lucideIcon(Check, 12)
};

/**
 * @param {object} opts
 * @param {HTMLElement} opts.anchorEl - the `.sb-branch` button
 * @param {HTMLElement} opts.slotEl - `.status-bar-left`, the positioning context
 * @param {() => void} [opts.onOpen] - runs as the popover opens (closes the bar's other menu)
 * @param {() => void} [opts.onClose] - runs after the popover closes
 * @param {() => void} [opts.onManage] - the "Manage branches…" row
 */
function init(opts) {
  anchorEl = opts.anchorEl;
  onOpenCb = opts.onOpen || null;
  onCloseCb = opts.onClose || null;
  onManageCb = opts.onManage || null;

  rootEl = document.createElement('div');
  rootEl.className = 'sb-branch-picker';
  rootEl.hidden = true;
  rootEl.setAttribute('role', 'dialog');
  rootEl.setAttribute('aria-label', 'Switch branch');
  rootEl.innerHTML = `
    <input class="sb-bp-filter" type="text" spellcheck="false" autocomplete="off"
           placeholder="Switch to branch or type a new name…" aria-label="Filter branches">
    <div class="sb-bp-notice" hidden></div>
    <div class="sb-bp-list" role="listbox"></div>
  `;
  inputEl = rootEl.querySelector('.sb-bp-filter');
  noticeEl = rootEl.querySelector('.sb-bp-notice');
  listEl = rootEl.querySelector('.sb-bp-list');
  opts.slotEl.appendChild(rootEl);

  inputEl.addEventListener('input', () => {
    _clearNotice();
    _render({ resetHighlight: true });
  });
  inputEl.addEventListener('keydown', _onKeydown);
  // Clicks inside stay inside; the document listener below closes on the rest.
  rootEl.addEventListener('mousedown', (e) => e.stopPropagation());
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.sb-bp-row');
    if (!row || row.classList.contains('disabled')) return;
    _activate(Number(row.dataset.index));
  });
  listEl.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.sb-bp-row');
    if (!row || row.classList.contains('disabled')) return;
    const idx = Number(row.dataset.index);
    if (idx !== highlight) { highlight = idx; _paintHighlight(); }
  });

  document.addEventListener('mousedown', (e) => {
    if (!opened) return;
    if (rootEl.contains(e.target) || (anchorEl && anchorEl.contains(e.target))) return;
    close();
  });
  // Between projects the list would be the wrong repo's.
  state.onProjectChange(() => { if (opened) close(); });
  state.onWorkspaceChange(() => { if (opened) close(); });
}

function isOpen() {
  return opened;
}

function toggle() {
  if (opened) close(); else open();
}

async function open() {
  if (!rootEl || opened) return;
  // The selected workspace's checkout (main = the project itself).
  const projectPath = state.getWorkspaceRoot();
  if (!projectPath) return;

  if (onOpenCb) onOpenCb();
  opened = true;
  busy = false;
  data = null;
  items = [];
  highlight = -1;
  inputEl.value = '';
  _clearNotice();
  rootEl.hidden = false;
  if (anchorEl) anchorEl.setAttribute('aria-expanded', 'true');
  listEl.innerHTML = '<div class="sb-bp-empty">Loading branches…</div>';
  inputEl.focus();

  const seq = ++openSeq;
  let branches;
  let worktrees;
  try {
    [branches, worktrees] = await Promise.all([
      ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath, wsCtx()),
      ipcRenderer.invoke(IPC.LOAD_GIT_WORKTREES, projectPath, wsCtx())
    ]);
  } catch (err) {
    branches = { error: (err && err.message) || 'Could not read branches', branches: [] };
    worktrees = { worktrees: [] };
  }
  // A reopen or a project switch happened while we were reading.
  if (seq !== openSeq || !opened || state.getWorkspaceRoot() !== projectPath) return;

  if (branches.error) {
    // No git, not a repo, or a read failure: say so where the list would be.
    data = { branches: [], currentBranch: '', worktrees: [], projectPath };
    _render({ resetHighlight: true });
    _notice(branches.error, 'error');
    return;
  }
  data = {
    branches: branches.branches || [],
    currentBranch: branches.currentBranch || '',
    worktrees: (worktrees && worktrees.worktrees) || [],
    projectPath
  };
  _render({ resetHighlight: true });
}

function close({ refocus = false } = {}) {
  if (!rootEl || !opened) return;
  opened = false;
  openSeq += 1;
  rootEl.hidden = true;
  if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false');
  listEl.innerHTML = '';
  if (refocus && anchorEl) anchorEl.focus();
  if (onCloseCb) onCloseCb();
}

// ─── render ───────────────────────────────────────────────

function _render({ resetHighlight = false } = {}) {
  if (!data) return;
  const out = model.buildRows({ ...data, filter: inputEl.value });
  items = model.flatten(out);
  if (resetHighlight || highlight >= items.length || (highlight >= 0 && !items[highlight].enabled)) {
    highlight = model.initialHighlight(items);
  }

  const html = [];
  let index = 0;
  const groupOpen = (label) => html.push(`<div class="sb-bp-group">${label}</div>`);

  for (const item of items) {
    const i = index++;
    if (item.kind === 'create') {
      html.push(`
        <button type="button" class="sb-bp-row create${item.enabled ? '' : ' disabled'}" data-index="${i}" role="option" ${item.enabled ? '' : 'aria-disabled="true"'}>
          <span class="sb-bp-icon">${ICON.create}</span>
          <span class="sb-bp-name"></span>
          <span class="sb-bp-meta">${escapeHtml(item.reason || '')}</span>
        </button>`);
      continue;
    }
    if (item.kind === 'manage') {
      html.push(`
        <button type="button" class="sb-bp-row manage" data-index="${i}" role="option">
          <span class="sb-bp-icon">${ICON.manage}</span>
          <span class="sb-bp-name">Manage branches…</span>
          <span class="sb-bp-meta">GitHub view</span>
        </button>`);
      continue;
    }
    if (item.kind === 'local' && (i === 0 || items[i - 1].kind !== 'local')) groupOpen('Local');
    if (item.kind === 'remote' && (i === 0 || items[i - 1].kind !== 'remote')) groupOpen('Remote');
    const cls = ['sb-bp-row', item.kind, item.current ? 'current' : '', item.enabled ? '' : 'disabled'].filter(Boolean).join(' ');
    const meta = item.disabledReason || item.date || '';
    html.push(`
      <button type="button" class="${cls}" data-index="${i}" role="option" ${item.enabled ? '' : 'aria-disabled="true"'}
              title="${escapeHtml(item.disabledReason ? `${item.name} — ${item.disabledReason}` : item.name)}">
        <span class="sb-bp-icon">${item.kind === 'remote' ? ICON.remote : ICON.branch}</span>
        <span class="sb-bp-name">${escapeHtml(item.name)}</span>
        ${item.current ? `<span class="sb-bp-current">${ICON.current}</span>` : ''}
        <span class="sb-bp-meta">${escapeHtml(meta)}</span>
      </button>`);
  }
  if (out.empty && out.create.hidden) {
    html.push('<div class="sb-bp-empty">No branches match</div>');
  }
  listEl.innerHTML = html.join('');

  // The create label carries the user's own text: textContent, never markup.
  const createName = listEl.querySelector('.sb-bp-row.create .sb-bp-name');
  if (createName) {
    createName.textContent = out.create.name ? `Create new branch '${out.create.name}'` : 'Create new branch…';
  }
  _paintHighlight();
}

function _paintHighlight() {
  listEl.querySelectorAll('.sb-bp-row').forEach((row) => {
    const on = Number(row.dataset.index) === highlight;
    row.classList.toggle('highlight', on);
    row.setAttribute('aria-selected', String(on));
    if (on) row.scrollIntoView({ block: 'nearest' });
  });
}

function _notice(text, kind = 'error') {
  noticeEl.textContent = text;
  noticeEl.className = `sb-bp-notice ${kind}`;
  noticeEl.hidden = false;
}

function _clearNotice() {
  noticeEl.hidden = true;
  noticeEl.textContent = '';
}

// ─── keyboard ─────────────────────────────────────────────

function _onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close({ refocus: true });
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    highlight = model.moveHighlight(items, highlight, e.key === 'ArrowDown' ? 1 : -1);
    _paintHighlight();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (highlight >= 0) _activate(highlight);
  }
}

// ─── actions ──────────────────────────────────────────────

async function _activate(index) {
  const item = items[index];
  if (!item || !item.enabled || busy) return;
  if (item.kind === 'manage') {
    close();
    if (onManageCb) onManageCb();
    return;
  }
  const projectPath = data && data.projectPath;
  if (!projectPath) return;

  busy = true;
  rootEl.classList.add('busy');
  _clearNotice();
  try {
    let result;
    if (item.kind === 'create') {
      result = await ipcRenderer.invoke(IPC.CREATE_GIT_BRANCH, {
        ...wsCtx(),
        projectPath, branchName: item.name, checkout: true
      });
    } else {
      result = await ipcRenderer.invoke(IPC.SWITCH_GIT_BRANCH, { projectPath, branchName: item.ref, ...wsCtx() });
    }
    if (!opened || state.getWorkspaceRoot() !== projectPath) return;

    if (result && result.error === 'uncommitted_changes') {
      const n = Array.isArray(result.changes) ? result.changes.length : 0;
      _notice(`Commit or stash changes first${n ? ` · ${n} changed file${n === 1 ? '' : 's'}` : ''}`, 'warning');
      return;
    }
    if (!result || result.error) {
      _notice((result && result.error) || 'Could not switch branch', 'error');
      return;
    }
    notify.success(item.kind === 'create' ? `Created and switched to ${result.branch}` : `Switched to ${result.branch}`);
    // D13 (github-view-tree-layout): the indicator repaints from the push.
    ipcRenderer.send(IPC.REFRESH_GIT_STATUS);
    close({ refocus: true });
  } catch (err) {
    if (opened) _notice((err && err.message) || 'Could not switch branch', 'error');
  } finally {
    busy = false;
    if (rootEl) rootEl.classList.remove('busy');
  }
}

module.exports = { init, open, close, toggle, isOpen };
