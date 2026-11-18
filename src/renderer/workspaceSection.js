/**
 * Workspace Section — the sidebar's workspace list (workspaces spec, T07;
 * opened in place by workspace-list-agent-alerts).
 *
 * The second level under the project switcher: a "Workspaces" header with
 * "+" (New workspace; the dialog picks where it runs), and under it the list
 * itself. The header folds the list, per sidebar view (open in Projects,
 * folded in Files, Changes and GitHub until the user says otherwise); folded,
 * it shows the selected workspace and how many agents wait elsewhere. Open:
 *   - the main row (the project's own checkout, labelled with the branch it
 *     is on), then this Mac's workspaces;
 *   - one sub-header per saved Frame Server (host, Connect while it is down)
 *     with that server's workspaces (multi-server-connections). With no
 *     server saved: one "Connect a server…" row. Adding another server is
 *     the rail's Add Server button, ⌘⌥N or the File menu.
 * Each row: the branch as the primary label, the color name as the
 * secondary one, and a status dot folded from the workspace's terminals
 * (workspaces/rollup.js). Clicking a row selects it (state.setWorkspace),
 * which re-points terminals, file tree, git and sessions at that folder.
 *
 * Records come from main (WORKSPACES_LIST) and are re-read on
 * WORKSPACES_UPDATED and project changes. A workspace whose folder vanished
 * shows as missing with Restore / Remove record; archived ones cost one
 * "Archived N" row, which opens a dialog (filter, Restore per row).
 *
 * The new-workspace dialog (T08) and the archive dialog (T09) plug in
 * through setActions() so this module does not depend on them.
 */

const { ipcRenderer } = require('electron');
const { enterSubmits } = require('./modalKeys');
const { selectionChange } = require('./scopeGuard');
const { IPC } = require('../shared/ipcChannels');
const { chipLabel } = require('../shared/workspaceSpecs');
const state = require('./state');
const laneStatus = require('./laneStatus');
const notify = require('./notify');
const { escapeHtml } = require('./htmlUtils');
const rollup = require('./workspaces/rollup');
const attention = require('./workspaces/attention');
const listPrefs = require('./workspaces/listPrefs');
const workspacePr = require('./workspacePr');

let rootEl = null;
let menuEl = null;
let loadedFor = null;          // project path the list below belongs to
let isRepo = false;
let workspaces = [];           // active records (some may be `missing`)
let archived = [];
let mainBranch = null;         // the branch the project's own checkout is on (null: unknown / not git)
let pendingReselect = null; // projectPath whose remembered workspace a load still has to select (R10)
let renaming = null;           // { id, field: 'name'|'branch' } while an inline editor is open
let renderScheduled = false;
let loadSeq = 0;
let loadWaiters = [];          // whenLoaded() callers: { projectPath, resolve }
let shownSelectedId = null;    // the selection the list last drew: a new one is scrolled into view
let view = 'projects';         // the sidebar view on screen (index.js's revealSidebarTab)
// Open or folded, per view: localStorage `frame-ws-list-open` (workspaces/listPrefs.js).
let openPrefs = (() => {
  try { return listPrefs.parse(localStorage.getItem(listPrefs.STORAGE_KEY)); } catch (_) { return {}; }
})();

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
  // Remote's sub-headers and empty states follow every server's link.
  require('./serverConnect').onServersChange((next, prev) => {
    const sig = (list) => (list || []).map((s) => `${s.key}:${s.host}:${s.status && s.status.state}`).join('|');
    if (sig(next) !== sig(prev)) scheduleRender();
  });

  state.onProjectChange(() => {
    lastServerCounts = null; // counts are per project
    workspaces = [];
    archived = [];
    mainBranch = null;
    closeArchived();
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
  // A branch switched in the main checkout: git's status push for that
  // folder (sent while main is the one watched) carries the new name.
  ipcRenderer.on(IPC.GIT_STATUS_DATA, (event, payload) => {
    if (!payload || !payload.isRepo || !payload.branch) return;
    if (payload.projectPath !== state.getProjectPath() || loadedFor !== payload.projectPath) return;
    if (payload.branch === mainBranch) return;
    mainBranch = payload.branch;
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
  if (!(result && result.error)) openServersThatGrew(workspaces);
  archived = (result && result.archived) || [];
  if (archivedOpen()) renderArchivedList();
  mainBranch = (result && result.mainBranch) || null;
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
  // The list is in and the remembered selection applied: whoever waited may go on.
  const ready = loadWaiters.filter((w) => w.projectPath === projectPath);
  loadWaiters = loadWaiters.filter((w) => w.projectPath !== projectPath);
  ready.forEach((w) => w.resolve(true));
}

const LOAD_WAIT_MS = 2000;

/**
 * Resolves once `projectPath`'s workspace list has loaded and its remembered
 * workspace is selected — true — or after a short wait — false — so a caller
 * that just switched project (the status bar's agent popover) can land on a
 * workspace of it without hanging on a slow or failed read.
 */
function whenLoaded(projectPath) {
  if (!projectPath) return Promise.resolve(false);
  if (loadedFor === projectPath && state.getProjectPath() === projectPath && pendingReselect !== projectPath) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const waiter = { projectPath, resolve: (value) => { clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => {
      loadWaiters = loadWaiters.filter((w) => w !== waiter);
      resolve(false);
    }, LOAD_WAIT_MS);
    loadWaiters.push(waiter);
  });
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

/** Select a workspace by id ('main' for the project checkout). False when it is not in the list, or its folder is gone. */
function selectById(id) {
  if (!id || id === state.MAIN_WORKSPACE_ID) {
    select(null);
    return true;
  }
  const ws = workspaces.find((w) => w.id === id && !w.missing);
  if (!ws) return false;
  select(ws);
  return true;
}

/**
 * What "Switch Workspace…" lists: main and every workspace whose folder is
 * there, most urgent first (a workspace with a waiting agent, in the
 * attention queue's order), the rest in the list's order. `detail` is the
 * wait label, else "current" on the selected one.
 */
function switchItems() {
  const queue = waitingQueue();
  const urgency = [...new Set(queue.map((entry) => entry.workspaceId))];
  const rank = (id) => (urgency.includes(id) ? urgency.indexOf(id) : urgency.length);
  const selected = state.getWorkspace();
  const selectedId = selected ? selected.id : state.MAIN_WORKSPACE_ID;
  const rows = [
    { id: state.MAIN_WORKSPACE_ID, title: mainLabel() },
    ...workspaces.filter((w) => !w.missing).map((w) => ({ id: w.id, title: w.branch || w.name }))
  ];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row.id) - rank(b.row.id) || a.index - b.index)
    .map(({ row }) => {
      const wait = attention.workspaceWait(queue, row.id);
      return {
        id: row.id,
        title: row.title,
        detail: wait ? attention.waitLabel(wait.kind) : (row.id === selectedId ? 'current' : '')
      };
    });
}

/**
 * Show the most urgent waiting agent that is not already on screen:
 * approval before input, then the longest wait. Selects its workspace, then
 * its terminal. When none waits, a notice says so and nothing changes.
 */
function goToNextWaiting() {
  let ui = null;
  try { ui = require('./terminal').getMultiTerminalUI(); } catch (_) { /* terminal system not ready yet */ }
  const onScreen = ui && ui.isViewingFrame() ? ui.getManager().activeTerminalId : null;
  const next = attention.nextWaiting(waitingQueue(), onScreen);
  if (!next || !ui) {
    notify.info(onScreen && waitingQueue().length ? 'No other agent is waiting.' : 'No agent is waiting.');
    return false;
  }
  if (!selectById(next.workspaceId)) return false;
  ui.enterLane(next.terminalId);
  return true;
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

/** Every terminal's state, across projects and workspaces. */
function terminalStates() {
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    if (ui) return ui.getManager().getTerminalStates(true);
  } catch (_) { /* terminal system not ready yet */ }
  return [];
}

function summaries() {
  return rollup.summarize(terminalStates(), state.getProjectPath(), (id) => laneStatus.getStatus(id));
}

/** This project's agents that wait on the user, most urgent first (workspaces/attention.js). */
function waitingQueue() {
  return attention.waitingQueue(terminalStates(), state.getProjectPath(), (id) => laneStatus.getStatus(id));
}

const WAIT_TITLES = {
  approval: 'is waiting for permission',
  input: 'is waiting for your input'
};

/**
 * A row's trailing label while an agent in that workspace waits:
 * `approval` or `waiting`, the agent's name in the tooltip. Nothing
 * otherwise, so rows keep one height whether or not an agent waits.
 */
function waitHtml(queue, workspaceId) {
  const wait = attention.workspaceWait(queue, workspaceId);
  if (!wait) return '';
  const who = wait.agentName || 'An agent';
  return `<span class="ws-wait ${wait.kind}" title="${escapeHtml(`${who} ${WAIT_TITLES[wait.kind]}`)}">${escapeHtml(attention.waitLabel(wait.kind))}</span>`;
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

function rowHtml(ws, { selectedId, sums, queue }) {
  const on = ws.id === selectedId ? ' on' : '';
  const missing = ws.missing ? ' missing' : '';
  const where = ws.location === 'server' ? ` server${ws.offline ? ' offline' : ''}` : '';
  const editing = renaming && renaming.id === ws.id;
  const primary = editing && renaming.field === 'branch'
    ? `<input class="ws-rename" data-field="branch" value="${escapeHtml(ws.branch)}" spellcheck="false">`
    : `<span class="ws-primary">${escapeHtml(ws.branch)}</span>`;
  // A second line only when it adds something: the name when it is not
  // just the branch's last segment (ws/violet → violet), a missing folder,
  // an offline server. The Remote group's head already names the host.
  const tail = String(ws.branch || '').split('/').pop();
  const notes = [
    ws.name && ws.name !== tail ? escapeHtml(ws.name) : '',
    ws.missing ? 'missing' : '',
    ws.offline ? 'offline' : ''
  ].filter(Boolean).join(' · ');
  const secondary = editing && renaming.field === 'name'
    ? `<input class="ws-rename" data-field="name" value="${escapeHtml(ws.name)}" spellcheck="false">`
    : (notes ? `<span class="ws-secondary">${notes}</span>` : '');
  const trailing = ws.missing
    ? `<button class="ws-act" data-act="restore-missing" type="button" title="Recreate the folder from the branch">Restore</button>
       <button class="ws-act" data-act="remove-record" type="button" title="Forget this workspace">Remove</button>`
    : `<button class="ws-more" data-act="menu" type="button" aria-label="Workspace actions" title="Workspace actions">⋯</button>`;
  return `
    <div class="ws-row${on}${missing}${where}" data-id="${escapeHtml(ws.id)}" tabindex="0" role="button"${on ? ' aria-current="true"' : ''}>
      ${dotHtml(rollup.summaryFor(sums, ws.id))}
      <span class="ws-labels">${primary}${secondary}</span>
      ${waitHtml(queue, ws.id)}
      ${trailing}
    </div>`;
}

const PLUS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const SERVER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><line x1="7" y1="7.5" x2="7.01" y2="7.5"/><line x1="7" y1="16.5" x2="7.01" y2="16.5"/></svg>';

/** A saved server as the Remote group reads it: `{ key, host, phase, state }`. */
function linkView(srv) {
  const st = (srv.status && srv.status.state) || 'off';
  let phase = 'off';
  if (st === 'connected') phase = 'up';
  else if (st === 'connecting' || st === 'reconnecting' || st === 'installing') phase = 'busy';
  else if (st === 'needs-install' || st === 'needs-update') phase = 'setup';
  return { key: srv.key, host: srv.host, phase, state: st };
}

/** Every saved server, in list order (multi-server-connections). */
function serverViews() {
  try { return require('./serverConnect').getServers().map(linkView); } catch (_) { return []; }
}

/**
 * One server's sub-header in Remote, drawn as a labelled sub-separator: the
 * host, a hairline, and Connect / Set up while it is down (a down host reads
 * muted). Creating goes through the header's one "+" (the server is chosen
 * in the dialog), not a "+" per server.
 */
function serverHeadHtml(link, { collapsed, count, locked }) {
  const label = require('./serverConnect').LABELS[link.state] || link.state;
  let action = '';
  if (link.phase !== 'up' && link.phase !== 'busy') {
    action = `<button class="ws-group-link" data-act="connect" data-key="${escapeHtml(link.key)}" type="button">${link.phase === 'setup' ? 'Set up' : 'Connect'}</button>`;
  }
  const { Server } = require('lucide');
  const icon = require('./dock').lucideIcon(Server, 12);
  // The selected workspace's server stays open: its row must not disappear.
  const toggle = locked
    ? ''
    : ` data-act="toggle-server" data-key="${escapeHtml(link.key)}" tabindex="0" role="button" aria-expanded="${!collapsed}"`;
  return `<div class="ws-server-head ${link.phase}${collapsed ? ' collapsed' : ''}${locked ? ' locked' : ''}"${toggle} title="${escapeHtml(link.host)} · ${escapeHtml(label)}${locked ? '' : collapsed ? ' — show workspaces' : ' — hide workspaces'}">
      <span class="ws-server-caret" aria-hidden="true"></span>
      <span class="ws-server-icon" aria-hidden="true">${icon}</span>
      <span class="ws-server-name">${escapeHtml(link.host)}</span>
      <span class="ws-server-rule" aria-hidden="true"></span>
      ${collapsed && count ? `<span class="ws-server-count" title="${count} workspace${count === 1 ? '' : 's'}">${count}</span>` : ''}
      ${action}
    </div>`;
}

// Open / closed server sections (multi-server-connections), a view
// preference kept in this browser: localStorage `frame-ws-server-open` =
// { [serverKey]: true | false } — only servers the user toggled (or that just
// got a new workspace) have an entry. Without one, a server with no
// workspaces of the project starts closed and one with workspaces open.
const OPEN_KEY = 'frame-ws-server-open';
let serverOpen = (() => {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (_) { return {}; }
})();

function isServerOpen(key, count) {
  return typeof serverOpen[key] === 'boolean' ? serverOpen[key] : count > 0;
}

function setServerOpen(key, open) {
  serverOpen = { ...serverOpen, [key]: !!open };
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(serverOpen)); } catch (_) { /* preference only */ }
}

function toggleServer(key) {
  const count = workspaces.filter((w) => w.location === 'server' && w.serverKey === key).length;
  setServerOpen(key, !isServerOpen(key, count));
  render();
}

// Workspaces per server at the last load of this project: a server whose
// count grew (a workspace was just created there, from any path) opens, so
// the new row is in sight instead of hidden behind a closed header.
let lastServerCounts = null;

function serverCounts(list) {
  const out = {};
  for (const w of list) if (w.location === 'server' && w.serverKey) out[w.serverKey] = (out[w.serverKey] || 0) + 1;
  return out;
}

function openServersThatGrew(list) {
  const now = serverCounts(list);
  if (lastServerCounts) {
    for (const [key, n] of Object.entries(now)) if (n > (lastServerCounts[key] || 0)) setServerOpen(key, true);
  }
  lastServerCounts = now;
}

/** What a server with no workspaces of this project offers: the next step for its link. */
function serverEmptyHtml(link) {
  if (link.phase === 'up') {
    return '<div class="ws-empty ws-empty-compact"><p class="ws-empty-text">No workspaces yet</p></div>';
  }
  if (link.phase === 'busy') {
    return `<div class="ws-empty ws-empty-compact"><p class="ws-empty-text">${escapeHtml(require('./serverConnect').LABELS[link.state] || 'Connecting…')}</p></div>`;
  }
  const label = link.phase === 'setup' ? `Finish setup on ${escapeHtml(link.host)}` : `Reconnect ${escapeHtml(link.host)}`;
  return `<div class="ws-empty ws-empty-compact">
      <button class="ws-cta" data-act="connect" data-key="${escapeHtml(link.key)}" type="button">${SERVER}<span>${label}</span></button>
    </div>`;
}

/**
 * The Remote group: one sub-header per saved server with its own rows or its
 * own empty state. With no server saved yet, one "Connect a server…" row
 * that opens the Servers dialog on its add field — the why is its tooltip.
 * The sub-headers name the hosts, so the group carries no label of its own.
 */
function remoteGroupHtml(remote, { canCreate, selectedId, sums, queue }) {
  const links = serverViews();
  if (!links.length) {
    return `<button class="ws-cta" data-act="add-server" type="button" title="Run workspaces on your own machines over SSH — agents keep running while this Mac is away.">${SERVER}<span>Connect a server…</span></button>`;
  }
  const blocks = links.map((link) => {
    const rows = remote.filter((w) => w.serverKey === link.key);
    const locked = rows.some((w) => w.id === selectedId);
    const collapsed = !locked && !isServerOpen(link.key, rows.length);
    const body = collapsed ? '' : (rows.length ? rows.map((ws) => rowHtml(ws, { selectedId, sums, queue })).join('') : serverEmptyHtml(link));
    return `<div class="ws-server" role="group" aria-label="${escapeHtml(link.host)}">
        ${serverHeadHtml(link, { collapsed, count: rows.length, locked })}
        ${body}
      </div>`;
  }).join('');
  return blocks;
}

/**
 * The main row's label: the branch the project's own checkout is on, like
 * every other row; "main" (the row's name) until git has said, or outside git.
 */
function mainLabel() {
  return mainBranch || 'main';
}

/** The sidebar switched views: the list follows that view's own open / folded state. */
function setView(next) {
  const name = next || 'projects';
  if (name === view) return;
  view = name;
  render();
}

function toggleList() {
  openPrefs = listPrefs.withOpen(openPrefs, view, !listPrefs.isOpen(openPrefs, view));
  try { localStorage.setItem(listPrefs.STORAGE_KEY, JSON.stringify(openPrefs)); } catch (_) { /* preference only */ }
  render();
  const fold = rootEl && rootEl.querySelector('.ws-fold');
  if (fold) fold.focus({ preventScroll: true });
}

/**
 * The header's fold control. Open: the list's name. Folded: the selected
 * workspace's dot and branch — the face the dropdown's trigger had — and
 * "N waiting" when agents wait in this project's other workspaces, in the
 * colour of the most urgent one.
 */
function foldHtml({ open, selectedId, sums, queue }) {
  if (open) {
    return `<button class="ws-fold" data-act="fold" type="button" aria-expanded="true" title="Hide the workspace list">
        <span class="ws-fold-chevron" aria-hidden="true"></span>
        <span class="ws-head-title">Workspaces</span>
      </button>`;
  }
  const rec = selectedId === state.MAIN_WORKSPACE_ID ? null : workspaces.find((w) => w.id === selectedId);
  const name = rec ? rec.branch : mainLabel();
  const remote = rec && rec.location === 'server'
    ? `<span class="ws-switch-tag${rec.offline ? ' offline' : ''}" title="Runs on ${escapeHtml(rec.host || 'the server')}${rec.offline ? ' — offline' : ''}">${rec.offline ? 'offline' : 'remote'}</span>`
    : '';
  const others = attention.othersWaiting(queue, selectedId);
  const waiting = others.count
    ? `<span class="ws-fold-waiting ${others.kind}" title="${others.count} agent${others.count === 1 ? '' : 's'} waiting in other workspaces">${others.count} waiting</span>`
    : '';
  return `<button class="ws-fold" data-act="fold" type="button" aria-expanded="false" title="Show the workspace list">
      <span class="ws-fold-chevron" aria-hidden="true"></span>
      ${dotHtml(rollup.summaryFor(sums, selectedId))}
      <span class="ws-fold-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      ${remote}${waiting}
    </button>`;
}

function render() {
  if (!rootEl) return;
  const projectPath = state.getProjectPath();
  rootEl.hidden = !projectPath;
  if (!projectPath) {
    rootEl.innerHTML = '';
    return;
  }
  const prevList = rootEl.querySelector('.ws-list');
  const scrollTop = prevList ? prevList.scrollTop : 0;
  // The list is redrawn whole: a row that held the keyboard focus gets it back.
  const active = document.activeElement;
  const focusedId = active && active.classList && active.classList.contains('ws-row') && rootEl.contains(active) ? active.dataset.id : null;
  const selected = state.getWorkspace();
  const selectedId = selected ? selected.id : state.MAIN_WORKSPACE_ID;
  const sums = summaries();
  const queue = waitingQueue();
  // An inline rename lives in a row: the list is shown while one is open.
  const open = listPrefs.isOpen(openPrefs, view) || !!renaming;
  const canCreate = isRepo && loadedFor === projectPath;
  const addTitle = canCreate
    ? 'New workspace — on this Mac or a server (⌘⇧N)'
    : (loadedFor === projectPath ? 'Workspaces need a git repository' : 'Loading…');
  const mainOn = selectedId === state.MAIN_WORKSPACE_ID;
  const local = workspaces.filter((w) => w.location !== 'server');
  const remote = workspaces.filter((w) => w.location === 'server');

  // The archive costs one row however large it gets; it opens a dialog.
  const archivedHtml = archived.length
    ? `<div class="ws-sep" role="separator"></div>
       <button class="ws-archived-row" data-act="open-archived" type="button" aria-haspopup="dialog" title="Show archived workspaces">
         Archived <span class="ws-count">${archived.length}</span>
       </button>`
    : '';

  // `ws-switch` is kept on the header as a stable hook: the tour's Workspaces
  // step points at it.
  rootEl.innerHTML = `
    <div class="ws-head ws-switch${open ? '' : ' folded'}">
      ${foldHtml({ open, selectedId, sums, queue })}
      <button class="ws-group-add" data-act="new" type="button" aria-label="New workspace" ${canCreate ? '' : 'disabled'} title="${escapeHtml(addTitle)}">${PLUS}</button>
    </div>
    ${open ? `<div class="ws-list" role="group" aria-label="Workspaces">
      <div class="ws-row main${mainOn ? ' on' : ''}" data-id="main" tabindex="0" role="button"${mainOn ? ' aria-current="true"' : ''}>
        ${dotHtml(rollup.summaryFor(sums, state.MAIN_WORKSPACE_ID))}
        <span class="ws-labels"><span class="ws-primary" title="${escapeHtml(mainLabel())}">${escapeHtml(mainLabel())}</span><span class="ws-secondary">project checkout</span></span>
        ${waitHtml(queue, state.MAIN_WORKSPACE_ID)}
      </div>
      ${local.map((ws) => rowHtml(ws, { selectedId, sums, queue })).join('')}
      <div class="ws-sep" role="separator"></div>
      ${remoteGroupHtml(remote, { canCreate, selectedId, sums, queue })}
      ${archivedHtml}
    </div>` : ''}`;

  // Past eight rows the list scrolls inside itself: it keeps its place
  // across redraws, and a newly selected (or newly unfolded) row is brought
  // into view — by the list's own scroll only, so the sidebar never moves.
  const list = rootEl.querySelector('.ws-list');
  if (list) {
    if (scrollTop) list.scrollTop = scrollTop;
    if (!prevList || selectedId !== shownSelectedId) revealRow(list, list.querySelector('.ws-row.on'));
  }
  shownSelectedId = selectedId;
  const input = rootEl.querySelector('.ws-rename');
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('blur', () => commitRename(input));
  } else if (focusedId) {
    const row = [...rootEl.querySelectorAll('.ws-list .ws-row[tabindex="0"]')].find((el) => el.dataset.id === focusedId);
    if (row) row.focus({ preventScroll: true });
  }
}

// ─── List ────────────────────────────────────────────────────

/** Scroll `list` just far enough that `row` is fully in view. */
function revealRow(list, row) {
  if (!list || !row || list.scrollHeight <= list.clientHeight) return;
  // offsetTop is measured from the list: it is the rows' positioned ancestor.
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/** Arrow keys walk the list's rows and buttons, top to bottom. */
function moveFocus(step) {
  const items = [...rootEl.querySelectorAll('.ws-list .ws-row[tabindex="0"], .ws-list .ws-server-head[tabindex="0"], .ws-list .ws-cta:not(:disabled), .ws-list .ws-archived-row')];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  const next = items[(at + step + items.length) % items.length] || items[0];
  next.focus();
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
    if (act === 'fold') return toggleList();
    // The header's one "+": the location is chosen in the dialog (this
    // project's last one by default).
    if (act === 'new') return openNew();
    if (act === 'connect') return require('./serverConnect').open({ key: actEl.dataset.key || null });
    if (act === 'add-server') return require('./serverConnect').open({ add: true });
    if (act === 'toggle-server') return toggleServer(actEl.dataset.key);
    if (act === 'open-archived') return openArchived();
    if (act === 'menu' && ws) {
      const rect = actEl.getBoundingClientRect();
      return showMenu(ws, rect.left, rect.bottom + 2);
    }
    if (act === 'restore-missing' && ws) return restoreWorkspace(ws);
    if (act === 'remove-record' && ws) return removeRecord(ws);
    return;
  }
  if (!row) return;
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
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ws-server-head') && e.target.dataset.key) {
    e.preventDefault();
    toggleServer(e.target.dataset.key);
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ws-row')) {
    e.preventDefault();
    e.target.click();
    return;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.closest && e.target.closest('.ws-list')) {
    e.preventDefault();
    moveFocus(e.key === 'ArrowDown' ? 1 : -1);
  }
}

function onContextMenu(e) {
  const row = e.target.closest('.ws-row');
  if (!row || row.classList.contains('main')) return;
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
    // A connected server workspace can be sent the files git leaves out (server-copy-files).
    ...(ws.location === 'server' && !ws.offline ? [{ id: 'send-files', label: 'Send files to server…' }, { separator: true }] : []),
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
  else if (item.dataset.menu === 'send-files') sendFilesTo(ws);
}

async function sendFilesTo(ws) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  const sendFiles = require('./sendFilesModal');
  const picked = await sendFiles.open({ projectPath, workspace: ws, context: 'resend' });
  if (picked && picked.sent) notify.info(sendFiles.summary(picked.sent));
}

// ─── Actions ─────────────────────────────────────────────────

function openNew(opts) {
  if (!isRepo) {
    notify.info('Workspaces need a git repository.');
    return;
  }
  if (typeof actions.onNew === 'function') actions.onNew(opts);
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
    return false;
  }
  await load();
  const restored = workspaces.find((w) => w.id === ws.id);
  if (restored) select(restored);
  if (typeof actions.onRestored === 'function') actions.onRestored(restored || ws, result);
  return true;
}

// ─── Archived workspaces dialog ──────────────────────────────
//
// The list's "Archived N" row opens it: the archived records in the order
// main returns them (workspaceRegistry: newest first), a filter, a list that
// scrolls inside itself, Restore per row. Built here, on first use.

let archivedModal = null;

function archivedOpen() {
  return !!(archivedModal && archivedModal.classList.contains('visible'));
}

/** Archived records whose branch, name or host contains `text`; all of them for an empty filter. */
function matchArchived(records, text) {
  const needle = String(text || '').trim().toLowerCase();
  if (!needle) return records.slice();
  return records.filter((ws) => [ws.branch, ws.name, ws.host]
    .some((field) => String(field || '').toLowerCase().includes(needle)));
}

function ensureArchivedModal() {
  if (archivedModal) return archivedModal;
  const modal = document.createElement('div');
  modal.id = 'archived-workspaces-modal';
  modal.className = 'task-run-modal ws-archive-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'wa-title');
  modal.innerHTML = `
    <div class="task-run-modal-container">
      <div class="task-run-modal-header">
        <h3 id="wa-title">Archived workspaces</h3>
        <p>Their branches are kept. Restore puts a workspace back in the list.</p>
      </div>
      <div class="task-run-modal-body">
        <input class="task-run-input wa-filter" type="search" placeholder="Filter by branch or name" spellcheck="false" aria-label="Filter archived workspaces">
        <div class="wa-list" role="list"></div>
      </div>
      <div class="task-run-modal-footer">
        <button type="button" class="task-run-btn task-run-btn-cancel wa-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.wa-filter').addEventListener('input', renderArchivedList);
  modal.querySelector('.wa-close').addEventListener('click', () => closeArchived({ refocus: true }));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeArchived({ refocus: true }); });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeArchived({ refocus: true }); }
  });
  modal.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="restore"]');
    const row = btn && btn.closest('.ws-row');
    const ws = row && archived.find((w) => w.id === row.dataset.id);
    if (!ws || btn.disabled) return;
    btn.disabled = true;
    // Restored: it is back in the list and selected, so the dialog is done.
    if (await restoreWorkspace(ws)) closeArchived();
    else btn.disabled = false;
  });
  archivedModal = modal;
  return modal;
}

function renderArchivedList() {
  if (!archivedModal) return;
  const listEl = archivedModal.querySelector('.wa-list');
  const shown = matchArchived(archived, archivedModal.querySelector('.wa-filter').value);
  if (!shown.length) {
    listEl.innerHTML = `<p class="wa-empty">${archived.length ? 'No archived workspace matches.' : 'No archived workspaces.'}</p>`;
    return;
  }
  listEl.innerHTML = shown.map((ws) => `
    <div class="ws-row archived" data-id="${escapeHtml(ws.id)}" role="listitem">
      <span class="ws-dot" aria-hidden="true"></span>
      <span class="ws-labels"><span class="ws-primary" title="${escapeHtml(ws.branch)}">${escapeHtml(ws.branch)}</span><span class="ws-secondary">${escapeHtml(ws.name)}${ws.location === 'server' ? ` · ${escapeHtml(ws.host || 'server')}` : ''}</span></span>
      <button class="ws-act" data-act="restore" type="button">Restore</button>
    </div>`).join('');
}

function openArchived() {
  if (!archived.length) return;
  const modal = ensureArchivedModal();
  const filter = modal.querySelector('.wa-filter');
  filter.value = '';
  renderArchivedList();
  modal.classList.add('visible');
  filter.focus();
}

function closeArchived({ refocus = false } = {}) {
  if (!archivedOpen()) return;
  archivedModal.classList.remove('visible');
  const row = refocus && rootEl ? rootEl.querySelector('.ws-archived-row') : null;
  if (row) row.focus({ preventScroll: true });
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
  // A server workspace names its host, and says so while it is unreachable (server-specs).
  const label = chipLabel(ws);
  const where = ws.host ? `on ${ws.host}${ws.offline ? ' (offline)' : ''}` : (ws.branch || '');
  return `<span class="ws-chip" title="In workspace ${escapeHtml(ws.name)} · ${escapeHtml(where)}">${escapeHtml(label)}</span>`;
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
  setView,
  select,
  selectById,
  switchItems,
  goToNextWaiting,
  whenLoaded,
  setActions,
  getWorkspaces,
  selectedWorkspace,
  workspaceChipHtml,
  selectSpecWorkspace,
  archiveWorkspace,
  startRename
};
