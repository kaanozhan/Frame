/**
 * Tool vocabulary tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * The load-bearing assertions are the two that protect what already works.
 * The Claude Code entry must reproduce the tool matching the hint scripts
 * hardcoded before this module existed — the scripts are moving onto it in
 * T03, and a mismatch would regress a shipped, measured delivery layer. And
 * the role union must stay unambiguous: the scripts ask `roleOf(tool_name)`
 * without first knowing which CLI they are under, which is only sound while
 * no name means one thing to one CLI and something else to another.
 *
 * The Codex entries encode what was measured in T01 against CLI 0.149.1, not
 * what its documentation suggests: the shell tool is called `Bash`, and
 * `apply_patch` carries a patch envelope instead of a path field.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const v = require('../src/shared/toolVocabulary.js');

// ─── the Claude Code entry is today's behaviour ───────────

test('the claude-code entry reproduces what the scripts hardcoded', () => {
  // docs-hint.js: toolName === 'Edit' || 'Write' || 'NotebookEdit'
  for (const name of ['Edit', 'Write', 'NotebookEdit']) {
    assert.equal(v.roleOf(name), 'edit', name);
  }
  // module-hint.js: toolName === 'Grep' || 'Glob'
  for (const name of ['Grep', 'Glob']) {
    assert.equal(v.roleOf(name), 'search', name);
  }
  // both: toolName === 'Bash'
  assert.equal(v.roleOf('Bash'), 'shell');
});

test('Claude Code edit paths come from file_path, notebooks from notebook_path', () => {
  assert.deepEqual(v.editPaths('Edit', { file_path: '/a/b.js' }), ['/a/b.js']);
  assert.deepEqual(v.editPaths('Write', { file_path: 'x.md' }), ['x.md']);
  assert.deepEqual(v.editPaths('NotebookEdit', { notebook_path: 'n.ipynb' }), ['n.ipynb']);
});

test('Claude Code search patterns come from pattern, then glob', () => {
  assert.equal(v.searchPattern('Grep', { pattern: 'orchestr' }), 'orchestr');
  assert.equal(v.searchPattern('Glob', { glob: '**/*.js' }), '**/*.js');
});

// ─── the Codex entry is what T01 measured ─────────────────

test('Codex names its shell tool Bash, so shell handling is shared', () => {
  // Measured: tool_name "Bash", tool_input.command — identical to Claude Code.
  // Not shell / exec_command / local_shell, which appear in the binary but
  // are not what a hook receives.
  assert.equal(v.roleOf('Bash'), 'shell');
  assert.equal(v.shellCommand('Bash', { command: 'grep -rn x src/' }), 'grep -rn x src/');
  assert.equal(v.cliOfTool('Bash'), null, 'Bash belongs to both, so it names no single CLI');
});

test('Codex has no search tool — searching goes through the shell', () => {
  assert.deepEqual(v.toolsFor('search', v.CODEX), []);
  assert.equal(v.searchPattern('apply_patch', { command: 'x' }), null);
});

test('apply_patch paths are read out of the patch envelope', () => {
  const command = [
    '*** Begin Patch',
    '*** Add File: hello.txt',
    '+world',
    '*** End Patch'
  ].join('\n');
  assert.equal(v.roleOf('apply_patch'), 'edit');
  assert.deepEqual(v.editPaths('apply_patch', { command }), ['hello.txt']);
});

test('a patch touching several files yields every path, including a move', () => {
  const command = [
    '*** Begin Patch',
    '*** Update File: src/a.js',
    '*** Move to: src/b.js',
    '@@',
    '-old',
    '+new',
    '*** Delete File: src/gone.js',
    '*** Add File: src/new.js',
    '+hi',
    '*** End Patch'
  ].join('\n');
  const paths = v.editPaths('apply_patch', { command });
  assert.deepEqual(paths.sort(), ['src/a.js', 'src/b.js', 'src/gone.js', 'src/new.js']);
});

test('a patch body that merely mentions the header text yields nothing extra', () => {
  // Envelope headers are anchored to the start of a line; a diff line that
  // quotes one is content, not a target.
  const command = [
    '*** Begin Patch',
    '*** Add File: real.txt',
    '+the docs say "*** Add File: fake.txt" here',
    '*** End Patch'
  ].join('\n');
  assert.deepEqual(v.editPaths('apply_patch', { command }), ['real.txt']);
});

// ─── the union has to stay unambiguous ────────────────────

test('no tool name means different things to different CLIs', () => {
  const seen = new Map();
  for (const cli of [v.CLAUDE, v.CODEX]) {
    for (const role of v.ROLES) {
      for (const name of v.toolsFor(role, cli)) {
        const prior = seen.get(name);
        assert.ok(prior === undefined || prior === role,
          `${name} is ${prior} for one CLI and ${role} for another — roleOf() would be a coin flip`);
        seen.set(name, role);
      }
    }
  }
});

test('an unknown tool has no role and yields nothing', () => {
  assert.equal(v.roleOf('WebFetch'), null);
  assert.equal(v.roleOf(''), null);
  assert.equal(v.roleOf(undefined), null);
  assert.deepEqual(v.editPaths('WebFetch', { file_path: 'x' }), []);
  assert.equal(v.shellCommand('WebFetch', { command: 'ls' }), null);
});

// ─── resolving which CLI a payload came from ──────────────

test('an explicit cli beats every inference', () => {
  assert.equal(v.cliOf({ turn_id: 'x', model: 'gpt' }, v.CLAUDE), v.CLAUDE);
  assert.equal(v.cliOf({}, v.CODEX), v.CODEX);
});

test('a CLI-specific tool name identifies the CLI on its own', () => {
  assert.equal(v.cliOf({ tool_name: 'apply_patch' }), v.CODEX);
  assert.equal(v.cliOf({ tool_name: 'NotebookEdit' }), v.CLAUDE);
});

test('Codex-only payload fields identify it when no tool name does', () => {
  // SessionStart carries no tool_name; these fields are what T01 saw Codex
  // send and Claude Code not send.
  assert.equal(v.cliOf({ hook_event_name: 'SessionStart', turn_id: 't' }), v.CODEX);
  assert.equal(v.cliOf({ hook_event_name: 'SessionStart', permission_mode: 'x' }), v.CODEX);
});

test('an unmarked payload reads as Claude Code', () => {
  // The generation of hook config already in the field has no --cli flag.
  assert.equal(v.cliOf({ hook_event_name: 'SessionStart', source: 'startup' }), v.CLAUDE);
  assert.equal(v.cliOf(null), v.CLAUDE);
});

// ─── what Frame writes into a hook config ─────────────────

test('matchers are per CLI and name only that CLI\'s tools', () => {
  assert.equal(v.matcherFor(v.CLAUDE, ['edit']), 'Edit|Write|NotebookEdit');
  assert.equal(v.matcherFor(v.CODEX, ['edit']), 'apply_patch');
  assert.equal(v.matcherFor(v.CLAUDE, ['search', 'shell']), 'Grep|Glob|Bash');
  assert.equal(v.matcherFor(v.CODEX, ['search', 'shell']), 'Bash');
});

test('the matcher for the meta-write hook matches what ships today for Claude', () => {
  // .claude/settings.json currently registers Edit|Write|NotebookEdit|Bash.
  assert.equal(v.matcherFor(v.CLAUDE, ['edit', 'shell']), 'Edit|Write|NotebookEdit|Bash');
});

// ─── the inline ceiling ───────────────────────────────────

test('the inline ceiling is per CLI, with Claude Code the safe default', () => {
  assert.equal(v.inlineCap(v.CLAUDE), 2000);
  assert.equal(v.inlineCap(v.CODEX), 20000);
  assert.equal(v.inlineCap('something-else'), 2000, 'an unknown CLI gets the tightest cap');
  assert.equal(v.inlineCap(undefined), 2000);
});
