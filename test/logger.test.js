/**
 * Redaction tests (T03): no secret shape may survive into a persisted log,
 * and normal developer content must pass through untouched.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { redact } = require('../src/main/logger');

// ─── redact(): secrets are scrubbed ───────────────────────

const SECRETS = [
  ['OpenAI/Anthropic key', 'run with sk-ant-api03-AbCdEf0123456789 now', 'sk-ant-api03-AbCdEf0123456789'],
  ['GitHub classic token', 'git push https://ghp_AbCdEfGh0123456789IjKlMnOp@github.com', 'ghp_AbCdEfGh0123456789IjKlMnOp'],
  ['GitHub fine-grained PAT', 'auth github_pat_11ABCDEFG0123456789_abcdef', 'github_pat_11ABCDEFG0123456789_abcdef'],
  ['AWS access key', 'export AWS_KEY=AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['Slack token', 'curl -H xoxb-123456789012-abcdefghij', 'xoxb-123456789012-abcdefghij'],
  ['JWT', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4', 'eyJhbGciOiJIUzI1NiJ9'],
  ['Bearer header', 'Authorization: Bearer abc123def456ghi789jkl', 'abc123def456ghi789jkl'],
  ['password=', 'mysql -u root password=hunter22secret', 'hunter22secret'],
  ['api_key:', 'config set api_key: 0123456789abcdef', '0123456789abcdef'],
  ['quoted secret', 'export CLIENT_SECRET="s3cr3tv4lue99"', 's3cr3tv4lue99']
];

for (const [name, input, secret] of SECRETS) {
  test(`redact scrubs ${name}`, () => {
    const out = redact(input);
    assert.ok(!out.includes(secret), `secret leaked: ${out}`);
    assert.ok(out.includes('[REDACTED]'), `nothing redacted: ${out}`);
  });
}

// ─── redact(): normal content passes through ──────────────

const CLEAN = [
  'git commit -m "fix(tasks): reorder kanban columns"',
  'npm run build && electron .',
  'Error loading tasks: SyntaxError: Unexpected end of JSON input',
  'watcher error on /Users/x/project: ENOENT',
  'git checkout -b frame/my-spec/work 504838a'
];

for (const line of CLEAN) {
  test(`redact leaves clean content: "${line.slice(0, 40)}…"`, () => {
    assert.equal(redact(line), line);
  });
}

// ─── promptLogger: redaction + size cap on the real module ─

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-prompt-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function initPromptLogger() {
  delete require.cache[require.resolve('../src/main/promptLogger')];
  const promptLogger = require('../src/main/promptLogger');
  promptLogger.init({ getPath: (key) => (key === 'home' ? tmp : path.join(tmp, 'userData')) });
  fs.mkdirSync(path.join(tmp, 'userData'), { recursive: true });
  promptLogger.setProject(path.join(tmp, 'myproject'));
  return promptLogger;
}

test('promptLogger redacts secrets typed into the terminal', async () => {
  const promptLogger = initPromptLogger();
  promptLogger.logInput('export API_KEY=sk-ant-secret0123456789\r');
  await promptLogger.flush();
  const logged = fs.readFileSync(promptLogger.getLogFilePath(), 'utf8');
  assert.ok(!logged.includes('sk-ant-secret0123456789'), `secret persisted: ${logged}`);
  assert.ok(logged.includes('[REDACTED]'));
  assert.ok(logged.includes('export'), 'non-secret part of the line is kept');
});

test('promptLogger rotates the history file past 5MB to <name>.log.1', async () => {
  const promptLogger = initPromptLogger();
  const livePath = promptLogger.getLogFilePath();
  fs.writeFileSync(livePath, `[old] first-line\n${'y'.repeat(5 * 1024 * 1024)}\n`, 'utf8');
  promptLogger.logInput('newest-line\r');
  await promptLogger.flush();
  const archive = fs.readFileSync(`${livePath}.1`, 'utf8');
  assert.ok(archive.includes('newest-line'), 'oversized live file rotated with the newest entry');
  assert.ok(archive.includes('first-line'), 'rotation preserves prior history in the archive');
  assert.ok(!fs.existsSync(livePath) || fs.statSync(livePath).size === 0, 'live file reset by rotation');
  promptLogger.logInput('fresh-line\r');
  await promptLogger.flush();
  const fresh = fs.readFileSync(livePath, 'utf8');
  assert.ok(fresh.includes('fresh-line') && !fresh.includes('first-line'), 'appends land in a fresh live file');
});
