/**
 * screenMirror — what a server terminal looks like right now
 * (server-workspaces spec, T4; 2026-11-09 persistence decision).
 *
 * Every server PTY's output is also written into a headless xterm of the
 * same size. When a desktop (re)attaches, the mirror is serialized into an
 * escape-sequence snapshot that the renderer's xterm replays to the exact
 * screen — cursor, colours, the alternate screen of a full-screen TUI like
 * Claude Code — instead of replaying a cut-off byte log that would garble it.
 *
 * Same parser generation as the renderer (`xterm` 5.3 ↔ `xterm-headless` 5.3).
 */

/**
 * xterm-headless 5.3 decides it runs in Node from `typeof navigator`, at load.
 * Node 21+ has a global `navigator`, so it takes the browser path, touches
 * `window` and throws — Frame Server died at start on a Node 22 host (field
 * test, 2026-11-11). Hide the global while the modules load, then put it back.
 */
function loadXterm() {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hide = !!(desc && desc.configurable);
  if (hide) delete globalThis.navigator;
  try {
    return { Terminal: require('xterm-headless').Terminal, SerializeAddon: require('xterm-addon-serialize').SerializeAddon };
  } finally {
    if (hide) Object.defineProperty(globalThis, 'navigator', desc);
  }
}
const { Terminal, SerializeAddon } = loadXterm();

const DEFAULT_SCROLLBACK = 1000;

function createMirror({ cols = 80, rows = 24, scrollback = DEFAULT_SCROLLBACK } = {}) {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  let disposed = false;

  return {
    write(data) {
      if (!disposed && data) term.write(data);
    },
    resize(c, r) {
      if (disposed || !(c > 0) || !(r > 0)) return;
      if (c === term.cols && r === term.rows) return;
      term.resize(c, r);
    },
    /**
     * Snapshot after every pending write has been parsed:
     * `{ screen, cols, rows }`, `screen` being what to write into a reset xterm.
     */
    snapshot() {
      if (disposed) return Promise.resolve({ screen: '', cols, rows });
      return new Promise((resolve) => {
        term.write('', () => {
          resolve({ screen: serializer.serialize({ scrollback }), cols: term.cols, rows: term.rows });
        });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { term.dispose(); } catch (_) { /* already gone */ }
    },
    get size() {
      return { cols: term.cols, rows: term.rows };
    }
  };
}

module.exports = { createMirror, DEFAULT_SCROLLBACK };
