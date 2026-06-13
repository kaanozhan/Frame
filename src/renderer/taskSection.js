/**
 * Task Section Module
 *
 * A task detail surface that opens as a *section viewport* in the top bar —
 * a navigable tab next to Home / Frames. The viewport shows one task at a
 * time and carries a collapsible sibling rail (sectionRail.js) on its right:
 * clicking another task there switches the viewport in place, so a user can
 * review tasks one after another without the Home → reselect → new-tab
 * round-trip. The chip title always tracks whatever the viewport shows.
 *
 * Opening a task reuses the existing task viewport (navigates it) instead of
 * stacking tabs — the host decides this by type. A Cmd/Ctrl-click (here or in
 * the lane rail) opens the task in a *new* viewport when the user really
 * wants a second one. Several viewports are still possible; each is an
 * independent instance with its own state + IPC subscription.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const sectionRail = require('./sectionRail');
const { CheckSquare } = require('lucide');

let host = null; // multiTerminalUI — owns the tab collection + content area
let seq = 0;     // unique viewport ids

const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed'
};
const STATUS_ORDER = { in_progress: 0, pending: 1, completed: 2 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// ─── Public API ─────────────────────────────────────

function setHost(h) {
  host = h;
}

/** Open a task — reuses the open task viewport, or creates one if none. */
function open(taskId) {
  if (!host || taskId == null) return;
  host.openSection('task', taskId, api, { newTab: false });
}

/** Open a task in a brand-new viewport tab (explicit second context). */
function openInNewTab(taskId) {
  if (!host || taskId == null) return;
  host.openSection('task', taskId, api, { newTab: true });
}

/** Create a fresh task viewport instance (the host calls this when needed). */
function createViewport() {
  const key = `task-vp:${++seq}`;
  let taskId = null;
  let allTasks = [];
  let container = null;

  const onTasksData = (event, payload) => {
    const tasks = payload && payload.tasks;
    allTasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    if (host) host.notifySectionChanged();
  };
  ipcRenderer.on(IPC.TASKS_DATA, onTasksData);

  // Activity dots track the live agent state of lanes working on tasks;
  // null = a lane closed (its task can't be read back), re-render anyway.
  const unsubLaneActivity = require('./agentDispatch').onTaskLaneActivity(() => {
    if (host) host.notifySectionChanged();
  });

  const projectPath = state.getProjectPath();
  if (projectPath) ipcRenderer.send(IPC.LOAD_TASKS, projectPath);

  function navigate(nextId) {
    taskId = nextId;
    if (host) host.notifySectionChanged();
  }

  function getChip() {
    const task = allTasks.find(t => t.id === taskId);
    return { type: 'task', title: task ? task.title : 'Task' };
  }

  function render(el) {
    container = el;
    el.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'section-layout';

    const contentArea = document.createElement('div');
    contentArea.className = 'section-content-area';
    _renderDetail(contentArea);
    layout.appendChild(contentArea);

    const railEl = document.createElement('div');
    sectionRail.render(railEl, {
      title: 'Tasks',
      typeIcon: CheckSquare,
      storageKey: 'frame-section-rail-tasks',
      items: _railItems(),
      completedLabel: 'Completed',
      emptyText: 'No active tasks',
      onSelect: (id, { newTab }) => (newTab ? openInNewTab(id) : navigate(id)),
      onOpenDashboard: () => require('./tasksDashboard').show()
    });
    layout.appendChild(railEl);

    el.appendChild(layout);
  }

  function _railItems() {
    return allTasks
      .slice()
      .sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 1;
        const sb = STATUS_ORDER[b.status] ?? 1;
        if (sa !== sb) return sa - sb;
        return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
      })
      .map((t) => {
        const prio = escapeHtml(t.priority || 'medium');
        const liveDot = require('./agentDispatch').taskStatusDotHtml(t.id);
        return {
          id: t.id,
          active: t.id === taskId,
          completed: t.status === 'completed',
          className: `lane-rail-task status-${escapeHtml(t.status)}`,
          html: `
            <div class="lane-rail-item-row">
              ${liveDot || (t.status === 'in_progress' ? '<span class="lane-rail-task-dot in-progress"></span>' : '')}
              <span class="lane-rail-item-title">${escapeHtml(t.title)}</span>
            </div>
            <div class="lane-rail-card-meta">
              ${t.status === 'in_progress' ? '<span class="task-status-chip in-progress">In Progress</span>' : ''}
              <span class="task-priority priority-${prio}">${prio}</span>
              ${t.category ? `<span class="task-category">${escapeHtml(t.category)}</span>` : ''}
            </div>
          `
        };
      });
  }

  function _renderDetail(el) {
    const task = allTasks.find(t => t.id === taskId) || null;

    if (!task) {
      el.innerHTML = `
        <div class="task-section">
          <div class="task-section-inner">
            <div class="task-section-block task-section-missing">
              ${allTasks.length === 0 ? 'Loading task…' : 'This task no longer exists.'}
            </div>
          </div>
        </div>
      `;
      return;
    }

    const prio = task.priority || 'medium';
    const created = formatDate(task.createdAt);
    const completed = task.status === 'completed' ? formatDate(task.completedAt) : null;

    el.innerHTML = `
      <div class="task-section">
        <div class="task-section-inner">
          <div class="task-section-header">
            <h2 class="task-section-title">${escapeHtml(task.title)}</h2>
            <div class="task-section-meta">
              ${require('./agentDispatch').taskStatusDotHtml(task.id)}
              <span class="task-section-status status-${escapeHtml(task.status)}">${STATUS_LABELS[task.status] || task.status}</span>
              <span class="task-priority priority-${escapeHtml(prio)}">${escapeHtml(prio)}</span>
              ${task.category ? `<span class="task-category">${escapeHtml(task.category)}</span>` : ''}
              ${sourceChip(task.source)}
              ${created ? `<span class="task-section-date">Created ${created}</span>` : ''}
              ${completed ? `<span class="task-section-date">· Completed ${completed}</span>` : ''}
            </div>
            <div class="task-section-actions">${actionButtons(task.status)}</div>
          </div>
          ${block('Description', task.description)}
          ${block('User Request', task.userRequest, true)}
          ${block('Acceptance Criteria', task.acceptanceCriteria)}
          ${block('Notes', task.notes)}
        </div>
      </div>
    `;

    el.querySelectorAll('.task-section-actions [data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(task, btn.dataset.action));
    });
  }

  function dispose() {
    ipcRenderer.removeListener(IPC.TASKS_DATA, onTasksData);
    unsubLaneActivity();
    container = null;
  }

  return { type: 'task', key, viewClass: 'section-view', navigate, getChip, render, dispose };
}

// ─── Rendering helpers (pure / stateless) ───────────

function block(heading, content, quote = false) {
  if (!content || (Array.isArray(content) && content.length === 0)) return '';
  const body = Array.isArray(content)
    ? `<ul class="task-section-list">${content.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
    : quote
      ? `<blockquote class="task-section-quote">${escapeHtml(content)}</blockquote>`
      : `<p class="task-section-text">${escapeHtml(content)}</p>`;
  return `
    <div class="task-section-block">
      <h4 class="task-section-block-title">${heading}</h4>
      ${body}
    </div>
  `;
}

function actionButtons(status) {
  if (status === 'pending') {
    return `
      <button class="btn btn-primary" data-action="start">Start Working</button>
      <button class="btn btn-secondary" data-action="complete">Mark Complete</button>
    `;
  }
  if (status === 'in_progress') {
    return `
      <button class="btn btn-primary" data-action="complete">Mark Complete</button>
      <button class="btn btn-secondary" data-action="pause">Move to Pending</button>
    `;
  }
  return `<button class="btn btn-secondary" data-action="reopen">Reopen Task</button>`;
}

function handleAction(task, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath || !task) return;

  if (action === 'start') {
    // Run flow: config modal → Agent Dispatch into a new Frame; status
    // flips to in_progress only after the prompt actually lands. Shared
    // with the tasks panel's ▶ — lazy-required to avoid load-order coupling.
    require('./tasksPanel').openRunFlow(task);
    return;
  }

  const statusMap = {
    complete: 'completed',
    pause: 'pending',
    reopen: 'pending'
  };
  const status = statusMap[action];
  if (!status) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId: task.id, updates: { status } });
  // TASKS_DATA push re-renders the viewport (and the rail/panels with it).
}

function sourceChip(source) {
  if (!source || typeof source !== 'string' || !source.startsWith('spec:')) return '';
  const slug = source.split(':')[1] || '';
  if (!slug) return '';
  return `<span class="task-source-chip" title="From spec: ${escapeHtml(slug)}">spec · ${escapeHtml(slug)}</span>`;
}

function formatDate(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const api = { setHost, open, openInNewTab, createViewport };
module.exports = api;
