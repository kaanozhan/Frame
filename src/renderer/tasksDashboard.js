/**
 * Tasks Dashboard Module
 *
 * The Tasks screen, built like the Specs screen (tasks-list-view spec): a
 * view header (title, New Task, close), a toolbar with the All / Active /
 * Done scope and its counts on the left and Filter / Sort on the right, and
 * a list of task tiles in the Specs grid. Active lists In progress above
 * Pending, and its In progress / Pending chips narrow it to one of the two
 * (as the Specs phase chips do); Done lists Completed under the project's
 * done window, older ones
 * behind the "Show" ghost tile. Nothing is draggable: a task changes status
 * through Play, its drawer actions, or the agent closing it.
 *
 * What the list shows comes from the pure `tasks/listModel.js`; this module
 * only renders it. Spec tasks (`source: spec:…`) are owned by their spec —
 * its phase is derived from them — so they are hidden by default; the
 * toolbar's "Include spec tasks" checkbox lists them in the status sections
 * with the others, each tile labelled with its spec, read-only: no Play, no
 * status action, no Delete.
 *
 * Clicking a tile slides a full-page detail drawer in from the right over
 * the list (same motion as the specs dashboard) with the full task body
 * (description, original userRequest, acceptance criteria, notes, context).
 * The right aside only hosts the New Task form; with no open form it leaves
 * the layout so the list gets the full width.
 *
 * The task in the drawer is also pinned as a chip in the top bar (via the
 * inline host's drawerOpened/drawerClosed hooks). One chip, replaced on
 * every open; it outlives the drawer and the view, so switching to Home or
 * Terminals and back never loses the task — clicking the chip re-opens it.
 *
 * State is sourced from the same TASKS_DATA stream used by the side panel,
 * so the dashboard, the side panel, and the on-disk tasks.json all stay in
 * sync — no separate fetch.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const doneWindow = require('./doneWindow');
const { SECTIONS, ACTIVE_STATUSES, isSpecTask, specSlugOf, buildListModel } = require('./tasks/listModel');
const { taskChipLabel } = require('../shared/serverTasks');

const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed'
};

const SCOPE_FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done',   label: 'Done' }
];

const SECTION_LABELS = Object.fromEntries(SECTIONS.map(s => [s.id, s.label]));

const EMPTY_STATUS = {
  in_progress: 'Nothing in progress.',
  pending: 'Nothing pending.'
};

let isVisible = false;
let tasks = [];
// Notes about server workspaces' tasks (server-tasks): a server that is down,
// or one whose Frame Server predates tasks — `[{ host, kind }]` from TASKS_DATA.
let serverNotes = [];
let selectedTaskId = null;
let dashboardEl = null;
let filtersEl = null;        // toolbar: scope segments
let specToggleEl = null;     // toolbar: the "Include spec tasks" checkbox label
let listEl = null;           // the sections of tiles
// Opens on Active, as Specs does; the user can pick All or Done.
let scope = 'active';
// In progress or Pending: narrows Active only; cleared by any scope pick,
// like the Specs phase chips.
let statusFilter = null;
// Completed tasks older than the project's done window hide behind the
// "Show" ghost tile (boards-done-window spec). The reveal is session state
// on the open project: it survives TASKS_DATA re-renders and resets on a
// scope pick and when the project changes.
let showOlderDone = false;
// Spec tasks are hidden until the toolbar checkbox includes them. Session
// state on the open project, like the older-done reveal: never persisted,
// reset when the project changes (and so on reopening the project).
let showSpecTasks = false;
let loadedProjectPath = null;
let detailEl = null;         // right aside — hosts the New Task form
let drawerEl = null;         // full-page task detail drawer
let detailContentEl = null;  // detail body inside the drawer
let detailFormEl = null;
let detailActionsEl = null;  // status actions in the drawer header

/**
 * Dashboard-only filter state. Empty set on a dimension means "no filter on
 * this dimension"; multi-select within a dimension is OR; across dimensions
 * is AND. Never persisted to tasks.json — this is purely a viewing layer.
 */
const filters = { categories: new Set(), priorities: new Set() };
let filterBtnEl = null;
let filterPopoverEl = null;
let filterBadgeEl = null;

/**
 * Sort state. mode is 'default' | 'category' | 'priority' (default = file
 * order, the original behavior). applyToFile is the toggle: when true,
 * picking a sort also rewrites tasks.json via REORDER_TASKS so the new order
 * persists.
 */
const sort = { mode: 'default', applyToFile: false };
let sortBtnEl = null;
let sortPopoverEl = null;
let sortLabelEl = null;

function init() {
  dashboardEl = document.getElementById('tasks-dashboard');
  if (!dashboardEl) return;

  detailEl = document.getElementById('tasks-dashboard-detail');
  drawerEl = document.getElementById('tasks-dashboard-task-drawer');
  detailContentEl = drawerEl.querySelector('.tasks-dashboard-detail-content');
  detailFormEl = document.getElementById('tasks-dashboard-form');
  detailActionsEl = drawerEl.querySelector('.tasks-dashboard-detail-actions');
  filtersEl = document.getElementById('tasks-dashboard-filters');
  specToggleEl = document.getElementById('tasks-dashboard-spec-toggle');
  listEl = document.getElementById('tasks-dashboard-list');

  specToggleEl?.querySelector('input').addEventListener('change', (e) => {
    showSpecTasks = e.target.checked;
    render();
  });

  // The done window is a project setting; when it moves, the Completed
  // section re-partitions from the data it already holds.
  doneWindow.onChange(() => { if (isVisible) render(); });

  document.getElementById('tasks-dashboard-close').addEventListener('click', hide);

  // The header New Task button opens the form inside the right aside rather
  // than the modal — the modal is reserved for the tasks side panel.
  document.getElementById('tasks-dashboard-add').addEventListener('click', showForm);

  drawerEl.querySelector('.tasks-dashboard-task-drawer-close').addEventListener('click', () => clearSelection());
  drawerEl.querySelector('.tasks-dashboard-task-drawer-back').addEventListener('click', () => clearSelection());

  // Delete button on the selected task — routes through the shared confirm
  // modal before any DELETE_TASK is dispatched.
  const deleteBtn = drawerEl.querySelector('.tasks-dashboard-detail-delete');
  if (deleteBtn) deleteBtn.addEventListener('click', requestDeleteSelected);

  setupForm();
  setupFilter();
  setupSort();

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isVisible) return;
    // Don't intercept Esc while the side-panel modal is on top — that flow
    // owns its own dismissal.
    const modal = document.getElementById('task-modal');
    if (modal && modal.classList.contains('visible')) return;

    if (isFilterPopoverOpen()) {
      closeFilterPopover();
    } else if (isSortPopoverOpen()) {
      closeSortPopover();
    } else if (isFormOpen()) {
      hideForm();
    } else if (selectedTaskId) {
      clearSelection();
    } else {
      hide();
    }
  });

  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks: data, serverNotes: notes }) => {
    tasks = flatten(data);
    serverNotes = Array.isArray(notes) ? notes : [];
    if (isVisible) render();
  });

  ipcRenderer.on(IPC.TOGGLE_TASKS_DASHBOARD, () => toggle());

  // Activity dots track the live agent state of lanes working on tasks
  require('./agentDispatch').onTaskLaneActivity(() => {
    if (isVisible) render();
  });
}

function flatten(data) {
  if (!data || !data.tasks) return [];
  if (Array.isArray(data.tasks)) return data.tasks.slice();
  // Defensive: legacy nested shape (loader normally migrates this).
  return [
    ...(data.tasks.pending || []).map(t => ({ ...t, status: 'pending' })),
    ...(data.tasks.inProgress || []).map(t => ({ ...t, status: 'in_progress' })),
    ...(data.tasks.completed || []).map(t => ({ ...t, status: 'completed' }))
  ];
}

// ─── Inline hosting (center-specs-tasks-views spec) ────────
// Same contract as specsDashboard: with an inline host registered, the board
// renders inside the center content area and all legacy entry points route
// through the host — the full-window overlay path goes dormant.

let inlineHost = null;     // { open(), close(), drawerOpened?({id,title}), drawerClosed?() } — set by multiTerminalUI
let inlineMounted = false;
let overlayParent = null;

function setInlineHost(host) {
  inlineHost = host;
}

function mountInline(container) {
  if (!dashboardEl || !container) return;
  if (!overlayParent) overlayParent = dashboardEl.parentNode;
  dashboardEl.classList.add('visible', 'inline');
  container.appendChild(dashboardEl);
  inlineMounted = true;
  _load();
}

function notifyDetached() {
  if (!inlineMounted) return;
  inlineMounted = false;
  isVisible = false;
  resetAside();
  closeFilterPopover();
  closeSortPopover();
  dashboardEl.classList.remove('visible', 'inline');
  if (overlayParent && dashboardEl.parentNode !== overlayParent) {
    overlayParent.appendChild(dashboardEl);
  }
}

function _load() {
  const projectPath = state.getProjectPath();
  // No project = nothing to show. Surface the same info modal the side panel
  // uses so the user gets one consistent message no matter where they enter.
  if (!projectPath) {
    require('./taskInfoModal').open({
      title: 'No project selected',
      message: 'Select a project from the sidebar to open the task board.'
    });
    return;
  }
  if (projectPath !== loadedProjectPath) {
    showOlderDone = false;
    showSpecTasks = false;
    loadedProjectPath = projectPath;
  }
  isVisible = true;
  ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  render();
}

function show() {
  if (!dashboardEl) return;
  if (inlineHost) {
    inlineHost.open();
    return;
  }
  dashboardEl.classList.add('visible');
  _load();
}

function hide() {
  if (!dashboardEl) return;
  if (inlineMounted && inlineHost) {
    inlineHost.close(); // view switch triggers notifyDetached()
    return;
  }
  isVisible = false;
  dashboardEl.classList.remove('visible');
  resetAside();
  closeFilterPopover();
  closeSortPopover();
}

function toggle() {
  if (inlineHost) {
    inlineMounted ? inlineHost.close() : inlineHost.open();
    return;
  }
  if (isVisible) hide(); else show();
}

function listModel() {
  return buildListModel({
    tasks,
    scope,
    status: statusFilter,
    showSpecTasks,
    matches: filterMatches,
    sortMode: sort.mode,
    windowDays: doneWindow.get().tasks,
    showOlder: showOlderDone
  });
}

function render() {
  const model = listModel();
  renderToolbar(model);
  renderList(model);

  // A push can delete the selected task out from under us; syncAside drops
  // the selection rather than leaving a stranded panel.
  if (selectedTaskId && !tasks.some(t => t.id === selectedTaskId)) selectedTaskId = null;
  syncAside();
}

/**
 * The scope segments, Active's status chips and the spec-tasks checkbox,
 * painted from the same model the list is painted from so each count
 * answers "what will I see if I click this". A scope pick resets the status
 * chip and the older-done reveal, as on Specs.
 */
function renderToolbar(model) {
  if (!filtersEl) return;
  const { counts } = model;
  const count = (n) => `<span class="specs-filter-count">${n || 0}</span>`;

  const segments = SCOPE_FILTERS.map(f => {
    const on = scope === f.id;
    const hiddenDone = counts.doneTotal - counts.done;
    const title = f.id === 'done' && hiddenDone > 0
      ? ` title="${counts.doneTotal} done in total · ${hiddenDone} older hidden"`
      : '';
    return `<button type="button" class="specs-filter-seg${on ? ' active' : ''}" data-scope="${f.id}" aria-pressed="${on}" tabindex="-1"${title}>${f.label}${count(counts[f.id])}</button>`;
  }).join('');

  let chips = '';
  if (scope === 'active') {
    chips = ACTIVE_STATUSES.map(id => {
      const on = statusFilter === id;
      const n = counts[`status:${id}`] || 0;
      return `<button type="button" class="specs-filter-chip status-${id.replace('_', '-')}${on ? ' active' : ''}${n ? '' : ' is-empty'}" data-status="${id}" aria-pressed="${on}" tabindex="-1"><span class="specs-filter-dot" aria-hidden="true"></span>${SECTION_LABELS[id]}${count(n)}</button>`;
    }).join('');
  }

  filtersEl.innerHTML = `
    <div class="specs-filter-scope" role="group" aria-label="Scope">${segments}</div>
    ${chips ? `<span class="specs-filter-divider" aria-hidden="true"></span>
    <div class="specs-filter-phases" role="group" aria-label="Status">${chips}</div>` : ''}
  `;
  filtersEl.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      scope = btn.dataset.scope;
      statusFilter = null;
      showOlderDone = false;
      render();
    });
  });
  filtersEl.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      statusFilter = statusFilter === btn.dataset.status ? null : btn.dataset.status;
      render();
    });
  });

  // The checkbox says how many spec tasks the current scope would add, and
  // only shows while the project has any.
  if (specToggleEl) {
    specToggleEl.hidden = !tasks.some(isSpecTask);
    specToggleEl.querySelector('input').checked = showSpecTasks;
    specToggleEl.querySelector('.specs-filter-count').textContent = String(counts.specTasks || 0);
  }
}

/** One line per server whose tasks cannot be shown or changed right now. */
function renderServerNotes() {
  const lines = serverNotes.map((n) => (n.kind === 'update'
    ? `Update Frame Server on ${n.host || 'the server'} to see its tasks here (Servers ▸ Update).`
    : `${n.host || 'A server'} is offline — its tasks are shown as last seen and can't be changed until it reconnects.`));
  if (!lines.length) return;
  const box = document.createElement('div');
  box.className = 'tasks-server-notes';
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    box.appendChild(p);
  }
  listEl.appendChild(box);
}

function renderList(model) {
  if (!listEl) return;
  listEl.innerHTML = '';
  renderServerNotes();

  const days = doneWindow.get().tasks;
  let listed = 0;

  for (const section of model.sections) {
    const isCompleted = section.id === 'completed';
    const older = isCompleted ? model.olderCount : 0;
    if (section.tasks.length === 0 && older === 0) continue;
    listed += section.tasks.length;

    const grid = appendSection(section.id, SECTION_LABELS[section.id], section.tasks.length);
    for (const task of section.tasks) {
      grid.appendChild(renderTile(task, { playable: section.id === 'pending' && !isSpecTask(task) }));
    }
    if (isCompleted && section.tasks.length === 0) {
      // Everything done is outside the window: the tile is the whole section.
      grid.appendChild(emptyState(`Nothing completed in the last ${days} days.`));
    }
    if (older > 0) grid.appendChild(renderOlderTile(older));
  }

  if (listed > 0 || model.olderCount > 0) return;

  if (tasks.length === 0) {
    const empty = emptyState('Tasks are the small units of work Frame tracks between sessions.', 'No tasks yet');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = '+ New Task';
    btn.addEventListener('click', showForm);
    empty.appendChild(btn);
    listEl.appendChild(empty);
  } else if (isFilterActive()) {
    listEl.appendChild(emptyState('No tasks match the active filter.'));
  } else if (model.status) {
    listEl.appendChild(emptyState(EMPTY_STATUS[model.status]));
  } else if (scope === 'done') {
    listEl.appendChild(emptyState('No completed tasks.'));
  } else if (scope === 'active') {
    listEl.appendChild(emptyState('Nothing pending or in progress.'));
  } else {
    listEl.appendChild(emptyState('No tasks to show.'));
  }
}

/**
 * Leave for the Specs screen with this spec in its drawer — the pair
 * multiTerminalUI.enterSpecDrawer uses: show() mounts the grid in the same
 * frame, so the drawer opens instantly over it.
 */
function openSpec(slug) {
  if (!slug) return;
  const specsDashboard = require('./specsDashboard');
  specsDashboard.show();
  specsDashboard.openSpec(slug, { instant: true });
}

function sectionHeader(id, label, count) {
  const header = document.createElement('div');
  header.className = 'tasks-dashboard-section-header';
  header.innerHTML = `<span class="tasks-dashboard-section-dot status-${id.replace('_', '-')}" aria-hidden="true"></span>`;
  const title = document.createElement('h3');
  title.className = 'tasks-dashboard-section-title';
  title.textContent = label;
  header.appendChild(title);
  const countEl = document.createElement('span');
  countEl.className = 'specs-filter-count';
  countEl.textContent = String(count);
  header.appendChild(countEl);
  return header;
}

/** A section heading plus its grid; returns the grid for the tiles. */
function appendSection(id, label, count) {
  const section = document.createElement('section');
  section.className = 'tasks-dashboard-section';
  section.dataset.section = id;
  section.appendChild(sectionHeader(id, label, count));

  const grid = document.createElement('div');
  grid.className = 'tasks-dashboard-grid';
  section.appendChild(grid);

  listEl.appendChild(section);
  return grid;
}

function emptyState(message, heading) {
  const empty = document.createElement('div');
  empty.className = 'specs-dashboard-empty';
  if (heading) {
    const h = document.createElement('h3');
    h.textContent = heading;
    empty.appendChild(h);
  }
  const p = document.createElement('p');
  p.textContent = message;
  empty.appendChild(p);
  return empty;
}

/** The ghost tile closing Completed: "N older done tasks · Show". */
function renderOlderTile(count) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'specs-card-older';
  tile.tabIndex = -1;
  tile.innerHTML = `
    <span class="specs-card-older-count">${count}</span>
    <span class="specs-card-older-label">older done task${count === 1 ? '' : 's'}</span>
    <span class="specs-card-older-action">Show</span>
  `;
  tile.addEventListener('click', () => {
    showOlderDone = true;
    render();
  });
  return tile;
}

/**
 * One task tile. `playable` puts the Play button on it — pending non-spec
 * tasks only; an in-progress task shows its lane activity dot instead.
 */
function renderTile(task, { playable = false } = {}) {
  const tile = document.createElement('div');
  tile.className = `specs-card tasks-tile priority-${task.priority || 'medium'}`;
  tile.dataset.taskId = task.id;
  if (task.offline) tile.classList.add('offline');
  if (task.id === selectedTaskId) tile.classList.add('selected');

  const top = document.createElement('div');
  top.className = 'specs-card-top';
  const badges = document.createElement('div');
  badges.className = 'tasks-tile-badges';
  // Live agent working on this task → pulsing activity dot
  const liveDot = require('./agentDispatch').taskStatusDotHtml(task.id);
  if (liveDot) badges.insertAdjacentHTML('afterbegin', liveDot);

  if (isSpecTask(task)) {
    const chip = document.createElement('span');
    chip.className = 'tasks-tile-spec-chip';
    chip.textContent = 'SPEC';
    badges.appendChild(chip);
  }

  const priority = document.createElement('span');
  priority.className = `tasks-tile-priority priority-${task.priority || 'medium'}`;
  priority.textContent = (task.priority || 'medium').toUpperCase();
  badges.appendChild(priority);

  if (task.category) {
    const cat = document.createElement('span');
    cat.className = 'tasks-tile-category';
    cat.textContent = task.category;
    badges.appendChild(cat);
  }
  // A server project's task names its host, as a server spec does (server-tasks).
  const host = taskChipLabel(task);
  if (host) {
    const chip = document.createElement('span');
    chip.className = `ws-chip tasks-tile-host${task.offline ? ' offline' : ''}`;
    chip.textContent = host;
    chip.title = task.offline
      ? `On ${task.host} — offline: shown as last seen, can't be changed until it reconnects`
      : `On ${task.host} — kept in that server's task list`;
    badges.appendChild(chip);
  }
  top.appendChild(badges);
  if (playable) top.appendChild(renderPlayButton(task));
  tile.appendChild(top);

  const title = document.createElement('div');
  title.className = 'specs-card-title';
  title.textContent = task.title || 'Untitled';
  tile.appendChild(title);

  // Until the agent writes a description, the tile shows the request.
  const bodyText = task.description || task.userRequest;
  if (bodyText) {
    const body = document.createElement('div');
    body.className = 'tasks-tile-body';
    body.textContent = bodyText;
    tile.appendChild(body);
  }

  const foot = document.createElement('div');
  foot.className = 'specs-card-foot';
  if (isSpecTask(task)) {
    // A spec task sits among the others: its spec and number say why it has
    // no Play. A long slug truncates; the number always shows.
    const slug = specSlugOf(task);
    const label = document.createElement('span');
    label.className = 'tasks-tile-spec';
    label.title = `Part of ${slug} — run it from the spec`;
    const slugEl = document.createElement('span');
    slugEl.className = 'tasks-tile-spec-slug';
    slugEl.textContent = slug;
    const numEl = document.createElement('span');
    numEl.className = 'tasks-tile-spec-num';
    numEl.textContent = ` · ${String(task.source).split(':').pop()}`;
    label.append(slugEl, numEl);
    foot.appendChild(label);
  }
  const date = document.createElement('span');
  date.className = 'specs-card-time';
  date.textContent = formatDate(task.updatedAt || task.createdAt);
  foot.appendChild(date);
  tile.appendChild(foot);

  tile.addEventListener('click', () => selectTask(task.id));

  return tile;
}

const PLAY_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

/**
 * Play starts the task through the shared run flow (run modal → Agent
 * Dispatch into a new Frame); the task turns in_progress only after the
 * dispatch succeeds. It never selects the tile.
 */
function renderPlayButton(task) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tasks-tile-play';
  btn.tabIndex = -1;
  btn.title = 'Start this task in a new Frame';
  btn.setAttribute('aria-label', `Start ${task.title || 'task'}`);
  btn.innerHTML = PLAY_ICON;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    startTask(task);
  });
  return btn;
}

function startTask(task) {
  // Lazy-required: tasksPanel lazy-requires this module too.
  require('./tasksPanel').openRunFlow(task);
}

/* ---------- Right aside (form) + detail drawer ---------- */

/**
 * Single owner of the aside's and the drawer's visibility. The aside exists
 * only while the New Task form is open — otherwise it leaves the layout so
 * the list takes the full width (tasks-detail-on-demand spec). The
 * drawer slides in over the list while a task is selected and no form is
 * open; it stays in the DOM parked off-screen so open/close animate. Every
 * path that changes selection or form state ends here, so the panels can
 * only be wrong in one place.
 */
function syncAside() {
  if (!detailEl) return;
  const formOpen = isFormOpen();
  const task = (!formOpen && selectedTaskId)
    ? tasks.find(t => t.id === selectedTaskId)
    : null;

  detailEl.classList.toggle('open', formOpen);

  if (drawerEl) {
    const opening = !!task && !drawerEl.classList.contains('has-selection');
    drawerEl.classList.toggle('has-selection', !!task);
    drawerEl.setAttribute('aria-hidden', task ? 'false' : 'true');
    if (opening && detailContentEl) detailContentEl.scrollTop = 0;
  }
  // Content stays rendered while the drawer slides out so the close
  // animation doesn't show an empty panel.
  if (task) renderDetail(task);
}

/**
 * Open a task in the drawer. `instant` is the top-bar chip path: the list
 * has just been mounted underneath, so the drawer must already cover it in
 * the same frame — no slide, no flash of the tiles. Returns false when
 * the task no longer exists.
 */
function selectTask(taskId, { instant = false } = {}) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;
  selectedTaskId = taskId;
  if (instant && drawerEl) {
    drawerEl.classList.add('instant');
    // Two frames so the class removal itself can never start a transition
    requestAnimationFrame(() => requestAnimationFrame(() => drawerEl.classList.remove('instant')));
  }
  // Selecting a task always exits form mode — the aside has one job at a time.
  if (isFormOpen()) detailFormEl.style.display = 'none';
  document.querySelectorAll('.tasks-tile.selected').forEach(el => {
    el.classList.remove('selected');
  });
  const tile = document.querySelector(`.tasks-tile[data-task-id="${taskId}"]`);
  if (tile) tile.classList.add('selected');
  syncAside();
  return true;
}

/**
 * Close the drawer. `notify: false` is for the host-driven teardown
 * (notifyDetached → resetAside) — the host is already mid-render there,
 * and calling back into it would re-enter that render.
 */
function clearSelection({ notify = true } = {}) {
  const hadSelection = !!selectedTaskId;
  selectedTaskId = null;
  document.querySelectorAll('.tasks-tile.selected').forEach(el => {
    el.classList.remove('selected');
  });
  syncAside();
  if (hadSelection && notify && inlineHost && inlineHost.drawerClosed) inlineHost.drawerClosed();
}

/** Leaving the screen: no selection, no half-typed form waiting on return. */
function resetAside() {
  selectedTaskId = null;
  document.querySelectorAll('.tasks-tile.selected').forEach(el => {
    el.classList.remove('selected');
  });
  if (detailFormEl) detailFormEl.style.display = 'none';
  syncAside();
}

/* ---------- Inline form (right aside) ---------- */

function isFormOpen() {
  return !!(detailFormEl && detailFormEl.style.display !== 'none');
}

function setupForm() {
  if (!detailFormEl) return;

  detailFormEl.querySelector('.tasks-dashboard-form-close')
    .addEventListener('click', () => hideForm());
  detailFormEl.querySelector('.tasks-dashboard-form-cancel')
    .addEventListener('click', () => hideForm());

  detailFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm();
  });
}

function showForm() {
  if (!detailFormEl) return;
  // Form takes over the aside; a selected task stays selected underneath and
  // comes back when the form closes.
  detailFormEl.style.display = '';
  syncAside();
  detailFormEl.reset();
  // Default the priority/category since reset puts the first option
  detailFormEl.querySelector('#tasks-dashboard-form-priority').value = 'medium';
  detailFormEl.querySelector('#tasks-dashboard-form-category').value = 'feature';
  requestAnimationFrame(() => {
    detailFormEl.querySelector('#tasks-dashboard-form-title')?.focus();
  });
}

function hideForm() {
  if (!detailFormEl) return;
  detailFormEl.style.display = 'none';
  // Falls back to the detail view if a task is selected, otherwise the aside
  // collapses.
  syncAside();
}

function requestDeleteSelected() {
  if (!selectedTaskId) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  const task = tasks.find(t => t.id === selectedTaskId);
  if (task && isSpecTask(task)) return;
  const confirmModal = require('./taskConfirmModal');
  const idToDelete = selectedTaskId;
  confirmModal.open({
    title: task ? task.title : null,
    onConfirm: () => {
      ipcRenderer.send(IPC.DELETE_TASK, { projectPath, taskId: idToDelete });
      // Clear local selection right away — the next TASKS_DATA push will
      // refresh the list and the aside collapses.
      if (selectedTaskId === idToDelete) clearSelection();
    }
  });
}

function submitForm() {
  const projectPath = state.getProjectPath();
  if (!projectPath || !detailFormEl) return;

  const title = detailFormEl.querySelector('#tasks-dashboard-form-title').value.trim();
  if (!title) return;

  // The form maps to the tasks.json schema: the request is the user's own
  // words, kept exactly as typed (userRequest). No description or acceptance
  // criteria — Play has the agent write them, with the code in view.
  const request = detailFormEl.querySelector('#tasks-dashboard-form-request').value;
  const task = {
    title,
    priority: detailFormEl.querySelector('#tasks-dashboard-form-priority').value,
    category: detailFormEl.querySelector('#tasks-dashboard-form-category').value
  };
  if (request.trim()) task.userRequest = request;

  ipcRenderer.send(IPC.ADD_TASK, { projectPath, task });
  hideForm();
}

function renderDetail(task) {
  if (!detailContentEl || !task) return;

  detailContentEl.style.display = '';

  const pill = detailContentEl.querySelector('.tasks-dashboard-detail-status-pill');
  pill.textContent = STATUS_LABELS[task.status] || task.status;
  pill.className = `tasks-dashboard-detail-status-pill status-${(task.status || 'pending').replace('_', '-')}`;

  detailContentEl.querySelector('.tasks-dashboard-detail-title').textContent = task.title || 'Untitled';

  renderDetailActions(task);

  const meta = detailContentEl.querySelector('.tasks-dashboard-detail-meta');
  meta.innerHTML = '';
  appendMetaPill(meta, `Priority: ${task.priority || 'medium'}`, `priority-${task.priority || 'medium'}`);
  if (task.category) appendMetaPill(meta, task.category, 'category');

  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-description'),
    null,
    task.description || 'No description provided.'
  );

  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-userrequest-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-userrequest'),
    task.userRequest
  );
  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-criteria-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-criteria'),
    task.acceptanceCriteria
  );
  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-notes-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-notes'),
    task.notes
  );
  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-context-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-context'),
    task.context
  );

  detailContentEl.querySelector('.tasks-dashboard-detail-id').textContent = `#${task.id}`;
  const dates = [];
  if (task.createdAt) dates.push(`Created ${formatDate(task.createdAt)}`);
  if (task.updatedAt && task.updatedAt !== task.createdAt) dates.push(`Updated ${formatDate(task.updatedAt)}`);
  if (task.completedAt) dates.push(`Completed ${formatDate(task.completedAt)}`);
  detailContentEl.querySelector('.tasks-dashboard-detail-dates').textContent = dates.join(' · ');

  // The top bar pins whichever task the drawer shows (one chip, replaced on
  // every open) so leaving this screen never loses the task — the chip is
  // the way back. Fires on every push too, so a rename updates the chip.
  if (inlineHost && inlineHost.drawerOpened) {
    inlineHost.drawerOpened({ id: task.id, title: task.title || 'Untitled' });
  }
}

/**
 * The drawer's status actions for a non-spec task, the same set the task
 * tab and the Specs task rows offer: pending → Play + Mark complete;
 * in progress → Mark complete + Back to pending; completed → Reopen. Only
 * Play starts an agent; the rest just set the status. A spec task gets none
 * of them — its status belongs to its spec's implement run.
 */
const DETAIL_ACTIONS = {
  pending: [
    { action: 'start', label: 'Play', icon: PLAY_ICON, primary: true },
    { action: 'complete', label: 'Mark complete' }
  ],
  in_progress: [
    { action: 'complete', label: 'Mark complete', primary: true },
    { action: 'pause', label: 'Back to pending' }
  ],
  completed: [
    { action: 'reopen', label: 'Reopen' }
  ]
};

const ACTION_STATUS = { complete: 'completed', pause: 'pending', reopen: 'pending' };

function renderDetailActions(task) {
  if (!detailActionsEl) return;
  detailActionsEl.innerHTML = '';
  // A deleted spec task is re-imported on the next spec sync, so Delete
  // could only confuse; the way to act on one is its spec.
  const deleteBtn = drawerEl && drawerEl.querySelector('.tasks-dashboard-detail-delete');
  if (deleteBtn) deleteBtn.style.display = isSpecTask(task) ? 'none' : '';
  if (isSpecTask(task)) {
    const slug = specSlugOf(task);
    if (slug) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'tasks-dashboard-detail-action';
      link.tabIndex = -1;
      link.textContent = 'Open spec';
      link.title = `Open ${slug} in Specs`;
      link.addEventListener('click', () => openSpec(slug));
      detailActionsEl.appendChild(link);
    }
    return;
  }

  const actions = DETAIL_ACTIONS[task.status] || DETAIL_ACTIONS.pending;
  for (const def of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tasks-dashboard-detail-action${def.primary ? ' primary' : ''}`;
    btn.tabIndex = -1;
    btn.innerHTML = def.icon || '';
    btn.appendChild(document.createTextNode(def.label));
    btn.addEventListener('click', () => runDetailAction(task.id, def.action));
    detailActionsEl.appendChild(btn);
  }
}

function runDetailAction(taskId, action) {
  const task = tasks.find(t => t.id === taskId);
  const projectPath = state.getProjectPath();
  if (!task || !projectPath || isSpecTask(task)) return;

  if (action === 'start') {
    startTask(task);
    return;
  }
  const status = ACTION_STATUS[action];
  if (!status) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId, updates: { status } });
  // The TASKS_DATA push re-renders the list, and the drawer with it.
}

function appendMetaPill(container, text, cls) {
  const span = document.createElement('span');
  span.className = `tasks-dashboard-detail-meta-pill ${cls || ''}`.trim();
  span.textContent = text;
  container.appendChild(span);
}

function setSection(textEl, sectionEl, value) {
  if (!textEl) return;
  if (value == null || value === '') {
    textEl.textContent = '';
    if (sectionEl) sectionEl.style.display = 'none';
    return;
  }
  textEl.textContent = value;
  if (sectionEl) sectionEl.style.display = '';
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------- Filter (dashboard-only) ---------- */

function isFilterActive() {
  return filters.categories.size > 0 || filters.priorities.size > 0;
}

function filterMatches(task) {
  if (filters.categories.size > 0 && !filters.categories.has(task.category)) return false;
  if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) return false;
  return true;
}

function setupFilter() {
  filterBtnEl = document.getElementById('tasks-dashboard-filter-btn');
  filterPopoverEl = document.getElementById('tasks-dashboard-filter-popover');
  filterBadgeEl = document.getElementById('tasks-dashboard-filter-badge');
  if (!filterBtnEl || !filterPopoverEl) return;

  filterBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFilterPopover();
  });

  filterPopoverEl.addEventListener('click', (e) => e.stopPropagation());

  filterPopoverEl.querySelectorAll('input[type="checkbox"][data-filter-dim]').forEach(input => {
    input.addEventListener('change', () => {
      const dim = input.dataset.filterDim;
      const value = input.value;
      const set = filters[dim];
      if (!set) return;
      if (input.checked) set.add(value); else set.delete(value);
      updateFilterUI();
      render();
    });
  });

  const clearBtn = document.getElementById('tasks-dashboard-filter-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearFilters);

  // Outside-click closes the popover (only while it's open and dashboard
  // is visible).
  document.addEventListener('click', (e) => {
    if (!isFilterPopoverOpen()) return;
    if (filterPopoverEl.contains(e.target)) return;
    if (filterBtnEl.contains(e.target)) return;
    closeFilterPopover();
  });
}

function isFilterPopoverOpen() {
  return filterPopoverEl && !filterPopoverEl.hasAttribute('hidden');
}

function toggleFilterPopover() {
  // Only one popover open at a time
  if (isSortPopoverOpen()) closeSortPopover();
  if (isFilterPopoverOpen()) closeFilterPopover(); else openFilterPopover();
}

function openFilterPopover() {
  if (!filterPopoverEl || !filterBtnEl) return;
  filterPopoverEl.removeAttribute('hidden');
  filterBtnEl.classList.add('active');
}

function closeFilterPopover() {
  if (!filterPopoverEl || !filterBtnEl) return;
  filterPopoverEl.setAttribute('hidden', '');
  filterBtnEl.classList.remove('active');
}

function clearFilters() {
  filters.categories.clear();
  filters.priorities.clear();
  if (filterPopoverEl) {
    filterPopoverEl.querySelectorAll('input[type="checkbox"][data-filter-dim]').forEach(input => {
      input.checked = false;
    });
  }
  updateFilterUI();
  render();
}

function updateFilterUI() {
  if (!filterBtnEl) return;
  const count = filters.categories.size + filters.priorities.size;
  if (count > 0) {
    filterBtnEl.classList.add('has-filters');
    if (filterBadgeEl) {
      filterBadgeEl.textContent = String(count);
      filterBadgeEl.removeAttribute('hidden');
    }
  } else {
    filterBtnEl.classList.remove('has-filters');
    if (filterBadgeEl) filterBadgeEl.setAttribute('hidden', '');
  }
}

/* ---------- Sort ---------- */

function setupSort() {
  sortBtnEl = document.getElementById('tasks-dashboard-sort-btn');
  sortPopoverEl = document.getElementById('tasks-dashboard-sort-popover');
  sortLabelEl = document.getElementById('tasks-dashboard-sort-label');
  if (!sortBtnEl || !sortPopoverEl) return;

  sortBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSortPopover();
  });
  sortPopoverEl.addEventListener('click', (e) => e.stopPropagation());

  sortPopoverEl.querySelectorAll('input[name="tasks-dashboard-sort"]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      sort.mode = input.dataset.sortMode || 'default';
      updateSortUI();
      render();
      // If the user already opted into "Apply to tasks.json", commit the new
      // order to disk immediately when they pick a different sort mode.
      if (sort.applyToFile) commitSortToFile();
    });
  });

  const applyToggle = document.getElementById('tasks-dashboard-sort-apply');
  if (applyToggle) {
    applyToggle.addEventListener('change', () => {
      sort.applyToFile = applyToggle.checked;
      updateSortUI();
      // Flipping the toggle on with an active sort persists the current view.
      if (sort.applyToFile && sort.mode !== 'default') commitSortToFile();
    });
  }

  const resetBtn = document.getElementById('tasks-dashboard-sort-reset');
  if (resetBtn) resetBtn.addEventListener('click', resetSort);

  document.addEventListener('click', (e) => {
    if (!isSortPopoverOpen()) return;
    if (sortPopoverEl.contains(e.target)) return;
    if (sortBtnEl.contains(e.target)) return;
    closeSortPopover();
  });
}

function isSortPopoverOpen() {
  return sortPopoverEl && !sortPopoverEl.hasAttribute('hidden');
}

function toggleSortPopover() {
  // Only one popover open at a time
  if (isFilterPopoverOpen()) closeFilterPopover();
  if (isSortPopoverOpen()) closeSortPopover(); else openSortPopover();
}

function openSortPopover() {
  if (!sortPopoverEl || !sortBtnEl) return;
  sortPopoverEl.removeAttribute('hidden');
  sortBtnEl.classList.add('active');
}

function closeSortPopover() {
  if (!sortPopoverEl || !sortBtnEl) return;
  sortPopoverEl.setAttribute('hidden', '');
  sortBtnEl.classList.remove('active');
}

function resetSort() {
  sort.mode = 'default';
  // Note: we deliberately don't flip `applyToFile` off — that's a user
  // preference about persistence, not a sort selection. Leaving it as-is
  // means a future sort pick will still respect the user's last choice.
  if (sortPopoverEl) {
    const def = sortPopoverEl.querySelector('input[data-sort-mode="default"]');
    if (def) def.checked = true;
  }
  updateSortUI();
  render();
}

function updateSortUI() {
  if (!sortBtnEl) return;
  const active = sort.mode !== 'default';
  sortBtnEl.classList.toggle('has-sort', active);
  if (sortLabelEl) {
    if (active) {
      sortLabelEl.textContent = sort.mode === 'priority' ? 'Priority' : 'Type';
      sortLabelEl.removeAttribute('hidden');
    } else {
      sortLabelEl.setAttribute('hidden', '');
    }
  }
  const applySub = document.getElementById('tasks-dashboard-sort-apply-sub');
  if (applySub) {
    applySub.textContent = sort.applyToFile
      ? 'On — saved to tasks.json'
      : 'Off — dashboard only';
  }
}

/**
 * Commit the current sorted view to tasks.json. Ids only (tasks-list-view
 * spec, D12): the backend keeps a task's status when its entry carries none,
 * so a sort can never move a task to another status. Non-spec tasks are
 * written in the list's section order, each section sorted; spec tasks keep
 * their slots in the file, so a spec's tasks stay in T order.
 */
function commitSortToFile() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const all = tasks.filter(Boolean);
  const { sections } = buildListModel({ tasks: all, scope: 'all', sortMode: sort.mode });
  const sorted = sections.flatMap(section => section.tasks);
  let next = 0;
  const order = all.map(task => ({ id: (isSpecTask(task) ? task : sorted[next++]).id }));

  ipcRenderer.send(IPC.REORDER_TASKS, { projectPath, order });
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  isVisible: () => isVisible,
  setInlineHost,
  mountInline,
  notifyDetached,
  isInlineMounted: () => inlineMounted,
  // Drawer control for the top bar's task chip (multiTerminalUI): open a
  // task in the drawer while mounted, read what it shows, close it.
  openTask: (id, opts) => !!(inlineMounted && id && selectTask(id, opts)),
  getSelectedTaskId: () => selectedTaskId,
  closeDrawer: () => clearSelection({ notify: false })
};
