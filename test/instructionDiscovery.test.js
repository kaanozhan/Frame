/**
 * instructionDiscovery tests (T04): fixture trees for the native-file scan and
 * the legacy-layout detector, plus the property the whole overlay rests on —
 * a scanned repo is byte- and mtime-identical afterwards.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const instructionDiscovery = require('../src/main/instructionDiscovery');

let projectDir;

function write(rel, content) {
  const target = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function kinds(result) {
  return result.nativeFiles.map((f) => f.kind).sort();
}

function names(result) {
  return result.nativeFiles.map((f) => path.relative(projectDir, f.path)).sort();
}

/** Checksum + mtime of every file in the tree, for the read-only guarantee. */
function snapshot(dir) {
  const out = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isSymbolicLink()) {
        out.set(full, `link:${fs.readlinkSync(full)}`);
      } else {
        const st = fs.statSync(full);
        const sum = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        out.set(full, `${sum}:${st.mtimeMs}:${st.mode}`);
      }
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-discovery-'));
});

afterEach(() => {
  instructionDiscovery.stopAll();
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ─── native instruction files ─────────────────────────────────

test('an empty project discovers nothing and is not legacy', () => {
  const result = instructionDiscovery.scan(projectDir);
  assert.deepEqual(result.nativeFiles, []);
  assert.equal(result.legacyLayout, false);
});

test('each supported convention is found and labelled', () => {
  write('CLAUDE.md', '# claude\n');
  write('.claude/CLAUDE.md', '# scoped claude\n');
  write('GEMINI.md', '# gemini\n');
  write('.cursorrules', 'rules\n');
  write('.github/copilot-instructions.md', '# copilot\n');

  const result = instructionDiscovery.scan(projectDir);
  assert.deepEqual(kinds(result), ['claude', 'claude', 'copilot', 'cursor', 'gemini']);
  assert.deepEqual(names(result), [
    '.claude/CLAUDE.md',
    '.cursorrules',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    'GEMINI.md'
  ]);
});

test('.cursor/rules contributes every file inside it', () => {
  write('.cursor/rules/style.mdc', 'a\n');
  write('.cursor/rules/testing.mdc', 'b\n');
  fs.mkdirSync(path.join(projectDir, '.cursor', 'rules', 'nested'), { recursive: true });

  const result = instructionDiscovery.scan(projectDir);
  assert.deepEqual(names(result), ['.cursor/rules/style.mdc', '.cursor/rules/testing.mdc']);
});

test('a directory named like an instruction file is not reported as one', () => {
  fs.mkdirSync(path.join(projectDir, 'CLAUDE.md'), { recursive: true });
  assert.deepEqual(instructionDiscovery.scan(projectDir).nativeFiles, []);
});

// ─── legacy layout ────────────────────────────────────────────

test('a full pre-overlay layout is detected', () => {
  write('tasks.json', '{"version":"2.0","tasks":[]}');
  write('AGENTS.md', '# agents\n');
  write('STRUCTURE.json', '{"modules":{}}');
  write('PROJECT_NOTES.md', '# notes\n');

  assert.equal(instructionDiscovery.scan(projectDir).legacyLayout, true);
});

test('a CLAUDE.md → AGENTS.md symlink alone is enough', (t) => {
  write('AGENTS.md', '# agents\n');
  try {
    fs.symlinkSync('AGENTS.md', path.join(projectDir, 'CLAUDE.md'));
  } catch (err) {
    t.skip('symlinks unavailable on this platform');
    return;
  }
  assert.equal(instructionDiscovery.scan(projectDir).legacyLayout, true);
});

test('a plain tasks.json is not mistaken for a Frame project', () => {
  write('tasks.json', '{"tasks":[]}');
  assert.equal(instructionDiscovery.scan(projectDir).legacyLayout, false);
});

test("a repo's own AGENTS.md is an instruction file, not a legacy layout", () => {
  write('AGENTS.md', '# our conventions\n');
  const result = instructionDiscovery.scan(projectDir);
  assert.equal(result.legacyLayout, false);
  assert.deepEqual(kinds(result), ['agents']);
});

test('a project already on the overlay layout is not legacy', () => {
  write('.frame/tasks.json', '{"version":"2.0","tasks":[]}');
  write('.frame/config.json', '{"version":"1.0"}');
  assert.equal(instructionDiscovery.scan(projectDir).legacyLayout, false);
});

// ─── read-only guarantee ──────────────────────────────────────

test('scanning changes nothing on disk — checksums and mtimes hold', (t) => {
  write('CLAUDE.md', '# claude\n');
  write('.cursorrules', 'rules\n');
  write('.cursor/rules/style.mdc', 'a\n');
  write('.github/copilot-instructions.md', '# copilot\n');
  write('tasks.json', '{"version":"2.0","tasks":[]}');
  write('AGENTS.md', '# agents\n');
  write('STRUCTURE.json', '{"modules":{}}');
  let symlinked = true;
  try {
    fs.symlinkSync('AGENTS.md', path.join(projectDir, 'GEMINI.md'));
  } catch (_) {
    symlinked = false;
  }

  const before = snapshot(projectDir);
  instructionDiscovery.scan(projectDir);
  instructionDiscovery.refresh(projectDir);
  instructionDiscovery.get(projectDir);
  const after = snapshot(projectDir);

  assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort());
  if (symlinked) {
    assert.ok(
      fs.lstatSync(path.join(projectDir, 'GEMINI.md')).isSymbolicLink(),
      'a symlinked instruction file was replaced'
    );
  }
});

test('scanning creates no files of its own', () => {
  write('CLAUDE.md', '# claude\n');
  instructionDiscovery.scan(projectDir);
  assert.deepEqual(fs.readdirSync(projectDir), ['CLAUDE.md']);
});

// ─── caching ──────────────────────────────────────────────────

test('get caches, refresh re-reads', () => {
  write('CLAUDE.md', '# claude\n');
  assert.deepEqual(kinds(instructionDiscovery.get(projectDir)), ['claude']);

  write('GEMINI.md', '# gemini\n');
  assert.deepEqual(kinds(instructionDiscovery.get(projectDir)), ['claude'], 'cache was not used');
  assert.deepEqual(kinds(instructionDiscovery.refresh(projectDir)), ['claude', 'gemini']);
  assert.deepEqual(kinds(instructionDiscovery.get(projectDir)), ['claude', 'gemini']);
});

test('scan(undefined) is inert', () => {
  const result = instructionDiscovery.scan(undefined);
  assert.deepEqual(result.nativeFiles, []);
  assert.equal(result.legacyLayout, false);
});

test('watching a project is safe to start and stop repeatedly', () => {
  instructionDiscovery.startWatching(projectDir);
  instructionDiscovery.startWatching(projectDir);
  instructionDiscovery.stopWatching(projectDir);
  instructionDiscovery.stopWatching(projectDir);
  instructionDiscovery.startWatching(path.join(projectDir, 'does-not-exist'));
});

test('a pre-overlay project carries .frame/config.json too — the root layout is the signal', () => {
  // What today's init actually produces: .frame/config.json *and* root files.
  // If legacy detection leaned on "no .frame/", it would never fire here.
  write('.frame/config.json', '{"version":"1.0"}');
  write('tasks.json', '{"version":"2.0","tasks":[]}');
  write('AGENTS.md', '# agents\n');
  write('STRUCTURE.json', '{"modules":{}}');

  assert.equal(instructionDiscovery.scan(projectDir).legacyLayout, true);
});
