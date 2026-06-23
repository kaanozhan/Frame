// Supervisor live output pane (renderer) — Phase C.
//
// Mounts an xterm.js instance into a DOM node, asks main to spawn a tail PTY
// for a task, and pumps SUPERVISOR_TAIL_DATA into the terminal. Theme tokens
// come from Frame's CSS variables so light/dark flips automatically.

const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const SUP = require('../../shared/supervisor-ipc');

function themeFromVars() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  return {
    background: v('--bg-primary', '#151516'),
    foreground: v('--text-primary', '#d4d4d4'),
    cursor: v('--text-primary', '#d4d4d4'),
  };
}

/**
 * @param {HTMLElement} containerEl
 * @param {{ taskId: string, supervisorRoot: string }} opts
 */
function create(containerEl, opts) {
  const taskId = opts && opts.taskId;
  const supervisorRoot = opts && opts.supervisorRoot;

  const term = new Terminal({
    fontSize: 12,
    fontFamily: 'Consolas, "Courier New", monospace',
    scrollback: 5000,
    convertEol: true,
    disableStdin: true,
    cursorStyle: 'bar',
    cursorBlink: false,
    theme: themeFromVars(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  let handleId = null;
  let started = false;
  let dataHandler = null;
  let exitHandler = null;
  let resizeObs = null;

  term.open(containerEl);
  try { fitAddon.fit(); } catch {}

  async function start() {
    if (started) return;
    started = true;
    if (!taskId || !supervisorRoot) {
      term.writeln('\x1b[31m[supervisor] tail: missing taskId or supervisorRoot\x1b[0m');
      return;
    }
    term.writeln(`\x1b[90m[supervisor] tailing task ${taskId} …\x1b[0m`);

    dataHandler = (_evt, { handleId: hid, chunk }) => {
      if (hid !== handleId) return;
      term.write(chunk);
    };
    exitHandler = (_evt, { handleId: hid, exitCode, signal }) => {
      if (hid !== handleId) return;
      term.writeln(`\r\n\x1b[90m[supervisor] tail exited (code=${exitCode}, signal=${signal || 'null'})\x1b[0m`);
    };
    ipcRenderer.on(SUP.SUPERVISOR_TAIL_DATA, dataHandler);
    ipcRenderer.on(SUP.SUPERVISOR_TAIL_EXIT, exitHandler);

    try {
      const res = await ipcRenderer.invoke(SUP.SUPERVISOR_TAIL_START, {
        taskId,
        supervisorRoot,
        cols: term.cols,
        rows: term.rows,
      });
      if (!res || !res.handleId) {
        term.writeln(`\x1b[31m[supervisor] tail failed: ${(res && res.error) || 'unknown'}\x1b[0m`);
        return;
      }
      handleId = res.handleId;
    } catch (err) {
      term.writeln(`\x1b[31m[supervisor] tail failed: ${err.message}\x1b[0m`);
    }

    // Re-fit on container resize so xterm's grid matches the expand/collapse.
    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch {}
      });
      resizeObs.observe(containerEl);
    }
  }

  function stop() {
    if (!started) {
      try { term.dispose(); } catch {}
      return;
    }
    started = false;
    if (dataHandler) ipcRenderer.removeListener(SUP.SUPERVISOR_TAIL_DATA, dataHandler);
    if (exitHandler) ipcRenderer.removeListener(SUP.SUPERVISOR_TAIL_EXIT, exitHandler);
    dataHandler = null;
    exitHandler = null;
    if (resizeObs) { try { resizeObs.disconnect(); } catch {} resizeObs = null; }
    if (handleId) {
      ipcRenderer.invoke(SUP.SUPERVISOR_TAIL_STOP, { handleId }).catch(() => {});
      handleId = null;
    }
    try { term.dispose(); } catch {}
  }

  return { start, stop };
}

module.exports = { create };
