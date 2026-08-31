/**
 * Module map hook script tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Exercised the way Claude Code runs it: a child process with hook JSON on
 * stdin. The never-break contract is the core assertion set — any failure
 * must be exit 0 with empty stdout, because the host is a tool call.
 *
 * The precision cases are not hypothetical. They were derived by replaying
 * 1011 real search commands from this repo's own transcripts through the
 * hook: matching a search verb anywhere in a command pulled patterns out of
 * `node -e '…'` bodies and heredoc payloads, and the deep tier fired on
 * words like "kill" and "process". Both are now asserted to stay silent.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'scripts', 'module-hint.js');

function runHook(input, { raw = null } = {}) {
  const stdout = execFileSync('node', [HOOK, 'search'], {
    input: raw !== null ? raw : JSON.stringify(input),
    encoding: 'utf8'
  }); // execFileSync throws on non-zero exit — reaching here asserts exit 0
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const STRUCTURE = {
  lastUpdated: '2026-08-27',
  intentIndex: {
    github: [{ module: 'main/githubManager', file: 'src/main/githubManager.js' }],
    'claude-sessions': [{ module: 'main/sessions', file: 'src/main/sessions.js' }]
  },
  modules: {
    'main/githubManager': {
      file: 'src/main/githubManager.js',
      description: 'GitHub Manager',
      ipc: { listens: ['LOAD_GITHUB_ISSUES'], emits: [] }
    },
    'main/sessions': { file: 'src/main/sessions.js', description: 'Sessions' }
  }
};

function mkProject(structure = STRUCTURE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-modhint-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  if (structure) {
    fs.writeFileSync(path.join(root, '.frame', 'STRUCTURE.json'), JSON.stringify(structure));
  }
  return root;
}

const bash = (root, command, session = 's1') =>
  ({ session_id: session, cwd: root, tool_name: 'Bash', tool_input: { command } });

// ─── it answers ───────────────────────────────────────────

test('a Grep on a curated concept gets the module map', () => {
  const root = mkProject();
  const out = runHook({ session_id: 'a', cwd: root, tool_name: 'Grep', tool_input: { pattern: 'github' } });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /src\/main\/githubManager\.js/);
  assert.match(ctx, /LOAD_GITHUB_ISSUES/);
});

test('a shell grep is answered too — the matcher sees Bash, the pattern is in the command', () => {
  const root = mkProject();
  const out = runHook(bash(root, 'grep -rn "github" src/'));
  assert.match(out.hookSpecificOutput.additionalContext, /githubManager/);
});

test('an alternation is split — the first concept that matches wins', () => {
  const root = mkProject();
  const out = runHook(bash(root, "grep -nE 'zzzz|github' src/"));
  assert.match(out.hookSpecificOutput.additionalContext, /githubManager/);
});

test('a partial key matches (claude → claude-sessions)', () => {
  const root = mkProject();
  const out = runHook(bash(root, 'grep -rn "claude" src/'));
  assert.match(out.hookSpecificOutput.additionalContext, /src\/main\/sessions\.js/);
});

// ─── it stays silent ──────────────────────────────────────

test('a Bash call that is not a search costs nothing and says nothing', () => {
  const root = mkProject();
  assert.equal(runHook(bash(root, 'ls -la src/')), null);
});

test('a search verb inside a node -e body is not a search', () => {
  const root = mkProject();
  const cmd = `node -e ' const x = 1; /* grep "github" */ console.log(x) '`;
  assert.equal(runHook(bash(root, cmd)), null);
});

test('a heredoc payload is data, never a search', () => {
  const root = mkProject();
  const cmd = "cat >> test/x.test.js <<'EOF'\ngrep -rn \"github\" src/\nEOF";
  assert.equal(runHook(bash(root, cmd)), null);
});

test('a concept that is not in the intentIndex is silent — no deep scan', () => {
  const root = mkProject();
  // "manager" appears in a module description, which find-module's fourth
  // tier would match. The hook must not: that tier is CLI-only by design.
  assert.equal(runHook(bash(root, 'grep -rn "manager" src/')), null);
});

test('no STRUCTURE.json at all is silent, not an error', () => {
  const root = mkProject(null);
  assert.equal(runHook(bash(root, 'grep -rn "github" src/')), null);
});

test('a STRUCTURE.json with no intentIndex is silent', () => {
  const root = mkProject({ modules: {} });
  assert.equal(runHook(bash(root, 'grep -rn "github" src/')), null);
});

test('the same concept is answered once per session', () => {
  const root = mkProject();
  assert.ok(runHook(bash(root, 'grep -rn "github" src/', 'dedup')));
  assert.equal(runHook(bash(root, 'grep -rln "github" test/', 'dedup')), null);
});

// ─── it never breaks ──────────────────────────────────────

test('unparseable stdin exits 0 with no output', () => {
  assert.equal(runHook(null, { raw: 'not json at all' }), null);
});

test('empty stdin exits 0 with no output', () => {
  assert.equal(runHook(null, { raw: '' }), null);
});

test('a corrupt STRUCTURE.json exits 0 with no output', () => {
  const root = mkProject(null);
  fs.writeFileSync(path.join(root, '.frame', 'STRUCTURE.json'), '{ not json');
  assert.equal(runHook(bash(root, 'grep -rn "github" src/')), null);
});

test('a payload with no tool_input exits 0 with no output', () => {
  const root = mkProject();
  assert.equal(runHook({ session_id: 'x', cwd: root, tool_name: 'Bash' }), null);
});

// ─── Codex ────────────────────────────────────────────────

test('a Codex shell search is answered — its shell tool is called Bash too', () => {
  // T01: Codex sends tool_name "Bash" with tool_input.command, exactly as
  // Claude Code does, so this path is shared rather than ported.
  const root = mkProject();
  const out = runHook({
    session_id: 'cx', cwd: root, tool_name: 'Bash', turn_id: 't', permission_mode: 'default',
    tool_input: { command: 'grep -rn "github" src/' }
  });
  assert.match(out.hookSpecificOutput.additionalContext, /githubManager/);
});

test('a Codex apply_patch is an edit, never a search', () => {
  const root = mkProject();
  const command = ['*** Begin Patch', '*** Add File: github.js', '+x', '*** End Patch'].join('\n');
  assert.equal(runHook({ session_id: 'cx', cwd: root, tool_name: 'apply_patch', tool_input: { command } }), null);
});
