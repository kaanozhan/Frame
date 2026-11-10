/**
 * screenMirror — server terminal snapshots (server-workspaces spec, T03).
 * Pinned: a snapshot replayed into a fresh terminal of the same size gives
 * the same visible screen and cursor — for plain output, for a full-screen
 * TUI on the alternate screen, and after a resize; partial escape sequences
 * split across writes are handled.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('xterm-headless');
const { createMirror } = require('../src/server/screenMirror');

function visible(term) {
  const b = term.buffer.active;
  const lines = [];
  for (let i = 0; i < term.rows; i++) lines.push(b.getLine(b.viewportY + i).translateToString(true));
  return { lines, cursor: [b.cursorX, b.cursorY], type: b.type };
}

async function replay(snap) {
  const t = new Terminal({ cols: snap.cols, rows: snap.rows, allowProposedApi: true });
  await new Promise((r) => t.write(snap.screen, r));
  return t;
}

async function mirrorAndReference(chunks, { cols = 40, rows = 10 } = {}) {
  const m = createMirror({ cols, rows });
  const ref = new Terminal({ cols, rows, allowProposedApi: true });
  for (const c of chunks) { m.write(c); ref.write(c); }
  await new Promise((r) => ref.write('', r));
  return { m, ref };
}

test('plain output round-trips', async () => {
  const { m, ref } = await mirrorAndReference(['$ ls\r\n', 'a.txt  b.txt\r\n', '\x1b[32mgreen\x1b[0m $ ']);
  const snap = await m.snapshot();
  assert.deepEqual(visible(await replay(snap)), visible(ref));
  m.dispose();
});

test('a full-screen TUI on the alternate screen round-trips', async () => {
  const tui = [
    'shell history line\r\n',
    '\x1b[?1049h\x1b[H\x1b[2J',                 // enter alt screen, clear
    '\x1b[1;1H\x1b[7m Claude Code \x1b[0m',
    '\x1b[5;3H> fix the failing test',
    '\x1b[10;1H\x1b[2m? for shortcuts\x1b[0m',
    '\x1b[5;25H'
  ];
  const { m, ref } = await mirrorAndReference(tui);
  const snap = await m.snapshot();
  const back = visible(await replay(snap));
  assert.equal(visible(ref).type, 'alternate');
  assert.deepEqual(back, visible(ref));
  m.dispose();
});

test('escape sequences split across writes and a resize', async () => {
  const { m, ref } = await mirrorAndReference(['\x1b[3', '1mred\x1b', '[0m text\r\n', 'next']);
  m.resize(30, 8);
  ref.resize(30, 8);
  await new Promise((r) => ref.write('', r));
  const snap = await m.snapshot();
  assert.deepEqual([snap.cols, snap.rows], [30, 8]);
  assert.deepEqual(visible(await replay(snap)), visible(ref));
  m.dispose();
});

test('a disposed mirror snapshots empty and ignores writes', async () => {
  const m = createMirror({ cols: 20, rows: 5 });
  m.dispose();
  m.write('x');
  assert.equal((await m.snapshot()).screen, '');
});
