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
const { execSync } = require('child_process');

// FRAME_PROJECT_ROOT lets the same script run from .frame/bin/ inside a user
// project. Frame's own callers don't set it — behavior is unchanged.
const ROOT_DIR = process.env.FRAME_PROJECT_ROOT
  ? path.resolve(process.env.FRAME_PROJECT_ROOT)
  : path.join(__dirname, '..');

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

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, file), 'utf-8'));
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
 * 2. STRUCTURE drift — lastUpdated older than the last commit touching src
 */
function checkStructureDrift(structure) {
  const lastSrcCommit = git('git log -1 --format=%cs -- src');
  if (lastSrcCommit && structure.lastUpdated && structure.lastUpdated < lastSrcCommit) {
    warn('structure-drift', `STRUCTURE.json (${structure.lastUpdated}) predates the last src commit (${lastSrcCommit}) — run: npm run structure`);
  }
}

/**
 * 3. Notes staleness — commits landed since the last dated PROJECT_NOTES entry
 */
function checkNotesStaleness() {
  const notesPath = path.join(ROOT_DIR, 'PROJECT_NOTES.md');
  if (!fs.existsSync(notesPath)) return;

  const content = fs.readFileSync(notesPath, 'utf-8');
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
  if (!fs.existsSync(path.join(ROOT_DIR, 'QUICKSTART.md'))) return;

  const lastTouched = git('git log -1 --format=%cs -- QUICKSTART.md');
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
  checkStructureDrift(structure);
}
checkNotesStaleness();
checkStuckTasks();
checkQuickstartStaleness();

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
