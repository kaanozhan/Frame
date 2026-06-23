// Supervisor tail reader (main) — Phase C live PTY-backed log stream.
//
// Spawns a `tail -F` PTY for a single task and forwards its output to the
// renderer (which mounts xterm.js — see liveOutputPane.js). Uses node-pty
// directly (Frame's existing ptyManager.createTerminal always spawns a
// shell, which would re-execute every output line through the prompt).
//
// Log path resolution per spec §4.3:
//   1) If <root>/run-state/<task-id>.log exists, tail that.
//   2) Else fall back to `tail -F audit.jsonl | grep --line-buffered <task-id>`,
//      because the current supervisor doesn't write per-task logs — its
//      worker streams via subprocess.PIPE straight back to the daemon
//      (supervisor/supervisor/worker/claude_code.py).
//
// All handles live in the module-scoped map so SUPERVISOR_TAIL_STOP can
// reach them by id without the renderer having to round-trip a process pid.

const fs = require('fs');
const path = require('path');
const pty = require('node-pty');
const { BrowserWindow } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

const handles = new Map();
let handleCounter = 0;

// task-ids on the wire look like "task-6c1943fb" — alphanumeric, dashes,
// underscores. Hardening against shell injection because the fallback path
// pipes the id through /bin/sh -c "tail … | grep <id>". Anything else is
// rejected before we reach the shell.
const SAFE_TASK_ID = /^[A-Za-z0-9_.\-]{1,128}$/;

function send(webContents, channel, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send(channel, payload);
}

function resolveLogTarget(supervisorRoot, taskId) {
  // Per-task log convention — preferred when present (zero noise, exactly
  // this task's stream).
  const perTask = path.join(supervisorRoot, 'run-state', `${taskId}.log`);
  if (fs.existsSync(perTask)) {
    return { mode: 'file', file: perTask };
  }
  // Fallback: filter audit.jsonl by task_id. This is jsonl so every event
  // for this task appears as one matching line.
  const audit = path.join(supervisorRoot, 'run-state', 'audit.jsonl');
  if (fs.existsSync(audit)) {
    return { mode: 'audit', file: audit };
  }
  return null;
}

/**
 * Create a tail PTY for one task and start streaming.
 *
 * @param {object} opts
 * @param {string} opts.supervisorRoot — supervisor repo root (parent of run-state/)
 * @param {string} opts.taskId — task id to tail
 * @param {object} opts.sender — WebContents to push SUPERVISOR_TAIL_DATA to
 * @param {number} [opts.cols=120]
 * @param {number} [opts.rows=30]
 * @returns {{ handleId: string }} on success
 *          {{ handleId: null, error: string }} on failure
 */
function create(opts) {
  const supervisorRoot = opts && opts.supervisorRoot;
  const taskId = opts && opts.taskId;
  const sender = opts && opts.sender;
  const cols = (opts && opts.cols) || 120;
  const rows = (opts && opts.rows) || 30;

  if (!supervisorRoot || !taskId || !sender) {
    return { handleId: null, error: 'missing supervisorRoot/taskId/sender' };
  }
  if (!SAFE_TASK_ID.test(taskId)) {
    return { handleId: null, error: 'invalid taskId' };
  }
  const target = resolveLogTarget(supervisorRoot, taskId);
  if (!target) {
    return { handleId: null, error: 'no log target found' };
  }

  // Spawn tail through a shell so we can pipe to grep on the audit fallback.
  // `-F` (capital) follows by name, surviving log-rotation renames.
  const shellCmd = target.mode === 'file'
    ? `tail -n 200 -F ${JSON.stringify(target.file)}`
    : `tail -n 500 -F ${JSON.stringify(target.file)} | grep --line-buffered ${JSON.stringify(taskId)}`;

  let proc;
  try {
    proc = pty.spawn('/bin/sh', ['-c', shellCmd], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: supervisorRoot,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    return { handleId: null, error: `spawn failed: ${e.message}` };
  }

  const handleId = `sup-tail-${++handleCounter}`;

  proc.onData((chunk) => {
    send(sender, SUP.SUPERVISOR_TAIL_DATA, { handleId, chunk });
  });
  proc.onExit(({ exitCode, signal }) => {
    send(sender, SUP.SUPERVISOR_TAIL_EXIT, { handleId, exitCode, signal });
    handles.delete(handleId);
  });

  handles.set(handleId, { proc, taskId, target });
  return { handleId };
}

function resize(handleId, cols, rows) {
  const h = handles.get(handleId);
  if (!h) return;
  try { h.proc.resize(cols, rows); } catch {}
}

function destroy(handleId) {
  const h = handles.get(handleId);
  if (!h) return;
  try { h.proc.kill(); } catch {}
  handles.delete(handleId);
}

function destroyAll() {
  for (const id of Array.from(handles.keys())) destroy(id);
}

function registerHandlers(ipcMain) {
  ipcMain.handle(SUP.SUPERVISOR_TAIL_START, async (event, payload) => {
    return create({ ...(payload || {}), sender: event.sender });
  });
  ipcMain.handle(SUP.SUPERVISOR_TAIL_STOP, async (_evt, payload) => {
    if (payload && payload.handleId) destroy(payload.handleId);
    return { ok: true };
  });

  // Best-effort cleanup if the renderer reloads / window closes without
  // calling stop. BrowserWindow doesn't surface a per-WebContents teardown
  // hook we can hang this off without modifying Frame source, so we tie it
  // to all-windows-closed.
}

module.exports = { create, resize, destroy, destroyAll, registerHandlers };
