/**
 * Tasks Panel Module
 * UI for displaying and managing project tasks
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

let isVisible = false;
let currentFilter = 'all'; // all, pending, inProgress, completed
let tasksData = null;
let claudeCodeRunning = false; // Track if Claude Code was started

// DOM Elements
let panelElement = null;
let contentElement = null;
let filterButtons = null;

/**
 * Initialize tasks panel
 */
function init() {
  panelElement = document.getElementById('tasks-panel');
  contentElement = document.getElementById('tasks-content');

  if (!panelElement) {
    console.error('Tasks panel element not found');
    return;
  }

  setupEventListeners();
  setupIPCListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Close button
  const closeBtn = document.getElementById('tasks-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hide);
  }

  // Collapse button
  const collapseBtn = document.getElementById('tasks-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', hide);
  }

  // Add task button — opens the modal in place. The modal's transparent
  // blurred backdrop makes whatever is behind (terminal / dashboard / etc.)
  // serve as the visible context.
  const addBtn = document.getElementById('tasks-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', showAddTaskModal);
  }

  // Show Dashboard button — opens the full-page Kanban view. Lazy-required to
  // sidestep the circular dependency between tasksPanel and tasksDashboard.
  const dashboardBtn = document.getElementById('tasks-dashboard-btn');
  if (dashboardBtn) {
    dashboardBtn.addEventListener('click', () => {
      require('./tasksDashboard').show();
    });
  }

  // Filter buttons
  document.querySelectorAll('.tasks-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.target.dataset.filter;
      setFilter(filter);
    });
  });
}

/**
 * Setup IPC listeners
 */
function setupIPCListeners() {
  ipcRenderer.on(IPC.TASKS_DATA, (event, { projectPath, tasks }) => {
    if (tasks) {
      tasksData = tasks;
      render();
    }
  });

  ipcRenderer.on(IPC.TASK_UPDATED, (event, { action, task, success }) => {
    if (success) {
      // Tasks data will be sent separately
    }
  });

  ipcRenderer.on(IPC.TOGGLE_TASKS_PANEL, () => {
    toggle();
  });
}

/**
 * Load tasks for current project
 */
function loadTasks() {
  const projectPath = state.getProjectPath();
  if (projectPath) {
    ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  }
}

/**
 * Show tasks panel. If there's no active project, surface an info modal
 * instead of opening an empty panel — there's nothing to show without one.
 */
function show() {
  if (!panelElement) return;
  if (!state.getProjectPath()) {
    require('./taskInfoModal').open({
      title: 'No project selected',
      message: 'Select a project from the sidebar to see and manage its tasks.'
    });
    return;
  }
  panelElement.classList.add('visible');
  isVisible = true;
  loadTasks();
}

/**
 * Hide tasks panel
 */
function hide() {
  if (panelElement) {
    panelElement.classList.remove('visible');
    isVisible = false;
  }
}

/**
 * Toggle tasks panel visibility
 */
function toggle() {
  if (isVisible) {
    hide();
  } else {
    show();
  }
}

/**
 * Set filter
 */
function setFilter(filter) {
  currentFilter = filter;

  // Update active button
  document.querySelectorAll('.tasks-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  render();
}

/**
 * Get filtered tasks
 */
function getFilteredTasks() {
  if (!tasksData || !tasksData.tasks) return [];

  const allTasks = Array.isArray(tasksData.tasks)
    ? tasksData.tasks
    : [
        ...(tasksData.tasks.pending || []).map(t => ({ ...t, status: 'pending' })),
        ...(tasksData.tasks.inProgress || []).map(t => ({ ...t, status: 'in_progress' })),
        ...(tasksData.tasks.completed || []).map(t => ({ ...t, status: 'completed' }))
      ];

  if (currentFilter === 'all') return allTasks;

  const statusMap = {
    pending: 'pending',
    inProgress: 'in_progress',
    completed: 'completed'
  };

  return allTasks.filter(t => t.status === statusMap[currentFilter]);
}

/**
 * Render tasks list
 */
function render() {
  if (!contentElement) return;

  const tasks = getFilteredTasks();

  if (tasks.length === 0) {
    contentElement.innerHTML = `
      <div class="tasks-empty">
        <div class="tasks-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </div>
        <p>No tasks found</p>
        <span>Tasks will appear here when added</span>
      </div>
    `;
    return;
  }

  contentElement.innerHTML = tasks.map(task => renderTaskItem(task)).join('');

  // Add event listeners to task items
  contentElement.querySelectorAll('.task-item').forEach(item => {
    const taskId = item.dataset.taskId;

    // Action buttons
    item.querySelectorAll('.task-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        handleTaskAction(taskId, action);
      });
    });

    // Edit on click (on task content only)
    item.querySelector('.task-content')?.addEventListener('click', () => {
      showEditTaskModal(taskId);
    });
  });
}

/**
 * Render single task item
 */
function renderTaskItem(task) {
  const priorityClass = `priority-${task.priority || 'medium'}`;
  const statusClass = `status-${task.status.replace('_', '-')}`;
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const isPending = task.status === 'pending';

  const priorityLabel = {
    high: 'High',
    medium: 'Med',
    low: 'Low'
  }[task.priority] || 'Med';

  // Status indicator icon
  const statusIcon = isCompleted
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
    : isInProgress
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;

  // Action buttons based on status
  let actionButtons = '';
  if (isPending) {
    actionButtons = `
      <button class="task-action-btn task-start" data-action="start" title="Start working">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="task-action-btn task-complete" data-action="complete" title="Mark complete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    `;
  } else if (isInProgress) {
    actionButtons = `
      <button class="task-action-btn task-complete" data-action="complete" title="Mark complete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="task-action-btn task-pause" data-action="pause" title="Pause">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
    `;
  } else {
    actionButtons = `
      <button class="task-action-btn task-reopen" data-action="reopen" title="Reopen task">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    `;
  }

  return `
    <div class="task-item ${statusClass}" data-task-id="${task.id}">
      <div class="task-status-indicator" title="${task.status.replace('_', ' ')}">
        ${statusIcon}
      </div>
      <div class="task-content">
        <div class="task-title ${isCompleted ? 'completed' : ''}">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          <span class="task-priority ${priorityClass}">${priorityLabel}</span>
          ${task.category ? `<span class="task-category">${task.category}</span>` : ''}
          ${renderSourceChip(task.source)}
          <span class="task-date">${formatDate(task.createdAt)}</span>
        </div>
      </div>
      <div class="task-actions">
        ${actionButtons}
        <button class="task-action-btn task-delete" data-action="delete" title="Delete task">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/**
 * Handle task action buttons
 */
function handleTaskAction(taskId, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const task = getFilteredTasks().find(t => t.id === taskId);
  if (!task) return;

  let newStatus = null;
  let toastMessage = '';

  switch (action) {
    case 'start':
      // Open the run-config modal first; status flips and prompt is sent
      // only after the user confirms AND the launch actually succeeds
      // (e.g. the chosen CLI is installed). Lazy-required to avoid
      // load-order coupling with the rest of the renderer wiring.
      require('./taskRunModal').open(task, {
        onRun: async (opts) => {
          const ok = await runTaskWithOptions(task, opts);
          if (!ok) return;
          ipcRenderer.send(IPC.UPDATE_TASK, {
            projectPath,
            taskId,
            updates: { status: 'in_progress' }
          });
          showToast('Task sent', 'info');
        }
      });
      return;
    case 'complete':
      newStatus = 'completed';
      toastMessage = 'Task completed';
      break;
    case 'pause':
      newStatus = 'pending';
      toastMessage = 'Task paused';
      break;
    case 'reopen':
      newStatus = 'pending';
      toastMessage = 'Task reopened';
      break;
    case 'delete':
      deleteTask(taskId);
      return;
    default:
      return;
  }

  if (newStatus) {
    ipcRenderer.send(IPC.UPDATE_TASK, {
      projectPath,
      taskId,
      updates: { status: newStatus }
    });
    showToast(toastMessage, action === 'complete' ? 'success' : 'info');
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  // Remove existing toast
  const existingToast = document.querySelector('.tasks-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `tasks-toast tasks-toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
  `;

  // Mount on body so the toast lives in the viewport's coordinate space
  // rather than inside the narrow side panel — otherwise errors sit
  // bottom-right where they're easy to miss.
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Errors stay longer because they require user attention.
  const visibleMs = type === 'error' ? 4000 : 2000;
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, visibleMs);
}

/**
 * Get toast icon based on type
 */
function getToastIcon(type) {
  switch (type) {
    case 'success':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    case 'error':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    default:
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }
}

/**
 * Build the task prompt that gets injected into the AI CLI. If the user
 * asked for a new branch, instruct the AI to (1) surface any uncommitted
 * changes for an explicit decision rather than silently carrying or
 * discarding them, and (2) either use the user-provided branch name or
 * — when none was given — suggest one and wait for confirmation before
 * creating it. Uncommitted-check comes first so the branch decision is
 * never made on top of an unresolved working tree.
 */
function buildTaskPrompt(task, opts = {}) {
  let prompt = `Work on this task: ${task.title}`;
  if (task.description) prompt += `. ${task.description}`;
  if (task.priority === 'high') prompt += ` (High priority)`;

  if (opts.branchMode === 'new') {
    const branchStep = opts.newBranchName
      ? `create and switch to a new branch named "${opts.newBranchName}"`
      : `suggest an appropriate branch name based on this task, wait for my confirmation, and then create and switch to that branch`;

    prompt += `. Before starting, do the following in order:`
      + ` First, check for uncommitted changes on the current branch — if any exist, ask me what to do with them (commit, stash, or discard) and act on my decision before continuing.`
      + ` Then, ${branchStep}.`;
  }
  return prompt;
}

/**
 * Send the task to a terminal according to the user's choices in the
 * run modal. For "use current" we just write into the active terminal.
 * For "new terminal" we pre-flight that the chosen CLI is actually
 * installed, then spawn a terminal, launch the CLI, and inject the
 * prompt once the CLI has had a moment to come up.
 *
 * Returns true on success, false if we aborted (e.g. CLI missing) so
 * the caller can decide whether to flip status / show "sent" toast.
 */
async function runTaskWithOptions(task, opts = {}) {
  const prompt = buildTaskPrompt(task, opts);

  if (!opts.useNewTerminal) {
    // Same text-then-Enter trick as the new-terminal flow: AI CLI input
    // boxes (Claude/Codex/Gemini) buffer text+\r in one chunk as paste
    // content, so the trailing \r ends up in the input instead of
    // submitting. Splitting the writes makes submit reliable.
    if (typeof window.terminalSendPromptThenEnter === 'function') {
      window.terminalSendPromptThenEnter(prompt);
      return true;
    }
    if (typeof window.terminalSendCommand === 'function') {
      window.terminalSendCommand(prompt);
      return true;
    }
    console.error('Terminal sendCommand not available');
    return false;
  }

  if (typeof window.terminalCreateAndStart !== 'function') {
    console.error('Terminal createAndStart not available');
    return false;
  }

  const projectPath = state.getProjectPath();

  // Pre-flight: confirm the chosen CLI is installed. Without this we'd
  // happily hand the user a "command not found" followed by the task
  // prompt sitting in a bare shell.
  let startCommand = null;
  if (opts.toolId) {
    let check;
    try {
      check = await ipcRenderer.invoke(IPC.CHECK_AI_TOOL_AVAILABLE, {
        toolId: opts.toolId,
        projectPath
      });
    } catch (err) {
      console.error('Failed to verify AI tool availability', err);
      showToast('Could not verify AI CLI availability', 'error');
      return false;
    }
    if (!check || !check.available) {
      const name = (check && check.name) || opts.toolId;
      showToast(`${name} CLI not found on your system`, 'error');
      return false;
    }
    startCommand = check.resolvedCommand;
  }

  const newTerminalId = await window.terminalCreateAndStart(projectPath, startCommand);
  if (!newTerminalId) return false;

  // Give the CLI a few seconds to boot before injecting the prompt.
  // window.terminalCreateAndStart already waits 1s before sending the
  // start command, so we add another 4s on top of that. Use the
  // text-then-Enter helper so the prompt actually submits — sending
  // text+\r in a single chunk often gets buffered as paste content by
  // AI CLI input boxes.
  setTimeout(() => {
    if (typeof window.terminalSendPromptThenEnter === 'function') {
      window.terminalSendPromptThenEnter(prompt, newTerminalId);
    } else if (typeof window.terminalSendCommand === 'function') {
      window.terminalSendCommand(prompt, newTerminalId);
    }
  }, 5000);
  return true;
}

/**
 * Mark Claude Code as running (called from external modules)
 */
function setClaudeRunning(running) {
  claudeCodeRunning = running;
}

/**
 * Check if Claude Code is marked as running
 */
function isClaudeRunning() {
  return claudeCodeRunning;
}

/**
 * Delete task — opens the shared confirm modal first; only dispatches the IPC
 * if the user explicitly confirms. Lazy-required to avoid a hard cycle if
 * load order ever shifts.
 */
function deleteTask(taskId) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const task = getFilteredTasks().find(t => t.id === taskId);
  const confirmModal = require('./taskConfirmModal');
  confirmModal.open({
    title: task ? task.title : null,
    onConfirm: () => {
      ipcRenderer.send(IPC.DELETE_TASK, { projectPath, taskId });
    }
  });
}

/**
 * Show add task modal
 */
function showAddTaskModal() {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const title = document.getElementById('task-modal-title');

  if (!modal || !form) return;

  title.textContent = 'Add Task';
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.taskId = '';

  modal.classList.add('visible');
  document.getElementById('task-title-input')?.focus();
}

/**
 * Show edit task modal
 */
function showEditTaskModal(taskId) {
  const task = getFilteredTasks().find(t => t.id === taskId);
  if (!task) return;

  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const title = document.getElementById('task-modal-title');

  if (!modal || !form) return;

  title.textContent = 'Edit Task';
  form.dataset.mode = 'edit';
  form.dataset.taskId = taskId;

  // Fill form with task data
  document.getElementById('task-title-input').value = task.title || '';
  document.getElementById('task-description-input').value = task.description || '';
  document.getElementById('task-priority-input').value = task.priority || 'medium';
  document.getElementById('task-category-input').value = task.category || 'feature';

  modal.classList.add('visible');
}

/**
 * Hide task modal
 */
function hideTaskModal() {
  const modal = document.getElementById('task-modal');
  if (modal) {
    modal.classList.remove('visible');
  }
}

/**
 * Handle task form submit
 */
function handleTaskFormSubmit(e) {
  e.preventDefault();

  const form = e.target;
  const mode = form.dataset.mode;
  const taskId = form.dataset.taskId;
  const projectPath = state.getProjectPath();

  if (!projectPath) return;

  const taskData = {
    title: document.getElementById('task-title-input').value.trim(),
    description: document.getElementById('task-description-input').value.trim(),
    priority: document.getElementById('task-priority-input').value,
    category: document.getElementById('task-category-input').value
  };

  if (!taskData.title) {
    alert('Task title is required');
    return;
  }

  if (mode === 'add') {
    ipcRenderer.send(IPC.ADD_TASK, { projectPath, task: taskData });
  } else if (mode === 'edit' && taskId) {
    ipcRenderer.send(IPC.UPDATE_TASK, {
      projectPath,
      taskId,
      updates: taskData
    });
  }

  hideTaskModal();
}

/**
 * Setup modal event listeners
 */
function setupModalListeners() {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const cancelBtn = document.getElementById('task-cancel-btn');
  const closeBtn = document.getElementById('task-modal-close');

  if (form) {
    form.addEventListener('submit', handleTaskFormSubmit);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideTaskModal);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideTaskModal);
  }

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideTaskModal();
      }
    });
  }

  // Close on Escape (capture phase so we beat any other Esc handlers — e.g.
  // the dashboard's — when the modal is the topmost layer).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal || !modal.classList.contains('visible')) return;
    e.stopPropagation();
    hideTaskModal();
  }, true);
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render a small attribution chip for tasks that came from a Frame spec.
 * `source` looks like `spec:<slug>:T<n>`. We surface just the slug since
 * that's the actionable identifier the user knows.
 */
function renderSourceChip(source) {
  if (!source || typeof source !== 'string') return '';
  const m = source.match(/^spec:([^:]+):/);
  if (!m) return '';
  const slug = escapeHtml(m[1]);
  return `<span class="task-source-chip" title="From spec: ${slug}">spec · ${slug}</span>`;
}

/**
 * Format date for display
 */
function formatDate(isoString) {
  if (!isoString) return '';

  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Initialize when DOM is ready
 */
function initWhenReady() {
  init();
  setupModalListeners();
}

module.exports = {
  init: initWhenReady,
  show,
  hide,
  toggle,
  loadTasks,
  isVisible: () => isVisible,
  setClaudeRunning,
  isClaudeRunning
};
