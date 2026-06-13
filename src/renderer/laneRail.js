/**
 * Lane Rail Module
 *
 * Context rail on the right side of the lane board: a glanceable teaser of
 * the project's Specs and Tasks. The rail is a vitrine, not a home — item
 * and header clicks deep-link into the existing specsDashboard /
 * tasksPanel / tasksDashboard surfaces.
 *
 * The whole rail and each section are independently collapsible; states
 * persist in localStorage. When the rail is hidden, a slim strip with the
 * section icons stays on the right edge so it can be reopened any time.
 *
 * Subscribes to the same SPEC_DATA + TASKS_DATA pushes the panels use, so
 * the rail stays live without new IPC channels.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const {
  PanelRightClose, PanelRightOpen, FileText, CheckSquare,
  ChevronRight, ChevronDown, ArrowUpRight
} = require('lucide');

const STORAGE_KEY = 'frame-lane-rail';
const MAX_SPECS = 5;

const SPEC_PHASE_ORDER = ['implementing', 'tasks_generated', 'planned', 'specified', 'draft', 'done'];
const TASK_PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

let initialized = false;
let specs = [];
let allTasks = [];
let currentProjectPath = null;
let railContainer = null;

function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

// ─── Persisted UI state ─────────────────────────────────────

const UI_DEFAULTS = {
  hidden: false, specsCollapsed: false, tasksCollapsed: false,
  // Tasks section controls (mirror the dashboard's filter/sort dimensions)
  taskPriority: 'all', taskCategory: 'all', taskSort: 'default'
};

function getUIState() {
  try {
    return Object.assign({}, UI_DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return { ...UI_DEFAULTS };
  }
}

function setUIState(partial) {
  const next = Object.assign(getUIState(), partial);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* non-fatal */ }
}

// ─── Data ───────────────────────────────────────────────────

function _initOnce() {
  if (initialized) return;
  initialized = true;

  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs: incoming }) => {
    specs = incoming || [];
    _rerenderIfVisible();
  });

  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
    allTasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    _rerenderIfVisible();
  });

  // Spec/task activity dots track the assigned Frames' live agent state
  require('./agentDispatch').onSpecLaneActivity(() => _rerenderIfVisible());
  require('./agentDispatch').onTaskLaneActivity(() => _rerenderIfVisible());

  // Outside click closes any open filter/sort popover
  document.addEventListener('click', () => _closeRailPopovers());
}

async function _fetchForProject(projectPath) {
  ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  try {
    const fresh = await ipcRenderer.invoke(IPC.LIST_SPECS, projectPath);
    if (Array.isArray(fresh)) {
      specs = fresh;
      _rerenderIfVisible();
    }
  } catch { /* SPEC_DATA push will cover it */ }
}

function _rerenderIfVisible() {
  if (railContainer && railContainer.isConnected) {
    _renderInto(railContainer);
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Render the rail into the given container for the given project.
 * Called by laneBoard on every board render.
 */
function render(container, projectPath) {
  _initOnce();
  railContainer = container;

  if (projectPath !== currentProjectPath) {
    currentProjectPath = projectPath;
    specs = [];
    allTasks = [];
    _fetchForProject(projectPath);
  }

  _renderInto(container);
}

// ─── Rendering ──────────────────────────────────────────────

function _renderInto(container) {
  const ui = getUIState();
  container.innerHTML = '';
  container.className = ui.hidden ? 'lane-rail board-rail collapsed' : 'lane-rail board-rail';

  if (ui.hidden) {
    container.appendChild(_renderCollapsedStrip());
    return;
  }

  const header = document.createElement('div');
  header.className = 'lane-rail-header';
  header.innerHTML = `
    <button class="lane-rail-toggle" title="Hide panel">${lucideIcon(PanelRightClose, 15)}</button>
  `;
  header.querySelector('.lane-rail-toggle').addEventListener('click', () => {
    setUIState({ hidden: true });
    _renderInto(container);
  });
  container.appendChild(header);

  container.appendChild(_renderSpecsSection(ui));
  container.appendChild(_renderTasksSection(ui));
}

function _renderCollapsedStrip() {
  const strip = document.createElement('div');
  strip.className = 'lane-rail-strip';
  strip.innerHTML = `
    <button class="lane-rail-strip-btn" data-open="rail" title="Show Specs & Tasks">${lucideIcon(PanelRightOpen, 15)}</button>
    <button class="lane-rail-strip-btn" data-open="specs" title="Specs">${lucideIcon(FileText, 15)}</button>
    <button class="lane-rail-strip-btn" data-open="tasks" title="Tasks">${lucideIcon(CheckSquare, 15)}</button>
  `;
  strip.addEventListener('click', (e) => {
    const btn = e.target.closest('.lane-rail-strip-btn');
    if (!btn) return;
    const which = btn.dataset.open;
    // Clicking a section icon opens the rail focused on just that section —
    // the other comes in collapsed. The expand icon restores both as they were.
    setUIState({
      hidden: false,
      ...(which === 'specs' ? { specsCollapsed: false, tasksCollapsed: true } : {}),
      ...(which === 'tasks' ? { tasksCollapsed: false, specsCollapsed: true } : {})
    });
    _rerenderIfVisible();
  });
  return strip;
}

function _sectionHeader({ title, count, collapsed, onToggle, onOpen, openTitle }) {
  const header = document.createElement('div');
  header.className = 'lane-rail-section-header';
  header.innerHTML = `
    <span class="lane-rail-section-chevron">${lucideIcon(collapsed ? ChevronRight : ChevronDown, 13)}</span>
    <span class="lane-rail-section-title">${title}</span>
    <span class="lane-rail-section-count">${count}</span>
    <button class="lane-rail-section-open" title="${openTitle}">${lucideIcon(ArrowUpRight, 13)}</button>
  `;
  header.addEventListener('click', (e) => {
    if (e.target.closest('.lane-rail-section-open')) {
      onOpen();
      return;
    }
    onToggle();
  });
  return header;
}

function _renderSpecsSection(ui) {
  const section = document.createElement('div');
  section.className = 'lane-rail-section rail-specs';

  const active = specs
    .filter(s => s.phase !== 'done')
    .sort((a, b) => SPEC_PHASE_ORDER.indexOf(a.phase) - SPEC_PHASE_ORDER.indexOf(b.phase));

  section.appendChild(_sectionHeader({
    title: 'Specs',
    count: active.length,
    collapsed: ui.specsCollapsed,
    onToggle: () => { setUIState({ specsCollapsed: !ui.specsCollapsed }); _rerenderIfVisible(); },
    onOpen: () => require('./specsDashboard').show(),
    openTitle: 'Open Specs Dashboard'
  }));

  if (ui.specsCollapsed) return section;

  const body = document.createElement('div');
  body.className = 'lane-rail-section-body';

  if (active.length === 0) {
    body.innerHTML = `<div class="lane-rail-empty">No active specs</div>`;
  } else {
    active.slice(0, MAX_SPECS).forEach((s) => {
      const { done, total } = _specProgress(s);
      const item = document.createElement('div');
      item.className = 'lane-rail-item lane-rail-card';
      item.innerHTML = `
        <div class="lane-rail-item-title">${require('./agentDispatch').specStatusDotHtml(s.slug)}${escapeHtml(s.title || s.slug)}</div>
        <div class="lane-rail-card-meta">
          <span class="spec-phase-badge phase-${escapeHtml(s.phase)}">${escapeHtml(String(s.phase).replace('_', ' '))}</span>
          ${total > 0 ? `<span class="lane-rail-progress-text">${done}/${total} tasks</span>` : ''}
        </div>
        ${total > 0 ? `
        <div class="lane-rail-progress">
          <div class="lane-rail-progress-fill" style="width:${Math.round((done / total) * 100)}%"></div>
        </div>` : ''}
      `;
      item.title = 'Open in a new tab';
      item.addEventListener('click', () => require('./specSection').openInNewTab(s.slug));
      body.appendChild(item);
    });

    if (active.length > MAX_SPECS) {
      body.appendChild(_moreLink(`+${active.length - MAX_SPECS} more`, () => require('./specsDashboard').show()));
    }
  }

  section.appendChild(body);
  return section;
}

function _specProgress(spec) {
  const ids = new Set(
    allTasks
      .filter(t => t.source && t.source.startsWith(`spec:${spec.slug}:`))
      .map(t => t.id)
  );
  let done = 0;
  let total = 0;
  for (const t of allTasks) {
    if (ids.has(t.id)) {
      total++;
      if (t.status === 'completed') done++;
    }
  }
  return { done, total };
}

function _renderTasksSection(ui) {
  const section = document.createElement('div');
  section.className = 'lane-rail-section rail-tasks';

  const open = allTasks.filter(t => t.status === 'in_progress' || t.status === 'pending');

  section.appendChild(_sectionHeader({
    title: 'Tasks',
    count: open.length,
    collapsed: ui.tasksCollapsed,
    onToggle: () => { setUIState({ tasksCollapsed: !ui.tasksCollapsed }); _rerenderIfVisible(); },
    onOpen: () => require('./tasksDashboard').show(),
    openTitle: 'Open Task Dashboard'
  }));

  if (ui.tasksCollapsed) return section;

  // Filter + sort controls (compact mirror of the dashboard's dimensions);
  // selections persist with the rest of the rail UI state.
  const categories = [...new Set(allTasks.map(t => t.category).filter(Boolean))].sort();
  section.appendChild(_taskControls(ui, categories));

  const filtered = open
    .filter(t => ui.taskPriority === 'all' || (t.priority || 'medium') === ui.taskPriority)
    .filter(t => ui.taskCategory === 'all' || t.category === ui.taskCategory)
    .sort(TASK_SORTS[ui.taskSort] || TASK_SORTS.default);

  // All matching tasks render — the section's flex share caps the height
  // and the body scrolls past it
  const body = document.createElement('div');
  body.className = 'lane-rail-section-body';

  if (filtered.length === 0) {
    body.innerHTML = `<div class="lane-rail-empty">${open.length === 0 ? 'No open tasks' : 'No tasks match the filters'}</div>`;
  } else {
    filtered.forEach((t) => {
      const prio = escapeHtml(t.priority || 'medium');
      // Live agent on this task → pulsing activity dot replaces the static
      // in-progress marker; otherwise the marker shows "started, no one on
      // it right now".
      const liveDot = require('./agentDispatch').taskStatusDotHtml(t.id);
      const item = document.createElement('div');
      item.className = `lane-rail-item lane-rail-card lane-rail-task${t.status === 'in_progress' ? ' status-in-progress' : ''}`;
      item.innerHTML = `
        <div class="lane-rail-item-row">
          ${liveDot || (t.status === 'in_progress' ? '<span class="lane-rail-task-dot in-progress"></span>' : '')}
          <span class="lane-rail-item-title">${escapeHtml(t.title)}</span>
        </div>
        <div class="lane-rail-card-meta">
          ${t.status === 'in_progress' ? '<span class="task-status-chip in-progress">In Progress</span>' : ''}
          <span class="task-priority priority-${prio}">${prio}</span>
          ${t.category ? `<span class="task-category">${escapeHtml(t.category)}</span>` : ''}
        </div>
      `;
      item.title = 'Open in a new tab';
      item.addEventListener('click', () => require('./taskSection').openInNewTab(t.id));
      body.appendChild(item);
    });
  }

  section.appendChild(body);
  return section;
}

const TASK_SORTS = {
  // in-progress first, then priority — the section's historical order
  default: (a, b) => {
    if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
    return (TASK_PRIORITY_ORDER[a.priority] ?? 1) - (TASK_PRIORITY_ORDER[b.priority] ?? 1);
  },
  priority: (a, b) => (TASK_PRIORITY_ORDER[a.priority] ?? 1) - (TASK_PRIORITY_ORDER[b.priority] ?? 1),
  newest: (a, b) => (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0)
};

// Same icons as the dashboard toolbar (funnel / sort arrows)
const FILTER_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
const SORT_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h5"/><path d="M17 8l4-4 4 4" transform="translate(-3 0)"/><path d="M18 4v16"/></svg>';

const SORT_LABELS = { default: 'Status', priority: 'Priority', newest: 'Newest' };

function _popoverOption(name, value, label, checked) {
  return `
    <label class="tasks-dashboard-popover-option">
      <input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

// Filter + Sort as compact icon buttons opening dashboard-style popovers —
// same visual language (toolbar-btn + popover classes) as the Tasks
// dashboard, single-select radios instead of its multi-select checkboxes.
function _taskControls(ui, categories) {
  const controls = document.createElement('div');
  controls.className = 'lane-rail-controls';

  const filterCount = (ui.taskPriority !== 'all' ? 1 : 0) + (ui.taskCategory !== 'all' ? 1 : 0);
  const sortActive = ui.taskSort !== 'default';

  controls.innerHTML = `
    <div class="lane-rail-ctl-wrap">
      <button class="tasks-dashboard-toolbar-btn lane-rail-ctl-btn${filterCount ? ' has-filters' : ''}" data-pop="filter" title="Filter tasks">
        ${FILTER_ICON_SVG}
        Filter
        ${filterCount ? `<span class="tasks-dashboard-toolbar-badge">${filterCount}</span>` : ''}
      </button>
      <div class="tasks-dashboard-popover lane-rail-popover" hidden>
        <div class="tasks-dashboard-popover-section">
          <h5>Priority</h5>
          ${['all', 'high', 'medium', 'low'].map(p =>
            _popoverOption('rail-task-priority', p, p === 'all' ? 'All priorities' : p[0].toUpperCase() + p.slice(1), (ui.taskPriority || 'all') === p)
          ).join('')}
        </div>
        ${categories.length > 0 ? `
        <div class="tasks-dashboard-popover-section">
          <h5>Category</h5>
          ${['all', ...categories].map(c =>
            _popoverOption('rail-task-category', c, c === 'all' ? 'All categories' : c, (ui.taskCategory || 'all') === c)
          ).join('')}
        </div>` : ''}
      </div>
    </div>
    <div class="lane-rail-ctl-wrap">
      <button class="tasks-dashboard-toolbar-btn lane-rail-ctl-btn${sortActive ? ' has-sort' : ''}" data-pop="sort" title="Sort tasks">
        ${SORT_ICON_SVG}
        ${escapeHtml(SORT_LABELS[ui.taskSort] || 'Status')}
      </button>
      <div class="tasks-dashboard-popover lane-rail-popover" hidden>
        <div class="tasks-dashboard-popover-section">
          <h5>Sort by</h5>
          ${_popoverOption('rail-task-sort', 'default', 'Status (in progress first)', (ui.taskSort || 'default') === 'default')}
          ${_popoverOption('rail-task-sort', 'priority', 'Priority', ui.taskSort === 'priority')}
          ${_popoverOption('rail-task-sort', 'newest', 'Newest', ui.taskSort === 'newest')}
        </div>
      </div>
    </div>
  `;

  controls.querySelectorAll('[data-pop]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = btn.nextElementSibling;
      const wasHidden = pop.hasAttribute('hidden');
      _closeRailPopovers();
      if (wasHidden) pop.removeAttribute('hidden');
    });
  });
  // Keep clicks inside a popover from bubbling to the outside-click closer
  controls.querySelectorAll('.lane-rail-popover').forEach((pop) => {
    pop.addEventListener('click', (e) => e.stopPropagation());
  });

  const stateKeys = {
    'rail-task-priority': 'taskPriority',
    'rail-task-category': 'taskCategory',
    'rail-task-sort': 'taskSort'
  };
  controls.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.addEventListener('change', () => {
      setUIState({ [stateKeys[input.name]]: input.value });
      _rerenderIfVisible();
    });
  });

  return controls;
}

function _closeRailPopovers() {
  document.querySelectorAll('.lane-rail-popover:not([hidden])').forEach((p) => p.setAttribute('hidden', ''));
}

function _moreLink(label, onClick) {
  const more = document.createElement('div');
  more.className = 'lane-rail-more';
  more.textContent = label;
  more.addEventListener('click', onClick);
  return more;
}

module.exports = { render };
