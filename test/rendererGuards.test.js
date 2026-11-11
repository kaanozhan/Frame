// Renderer guards (workspace-hardening R1, R2, R7): pure helpers the dialogs use.
const test = require('node:test');
const assert = require('node:assert/strict');
const { enterSubmits } = require('../src/renderer/modalKeys');
const { exclusive } = require('../src/renderer/scopeGuard');

test('enterSubmits: Enter on a button does what the button says, not the dialog default', () => {
  assert.equal(enterSubmits({ tagName: 'BUTTON' }), false);
  assert.equal(enterSubmits({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(enterSubmits({ tagName: 'INPUT', type: 'radio' }), true);
  assert.equal(enterSubmits({ tagName: 'SELECT' }), false);
  assert.equal(enterSubmits({ tagName: 'A' }), false);
  assert.equal(enterSubmits(null), false);
});

test('enterSubmits: a textarea submits only with ⌘/Ctrl', () => {
  assert.equal(enterSubmits({ tagName: 'TEXTAREA' }), false);
  assert.equal(enterSubmits({ tagName: 'TEXTAREA' }, { metaKey: true }), true);
  assert.equal(enterSubmits({ tagName: 'TEXTAREA' }, { ctrlKey: true }), true);
});

test('exclusive: a second call while the first runs is refused and reported', async () => {
  let release;
  let busyCalls = 0;
  const seen = [];
  const run = exclusive(async (id) => { seen.push(id); await new Promise((r) => { release = r; }); return id; }, { onBusy: () => { busyCalls++; } });
  const first = run('a');
  const second = await run('b');
  assert.equal(second, null);
  assert.equal(busyCalls, 1);
  release();
  assert.equal(await first, 'a');
  assert.deepEqual(seen, ['a'], 'b never ran with a\'s dialog state');
  const third = run('c');
  release();
  assert.equal(await third, 'c', 'free again after the first finished');
});

test('exclusive with queue: calls take turns, each gets its own answer', async () => {
  const order = [];
  const releases = [];
  const ask = exclusive((id) => new Promise((r) => { order.push(id); releases.push(() => r(`${id}-answer`)); }), { queue: true });
  const a = ask('a');
  const b = ask('b');
  await Promise.resolve();
  assert.deepEqual(order, ['a'], 'b waits');
  releases[0]();
  assert.equal(await a, 'a-answer');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['a', 'b']);
  releases[1]();
  assert.equal(await b, 'b-answer');
});

test('exclusive: a throwing call frees the gate', async () => {
  const run = exclusive(async () => { throw new Error('x'); });
  await assert.rejects(run());
  await assert.rejects(run(), /x/, 'not refused as busy');
});

// ─── R3 / R6 / R11: scope after an await ─────────────────────

test('scopeGuard: still() holds only while the same project and workspace are selected', () => {
  const { scopeGuard } = require('../src/renderer/scopeGuard');
  let current = { projectPath: '/p', workspaceId: 'w1' };
  const guard = scopeGuard({ projectPath: '/p', workspaceId: 'w1' }, () => current);
  assert.equal(guard.still(), true);
  current = { projectPath: '/p', workspaceId: 'main' };
  assert.equal(guard.still(), false, 'another workspace');
  current = { projectPath: '/q', workspaceId: 'w1' };
  assert.equal(guard.still(), false, 'another project');
  assert.equal(guard.sameProject(), false);
  current = { projectPath: '/p', workspaceId: 'main' };
  assert.equal(guard.sameProject(), true);
});

test('selectionChange: same, meta (renamed branch) or switch', () => {
  const { selectionChange } = require('../src/renderer/scopeGuard');
  const a = { id: 'w1', root: '/r/w1', name: 'w1', branch: 'feat/a' };
  assert.equal(selectionChange(a, { ...a }), 'same');
  assert.equal(selectionChange(a, { ...a, branch: 'feat/b' }), 'meta');
  assert.equal(selectionChange(a, { ...a, name: 'renamed' }), 'meta');
  assert.equal(selectionChange(a, { ...a, id: 'w2', root: '/r/w2' }), 'switch');
  assert.equal(selectionChange(null, a), 'switch');
  assert.equal(selectionChange(a, null), 'switch');
  assert.equal(selectionChange(null, null), 'same');
});
