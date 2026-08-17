/**
 * structureBootstrap.refreshStagedScripts tests.
 *
 * `.frame/bin/` and `.git/hooks/pre-commit` are the two things Frame writes
 * into a project once, at init, and never again — neither is versioned, so a
 * project carries the generation that initialized it however many times Frame
 * is updated. Harmless until migration moves the meta files underneath a
 * parser that resolves them at the root.
 *
 * The properties under test are the refusals as much as the rewrite: this
 * edits an executable file that runs on every commit, so being wrong here
 * costs the user their ability to commit at all.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const structureBootstrap = require('../src/main/structureBootstrap');
const templates = require('../src/shared/frameTemplates');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../src/shared/frameConstants');

let root;

/** The parser as pre-overlay Frame shipped it: the map path is the root. */
const LEGACY_PARSER = `#!/usr/bin/env node
const path = require('path');
const ROOT_DIR = process.env.FRAME_PROJECT_ROOT
  ? path.resolve(process.env.FRAME_PROJECT_ROOT)
  : path.join(__dirname, '..');
const STRUCTURE_FILE = path.join(ROOT_DIR, 'STRUCTURE.json');
`;

/** The hook as pre-overlay Frame wrote it: stages the root map. */
const LEGACY_HOOK = `#!/bin/sh
# Frame pre-commit hook

${templates.FRAME_HOOK_MARKER_START}
if command -v node >/dev/null 2>&1; then
  FRAME_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$FRAME_ROOT" ] && [ -f "$FRAME_ROOT/.frame/bin/update-structure.js" ]; then
    FRAME_PROJECT_ROOT="$FRAME_ROOT" node "$FRAME_ROOT/.frame/bin/update-structure.js" --changed || true
    if [ -f "$FRAME_ROOT/STRUCTURE.json" ]; then
      git add "$FRAME_ROOT/STRUCTURE.json" || true
    fi
  fi
fi
${templates.FRAME_HOOK_MARKER_END}
exit 0
`;

/**
 * A project as an older Frame left it. `bin` and `hook` opt each half in or
 * out, because the two are refreshed independently and a project can easily
 * have one without the other.
 */
function makeProject(name, opts = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });

  if (opts.bin !== false) {
    const binDir = path.join(dir, FRAME_DIR, FRAME_BIN_DIR);
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'update-structure.js'), LEGACY_PARSER);
    fs.writeFileSync(path.join(binDir, 'find-module.js'), LEGACY_PARSER);
  }

  if (opts.hook !== false) {
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), opts.hook ?? LEGACY_HOOK, { mode: 0o755 });
  }
  return dir;
}

const binFile = (dir, name) => path.join(dir, FRAME_DIR, FRAME_BIN_DIR, name);
const hookFile = (dir) => path.join(dir, '.git', 'hooks', 'pre-commit');
const read = (p) => fs.readFileSync(p, 'utf8');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bootstrap-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── the parser scripts ───────────────────────────────────────

test('a stale parser is replaced by the shipped one', () => {
  const dir = makeProject('stale');
  assert.ok(read(binFile(dir, 'update-structure.js')).includes("path.join(ROOT_DIR, 'STRUCTURE.json')"));

  const summary = structureBootstrap.refreshStagedScripts(dir);

  const parser = read(binFile(dir, 'update-structure.js'));
  assert.ok(parser.includes('resolveMetaPath'), 'the parser still resolves the map at the root');
  assert.ok(summary.scripts.includes('update-structure.js'));
  assert.ok(summary.scripts.includes('find-module.js'));
  assert.ok(summary.scripts.includes('check-freshness.js'), 'the third root-path reader was skipped');
});

test('the refreshed parser prefers .frame/ and falls back to the root', () => {
  const dir = makeProject('resolve');
  structureBootstrap.refreshStagedScripts(dir);

  const parser = read(binFile(dir, 'update-structure.js'));
  const resolver = parser.slice(parser.indexOf('function resolveMetaPath'));
  assert.ok(resolver.indexOf(`'.frame'`) < resolver.indexOf('legacy'), '.frame/ is not checked first');
});

test('a project with no .frame/bin is left without one', () => {
  // Nothing stale to correct, and planting the machinery would be introducing
  // something this project either never had or deliberately removed.
  const dir = makeProject('no-bin', { bin: false });
  const summary = structureBootstrap.refreshStagedScripts(dir);

  assert.deepEqual(summary.scripts, []);
  assert.equal(fs.existsSync(path.join(dir, FRAME_DIR, FRAME_BIN_DIR)), false);
});

// ─── the hook ─────────────────────────────────────────────────

test('a legacy hook block is brought up to date in place', () => {
  const dir = makeProject('hook');
  const summary = structureBootstrap.refreshStagedScripts(dir);

  assert.equal(summary.hook, 'updated');
  const hook = read(hookFile(dir));
  assert.ok(hook.includes('.frame/STRUCTURE.json'), 'still stages the root map');
  assert.ok(hook.includes('git ls-files --error-unmatch'), 'lost the tracked-only guard');
  assert.ok(hook.startsWith('#!/bin/sh'), 'the shebang was disturbed');
  assert.ok(hook.trimEnd().endsWith('exit 0'), 'the tail was disturbed');
});

test('the rewrite preserves the mode the hook already had', { skip: process.platform === 'win32' }, () => {
  const dir = makeProject('mode');
  const before = fs.statSync(hookFile(dir)).mode;

  structureBootstrap.refreshStagedScripts(dir);

  assert.equal(fs.statSync(hookFile(dir)).mode, before, 'a non-executable hook silently stops running');
  assert.ok(before & 0o111, 'the fixture was not executable, so this proves nothing');
});

test("a hook Frame never marked is not Frame's to edit", () => {
  const dir = makeProject('foreign', { hook: '#!/bin/sh\nnpm run lint\n' });
  const summary = structureBootstrap.refreshStagedScripts(dir);

  assert.equal(summary.hook, 'unmarked');
  assert.equal(read(hookFile(dir)), '#!/bin/sh\nnpm run lint\n');
});

test('husky and lefthook projects keep the treatment they get everywhere else', () => {
  // No vanilla hook file at all — this module only ever wrote .git/hooks/,
  // and .husky/pre-commit is tracked, so it stays the user's.
  const dir = makeProject('husky', { hook: false });
  fs.mkdirSync(path.join(dir, '.husky'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.husky', 'pre-commit'), `#!/bin/sh\n${templates.getStructureHookSnippet()}`);

  const summary = structureBootstrap.refreshStagedScripts(dir);

  assert.equal(summary.hook, 'absent');
  assert.ok(read(path.join(dir, '.husky', 'pre-commit')).includes(templates.FRAME_HOOK_MARKER_START));
});

test('an already-current hook is reported as needing nothing', () => {
  const dir = makeProject('current', { hook: templates.getStructurePreCommitHookTemplate() });
  const before = read(hookFile(dir));

  const summary = structureBootstrap.refreshStagedScripts(dir);

  assert.equal(summary.hook, 'unchanged');
  assert.equal(read(hookFile(dir)), before, 'rewrote a file that needed no rewriting');
});

test('a second pass changes nothing', () => {
  const dir = makeProject('idempotent');
  structureBootstrap.refreshStagedScripts(dir);
  const after = read(hookFile(dir));

  const summary = structureBootstrap.refreshStagedScripts(dir);
  assert.equal(summary.hook, 'unchanged');
  assert.equal(read(hookFile(dir)), after);
});

test('the scripts are still refreshed when the hook cannot be', () => {
  // The two halves are independent: a project on husky still needs a parser
  // that knows where the map lives.
  const dir = makeProject('bin-only', { hook: false });
  const summary = structureBootstrap.refreshStagedScripts(dir);

  assert.equal(summary.hook, 'absent');
  assert.ok(read(binFile(dir, 'update-structure.js')).includes('resolveMetaPath'));
});

test('a missing project path is answered rather than thrown at', () => {
  const summary = structureBootstrap.refreshStagedScripts(path.join(root, 'gone'));
  assert.deepEqual(summary, { scripts: [], hook: 'absent' });
  assert.deepEqual(structureBootstrap.refreshStagedScripts(null), { scripts: [], hook: 'absent' });
});
