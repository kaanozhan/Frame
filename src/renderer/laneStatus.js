/**
 * Lane Status Module
 *
 * Per-terminal activity detection for the Lane Orchestrator. Two kinds of
 * lane, five statuses:
 *
 *   Standard terminal (shell in charge):
 *     - 'idle'           — shell at prompt, nothing running
 *     - 'running'        — a foreground process owns the terminal
 *                          (npm run dev, python server, ...), quiet or not
 *
 *   Agent terminal (claude / codex / gemini in the foreground):
 *     - 'agent-working'  — the agent is producing output / thinking
 *     - 'agent-approval' — blocked on a permission prompt (most urgent)
 *     - 'agent-input'    — turn finished, sitting at the input box
 *
 * Signals: a dedicated TERMINAL_OUTPUT_ID listener with a quiet timer
 * (output flow), the PTY's foreground process from ptyManager's poll
 * (running vs idle, agent identity), and buffer-tail pattern tables
 * (approval vs input, agent TUI fingerprints).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

// How long output must be quiet before we classify the buffer
const QUIET_MS = 1800;
// How many buffer lines (from the bottom) to inspect on classification
const SCAN_LINES = 15;
// While output streams, re-evaluate the flavor at most this often
const FLAVOR_CHECK_MS = 600;

// AI tools we recognize as agents — matched against the foreground
// process / command line. Single table, extend per tool.
const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini', 'aider']);

// Fingerprints of an agent TUI on screen — backup for when the foreground
// process name is inconclusive (e.g. agent running under a wrapper).
const AGENT_PATTERNS = [
  /╭─/,                 // Claude Code input box / dialog frame
  /│\s*>/,              // Claude Code prompt line inside the box
  /esc to interrupt/i,  // Claude Code while working
  /✻/,                  // Claude Code spinner/notice glyphs
  /⏺/                   // Claude Code tool-call bullet
];

// An agent is quiet AND one of these is on screen → it wants approval.
// Only evaluated in agent mode, so shell-prompt glyphs can't false-match.
const APPROVAL_PATTERNS = [
  /Do you want/i,        // Claude Code permission dialogs
  /\(y\/n\)/i,
  /❯\s*\d+\./,           // selected option in a numbered choice list
  /Esc to cancel/i
];

let manager = null;
// Map<terminalId, entry>
const entries = new Map();
const listeners = new Set();

/**
 * Initialize with the TerminalManager (needed to read xterm buffers).
 */
function init(terminalManager) {
  manager = terminalManager;

  ipcRenderer.on(IPC.TERMINAL_OUTPUT_ID, (event, { terminalId }) => {
    _onOutput(terminalId);
  });

  // Foreground process updates from ptyManager's poll. Tells a
  // quiet-but-running server from an idle prompt, and identifies agents.
  ipcRenderer.on(IPC.TERMINAL_PROCESS_DATA, (event, { terminalId, processName, shellName, commandLine }) => {
    const entry = _ensureEntry(terminalId);
    entry.foreground = processName;
    entry.shellName = shellName;
    entry.commandLine = commandLine || null;
    // Re-classify immediately when the lane is quiet (no pending timer) —
    // e.g. a server that started/stopped without fresh output.
    if (!entry.quietTimer) _classifyQuiet(terminalId);
    // Emit regardless of status change so labels showing the command
    // ("Running · npm run dev") refresh when the command itself changes.
    _emit(terminalId, entry);
  });

  ipcRenderer.on(IPC.TERMINAL_DESTROYED, (event, { terminalId }) => {
    remove(terminalId);
  });
}

/**
 * Subscribe to status changes. Returns an unsubscribe function.
 * Callback signature: (terminalId, statusEntry)
 */
function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Current status for a terminal.
 * Returns { status, lastActivityAt, foreground, commandLine, agentName }.
 */
function getStatus(terminalId) {
  const entry = entries.get(terminalId);
  if (!entry) {
    return { status: 'idle', lastActivityAt: null, foreground: null, commandLine: null, agentName: null };
  }
  const isShell = _isShellProcess(entry.foreground, entry.shellName);
  return {
    status: entry.status,
    lastActivityAt: entry.lastActivityAt,
    foreground: isShell ? null : entry.foreground,
    commandLine: isShell ? null : entry.commandLine,
    agentName: detectAgentName(entry.foreground, entry.commandLine)
  };
}

/**
 * Which known agent (if any) the foreground process / command line names.
 * Live data only — a failed launch or an exited agent leaves nothing.
 */
function detectAgentName(foreground, commandLine) {
  const tokens = [];
  if (foreground) tokens.push(foreground);
  if (commandLine) tokens.push(...commandLine.trim().split(/\s+/));
  for (const tok of tokens) {
    const base = tok.split('/').pop().toLowerCase().replace(/\.exe$/, '');
    if (KNOWN_AGENTS.has(base)) return base;
  }
  return null;
}

/**
 * Drop tracking for a closed terminal.
 */
function remove(terminalId) {
  const entry = entries.get(terminalId);
  if (entry && entry.quietTimer) {
    clearTimeout(entry.quietTimer);
  }
  entries.delete(terminalId);
}

// ─── Internals ──────────────────────────────────────────────

// Foreground names that mean "nothing is running" — the shell itself.
const SHELL_NAMES = new Set([
  'zsh', 'bash', 'fish', 'sh', 'dash', 'nu', 'nushell',
  'pwsh', 'powershell', 'cmd', 'login'
]);

function _isShellProcess(processName, shellName) {
  if (!processName) return true; // no info — assume idle prompt
  const norm = processName.toLowerCase().replace(/^-/, '').replace(/\.exe$/, '');
  if (shellName && norm === shellName.toLowerCase().replace(/\.exe$/, '')) return true;
  return SHELL_NAMES.has(norm);
}

function _ensureEntry(terminalId) {
  let entry = entries.get(terminalId);
  if (!entry) {
    entry = {
      status: 'idle', lastActivityAt: null, quietTimer: null,
      lastFlavorCheck: 0, foreground: null, shellName: null, commandLine: null
    };
    entries.set(terminalId, entry);
  }
  return entry;
}

// Agent mode: the foreground process is a known agent, or (fallback)
// the buffer tail carries an agent TUI fingerprint. The fingerprint
// fallback only applies while the foreground is inconclusive (agent under
// a wrapper process, or no process info yet): when the shell itself owns
// the terminal, anything agent-shaped still on screen is a killed agent's
// leftover TUI — without this, a killed agent reads "Awaiting input"
// until 15 fresh lines scroll the remnants away.
function _isAgentMode(entry, tail) {
  if (detectAgentName(entry.foreground, entry.commandLine)) return true;
  if (entry.foreground && _isShellProcess(entry.foreground, entry.shellName)) return false;
  return AGENT_PATTERNS.some((re) => re.test(tail));
}

function _onOutput(terminalId) {
  const entry = _ensureEntry(terminalId);

  const now = Date.now();
  entry.lastActivityAt = now;

  // Output is flowing — agent working or plain command running. The
  // buffer read is throttled; most chunks cost nothing.
  const wasActive = entry.status === 'agent-working' || entry.status === 'running';
  if (!wasActive || now - entry.lastFlavorCheck >= FLAVOR_CHECK_MS) {
    entry.lastFlavorCheck = now;
    const tail = _readBufferTail(terminalId);
    const next = _isAgentMode(entry, tail) ? 'agent-working' : 'running';
    if (entry.status !== next) {
      entry.status = next;
      _emit(terminalId, entry);
    }
  }

  if (entry.quietTimer) clearTimeout(entry.quietTimer);
  entry.quietTimer = setTimeout(() => _classifyQuiet(terminalId), QUIET_MS);
}

function _classifyQuiet(terminalId) {
  const entry = entries.get(terminalId);
  if (!entry) return;
  entry.quietTimer = null;

  const tail = _readBufferTail(terminalId);
  let next;
  if (_isAgentMode(entry, tail)) {
    // Quiet agent: blocked on a permission prompt, or done with its turn
    // and waiting at the input box. "Completed" and "fresh prompt" are
    // indistinguishable in the TUI — both read as awaiting input.
    next = APPROVAL_PATTERNS.some((re) => re.test(tail)) ? 'agent-approval' : 'agent-input';
  } else if (!_isShellProcess(entry.foreground, entry.shellName)) {
    // Quiet but a non-shell process owns the terminal — a server or
    // long-running command that just isn't printing right now.
    next = 'running';
  } else {
    next = 'idle';
  }

  if (entry.status !== next) {
    entry.status = next;
    _emit(terminalId, entry);
  }
}

function _readBufferTail(terminalId) {
  if (!manager) return '';
  const instance = manager.getTerminal(terminalId);
  if (!instance) return '';

  try {
    const buf = instance.terminal.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const start = Math.max(0, end - SCAN_LINES);
    const lines = [];
    for (let y = start; y <= end; y++) {
      const line = buf.getLine(y);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n');
  } catch (err) {
    return '';
  }
}

function _emit(terminalId, entry) {
  const payload = getStatus(terminalId);
  for (const cb of listeners) {
    try {
      cb(terminalId, payload);
    } catch (err) {
      console.error('laneStatus listener failed:', err);
    }
  }
}

module.exports = {
  init, onChange, getStatus, remove, detectAgentName,
  KNOWN_AGENTS, AGENT_PATTERNS, APPROVAL_PATTERNS
};
