/**
 * Agent Dispatch Module
 *
 * The single door for "deliver this prompt to an agent in a lane". Task runs
 * and spec command runs both go through dispatch() instead of carrying their
 * own terminal-targeting and timeout logic:
 *
 *   - Target an existing lane, or create a new Frame (per-project cap
 *     respected — hitting it surfaces an error toast, never a silent fail).
 *   - If no agent is detected in the lane, pre-flight the chosen CLI
 *     (CHECK_AI_TOOL_AVAILABLE), start it, and wait for the agent-ready
 *     signal before injecting. The prompt is never typed into a bare shell.
 *   - Injection reuses window.terminalSendPromptThenEnter (text-then-Enter
 *     split) — dispatch wraps the existing mechanics, it does not reinvent
 *     them.
 *
 * Initialized from MultiTerminalUI._setup() with the MultiTerminalUI
 * instance (same idiom as laneStatus.init), so no module here ever
 * requires terminal.js.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const state = require('./state');

let multiTerminalUI = null;

/**
 * Initialize with the MultiTerminalUI instance.
 */
function init(ui) {
  multiTerminalUI = ui;

  // Spec-lane activity feed for the spec surfaces (next-action bars).
  // Derived state only: every signal re-computes getSpecLaneInfo from the
  // live laneStatus + open-terminal set, so a crashed agent or a closed
  // Frame can never leave a stale "busy" hanging — there is no stored
  // busy flag to forget to clear.
  laneStatus.onChange((terminalId) => {
    for (const [slug, laneId] of specLanes) {
      if (laneId === terminalId) _notifySpecLane(slug);
    }
    const instance = multiTerminalUI.getManager().getTerminal(terminalId);
    const a = instance && instance.state.assignment;
    if (a && a.kind === 'task') _notifyTaskLane(a.ref);
  });
  ipcRenderer.on(IPC.TERMINAL_DESTROYED, (event, { terminalId }) => {
    for (const [slug, laneId] of specLanes) {
      if (laneId === terminalId) _notifySpecLane(slug);
    }
    // The terminal (and its assignment) is already gone, so the task it
    // carried can't be looked up — broadcast a wildcard re-render instead.
    _notifyTaskLane(null);
  });
}

/**
 * Deliver a prompt to an agent in a lane.
 *
 * @param {object} opts
 * @param {string|null} [opts.terminalId]  - existing lane to target
 * @param {boolean}     [opts.createNew]   - create a new Frame instead
 * @param {string|null} [opts.toolId]      - AI CLI to start if none is
 *                                           running (default: current tool)
 * @param {string}      opts.prompt        - text to inject when ready
 * @param {object|null} [opts.assignment]  - { kind: 'task'|'spec', label, ref }
 * @returns {Promise<{success: boolean, terminalId: string|null, error: string|null}>}
 */
async function dispatch({ terminalId = null, createNew = false, toolId = null, prompt, assignment = null } = {}) {
  if (!multiTerminalUI) {
    return _fail(null, 'Terminal system is not ready yet');
  }
  if (!prompt) {
    return _fail(null, 'Nothing to dispatch — empty prompt');
  }

  // ── Resolve the target lane ──────────────────────────────
  let targetId = terminalId;
  if (createNew) {
    try {
      targetId = await multiTerminalUI.createTerminalForCurrentProject();
    } catch (err) {
      console.error('agentDispatch: terminal creation failed', err);
      targetId = null;
    }
    if (!targetId) {
      const max = multiTerminalUI.getManager().maxTerminals;
      return _fail(null, `Could not create a new Frame — maximum (${max}) may be reached for this project`);
    }
  } else {
    if (!targetId || !multiTerminalUI.getManager().getTerminal(targetId)) {
      return _fail(null, 'Target Frame is no longer open');
    }
  }

  // Land the user inside the Frame so they watch the dispatch arrive
  multiTerminalUI.enterLane(targetId);

  // ── Ensure an agent is running there ─────────────────────
  const { agentName } = laneStatus.getStatus(targetId);
  if (!agentName) {
    // Lazy-required to avoid load-order coupling with the sidebar wiring.
    const aiToolSelector = require('./aiToolSelector');
    const currentTool = aiToolSelector.getCurrentTool();
    const chosenToolId = toolId || (currentTool ? currentTool.id : null);
    if (!chosenToolId) {
      return _fail(targetId, 'No AI CLI selected');
    }

    // Pre-flight: confirm the CLI is installed before sending anything —
    // otherwise the lane shows "command not found" and the prompt is lost.
    let check;
    try {
      check = await ipcRenderer.invoke(IPC.CHECK_AI_TOOL_AVAILABLE, {
        toolId: chosenToolId,
        projectPath: state.getProjectPath()
      });
    } catch (err) {
      console.error('agentDispatch: CLI availability check failed', err);
      return _fail(targetId, 'Could not verify AI CLI availability');
    }
    if (!check || !check.available) {
      const name = (check && check.name) || chosenToolId;
      return _fail(targetId, `${name} CLI not found on your system`);
    }

    // Subscribe before sending the start command — a fast CLI could reach
    // its input box between "send" and "listen" and we'd miss the event.
    const readyPromise = _waitForAgentReady(targetId);
    multiTerminalUI.sendCommand(check.resolvedCommand, targetId);

    const ready = await readyPromise;
    if (!ready) {
      return _fail(targetId, `${check.name || chosenToolId} didn't become ready — prompt not sent`);
    }
  }

  // ── Inject ───────────────────────────────────────────────
  if (typeof window.terminalSendPromptThenEnter !== 'function') {
    return _fail(targetId, 'Terminal input bridge not available');
  }
  window.terminalSendPromptThenEnter(prompt, targetId);

  // Label the lane with what it's now working on — most recent dispatch
  // wins. Failed dispatches above never relabel.
  if (assignment) {
    multiTerminalUI.getManager().setAssignment(targetId, assignment);
  }

  return { success: true, terminalId: targetId, error: null };
}

// ─── Spec lane assignments ──────────────────────────────────
//
// Which lane each spec (slug) is working in. Functional state, kept
// separate from the presentation label on terminal state: a later task
// dispatch may overwrite a lane's label while the spec assignment must
// survive. Session-scoped — persistence across restarts is out of scope.

const specLanes = new Map(); // Map<slug, terminalId>

/**
 * Run a spec command in the spec's assigned lane — or a new Frame.
 *
 * First run (or assigned lane closed): creates a new Frame, no question.
 * Assigned lane alive: always asks "Continue in <Frame> / Open a new
 * Frame". Prompt staging is unchanged: BUILD_SPEC_COMMAND_FILE writes the
 * full prompt under .frame/runtime/prompts/ and we dispatch the short
 * read-this-file instruction it returns.
 *
 * @param {object} opts
 * @param {string} opts.slug     - spec slug
 * @param {string} [opts.title]  - spec title (modal copy only)
 * @param {string} opts.command  - e.g. 'spec.plan', 'spec.implement'
 * @returns {Promise<{success: boolean, terminalId: string|null, error: string|null}>}
 */
async function dispatchSpecCommand({ slug, title = null, command } = {}) {
  if (!multiTerminalUI) {
    return _fail(null, 'Terminal system is not ready yet');
  }
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    return _fail(null, 'Open a project first');
  }

  let staged;
  try {
    staged = await ipcRenderer.invoke(IPC.BUILD_SPEC_COMMAND_FILE, {
      projectPath,
      slug,
      command,
      aiTool: 'claude-code'
    });
  } catch (err) {
    console.error('agentDispatch: prompt staging failed', err);
    staged = null;
  }
  if (!staged || !staged.success) {
    return _fail(null, 'Could not stage prompt: ' + ((staged && staged.error) || 'unknown error'));
  }

  const assignment = { kind: 'spec', label: `spec: ${slug}`, ref: slug };
  const assignedId = _assignedLane(slug);

  let result;
  if (!assignedId) {
    result = await dispatch({ createNew: true, prompt: staged.instruction, assignment });
  } else {
    const choice = await _askContinueOrNew(_laneName(assignedId), title || slug);
    if (choice === 'cancel') {
      return { success: false, terminalId: null, error: null };
    }
    result = await dispatch({
      terminalId: choice === 'continue' ? assignedId : null,
      createNew: choice !== 'continue',
      prompt: staged.instruction,
      assignment
    });
  }

  if (result.success) {
    // New-Frame runs re-assign; the old lane is simply unassigned, not closed
    specLanes.set(slug, result.terminalId);
    _notifySpecLane(slug);
  }
  return result;
}

/**
 * Live info about the lane a spec is assigned to, or null when unassigned
 * (including: the lane was closed). Computed fresh on every call — never
 * cached.
 *
 * `busy` is true only while a *live* agent process owns the lane and is
 * working or blocked on an approval. The live-process requirement
 * (agentName) is the anti-stuck guard: a dead agent whose TUI remnants
 * still fool the buffer-tail classifier has no foreground process, so
 * busy drops to false and any disabled UI re-enables. All ambiguous
 * states fail open on purpose.
 */
function getSpecLaneInfo(slug) {
  const id = _assignedLane(slug);
  if (!id) return null;
  const s = laneStatus.getStatus(id);
  return {
    terminalId: id,
    name: _laneName(id),
    status: s.status,
    agentName: s.agentName,
    busy: !!s.agentName && (s.status === 'agent-working' || s.status === 'agent-approval')
  };
}

/**
 * Live info about the lane working on a task, or null. Unlike specs there
 * is no assignment map — the lane's own assignment metadata is the source,
 * so this scans open terminals. Same anti-stuck contract as specs: `busy`
 * requires a live agent process.
 */
function getTaskLaneInfo(taskId) {
  if (!multiTerminalUI || taskId == null) return null;
  const lane = multiTerminalUI.getManager().getTerminalStates(true)
    .find(t => t.assignment && t.assignment.kind === 'task' && t.assignment.ref === taskId);
  if (!lane) return null;
  const s = laneStatus.getStatus(lane.id);
  return {
    terminalId: lane.id,
    name: lane.customName || lane.name,
    status: s.status,
    agentName: s.agentName,
    busy: !!s.agentName && (s.status === 'agent-working' || s.status === 'agent-approval')
  };
}

/**
 * Activity dot for spec/task rows and detail headers: pulsing while the
 * assigned lane's agent works (fast red pulse on approval), steady while
 * it waits at the input box; empty string when no live agent is on it.
 * Presentation helpers kept here so all surfaces share one mapping.
 */
function specStatusDotHtml(slug) {
  return _activityDotHtml(getSpecLaneInfo(slug));
}

function taskStatusDotHtml(taskId) {
  return _activityDotHtml(getTaskLaneInfo(taskId));
}

function _activityDotHtml(info) {
  if (!info || !info.agentName) return '';
  const flavor = info.status === 'agent-working' ? 'working'
    : info.status === 'agent-approval' ? 'approval'
    : 'input';
  const label = info.status === 'agent-working' ? 'Agent working'
    : info.status === 'agent-approval' ? 'Needs approval'
    : 'Awaiting input';
  return `<span class="spec-activity-dot ${flavor}" title="${_escapeHtml(label)} · ${_escapeHtml(info.name)}"></span>`;
}

/**
 * Subscribe to spec-lane activity. Callback: (slug) — consumers re-read
 * getSpecLaneInfo(slug). Only fires when the derived info materially
 * changes (status / lane lost), not on every PTY poll.
 * Returns an unsubscribe function.
 */
function onSpecLaneActivity(callback) {
  specLaneListeners.add(callback);
  return () => specLaneListeners.delete(callback);
}

const specLaneListeners = new Set();
const lastSpecLaneKey = new Map(); // Map<slug, string> — change gate

function _notifySpecLane(slug) {
  const info = getSpecLaneInfo(slug);
  const key = info ? `${info.terminalId}|${info.status}|${info.busy}` : 'none';
  if (lastSpecLaneKey.get(slug) === key) return;
  lastSpecLaneKey.set(slug, key);
  for (const cb of specLaneListeners) {
    try {
      cb(slug);
    } catch (err) {
      console.error('agentDispatch spec-lane listener failed:', err);
    }
  }
}

/**
 * Subscribe to task-lane activity. Callback: (taskId|null) — null means
 * "a lane disappeared, re-render task lists" (the closed terminal's
 * assignment can no longer be read). Gated like the spec feed.
 * Returns an unsubscribe function.
 */
function onTaskLaneActivity(callback) {
  taskLaneListeners.add(callback);
  return () => taskLaneListeners.delete(callback);
}

const taskLaneListeners = new Set();
const lastTaskLaneKey = new Map(); // Map<taskId, string> — change gate

function _notifyTaskLane(taskId) {
  if (taskId != null) {
    const info = getTaskLaneInfo(taskId);
    const key = info ? `${info.terminalId}|${info.status}|${info.busy}` : 'none';
    if (lastTaskLaneKey.get(taskId) === key) return;
    lastTaskLaneKey.set(taskId, key);
  }
  for (const cb of taskLaneListeners) {
    try {
      cb(taskId);
    } catch (err) {
      console.error('agentDispatch task-lane listener failed:', err);
    }
  }
}

// Assigned lane for a slug, validated against open terminals — a closed
// lane means the spec is unassigned again.
function _assignedLane(slug) {
  const id = specLanes.get(slug);
  if (!id) return null;
  if (!multiTerminalUI.getManager().getTerminal(id)) {
    specLanes.delete(slug);
    return null;
  }
  return id;
}

function _laneName(terminalId) {
  const instance = multiTerminalUI.getManager().getTerminal(terminalId);
  const s = instance && instance.state;
  return s ? (s.customName || s.name) : 'Frame';
}

// "Continue in <Frame> / Open a new Frame" — always asked when the spec
// already has a live lane. Same overlay idiom as specPanel's modals.
// Resolves 'continue' | 'new' | 'cancel'; continue is the default action.
function _askContinueOrNew(frameName, specName) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'spec-modal-overlay';
    overlay.innerHTML = `
      <div class="spec-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-lane-title">
        <h3 id="dispatch-lane-title">Where should this run?</h3>
        <p><strong>${_escapeHtml(specName)}</strong> is already working in <strong>${_escapeHtml(frameName)}</strong>.</p>
        <div class="spec-modal-actions">
          <button type="button" class="btn btn-secondary dispatch-new-frame">Open a new Frame</button>
          <button type="button" class="btn btn-primary dispatch-continue">Continue in ${_escapeHtml(frameName)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const done = (choice) => {
      overlay.remove();
      resolve(choice);
    };
    overlay.querySelector('.dispatch-continue').addEventListener('click', () => done('continue'));
    overlay.querySelector('.dispatch-new-frame').addEventListener('click', () => done('new'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done('cancel');
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done('cancel');
    });
    setTimeout(() => overlay.querySelector('.dispatch-continue').focus(), 30);
  });
}

function _escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// How long a cold-started CLI gets to reach its input box before the
// dispatch aborts. Covers slow machines; a hung/failed launch fails loudly.
const AGENT_READY_TIMEOUT_MS = 15000;

// Cold-start readiness gate: resolves true once laneStatus sees a known
// agent in the foreground settled at its input box ('agent-input'), false
// on timeout. 'agent-approval' deliberately does NOT count — injecting
// into a permission dialog (e.g. Claude's trust-folder prompt) would feed
// the prompt to a y/n chooser, so those lanes time out instead.
function _waitForAgentReady(terminalId) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let unsubscribe = null;

    const finish = (ready) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve(ready);
    };

    const isReady = (s) => !!(s && s.agentName && s.status === 'agent-input');

    unsubscribe = laneStatus.onChange((id, payload) => {
      if (id !== terminalId) return;
      if (isReady(payload)) finish(true);
    });

    timer = setTimeout(() => finish(false), AGENT_READY_TIMEOUT_MS);

    // The lane may already be in the ready state (agent restarted by hand,
    // or a prior dispatch raced us) — don't wait for the next emission.
    if (isReady(laneStatus.getStatus(terminalId))) finish(true);
  });
}

// ─── Toasts ─────────────────────────────────────────────────
//
// Same markup/classes as the Tasks panel toast so the existing
// .tasks-toast styles apply; kept local to avoid a cross-module import
// for what is presentation-only.

function _fail(terminalId, message) {
  _showToast(message, 'error');
  return { success: false, terminalId, error: message };
}

function _showToast(message, type = 'info') {
  const existing = document.querySelector('.tasks-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `tasks-toast tasks-toast-${type}`;
  const icon = type === 'error'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  const visibleMs = type === 'error' ? 4000 : 2000;
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, visibleMs);
}

module.exports = {
  init,
  dispatch,
  dispatchSpecCommand,
  getSpecLaneInfo,
  getTaskLaneInfo,
  onSpecLaneActivity,
  onTaskLaneActivity,
  specStatusDotHtml,
  taskStatusDotHtml
};
