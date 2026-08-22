/**
 * layoutMigration — move a pre-overlay project's meta files into `.frame/`
 *
 * Only ever with consent: `plan()` is pure (it reads, it never writes) so the
 * modal can show exactly what will happen, and `run()` executes a plan the
 * user clicked through. "Later" leaves the project untouched and working —
 * frameStore's legacy fallback keeps reading the root files.
 *
 * The fingerprint is deliberately narrow: `config.files` (Frame's own init
 * signature) **and** at least one listed file at the project root. A
 * `CLAUDE.md → AGENTS.md` symlink is not proof of anything — it is a public
 * convention, and plenty of repos have one Frame never wrote.
 *
 * Losing a file here would be unforgivable, so every move is: copy to
 * `.frame/migration-backup/<name>`, copy to `.frame/<name>`, compare bytes,
 * and only then unlink the root copy. A `.frame/` counterpart that already
 * exists and differs is never overwritten — the root copy goes to the backup
 * and onto the receipt's review list instead.
 *
 * Idempotent by construction: after a successful run the `files` record is
 * gone, so a second `plan()` finds no fingerprint and reports nothing to do.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const fsSafe = require('./fsSafe');
const frameStore = require('./frameStore');
const gitExclude = require('./gitExclude');
const gitSharing = require('./gitSharing');
const structureBootstrap = require('./structureBootstrap');
const templates = require('../shared/frameTemplates');
const {
  FRAME_DIR,
  FRAME_FILES,
  LEGACY_SYMLINKS,
  MIGRATION_BACKUP_DIR,
  CLAUDE_RULE_PATH
} = require('../shared/frameConstants');

let activityLog = null;

function init({ activityLog: log } = {}) {
  activityLog = log || null;
}

function record(event, fields) {
  try {
    if (activityLog) activityLog.record(event, fields);
  } catch (err) {
    /* bookkeeping never breaks a migration */
  }
}

function git(projectPath, args) {
  try {
    return execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (err) {
    return null;
  }
}

// ─── Plan (pure) ──────────────────────────────────────────────

/** The meta names this project's config claims, in a stable order. */
function legacyNames(config) {
  if (!config || !config.files || typeof config.files !== 'object') return [];
  const listed = Object.values(config.files).filter((n) => typeof n === 'string' && n);
  // The symlinks are handled separately — they are removed, never moved.
  return [...new Set(listed)].filter((n) => !LEGACY_SYMLINKS.includes(n));
}

function sameBytes(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (err) {
    return false;
  }
}

/**
 * Is this a Frame-planted symlink? Only when it is a symlink whose target's
 * basename is AGENTS.md. A real file with content is the user's, always.
 */
function isFramePlantedSymlink(file) {
  try {
    if (!fs.lstatSync(file).isSymbolicLink()) return false;
    return path.basename(fs.readlinkSync(file)) === FRAME_FILES.AGENTS;
  } catch (err) {
    return false;
  }
}

/**
 * The `## Existing Instructions (from CLAUDE.md)` block old inits appended to
 * AGENTS.md, verbatim. Returns null when there is none — a project whose
 * CLAUDE.md Frame never consumed has nothing to restore.
 */
function extractClaudeBlock(agentsText) {
  if (!agentsText) return null;
  const heading = '## Existing Instructions (from CLAUDE.md)';
  const start = agentsText.indexOf(heading);
  if (start === -1) return null;

  const bodyStart = start + heading.length;
  // The block ends at the next "---" separator that introduces another
  // "## Existing Instructions" section, or at end of file.
  const rest = agentsText.slice(bodyStart);
  const nextBlock = rest.search(/\n-{3,}\n\s*## Existing Instructions \(from /);
  const body = nextBlock === -1 ? rest : rest.slice(0, nextBlock);
  return body.replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n';
}

/**
 * Files with uncommitted changes, compared repo-root-relative so a project in
 * a sub-directory is covered. Untracked entries (`??`) are not dirty: nothing
 * committed can be lost by moving a file git never knew about, and in an
 * unshared project every meta file is untracked — treating those as dirty
 * would make migration impossible exactly where it is safest.
 *
 * Returns [] outside git (nothing to defer for).
 */
function dirtyAmong(projectPath, relPaths) {
  if (!gitExclude.isGitRepo(projectPath)) return [];
  const porcelain = git(projectPath, ['status', '--porcelain', '--', ...relPaths]);
  if (!porcelain) return [];

  const prefix = git(projectPath, ['rev-parse', '--show-prefix']) || '';
  const dirty = new Set();
  for (const raw of porcelain.split('\n')) {
    const line = raw.trimStart();
    if (!line) continue;
    if (line.startsWith('??')) continue; // untracked — see above
    // "XY <path>", and for renames "XY <old> -> <new>". Matched rather than
    // sliced at a fixed column: a leading status space is easy to lose (the
    // git helper trims), which would shift every path by one character.
    const match = line.match(/^[A-Z?!]{1,2}\s+(.*)$/);
    if (!match) continue;
    const listed = match[1].split(' -> ').pop().replace(/^"|"$/g, '');
    for (const rel of relPaths) {
      if (listed === `${prefix}${rel}` || listed === rel) dirty.add(rel);
    }
  }
  return [...dirty];
}

/** Which of these paths git already tracks (decides the sharing posture). */
function trackedAmong(projectPath, relPaths) {
  if (!gitExclude.isGitRepo(projectPath)) return [];
  const listed = git(projectPath, ['ls-files', '--cached', '--', ...relPaths]);
  if (!listed) return [];
  const prefix = git(projectPath, ['rev-parse', '--show-prefix']) || '';
  return listed
    .split('\n')
    .map((l) => (prefix && l.startsWith(prefix) ? l.slice(prefix.length) : l))
    .filter((l) => relPaths.includes(l));
}

/**
 * Describe what migrating this project would do. Pure: no writes, no git
 * mutation. Returns null when the project shows no legacy fingerprint.
 *
 * Dispositions:
 *   move             — root file goes to .frame/ (with a backup first)
 *   delete-identical — .frame/ already has a byte-identical copy; the root
 *                      copy is redundant and is backed up, then removed
 *   backup-conflict  — .frame/ has a *different* copy; the root file is
 *                      backed up and reported, and nothing is overwritten
 */
function plan(projectPath) {
  const config = frameStore.readConfig(projectPath);
  const names = legacyNames(config);
  if (names.length === 0) return null;

  const artifacts = [];
  for (const name of names) {
    const rootPath = path.join(projectPath, name);
    if (!fs.existsSync(rootPath)) continue;
    if (isFramePlantedSymlink(rootPath)) continue; // handled as a symlink

    const overlayPath = path.join(projectPath, FRAME_DIR, name);
    let disposition = 'move';
    if (fs.existsSync(overlayPath)) {
      disposition = sameBytes(rootPath, overlayPath) ? 'delete-identical' : 'backup-conflict';
    }
    artifacts.push({ name, disposition });

    // A `.bak` Frame's own atomic writes left beside the file is Frame's too:
    // it travels into the backup rather than staying at the project root.
    if (fs.existsSync(`${rootPath}.bak`)) {
      artifacts.push({ name: `${name}.bak`, disposition: 'backup-only' });
    }
  }

  if (artifacts.length === 0) return null;

  const symlinks = LEGACY_SYMLINKS
    .filter((name) => isFramePlantedSymlink(path.join(projectPath, name)));

  const agentsText = frameStore.readAgents(projectPath);
  const restorableClaudeMd = symlinks.includes(FRAME_FILES.CLAUDE_SYMLINK)
    ? extractClaudeBlock(agentsText)
    : null;

  const rels = artifacts.map((a) => a.name);
  const dirty = dirtyAmong(projectPath, rels);
  const tracked = trackedAmong(projectPath, rels);

  return {
    projectPath,
    artifacts,
    symlinks,
    restorableClaudeMd,
    dirty,
    tracked,
    backupDir: `${FRAME_DIR}/${MIGRATION_BACKUP_DIR}`,
    // Derived, not asked: a project whose meta files are committed clearly
    // shares them; one where they were never tracked stays local.
    sharingMode: tracked.length > 0 ? 'repo' : 'local',
    canRun: dirty.length === 0
  };
}

// ─── Run ──────────────────────────────────────────────────────

function copyVerified(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fsSafe.writeFileAtomic(to, fs.readFileSync(from));
  if (!sameBytes(from, to)) throw new Error(`copy of ${path.basename(from)} did not verify`);
}

/**
 * The AGENTS.md lines the old templates wrote, and their `.frame/` forms. A
 * line that isn't found is left alone and named in the receipt's review list:
 * people customise AGENTS.md, and a full rewrite would be hostile.
 */
const AGENTS_LINE_EDITS = [
  ['1. **STRUCTURE.json**', '1. **`.frame/STRUCTURE.json`**'],
  ['2. **PROJECT_NOTES.md**', '2. **`.frame/PROJECT_NOTES.md`**'],
  ['3. **tasks.json**', '3. **`.frame/tasks.json`**'],
  ['| tasks.json  ', '| `.frame/tasks.json`  '],
  ['| PROJECT_NOTES.md ', '| `.frame/PROJECT_NOTES.md` '],
  ['| STRUCTURE.json ', '| `.frame/STRUCTURE.json` '],
  ['| QUICKSTART.md ', '| `.frame/QUICKSTART.md` ']
];

// The whole note paragraph, however it is wrapped: templates have written it
// as one long line, as several wrapped lines, and as a blockquote. Matching a
// single line left the continuation behind and produced a mangled paragraph —
// found migrating Frame's own repository.
const AGENTS_SYMLINK_NOTE = /(^|\n)([ \t]*>?[ \t]*)\*\*Note:\*\* This file is named `AGENTS\.md`[\s\S]*?(?=\n[ \t]*\n|$)/;

const AGENTS_POINTER_NOTE = [
  '**Note:** This file lives at `.frame/AGENTS.md` and is named `AGENTS.md` to be',
  'AI-tool agnostic. Claude Code reaches it through `.claude/rules/frame.md`,',
  'which imports this file; delete that pointer to detach.'
];

function upgradeAgentsText(text) {
  if (!text) return { text, review: ['AGENTS.md (not found)'] };
  let next = text;
  const review = [];

  for (const [from, to] of AGENTS_LINE_EDITS) {
    if (next.includes(from)) next = next.replace(from, to);
    else review.push(from.trim());
  }

  const match = next.match(AGENTS_SYMLINK_NOTE);
  if (match) {
    // Keep whatever prefix the note carried (a blockquote marker, indentation)
    // so the replacement sits in the document the same way the original did.
    const prefix = match[2] || '';
    const quoted = AGENTS_POINTER_NOTE.map((line) => `${prefix}${line}`).join('\n');
    next = next.replace(AGENTS_SYMLINK_NOTE, `${match[1]}${quoted}`);
  } else {
    review.push('the CLAUDE.md symlink note');
  }

  return { text: next, review };
}

/**
 * Execute a plan. Reports progress through `onProgress({ step, detail })` and
 * returns a receipt: what moved, what was backed up, what needs a human look.
 */
function run(projectPath, migrationPlan, onProgress = () => {}) {
  const started = Date.now();
  const activePlan = migrationPlan || plan(projectPath);

  if (!activePlan) {
    record('migration.skipped', { reason: 'no-fingerprint' });
    return { ran: false, reason: 'no-fingerprint', moved: [], backedUp: [], review: [] };
  }
  if (!activePlan.canRun) {
    record('migration.skipped', { reason: 'dirty-tree' });
    return { ran: false, reason: 'dirty-tree', dirty: activePlan.dirty, moved: [], backedUp: [], review: [] };
  }

  const frameDir = path.join(projectPath, FRAME_DIR);
  const backupDir = path.join(frameDir, MIGRATION_BACKUP_DIR);
  fs.mkdirSync(backupDir, { recursive: true });

  const moved = [];
  const backedUp = [];
  const review = [];

  // 1. The files themselves. Backup first, always — even for the copies that
  //    only get deleted, so an interrupted run can always be reconstructed.
  for (const artifact of activePlan.artifacts) {
    const rootPath = path.join(projectPath, artifact.name);
    if (!fs.existsSync(rootPath)) continue;
    onProgress({ step: 'move', detail: artifact.name });

    copyVerified(rootPath, path.join(backupDir, artifact.name));
    backedUp.push(artifact.name);

    if (artifact.disposition === 'move') {
      copyVerified(rootPath, path.join(frameDir, artifact.name));
      moved.push(artifact.name);
    } else if (artifact.disposition === 'backup-conflict') {
      review.push(`${artifact.name} differs from the copy already in .frame/ — the root version is in ${activePlan.backupDir}/`);
      record('migration.conflict', { path: artifact.name });
    }
    fs.unlinkSync(rootPath);
  }

  // 2. Frame-planted symlinks come out; a real CLAUDE.md is restored from the
  //    block old inits folded into AGENTS.md, verbatim.
  for (const name of activePlan.symlinks) {
    onProgress({ step: 'symlink', detail: name });
    try {
      fs.unlinkSync(path.join(projectPath, name));
    } catch (err) {
      review.push(`could not remove the ${name} symlink: ${err.message}`);
    }
  }
  if (activePlan.restorableClaudeMd) {
    const claudePath = path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK);
    if (!fs.existsSync(claudePath)) {
      fs.writeFileSync(claudePath, activePlan.restorableClaudeMd, 'utf8');
      onProgress({ step: 'restore', detail: FRAME_FILES.CLAUDE_SYMLINK });
    }
  }

  // 3. AGENTS.md now resolves to .frame/ — point its own prose there too.
  const agentsText = frameStore.readAgents(projectPath);
  const upgraded = upgradeAgentsText(agentsText);
  if (upgraded.text && upgraded.text !== agentsText) {
    frameStore.writeAgents(projectPath, upgraded.text);
  }
  for (const item of upgraded.review) {
    review.push(`AGENTS.md: could not find ${item} — check it by hand`);
  }

  // 4. The pointer, the identity, and the end of the fingerprint.
  onProgress({ step: 'pointer', detail: CLAUDE_RULE_PATH });
  require('./frameProject').ensureClaudePointer(projectPath);
  frameStore.ensureProjectId(projectPath);

  const config = frameStore.readConfig(projectPath) || {};
  delete config.files; // the fingerprint: gone, so a second plan() finds nothing
  config.settings = config.settings || {};
  config.settings.gitSharing = activePlan.sharingMode;
  frameStore.writeConfig(projectPath, config);

  // 5. Hook entries: replace the old unguarded commands with the guarded ones
  //    in the file this sharing mode uses.
  onProgress({ step: 'hooks', detail: gitSharing.hookFileFor(activePlan.sharingMode) });
  const frameProject = require('./frameProject');
  for (const file of ['settings.json', 'settings.local.json']) {
    frameProject.removeSpecHintHook(projectPath, { file });
  }
  frameProject.installSpecHintHook(projectPath, { file: gitSharing.hookFileFor(activePlan.sharingMode) });

  // 6. Sharing posture + a refreshed set of staged scripts (the old copies
  //    resolve their project as `.frame/`, which is the bug T03 fixed).
  onProgress({ step: 'sharing', detail: activePlan.sharingMode });
  gitSharing.setMode(projectPath, activePlan.sharingMode);
  try {
    structureBootstrap.copyParserScripts(projectPath);
  } catch (err) {
    review.push(`could not refresh .frame/bin scripts: ${err.message}`);
  }

  record('migration.completed', {
    moved: moved.length,
    backedUp: backedUp.length,
    review: review.length,
    ms: Date.now() - started
  });

  return {
    ran: true,
    moved,
    backedUp,
    review,
    backupDir: activePlan.backupDir,
    sharingMode: activePlan.sharingMode,
    claudeMdRestored: Boolean(activePlan.restorableClaudeMd),
    symlinksRemoved: activePlan.symlinks
  };
}

module.exports = {
  init,
  plan,
  run,
  // exported for tests and for the receipt's prose
  extractClaudeBlock,
  upgradeAgentsText,
  isFramePlantedSymlink,
  AGENTS_LINE_EDITS
};
