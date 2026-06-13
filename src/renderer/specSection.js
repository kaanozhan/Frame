/**
 * Spec Section Module
 *
 * Spec counterpart of taskSection.js: a spec detail surface that opens as a
 * navigable *section viewport* in the top bar, with a collapsible sibling rail
 * (sectionRail.js) listing the project's specs. Clicking another spec there
 * switches the viewport in place; the chip title tracks whatever is shown.
 * The detail mirrors specPanel.js (lifecycle stepper, next-action bar,
 * spec / plan / tasks / outcome tabs, interactive task rows) and reuses the
 * same CSS classes (spec-detail-*, spec-tab-*, spec-task-*).
 *
 * Opening a spec reuses the open spec viewport (navigates it) instead of
 * stacking tabs; a Cmd/Ctrl-click opens it in a new viewport when a second
 * context is genuinely wanted.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const sectionRail = require('./sectionRail');
const { FileText } = require('lucide');

let host = null;
let seq = 0;

const SPEC_PHASE_ORDER = ['implementing', 'tasks_generated', 'planned', 'specified', 'draft', 'done'];

// ─── Public API ─────────────────────────────────────

function setHost(h) {
  host = h;
}

/** Open a spec — reuses the open spec viewport, or creates one if none. */
function open(slug) {
  if (!host || !slug) return;
  host.openSection('spec', slug, api, { newTab: false });
}

/** Open a spec in a brand-new viewport tab. */
function openInNewTab(slug) {
  if (!host || !slug) return;
  host.openSection('spec', slug, api, { newTab: true });
}

/** Create a fresh spec viewport instance (the host calls this when needed). */
function createViewport() {
  const key = `spec-vp:${++seq}`;
  let slug = null;
  let activeSpec = null;
  let activeTab = 'spec';
  let allTasks = [];
  let specsList = [];
  let container = null;

  const onTasksData = (event, payload) => {
    const tasks = payload && payload.tasks;
    allTasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    if (host) host.notifySectionChanged();
  };
  const onSpecData = async (event, payload) => {
    if (payload && Array.isArray(payload.specs)) specsList = payload.specs;
    await fetchDetail();
    if (host) host.notifySectionChanged();
  };
  ipcRenderer.on(IPC.TASKS_DATA, onTasksData);
  ipcRenderer.on(IPC.SPEC_DATA, onSpecData);

  // Track this spec's assigned Frame so the next-action bar's busy lock
  // follows the live agent state (fires only on material changes).
  const unsubLaneActivity = require('./agentDispatch').onSpecLaneActivity((s) => {
    if (s === slug && host) host.notifySectionChanged();
  });

  const projectPath = state.getProjectPath();
  if (projectPath) {
    ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
    ipcRenderer.invoke(IPC.LIST_SPECS, projectPath).then((list) => {
      if (Array.isArray(list)) { specsList = list; if (host) host.notifySectionChanged(); }
    }).catch(() => { /* SPEC_DATA push will cover it */ });
  }

  async function fetchDetail() {
    const pp = state.getProjectPath();
    if (!pp || !slug) { activeSpec = null; return; }
    activeSpec = await ipcRenderer.invoke(IPC.GET_SPEC, { projectPath: pp, slug });
  }

  function navigate(nextSlug) {
    slug = nextSlug;
    activeTab = 'spec';
    activeSpec = null;
    if (host) host.notifySectionChanged(); // show loading immediately
    fetchDetail().then(() => { if (host) host.notifySectionChanged(); });
  }

  function getChip() {
    const title = (activeSpec && activeSpec.status && activeSpec.status.title) || slug || 'Spec';
    return { type: 'spec', title };
  }

  function render(el) {
    container = el;
    el.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'section-layout';

    const contentArea = document.createElement('div');
    contentArea.className = 'section-content-area';
    contentArea.innerHTML = `
      <div class="spec-section">
        <div class="spec-section-inner spec-detail" id="spec-section-content"></div>
      </div>
    `;
    layout.appendChild(contentArea);

    const railEl = document.createElement('div');
    sectionRail.render(railEl, {
      title: 'Specs',
      typeIcon: FileText,
      storageKey: 'frame-section-rail-specs',
      items: _railItems(),
      completedLabel: 'Done',
      emptyText: 'No active specs',
      onSelect: (s, { newTab }) => (newTab ? openInNewTab(s) : navigate(s)),
      onOpenDashboard: () => require('./specsDashboard').show()
    });
    layout.appendChild(railEl);

    el.appendChild(layout);
    _renderDetail(contentArea);
  }

  function _railItems() {
    return specsList
      .slice()
      .sort((a, b) => SPEC_PHASE_ORDER.indexOf(a.phase) - SPEC_PHASE_ORDER.indexOf(b.phase))
      .map((s) => {
        const { done, total } = _specProgress(s.slug);
        return {
          id: s.slug,
          active: s.slug === slug,
          completed: s.phase === 'done',
          className: 'lane-rail-spec',
          html: `
            <div class="lane-rail-item-title">${escapeHtml(s.title || s.slug)}</div>
            <div class="lane-rail-card-meta">
              <span class="spec-phase-badge phase-${escapeHtml(s.phase)}">${escapeHtml(String(s.phase).replace('_', ' '))}</span>
              ${total > 0 ? `<span class="lane-rail-progress-text">${done}/${total} tasks</span>` : ''}
            </div>
            ${total > 0 ? `<div class="lane-rail-progress"><div class="lane-rail-progress-fill" style="width:${Math.round((done / total) * 100)}%"></div></div>` : ''}
          `
        };
      });
  }

  function _specProgress(specSlug) {
    const prefix = `spec:${specSlug}:`;
    let done = 0;
    let total = 0;
    for (const t of allTasks) {
      if (t.source && t.source.startsWith(prefix)) {
        total++;
        if (t.status === 'completed') done++;
      }
    }
    return { done, total };
  }

  function _renderDetail(contentArea) {
    const contentEl = contentArea.querySelector('#spec-section-content');
    if (!contentEl) return;

    if (!activeSpec) {
      contentEl.innerHTML = `<div class="specs-empty"><p>${slug ? 'Loading spec…' : 'Select a spec'}</p></div>`;
      return;
    }

    const { status, spec, plan, tasks, outcome } = activeSpec;
    const aiLabel = status.ai_tool || '';
    const nextAction = nextActionForPhase(status.phase);

    contentEl.innerHTML = `
      <div class="spec-detail-header">
        <h3 class="spec-detail-title">${escapeHtml(status.title)}</h3>
        <div class="spec-detail-meta">
          ${require('./agentDispatch').specStatusDotHtml(status.slug)}
          <span class="spec-detail-slug">${escapeHtml(status.slug)}</span>
          ${aiLabel ? `<span class="spec-detail-ai">${escapeHtml(aiLabel)}</span>` : ''}
        </div>
      </div>
      ${renderStepper(status.phase)}
      ${nextAction ? renderNextActionBar(nextAction, require('./agentDispatch').getSpecLaneInfo(slug)) : ''}
      <div class="spec-detail-tabs">
        ${renderTabButton('spec', 'Spec', !!spec)}
        ${renderTabButton('plan', 'Plan', !!plan)}
        ${renderTabButton('tasks', tasksTabLabel(), !!tasks || hasSpecTasks())}
        ${renderTabButton('outcome', 'Outcome', !!outcome)}
      </div>
      <div class="spec-detail-body" id="spec-section-detail-body">
        ${renderTabBody(activeTab)}
      </div>
    `;

    contentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    contentEl.querySelector('#spec-section-action-btn')?.addEventListener('click', () => {
      if (nextAction) runSpecCommand(nextAction.command);
    });
    if (activeTab === 'tasks') attachTaskActionHandlers(contentEl);
  }

  function switchTab(tab) {
    activeTab = tab;
    if (!container) return;
    const contentEl = container.querySelector('#spec-section-content');
    if (!contentEl) return;
    contentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const body = contentEl.querySelector('#spec-section-detail-body');
    if (body) body.innerHTML = renderTabBody(tab);
    if (tab === 'tasks') attachTaskActionHandlers(contentEl);
  }

  function renderTabButton(tab, label, hasContent) {
    const active = activeTab === tab ? 'active' : '';
    const empty = hasContent ? '' : 'empty';
    return `<button class="spec-tab-btn ${active} ${empty}" data-tab="${tab}">${label}${hasContent ? '' : ' <span class="spec-tab-empty-dot">·</span>'}</button>`;
  }

  function hasSpecTasks() {
    const prefix = `spec:${slug}:`;
    return allTasks.some(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
  }

  function tasksTabLabel() {
    const prefix = `spec:${slug}:`;
    const items = allTasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
    if (items.length === 0) return 'Tasks';
    const completed = items.filter(t => t.status === 'completed').length;
    return `Tasks <span class="spec-tab-count">${completed}/${items.length}</span>`;
  }

  function renderTabBody(tab) {
    if (tab === 'tasks') return renderTasksTabBody();
    const md = activeSpec?.[tab];
    if (md) return renderMarkdown(md);
    if (tab === 'outcome') {
      return `<div class="spec-empty-tab">No outcomes yet — they're captured automatically as <code>/spec.implement</code> completes each task.</div>`;
    }
    const cmdMap = { spec: '/spec.new', plan: '/spec.plan', tasks: '/spec.tasks' };
    return `<div class="spec-empty-tab">No <code>${tab}.md</code> yet — run <code>${cmdMap[tab]}</code> from the terminal.</div>`;
  }

  function renderTasksTabBody() {
    const prefix = `spec:${slug}:`;
    const items = allTasks
      .filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix))
      .sort((a, b) => (a.source || '').localeCompare(b.source || '', undefined, { numeric: true }));

    if (items.length === 0) {
      if (activeSpec?.tasks) {
        return `
          <div class="spec-empty-tab">
            Waiting for <code>/spec.tasks</code> output to sync into tasks.json.
            The raw <code>tasks.md</code> follows:
          </div>
          ${renderMarkdown(activeSpec.tasks)}
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

  function attachTaskActionHandlers(contentEl) {
    contentEl.querySelectorAll('.spec-task-row').forEach(row => {
      const taskId = row.dataset.taskId;
      row.querySelectorAll('.spec-task-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleTaskAction(taskId, btn.dataset.action);
        });
      });
    });
  }

  async function runSpecCommand(command) {
    if (!slug) return;
    // Dispatch enters the target Frame itself, which takes the section off
    // the screen — its tab stays open, same as the old hideSections path.
    await require('./agentDispatch').dispatchSpecCommand({
      slug,
      title: (activeSpec && activeSpec.status && activeSpec.status.title) || slug,
      command
    });
  }

  function dispose() {
    ipcRenderer.removeListener(IPC.TASKS_DATA, onTasksData);
    ipcRenderer.removeListener(IPC.SPEC_DATA, onSpecData);
    unsubLaneActivity();
    container = null;
  }

  return { type: 'spec', key, viewClass: 'section-view', navigate, getChip, render, dispose };
}

// ─── Pure helpers ───────────────────────────────────

function nextActionForPhase(phase) {
  switch (phase) {
    case 'draft':
      return { command: 'spec.new', label: 'Write the Spec', hint: 'Frame turns your description into a structured spec.md.' };
    case 'specified':
      return { command: 'spec.plan', label: 'Generate Plan', hint: 'Frame breaks this spec into a technical plan (plan.md).' };
    case 'planned':
      return { command: 'spec.tasks', label: 'Break into Tasks', hint: 'Frame splits the plan into discrete, trackable tasks.' };
    case 'tasks_generated':
    case 'implementing':
      return { command: 'spec.implement', label: 'Implement Next Task', hint: 'Frame implements the next pending task — one per click.' };
    default:
      return null;
  }
}

function renderNextActionBar(action, lane) {
  // Live agent mid-turn in the assigned Frame → lock the button against
  // double-dispatch. Derived from getSpecLaneInfo on every render; lane
  // activity re-renders the section, so a dead agent or closed Frame
  // unlocks it again on its own.
  if (lane && lane.busy) {
    const verb = lane.status === 'agent-approval' ? 'Waiting for approval' : 'Working';
    return `
    <div class="spec-next-action spec-next-action-busy">
      <div class="spec-next-action-text">
        <strong>${escapeHtml(verb)} in ${escapeHtml(lane.name)}</strong>
        <span>Unlocks when the agent finishes its turn.</span>
        <code class="spec-next-action-cmd">/${escapeHtml(action.command)}</code>
      </div>
      <button class="btn btn-primary spec-action-btn" disabled>
        <span class="spec-action-spinner"></span>${escapeHtml(action.label)}
      </button>
    </div>
  `;
  }
  return `
    <div class="spec-next-action">
      <div class="spec-next-action-text">
        <strong>Next step: ${escapeHtml(action.label)}</strong>
        <span>${escapeHtml(action.hint)}</span>
        <code class="spec-next-action-cmd">/${escapeHtml(action.command)}</code>
      </div>
      <button class="btn btn-primary spec-action-btn" id="spec-section-action-btn">
        ${escapeHtml(action.label)}
      </button>
    </div>
  `;
}

const STEPPER_STEPS = ['Spec', 'Plan', 'Tasks', 'Implement', 'Done'];

function stepIndexForPhase(phase) {
  switch (phase) {
    case 'draft': return 0;
    case 'specified': return 1;
    case 'planned': return 2;
    case 'tasks_generated':
    case 'implementing': return 3;
    case 'done': return STEPPER_STEPS.length;
    default: return 0;
  }
}

function renderStepper(phase) {
  const activeIdx = stepIndexForPhase(phase);
  const check = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const parts = [];
  STEPPER_STEPS.forEach((label, i) => {
    if (i > 0) parts.push(`<div class="spec-step-line ${i <= activeIdx ? 'done' : ''}"></div>`);
    const stepState = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'upcoming';
    parts.push(`
      <div class="spec-step ${stepState}">
        <span class="spec-step-marker">${stepState === 'done' ? check : ''}</span>
        <span class="spec-step-label">${label}</span>
      </div>
    `);
  });
  return `<div class="spec-stepper">${parts.join('')}</div>`;
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

function handleTaskAction(taskId, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath || !taskId) return;
  const statusMap = { start: 'in_progress', complete: 'completed', pause: 'pending', reopen: 'pending' };
  const status = statusMap[action];
  if (!status) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId, updates: { status } });
}

function renderMarkdown(md) {
  if (!md) return '';
  return marked
    .parse(md)
    .replace(/<script/gi, '&lt;script')
    .replace(/on\w+=/gi, 'data-safe-');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const api = { setHost, open, openInNewTab, createViewport };
module.exports = api;
