/**
 * shape-brief tests — the staged command's arguments, its parts checks and
 * its request/reply file protocol, against a temp bus.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'templates', 'bin', 'shape-brief.js');
const cmd = require(SCRIPT);

const ID = 'a'.repeat(24);
const PART = { title: 'Offline store', shape: 'spec', type: 'feature', definition: '## Why\nPlanes.' };
const PARTS = JSON.stringify([PART, { title: 'Docs', shape: 'task', type: 'docs', definition: 'Write it up.' }]);

function tempBus() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-shape-')), 'bus');
}

/** Stand in for Frame: answer the first request that appears with `reply(request)`. */
function answerFirst(busDir, reply) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      let names = [];
      try { names = fs.readdirSync(busDir).filter((n) => n.endsWith('.json')); } catch { return; }
      if (names.length === 0) return;
      clearInterval(timer);
      const file = path.join(busDir, names[0]);
      const request = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
      fs.writeFileSync(path.join(busDir, 'replies', names[0]), JSON.stringify(reply(request)));
      resolve(request);
    }, 10);
  });
}

// ─── Arguments ────────────────────────────────────────────────

test('parseArgs reads the shape id', () => {
  assert.deepEqual(cmd.parseArgs(['--shape', ID]), { ok: true, shapeId: ID });
});

test('parseArgs refuses a missing id, a missing value and an unknown argument', () => {
  for (const argv of [[], ['--shape'], ['--shape', '--url'], ['--discussion', ID], ['--shape', ID, 'extra']]) {
    const r = cmd.parseArgs(argv);
    assert.equal(r.ok, false, JSON.stringify(argv));
    assert.match(r.message, /^Not shaped: .*Usage: shape-brief\.js --shape <id>/, JSON.stringify(argv));
  }
});

// ─── Parts ────────────────────────────────────────────────────

test('requestFor parses the parts, trims titles and definitions, and keeps the order', () => {
  const text = JSON.stringify([{ ...PART, title: ' A ', definition: ' one ', extra: 1 }, { ...PART, title: 'B', shape: 'task' }]);
  const r = cmd.requestFor({ shapeId: ID, partsText: `${text}\n`, ts: 5 });
  assert.deepEqual(r, {
    ok: true,
    request: {
      shapeId: ID,
      parts: [
        { title: 'A', shape: 'spec', type: 'feature', definition: 'one' },
        { title: 'B', shape: 'task', type: 'feature', definition: PART.definition },
      ],
      ts: 5,
    },
  });
});

test('requestFor carries a trimmed key and leaves out an empty one', () => {
  const text = JSON.stringify([{ ...PART, key: ' llm-judge ' }, { ...PART, key: '' }]);
  const r = cmd.requestFor({ shapeId: ID, partsText: text, ts: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.request.parts[0].key, 'llm-judge');
  assert.equal('key' in r.request.parts[1], false);
});

test('requestFor refuses a key that is not kebab-case or is too long', () => {
  for (const key of ['LLM-judge', 'llm_judge', 'llm--judge', '-llm', 'x'.repeat(41)]) {
    const r = cmd.requestFor({ shapeId: ID, partsText: JSON.stringify([{ ...PART, key }]), ts: 1 });
    assert.equal(r.ok, false, key);
    assert.match(r.message, /part 1 needs a key in kebab-case/, key);
  }
});

test('requestFor refuses a malformed id, malformed JSON and an empty or non-array payload', () => {
  const cases = [
    [{ shapeId: 'nope', partsText: PARTS }, /shape id is malformed/],
    [{ shapeId: ID, partsText: '[{"title": "A",' }, /not valid JSON/],
    [{ shapeId: ID, partsText: '' }, /not valid JSON/],
    [{ shapeId: ID, partsText: '[]' }, /at least one part/],
    [{ shapeId: ID, partsText: JSON.stringify(PART) }, /at least one part/],
  ];
  for (const [input, message] of cases) {
    const r = cmd.requestFor({ ...input, ts: 1 });
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.match(r.message, message, JSON.stringify(input));
  }
});

test('requestFor names the first bad part and its field', () => {
  const cases = [
    [[PART, { ...PART, title: '  ' }], /part 2 needs a title/],
    [[{ ...PART, title: 'x'.repeat(201) }], /part 1 needs a title/],
    [[{ ...PART, shape: 'epic' }], /part 1 needs a shape of spec or task/],
    [[{ ...PART, type: 'chore' }], /part 1 needs a type/],
    [[{ ...PART, definition: '' }], /part 1 needs a definition/],
    [[{ ...PART, definition: 'x'.repeat(10001) }], /part 1 needs a definition/],
    [[null], /part 1 needs a title/],
  ];
  for (const [parts, message] of cases) {
    const r = cmd.requestFor({ shapeId: ID, partsText: JSON.stringify(parts), ts: 1 });
    assert.equal(r.ok, false);
    assert.match(r.message, message);
  }
});

// ─── The file protocol ────────────────────────────────────────

test('run publishes one request, prints the reply and exits 0 when shaped', async () => {
  const busDir = tempBus();
  const answered = answerFirst(busDir, (request) => ({ ok: true, message: `Shaped brief #7 into ${request.parts.length} parts.` }));
  const result = await cmd.run({ argv: ['--shape', ID], partsText: PARTS, busDir, pollMs: 10 });
  const request = await answered;
  assert.deepEqual(result, { code: 0, message: 'Shaped brief #7 into 2 parts.' });
  assert.equal(request.shapeId, ID);
  assert.deepEqual(request.parts.map((p) => p.title), ['Offline store', 'Docs']);
  assert.deepEqual(fs.readdirSync(path.join(busDir, 'replies')), []);
  assert.deepEqual(fs.readdirSync(busDir), ['replies']);
});

test('run prints a refusal and exits 1', async () => {
  const busDir = tempBus();
  answerFirst(busDir, () => ({ ok: false, reason: 'alreadyShaped', message: 'Not shaped: this brief is already shaped.' }));
  const result = await cmd.run({ argv: ['--shape', ID], partsText: PARTS, busDir, pollMs: 10 });
  assert.deepEqual(result, { code: 1, message: 'Not shaped: this brief is already shaped.' });
});

test('run writes nothing for a bad request', async () => {
  const busDir = tempBus();
  const result = await cmd.run({ argv: ['--shape', ID], partsText: '[]', busDir });
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(busDir), false);
});

test('run gives up after the wait, withdraws its request and says Frame did not answer', async () => {
  const busDir = tempBus();
  const result = await cmd.run({ argv: ['--shape', ID], partsText: PARTS, busDir, waitMs: 60, pollMs: 10 });
  assert.equal(result.code, 1);
  assert.match(result.message, /Frame did not answer/);
  assert.deepEqual(fs.readdirSync(busDir), ['replies']);
});

test('run says the brief may still be shaped when Frame took the request but did not answer', async () => {
  const busDir = tempBus();
  const taken = new Promise((resolve) => {
    const timer = setInterval(() => {
      let names = [];
      try { names = fs.readdirSync(busDir).filter((n) => n.endsWith('.json')); } catch { return; }
      if (names.length === 0) return;
      clearInterval(timer);
      fs.renameSync(path.join(busDir, names[0]), path.join(busDir, `${names[0]}.taken`));
      resolve();
    }, 5);
  });
  const result = await cmd.run({ argv: ['--shape', ID], partsText: PARTS, busDir, waitMs: 100, pollMs: 10 });
  await taken;
  assert.equal(result.code, 1);
  assert.match(result.message, /may still be shaped/);
});

test('WAIT_MS is the 30 s bound', () => {
  assert.equal(cmd.WAIT_MS, 30000);
});

test('the script reads the parts on stdin and prints Frame\'s reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-shape-script-'));
  const staged = path.join(dir, 'shape-brief.js');
  fs.copyFileSync(SCRIPT, staged);
  const busDir = path.join(dir, 'bus');
  const answered = answerFirst(busDir, (request) => ({ ok: true, message: `Shaped: ${request.parts[0].definition}` }));
  const child = spawn(process.execPath, [staged, '--shape', ID], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stdin.end(`${PARTS}\n`);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  await answered;
  assert.equal(code, 0);
  assert.equal(out, 'Shaped: ## Why\nPlanes.\n');
});
