/**
 * Workspace Section — the sidebar's Workspaces list (workspaces spec, T07).
 *
 * Sits under the project switcher, above the project nav. A main row (the
 * project's own checkout) comes first, then one row per workspace: the branch
 * as the primary label, the color name as the secondary one, and a status dot
 * folded from the workspace's terminals (workspaces/rollup.js). Clicking a
 * row selects it (state.setWorkspace), which re-points terminals, file tree,
 * git and sessions at that folder.
 *
 * Records come from main (WORKSPACES_LIST) and are re-read on
 * WORKSPACES_UPDATED and project changes. A workspace whose folder vanished
 * shows as missing with Restore / Remove record; archived ones sit behind a
 * toggle with Restore.
 *
 * The new-workspace dialog (T08) and the archive dialog (T09) plug in
 * through setActions() so this module does not depend on them.
 */

const { ipcRenderer } = require('electron');
const { enterSubmits } = require('./modalKeys');
const { selectionChange } = require('./scopeGuard');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const laneStatus = require('./laneStatus');
const notify = require('./notify');
const { escapeHtml } = require('./htmlUtils');
const rollup = require('./workspaces/rollup');
const workspacePr = require('./workspacePr');

let rootEl = null;
let menuEl = null;
let loadedFor = null;          // project path the list below belongs to
let isRepo = false;
let workspaces = [];           // active records (some may be `missing`)
let archived = [];
let pendingReselect = null; // projectPath whose remembered workspace a load still has to select (R10)
let showArchived = false;
let renaming = null;           // { id, field: 'name'|'branch' } while an inline editor is open
let renderScheduled = false;
let loadSeq = 0;
// In-flight specs per workspace id, from SPEC_DATA (spec-in-workspace):
// workspaceId → [{ slug, title, phase }].
let specsByWorkspace = new Map();

const actions = {
  onNew: null,                 // () => void — opens the new-workspace dialog (T08)
  onArchive: null,             // (workspace) => Promise — archive flow with the dirty dialog (T09)
  onRestored: null             // (workspace, result) => void — reruns setup after a restore (T09)
};

/** Let the dialogs plug in without this module requiring them. */
function setActions(next) {
  Object.assign(actions, next || {});
}

function init() {
  rootEl = document.getElementById('workspace-section');
  if (!rootEl) {
    console.error('workspaceSection: #workspace-section not found — the workspace list will not show');
    return;
  }
  menuEl = document.createElement('div');
  menuEl.className = 'context-menu workspace-context-menu';
  menuEl.setAttribute('role', 'menu');
  document.body.appendChild(menuEl);

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('keydown', onKeyDown);
  rootEl.addEventListener('contextmenu', onContextMenu);
  menuEl.addEventListener('click', onMenuClick);
  document.addEventListener('mousedown', (e) => {
    if (menuEl.classList.contains('visible') && !menuEl.contains(e.target)) hideMenu();
  });
  window.addEventListener('blur', hideMenu);

  state.onProjectChange(() => {
    specsByWorkspace = new Map();
    workspaces = [];
    archived = [];
    showArchived = false;
    loadedFor = null;
    render();
    load({ reselect: true });
  });
  state.onWorkspaceChange(() => scheduleRender());
  // Git / PR state per workspace (workspace-pr-flow).
  workspacePr.onChange(() => scheduleRender());
  laneStatus.onChange(() => scheduleRender());
  ipcRenderer.on(IPC.WORKSPACES_UPDATED, (event, { projectPath } = {}) => {
    if (projectPath && projectPath === state.getProjectPath()) load();
  });
  window.addEventListener('focus', () => { if (state.getProjectPath()) load(); });
  ipcRenderer.on(IPC.SPEC_DATA, (event, { projectPath, specs } = {}) => {
    if (projectPath !== state.getProjectPath()) return;
    const next = new Map();
    for (const spec of specs || []) {
      if (!spec || !spec.workspace || spec.malformed) continue;
      if (!next.has(spec.workspace.id)) next.set(spec.workspace.id, []);
      next.get(spec.workspace.id).push({ slug: spec.slug, title: spec.title, phase: spec.phase });
    }
    specsByWorkspace = next;
    scheduleRender();
  });

  if (state.getProjectPath()) load({ reselect: true });
  else render();
}

/** Re-read the project's workspaces; with `reselect`, restore the remembered selection. */
async function load({ reselect = false } = {}) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  // Sticky: a reselect asked for by a load that a newer load overtakes is
  // still applied by whichever load finishes for this project (R10).
  if (reselect) pendingReselect = projectPath;
  const seq = ++loadSeq;
  let result;
  try {
    result = await ipcRenderer.invoke(IPC.WORKSPACES_LIST, projectPath);
  } catch (err) {
    result = { error: err.message, isRepo: false, workspaces: [], archived: [] };
  }
  if (seq !== loadSeq || state.getProjectPath() !== projectPath) return;
  loadedFor = projectPath;
  isRepo = !!(result && result.isRepo);
  workspaces = (result && result.workspaces) || [];
  archived = (result && result.archived) || [];
  // Saved terminal sessions of workspaces that are gone free their slots (R14).
  if (result && !result.error && result.isRepo) {
    try {
      const ui = require('./terminal').getMultiTerminalUI();
      if (ui) ui.getManager().pruneWorkspaceSessions(projectPath, workspaces.map((w) => w.id));
    } catch (_) { /* terminals not ready yet */ }
  }

  const selected = state.getWorkspace();
  if (pendingReselect === projectPath) {
    pendingReselect = null;
    const wanted = state.getRememberedWorkspaceId(projectPath);
    const ws = workspaces.find((w) => w.id === wanted && !w.missing);
    if (ws) select(ws);
  } else if (selected && selected.id !== state.MAIN_WORKSPACE_ID) {
    // The selected workspace was archived, removed or went missing: back to main.
    const still = workspaces.find((w) => w.id === selected.id && !w.missing);
    if (!still) state.setWorkspace(null);
    else if (selectionChange(selected, { id: still.id, root: still.path, name: still.name, branch: still.branch }) === 'meta') {
      // Renamed branch or name: update in place — selecting again was a
      // no-op that provisioned the worktree on every refresh (R11).
      state.updateWorkspaceMeta({ branch: still.branch, name: still.name });
    }
  }
  render();
}

function select(ws) {
  if (!ws) {
    state.setWorkspace(null);
    return;
  }
  if (ws.missing) return;
  state.setWorkspace({ id: ws.id, root: ws.path, name: ws.name, branch: ws.branch });
  if (ws.location === 'server') return; // its tooling lives on the server
  // Refresh Frame's tooling in the worktree (hooks, staged templates, spec
  // index) so the agents about to run there see what main sees.
  ipcRenderer.invoke(IPC.WORKSPACE_PROVISION, { projectPath: state.getProjectPath(), id: ws.id })
    .catch(() => { /* best effort — the next spec command provisions again */ });
}

function scheduleRender() {
  // A live re-render would replace an open rename field and lose what was typed.
  if (renderScheduled || renaming) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

function summaries() {
  const projectPath = state.getProjectPath();
  let states = [];
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    if (ui) states = ui.getManager().getTerminalStates(true);
  } catch (_) { /* terminal system not ready yet */ }
  return rollup.summarize(states, projectPath, (id) => laneStatus.getStatus(id));
}

const DOT_TITLES = {
  approval: 'An agent is waiting for permission',
  input: 'An agent is waiting for your input',
  working: 'Working',
  idle: ''
};

function dotHtml(summary) {
  if (!summary || summary.dot === 'idle') return '<span class="ws-dot" aria-hidden="true"></span>';
  return `<span class="ws-dot ${summary.dot}" title="${DOT_TITLES[summary.dot]}"></span>`;
}

function rowHtml(ws, { selectedId, sums }) {
  const on = ws.id === selectedId ? ' on' : '';
  const missing = ws.missing ? ' missing' : '';
  const where = ws.location === 'server' ? ` server${ws.offline ? ' offline' : ''}` : '';
  const editing = renaming && renaming.id === ws.id;
  const primary = editing && renaming.field === 'branch'
    ? `<input class="ws-rename" data-field="branch" value="${escapeHtml(ws.branch)}" spellcheck="false">`
    : `<span class="ws-primary" title="${escapeHtml(ws.branch)}">${escapeHtml(ws.branch)}</span>`;
  const secondary = editing && renaming.field === 'name'
    ? `<input class="ws-rename" data-field="name" value="${escapeHtml(ws.name)}" spellcheck="false">`
    : `<span class="ws-secondary">${escapeHtml(ws.name)}${ws.missing ? ' · missing' : ''}${ws.location === 'server' ? `<span class="ws-loc" title="${ws.offline ? 'Offline — ' : ''}Runs on the server ${escapeHtml(ws.host || '')}">${ws.offline ? 'offline' : escapeHtml(ws.host || 'server')}</span>` : ''}</span>`;
  // The spec this workspace holds (spec-in-workspace): one click opens it.
  const held = specsByWorkspace.get(ws.id) || [];
  const specLine = held.length && !ws.missing
    ? `<button type="button" class="ws-spec" data-act="open-spec" data-slug="${escapeHtml(held[0].slug)}" title="${escapeHtml(held[0].title || held[0].slug)} · ${escapeHtml(String(held[0].phase || '').replace(/_/g, ' '))}">spec · ${escapeHtml(held[0].slug)}${held.length > 1 ? ` +${held.length - 1}` : ''}</button>`
    : '';
  const trailing = ws.missing
    ? `<button class="ws-act" data-act="restore-missing" type="button" title="Recreate the folder from the branch">Restore</button>
       <button class="ws-act" data-act="remove-record" type="button" title="Forget this workspace">Remove</button>`
    : `<button class="ws-more" data-act="menu" type="button" aria-label="Workspace actions" title="Workspace actions">⋯</button>`;
  return `
    <div class="ws-row${on}${missing}${where}" data-id="${escapeHtml(ws.id)}" tabindex="0" role="button" aria-pressed="${!!on}">
      ${dotHtml(rollup.summaryFor(sums, ws.id))}
      <span class="ws-labels">${primary}${secondary}${specLine}${workspacePr.rowBadgesHtml(ws)}</span>
      ${trailing}
    </div>`;
}

function render() {
  if (!rootEl) return;
  const projectPath = state.getProjectPath();
  rootEl.hidden = !projectPath;
  if (!projectPath) {
    rootEl.innerHTML = '';
    return;
  }
  const selected = state.getWorkspace();
  const selectedId = selected ? selected.id : state.MAIN_WORKSPACE_ID;
  const sums = summaries();
  const canCreate = isRepo && loadedFor === projectPath;
  const addTitle = canCreate
    ? 'New workspace (⌘⇧N)'
    : (loadedFor === projectPath ? 'Workspaces need a git repository' : 'Loading…');
  const mainOn = selectedId === state.MAIN_WORKSPACE_ID ? ' on' : '';

  const archivedHtml = archived.length
    ? `<button class="ws-archived-toggle${showArchived ? ' open' : ''}" data-act="toggle-archived" type="button">
         Archived <span class="ws-count">${archived.length}</span>
       </button>
       ${showArchived ? `<div class="ws-archived">${archived.map((ws) => `
         <div class="ws-row archived" data-id="${escapeHtml(ws.id)}">
           <span class="ws-dot" aria-hidden="true"></span>
           <span class="ws-labels"><span class="ws-primary" title="${escapeHtml(ws.branch)}">${escapeHtml(ws.branch)}</span><span class="ws-secondary">${escapeHtml(ws.name)}</span></span>
           <button class="ws-act" data-act="restore" type="button">Restore</button>
         </div>`).join('')}</div>` : ''}`
    : '';

  rootEl.innerHTML = `
    <div class="ws-header">
      <span class="ws-title">Workspaces</span>
      <button class="ws-add" data-act="new" type="button" ${canCreate ? '' : 'disabled'} title="${escapeHtml(addTitle)}" aria-label="New workspace">＋</button>
    </div>
    <div class="ws-list">
      <div class="ws-row main${mainOn}" data-id="main" tabindex="0" role="button" aria-pressed="${!!mainOn}">
        ${dotHtml(rollup.summaryFor(sums, state.MAIN_WORKSPACE_ID))}
        <span class="ws-labels"><span class="ws-primary">main</span><span class="ws-secondary">project checkout</span></span>
      </div>
      ${workspaces.map((ws) => rowHtml(ws, { selectedId, sums })).join('')}
    </div>
    ${archivedHtml}`;

  const input = rootEl.querySelector('.ws-rename');
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('blur', () => commitRename(input));
  }
}

function findWs(id) {
  return workspaces.find((w) => w.id === id) || archived.find((w) => w.id === id) || null;
}

function onClick(e) {
  const actEl = e.target.closest('[data-act]');
  const row = e.target.closest('.ws-row');
  if (e.target.closest('.ws-rename')) return;
  if (actEl) {
    e.stopPropagation();
    const act = actEl.dataset.act;
    const ws = row ? findWs(row.dataset.id) : null;
    if (act === 'new') return openNew();
    if (act === 'toggle-archived') { showArchived = !showArchived; return render(); }
    if (act === 'menu' && ws) {
      const rect = actEl.getBoundingClientRect();
      return showMenu(ws, rect.left, rect.bottom + 2);
    }
    if ((act === 'restore' || act === 'restore-missing') && ws) return restoreWorkspace(ws);
    if (act === 'remove-record' && ws) return removeRecord(ws);
    if (act === 'open-spec' && ws) return openHeldSpec(ws, actEl.dataset.slug);
    return;
  }
  if (!row || row.classList.contains('archived')) return;
  if (row.dataset.id === state.MAIN_WORKSPACE_ID) return select(null);
  const ws = findWs(row.dataset.id);
  if (ws && ws.missing) {
    notify.info(`The folder for "${ws.name}" is gone. Restore it from its branch, or remove the record.`);
    return;
  }
  select(ws);
}

function onKeyDown(e) {
  if (e.target.classList && e.target.classList.contains('ws-rename')) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); renaming = null; render(); }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ws-row')) {
    e.preventDefault();
    e.target.click();
  }
}

function onContextMenu(e) {
  const row = e.target.closest('.ws-row');
  if (!row || row.classList.contains('main') || row.classList.contains('archived')) return;
  const ws = findWs(row.dataset.id);
  if (!ws || ws.missing) return;
  e.preventDefault();
  showMenu(ws, e.clientX, e.clientY);
}

// ─── Row menu ────────────────────────────────────────────────

let menuTarget = null;

function showMenu(ws, x, y) {
  menuTarget = ws;
  // The PR flow's actions first (push, PR…), then the workspace's own.
  // Server workspaces have the same way out, run on the server
  // (server-workspace-panels); an offline one offers none until it is back.
  const prItems = workspacePr.menuItems(ws);
  const items = [
    ...prItems,
    ...(prItems.length ? [{ separator: true }] : []),
    { id: 'rename', label: 'Rename…' },
    { id: 'rename-branch', label: 'Rename branch…' },
    { id: 'archive', label: 'Archive…', danger: true }
  ];
  menuEl.innerHTML = items.map((a) => a.separator
    ? '<div class="context-menu-separator"></div>'
    : `<button class="context-menu-item${a.danger ? ' danger' : ''}" data-menu="${escapeHtml(a.id)}" type="button"${a.disabled ? ' disabled' : ''}${a.title ? ` title="${escapeHtml(a.title)}"` : ''}>${escapeHtml(a.label)}</button>`).join('');
  menuEl.classList.add('visible');
  menuEl.style.position = 'fixed';
  menuEl.style.zIndex = '1000';
  const w = menuEl.offsetWidth || 180;
  const h = menuEl.offsetHeight || 120;
  menuEl.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  menuEl.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
}

function hideMenu() {
  if (menuEl) menuEl.classList.remove('visible');
}

function onMenuClick(e) {
  const item = e.target.closest('[data-menu]');
  if (!item || !menuTarget) return;
  const ws = menuTarget;
  hideMenu();
  if (workspacePr.runAction(item.dataset.menu, ws)) return;
  if (item.dataset.menu === 'rename') startRename(ws, 'name');
  else if (item.dataset.menu === 'rename-branch') startRename(ws, 'branch');
  else if (item.dataset.menu === 'archive') archiveWorkspace(ws);
}

// ─── Actions ─────────────────────────────────────────────────

function openNew() {
  if (!isRepo) {
    notify.info('Workspaces need a git repository.');
    return;
  }
  if (typeof actions.onNew === 'function') actions.onNew();
}

function startRename(ws, field) {
  renaming = { id: ws.id, field };
  render();
}

async function commitRename(input) {
  if (!renaming) return;
  const { id, field } = renaming;
  renaming = null;
  const ws = findWs(id);
  const value = input.value.trim();
  if (!ws || !value || value === ws[field]) return render();
  const result = await ipcRenderer.invoke(IPC.WORKSPACE_RENAME, {
    projectPath: state.getProjectPath(), id, [field]: value
  });
  if (result && result.error) notify.error(result.error);
  await load();
}

/**
 * Archive a workspace (T09). Clean → archived straight away. Uncommitted
 * changes → the dialog asks: commit them (editable message) or discard them;
 * Cancel leaves everything as it was. Frame never commits on its own (C4).
 * The workspace's terminals are closed first, and the selection returns to main.
 */
async function archiveWorkspace(ws) {
  if (typeof actions.onArchive === 'function') return actions.onArchive(ws);
  const projectPath = state.getProjectPath();
  const status = await ipcRenderer.invoke(IPC.WORKSPACE_STATUS, { projectPath, id: ws.id });
  if (status && status.error && !ws.missing) {
    notify.error(status.error);
    return;
  }
  let choice = {};
  if (status && status.dirty) {
    choice = await askArchiveChoice(ws, status.count);
    if (!choice) return; // cancelled
  }
  // Commits no branch holds — or a commit about to be made on a detached
  // HEAD — would go with the folder: ask before any terminal is closed
  // (workspace-hardening L3, decision B1).
  const raw = status && status.head;
  // A commit made now on a detached HEAD moves it: the rescue sha is not known yet.
  const head = raw && raw.detached && choice.action === 'commit' ? { ...raw, sha: null } : raw;
  if (head && (head.unreachable > 0 || (head.detached && choice.action === 'commit'))) {
    const keep = await askRescue(ws, head);
    if (!keep) return;
    choice.rescue = true;
  }
  closeWorkspaceTerminals(ws.id);
  let result = await ipcRenderer.invoke(IPC.WORKSPACE_ARCHIVE, { projectPath, id: ws.id, ...choice });
  if (result && result.headOff) {
    // Commits appeared after the check (an agent was still working): ask now.
    const keep = await askRescue(ws, result.headOff);
    if (!keep) { await load(); return; }
    result = await ipcRenderer.invoke(IPC.WORKSPACE_ARCHIVE, { projectPath, id: ws.id, rescue: true });
  }
  if (result && result.error) notify.error(result.error);
  else if (result && result.dirty) notify.error(`"${ws.name}" changed while archiving — try again.`);
  else if (result && result.headOff) notify.error(`"${ws.name}" was not archived: it has commits that are not on any branch.`);
  else if (choice.rescue) notify.success(`Archived "${ws.name}" — its commits are kept on ${rescueBranchName(ws, head)}.`);
  else notify.success(`Archived "${ws.name}" — its branch ${ws.branch} is kept.`);
  await load();
}

/** The branch name archive's rescue creates; the sha may be unknown before a commit is made. */
function rescueBranchName(ws, head) {
  const sha = head && typeof head.sha === 'string' ? head.sha.slice(0, 7) : '';
  return `${ws.branch}-rescue-${sha || '<sha>'}`;
}

/** The rescue dialog: keep unreachable commits on a rescue branch, or cancel. Resolves true/false. */
function askRescue(ws, head) {
  const modal = document.getElementById('archive-rescue-modal');
  if (!modal) return Promise.resolve(false);
  const n = Number(head && head.unreachable) || 0;
  modal.querySelector('#ar-summary').textContent = n > 0
    ? `"${ws.name}" has ${n} commit${n === 1 ? '' : 's'} on ${head.detached ? 'a detached HEAD' : `another branch (${head.ref || '?'})`} that no branch holds.`
    : `"${ws.name}" is on a detached HEAD: the commit made now would not be on any branch.`;
  modal.querySelector('#ar-branch').textContent = rescueBranchName(ws, head);
  const confirm = modal.querySelector('#ar-confirm');
  const cancel = modal.querySelector('#ar-cancel');
  modal.classList.add('visible');
  cancel.focus();
  return new Promise((resolve) => {
    const cleanup = (value) => {
      modal.classList.remove('visible');
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKey);
      modal.removeEventListener('mousedown', onBackdrop);
      resolve(value);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    // Enter does what the focused button says; focus starts on Cancel.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter' && e.target !== confirm && e.target !== cancel) { e.preventDefault(); onCancel(); }
    };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKey);
    modal.addEventListener('mousedown', onBackdrop);
  });
}

/** Select a workspace and open the spec it holds in the specs drawer. */
function openHeldSpec(ws, slug) {
  select(ws);
  const ui = require('./terminal').getMultiTerminalUI();
  if (!ui || !slug) return;
  ui.showSpecsGrid();
  require('./specsDashboard').openSpec(slug, { instant: true });
}

/** Close every terminal of one workspace of the current project. */
function closeWorkspaceTerminals(workspaceId) {
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    if (!ui) return;
    const manager = ui.getManager();
    manager.getTerminalsInScope(state.getProjectPath(), workspaceId)
      .forEach((t) => manager.closeTerminal(t.id));
  } catch (err) {
    console.error('workspaceSection: could not close the workspace terminals', err);
  }
}

/** The dirty-archive dialog. Resolves `{ action, message }`, or null on cancel. */
function askArchiveChoice(ws, count) {
  const modal = document.getElementById('archive-workspace-modal');
  if (!modal) return Promise.resolve(null);
  const summary = modal.querySelector('#aw-summary');
  const message = modal.querySelector('#aw-message');
  const messageRow = modal.querySelector('#aw-message-row');
  const error = modal.querySelector('#aw-error');
  const confirm = modal.querySelector('#aw-confirm');
  const cancel = modal.querySelector('#aw-cancel');
  summary.textContent = `"${ws.name}" (${ws.branch}) has ${count} uncommitted change${count === 1 ? '' : 's'}.`;
  message.value = `WIP: archive ${ws.name}`;
  error.textContent = '';
  modal.querySelector('input[name="aw-action"][value="commit"]').checked = true;
  messageRow.hidden = false;
  modal.classList.add('visible');
  message.focus();
  message.select();

  return new Promise((resolve) => {
    const cleanup = (value) => {
      modal.classList.remove('visible');
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKey);
      modal.removeEventListener('change', onChange);
      modal.removeEventListener('mousedown', onBackdrop);
      resolve(value);
    };
    const action = () => modal.querySelector('input[name="aw-action"]:checked').value;
    const onConfirm = () => {
      if (action() === 'commit' && !message.value.trim()) {
        error.textContent = 'A commit needs a message.';
        return;
      }
      cleanup({ action: action(), message: message.value.trim() });
    };
    const onCancel = () => cleanup(null);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      // Enter on Cancel cancels: a focused button handles Enter itself (R1).
      if (e.key === 'Enter' && enterSubmits(e.target, e)) { e.preventDefault(); onConfirm(); }
    };
    const onChange = () => {
      messageRow.hidden = action() !== 'commit';
      confirm.textContent = action() === 'discard' ? 'Discard and archive' : 'Commit and archive';
      confirm.classList.toggle('danger', action() === 'discard');
    };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKey);
    modal.addEventListener('change', onChange);
    modal.addEventListener('mousedown', onBackdrop);
    onChange();
  });
}

/** The selected workspace's record, or null on main. */
function selectedWorkspace() {
  const ws = state.getWorkspace();
  if (!ws || ws.id === state.MAIN_WORKSPACE_ID) return null;
  return workspaces.find((w) => w.id === ws.id) || null;
}

async function restoreWorkspace(ws) {
  const projectPath = state.getProjectPath();
  const result = await ipcRenderer.invoke(IPC.WORKSPACE_RESTORE, { projectPath, id: ws.id });
  if (result && result.error) {
    notify.error(result.error);
    return;
  }
  await load();
  const restored = workspaces.find((w) => w.id === ws.id);
  if (restored) select(restored);
  if (typeof actions.onRestored === 'function') actions.onRestored(restored || ws, result);
}

async function removeRecord(ws) {
  const result = await ipcRenderer.invoke(IPC.WORKSPACE_REMOVE_RECORD, { projectPath: state.getProjectPath(), id: ws.id });
  if (result && result.error) notify.error(result.error);
  await load();
}

// ─── Specs that live in workspaces (spec-in-workspace) ───────

/** A small chip naming the workspace a spec lives in; '' for main. */
function workspaceChipHtml(ws) {
  if (!ws) return '';
  return `<span class="ws-chip" title="In workspace ${escapeHtml(ws.name)} · ${escapeHtml(ws.branch || '')}">${escapeHtml(ws.name)}</span>`;
}

/**
 * Select the checkout a spec lives in (its workspace, or main). Returns true
 * when the selection changed — the caller then re-opens its view, because a
 * workspace switch lands the center on that workspace's terminals.
 */
function selectSpecWorkspace(ws) {
  const current = state.getWorkspace();
  if (!current) return false;
  if (ws) {
    if (current.id === ws.id) return false;
    select({ id: ws.id, path: ws.root, name: ws.name, branch: ws.branch });
    return true;
  }
  if (current.id === state.MAIN_WORKSPACE_ID) return false;
  select(null);
  return true;
}

/** Active workspaces of the current project, as last loaded. */
function getWorkspaces() {
  return workspaces.slice();
}

module.exports = {
  init,
  load,
  render,
  select,
  setActions,
  getWorkspaces,
  selectedWorkspace,
  workspaceChipHtml,
  selectSpecWorkspace,
  archiveWorkspace,
  startRename
};
