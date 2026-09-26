#!/usr/bin/env node
/**
 * Frame Freshness Checker — detects when the durable context is likely to
 * mislead an agent: phantom modules, stale STRUCTURE.json, unrecorded
 * decisions, stuck tasks, an untouched QUICKSTART.
 *
 * Usage:
 *   node scripts/check-freshness.js            # human-readable warnings, exit 0
 *   node scripts/check-freshness.js --json     # machine-readable output
 *   node scripts/check-freshness.js --strict   # exit 1 when anything is stale
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
// Ownership, freshness and generation status: the shared read contract.
const structureRead = require('./structure-read');

const STARTED_AT = Date.now();

/**
 * Which project this run is about. `__dirname/..` was wrong for the shipped
 * copy: run by hand from a user project, it reported on Frame's own files.
 * Same rule as spec-index.js / detect-project.js.
 */
function resolveProjectRoot() {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  // Shipped copy: <project>/.frame/bin/ — the project is two levels up.
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  // Frame's own repo: scripts/
  if (path.basename(__dirname) === 'scripts') return path.join(__dirname, '..');
  return process.cwd();
}

const ROOT_DIR = resolveProjectRoot();

/**
 * Where a meta file lives: `.frame/<name>` for a migrated project, the root
 * only while an unmigrated project still has it there. Returns the path and
 * its root-relative form, which is what git pathspecs below need.
 */
function resolveMetaPath(name) {
  const overlay = path.join(ROOT_DIR, '.frame', name);
  if (fs.existsSync(overlay)) return { path: overlay, rel: `.frame/${name}` };
  const legacy = path.join(ROOT_DIR, name);
  if (fs.existsSync(legacy)) return { path: legacy, rel: name };
  return { path: overlay, rel: `.frame/${name}` };
}

function repairCommand(root) {
  const updater = path.join(__dirname, 'update-structure.js');
  const rel = path.relative(root, updater).split(path.sep).join('/');
  return `node ${rel && !rel.startsWith('..') ? rel : '.frame/bin/update-structure.js'} --full`;
}

const STALE_TASK_DAYS = 14;
const NOTES_COMMIT_THRESHOLD = 10;
const QUICKSTART_COMMIT_THRESHOLD = 30;

const findings = [];

function warn(check, message) {
  findings.push({ check, message });
}

function git(cmd) {
  try {
    return execSync(cmd, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (e) {
    return null;
  }
}

function readJSON(name) {
  try {
    const file = name === 'STRUCTURE.json' ? structureRead.resolveStructurePath(ROOT_DIR) : resolveMetaPath(name).path;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * 1. Phantom modules — STRUCTURE.json entries whose file is missing on disk
 */
function checkPhantomModules(structure) {
  for (const [key, mod] of Object.entries(structure.modules || {})) {
    if (mod.file && !fs.existsSync(path.join(ROOT_DIR, mod.file))) {
      warn('phantom-module', `STRUCTURE.json lists ${key} but ${mod.file} is missing on disk — run: npm run structure`);
    }
  }
}

/**
 * Ask update-structure.js --check whether a regen would actually change
 * STRUCTURE.json. Returns true (out of date), false (in sync), or null
 * (cannot verify — checker missing or errored).
 */
function confirmContentDrift() {
  const checker = path.join(__dirname, 'update-structure.js');
  if (!fs.existsSync(checker)) return null;
  try {
    const r = spawnSync('node', [checker, '--check'], {
      cwd: ROOT_DIR,
      env: { ...process.env, FRAME_PROJECT_ROOT: ROOT_DIR },
      stdio: 'ignore',
      timeout: 30000
    });
    if (r.status === 0) return false;
    if (r.status === 1) return true;
  } catch (e) {
    // fall through to null
  }
  return null;
}

/**
 * 2. STRUCTURE drift — the date heuristic (lastUpdated older than the last
 * commit touching src) is only a cheap pre-filter: a merge or revert dated
 * after lastUpdated can touch src without changing any module content, and
 * an idempotent regen wouldn't clear such a warning. When the dates look
 * stale, the actual content decides.
 */
function checkStructureDrift(structure) {
  const lastSrcCommit = git('git log -1 --format=%cs -- src');
  if (!(lastSrcCommit && structure.lastUpdated && structure.lastUpdated < lastSrcCommit)) return;

  const drift = confirmContentDrift();
  if (drift === false) return; // dates disagree but content is in sync — not stale

  if (drift === true) {
    warn('structure-drift', `STRUCTURE.json content is out of date vs src (lastUpdated ${structure.lastUpdated}) — run: npm run structure`);
  } else {
    warn('structure-drift', `STRUCTURE.json (${structure.lastUpdated}) predates the last src commit (${lastSrcCommit}) — run: npm run structure`);
  }
}

/**
 * 2b. Generation status — a partial or unverified map, or a latest scan that
 * did not replace the map. Reported only; the map is never repaired here.
 */
function checkStructureGeneration(structure) {
  const notes = structureRead.generationNotes(ROOT_DIR, structure);
  for (const note of notes) {
    warn('structure-generation', `STRUCTURE.json ${note} — run: ${repairCommand(ROOT_DIR)}`);
  }
}

/**
 * 2c. Freshness — what the lifecycle receipt says about the working-tree
 * map (STR-02). Returns true when the receipt answered the question, so the
 * date heuristic above is not needed.
 */
const RECEIPT_MISMATCH = ['artifact-changed', 'not-working-tree'];

function checkStructureFreshness() {
  const d = structureRead.readDescriptor(ROOT_DIR);
  const known = d.freshness !== 'unknown' || d.reasons.some((r) => RECEIPT_MISMATCH.includes(r));
  const why = d.reasons.length ? ` (${d.reasons.join(', ')})` : '';
  if (d.freshness === 'dirty') {
    warn('structure-freshness', `STRUCTURE.json is dirty${why} — changes are waiting to be applied`);
  } else if (d.freshness === 'stale') {
    warn('structure-freshness', `STRUCTURE.json is stale${why} — lifecycle maintenance is not keeping it current`);
  } else if (d.freshness === 'unknown' && known) {
    warn('structure-freshness', `STRUCTURE.json changed since it was last verified${why}`);
  }
  if (d.missedBound && d.missedBound.reason) {
    warn('structure-freshness', `the last STRUCTURE update missed its time bound (${d.missedBound.reason})`);
  }
  return known;
}

/**
 * 3. Notes staleness — commits landed since the last dated PROJECT_NOTES entry
 */
function checkNotesStaleness() {
  const notes = resolveMetaPath('PROJECT_NOTES.md');
  if (!fs.existsSync(notes.path)) return;

  const content = fs.readFileSync(notes.path, 'utf-8');
  const dates = [...content.matchAll(/^###\s*\[(\d{4}-\d{2}-\d{2})\]/gm)].map(m => m[1]);
  if (dates.length === 0) return;

  const lastNote = dates.sort().pop();
  const commitsSince = git(`git rev-list --count HEAD --since=${lastNote}`);
  if (commitsSince && Number(commitsSince) >= NOTES_COMMIT_THRESHOLD) {
    warn('notes-stale', `PROJECT_NOTES.md's last entry is ${lastNote} but ${commitsSince} commits landed since — decisions may be unrecorded`);
  }
}

/**
 * 4. Stuck tasks — in_progress for more than STALE_TASK_DAYS
 */
function checkStuckTasks() {
  const data = readJSON('tasks.json');
  if (!data) return;

  const tasks = Array.isArray(data) ? data : data.tasks;
  if (!Array.isArray(tasks)) return;

  const cutoff = Date.now() - STALE_TASK_DAYS * 24 * 60 * 60 * 1000;
  for (const task of tasks) {
    if (task.status !== 'in_progress') continue;
    const updated = Date.parse(task.updatedAt || task.createdAt || '');
    if (!Number.isNaN(updated) && updated < cutoff) {
      const days = Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000));
      warn('stuck-task', `tasks.json: "${task.title || task.id}" has been in_progress for ${days} days — finish, re-scope, or reset it`);
    }
  }
}

/**
 * 5. QUICKSTART staleness — commits landed since QUICKSTART.md was last touched
 */
function checkQuickstartStaleness() {
  const quickstart = resolveMetaPath('QUICKSTART.md');
  if (!fs.existsSync(quickstart.path)) return;

  const lastTouched = git(`git log -1 --format=%cs -- ${quickstart.rel}`);
  if (!lastTouched) return;

  const commitsSince = git(`git rev-list --count HEAD --since=${lastTouched}`);
  if (commitsSince && Number(commitsSince) >= QUICKSTART_COMMIT_THRESHOLD) {
    warn('quickstart-stale', `QUICKSTART.md was last touched ${lastTouched} with ${commitsSince} commits since — setup steps may be outdated`);
  }
}

// Run all checks
const structure = readJSON('STRUCTURE.json');
if (structure) {
  checkPhantomModules(structure);
  if (!checkStructureFreshness()) checkStructureDrift(structure);
  checkStructureGeneration(structure);
}
checkNotesStaleness();
checkStuckTasks();
checkQuickstartStaleness();

// ─── activity record ──────────────────────────────────────
//
// Runs under the git pre-commit hook, in a process Frame never sees.
// Guarded require: `.frame/bin/` refreshes only on project init, so an
// older generation degrades to today's behavior and a commit can never
// fail over a record.

try {
  const activityLog = require('./activity-log');
  activityLog.appendSync(activityLog.projectKey(ROOT_DIR), {
    ev: 'script.ran',
    kind: 'action',
    script: 'check-freshness',
    // git sets GIT_INDEX_FILE for hook processes; without it a developer ran
    // this by hand.
    host: process.env.GIT_INDEX_FILE ? 'git-precommit' : 'cli',
    ms: Date.now() - STARTED_AT,
    changes: findings.length
  });
} catch { /* never worth a failed commit */ }

// Output
const args = process.argv.slice(2);
if (args.includes('--json')) {
  console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
} else if (findings.length === 0) {
  console.log('✓ Frame context looks fresh — no staleness detected.');
} else {
  for (const f of findings) {
    console.log(`⚠ [${f.check}] ${f.message}`);
  }
  console.log(`\n${findings.length} staleness warning(s).`);
}

process.exit(args.includes('--strict') && findings.length > 0 ? 1 : 0);
