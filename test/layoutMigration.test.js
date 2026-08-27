/**
 * layoutMigration tests (non-invasive-overlay T08/T09).
 *
 * Migration touches a user's repository, so the properties worth pinning are
 * the conservative ones: the fingerprint is narrow enough that a repo Frame
 * never initialized is left alone, an unmerged path defers with zero writes
 * while a merely modified one migrates with its content, every
 * moved file is byte-equal to its backup, a conflicting `.frame/` copy is
 * never overwritten, a consumed CLAUDE.md comes back verbatim, and a second
 * run finds nothing to do.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: { app: { getPath: () => os.tmpdir() }, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) return EXTERNAL_STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

const layoutMigration = require('../src/main/layoutMigration');
const frameStore = require('../src/main/frameStore');
const aiToolManager = require('../src/main/aiToolManager');
const templates = require('../src/shared/frameTemplates');
const { FRAME_DIR, FRAME_FILES } = require('../src/shared/frameConstants');

aiToolManager.getActiveTool = () => ({ id: 'claude', name: 'Claude Code' });

let projectDir;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

const AGENTS_BODY = `# demo — AI Instructions

## Project Navigation

1. **STRUCTURE.json** — module map, which file is where
2. **PROJECT_NOTES.md** — project vision, past decisions, session notes
3. **tasks.json** — pending tasks

| Before writing…  | Read in \`.frame/docs/REFERENCE.md\` |
| ---------------- | ------------------------------------ |
| tasks.json       | "Task Management" (schema + rules)   |
| PROJECT_NOTES.md | "PROJECT_NOTES.md Rules"             |
| STRUCTURE.json   | "STRUCTURE.json Rules"               |
| QUICKSTART.md    | "QUICKSTART.md Rules"                |

---

**Note:** This file is named \`AGENTS.md\` to be AI-tool agnostic. A \`CLAUDE.md\` symlink is provided for Claude Code compatibility.
`;

const USER_CLAUDE_MD = '# House rules\n\nIndent with tabs. Never force-push.\n';

/** A project as Frame's pre-overlay init left it. */
function makeLegacyProject({ withClaudeBlock = true, commit = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-migrate-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);

  fs.mkdirSync(path.join(dir, FRAME_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'config.json'), JSON.stringify({
    version: '1.0',
    name: 'demo',
    settings: { autoUpdateStructure: true },
    features: { specDriven: true },
    files: {
      agents: 'AGENTS.md',
      claudeSymlink: 'CLAUDE.md',
      structure: 'STRUCTURE.json',
      notes: 'PROJECT_NOTES.md',
      tasks: 'tasks.json',
      quickstart: 'QUICKSTART.md'
    }
  }, null, 2), 'utf8');

  const agents = withClaudeBlock
    ? `${AGENTS_BODY}\n---\n\n## Existing Instructions (from CLAUDE.md)\n\n${USER_CLAUDE_MD}`
    : AGENTS_BODY;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents, 'utf8');
  fs.writeFileSync(path.join(dir, 'STRUCTURE.json'), JSON.stringify({ modules: {} }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'PROJECT_NOTES.md'), '# Notes\n\n### [2026-01-01] Started\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ version: '2.0', tasks: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'QUICKSTART.md'), '# Quickstart\n', 'utf8');
  fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
  fs.symlinkSync('AGENTS.md', path.join(dir, 'GEMINI.md'));

  if (commit) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'frame init']);
  }
  return dir;
}

afterEach(() => {
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  projectDir = null;
});

test('a symlink-only repo Frame never initialized is not a migration candidate', () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-symlink-only-'));
  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), '# ours\n', 'utf8');
  fs.symlinkSync('AGENTS.md', path.join(projectDir, 'CLAUDE.md'));

  assert.equal(layoutMigration.plan(projectDir), null, 'no config.files record — never touched');

  // Even with a .frame/ config, an overlay-era one has no files record.
  frameStore.writeConfig(projectDir, { version: '1.0', projectId: 'x' });
  assert.equal(layoutMigration.plan(projectDir), null);
});

test('plan describes the move without writing anything', () => {
  projectDir = makeLegacyProject({ commit: true });
  const before = fs.readdirSync(projectDir).sort();

  const p = layoutMigration.plan(projectDir);
  assert.ok(p);
  assert.equal(p.canRun, true);
  assert.deepEqual(
    p.artifacts.map((a) => a.name).sort(),
    ['AGENTS.md', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'STRUCTURE.json', 'tasks.json']
  );
  assert.ok(p.artifacts.every((a) => a.disposition === 'move'));
  assert.deepEqual(p.symlinks.sort(), ['CLAUDE.md', 'GEMINI.md']);
  assert.equal(p.restorableClaudeMd, USER_CLAUDE_MD);
  assert.equal(p.sharingMode, 'repo', 'committed meta files mean the repo shares them');
  assert.deepEqual(fs.readdirSync(projectDir).sort(), before, 'plan() wrote nothing');
});

test('a modified meta file migrates, with the uncommitted content arriving in .frame/', () => {
  projectDir = makeLegacyProject({ commit: true });
  const edited = '# Notes\n\n### [2026-02-02] Uncommitted\n';
  fs.writeFileSync(path.join(projectDir, 'PROJECT_NOTES.md'), edited, 'utf8');

  const p = layoutMigration.plan(projectDir);
  assert.deepEqual(p.unmerged, [], 'a worktree modification is not unmerged');
  assert.equal(p.canRun, true);

  const receipt = layoutMigration.run(projectDir, p);
  assert.equal(receipt.ran, true);
  assert.equal(
    fs.readFileSync(path.join(projectDir, FRAME_DIR, 'PROJECT_NOTES.md'), 'utf8'),
    edited,
    'the version that moved is the one the user was editing'
  );
});

test('a staged-and-modified meta file migrates too', () => {
  projectDir = makeLegacyProject({ commit: true });
  const notes = path.join(projectDir, 'PROJECT_NOTES.md');
  fs.writeFileSync(notes, '# Notes\n\n### [2026-02-02] Staged\n', 'utf8');
  git(projectDir, ['add', 'PROJECT_NOTES.md']);
  const worktree = '# Notes\n\n### [2026-02-02] Staged\n### [2026-02-03] And then some\n';
  fs.writeFileSync(notes, worktree, 'utf8');

  const p = layoutMigration.plan(projectDir);
  assert.deepEqual(p.unmerged, [], 'MM is not unmerged');
  assert.equal(p.canRun, true);

  layoutMigration.run(projectDir, p);
  assert.equal(fs.readFileSync(path.join(projectDir, FRAME_DIR, 'PROJECT_NOTES.md'), 'utf8'), worktree);
});

test('an unmerged meta file moves nothing, including from a sub-directory project', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-monorepo-'));
  try {
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    git(repoDir, ['config', 'commit.gpgsign', 'false']);
    const appDir = path.join(repoDir, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });

    const legacy = makeLegacyProject({ commit: false });
    fs.cpSync(legacy, appDir, { recursive: true, dereference: false });
    fs.rmSync(path.join(appDir, '.git'), { recursive: true, force: true });
    fs.rmSync(legacy, { recursive: true, force: true });

    git(repoDir, ['add', '-A']);
    git(repoDir, ['commit', '-q', '-m', 'init']);

    // A real conflict: two branches edit PROJECT_NOTES.md, then merge.
    const notes = path.join(appDir, 'PROJECT_NOTES.md');
    git(repoDir, ['checkout', '-q', '-b', 'other']);
    fs.appendFileSync(notes, '\n### [2026-02-02] Theirs\n');
    git(repoDir, ['commit', '-q', '-a', '-m', 'theirs']);
    git(repoDir, ['checkout', '-q', '-']);
    fs.appendFileSync(notes, '\n### [2026-02-02] Ours\n');
    git(repoDir, ['commit', '-q', '-a', '-m', 'ours']);
    try {
      git(repoDir, ['merge', '--no-edit', 'other']);
    } catch (err) {
      /* the conflict is the point */
    }
    assert.ok(
      execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8' }).includes('UU '),
      'the fixture really is mid-merge'
    );

    const p = layoutMigration.plan(appDir);
    assert.deepEqual(p.unmerged, ['PROJECT_NOTES.md'], 'porcelain paths compared against show-prefix + rel');
    assert.equal(p.canRun, false);

    const before = fs.readdirSync(appDir).sort();
    const result = layoutMigration.run(appDir, p);
    assert.equal(result.ran, false);
    assert.equal(result.reason, 'unmerged');
    assert.deepEqual(result.unmerged, ['PROJECT_NOTES.md']);
    assert.deepEqual(fs.readdirSync(appDir).sort(), before, 'a deferred run writes nothing');
    assert.ok(!fs.existsSync(path.join(appDir, FRAME_DIR, 'migration-backup')));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('a full run moves every file, backs it up byte-equal, and clears the fingerprint', () => {
  projectDir = makeLegacyProject({ commit: true });
  const originals = {};
  for (const name of ['AGENTS.md', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'tasks.json', 'QUICKSTART.md']) {
    originals[name] = fs.readFileSync(path.join(projectDir, name));
  }

  const steps = [];
  const receipt = layoutMigration.run(projectDir, layoutMigration.plan(projectDir), (s) => steps.push(s.step));

  assert.equal(receipt.ran, true);
  assert.equal(receipt.moved.length, 5);
  assert.ok(steps.includes('move') && steps.includes('pointer') && steps.includes('hooks'));

  for (const [name, content] of Object.entries(originals)) {
    assert.ok(!fs.existsSync(path.join(projectDir, name)), `${name} left the project root`);
    const backup = fs.readFileSync(path.join(projectDir, FRAME_DIR, 'migration-backup', name));
    assert.ok(backup.equals(content), `${name} backup is byte-equal`);
    // Every file, AGENTS.md included: the automatic half relocates bytes and
    // rewrites nothing. The prose edit is a decision, not a move.
    const moved = fs.readFileSync(path.join(projectDir, FRAME_DIR, name));
    assert.ok(moved.equals(content), `${name} arrived byte-equal`);
  }

  assert.equal(frameStore.readConfig(projectDir).files, undefined, 'fingerprint cleared');
  assert.equal(frameStore.isLegacyLayout(projectDir), false);
  assert.match(frameStore.getProjectId(projectDir), /^[0-9a-f-]{36}$/);
});

test('the symlinks go and a consumed CLAUDE.md comes back verbatim', () => {
  projectDir = makeLegacyProject({ commit: true });
  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  assert.ok(!fs.existsSync(path.join(projectDir, 'GEMINI.md')), 'GEMINI.md symlink removed');
  const claudePath = path.join(projectDir, 'CLAUDE.md');
  assert.ok(fs.existsSync(claudePath));
  assert.equal(fs.lstatSync(claudePath).isSymbolicLink(), false, 'a real file, not a symlink');
  assert.equal(fs.readFileSync(claudePath, 'utf8'), USER_CLAUDE_MD, 'restored verbatim');
});

test('no consumed block means no CLAUDE.md is invented', () => {
  projectDir = makeLegacyProject({ withClaudeBlock: false, commit: true });
  const receipt = layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  assert.equal(receipt.claudeMdRestored, false);
  assert.ok(!fs.existsSync(path.join(projectDir, 'CLAUDE.md')), 'symlink removed, nothing put back');
});

test('the move leaves AGENTS.md alone; applyDecisions is what rewrites it', () => {
  projectDir = makeLegacyProject({ commit: true });
  const before = fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8');

  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));
  assert.equal(frameStore.readAgents(projectDir), before, 'the automatic half moved bytes, not prose');

  const receipt = layoutMigration.applyDecisions(projectDir, [{ kind: 'agents-prose' }]);
  assert.equal(receipt.ran, true);
  assert.deepEqual(receipt.applied, ['agents-prose']);

  const agents = frameStore.readAgents(projectDir);
  assert.match(agents, /1\. \*\*`\.frame\/STRUCTURE\.json`\*\*/);
  assert.match(agents, /\| `\.frame\/tasks\.json`/);
  assert.match(agents, /\.claude\/rules\/frame\.md/);
  assert.ok(!/A `CLAUDE\.md` symlink is provided/.test(agents), 'symlink note replaced');
  assert.match(agents, /## Existing Instructions \(from CLAUDE\.md\)/, 'user content in AGENTS.md survives');

  // Applying it twice changes nothing more — the second pass finds the text
  // already upgraded and writes nothing.
  const again = layoutMigration.applyDecisions(projectDir, ['agents-prose']);
  assert.equal(again.ran, false);
  assert.equal(frameStore.readAgents(projectDir), agents);
});

test('applyDecisions leaves a customised AGENTS.md alone and lists it for review', () => {
  projectDir = makeLegacyProject({ commit: true });
  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));
  frameStore.writeAgents(projectDir, '# My own file\n\nNothing Frame wrote.\n');

  const receipt = layoutMigration.applyDecisions(projectDir, [{ kind: 'agents-prose' }]);
  assert.equal(receipt.ran, false, 'no line matched, so nothing was written');
  assert.ok(receipt.review.length > 0, 'and every line it could not find is named');
  assert.equal(frameStore.readAgents(projectDir), '# My own file\n\nNothing Frame wrote.\n');

  // An empty decision list is a no-op, whatever the project looks like.
  assert.deepEqual(layoutMigration.applyDecisions(projectDir, []).applied, []);
});

test('pendingDecisions derives the prose decision from the text, not the fingerprint', () => {
  projectDir = makeLegacyProject({ commit: true });

  // While the layout question is unsettled, nothing is asked — a project on
  // the legacy layout may not be asked to rewrite a root file.
  assert.deepEqual(layoutMigration.pendingDecisions(projectDir), []);

  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  // Stale prose: the file moved untouched, so its old paths are still there.
  const pending = layoutMigration.pendingDecisions(projectDir);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'agents-prose');
  assert.ok(pending[0].symlinkNote, 'the old symlink note is one of the edits');
  assert.deepEqual(
    pending[0].edits.map((e) => e.from).sort(),
    ['1. **STRUCTURE.json**', '2. **PROJECT_NOTES.md**', '3. **tasks.json**',
      '| PROJECT_NOTES.md', '| QUICKSTART.md', '| STRUCTURE.json', '| tasks.json'].sort()
  );
  assert.deepEqual(pending[0].review, [], 'this fixture matches every line Frame wrote');

  // Deriving it twice does not write, so the answer is stable.
  assert.equal(layoutMigration.pendingDecisions(projectDir).length, 1);

  // Once applied, the derivation empties itself — nothing records the answer.
  layoutMigration.applyDecisions(projectDir, pending);
  assert.deepEqual(layoutMigration.pendingDecisions(projectDir), []);
});

test('a fresh project is asked nothing, and reading it writes nothing', () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-fresh-'));
  frameStore.writeConfig(projectDir, { version: '2.0', name: 'fresh', projectId: 'x' });
  frameStore.writeAgents(projectDir, templates.getAgentsTemplate('fresh', {}));

  const before = fs.readdirSync(projectDir).sort();
  const frameBefore = fs.readdirSync(path.join(projectDir, FRAME_DIR)).sort();

  assert.deepEqual(layoutMigration.pendingDecisions(projectDir), [], 'the current template needs no edits');
  assert.deepEqual(fs.readdirSync(projectDir).sort(), before, 'pendingDecisions wrote nothing');
  assert.deepEqual(fs.readdirSync(path.join(projectDir, FRAME_DIR)).sort(), frameBefore);

  // A project with no AGENTS.md at all is not a question either.
  fs.rmSync(path.join(projectDir, FRAME_DIR, FRAME_FILES.AGENTS));
  assert.deepEqual(layoutMigration.pendingDecisions(projectDir), []);
});

test('a conflicting .frame/ copy is backed up, never overwritten', () => {
  projectDir = makeLegacyProject({ commit: true });
  const overlayNotes = path.join(projectDir, FRAME_DIR, 'PROJECT_NOTES.md');
  fs.writeFileSync(overlayNotes, '# Different notes already in .frame/\n', 'utf8');
  const identical = path.join(projectDir, FRAME_DIR, 'QUICKSTART.md');
  fs.writeFileSync(identical, fs.readFileSync(path.join(projectDir, 'QUICKSTART.md')));

  const p = layoutMigration.plan(projectDir);
  const byName = Object.fromEntries(p.artifacts.map((a) => [a.name, a.disposition]));
  assert.equal(byName['PROJECT_NOTES.md'], 'backup-conflict');
  assert.equal(byName['QUICKSTART.md'], 'delete-identical');

  const receipt = layoutMigration.run(projectDir, p);
  assert.equal(fs.readFileSync(overlayNotes, 'utf8'), '# Different notes already in .frame/\n', 'not overwritten');
  assert.ok(receipt.review.some((r) => r.includes('PROJECT_NOTES.md')), 'conflict is on the receipt');
  assert.ok(fs.existsSync(path.join(projectDir, FRAME_DIR, 'migration-backup', 'PROJECT_NOTES.md')));
  assert.ok(!receipt.moved.includes('PROJECT_NOTES.md'));
});

test('a .bak sibling travels into the backup instead of staying at the root', () => {
  projectDir = makeLegacyProject({ commit: true });
  fs.writeFileSync(path.join(projectDir, 'tasks.json.bak'), '{"version":"2.0","tasks":[]}', 'utf8');

  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  assert.ok(!fs.existsSync(path.join(projectDir, 'tasks.json.bak')), 'no Frame residue at the root');
  assert.ok(fs.existsSync(path.join(projectDir, FRAME_DIR, 'migration-backup', 'tasks.json.bak')));
});

test('hook entries are replaced with the guarded form', () => {
  projectDir = makeLegacyProject({ commit: true });
  fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node .frame/bin/spec-hint.js prompt' }] }],
      PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node .frame/bin/spec-hint.js pre-edit' }] }]
    }
  }, null, 2), 'utf8');

  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  const settings = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  assert.equal(commands.length, 6);
  assert.ok(commands.every((c) => /^sh -c '\[ ! -f \.frame\/bin\/(spec|module|docs|spec-command)-hint\.js \] \|\|/.test(c)), 'guard exits 0');
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)'], 'the rest of the file survives');
});

test('a hand-wired spec-hint hook is left alone, not doubled up', () => {
  // Frame's own repository runs `node scripts/spec-hint.js`. Migration must
  // not add its .frame/bin entries beside it: the hint would run twice.
  projectDir = makeLegacyProject({ commit: true });
  fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  const own = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node scripts/spec-hint.js prompt' }] }]
    }
  };
  fs.writeFileSync(settingsPath, JSON.stringify(own, null, 4) + '\n', 'utf8');

  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  const after = fs.readFileSync(settingsPath, 'utf8');
  assert.equal(after, JSON.stringify(own, null, 4) + '\n', 'byte-identical: no entries, no reflow');
});

test('a second run is a no-op, and an interrupted one reconciles', () => {
  projectDir = makeLegacyProject({ commit: true });
  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  assert.equal(layoutMigration.plan(projectDir), null, 'no fingerprint left to find');
  const second = layoutMigration.run(projectDir);
  assert.equal(second.ran, false);
  assert.equal(second.reason, 'no-fingerprint');

  // Interrupted run: the record is still there and one file is still at the
  // root, exactly as HEAD has it (the crash landed between copy and unlink).
  // Planning again picks up that file and nothing else.
  const config = frameStore.readConfig(projectDir);
  config.files = { tasks: 'tasks.json', notes: 'PROJECT_NOTES.md' };
  frameStore.writeConfig(projectDir, config);
  fs.writeFileSync(
    path.join(projectDir, 'tasks.json'),
    JSON.stringify({ version: '2.0', tasks: [] }, null, 2),
    'utf8'
  );

  const p = layoutMigration.plan(projectDir);
  assert.deepEqual(p.artifacts.map((a) => a.name), ['tasks.json']);
  const receipt = layoutMigration.run(projectDir, p);
  assert.equal(receipt.ran, true);
  assert.equal(frameStore.readConfig(projectDir).files, undefined);
});

test('the receipt carries what the modal shows', () => {
  projectDir = makeLegacyProject({ commit: true });
  const receipt = layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  assert.deepEqual(Object.keys(receipt).sort(), [
    'backedUp', 'backupDir', 'claudeMdRestored', 'moved', 'ran', 'review', 'sharingMode', 'symlinksRemoved'
  ]);
  assert.equal(receipt.backupDir, '.frame/migration-backup');
  assert.equal(receipt.sharingMode, 'repo');
  assert.deepEqual(receipt.symlinksRemoved.sort(), ['CLAUDE.md', 'GEMINI.md']);
});

test('an untracked legacy project migrates to local sharing', () => {
  projectDir = makeLegacyProject({ commit: false });
  const p = layoutMigration.plan(projectDir);
  assert.deepEqual(p.tracked, []);
  assert.equal(p.sharingMode, 'local');

  const receipt = layoutMigration.run(projectDir, p);
  assert.equal(receipt.sharingMode, 'local');
  assert.equal(frameStore.readConfig(projectDir).settings.gitSharing, 'local');
});

test('the plan payload has the shape the modal renders from', () => {
  projectDir = makeLegacyProject({ commit: true });
  const p = layoutMigration.plan(projectDir);

  assert.deepEqual(Object.keys(p).sort(), [
    'artifacts', 'backupDir', 'canRun', 'projectPath',
    'restorableClaudeMd', 'sharingMode', 'symlinks', 'tracked', 'unmerged'
  ]);
  for (const artifact of p.artifacts) {
    assert.deepEqual(Object.keys(artifact).sort(), ['disposition', 'name']);
    assert.ok(['move', 'delete-identical', 'backup-conflict', 'replace-invalid', 'backup-only'].includes(artifact.disposition));
  }
});

test('the layout answer distinguishes none, legacy and overlay', () => {
  // What CHECK_IS_FRAME_PROJECT computes, and what opens the modal.
  const layoutOf = (dir) => {
    if (!fs.existsSync(path.join(dir, FRAME_DIR, 'config.json'))) return 'none';
    return frameStore.isLegacyLayout(dir) ? 'legacy' : 'overlay';
  };

  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-plain-'));
  try {
    assert.equal(layoutOf(plainDir), 'none');
  } finally {
    fs.rmSync(plainDir, { recursive: true, force: true });
  }

  projectDir = makeLegacyProject({ commit: true });
  assert.equal(layoutOf(projectDir), 'legacy', 'the modal is offered');

  layoutMigration.run(projectDir, layoutMigration.plan(projectDir));
  assert.equal(layoutOf(projectDir), 'overlay', 'and never again after migrating');
});

test('"Later" leaves the project untouched and still working', () => {
  projectDir = makeLegacyProject({ commit: true });
  const before = fs.readdirSync(projectDir).sort();

  // Later = the renderer closes the modal. Nothing in main runs, so the only
  // thing that must hold is that the project keeps reading its root files.
  layoutMigration.plan(projectDir);

  assert.deepEqual(fs.readdirSync(projectDir).sort(), before);
  assert.equal(frameStore.getTasks(projectDir).data.version, '2.0', 'tasks still load from the root');
  assert.ok(frameStore.readAgents(projectDir).includes('AI Instructions'));
  assert.equal(frameStore.isLegacyLayout(projectDir), true);
});

test('the symlink note is replaced whole, however it was wrapped', () => {
  // Frame's own AGENTS.md carries it as a two-line blockquote; older
  // templates wrote it as one long line. Matching only the first line left
  // the continuation behind — the bug that migrating this repo surfaced.
  const blockquote = [
    '# Project',
    '',
    '> **Note:** This file is named `AGENTS.md` to be AI-tool agnostic. A',
    '> `CLAUDE.md` symlink is provided for Claude Code compatibility.',
    '',
    '## Next section',
    ''
  ].join('\n');

  const upgraded = layoutMigration.upgradeAgentsText(blockquote);
  assert.ok(!upgraded.text.includes('symlink is provided'), 'no orphaned continuation line');
  assert.match(upgraded.text, /> \*\*Note:\*\* This file lives at `\.frame\/AGENTS\.md`/);
  assert.match(upgraded.text, /> edit this file, never the copy/, 'replacement keeps the blockquote prefix');
  assert.match(upgraded.text, /\n## Next section/, 'the rest of the document is intact');

  const oneLine = '# P\n\n**Note:** This file is named `AGENTS.md` to be AI-tool agnostic. A `CLAUDE.md` symlink is provided for Claude Code compatibility.\n\n## After\n';
  const flat = layoutMigration.upgradeAgentsText(oneLine);
  assert.ok(!flat.text.includes('symlink is provided'));
  assert.match(flat.text, /\n## After/);
});

test('a differing .frame/AGENTS.md does not cost the user their CLAUDE.md', () => {
  // plan() used to read the consumed block through frameStore, which is
  // overlay-first: a .frame/AGENTS.md from a teammate or a half-finished run
  // won, the block was never found, and the CLAUDE.md the symlink stood for
  // was silently gone.
  projectDir = makeLegacyProject({ commit: true });
  fs.writeFileSync(
    path.join(projectDir, FRAME_DIR, 'AGENTS.md'),
    '# Someone else\'s AGENTS.md\n\nNo consumed block in here.\n',
    'utf8'
  );

  const p = layoutMigration.plan(projectDir);
  assert.equal(p.restorableClaudeMd, USER_CLAUDE_MD, 'the block is read from the root file');

  const receipt = layoutMigration.run(projectDir, p);
  assert.equal(receipt.claudeMdRestored, true);
  assert.equal(fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8'), USER_CLAUDE_MD);
});

test('a symlink with nothing to restore says so on the receipt', () => {
  projectDir = makeLegacyProject({ withClaudeBlock: false, commit: true });
  const receipt = layoutMigration.run(projectDir, layoutMigration.plan(projectDir));

  assert.equal(receipt.claudeMdRestored, false);
  assert.ok(
    receipt.review.some((r) => r.includes('CLAUDE.md') && r.includes('nothing to restore')),
    `the receipt is not silent: ${JSON.stringify(receipt.review)}`
  );
});

test('an empty or unparseable .frame/ copy never wins the conflict', () => {
  projectDir = makeLegacyProject({ commit: true });
  const emptyNotes = path.join(projectDir, FRAME_DIR, 'PROJECT_NOTES.md');
  fs.writeFileSync(emptyNotes, '   \n', 'utf8');
  const brokenTasks = path.join(projectDir, FRAME_DIR, 'tasks.json');
  fs.writeFileSync(brokenTasks, '{"version": "2.0", "tasks": [', 'utf8');

  const p = layoutMigration.plan(projectDir);
  const byName = Object.fromEntries(p.artifacts.map((a) => [a.name, a.disposition]));
  assert.equal(byName['PROJECT_NOTES.md'], 'replace-invalid');
  assert.equal(byName['tasks.json'], 'replace-invalid');

  const receipt = layoutMigration.run(projectDir, p);
  assert.ok(receipt.moved.includes('tasks.json'), 'the root copy took its place');
  assert.equal(frameStore.getTasks(projectDir).data.version, '2.0', 'and it is the real one');
  assert.match(fs.readFileSync(emptyNotes, 'utf8'), /### \[2026-01-01\] Started/);

  const backup = path.join(projectDir, FRAME_DIR, 'migration-backup');
  assert.ok(fs.existsSync(path.join(backup, 'tasks.json.unusable')), 'the bad overlay is kept');
  assert.ok(fs.existsSync(path.join(backup, 'tasks.json')), 'and so is the root copy');
  assert.ok(receipt.review.some((r) => r.includes('tasks.json')), 'both are on the receipt');
});

test('a mid-run failure returns a truthful partial receipt', () => {
  projectDir = makeLegacyProject({ commit: true });
  const p = layoutMigration.plan(projectDir);

  // Break step 4 (the pointer write) the way a permission problem would.
  const frameProject = require('../src/main/frameProject');
  const original = frameProject.syncClaudeRule;
  frameProject.syncClaudeRule = () => { throw new Error('disk on fire'); };
  let receipt;
  try {
    receipt = layoutMigration.run(projectDir, p);
  } finally {
    frameProject.syncClaudeRule = original;
  }

  assert.equal(receipt.ran, true, 'files did move — "did not run" would be a lie');
  assert.equal(receipt.failedAt, 'pointer');
  assert.match(receipt.error, /disk on fire/);
  assert.equal(receipt.moved.length, 5, 'and the receipt names what got through');
  assert.ok(fs.existsSync(path.join(projectDir, FRAME_DIR, 'tasks.json')));
});
