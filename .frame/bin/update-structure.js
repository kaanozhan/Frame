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
 *   node update-structure.js --changed       # same as --staged (older hook snippets that then `git add` the map)
 *   node update-structure.js a.js b.py       # specific files
 *   node update-structure.js --check         # would a full rebuild change the map? (read-only)
 *   node update-structure.js --staged        # the commit's map, from the index, into the index and the tracked file (pre-commit hook)
 *   add --json for one bounded result envelope on stdout (diagnostics go to stderr)
 *
 * Exit codes:
 *   full / partial update  0 complete · 1 incomplete inventory or extraction
 *                          errors (`published` says whether the map changed) ·
 *                          2 failure or another update running
 *   --check                0 in sync · 1 out of date · 2 missing, corrupt or
 *                          unverifiable
 *   --staged / --changed   0 published, already staged or not shared ·
 *                          1 unavailable or aborted · 2 failure
 */

const fs = require('fs');
const path = require('path');

const discovery = require('./structure-discovery');
const generation = require('./structure-generation');
const state = require('./structure-state');
const { structureEnabled, PAUSED_MESSAGE } = require('./structure-switch');

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

const FLAGS = new Set(['--full', '--changed', '--check', '--staged', '--json']);

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
  const modes = [flags.has('--full'), flags.has('--changed'), flags.has('--check'), flags.has('--staged'), files.length > 0].filter(Boolean).length;
  if (modes > 1) return { error: 'choose one of --full, --changed, --check, --staged or a file list' };
  let command = 'full';
  if (flags.has('--check')) command = 'check';
  else if (flags.has('--staged')) command = 'staged';
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

/**
 * The tracked map (committed view plus hand edits) as the generation prior
 * for the working view (STR-02c D2), or null when it is missing or invalid.
 */
function trackedPrior() {
  const baseline = state.readBaseline(state.resolveStructurePath(ROOT_DIR));
  return baseline.status === 'valid' ? baseline.data : null;
}

/**
 * After a working-view publish, refresh the derived lookup index (STR-03).
 * A failure is reported in the result and never fails the map.
 */
function publishLookup(result) {
  if (result.artifact !== 'written' && result.artifact !== 'unchanged') return;
  let retrieval;
  try {
    retrieval = require('./structure-retrieval');
  } catch (err) {
    return; // an older .frame/bin/ without the retrieval helper
  }
  const lookup = retrieval.publishLookup(ROOT_DIR, { mapPath: state.workingViewPath(ROOT_DIR) });
  result.lookup = lookup.status;
  if (lookup.status === 'failed') warn(`⚠ Lookup index not published (${lookup.reason}) — searches fall back to the map.`);
}

/** After a working-view publish, keep an untracked map file equal to it. */
function mirrorWorkingView(result, discardsAuthored) {
  if (result.artifact !== 'written' && result.artifact !== 'unchanged') return;
  try {
    const bytes = fs.readFileSync(state.workingViewPath(ROOT_DIR));
    const mirrored = state.mirrorToUntrackedMap(ROOT_DIR, bytes, { discardsAuthored });
    if (mirrored.recoveryPaths && mirrored.recoveryPaths.length) {
      result.recoveryPaths = [...(result.recoveryPaths || []), ...mirrored.recoveryPaths];
    }
  } catch (err) {
    /* no working view to mirror */
  }
}

/**
 * `reference` is the artifact's own previous content (for lastUpdated and
 * byte stability); it defaults to the generation prior.
 */
function builtFrom(structure, report, prior, reference = prior) {
  return {
    candidate: generation.serializeStructure(structure, reference),
    inventory: structure.generation.inventory,
    extraction: report.extraction,
    counts: structure.generation.counts,
    diagnostics: structure.generation.diagnostics,
    // The target is the working view: authored content lives in the tracked
    // map, which this write never touches (the untracked mirror archives).
    discardsAuthored: false
  };
}

/**
 * --full (STR-02c D3): rebuild the working view. Hand-written prose comes
 * from the tracked map; the tracked map itself changes only through commits
 * (or is kept equal to the working view while Git does not track it).
 */
function runFull() {
  const curation = generation.loadCuration(__dirname);
  let discarded = false;
  const result = state.runAttempt({
    rootDir: ROOT_DIR,
    mode: 'full',
    mapPath: state.workingViewPath(ROOT_DIR),
    attemptId: process.env.FRAME_STRUCTURE_ATTEMPT_ID || undefined,
    build: (baseline) => {
      const loaded = discovery.loadProjectStructureConfig(ROOT_DIR);
      const found = discovery.discover(ROOT_DIR, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
      const prior = trackedPrior();
      const reference = baseline.status === 'valid' ? baseline.data : prior;
      const { structure, report } = generation.buildFull({
        rootDir: ROOT_DIR, discovery: found, prior, curation, projectConfig: projectBlock()
      });
      discarded = report.discarded.length > 0;
      return builtFrom(structure, report, prior, reference);
    }
  });
  mirrorWorkingView(result, discarded);
  publishLookup(result);
  return result;
}

function runDelta(candidates) {
  const curation = generation.loadCuration(__dirname);
  let policyInputChanged = false;
  let discarded = false;
  const result = state.runAttempt({
    rootDir: ROOT_DIR,
    mode: 'delta',
    mapPath: state.workingViewPath(ROOT_DIR),
    attemptId: process.env.FRAME_STRUCTURE_ATTEMPT_ID || undefined,
    build: (baseline) => {
      const loaded = discovery.loadProjectStructureConfig(ROOT_DIR);
      const evaluation = discovery.evaluatePaths(ROOT_DIR, candidates, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
      // A delta starts from the working view; without one, from the tracked map.
      let kind = 'valid';
      let prior = null;
      if (baseline.status === 'corrupt' || baseline.liveCorrupt) kind = 'corrupt';
      else if (baseline.status === 'valid') prior = baseline.data;
      else {
        // No working view yet: the tracked map is the baseline, with STR-01's
        // rule that a corrupt baseline is refused rather than replaced.
        const tracked = state.readBaseline(state.resolveStructurePath(ROOT_DIR));
        if (tracked.status === 'corrupt' || tracked.liveCorrupt) kind = 'corrupt';
        else if (tracked.status === 'valid') prior = tracked.data;
        else kind = 'missing';
      }
      const { structure, report } = generation.buildDelta({
        rootDir: ROOT_DIR, evaluation, prior, baseline: kind, curation, projectConfig: projectBlock()
      });
      policyInputChanged = report.policyInputChanged;
      discarded = report.discarded.length > 0;
      if (!report.changed && baseline.status === 'valid') {
        return { candidate: null, inventory: report.inventory, extraction: report.extraction, diagnostics: report.diagnostics };
      }
      return builtFrom(structure, report, prior);
    }
  });
  mirrorWorkingView(result, discarded);
  publishLookup(result);
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
  // The working view when Frame has one; otherwise the tracked map itself.
  const working = state.workingViewPath(ROOT_DIR);
  const checkingWorkingView = fs.existsSync(working);
  const snap = state.snapshot(ROOT_DIR, checkingWorkingView ? { mapPath: working } : {});
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
    rootDir: ROOT_DIR, discovery: found, prior: checkingWorkingView ? trackedPrior() : snap.baseline.data,
    curation: generation.loadCuration(__dirname), projectConfig: projectBlock()
  });
  const same = JSON.stringify(generation.checkView(structure)) === JSON.stringify(generation.checkView(snap.baseline.data));
  if (!snap.stable()) return verdict(2, 'unverifiable', 'changed-during-check', 'STRUCTURE.json changed during the check; run it again.');
  return same
    ? verdict(0, 'in-sync', null, 'STRUCTURE.json is in sync with the project.')
    : verdict(1, 'out-of-date', null, `STRUCTURE.json is out of date — run: ${repairCommand()}`);
}

/* ------------------------------- staged ------------------------------ */

const STAGED_EXIT = { published: 0, unchanged: 0, skipped: 0, unavailable: 1, aborted: 1, failed: 2 };

/**
 * --staged (STR-02b): build the commit's map from the staged snapshot,
 * publish it into the index and mirror it to the tracked file (STR-02c).
 * Never blocks the commit — the hook wraps it in `|| true`. `--changed`
 * (STR-02c D7) runs the same thing, so an older snippet's following
 * `git add` of the map stages exactly this map.
 */
function runStaged(command = 'staged') {
  const { publishStaged } = require('./structure-commit');
  const result = publishStaged(ROOT_DIR);
  const exitCode = STAGED_EXIT[result.status] ?? 2;
  const files = typeof result.files === 'number' ? ` (${result.files} modules)` : '';
  if (result.status === 'published') say(`✓ Staged the commit's STRUCTURE.json${files}`);
  else if (result.status === 'unchanged') say(`✓ The commit's STRUCTURE.json is already staged${files}`);
  else if (result.status === 'skipped') say('STRUCTURE.json is not shared with this repository — not staged.');
  else if (result.status === 'unavailable') warn(`⚠ Commit map not generated: ${result.reason}${result.message ? ` — ${result.message}` : ''}`);
  else if (result.status === 'aborted') warn(`⚠ Commit map not staged: ${result.reason === 'index-locked' ? 'the index is locked' : 'the index changed while it was being built'}.`);
  else warn(`✗ Commit map failed: ${result.message || result.reason}`);
  if (result.policyFallback && (result.status === 'published' || result.status === 'unchanged')) {
    warn('  (no staged .frame/config.json — generator defaults were used)');
  }
  return { schema: RESULT_SCHEMA, command, exitCode, ...result };
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

  if (!structureEnabled(ROOT_DIR)) {
    say(PAUSED_MESSAGE);
    emit({ schema: RESULT_SCHEMA, command: args.command, exitCode: 0, state: 'skipped', reason: 'paused', message: PAUSED_MESSAGE });
    return;
  }

  if (args.command === 'staged' || args.command === 'changed') {
    const result = runStaged(args.command);
    emit(result);
    noteRun(startedAt, typeof result.files === 'number' ? result.files : undefined);
    process.exitCode = result.exitCode;
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
    const candidates = toRootRelative(args.files);
    say(`Mode: specific, ${candidates.length} candidate file(s)`);
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
