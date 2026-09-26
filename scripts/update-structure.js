#!/usr/bin/env node
/**
 * STRUCTURE.json generator — the CLI over the shared pipeline:
 *
 *   structure-discovery.js   which files exist (one policy, any layout)
 *   structure-generation.js  what their entries say (identity, annotations)
 *   structure-state.js       where the map lives and how it is published
 *
 * Usage:
 *   node update-structure.js                 # full rebuild
 *   node update-structure.js --full          # same, explicit (the repair command)
 *   node update-structure.js --changed       # staged + unstaged Git changes (pre-commit hook)
 *   node update-structure.js a.js b.py       # specific files
 *   node update-structure.js --check         # would a full rebuild change the map? (read-only)
 *   add --json for one bounded result envelope on stdout (diagnostics go to stderr)
 *
 * Exit codes:
 *   full / partial update  0 complete · 1 incomplete inventory or extraction
 *                          errors (`published` says whether the map changed) ·
 *                          2 failure or another update running
 *   --check                0 in sync · 1 out of date · 2 missing, corrupt or
 *                          unverifiable
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const discovery = require('./structure-discovery');
const generation = require('./structure-generation');
const state = require('./structure-state');

const RESULT_SCHEMA = 'frame.structure.result/1';
const HUMAN_DIAGNOSTIC_LINES = 5;

/**
 * Which project this run is about. `__dirname/..` was wrong for the shipped
 * copy: run by hand from a user project, it wrote Frame's own STRUCTURE.json.
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

/* ------------------------------ arguments ---------------------------- */

const FLAGS = new Set(['--full', '--changed', '--check', '--json']);

function parseArgs(argv) {
  const flags = new Set();
  const files = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      if (!FLAGS.has(arg)) return { error: `unknown option ${arg}` };
      flags.add(arg);
    } else {
      files.push(arg);
    }
  }
  const modes = [flags.has('--full'), flags.has('--changed'), flags.has('--check'), files.length > 0].filter(Boolean).length;
  if (modes > 1) return { error: 'choose one of --full, --changed, --check or a file list' };
  let command = 'full';
  if (flags.has('--check')) command = 'check';
  else if (flags.has('--changed')) command = 'changed';
  else if (files.length > 0) command = 'files';
  return { command, json: flags.has('--json'), files };
}

/* ------------------------------- output ------------------------------ */

let jsonMode = false;

/** Human text: stdout normally, stderr when stdout carries the envelope. */
function say(line) {
  (jsonMode ? process.stderr : process.stdout).write(`${line}\n`);
}

function warn(line) {
  process.stderr.write(`${line}\n`);
}

function repairCommand() {
  const rel = path.relative(ROOT_DIR, __filename).split(path.sep).join('/');
  return `node ${rel.startsWith('..') ? __filename : rel} --full`;
}

function printDiagnostics(diagnostics) {
  if (!diagnostics || !diagnostics.samples || diagnostics.samples.length === 0) return;
  for (const d of diagnostics.samples.slice(0, HUMAN_DIAGNOSTIC_LINES)) {
    warn(`  · ${d.path}: ${d.reason}${d.code ? ` (${d.code})` : ''}`);
  }
  const more = diagnostics.total - Math.min(diagnostics.samples.length, HUMAN_DIAGNOSTIC_LINES);
  if (more > 0) warn(`  · … ${more} more`);
}

function emit(envelope) {
  if (jsonMode) process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

/* ------------------------------- inputs ------------------------------ */

function projectBlock() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, '.frame', 'config.json'), 'utf8'));
    return config && config.project && typeof config.project === 'object' ? config.project : {};
  } catch (err) {
    return {};
  }
}

/** Staged and unstaged changes, exactly the sources the hook always used. */
function getChangedFiles() {
  const names = [];
  for (const command of ['git diff --cached --name-only --diff-filter=ACMR', 'git diff --name-only --diff-filter=ACMR']) {
    const output = execSync(command, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    names.push(...output.split('\n').filter(Boolean));
  }
  return [...new Set(names)];
}

/** Explicit file arguments, relative to the project root. */
function toRootRelative(files) {
  const out = [];
  for (const file of files) {
    const rel = path.relative(ROOT_DIR, path.resolve(ROOT_DIR, file));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      warn(`⚠ ${file} is outside the project — ignored`);
      continue;
    }
    out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

/* ------------------------------ activity ----------------------------- */
//
// This script runs under the git pre-commit hook, in a process Frame never
// sees. Recording the run is the only way the panel can show that the hook
// fired at all. Guarded require: an older `.frame/bin` generation may lack
// the module. `--check` is read-only and records nothing.

let activityLog = null;
try {
  activityLog = require('./activity-log');
} catch {
  /* older .frame/bin generation */
}

function noteRun(startedAt, changes) {
  if (!activityLog) return;
  try {
    activityLog.appendSync(activityLog.projectKey(ROOT_DIR), {
      ev: 'script.ran',
      kind: 'action',
      script: 'update-structure',
      // git sets GIT_INDEX_FILE for hook processes; without it this is a
      // developer running the script by hand.
      host: process.env.GIT_INDEX_FILE ? 'git-precommit' : 'cli',
      ms: Date.now() - startedAt,
      ...(typeof changes === 'number' ? { changes } : {})
    });
  } catch {
    /* a commit must never fail over a record */
  }
}

/* ------------------------------ mutation ----------------------------- */

function exitCodeFor(result) {
  if (result.state === 'complete') return 0;
  if (result.state === 'partial') return 1;
  return 2;
}

function builtFrom(structure, report, prior) {
  return {
    candidate: generation.serializeStructure(structure, prior),
    inventory: structure.generation.inventory,
    extraction: report.extraction,
    counts: structure.generation.counts,
    diagnostics: structure.generation.diagnostics,
    discardsAuthored: report.discarded.length > 0
  };
}

function runFull() {
  const curation = generation.loadCuration(__dirname);
  return state.runAttempt({
    rootDir: ROOT_DIR,
    mode: 'full',
    attemptId: process.env.FRAME_STRUCTURE_ATTEMPT_ID || undefined,
    build: (baseline) => {
      const loaded = discovery.loadProjectStructureConfig(ROOT_DIR);
      const found = discovery.discover(ROOT_DIR, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
      const prior = baseline.status === 'valid' ? baseline.data : null;
      const { structure, report } = generation.buildFull({
        rootDir: ROOT_DIR, discovery: found, prior, curation, projectConfig: projectBlock()
      });
      return builtFrom(structure, report, prior);
    }
  });
}

function runDelta(candidates) {
  const curation = generation.loadCuration(__dirname);
  let policyInputChanged = false;
  const result = state.runAttempt({
    rootDir: ROOT_DIR,
    mode: 'delta',
    attemptId: process.env.FRAME_STRUCTURE_ATTEMPT_ID || undefined,
    build: (baseline) => {
      const loaded = discovery.loadProjectStructureConfig(ROOT_DIR);
      const evaluation = discovery.evaluatePaths(ROOT_DIR, candidates, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
      let kind = 'valid';
      if (baseline.status === 'missing') kind = 'missing';
      else if (baseline.status === 'corrupt' || baseline.liveCorrupt) kind = 'corrupt';
      const prior = kind === 'valid' ? baseline.data : null;
      const { structure, report } = generation.buildDelta({
        rootDir: ROOT_DIR, evaluation, prior, baseline: kind, curation, projectConfig: projectBlock()
      });
      policyInputChanged = report.policyInputChanged;
      if (!report.changed) {
        return { candidate: null, inventory: report.inventory, extraction: report.extraction, diagnostics: report.diagnostics };
      }
      return builtFrom(structure, report, prior);
    }
  });
  result.policyInputChanged = policyInputChanged;
  return result;
}

function reportMutation(result, command) {
  const count = result.counts && typeof result.counts.indexedFiles === 'number' ? result.counts.indexedFiles : null;
  const modules = count === null ? '' : ` (${count} modules)`;
  if (result.busy) {
    warn('⚠ STRUCTURE.json not refreshed: another update is running.');
  } else if (result.state === 'failed') {
    warn(`✗ STRUCTURE.json was not updated: ${result.reason}${result.message ? ` — ${result.message}` : ''}`);
    if (result.reason === 'E_DELTA_BASELINE' || result.reason === 'E_STRUCTURE_POLICY') warn(`  Repair: ${repairCommand()}`);
  } else if (result.artifact === 'retained') {
    const reasons = (result.coverage && result.coverage.reasons || []).join(', ');
    warn(`⚠ Scan incomplete (${reasons}) — kept the existing STRUCTURE.json unchanged.`);
    warn(`  Repair: ${repairCommand()}`);
  } else if (result.artifact === 'unchanged') {
    say(command === 'full' ? `✓ STRUCTURE.json is up to date${modules}` : 'STRUCTURE.json unchanged.');
  } else if (result.artifact === 'written') {
    say(`✓ Updated STRUCTURE.json${modules}`);
  }
  if (!result.busy && result.coverage && result.coverage.coverage === 'partial' && result.artifact === 'written') {
    warn(`⚠ Coverage is partial (${(result.coverage.reasons || []).join(', ')}) — the map is labeled incomplete.`);
  }
  if (result.extraction && result.extraction.coverage === 'partial') {
    warn(`⚠ ${result.extraction.counts.partial} file(s) could not be parsed and carry basic metadata only.`);
  }
  if (result.state !== 'complete' || (result.extraction && result.extraction.coverage === 'partial')) printDiagnostics(result.diagnostics);
  if (result.recoveryPaths && result.recoveryPaths.length) warn(`  Original map preserved at: ${result.recoveryPaths.join(', ')}`);
  if (result.policyInputChanged) warn(`  An ignore file changed — run ${repairCommand()} to reconcile the whole inventory.`);
  if (!result.persisted && !result.busy) warn('  (the attempt could not be recorded under .frame/runtime/structure)');
}

/* -------------------------------- check ------------------------------ */

function runCheck() {
  const verdict = (exitCode, result, reason, message) => ({ schema: RESULT_SCHEMA, command: 'check', exitCode, result, reason, message });
  const snap = state.snapshot(ROOT_DIR);
  if (snap.baseline.status === 'missing') {
    return verdict(2, 'unverifiable', 'missing', `STRUCTURE.json missing — run: ${repairCommand()}`);
  }
  if (snap.baseline.status !== 'valid' || snap.baseline.liveCorrupt) {
    return verdict(2, 'unverifiable', 'corrupt', `STRUCTURE.json is not a valid map — run: ${repairCommand()}`);
  }
  if (snap.writerActive) return verdict(2, 'unverifiable', 'writer-active', 'An update is running; check again when it finishes.');

  let found;
  try {
    const loaded = discovery.loadProjectStructureConfig(ROOT_DIR);
    found = discovery.discover(ROOT_DIR, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
  } catch (err) {
    return verdict(2, 'unverifiable', 'policy-error', err.message);
  }
  if (found.coverage !== 'complete') {
    return verdict(2, 'unverifiable', 'incomplete-inventory', `Cannot verify: discovery incomplete (${found.incompleteReasons.join(', ')}).`);
  }
  const { structure } = generation.buildFull({
    rootDir: ROOT_DIR, discovery: found, prior: snap.baseline.data,
    curation: generation.loadCuration(__dirname), projectConfig: projectBlock()
  });
  const same = JSON.stringify(generation.checkView(structure)) === JSON.stringify(generation.checkView(snap.baseline.data));
  if (!snap.stable()) return verdict(2, 'unverifiable', 'changed-during-check', 'STRUCTURE.json changed during the check; run it again.');
  return same
    ? verdict(0, 'in-sync', null, 'STRUCTURE.json is in sync with the project.')
    : verdict(1, 'out-of-date', null, `STRUCTURE.json is out of date — run: ${repairCommand()}`);
}

/* -------------------------------- main ------------------------------- */

function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  jsonMode = Boolean(args.json) || process.argv.includes('--json');

  if (args.error) {
    warn(`✗ ${args.error}`);
    emit({ schema: RESULT_SCHEMA, command: 'invalid', exitCode: 2, state: 'failed', reason: 'usage', message: args.error });
    process.exitCode = 2;
    return;
  }

  if (args.command === 'check') {
    const result = runCheck();
    (result.exitCode === 0 ? say : warn)(result.message);
    emit(result);
    process.exitCode = result.exitCode;
    return;
  }

  let result;
  if (args.command === 'full') {
    say('Mode: full');
    result = runFull();
  } else {
    let candidates;
    if (args.command === 'changed') {
      try {
        candidates = getChangedFiles();
      } catch (err) {
        warn(`⚠ Git error: ${err.message.split('\n')[0]} — only confirming existing entries.`);
        candidates = [];
      }
    } else {
      candidates = toRootRelative(args.files);
    }
    say(`Mode: ${args.command === 'changed' ? 'incremental' : 'specific'}, ${candidates.length} candidate file(s)`);
    result = runDelta(candidates);
  }

  reportMutation(result, args.command);
  const exitCode = exitCodeFor(result);
  emit({ schema: RESULT_SCHEMA, command: args.command, exitCode, ...result });
  noteRun(startedAt, result.counts && typeof result.counts.indexedFiles === 'number' ? result.counts.indexedFiles : undefined);
  process.exitCode = exitCode;
}

try {
  main();
} catch (err) {
  warn(`✗ update-structure failed: ${err && err.stack ? err.stack : err}`);
  if (jsonMode) process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, command: 'unknown', exitCode: 2, state: 'failed', reason: 'crash', message: String(err && err.message) })}\n`);
  process.exitCode = 2;
}
