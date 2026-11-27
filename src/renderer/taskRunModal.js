/**
 * Task Run Modal
 *
 * Confirmation/configuration modal shown when the user clicks the play
 * button on a task. Running a task always opens a new Frame; the modal
 * lets them choose:
 *   - which AI CLI to launch
 *   - stay on current branch vs create a new branch (optional name) — only
 *     for a run in the main checkout: a workspace keeps its own branch
 *   - where it runs, when that is not simply where the user is
 *     (server-tasks): a task runs where its tasks.json lives, so a server
 *     task run from elsewhere picks one of its server's workspaces, and a
 *     Mac task runs in the main checkout while a server workspace is selected
 *
 * The caller passes `target` (shared/serverTasks.runTarget) and the chosen
 * `workspaceId` comes back with the options.
 *
 * Returns the chosen options to the caller via the `onRun` callback;
 * the caller is responsible for actually orchestrating the terminal
 * and prompt dispatch (see `tasksPanel.runTaskWithOptions`).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const aiToolSelector = require('./aiToolSelector');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');
const { runTargetNote } = require('../shared/serverTasks');

let modalEl = null;
let titleEl = null;
let cliOptionsEl = null;
let branchRadios = null;
let currentBranchEl = null;
let newBranchNameInput = null;
let runBtn = null;
let cancelBtn = null;
let whereEl = null;
let whereNoteEl = null;
let workspaceSelect = null;
let branchSectionEl = null;
let activeTarget = null;

let initialized = false;
let activeTask = null;
let activeOnRun = null;
let activeOnCancel = null;
let activeOnQueue = null;
let queueBtn = null;

function init() {
  if (initialized) return;
  modalEl = document.getElementById('task-run-modal');
  if (!modalEl) return;

  titleEl = document.getElementById('task-run-modal-task-title');
  cliOptionsEl = document.getElementById('task-run-cli-options');
  branchRadios = modalEl.querySelectorAll('input[name="task-run-branch"]');
  currentBranchEl = document.getElementById('task-run-current-branch');
  newBranchNameInput = document.getElementById('task-run-new-branch-name');
  runBtn = document.getElementById('task-run-confirm');
  cancelBtn = document.getElementById('task-run-cancel');
  queueBtn = document.getElementById('task-run-queue');
  whereEl = document.getElementById('task-run-where');
  whereNoteEl = document.getElementById('task-run-where-note');
  workspaceSelect = document.getElementById('task-run-workspace');
  branchSectionEl = document.getElementById('task-run-branch-section');

  // Toggle new-branch input enabled state based on branch choice
  branchRadios.forEach(r => r.addEventListener('change', updateBranchChoiceUI));

  cancelBtn.addEventListener('click', cancel);
  runBtn.addEventListener('click', confirm);
  if (queueBtn) queueBtn.addEventListener('click', queue);

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) cancel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalEl.classList.contains('visible')) return;
    e.stopPropagation();
    cancel();
  }, true);

  // Enter activates the focused button; anywhere else it cancels, so
  // launching a Frame always takes an explicit Run activation.
  modalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && modalEl.classList.contains('visible')) {
      // Don't hijack Enter while typing in the branch-name field
      if (e.target === newBranchNameInput) return;
      e.preventDefault();
      if (document.activeElement === runBtn) confirm();
      else if (queueBtn && document.activeElement === queueBtn) queue();
      else cancel();
    }
  });

  initialized = true;
}

function updateBranchChoiceUI() {
  const newBranch = getBranchChoice() === 'new';
  newBranchNameInput.disabled = !newBranch;
  if (newBranch) {
    requestAnimationFrame(() => newBranchNameInput.focus());
  }
}

function getBranchChoice() {
  const checked = Array.from(branchRadios).find(r => r.checked);
  return checked ? checked.value : 'current';
}

function getCliChoice() {
  const checked = cliOptionsEl.querySelector('input[name="task-run-cli"]:checked');
  return checked ? checked.value : null;
}

function populateCliOptions() {
  const tools = aiToolSelector.getAvailableTools() || {};
  const current = aiToolSelector.getCurrentTool();
  const currentId = current ? current.id : null;

  cliOptionsEl.innerHTML = '';
  Object.values(tools).forEach(tool => {
    const id = `task-run-cli-${tool.id}`;
    const isDefault = tool.id === currentId;
    const wrapper = document.createElement('label');
    wrapper.className = 'task-run-radio';
    wrapper.innerHTML = `
      <input type="radio" name="task-run-cli" id="${id}" value="${tool.id}">
      <span class="task-run-radio-label">
        <strong>${escapeHtml(tool.name)}</strong>
        ${isDefault ? '<span class="task-run-badge">Default</span>' : ''}
      </span>
    `;
    const input = wrapper.querySelector('input');
    if (isDefault) input.checked = true;
    cliOptionsEl.appendChild(wrapper);
  });

  // Fallback: if nothing matched (no current tool), check the first
  if (!cliOptionsEl.querySelector('input:checked')) {
    const first = cliOptionsEl.querySelector('input');
    if (first) first.checked = true;
  }
}

async function loadCurrentBranch() {
  currentBranchEl.textContent = 'current branch';
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath, { workspaceId: 'main' });
    if (!result || result.error || !result.currentBranch) return;
    currentBranchEl.textContent = result.currentBranch;
  } catch (err) {
    // Not a git repo or git unavailable — leave the placeholder.
  }
}

/**
 * Show where the task runs: the note, the workspace chooser, and the branch
 * choice only for a run in the main checkout. A blocking note disables Run.
 */
function renderWhere(task, target, selected) {
  const note = runTargetNote(target, task, selected);
  if (whereEl) whereEl.hidden = !note;
  if (whereNoteEl) whereNoteEl.textContent = note ? note.text : '';
  if (workspaceSelect) {
    const choose = target && Array.isArray(target.choose) ? target.choose : null;
    workspaceSelect.hidden = !choose;
    workspaceSelect.innerHTML = choose
      ? choose.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.branch || w.name || w.id)}${w.name && w.branch ? ` · ${escapeHtml(w.name)}` : ''}</option>`).join('')
      : '';
  }
  // A workspace keeps its own branch: the choice is for the main checkout only.
  const inMain = !target || target.workspaceId === 'main';
  if (branchSectionEl) branchSectionEl.hidden = !inMain;
  if (runBtn) runBtn.disabled = !!(note && note.blocking);
}

/**
 * Open the modal for a given task.
 * @param {object} task
 * @param {object} opts
 * @param {function} opts.onRun     - called with chosen options on confirm
 * @param {function} [opts.onCancel]
 * @param {function} [opts.onQueue] - shows "Add to queue"; called instead of onRun
 * @param {object}   [opts.target]  - shared/serverTasks.runTarget's answer; absent = run where the user is
 * @param {object}   [opts.selected] - the selected workspace record, for the note's host
 */
function open(task, opts = {}) {
  if (!initialized) init();
  if (!modalEl) return;

  activeTask = task;
  activeOnRun = typeof opts.onRun === 'function' ? opts.onRun : null;
  activeOnCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;
  activeOnQueue = typeof opts.onQueue === 'function' ? opts.onQueue : null;
  activeTarget = opts.target || null;
  // "Add to queue" is offered only when the caller can queue (work-queue).
  if (queueBtn) queueBtn.hidden = !activeOnQueue;

  if (titleEl) {
    titleEl.textContent = task && task.title ? task.title : '';
  }

  // Reset to defaults
  Array.from(branchRadios).forEach(r => { r.checked = r.value === 'current'; });
  newBranchNameInput.value = '';
  newBranchNameInput.disabled = true;

  populateCliOptions();
  loadCurrentBranch();
  renderWhere(task, activeTarget, opts.selected || null);

  modalEl.classList.add('visible');
  // Focus Cancel so a blind Enter is safe; running requires Tab/click.
  requestAnimationFrame(() => cancelBtn && cancelBtn.focus());
}

function close() {
  if (!modalEl) return;
  modalEl.classList.remove('visible');
  activeTask = null;
  activeOnRun = null;
  activeOnCancel = null;
  activeOnQueue = null;
  activeTarget = null;
}

function confirm() {
  if (runBtn && runBtn.disabled) return;
  const target = activeTarget;
  const inMain = !target || target.workspaceId === 'main';
  const options = {
    toolId: getCliChoice(),
    // A workspace keeps its own branch (Frame never switches it).
    branchMode: inMain ? getBranchChoice() : 'current',
    newBranchName: inMain ? (newBranchNameInput.value.trim() || null) : null,
    workspaceId: target
      ? (Array.isArray(target.choose) ? (workspaceSelect && workspaceSelect.value) || null : target.workspaceId || null)
      : null
  };
  const cb = activeOnRun;
  close();
  if (cb) cb(options);
}

/** Queue the task instead of running it: no terminal opens (work-queue S2). */
function queue() {
  const cb = activeOnQueue;
  close();
  if (cb) cb();
}

function cancel() {
  const cb = activeOnCancel;
  close();
  if (cb) cb();
}

module.exports = {
  init,
  open
};
