const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../src/main/queueStore');
const rules = require('../src/shared/queueRules');
const { FRAME_FILE_CLASSES } = require('../src/shared/frameConstants');

function checkout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-queue-'));
  fs.mkdirSync(path.join(dir, '.frame'));
  return dir;
}

const task = (ref) => ({ kind: 'task', ref, title: ref, status: 'pending' });

test('queue.json lives in the ignored runtime folder', () => {
  assert.ok(FRAME_FILE_CLASSES.runtime.includes('runtime/'));
  assert.strictEqual(path.dirname(store.queuePath('/p')), path.join('/p', '.frame', 'runtime'));
});

test('an absent file loads as an empty queue', () => {
  const dir = checkout();
  assert.deepStrictEqual(store.load(dir), rules.emptyQueue());
  assert.strictEqual(store.queuePath(dir), path.join(dir, '.frame', 'runtime', 'queue.json'));
});

test('update round-trips through the file and keeps order', () => {
  const dir = checkout();
  store.update(dir, (q) => rules.add(q, task('a'), { id: 'q1', now: 'T' }));
  store.update(dir, (q) => rules.add(q, task('b'), { id: 'q2', now: 'T' }));
  store.update(dir, (q) => rules.reorder(q, ['q2']));
  store.update(dir, (q) => rules.setParallel(q, 4));
  const again = store.load(dir);
  assert.deepStrictEqual(again.items.map((i) => i.id), ['q2', 'q1']);
  assert.strictEqual(again.parallel, 4);
  const onDisk = JSON.parse(fs.readFileSync(store.queuePath(dir), 'utf8'));
  assert.strictEqual(onDisk.version, 1);
});

test('a refused change does not write', () => {
  const dir = checkout();
  store.update(dir, (q) => rules.add(q, task('a'), { id: 'q1' }));
  const mtime = fs.statSync(store.queuePath(dir)).mtimeMs;
  const res = store.update(dir, (q) => rules.add(q, task('a'), { id: 'q2' }));
  assert.strictEqual(res.refused, 'duplicate');
  assert.strictEqual(res.queue.items.length, 1);
  assert.strictEqual(fs.statSync(store.queuePath(dir)).mtimeMs, mtime);
});

test('a corrupt file is set aside and reads as empty', () => {
  const dir = checkout();
  fs.mkdirSync(path.dirname(store.queuePath(dir)), { recursive: true });
  fs.writeFileSync(store.queuePath(dir), '{ not json');
  assert.deepStrictEqual(store.load(dir).items, []);
  assert.ok(fs.readdirSync(path.join(dir, '.frame', 'runtime')).some((f) => f.startsWith('queue.json.corrupt-')));
});

test('reconcile marks running items without a live terminal interrupted', () => {
  const dir = checkout();
  store.update(dir, (q) => rules.add(q, task('a'), { id: 'q1' }));
  store.update(dir, (q) => rules.add(q, task('b'), { id: 'q2' }));
  store.update(dir, (q) => rules.setState(q, 'q1', 'running', { terminalId: 'term-1' }));
  store.update(dir, (q) => rules.setState(q, 'q2', 'running', { terminalId: 'term-2' }));
  const q = store.reconcile(dir, new Set(['term-2']));
  assert.deepStrictEqual(q.items.map((i) => i.state), ['interrupted', 'running']);
  assert.deepStrictEqual(store.load(dir).items.map((i) => i.state), ['interrupted', 'running']);
});
