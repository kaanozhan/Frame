/**
 * layoutMigration — move a pre-overlay project's meta files into `.frame/`
 *
 * Two halves, split by who owns the file. `plan()` / `run()` are the automatic
 * half: Frame's own meta files relocate, backed up and byte-verified, and the
 * user is told afterwards rather than asked beforehand. `applyDecisions()` is
 * the asked half — the one thing that is genuinely the user's call, rewriting
 * their `AGENTS.md` prose. `plan()` stays pure (it reads, it never writes) so
 * the automatic half can be described before it runs.
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
 * The AGENTS.md a *legacy* init wrote, which is the one at the project root —
 * read directly, never through frameStore's overlay-first resolution. A
 * project that also carries a `.frame/AGENTS.md` (a half-finished migration, a
 * teammate's copy) would otherwise hand back the wrong file, and the user's
 * consumed CLAUDE.md would silently fail to come back.
 */
function readRootAgents(projectPath) {
  try {
    return fs.readFileSync(path.join(projectPath, FRAME_FILES.AGENTS), 'utf8');
  } catch (err) {
    return frameStore.readAgents(projectPath);
  }
}

/**
 * A `.frame/` counterpart that cannot be what the project meant to keep: an
 * empty file, or a `.json` that does not parse. Frame's own interrupted writes
 * look exactly like this, and letting one win a conflict would leave the user
 * with an empty tasks.json and their real one in a backup folder.
 */
function isUnusableCopy(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return true;
  }
  if (text.trim() === '') return true;
  if (file.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch (err) {
      return true;
    }
  }
  return false;
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
 * Files in an unmerged state — the only dirtiness that can actually lose
 * something. Moving a modified or staged file loses nothing: the content
 * travels into `.frame/`, and the pre-move blob stays readable in the index
 * and in HEAD. An unmerged path is different — unlink the root copy and
 * `git merge --continue` refuses to commit, and the merge itself is gone.
 *
 * Untracked entries (`??`) were never dirty for this purpose, and in an
 * unshared project every meta file is untracked.
 *
 * Returns [] outside git (nothing to defer for).
 */
function isUnmergedCode(code) {
  // DD, AU, UD, UA, DU, AA, UU — every code carrying a `U`, plus the two
  // both-sides codes that carry none.
  return code.includes('U') || code === 'DD' || code === 'AA';
}

function unmergedAmong(projectPath, relPaths) {
  if (!gitExclude.isGitRepo(projectPath)) return [];
  const porcelain = git(projectPath, ['status', '--porcelain', '--', ...relPaths]);
  if (!porcelain) return [];

  const prefix = git(projectPath, ['rev-parse', '--show-prefix']) || '';
  const unmerged = new Set();
  for (const raw of porcelain.split('\n')) {
    const line = raw.trimStart();
    if (!line) continue;
    // "XY <path>". Every unmerged code is two letters with no space in it, so
    // the trimming the git helper does above cannot have eaten half of one —
    // which is why matching a two-letter code here is safe where slicing at a
    // fixed column would not be.
    const match = line.match(/^([A-Z?!]{2})\s+(.*)$/);
    if (!match || !isUnmergedCode(match[1])) continue;
    const listed = match[2].split(' -> ').pop().replace(/^"|"$/g, '');
    for (const rel of relPaths) {
      if (listed === `${prefix}${rel}` || listed === rel) unmerged.add(rel);
    }
  }
  return [...unmerged];
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
 *   replace-invalid  — the .frame/ copy is empty or unparseable; it goes to
 *                      the backup and the root file takes its place
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
      if (sameBytes(rootPath, overlayPath)) disposition = 'delete-identical';
      else if (isUnusableCopy(overlayPath)) disposition = 'replace-invalid';
      else disposition = 'backup-conflict';
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

  const restorableClaudeMd = symlinks.includes(FRAME_FILES.CLAUDE_SYMLINK)
    ? extractClaudeBlock(readRootAgents(projectPath))
    : null;

  const rels = artifacts.map((a) => a.name);
  const unmerged = unmergedAmong(projectPath, rels);
  const tracked = trackedAmong(projectPath, rels);

  return {
    projectPath,
    artifacts,
    symlinks,
    restorableClaudeMd,
    unmerged,
    tracked,
    backupDir: `${FRAME_DIR}/${MIGRATION_BACKUP_DIR}`,
    // Derived, not asked: a project whose meta files are committed clearly
    // shares them; one where they were never tracked stays local.
    sharingMode: tracked.length > 0 ? 'repo' : 'local',
    canRun: unmerged.length === 0
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
  'AI-tool agnostic. Claude Code reads a generated copy of it at',
  '`.claude/rules/frame.md`, which Frame rewrites whenever this file changes —',
  'edit this file, never the copy; delete the copy to detach.'
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
 * The steps themselves, in order, writing what happened into `state`. Split
 * out of run() so a throw anywhere in here still leaves run() holding the
 * truth about how far the migration got.
 */
function execute(projectPath, activePlan, onProgress, state) {
  const frameDir = path.join(projectPath, FRAME_DIR);
  const backupDir = path.join(frameDir, MIGRATION_BACKUP_DIR);
  const { moved, backedUp, review } = state;

  state.step = 'backup';
  fs.mkdirSync(backupDir, { recursive: true });

  // 1. The files themselves. Backup first, always — even for the copies that
  //    only get deleted, so an interrupted run can always be reconstructed.
  for (const artifact of activePlan.artifacts) {
    const rootPath = path.join(projectPath, artifact.name);
    if (!fs.existsSync(rootPath)) continue;
    state.step = `move:${artifact.name}`;
    onProgress({ step: 'move', detail: artifact.name });

    copyVerified(rootPath, path.join(backupDir, artifact.name));
    backedUp.push(artifact.name);

    if (artifact.disposition === 'move') {
      copyVerified(rootPath, path.join(frameDir, artifact.name));
      moved.push(artifact.name);
    } else if (artifact.disposition === 'replace-invalid') {
      // The .frame/ copy is empty or unparseable — park it under a name of
      // its own and let the root file take its place.
      const overlayPath = path.join(frameDir, artifact.name);
      copyVerified(overlayPath, path.join(backupDir, `${artifact.name}.unusable`));
      backedUp.push(`${artifact.name}.unusable`);
      copyVerified(rootPath, overlayPath);
      moved.push(artifact.name);
      review.push(`the copy already in .frame/${artifact.name} was empty or unparseable — it is in ${activePlan.backupDir}/${artifact.name}.unusable and the root version took its place`);
      record('migration.conflict', { path: artifact.name, reason: 'unusable-overlay' });
    } else if (artifact.disposition === 'backup-conflict') {
      review.push(`${artifact.name} differs from the copy already in .frame/ — the root version is in ${activePlan.backupDir}/`);
      record('migration.conflict', { path: artifact.name });
    }
    fs.unlinkSync(rootPath);
  }

  // 2. Frame-planted symlinks come out; a real CLAUDE.md is restored from the
  //    block old inits folded into AGENTS.md, verbatim.
  for (const name of activePlan.symlinks) {
    state.step = `symlink:${name}`;
    onProgress({ step: 'symlink', detail: name });
    try {
      fs.unlinkSync(path.join(projectPath, name));
    } catch (err) {
      review.push(`could not remove the ${name} symlink: ${err.message}`);
    }
  }
  if (activePlan.symlinks.includes(FRAME_FILES.CLAUDE_SYMLINK)) {
    state.step = 'restore';
    const claudePath = path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK);
    if (!activePlan.restorableClaudeMd) {
      review.push(`${FRAME_FILES.CLAUDE_SYMLINK} was a Frame symlink, but AGENTS.md carries no "Existing Instructions (from CLAUDE.md)" block — there was nothing to restore`);
    } else if (fs.existsSync(claudePath)) {
      review.push(`${FRAME_FILES.CLAUDE_SYMLINK} already exists, so the block AGENTS.md consumed was not written back — compare it yourself`);
    } else {
      fs.writeFileSync(claudePath, activePlan.restorableClaudeMd, 'utf8');
      state.claudeMdRestored = true;
      onProgress({ step: 'restore', detail: FRAME_FILES.CLAUDE_SYMLINK });
    }
  }

  // AGENTS.md's own prose still points at the root paths, and it is the user's
  // file — rewriting it is `applyDecisions`' job, behind a click. The move
  // above carried its bytes across untouched.

  // 3. The pointer, the identity, and the end of the fingerprint.
  state.step = 'pointer';
  onProgress({ step: 'pointer', detail: CLAUDE_RULE_PATH });
  require('./frameProject').syncClaudeRule(projectPath);
  frameStore.ensureProjectId(projectPath);

  const config = frameStore.readConfig(projectPath) || {};
  delete config.files; // the fingerprint: gone, so a second plan() finds nothing
  config.settings = config.settings || {};
  config.settings.gitSharing = activePlan.sharingMode;
  frameStore.writeConfig(projectPath, config);

  // 4. Hook entries: replace the old unguarded commands with the guarded ones
  //    in the file this sharing mode uses.
  state.step = 'hooks';
  onProgress({ step: 'hooks', detail: gitSharing.hookFileFor(activePlan.sharingMode) });
  const frameProject = require('./frameProject');
  for (const file of ['settings.json', 'settings.local.json']) {
    frameProject.removeSpecHintHook(projectPath, { file });
  }
  frameProject.installSpecHintHook(projectPath, { file: gitSharing.hookFileFor(activePlan.sharingMode) });

  // 5. Sharing posture + a refreshed set of staged scripts (the old copies
  //    resolve their project as `.frame/`, which is the bug T03 fixed).
  state.step = 'sharing';
  onProgress({ step: 'sharing', detail: activePlan.sharingMode });
  gitSharing.setMode(projectPath, activePlan.sharingMode);
  try {
    structureBootstrap.copyParserScripts(projectPath);
  } catch (err) {
    review.push(`could not refresh .frame/bin scripts: ${err.message}`);
  }
  state.step = 'done';
}

/**
 * Execute a plan. Reports progress through `onProgress({ step, detail })` and
 * returns a receipt: what moved, what was backed up, what needs a human look.
 *
 * A throw mid-run is not a failure to migrate — files have already moved by
 * then. The receipt stays truthful (`ran: true` with `failedAt` and what got
 * as far as it did) rather than reporting "migration did not run" over a
 * half-moved tree.
 */
function run(projectPath, migrationPlan, onProgress = () => {}) {
  const started = Date.now();
  const activePlan = migrationPlan || plan(projectPath);

  if (!activePlan) {
    record('migration.skipped', { reason: 'no-fingerprint' });
    return { ran: false, reason: 'no-fingerprint', moved: [], backedUp: [], review: [] };
  }
  if (!activePlan.canRun) {
    // The activity registry's reason enum does not carry `unmerged` yet — the
    // reporting pass adds it. Until then the skip is still recorded truthfully
    // under the code that exists.
    record('migration.skipped', { reason: 'dirty-tree' });
    return { ran: false, reason: 'unmerged', unmerged: activePlan.unmerged, moved: [], backedUp: [], review: [] };
  }

  const state = { step: 'start', moved: [], backedUp: [], review: [], claudeMdRestored: false };
  const receipt = () => ({
    ran: true,
    moved: state.moved,
    backedUp: state.backedUp,
    review: state.review,
    backupDir: activePlan.backupDir,
    sharingMode: activePlan.sharingMode,
    claudeMdRestored: state.claudeMdRestored,
    symlinksRemoved: activePlan.symlinks
  });

  try {
    execute(projectPath, activePlan, onProgress, state);
  } catch (err) {
    record('migration.failed', {
      failedAt: state.step,
      error: err.message,
      moved: state.moved.length,
      backedUp: state.backedUp.length
    });
    return { ...receipt(), failedAt: state.step, error: err.message };
  }

  record('migration.completed', {
    moved: state.moved.length,
    backedUp: state.backedUp.length,
    review: state.review.length,
    ms: Date.now() - started
  });

  return receipt();
}

/**
 * Apply the decisions the user clicked through — today exactly one, the
 * `AGENTS.md` prose rewrite that `execute()` deliberately does not do.
 * `AGENTS.md` is the user's file: the automatic half moves its bytes, and
 * nothing rewrites them without a yes.
 *
 * Returns a receipt in run()'s shape so one renderer path can show either.
 */
function applyDecisions(projectPath, decisions = []) {
  const kinds = new Set(
    (decisions || [])
      .map((d) => (typeof d === 'string' ? d : d && d.kind))
      .filter(Boolean)
  );

  const review = [];
  const applied = [];

  if (kinds.has('agents-prose')) {
    const agentsText = frameStore.readAgents(projectPath);
    const upgraded = upgradeAgentsText(agentsText);
    if (upgraded.text && upgraded.text !== agentsText) {
      frameStore.writeAgents(projectPath, upgraded.text);
      applied.push('agents-prose');
      // The generated copy Claude Code reads is stale the moment AGENTS.md
      // changes, so it is refreshed here and nowhere else — a rewrite that
      // did not happen leaves the copy alone.
      require('./frameProject').syncClaudeRule(projectPath);
    }
    for (const item of upgraded.review) {
      review.push(`AGENTS.md: could not find ${item} — check it by hand`);
    }
  }

  return { ran: applied.length > 0, applied, review, moved: [], backedUp: [] };
}

module.exports = {
  init,
  plan,
  run,
  applyDecisions,
  // exported for tests and for the receipt's prose
  extractClaudeBlock,
  upgradeAgentsText,
  isFramePlantedSymlink,
  isUnusableCopy,
  AGENTS_LINE_EDITS
};
