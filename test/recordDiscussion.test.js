/**
 * record-discussion tests — the staged command's arguments and its
 * request/reply file protocol, against a temp bus.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'templates', 'bin', 'record-discussion.js');
const cmd = require(SCRIPT);

const ID = 'a'.repeat(24);

function tempBus() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-discuss-')), 'bus');
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

test('parseArgs reads the discussion id and an optional url', () => {
  assert.deepEqual(cmd.parseArgs(['--discussion', ID]), { ok: true, discussionId: ID, url: '' });
  assert.deepEqual(cmd.parseArgs(['--url', 'https://x.test', '--discussion', ID]), { ok: true, discussionId: ID, url: 'https://x.test' });
});

test('parseArgs refuses a missing id, a missing value and an unknown argument', () => {
  for (const argv of [[], ['--discussion'], ['--discussion', '--url'], ['--discussion', ID, '--force'], ['summary text']]) {
    const r = cmd.parseArgs(argv);
    assert.equal(r.ok, false, JSON.stringify(argv));
    assert.match(r.message, /^Not recorded: /);
  }
});

test('requestFor trims the summary and keeps an http(s) url', () => {
  assert.deepEqual(cmd.requestFor({ discussionId: ID, url: ' https://x.test ', summary: '\n Chose Postgres \n', ts: 5 }), {
    ok: true, request: { discussionId: ID, summary: 'Chose Postgres', ts: 5, url: 'https://x.test' },
  });
  assert.equal('url' in cmd.requestFor({ discussionId: ID, url: '', summary: 'S', ts: 1 }).request, false);
});

test('requestFor refuses a malformed id, an empty or too long summary and a non-http(s) url', () => {
  const cases = [
    [{ discussionId: 'nope', summary: 'S' }, /discussion id/],
    [{ discussionId: ID, summary: '  \n' }, /summary/],
    [{ discussionId: ID, summary: 'y'.repeat(10001) }, /summary/],
    [{ discussionId: ID, summary: 'S', url: 'javascript:alert(1)' }, /--url/],
  ];
  for (const [input, message] of cases) {
    const r = cmd.requestFor({ ...input, ts: 1 });
    assert.equal(r.ok, false);
    assert.match(r.message, message);
  }
});

// ─── The file protocol ────────────────────────────────────────

test('run publishes one request, prints the reply and exits 0 when recorded', async () => {
  const busDir = tempBus();
  const answered = answerFirst(busDir, () => ({ ok: true, message: 'Recorded on brief #7.' }));
  const result = await cmd.run({ argv: ['--discussion', ID, '--url', 'https://claude.ai/artifact/x'], summary: 'Chose Postgres\n', busDir, pollMs: 10 });
  const request = await answered;
  assert.deepEqual(result, { code: 0, message: 'Recorded on brief #7.' });
  assert.equal(request.discussionId, ID);
  assert.equal(request.summary, 'Chose Postgres');
  assert.equal(request.url, 'https://claude.ai/artifact/x');
  assert.deepEqual(fs.readdirSync(path.join(busDir, 'replies')), []);
  assert.deepEqual(fs.readdirSync(busDir), ['replies']);
});

test('run prints a refusal and exits 1', async () => {
  const busDir = tempBus();
  answerFirst(busDir, () => ({ ok: false, reason: 'alreadyClosed', message: 'Not recorded: this proposal has ended.' }));
  const result = await cmd.run({ argv: ['--discussion', ID], summary: 'S', busDir, pollMs: 10 });
  assert.deepEqual(result, { code: 1, message: 'Not recorded: this proposal has ended.' });
});

test('run writes nothing for a bad request', async () => {
  const busDir = tempBus();
  const result = await cmd.run({ argv: ['--discussion', ID], summary: '   ', busDir });
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(busDir), false);
});

test('run gives up after the wait, withdraws its request and says Frame did not answer', async () => {
  const busDir = tempBus();
  const result = await cmd.run({ argv: ['--discussion', ID], summary: 'S', busDir, waitMs: 60, pollMs: 10 });
  assert.equal(result.code, 1);
  assert.match(result.message, /Frame did not answer/);
  assert.deepEqual(fs.readdirSync(busDir), ['replies']);
});

test('run says the record may still land when Frame took the request but did not answer', async () => {
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
  const result = await cmd.run({ argv: ['--discussion', ID], summary: 'S', busDir, waitMs: 100, pollMs: 10 });
  await taken;
  assert.equal(result.code, 1);
  assert.match(result.message, /may still be recorded/);
});

test('the script reads the summary on stdin and prints Frame\'s reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-discuss-script-'));
  const staged = path.join(dir, 'record-discussion.js');
  fs.copyFileSync(SCRIPT, staged);
  const busDir = path.join(dir, 'bus');
  const answered = answerFirst(busDir, (request) => ({ ok: true, message: `Recorded: ${request.summary}` }));
  const child = spawn(process.execPath, [staged, '--discussion', ID], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stdin.end('We chose Postgres.\nOpen: sync conflicts.\n');
  const code = await new Promise((resolve) => child.on('exit', resolve));
  await answered;
  assert.equal(code, 0);
  assert.equal(out, 'Recorded: We chose Postgres.\nOpen: sync conflicts.\n');
});
