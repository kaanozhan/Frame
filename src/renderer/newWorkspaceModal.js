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
const { enterSubmits } = require('./modalKeys');
const { scopeGuard } = require('./scopeGuard');
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
    // Enter creates from a field — a focused button (Cancel) handles Enter
    // itself, and the prompt takes a newline unless ⌘/Ctrl is held (R1).
    if (e.key === 'Enter' && enterSubmits(e.target, e)) {
      e.preventDefault();
      submit();
    }
  });
  modalEl.querySelectorAll('input[name="nw-from"]').forEach((r) => r.addEventListener('change', syncFrom));
  // An existing branch gets a real base too (workspace-hardening L4): prefill
  // it from the branch's upstream, else the default branch, until the user
  // types their own.
  modalEl.querySelector('#nw-branch').addEventListener('change', prefillBaseForBranch);
  modalEl.querySelector('#nw-base').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
}

async function prefillBaseForBranch() {
  const projectPath = state.getProjectPath();
  const branch = modalEl.querySelector('#nw-branch').value.trim();
  const baseInput = modalEl.querySelector('#nw-base');
  if (!projectPath || !branch || baseInput.dataset.touched) return;
  const res = await ipcRenderer.invoke(IPC.WORKSPACE_BASE_FOR_BRANCH, { projectPath, branch }).catch(() => null);
  if (state.getProjectPath() !== projectPath || modalEl.querySelector('#nw-branch').value.trim() !== branch) return;
  if (!baseInput.dataset.touched && res && res.base) baseInput.value = res.base;
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
  baseRow.hidden = false;
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
  delete modalEl.querySelector('#nw-base').dataset.touched;
  modalEl.querySelector('input[name="nw-from"][value="new"]').checked = true;
  modalEl.querySelector('#nw-error').textContent = '';
  syncLocation();
  setBusy(false);
  modalEl.classList.add('visible');
  syncFrom();

  const [def, branches] = await Promise.all([
    ipcRenderer.invoke(IPC.GIT_DEFAULT_BRANCH, projectPath).catch(() => null),
    ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath, { workspaceId: 'main' }).catch(() => null)
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

/**
 * Location (server-workspaces): "This Mac", or the server Frame is
 * connected to. Shown once a server has been used; the server option is
 * disabled while the link is down.
 */
function syncLocation() {
  const row = modalEl.querySelector('#nw-location-row');
  const sel = modalEl.querySelector('#nw-location');
  const hint = modalEl.querySelector('#nw-location-hint');
  const s = require('./serverConnect').getStatus();
  const host = s.host || (s.saved && s.saved.host);
  row.hidden = !host;
  if (!host) { sel.innerHTML = '<option value="local">This Mac</option>'; return; }
  const up = s.state === 'connected';
  const keep = sel.value === 'server' && up ? 'server' : 'local';
  sel.innerHTML = `<option value="local">This Mac</option><option value="server"${up ? '' : ' disabled'}>Server · ${escapeHtml(host)}${up ? '' : ' (not connected)'}</option>`;
  sel.value = keep;
  const paint = () => {
    hint.textContent = sel.value === 'server'
      ? 'Cloned from the remote on the server; terminals and agents run there and keep running while this Mac is away.'
      : '';
  };
  sel.onchange = paint;
  paint();
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
      location: modalEl.querySelector('#nw-location').value || 'local',
      from,
      base: base || undefined,
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
  if (result.sent) {
    // The project went to the server as a git bundle (server-onboarding):
    // committed history only — say what stayed here.
    const n = Number(result.sent.uncommitted) || 0;
    notify.info(`Sent this project's committed history to the server.${n ? ` ${n} uncommitted change${n === 1 ? '' : 's'} stayed on this Mac — commit and push them to use them there.` : ''}`);
  }

  const section = require('./workspaceSection');
  await section.load();
  // The user may have switched project while the create ran (R6): the new
  // workspace is listed there; nothing is selected or started here.
  if (state.getProjectPath() !== projectPath) {
    notify.info(`Workspace "${result.workspace.name}" was created in ${projectPath.split('/').pop()}.`);
    return;
  }
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
  // Everything here belongs to the workspace selected now — the new (or
  // restored) one — even if the user selects another while the setup script
  // runs (R3). Its terminals are created for it explicitly, and the view only
  // follows them while it is still selected.
  const guard = scopeGuard(state.currentScope(), state.currentScope);
  const target = { projectPath: guard.projectPath, workspaceId: guard.workspaceId, cwd: state.getWorkspaceRoot() };

  if (script) {
    let setupId = null;
    try {
      setupId = await manager.createTerminal({ ...target });
      if (setupId) manager.renameTerminal(setupId, SETUP_TERMINAL_NAME);
    } catch (err) {
      console.error('newWorkspaceModal: setup terminal failed', err);
    }
    if (setupId) {
      if (guard.still()) ui.enterLane(setupId);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      if (guard.still()) ui.sendCommand(script, setupId);
      else manager.sendCommand(script, setupId);
      await waitForSetupToFinish(setupId);
    } else {
      notify.error('Could not open a terminal for the setup script.');
    }
  }
  if (!withAgent) return;
  if (!guard.sameProject()) return; // another project now: the agent is not started anywhere
  await openAgent({ toolId, prompt, target, enter: guard.still() });
}

async function openAgent({ toolId, prompt, target, enter = true }) {
  const ui = multiTerminalUI();
  const aiToolSelector = require('./aiToolSelector');
  const tools = aiToolSelector.getAvailableTools() || {};
  const tool = (toolId && tools[toolId]) || aiToolSelector.getCurrentTool();
  if (!prompt && (!tool || !tool.command)) return;
  let id = null;
  try {
    id = await ui.getManager().createTerminal({ ...target });
  } catch (err) {
    console.error('newWorkspaceModal: agent terminal failed', err);
  }
  if (!id) {
    notify.error('Could not open a terminal for the agent — the workspace may be at its terminal limit.');
    return;
  }
  if (prompt) {
    await require('./agentDispatch').dispatch({ terminalId: id, toolId, prompt, enter });
    return;
  }
  if (enter) ui.enterLane(id);
  setTimeout(() => (enter ? ui.sendCommand(tool.command, id) : ui.getManager().sendCommand(tool.command, id)), SETTLE_MS);
}

module.exports = { init, open, close, runSetupThenAgent };
