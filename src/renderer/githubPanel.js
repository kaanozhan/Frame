/**
 * GitHub Panel — the sidebar's GitHub tab (github-view-tree-layout spec).
 *
 * The DOM host for VS Code's "GitHub Pull Requests" shape: a head with the
 * repo name, one filter field, an access-state block, and four stacked,
 * collapsible sections — Pull Requests · Issues · Branches · Worktrees — of
 * dense single-line rows with hover actions and a context menu.
 *
 * What is pure lives next door and is tested (C10):
 *   github/sectionState.js  which sections are expanded, persisted app-wide
 *   github/accessState.js   gh missing / not signed in / not a GitHub remote / ok
 *   github/rowModels.js     PR / issue / branch / worktree → row view-models
 *
 * This module only applies those to the DOM, talks IPC, and keeps a small
 * per-section cache so expanding a section re-renders instantly and reloads
 * in the background (G6). `init / show / hide` keep their shape so
 * `index.js` and `revealSidebarTab('github')` do not change (C1).
 *
 * Terminal lanes (Sign in, Open terminal here) come through an `openLane`
 * hook injected by index.js (D11) — requiring multiTerminalUI here would be
 * a cycle. Destructive actions go through taskConfirmModal (D8); nothing
 * here calls confirm().
 */

const { ipcRenderer, shell } = require('electron');
const {
  GitPullRequest, GitPullRequestDraft, GitMerge, GitPullRequestClosed,
  CircleDot, CircleCheck, GitBranch, Check, Folder, FolderGit2,
  ChevronRight, RefreshCw, ListFilter, Plus,
  ArrowRightLeft, Play, ExternalLink, Trash2, SquareTerminal
} = require('lucide');
const { IPC } = require('../shared/ipcChannels');
// Branch and worktree calls name the selected workspace, so main routes them
// by id, not by path (server-hardening T6).
const wsCtx = () => {
  const ws = require('./state').getWorkspace();
  return ws && ws.id ? { workspaceId: ws.id } : {};
};
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');
const taskConfirmModal = require('./taskConfirmModal');
const { lucideIcon } = require('./dock');
const sectionState = require('./github/sectionState');
const accessState = require('./github/accessState');
const rowModels = require('./github/rowModels');

const { SECTIONS } = sectionState;

const ROW_ICONS = {
  'pr-open': GitPullRequest,
  'pr-draft': GitPullRequestDraft,
  'pr-merged': GitMerge,
  'pr-closed': GitPullRequestClosed,
  'issue-open': CircleDot,
  'issue-closed': CircleCheck,
  branch: GitBranch,
  'branch-current': Check,
  worktree: Folder,
  'worktree-main': FolderGit2
};

const ACTION_ICONS = {
  checkout: ArrowRightLeft,
  switch: ArrowRightLeft,
  'start-work': Play,
  open: ExternalLink,
  delete: Trash2,
  remove: Trash2,
  'open-terminal': SquareTerminal
};

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' }
];

const SECTION_LABEL = {
  prs: 'pull requests',
  issues: 'issues',
  branches: 'branches',
  worktrees: 'worktrees'
};

// ─── state ────────────────────────────────────────────────

let isVisible = false;
let openLane = null;
let sections = sectionState.defaults();
let access = null;          // accessState.resolve() result, or null before the first check
let query = '';
let selected = null;        // { kind, id }
let contextTarget = null;   // the row model under the open context menu
let filterTarget = null;    // the section id under the open filter menu

/** Per section: { filter, rows, loadedAt, error, loading } */
const cache = {};
const inflight = {};

// DOM
let panelEl = null;
let headRepoEl = null;
let refreshBtn = null;
let searchEl = null;
let searchFieldEl = null;
let searchClearEl = null;
let stateEl = null;
let contextMenuEl = null;
let filterMenuEl = null;
const sectionEls = {};      // id → { section, head, chevron, count, actions, rows }

function resetCache() {
  for (const id of SECTIONS) {
    cache[id] = { filter: cache[id] ? cache[id].filter : 'open', rows: [], loadedAt: 0, error: null, loading: false };
  }
}

function projectPath() {
  return require('./state').getProjectPath();
}

// ─── init ─────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {(o:{cwd?:string,command?:string}) => Promise<string|null>} [opts.openLane]
 *   Opens a terminal lane (optionally in `cwd`) and types `command` into it.
 */
function init(opts = {}) {
  openLane = typeof opts.openLane === 'function' ? opts.openLane : null;

  panelEl = document.getElementById('github-panel');
  if (!panelEl) {
    console.error('GitHub panel element not found');
    return;
  }
  headRepoEl = document.getElementById('github-head-repo');
  refreshBtn = document.getElementById('github-refresh-btn');
  searchEl = document.getElementById('github-search');
  searchFieldEl = searchEl ? searchEl.closest('.file-tree-search-field') : null;
  searchClearEl = document.getElementById('github-search-clear');
  stateEl = document.getElementById('github-state');
  contextMenuEl = document.getElementById('github-context-menu');
  filterMenuEl = document.getElementById('github-filter-menu');

  for (const id of SECTIONS) {
    const section = panelEl.querySelector(`.github-section[data-section="${id}"]`);
    if (!section) continue;
    sectionEls[id] = {
      section,
      head: section.querySelector('.github-section-head'),
      chevron: section.querySelector('.github-section-chevron'),
      count: section.querySelector('[data-count]'),
      actions: section.querySelector('.github-section-actions'),
      rows: section.querySelector('[data-rows]')
    };
  }

  resetCache();
  sections = sectionState.load(readStored());

  paintStaticIcons();
  applySections();
  setupEventListeners();
  setupModalListeners();

  require('./state').onProjectChange(() => {
    access = null;
    selected = null;
    resetCache();
    hideMenus();
    for (const id of SECTIONS) renderSection(id);
    renderHead();
    renderState();
    if (isVisible) show();
  });
}

function readStored() {
  try {
    return localStorage.getItem(sectionState.STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

function persistSections() {
  try {
    localStorage.setItem(sectionState.STORAGE_KEY, sectionState.serialize(sections));
  } catch (_) {
    // localStorage unavailable — the state still applies for this session
  }
}

function paintStaticIcons() {
  if (refreshBtn) refreshBtn.innerHTML = lucideIcon(RefreshCw, 14);
  for (const id of SECTIONS) {
    const els = sectionEls[id];
    if (!els) continue;
    if (els.chevron) els.chevron.innerHTML = lucideIcon(ChevronRight, 14);
    const filterBtn = els.actions && els.actions.querySelector('[data-section-action="filter"]');
    if (filterBtn) filterBtn.innerHTML = lucideIcon(ListFilter, 13);
    const refreshSectionBtn = els.actions && els.actions.querySelector('[data-section-action="refresh"]');
    if (refreshSectionBtn) refreshSectionBtn.innerHTML = lucideIcon(RefreshCw, 13);
    const newBtn = els.actions && els.actions.querySelector('[data-section-action="new"]');
    if (newBtn) newBtn.innerHTML = lucideIcon(Plus, 13);
  }
}

function setupEventListeners() {
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshAll());

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      query = searchEl.value;
      if (searchFieldEl) searchFieldEl.classList.toggle('has-query', query.trim() !== '');
      for (const id of SECTIONS) renderSection(id);
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchEl.value) {
        e.stopPropagation();
        clearSearch();
      }
    });
  }
  if (searchClearEl) searchClearEl.addEventListener('click', clearSearch);

  for (const id of SECTIONS) {
    const els = sectionEls[id];
    if (!els) continue;

    els.head.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-section-action]');
      if (actionBtn) {
        e.stopPropagation();
        onSectionAction(id, actionBtn.dataset.sectionAction, actionBtn);
        return;
      }
      toggleSection(id);
    });
    els.head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSection(id);
      }
    });

    // One delegated listener per section, not one per row.
    els.rows.addEventListener('click', (e) => {
      const subhead = e.target.closest('.github-subhead');
      if (subhead) {
        toggleSubgroup(subhead.dataset.subgroup);
        return;
      }
      const rowEl = e.target.closest('.github-row');
      if (!rowEl) return;
      const row = findRow(id, rowEl.dataset.id);
      if (!row) return;
      const actionBtn = e.target.closest('.github-row-action');
      if (actionBtn) {
        e.stopPropagation();
        runAction(row, actionBtn.dataset.action);
        return;
      }
      selectRow(row);
    });
    els.rows.addEventListener('contextmenu', (e) => {
      const rowEl = e.target.closest('.github-row');
      if (!rowEl) return;
      const row = findRow(id, rowEl.dataset.id);
      if (!row) return;
      e.preventDefault();
      selectRow(row);
      showContextMenu(row, e.clientX, e.clientY);
    });
  }

  if (contextMenuEl) {
    contextMenuEl.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item || !contextTarget) return;
      const row = contextTarget;
      hideMenus();
      runAction(row, item.dataset.action);
    });
  }
  if (filterMenuEl) {
    filterMenuEl.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item || !filterTarget) return;
      const id = filterTarget;
      hideMenus();
      setFilter(id, item.dataset.filter);
    });
  }

  document.addEventListener('click', (e) => {
    if (contextMenuEl && contextMenuEl.classList.contains('visible') && !contextMenuEl.contains(e.target)) hideMenus();
    if (filterMenuEl && filterMenuEl.classList.contains('visible') && !filterMenuEl.contains(e.target)) hideMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menusOpen()) {
      e.stopPropagation();
      hideMenus();
    }
  }, true);
}

// ─── show / hide ──────────────────────────────────────────

/**
 * Called on every reveal of the tab (revealSidebarTab → show()). Resolves
 * the access state (cached in main per project), then loads each expanded,
 * available section — cached rows first, a reload behind them.
 */
async function show() {
  isVisible = true;
  if (!panelEl) return;
  if (!projectPath()) {
    access = null;
    renderHead();
    renderState();
    for (const id of SECTIONS) renderSection(id);
    return;
  }
  await loadAccess(false);
  loadExpanded();
}

function hide() {
  isVisible = false;
}

/** Kept for callers of the old slide-in API; the tab has no closed state. */
function toggle() {
  show();
}

// ─── access state ─────────────────────────────────────────

async function loadAccess(force) {
  const path = projectPath();
  if (!path) return;
  let payload;
  try {
    payload = await ipcRenderer.invoke(IPC.GITHUB_ACCESS_STATE, { projectPath: path, force: force === true });
  } catch (err) {
    payload = { gh: false, authed: false, repoName: null, error: err && err.message };
  }
  if (path !== projectPath()) return;
  access = accessState.resolve(payload);
  renderHead();
  renderState();
  for (const id of SECTIONS) renderSection(id);
}

function isAvailable(id) {
  return accessState.isAvailable(access, id);
}

function renderHead() {
  if (!headRepoEl) return;
  const name = access && access.repoName ? access.repoName : '';
  headRepoEl.textContent = name;
  headRepoEl.title = name;
}

function renderState() {
  if (!stateEl) return;
  const copy = access && access.copy;
  if (!copy) {
    stateEl.style.display = 'none';
    stateEl.innerHTML = '';
    return;
  }
  let action = '';
  if (copy.action === 'signin') {
    action = `<button type="button" class="github-state-action" data-state-action="signin" tabindex="-1">${escapeHtml(copy.actionLabel)}</button>`;
  } else if (copy.action === 'install') {
    action = `<button type="button" class="github-state-action link" data-state-action="install" data-url="${escapeHtml(copy.actionUrl)}" tabindex="-1">${escapeHtml(copy.actionLabel)}</button>`;
  }
  stateEl.innerHTML = `
    <p class="github-state-title">${escapeHtml(copy.title)}</p>
    <p class="github-state-message">${escapeHtml(copy.message)}</p>
    ${action}
  `;
  stateEl.style.display = '';
  const btn = stateEl.querySelector('[data-state-action]');
  if (btn) {
    btn.addEventListener('click', () => {
      if (btn.dataset.stateAction === 'signin') signIn();
      else if (btn.dataset.stateAction === 'install' && btn.dataset.url) shell.openExternal(btn.dataset.url);
    });
  }
}

async function signIn() {
  if (!openLane) {
    notify.error('Run `gh auth login` in a terminal, then refresh');
    return;
  }
  const id = await openLane({ command: 'gh auth login' });
  if (id) notify.info('Complete the sign-in in the terminal, then refresh GitHub');
}

// ─── sections ─────────────────────────────────────────────

function toggleSection(id) {
  sections = sectionState.toggle(sections, id);
  persistSections();
  applySections();
  if (sectionState.isExpanded(sections, id)) {
    renderSection(id);
    loadSection(id);
  }
}

/**
 * Expand one section from outside the panel (the status bar's branch picker
 * hands off to Branches — status-bar-branch-picker spec, G5). State is set
 * and persisted whether or not the tab is on screen; rows load now only if
 * it is, because `show()` — which the caller runs next when it is not —
 * loads every expanded section itself.
 */
function revealSection(id) {
  if (!SECTIONS.includes(id)) return;
  sections = sectionState.setExpanded(sections, id, true);
  persistSections();
  applySections();
  if (isVisible && projectPath()) {
    renderSection(id);
    loadSection(id);
  }
}

function toggleSubgroup(id) {
  sections = sectionState.toggle(sections, id);
  persistSections();
  renderSection('branches');
}

function applySections() {
  for (const id of SECTIONS) {
    const els = sectionEls[id];
    if (!els) continue;
    const expanded = sectionState.isExpanded(sections, id);
    els.section.classList.toggle('expanded', expanded);
    els.head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
}

/** Every expanded, available section: cached rows now, a reload behind. */
function loadExpanded() {
  for (const id of sectionState.expandedSections(sections)) {
    renderSection(id);
    loadSection(id);
  }
}

function onSectionAction(id, action, btn) {
  if (action === 'refresh') {
    loadSection(id, { spinner: btn });
  } else if (action === 'filter') {
    showFilterMenu(id, btn);
  } else if (action === 'new') {
    showCreateBranchModal();
  }
}

/**
 * Head refresh (G6): re-run the access check with force, then reload every
 * expanded, available section. Branches stays Branches.
 */
async function refreshAll() {
  if (!projectPath()) return;
  if (refreshBtn) {
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
  }
  try {
    await loadAccess(true);
    await Promise.all(sectionState.expandedSections(sections).map((id) => loadSection(id)));
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }
  }
}

// ─── loading ──────────────────────────────────────────────

async function invokeSection(id, path) {
  const entry = cache[id];
  switch (id) {
    case 'prs': {
      const result = await ipcRenderer.invoke(IPC.LOAD_GITHUB_PULL_REQUESTS, { projectPath: path, state: entry.filter });
      return { error: result.error, rows: rowModels.prRows(result) };
    }
    case 'issues': {
      const result = await ipcRenderer.invoke(IPC.LOAD_GITHUB_ISSUES, { projectPath: path, state: entry.filter });
      return { error: result.error, rows: rowModels.issueRows(result) };
    }
    case 'branches': {
      const result = await ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, path, wsCtx());
      return { error: result.error, rows: rowModels.branchRows(result) };
    }
    case 'worktrees': {
      const [result, listed] = await Promise.all([
        ipcRenderer.invoke(IPC.LOAD_GIT_WORKTREES, path, wsCtx()),
        ipcRenderer.invoke(IPC.WORKSPACES_LIST, path).catch(() => null)
      ]);
      // Worktrees that are workspaces carry their name (workspaces spec).
      const workspaces = listed && Array.isArray(listed.workspaces) ? listed.workspaces : [];
      return { error: result.error, rows: rowModels.worktreeRows(result, path, workspaces) };
    }
    default:
      return { error: null, rows: [] };
  }
}

/**
 * Load one section into its cache and re-render it. A section that is not
 * available in the current access state is not loaded — its note says why.
 * Concurrent calls for the same section share one in-flight request.
 */
function loadSection(id, opts = {}) {
  const path = projectPath();
  const entry = cache[id];
  if (!path || !entry || !isAvailable(id)) {
    renderSection(id);
    return Promise.resolve();
  }
  if (inflight[id]) return inflight[id];

  const spinner = opts.spinner || null;
  if (spinner) spinner.classList.add('spinning');
  const busy = sectionEls[id] && sectionEls[id].actions;
  if (busy) busy.classList.add('busy');
  entry.loading = true;
  renderSection(id);

  inflight[id] = (async () => {
    try {
      const { error, rows } = await invokeSection(id, path);
      if (path !== projectPath()) return;
      entry.error = error || null;
      if (!error) {
        entry.rows = rows;
        entry.loadedAt = Date.now();
      }
    } catch (err) {
      if (path !== projectPath()) return;
      entry.error = (err && err.message) || `Failed to load ${SECTION_LABEL[id]}`;
    } finally {
      entry.loading = false;
      delete inflight[id];
      if (spinner) spinner.classList.remove('spinning');
      if (busy) busy.classList.remove('busy');
      renderSection(id);
    }
  })();
  return inflight[id];
}

// ─── rendering ────────────────────────────────────────────

function visibleRows(id) {
  const entry = cache[id];
  if (!entry) return [];
  return rowModels.filterRows(entry.rows, query);
}

function findRow(id, rowId) {
  const entry = cache[id];
  if (!entry) return null;
  return entry.rows.find((r) => r.id === rowId) || null;
}

function noteHtml(text, kind = '') {
  return `<div class="github-note ${kind}">${escapeHtml(text)}</div>`;
}

function unavailableNote() {
  if (!access) return 'Checking GitHub access…';
  if (access.state === 'no-gh') return 'GitHub CLI not found';
  if (access.state === 'no-auth') return 'Sign in to load';
  return 'Not a GitHub remote';
}

function emptyNote(id) {
  const entry = cache[id];
  const q = query.trim();
  if (q) return `No ${SECTION_LABEL[id]} match “${q}”`;
  if (id === 'prs' || id === 'issues') return `No ${entry.filter === 'all' ? '' : entry.filter + ' '}${SECTION_LABEL[id]}`;
  if (id === 'branches') return 'No branches — not a git repository?';
  return 'No worktrees';
}

function renderSection(id) {
  const els = sectionEls[id];
  const entry = cache[id];
  if (!els || !entry) return;

  const available = isAvailable(id);
  const rows = available ? visibleRows(id) : [];
  const expanded = sectionState.isExpanded(sections, id);

  if (els.count) els.count.textContent = available && (entry.loadedAt || rows.length) ? String(rows.length) : '';

  const filterBtn = els.actions && els.actions.querySelector('[data-section-action="filter"]');
  if (filterBtn) {
    filterBtn.classList.toggle('has-filter', entry.filter !== 'open');
    filterBtn.title = `Showing ${entry.filter} — Open / Closed / All`;
  }

  if (!expanded) {
    els.rows.innerHTML = '';
    return;
  }

  if (!projectPath()) {
    els.rows.innerHTML = noteHtml('Select a project');
    return;
  }
  if (!available) {
    els.rows.innerHTML = noteHtml(unavailableNote());
    return;
  }
  if (entry.error) {
    els.rows.innerHTML = noteHtml(entry.error === 'uncommitted_changes' ? 'Uncommitted changes' : entry.error, 'error');
    return;
  }
  if (entry.loading && !entry.loadedAt) {
    els.rows.innerHTML = noteHtml('Loading…');
    return;
  }
  if (rows.length === 0) {
    els.rows.innerHTML = noteHtml(emptyNote(id));
    return;
  }

  if (id === 'branches') {
    const local = rows.filter((r) => !r.isRemote);
    const remote = rows.filter((r) => r.isRemote);
    const remoteOpen = sectionState.isExpanded(sections, 'remote');
    els.rows.innerHTML = local.map(rowHtml).join('') + (remote.length ? `
      <div class="github-subhead ${remoteOpen ? 'expanded' : ''}" data-subgroup="remote" role="button" tabindex="-1" aria-expanded="${remoteOpen}">
        <span class="github-section-chevron" aria-hidden="true">${lucideIcon(ChevronRight, 12)}</span>
        <span class="github-section-title">Remote</span>
        <span class="github-section-count">${remote.length}</span>
      </div>
      ${remoteOpen ? `<div class="github-subrows">${remote.map(rowHtml).join('')}</div>` : ''}
    ` : '');
    return;
  }

  els.rows.innerHTML = rows.map(rowHtml).join('');
}

function rowHtml(row) {
  const isSelected = selected && selected.kind === row.kind && selected.id === row.id;
  const classes = ['github-row', row.current ? 'current' : '', isSelected ? 'active' : ''].filter(Boolean).join(' ');
  const icon = ROW_ICONS[row.icon] || GitBranch;
  const num = row.number !== undefined && row.number !== null
    ? `<span class="github-row-num">#${escapeHtml(String(row.number))}</span>` : '';
  const labels = Array.isArray(row.labels) && row.labels.length
    ? `<span class="github-row-labels">${row.labels.map((l) =>
        `<span class="github-row-label" title="${escapeHtml(l.name)}"${l.color ? ` style="background:${escapeHtml(l.color)}"` : ''}></span>`
      ).join('')}</span>` : '';
  const hints = [row.review, row.checks].filter(Boolean).map((h) =>
    `<span class="github-row-hint ${escapeHtml(h)}" title="${escapeHtml(hintLabel(h))}"></span>`
  ).join('');
  const secondary = row.kind === 'worktree' && row.secondary
    ? `<span class="github-row-secondary">${escapeHtml(row.secondary)}</span>` : '';
  const actions = row.actions.map((a) =>
    `<button type="button" class="github-row-action ${a.danger ? 'danger' : ''}" data-action="${escapeHtml(a.id)}" title="${escapeHtml(a.label)}" aria-label="${escapeHtml(a.label)}" tabindex="-1">${lucideIcon(ACTION_ICONS[a.id] || ExternalLink, 13)}</button>`
  ).join('');
  const title = rowTitle(row);

  return `
    <div class="${classes}" data-kind="${escapeHtml(row.kind)}" data-id="${escapeHtml(row.id)}" title="${escapeHtml(title)}" tabindex="-1">
      <span class="github-row-icon ${escapeHtml(row.iconClass || '')}">${lucideIcon(icon, 14)}</span>
      ${num}
      <span class="github-row-main">${escapeHtml(row.primary)}</span>
      ${labels}
      ${hints}
      ${secondary}
      <span class="github-row-meta">${escapeHtml(row.meta || '')}</span>
      <span class="github-row-actions">${actions}</span>
    </div>
  `;
}

function hintLabel(h) {
  return {
    approved: 'Approved',
    'changes-requested': 'Changes requested',
    'review-required': 'Review required',
    success: 'Checks passed',
    failure: 'Checks failed',
    pending: 'Checks pending'
  }[h] || h;
}

function rowTitle(row) {
  switch (row.kind) {
    case 'pr':
      return [`#${row.number} ${row.primary}`, row.secondary, row.meta].filter(Boolean).join('\n');
    case 'issue':
      return [`#${row.number} ${row.primary}`, (row.labels || []).map((l) => l.name).join(', '), row.meta].filter(Boolean).join('\n');
    case 'branch':
      return [row.primary + (row.current ? ' (current)' : ''), row.meta].filter(Boolean).join('\n');
    case 'worktree':
      return [row.path, row.branch, row.slug ? `spec: ${row.slug}` : ''].filter(Boolean).join('\n');
    default:
      return row.primary;
  }
}

function selectRow(row) {
  selected = { kind: row.kind, id: row.id };
  for (const id of SECTIONS) {
    const els = sectionEls[id];
    if (!els) continue;
    els.rows.querySelectorAll('.github-row').forEach((el) => {
      el.classList.toggle('active', el.dataset.kind === row.kind && el.dataset.id === row.id);
    });
  }
}

function clearSearch() {
  query = '';
  if (searchEl) searchEl.value = '';
  if (searchFieldEl) searchFieldEl.classList.remove('has-query');
  for (const id of SECTIONS) renderSection(id);
}

// ─── menus ────────────────────────────────────────────────

function menusOpen() {
  return (contextMenuEl && contextMenuEl.classList.contains('visible'))
    || (filterMenuEl && filterMenuEl.classList.contains('visible'));
}

function hideMenus() {
  if (contextMenuEl) contextMenuEl.classList.remove('visible');
  if (filterMenuEl) filterMenuEl.classList.remove('visible');
  contextTarget = null;
  filterTarget = null;
}

function placeMenu(menuEl, x, y) {
  menuEl.style.left = '-9999px';
  menuEl.style.top = '-9999px';
  menuEl.classList.add('visible');
  const rect = menuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menuEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
  menuEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
}

function showContextMenu(row, x, y) {
  if (!contextMenuEl || !row.actions.length) return;
  hideMenus();
  contextTarget = row;
  contextMenuEl.innerHTML = row.actions.map((a) =>
    `<button class="context-menu-item ${a.danger ? 'danger' : ''}" data-action="${escapeHtml(a.id)}" type="button">${escapeHtml(a.label)}</button>`
  ).join('');
  placeMenu(contextMenuEl, x, y);
}

function showFilterMenu(id, anchorBtn) {
  if (!filterMenuEl) return;
  hideMenus();
  filterTarget = id;
  const current = cache[id].filter;
  filterMenuEl.innerHTML = FILTERS.map((f) =>
    `<button class="context-menu-item ${f.id === current ? 'checked' : ''}" data-filter="${f.id}" type="button">${f.label}</button>`
  ).join('');
  const rect = anchorBtn.getBoundingClientRect();
  placeMenu(filterMenuEl, rect.left, rect.bottom + 2);
}

function setFilter(id, filter) {
  if (!FILTERS.some((f) => f.id === filter)) return;
  const entry = cache[id];
  if (entry.filter === filter) return;
  entry.filter = filter;
  entry.rows = [];
  entry.loadedAt = 0;
  entry.error = null;
  renderSection(id);
  loadSection(id);
}

// ─── actions ──────────────────────────────────────────────

function runAction(row, action) {
  if (!row.actions.some((a) => a.id === action)) return;
  switch (action) {
    case 'open': return openOnGitHub(row);
    case 'checkout': return checkoutPullRequest(row);
    case 'start-work': return startWork(row);
    case 'switch': return switchBranch(row);
    case 'delete': return deleteBranch(row);
    case 'open-terminal': return openTerminalHere(row);
    case 'remove': return removeWorktree(row);
    default: return undefined;
  }
}

/** D2: the browser opens only from the action or the context menu. */
function openOnGitHub(row) {
  if (row.url) ipcRenderer.send(IPC.OPEN_GITHUB_ISSUE, row.url);
}

/** D13: after a checkout-changing action the status bar and Changes follow. */
function afterCheckoutChange() {
  ipcRenderer.send(IPC.REFRESH_GIT_STATUS);
  return loadSection('branches');
}

function reportDirty(result) {
  if (result && result.error === 'uncommitted_changes') {
    notify.error('Commit or stash changes first');
    return true;
  }
  return false;
}

async function switchBranch(row) {
  const path = projectPath();
  if (!path) return;
  try {
    const result = await ipcRenderer.invoke(IPC.SWITCH_GIT_BRANCH, { projectPath: path, branchName: row.id, ...wsCtx() });
    if (reportDirty(result)) return;
    if (result.error) {
      notify.error(`Failed: ${result.error}`);
      return;
    }
    notify.success(`Switched to ${result.branch}`);
    await afterCheckoutChange();
  } catch (err) {
    notify.error('Failed to switch branch');
  }
}

async function checkoutPullRequest(row) {
  const path = projectPath();
  if (!path) return;
  try {
    const result = await ipcRenderer.invoke(IPC.CHECKOUT_GITHUB_PR, { projectPath: path, number: row.number });
    if (reportDirty(result)) return;
    if (result.error) {
      notify.error(`Failed: ${result.error}`);
      return;
    }
    notify.success(result.branch ? `Checked out #${row.number} (${result.branch})` : `Checked out #${row.number}`);
    await afterCheckoutChange();
  } catch (err) {
    notify.error('Failed to check out pull request');
  }
}

/** D1: branch only — `issue-<n>-<slug>` from the current branch, checked out. */
async function startWork(row) {
  const path = projectPath();
  if (!path) return;
  const branchName = rowModels.issueBranchName(row.number, row.primary);
  try {
    const result = await ipcRenderer.invoke(IPC.CREATE_GIT_BRANCH, {
      ...wsCtx(),
      projectPath: path,
      branchName,
      baseBranch: null,
      checkout: true
    });
    if (reportDirty(result)) return;
    if (result.error) {
      notify.error(`Failed: ${result.error}`);
      return;
    }
    notify.success(`Created and switched to ${branchName}`);
    if (!sectionState.isExpanded(sections, 'branches')) {
      sections = sectionState.setExpanded(sections, 'branches', true);
      persistSections();
      applySections();
    }
    await afterCheckoutChange();
  } catch (err) {
    notify.error('Failed to create branch');
  }
}

function confirmModal(opts) {
  return new Promise((resolve) => {
    taskConfirmModal.open({
      heading: opts.heading,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });
}

async function deleteBranch(row) {
  const path = projectPath();
  if (!path) return;
  const name = row.id;
  const ok = await confirmModal({
    heading: 'Delete branch?',
    message: `“${name}” will be deleted. This action can't be undone.`,
    confirmLabel: 'Delete'
  });
  if (!ok) return;

  try {
    let result = await ipcRenderer.invoke(IPC.DELETE_GIT_BRANCH, { projectPath: path, branchName: name, force: false, ...wsCtx() });
    if (result.error) {
      const force = await confirmModal({
        heading: 'Force delete branch?',
        message: `“${name}” is not fully merged. Its unmerged commits will be lost.`,
        confirmLabel: 'Force delete'
      });
      if (!force) return;
      result = await ipcRenderer.invoke(IPC.DELETE_GIT_BRANCH, { projectPath: path, branchName: name, force: true, ...wsCtx() });
      if (result.error) {
        notify.error(`Failed: ${result.error}`);
        return;
      }
    }
    notify.success(`Deleted ${name}`);
    await afterCheckoutChange();
  } catch (err) {
    notify.error('Failed to delete branch');
  }
}

async function openTerminalHere(row) {
  if (!openLane) {
    notify.error('Terminals are not available');
    return;
  }
  await openLane({ cwd: row.path });
}

async function removeWorktree(row) {
  const path = projectPath();
  if (!path) return;
  const label = row.slug ? `${row.primary} (spec: ${row.slug})` : row.primary;
  const ok = await confirmModal({
    heading: 'Remove worktree?',
    message: `“${label}” at ${row.path} will be removed.`,
    confirmLabel: 'Remove'
  });
  if (!ok) return;

  try {
    let result = await ipcRenderer.invoke(IPC.REMOVE_GIT_WORKTREE, { projectPath: path, worktreePath: row.path, force: false, ...wsCtx() });
    if (result.error) {
      const force = await confirmModal({
        heading: 'Force remove worktree?',
        message: `“${label}” has local changes. They will be lost.`,
        confirmLabel: 'Force remove'
      });
      if (!force) return;
      result = await ipcRenderer.invoke(IPC.REMOVE_GIT_WORKTREE, { projectPath: path, worktreePath: row.path, force: true, ...wsCtx() });
      if (result.error) {
        notify.error(`Failed: ${result.error}`);
        return;
      }
    }
    notify.success('Worktree removed');
    await loadSection('worktrees');
    await loadSection('branches');
  } catch (err) {
    notify.error('Failed to remove worktree');
  }
}

// ─── Create Branch modal (C6: reused as-is; only its trigger moved) ───

function setupModalListeners() {
  const modal = document.getElementById('create-branch-modal');
  const input = document.getElementById('new-branch-name');
  const closeBtn = document.getElementById('create-branch-modal-close');
  const cancelBtn = document.getElementById('create-branch-cancel');
  const confirmBtn = document.getElementById('create-branch-confirm');

  if (closeBtn) closeBtn.addEventListener('click', hideCreateBranchModal);
  if (cancelBtn) cancelBtn.addEventListener('click', hideCreateBranchModal);
  if (confirmBtn) confirmBtn.addEventListener('click', handleCreateBranch);

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleCreateBranch();
      } else if (e.key === 'Escape') {
        hideCreateBranchModal();
      }
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideCreateBranchModal();
    });
  }
}

function showCreateBranchModal() {
  const modal = document.getElementById('create-branch-modal');
  const input = document.getElementById('new-branch-name');
  const select = document.getElementById('base-branch-select');
  const checkbox = document.getElementById('switch-to-branch');
  if (!modal) return;

  modal.classList.add('visible');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  if (checkbox) checkbox.checked = true;
  populateBaseBranchSelect(select);
}

async function populateBaseBranchSelect(select) {
  if (!select) return;
  select.innerHTML = '<option value="">Loading...</option>';

  const path = projectPath();
  if (!path) {
    select.innerHTML = '<option value="">No project selected</option>';
    return;
  }

  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, path, wsCtx());
    if (result.error || !result.branches) {
      select.innerHTML = '<option value="">Failed to load branches</option>';
      return;
    }
    const localBranches = result.branches.filter((b) => !b.isRemote);
    const currentBranch = result.currentBranch;
    select.innerHTML = localBranches.map((branch) => {
      const isDefault = branch.name === currentBranch;
      return `<option value="${escapeHtml(branch.name)}" ${isDefault ? 'selected' : ''}>${escapeHtml(branch.name)}${isDefault ? ' (current)' : ''}</option>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load branches for select:', err);
    select.innerHTML = '<option value="">Failed to load branches</option>';
  }
}

function hideCreateBranchModal() {
  const modal = document.getElementById('create-branch-modal');
  if (modal) modal.classList.remove('visible');
}

async function handleCreateBranch() {
  const input = document.getElementById('new-branch-name');
  const select = document.getElementById('base-branch-select');
  const checkbox = document.getElementById('switch-to-branch');

  const branchName = input && input.value ? input.value.trim() : '';
  const baseBranch = select ? select.value : '';
  const shouldCheckout = checkbox ? checkbox.checked : true;

  if (!branchName) {
    notify.error('Please enter a branch name');
    return;
  }
  const path = projectPath();
  if (!path) return;

  try {
    const result = await ipcRenderer.invoke(IPC.CREATE_GIT_BRANCH, {
      ...wsCtx(),
      projectPath: path,
      branchName,
      baseBranch,
      checkout: shouldCheckout
    });
    if (result.error) {
      notify.error(`Failed: ${result.error}`);
      return;
    }
    hideCreateBranchModal();
    notify.success(shouldCheckout ? `Created and switched to ${branchName}` : `Created ${branchName}`);
    if (shouldCheckout) await afterCheckoutChange();
    else await loadSection('branches');
  } catch (err) {
    notify.error('Failed to create branch');
  }
}

// ─── exports ──────────────────────────────────────────────

module.exports = {
  init,
  show,
  hide,
  toggle,
  refresh: refreshAll,
  loadSection,
  revealSection,
  isVisible: () => isVisible
};
