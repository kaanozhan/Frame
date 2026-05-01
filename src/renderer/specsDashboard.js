/**
 * Specs Dashboard Module
 *
 * Full-page card grid view of all specs in the active project. Symmetric
 * with the tasksDashboard (Cmd+Shift+D) — opened via the Dashboard button
 * in the side Specs panel header.
 *
 * Layout: filterable grid on the left, sliding detail aside on the right.
 * Cards show title + phase badge + progress bar + slug + AI tool + relative
 * update time. Click a card → detail aside renders Spec / Plan / Tasks tabs
 * with an interactive tasks list (status flips routed through UPDATE_TASK).
 *
 * State subscribes to the same SPEC_DATA + TASKS_DATA streams the side
 * panel uses, so dashboard, side panel, and disk all stay in sync.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

const FILTERS = [
  { id: 'all',                 label: 'All' },
  { id: 'active',              label: 'Active' },
  { id: 'done',                label: 'Done' },
  { id: 'phase:draft',         label: 'Draft' },
  { id: 'phase:specified',     label: 'Specified' },
  { id: 'phase:planned',       label: 'Planned' },
  { id: 'phase:tasks_generated', label: 'Tasks Generated' },
  { id: 'phase:implementing',  label: 'Implementing' }
];

let isVisible = false;
let specs = [];
let allTasks = [];
let selectedSlug = null;
let selectedSpec = null;   // full spec body (from GET_SPEC)
let selectedTab = 'spec';
let activeFilter = 'all';

let dashboardEl = null;
let projectLabelEl = null;
let gridEl = null;
let filtersEl = null;
let detailEl = null;
let detailEmptyEl = null;
let detailContentEl = null;

function init() {
  dashboardEl = document.getElementById('specs-dashboard');
  if (!dashboardEl) return;

  projectLabelEl = document.getElementById('specs-dashboard-project');
  gridEl = document.getElementById('specs-dashboard-grid');
  filtersEl = document.getElementById('specs-dashboard-filters');
  detailEl = document.getElementById('specs-dashboard-detail');
  detailEmptyEl = detailEl.querySelector('.specs-dashboard-detail-empty');
  detailContentEl = detailEl.querySelector('.specs-dashboard-detail-content');

  // Header buttons
  document.getElementById('specs-dashboard-close')?.addEventListener('click', hide);
  document.getElementById('specs-dashboard-new')?.addEventListener('click', () => {
    // Defer to side panel's modal — keeps the New Spec UX in one place
    require('./specPanel').showNewSpecPrompt?.();
  });
  detailEl.querySelector('.specs-dashboard-detail-close')?.addEventListener('click', clearSelection);

  renderFilters();
  setupIPCListeners();

  // Esc closes detail first, then dashboard
  document.addEventListener('keydown', (e) => {
    if (!isVisible) return;
    if (e.key === 'Escape') {
      if (selectedSlug) clearSelection();
      else hide();
    }
  });
}

function setupIPCListeners() {
  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs: incoming }) => {
    specs = incoming || [];
    if (isVisible) {
      renderGrid();
      if (selectedSlug) reloadDetail();
    }
  });

  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
    allTasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    if (isVisible) {
      // Progress chips on cards depend on task state, so re-render the grid
      renderGrid();
      if (selectedSlug && selectedTab === 'tasks') {
        renderDetailBody();
        attachTaskActionHandlers();
      }
    }
  });

  ipcRenderer.on(IPC.TOGGLE_SPECS_DASHBOARD, () => toggle());
}

// ─── Visibility ──────────────────────────────────────────

async function show() {
  if (!dashboardEl) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    require('./taskInfoModal').open?.({
      title: 'No project selected',
      message: 'Select a project from the sidebar to view its specs.'
    });
    return;
  }
  // The side panel and the dashboard show the same data — keeping both open
  // overlaps z-indexes and confuses the layout. Force the side panel closed.
  try { require('./specPanel').hide?.(); } catch {}

  dashboardEl.classList.add('visible');
  isVisible = true;
  if (projectLabelEl) projectLabelEl.textContent = displayProjectName(projectPath);

  // Fetch synchronously so the grid paints with real data on first frame
  // instead of waiting for the watcher's debounced push. Watcher still runs
  // for live updates afterward.
  ipcRenderer.send(IPC.WATCH_SPECS, projectPath);
  ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  try {
    specs = await ipcRenderer.invoke(IPC.LIST_SPECS, projectPath) || [];
  } catch (err) {
    specs = [];
  }
  renderGrid();
}

function hide() {
  if (!dashboardEl) return;
  dashboardEl.classList.remove('visible');
  isVisible = false;
  clearSelection();
}

function toggle() {
  isVisible ? hide() : show();
}

// ─── Filters ─────────────────────────────────────────────

function renderFilters() {
  if (!filtersEl) return;
  filtersEl.innerHTML = FILTERS.map(f => `
    <button class="specs-dashboard-filter-btn ${activeFilter === f.id ? 'active' : ''}" data-filter="${f.id}">${f.label}</button>
  `).join('');
  filtersEl.querySelectorAll('.specs-dashboard-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFilters();
      renderGrid();
    });
  });
}

function applyFilter(specsList) {
  if (activeFilter === 'all') return specsList;
  if (activeFilter === 'active') return specsList.filter(s => s.phase !== 'done');
  if (activeFilter === 'done') return specsList.filter(s => s.phase === 'done');
  if (activeFilter.startsWith('phase:')) {
    const target = activeFilter.slice('phase:'.length);
    return specsList.filter(s => s.phase === target);
  }
  return specsList;
}

// ─── Grid ────────────────────────────────────────────────

function renderGrid() {
  if (!gridEl) return;
  const filtered = applyFilter(specs);

  if (filtered.length === 0) {
    if (specs.length === 0) {
      gridEl.innerHTML = `
        <div class="specs-dashboard-empty">
          <h3>No specs yet</h3>
          <p>Define what you want to build with Spec-Driven Development.</p>
          <button class="btn btn-primary" id="specs-dashboard-empty-new">+ New Spec</button>
        </div>
      `;
      gridEl.querySelector('#specs-dashboard-empty-new')?.addEventListener('click', () => {
        require('./specPanel').showNewSpecPrompt?.();
      });
    } else {
      gridEl.innerHTML = `<div class="specs-dashboard-empty"><p>No specs match the active filter.</p></div>`;
    }
    return;
  }

  gridEl.innerHTML = filtered.map(renderCard).join('');
  gridEl.querySelectorAll('.specs-card').forEach(card => {
    card.addEventListener('click', () => selectCard(card.dataset.slug));
  });
}

function renderCard(spec) {
  const taskMatches = allTasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(`spec:${spec.slug}:`));
  const total = taskMatches.length || spec.task_count || 0;
  const done = taskMatches.filter(t => t.status === 'completed').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const phaseLabel = spec.phase.replace(/_/g, ' ');
  const isSelected = spec.slug === selectedSlug ? 'selected' : '';

  return `
    <div class="specs-card ${isSelected}" data-slug="${escapeHtml(spec.slug)}">
      <div class="specs-card-top">
        <span class="spec-phase-badge phase-${spec.phase}">${phaseLabel}</span>
        ${spec.ai_tool ? `<span class="specs-card-ai">${escapeHtml(spec.ai_tool)}</span>` : ''}
      </div>
      <div class="specs-card-title">${escapeHtml(spec.title)}</div>
      <div class="specs-card-slug">${escapeHtml(spec.slug)}</div>
      ${total > 0 ? `
        <div class="specs-card-progress">
          <div class="specs-card-progress-bar"><div class="specs-card-progress-fill" style="width: ${pct}%"></div></div>
          <span class="specs-card-progress-text">${done} / ${total}</span>
        </div>
      ` : `<div class="specs-card-progress-empty">No tasks yet</div>`}
      <div class="specs-card-foot">
        <span class="specs-card-time">${relativeTime(spec.updated_at)}</span>
      </div>
    </div>
  `;
}

// ─── Detail aside ───────────────────────────────────────

async function selectCard(slug) {
  selectedSlug = slug;
  selectedTab = 'spec';
  await reloadDetail();
  // Re-render to mark the selected card
  renderGrid();
}

function clearSelection() {
  selectedSlug = null;
  selectedSpec = null;
  selectedTab = 'spec';
  if (detailEl) detailEl.classList.remove('has-selection');
  renderGrid();
}

async function reloadDetail() {
  if (!selectedSlug) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  selectedSpec = await ipcRenderer.invoke(IPC.GET_SPEC, { projectPath, slug: selectedSlug });
  if (!selectedSpec) {
    // Spec was deleted out from under us
    clearSelection();
    return;
  }
  if (detailEl) detailEl.classList.add('has-selection');
  renderDetailHeader();
  renderDetailBody();
  attachTaskActionHandlers();
}

function renderDetailHeader() {
  if (!detailContentEl || !selectedSpec) return;
  const { status, spec, plan, tasks, outcome } = selectedSpec;
  const phaseLabel = status.phase.replace(/_/g, ' ');
  const aiLabel = status.ai_tool || '';
  const nextAction = nextActionForPhase(status.phase);

  detailContentEl.innerHTML = `
    <div class="specs-dashboard-detail-head">
      <div class="specs-dashboard-detail-meta">
        <span class="specs-dashboard-detail-slug">${escapeHtml(status.slug)}</span>
        <button class="spec-rename-btn" id="spec-rename-btn" title="Rename spec" aria-label="Rename spec">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        ${aiLabel ? `<span class="specs-detail-ai">${escapeHtml(aiLabel)}</span>` : ''}
      </div>
      <h3 class="specs-dashboard-detail-title">${escapeHtml(status.title)}</h3>
      <div class="specs-dashboard-detail-meta">
        <span class="spec-phase-badge phase-${status.phase}">${phaseLabel}</span>
      </div>
      ${nextAction ? renderNextActionBar(nextAction) : ''}
      <div class="specs-dashboard-detail-tabs">
        ${tabBtn('spec',  'Spec',  !!spec)}
        ${tabBtn('plan',  'Plan',  !!plan)}
        ${tabBtn('tasks', tasksTabLabel(!!tasks), !!tasks || hasSpecTasks())}
        ${tabBtn('outcome', 'Outcome', !!outcome)}
      </div>
    </div>
    <div class="specs-dashboard-detail-body" id="specs-dashboard-detail-body"></div>
  `;
  detailContentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTab = btn.dataset.tab;
      renderDetailHeader();
      renderDetailBody();
      attachTaskActionHandlers();
    });
  });
  detailContentEl.querySelector('#spec-action-btn')?.addEventListener('click', () => {
    if (nextAction) runSpecCommand(nextAction.command);
  });
  detailContentEl.querySelector('#spec-rename-btn')?.addEventListener('click', () => {
    if (selectedSpec) {
      // Reuse the side panel's rename modal for consistency. After a successful
      // rename, the slug change propagates via SPEC_DATA push so we sync our
      // selection too.
      const oldSlug = selectedSpec.status.slug;
      require('./specPanel').showRenameModal?.(selectedSpec.status);
      // Fallback: poll for slug change via the next SPEC_DATA push and re-select.
      // (specPanel's modal will reload its own detail; we react when the rename
      // completes by checking the cached specs list on the next push.)
      const onceListener = (event, payload) => {
        const renamedSlug = (payload?.specs || []).find(s =>
          s.title === selectedSpec.status.title && s.slug !== oldSlug
        )?.slug;
        if (renamedSlug) {
          selectedSlug = renamedSlug;
          reloadDetail();
        }
        ipcRenderer.removeListener(IPC.SPEC_DATA, onceListener);
      };
      ipcRenderer.on(IPC.SPEC_DATA, onceListener);
      // Auto-cleanup after 30s in case rename was cancelled
      setTimeout(() => ipcRenderer.removeListener(IPC.SPEC_DATA, onceListener), 30000);
    }
  });
}

function nextActionForPhase(phase) {
  switch (phase) {
    case 'draft':
      return { command: 'spec.new',  label: 'Run /spec.new', hint: 'Have Claude write spec.md from your description.' };
    case 'specified':
      return { command: 'spec.plan', label: 'Run /spec.plan', hint: 'Generate plan.md from the spec.' };
    case 'planned':
      return { command: 'spec.tasks', label: 'Run /spec.tasks', hint: 'Break the plan into discrete tasks.' };
    case 'tasks_generated':
    case 'implementing':
      return { command: 'spec.implement', label: 'Run /spec.implement', hint: 'Implement the next pending task — one per click.' };
    default:
      return null;
  }
}

function renderNextActionBar(action) {
  return `
    <div class="spec-next-action">
      <div class="spec-next-action-text">
        <strong>${escapeHtml(action.label)}</strong>
        <span>${escapeHtml(action.hint)}</span>
      </div>
      <button class="btn btn-primary spec-action-btn" id="spec-action-btn">
        ${escapeHtml(action.label)}
      </button>
    </div>
  `;
}

async function runSpecCommand(command) {
  if (!selectedSlug) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  const result = await ipcRenderer.invoke(IPC.BUILD_SPEC_COMMAND_FILE, {
    projectPath,
    slug: selectedSlug,
    command,
    aiTool: 'claude-code'
  });
  if (!result || !result.success) {
    console.error('specsDashboard: BUILD_SPEC_COMMAND_FILE failed', result?.error);
    return;
  }
  if (typeof window.terminalSendCommand === 'function') {
    window.terminalSendCommand(result.instruction);
  }
}

function tabBtn(tab, label, hasContent) {
  const active = selectedTab === tab ? 'active' : '';
  const empty = hasContent ? '' : 'empty';
  return `<button class="spec-tab-btn ${active} ${empty}" data-tab="${tab}">${label}${hasContent ? '' : ' <span class="spec-tab-empty-dot">·</span>'}</button>`;
}

function renderDetailBody() {
  if (!selectedSpec) return;
  const body = detailContentEl.querySelector('#specs-dashboard-detail-body');
  if (!body) return;

  if (selectedTab === 'tasks') {
    body.innerHTML = renderTasksTabBody();
    return;
  }

  const md = selectedSpec[selectedTab];
  if (md) {
    body.innerHTML = renderMarkdown(md);
  } else if (selectedTab === 'outcome') {
    body.innerHTML = `<div class="spec-empty-tab">No outcomes yet — they're captured automatically as <code>/spec.implement</code> completes each task.</div>`;
  } else {
    const cmdMap = { spec: '/spec.new', plan: '/spec.plan', tasks: '/spec.tasks' };
    body.innerHTML = `<div class="spec-empty-tab">No <code>${selectedTab}.md</code> yet — run <code>${cmdMap[selectedTab]}</code> from the terminal.</div>`;
  }
}

function renderTasksTabBody() {
  if (!selectedSlug) return '';
  const prefix = `spec:${selectedSlug}:`;
  const items = allTasks
    .filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix))
    .sort((a, b) => (a.source || '').localeCompare(b.source || '', undefined, { numeric: true }));

  if (items.length === 0) {
    if (selectedSpec?.tasks) {
      return `
        <div class="spec-empty-tab">
          Waiting for <code>/spec.tasks</code> output to sync into tasks.json.
        </div>
        ${renderMarkdown(selectedSpec.tasks)}
      `;
    }
    return `<div class="spec-empty-tab">No tasks yet — run <code>/spec.tasks</code> from the terminal.</div>`;
  }

  const total = items.length;
  const completed = items.filter(t => t.status === 'completed').length;
  const inProgress = items.filter(t => t.status === 'in_progress').length;
  const pct = Math.round((completed / total) * 100);

  return `
    <div class="spec-tasks-progress">
      <div class="spec-tasks-progress-text">
        <strong>${completed} / ${total}</strong> done${inProgress ? ` · ${inProgress} in progress` : ''}
      </div>
      <div class="spec-tasks-progress-bar"><div class="spec-tasks-progress-fill" style="width: ${pct}%"></div></div>
    </div>
    <div class="spec-tasks-list">
      ${items.map(renderSpecTaskRow).join('')}
    </div>
  `;
}

function renderSpecTaskRow(task) {
  const taskNum = (task.source || '').split(':').pop() || '—';
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const isPending = task.status === 'pending';

  const statusIcon = isCompleted
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : isInProgress
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;

  let actions = '';
  if (isPending) {
    actions = `
      <button class="spec-task-action-btn" data-action="start" title="Start working">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="spec-task-action-btn" data-action="complete" title="Mark complete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    `;
  } else if (isInProgress) {
    actions = `
      <button class="spec-task-action-btn" data-action="complete" title="Mark complete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="spec-task-action-btn" data-action="pause" title="Move back to pending">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
    `;
  } else {
    actions = `
      <button class="spec-task-action-btn" data-action="reopen" title="Reopen">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    `;
  }

  return `
    <div class="spec-task-row status-${task.status}" data-task-id="${escapeHtml(task.id)}">
      <span class="spec-task-status">${statusIcon}</span>
      <span class="spec-task-num">${escapeHtml(taskNum)}</span>
      <span class="spec-task-title">${escapeHtml(task.title)}</span>
      <span class="spec-task-actions">${actions}</span>
    </div>
  `;
}

function attachTaskActionHandlers() {
  if (!detailContentEl) return;
  detailContentEl.querySelectorAll('.spec-task-row').forEach(row => {
    const taskId = row.dataset.taskId;
    row.querySelectorAll('.spec-task-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSpecTaskAction(taskId, btn.dataset.action);
      });
    });
  });
}

function handleSpecTaskAction(taskId, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath || !taskId) return;
  const statusMap = { start: 'in_progress', complete: 'completed', pause: 'pending', reopen: 'pending' };
  const status = statusMap[action];
  if (!status) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId, updates: { status } });
}

// ─── Helpers ────────────────────────────────────────────

function hasSpecTasks() {
  if (!selectedSlug) return false;
  const prefix = `spec:${selectedSlug}:`;
  return allTasks.some(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
}

function tasksTabLabel(hasMarkdown) {
  if (!selectedSlug) return 'Tasks';
  const prefix = `spec:${selectedSlug}:`;
  const items = allTasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
  if (items.length === 0) return 'Tasks';
  const completed = items.filter(t => t.status === 'completed').length;
  return `Tasks <span class="spec-tab-count">${completed}/${items.length}</span>`;
}

function renderMarkdown(md) {
  if (!md) return '';
  return marked.parse(md).replace(/<script/gi, '&lt;script').replace(/on\w+=/gi, 'data-safe-');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, (Date.now() - t) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function displayProjectName(projectPath) {
  return projectPath.split('/').pop() || projectPath.split('\\').pop() || projectPath;
}

module.exports = { init, show, hide, toggle };
