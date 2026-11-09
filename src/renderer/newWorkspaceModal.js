/**
 * New Workspace Modal (workspaces spec, T08).
 *
 * Asks little, the way Conductor does: where the work starts (a new branch
 * off a base, or an existing branch), which base, which AI tool, and an
 * optional first prompt. Enter creates.
 *
 * After main has created the worktree, the workspace is selected and:
 *   - with a setup script: a "setup" terminal runs it in the worktree; when
 *     that terminal's foreground job returns to the shell (laneStatus
 *     running → idle), the AI terminal opens — so the agent starts with
 *     dependencies installed;
 *   - without one: the AI terminal opens directly.
 * The setup tab stays open for reading and rerunning.
 *
 * `runSetupThenAgent` is also used after a restore (the folder, and so its
 * dependencies, came back empty).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const notify = require('./notify');
const laneStatus = require('./laneStatus');
const { escapeHtml } = require('./htmlUtils');

const SETUP_TERMINAL_NAME = 'setup';
const SETTLE_MS = 800;              // a fresh shell's beat before typing (agentDispatch does the same)
const SETUP_START_GRACE_MS = 5000;  // a setup that never shows as running is treated as done

let modalEl = null;
let busy = false;
let defaultBase = null;
let branchNames = { local: [], remote: [] };

function init() {
  modalEl = document.getElementById('new-workspace-modal');
  if (!modalEl) {
    console.error('newWorkspaceModal: #new-workspace-modal not found');
    return;
  }
  modalEl.addEventListener('mousedown', (e) => { if (e.target === modalEl) close(); });
  modalEl.querySelector('#nw-cancel').addEventListener('click', close);
  modalEl.querySelector('#nw-create').addEventListener('click', submit);
  modalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    // Enter creates — except inside the prompt, where it is a newline unless ⌘/Ctrl is held.
    if (e.key === 'Enter' && (e.target.id !== 'nw-prompt' || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  });
  modalEl.querySelectorAll('input[name="nw-from"]').forEach((r) => r.addEventListener('change', syncFrom));
}

function multiTerminalUI() {
  return require('./terminal').getMultiTerminalUI();
}

function toolOptionsHtml() {
  const aiToolSelector = require('./aiToolSelector');
  const tools = aiToolSelector.getAvailableTools() || {};
  const current = aiToolSelector.getCurrentTool();
  const ids = Object.keys(tools);
  if (!ids.length) return '<option value="">No AI CLI configured</option>';
  return ids.map((id) => {
    const t = tools[id];
    return `<option value="${escapeHtml(id)}"${current && current.id === id ? ' selected' : ''}>${escapeHtml(t.name || id)}</option>`;
  }).join('');
}

function syncFrom() {
  const from = modalEl.querySelector('input[name="nw-from"]:checked').value;
  const baseRow = modalEl.querySelector('#nw-base-row');
  const branchRow = modalEl.querySelector('#nw-branch-row');
  baseRow.hidden = from !== 'new';
  branchRow.hidden = from !== 'branch';
  (from === 'new' ? modalEl.querySelector('#nw-base') : modalEl.querySelector('#nw-branch')).focus();
}

async function open() {
  if (!modalEl || busy) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    notify.error('Open a project first');
    return;
  }
  modalEl.querySelector('#nw-tool').innerHTML = toolOptionsHtml();
  modalEl.querySelector('#nw-prompt').value = '';
  modalEl.querySelector('#nw-branch').value = '';
  modalEl.querySelector('input[name="nw-from"][value="new"]').checked = true;
  modalEl.querySelector('#nw-error').textContent = '';
  setBusy(false);
  modalEl.classList.add('visible');
  syncFrom();

  const [def, branches] = await Promise.all([
    ipcRenderer.invoke(IPC.GIT_DEFAULT_BRANCH, projectPath).catch(() => null),
    ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath).catch(() => null)
  ]);
  if (state.getProjectPath() !== projectPath) return;
  defaultBase = def && def.branch ? def.branch : null;
  const all = (branches && branches.branches) || [];
  branchNames = {
    local: all.filter((b) => !b.isRemote).map((b) => b.name),
    remote: all.filter((b) => b.isRemote && b.shortName).map((b) => b.shortName)
  };
  const baseInput = modalEl.querySelector('#nw-base');
  if (!baseInput.value || baseInput.dataset.project !== projectPath) baseInput.value = defaultBase || '';
  baseInput.dataset.project = projectPath;
  const names = [...new Set([...branchNames.local, ...branchNames.remote])].sort();
  modalEl.querySelector('#nw-branches').innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
}

function close() {
  if (!modalEl || busy) return;
  modalEl.classList.remove('visible');
}

function setBusy(on) {
  busy = on;
  modalEl.querySelector('#nw-create').disabled = on;
  modalEl.querySelector('#nw-create').textContent = on ? 'Creating…' : 'Create';
}

async function submit() {
  if (busy) return;
  const projectPath = state.getProjectPath();
  const from = modalEl.querySelector('input[name="nw-from"]:checked').value;
  const base = modalEl.querySelector('#nw-base').value.trim();
  const branch = modalEl.querySelector('#nw-branch').value.trim();
  const toolId = modalEl.querySelector('#nw-tool').value || null;
  const prompt = modalEl.querySelector('#nw-prompt').value.trim();
  const errorEl = modalEl.querySelector('#nw-error');
  errorEl.textContent = '';
  if (from === 'branch' && !branch) {
    errorEl.textContent = 'Choose the branch to open.';
    return;
  }

  setBusy(true);
  let result;
  try {
    result = await ipcRenderer.invoke(IPC.WORKSPACE_CREATE, {
      projectPath,
      from,
      base: from === 'new' ? (base || undefined) : undefined,
      branch: from === 'branch' ? branch : undefined
    });
  } catch (err) {
    result = { error: err.message };
  }
  setBusy(false);
  if (!result || result.error) {
    errorEl.textContent = (result && result.error) || 'Could not create the workspace.';
    return;
  }

  modalEl.classList.remove('visible');
  if (result.fetch && !result.fetch.skipped && !result.fetch.fetched) {
    notify.info(`Couldn't fetch origin/${result.workspace.base} — started from the local copy.`);
  }

  const section = require('./workspaceSection');
  await section.load();
  section.select(result.workspace);
  runSetupThenAgent({ setupScript: result.setupScript, toolId, prompt });
}

/** Resolve when `terminalId` has run something and come back to its shell prompt. */
function waitForSetupToFinish(terminalId) {
  return new Promise((resolve) => {
    let sawRunning = false;
    let done = false;
    let unsubscribe = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (unsubscribe) unsubscribe();
      resolve();
    };
    const check = () => {
      const s = laneStatus.getStatus(terminalId);
      if (!multiTerminalUI().getManager().getTerminal(terminalId)) return finish(); // closed
      if (s.status === 'running' || s.agentName) sawRunning = true;
      else if (sawRunning && s.status === 'idle') finish();
    };
    unsubscribe = laneStatus.onChange((id) => { if (id === terminalId && !done) check(); });
    // A script so quick it never registers as running still lets the agent start.
    setTimeout(() => { if (!sawRunning) finish(); }, SETUP_START_GRACE_MS);
  });
}

/**
 * In the selected workspace: run the setup script (if any) in a "setup"
 * terminal, then open the AI terminal with `toolId` and, when given, `prompt`.
 */
async function runSetupThenAgent({ setupScript, toolId = null, prompt = '', openAgent: withAgent = true } = {}) {
  const ui = multiTerminalUI();
  if (!ui) return;
  const manager = ui.getManager();
  const script = (setupScript || '').trim();

  if (script) {
    let setupId = null;
    try {
      setupId = await manager.createTerminal({});
      if (setupId) manager.renameTerminal(setupId, SETUP_TERMINAL_NAME);
    } catch (err) {
      console.error('newWorkspaceModal: setup terminal failed', err);
    }
    if (setupId) {
      ui.enterLane(setupId);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      ui.sendCommand(script, setupId);
      await waitForSetupToFinish(setupId);
    } else {
      notify.error('Could not open a terminal for the setup script.');
    }
  }
  if (withAgent) await openAgent({ toolId, prompt });
}

async function openAgent({ toolId, prompt }) {
  const agentDispatch = require('./agentDispatch');
  if (prompt) {
    await agentDispatch.dispatch({ createNew: true, toolId, prompt });
    return;
  }
  const ui = multiTerminalUI();
  const aiToolSelector = require('./aiToolSelector');
  const tools = aiToolSelector.getAvailableTools() || {};
  const tool = (toolId && tools[toolId]) || aiToolSelector.getCurrentTool();
  if (!tool || !tool.command) return;
  let id = null;
  try {
    id = await ui.getManager().createTerminal({});
  } catch (err) {
    console.error('newWorkspaceModal: agent terminal failed', err);
  }
  if (!id) {
    notify.error('Could not open a terminal for the agent — the workspace may be at its terminal limit.');
    return;
  }
  ui.enterLane(id);
  setTimeout(() => ui.sendCommand(tool.command, id), SETTLE_MS);
}

module.exports = { init, open, close, runSetupThenAgent };
