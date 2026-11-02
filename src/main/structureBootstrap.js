/**
 * Structure Bootstrap
 *
 * Ships the STRUCTURE.json auto-fill machinery into a user project on Frame
 * initialization. Three things happen here:
 *
 *   1. Copy scripts/update-structure.js + scripts/find-module.js into
 *      .frame/bin/ so the project carries its own parser. Same code as
 *      Frame's own repo; the shipped copy resolves the project from its own
 *      location (.frame/bin → project), with FRAME_PROJECT_ROOT overriding.
 *      Also re-run by migration, to refresh the scripts of a project that
 *      was initialized before this rule.
 *
 *   2. Install a pre-commit hook that runs the parser on staged changes —
 *      only into `.git/hooks/pre-commit` where no hook exists at all. Husky,
 *      lefthook and custom hooks are the user's files: they get the snippet
 *      as text and decide for themselves.
 *
 *   3. Run one full-mode parse so .frame/STRUCTURE.json is populated
 *      immediately after init, not on the next commit. Only runs when
 *      STRUCTURE.json was just created by Frame (we don't touch a
 *      pre-existing one, wherever it lives). The outcome comes from the
 *      parser's `--json` result envelope: ok, partial, or error.
 *
 * Failures in any step are non-fatal: a project must successfully initialize
 * even if hook install fails (no git, permission issues, etc.).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { structureEnabled, PAUSED_MESSAGE } = require('../../scripts/structure-switch');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');
const {
  getStructureHookSnippet,
  getStructurePreCommitHookTemplate,
  classifyStructureHook
} = require('../shared/frameTemplates');

// Resolve the location of Frame's bundled scripts/ folder. In dev this is
// the repo root; under electron-builder's asar the same relative path holds
// because the asar mirrors the source tree.
const SCRIPTS_SOURCE_DIR = path.join(__dirname, '..', '..', 'scripts');

// Shipped files, in activation order. Helpers first: an entry script is only
// activated after everything it requires is in place, so an interrupted
// refresh leaves the previous entry runnable with the helpers it knew.
const HELPER_FILES = [
  'structure-switch.js', 'structure-ignore.js', 'structure-ignore.LICENSE', 'structure-discovery.js',
  'structure-generation.js', 'structure-state.js', 'structure-snapshot.js',
  'structure-read.js', 'structure-commit.js', 'structure-retrieval.js', 'toolVocabulary.js', 'redact.js', 'activity-log.js',
  'spec-close-state.js', 'decision-cards.js'
];
const ENTRY_FILES = [
  'update-structure.js', 'structure-lifecycle.js', 'find-module.js', 'check-freshness.js',
  'detect-project.js', 'spec-index.js', 'spec-context.js', 'spec-hint.js', 'module-hint.js',
  'docs-hint.js', 'spec-command-hint.js', 'spec-close.js', 'decision.js'
];
// The app's own atomic writer, shipped beside the structure helpers so the
// project's parser publishes with the same implementation (not a copy of it).
const FS_SAFE_SOURCE = path.join(__dirname, 'fsSafe.js');
// What update-structure.js cannot run without.
const PARSER_REQUIRES = [
  'structure-switch.js', 'structure-ignore.js', 'structure-ignore.LICENSE', 'structure-discovery.js',
  'structure-generation.js', 'structure-state.js', 'structure-snapshot.js',
  'structure-commit.js', 'fsSafe.js',
  'lang/javascript.js', 'lang/python.js', 'lang/go.js', 'lang/rust.js', 'lang/markdown.js'
];
// What the lifecycle worker (STR-02) cannot run without.
const LIFECYCLE_REQUIRES = [...PARSER_REQUIRES, 'structure-snapshot.js', 'structure-read.js'];
// Entry scripts activated only when every helper they need staged.
const ENTRY_REQUIRES = {
  'update-structure.js': PARSER_REQUIRES,
  'structure-lifecycle.js': LIFECYCLE_REQUIRES,
  // Readers of the freshness contract (STR-02).
  'find-module.js': ['structure-read.js', 'structure-retrieval.js'],
  'module-hint.js': ['structure-read.js', 'structure-retrieval.js', 'structure-switch.js'],
  // The close step. docs-hint.js and spec-hint.js also read the helper, but
  // behind a guarded require — without it they behave as they always did,
  // so only the script that cannot run at all is held back.
  'spec-close.js': ['spec-close-state.js'],
  // The card writer cannot run without the reader it validates with. The
  // hooks read cards behind a guarded require, like spec-close-state.js.
  'decision.js': ['decision-cards.js']
};
// The module map's own files (scripts/structure-switch.js: opt-in per
// project). A project without the map gets none of them — fsSafe.js and the
// lang/ extractors included, since only the parser uses them — unless its bin
// already has a parser (see stageParserScripts). Everything else is shared.
const STRUCTURE_ENTRIES = ['update-structure.js', 'structure-lifecycle.js', 'find-module.js', 'module-hint.js'];
const STRUCTURE_HELPERS = [
  'structure-switch.js', 'structure-ignore.js', 'structure-ignore.LICENSE', 'structure-discovery.js',
  'structure-generation.js', 'structure-state.js', 'structure-snapshot.js',
  'structure-read.js', 'structure-commit.js', 'structure-retrieval.js', 'fsSafe.js'
];
const isStructureFile = (rel) => STRUCTURE_ENTRIES.includes(rel) || STRUCTURE_HELPERS.includes(rel) || rel.startsWith('lang/');
// Historical name list, kept for readers of this module's exports.
const PARSER_FILES = [...ENTRY_FILES, 'intent-map.json', ...HELPER_FILES];

const INTENT_MAP_SEED = {
  _comment: 'Curated concept → modules map for STRUCTURE.json\'s intentIndex. Agent-editable: add a concept when a feature spans files whose names don\'t say what they do, and synonyms for the words people actually search. Format: { "<concept>": { "modules": ["main/fooManager", ...], "synonyms": ["bar", ...] } }. Module keys must match STRUCTURE.json (missing ones are skipped at generation).'
};

/**
 * Write `src` to `dst` only when the bytes differ, through a temporary file
 * and an atomic rename, so a reader never sees a half-written script.
 * Returns true when `dst` changed. Throws on failure.
 */
function stageFile(fsImpl, src, dst) {
  const content = fsImpl.readFileSync(src);
  let existing = null;
  try { existing = fsImpl.readFileSync(dst); } catch (_) { /* new file */ }
  if (existing && existing.equals(content)) return false;
  fsImpl.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = `${dst}.tmp-${process.pid}`;
  try {
    fsImpl.writeFileSync(tmp, content);
    if (dst.endsWith('.js')) fsImpl.chmodSync(tmp, 0o755);
    fsImpl.renameSync(tmp, dst);
  } catch (err) {
    try { fsImpl.unlinkSync(tmp); } catch (_) { /* never created */ }
    throw err;
  }
  return true;
}

/**
 * Stage Frame's bundled scripts into the project's .frame/bin/.
 *
 * Only files that actually differ are rewritten — this runs on every project
 * open, and rewriting identical files would churn mtimes, watchers and
 * `git status`. It never runs the parser: refreshing tools must not rebuild
 * or invalidate the map.
 *
 * Without the module map (`structureEnabled`) only the shared tools are
 * staged and intent-map.json is not seeded. The exception is a bin that
 * already holds update-structure.js — a project initialized before the map
 * became opt-in: its pre-commit hook still runs that parser, so the full set
 * is refreshed and the hook picks up the copy that stands down.
 * `options.structureMap` overrides the decision (tests).
 *
 * Returns { copied, failed, unavailable }:
 *   copied       names written this run (the historical return value)
 *   failed       [{ file, error }] for files that could not be staged
 *   unavailable  entry scripts left un-activated because a required helper
 *                is missing — an older entry stays runnable; on a first
 *                install the parser is reported unavailable
 */
function stageParserScripts(projectPath, options = {}) {
  const fsImpl = options.fs || fs;
  const sourceDir = options.sourceDir || SCRIPTS_SOURCE_DIR;
  const fsSafeSource = options.fsSafeSource || FS_SAFE_SOURCE;
  const binDir = path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR);
  const report = { copied: [], failed: [], unavailable: [] };
  fsImpl.mkdirSync(binDir, { recursive: true });
  const withMap = options.structureMap !== undefined
    ? options.structureMap
    : structureEnabled(projectPath) || fsImpl.existsSync(path.join(binDir, 'update-structure.js'));
  const staged = (rel) => withMap || !isStructureFile(rel);
  const entries = ENTRY_FILES.filter(staged);

  const sources = new Map();
  for (const file of HELPER_FILES) sources.set(file, path.join(sourceDir, file));
  sources.set('fsSafe.js', fsSafeSource);
  const langSrcDir = path.join(sourceDir, 'lang');
  let langFiles = [];
  try {
    langFiles = fsImpl.readdirSync(langSrcDir).filter((f) => f.endsWith('.js')).sort();
  } catch (_) { /* preflight reports the missing extractors */ }
  for (const file of langFiles) sources.set(`lang/${file}`, path.join(langSrcDir, file));

  for (const rel of [...sources.keys()]) if (!staged(rel)) sources.delete(rel);

  // Preflight: every required source asset must exist before anything the
  // parser depends on is replaced.
  const required = [...new Set(entries.flatMap((entry) => ENTRY_REQUIRES[entry] || []))];
  const missing = required.filter((rel) => !sources.has(rel) || !fsImpl.existsSync(sources.get(rel)));
  for (const rel of missing) {
    console.warn(`[frame] bundled asset missing: ${rel}`);
    report.failed.push({ file: rel, error: 'missing from Frame installation' });
  }

  // 1. Helpers and extractors.
  const helpersOk = new Set();
  for (const [rel, src] of sources) {
    if (missing.includes(rel)) continue;
    if (!fsImpl.existsSync(src)) {
      console.warn(`[frame] parser script missing at ${src}, skipping`);
      continue;
    }
    try {
      if (stageFile(fsImpl, src, path.join(binDir, rel))) report.copied.push(rel);
      helpersOk.add(rel);
    } catch (err) {
      console.warn(`[frame] failed to copy ${rel}: ${err.message}`);
      report.failed.push({ file: rel, error: err.message });
    }
  }
  const ready = (entry) => (ENTRY_REQUIRES[entry] || []).every((rel) => helpersOk.has(rel));

  // 2. Curation: agent-editable per project — seeded once, never overwritten
  // (Frame's own curation would list modules the project doesn't have).
  const intentMap = path.join(binDir, 'intent-map.json');
  if (withMap && !fsImpl.existsSync(intentMap)) {
    try {
      fsImpl.writeFileSync(intentMap, JSON.stringify(INTENT_MAP_SEED, null, 2) + '\n');
      report.copied.push('intent-map.json');
    } catch (err) {
      console.warn(`[frame] failed to seed intent-map.json: ${err.message}`);
      report.failed.push({ file: 'intent-map.json', error: err.message });
    }
  }

  // 3. Entry scripts, last.
  for (const file of entries) {
    if (!ready(file)) {
      report.unavailable.push(file);
      continue;
    }
    const src = path.join(sourceDir, file);
    if (!fsImpl.existsSync(src)) {
      // Bundled script missing — log and continue. Not fatal.
      console.warn(`[frame] parser script missing at ${src}, skipping`);
      continue;
    }
    try {
      if (stageFile(fsImpl, src, path.join(binDir, file))) report.copied.push(file);
    } catch (err) {
      console.warn(`[frame] failed to copy ${file}: ${err.message}`);
      report.failed.push({ file, error: err.message });
    }
  }
  return report;
}

/** The historical API: the list of files written this run. */
function copyParserScripts(projectPath) {
  return stageParserScripts(projectPath).copied;
}

/**
 * Where this checkout's `pre-commit` hook lives, asked of Git — a linked
 * worktree's `.git` is a file, and `core.hooksPath` can move hooks anywhere.
 * `insideGitDir` is false when the hooks directory is outside Git's own
 * directory (core.hooksPath → a folder the user owns, often tracked): Frame
 * never writes there. Resolves null when Git or the repository is missing.
 */
async function hookLocation(projectPath) {
  const run = async (args) => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: projectPath, encoding: 'utf8', timeout: 5000 });
      return stdout.trim();
    } catch (_) {
      return null;
    }
  };
  const [hooks, common] = await Promise.all([run(['rev-parse', '--git-path', 'hooks']), run(['rev-parse', '--git-common-dir'])]);
  if (!hooks || !common) return null;
  const hooksDir = path.resolve(projectPath, hooks);
  const commonDir = path.resolve(projectPath, common);
  const rel = path.relative(commonDir, hooksDir);
  return {
    hooksDir,
    hookFile: path.join(hooksDir, 'pre-commit'),
    insideGitDir: !rel.startsWith('..') && !path.isAbsolute(rel)
  };
}

/**
 * Detect what kind of pre-commit hook setup the project has.
 *
 * Returns { setup, location } where setup is one of:
 *   - 'no-git'         — not a repository (or no Git), hook install impossible
 *   - 'husky'          — .husky/ folder exists and core.hooksPath points to it
 *   - 'lefthook'       — lefthook.yml present in project root
 *   - 'hooks-path'     — core.hooksPath points outside Git's directory
 *   - 'frame-current'  — the hook is Frame's current template, unmodified
 *   - 'frame-previous' — an earlier Frame template, unmodified (upgradable)
 *   - 'custom'         — any other existing pre-commit content
 *   - 'vanilla'        — no existing hook (or only the .sample), safe to write
 */
async function detectHookSetup(projectPath) {
  if (!fs.existsSync(path.join(projectPath, '.git'))) return { setup: 'no-git', location: null };
  const location = await hookLocation(projectPath);
  if (!location) return { setup: 'no-git', location: null };

  // Lefthook check — config file in project root
  if (
    fs.existsSync(path.join(projectPath, 'lefthook.yml')) ||
    fs.existsSync(path.join(projectPath, 'lefthook.yaml'))
  ) {
    return { setup: 'lefthook', location };
  }

  // Husky check — .husky/ folder (with or without core.hooksPath set yet)
  const huskyDir = path.join(projectPath, '.husky');
  if (fs.existsSync(huskyDir) && fs.statSync(huskyDir).isDirectory()) {
    return { setup: 'husky', location };
  }

  // core.hooksPath elsewhere: that folder is the user's.
  if (!location.insideGitDir) return { setup: 'hooks-path', location };

  if (fs.existsSync(location.hookFile)) {
    let content;
    try {
      content = fs.readFileSync(location.hookFile, 'utf8');
    } catch (_) {
      // Can't read — treat as custom to be safe (don't overwrite blind)
      return { setup: 'custom', location };
    }
    const frame = classifyStructureHook(content);
    if (frame === 'current') return { setup: 'frame-current', location };
    if (frame === 'previous') return { setup: 'frame-previous', location };
    // Git's default samples end in .sample; a bare pre-commit file with
    // non-trivial content is the user's.
    if (content.trim().length > 0) return { setup: 'custom', location };
  }

  return { setup: 'vanilla', location };
}

function writeHook(location) {
  fs.mkdirSync(path.dirname(location.hookFile), { recursive: true });
  fs.writeFileSync(location.hookFile, getStructurePreCommitHookTemplate(), { mode: 0o755 });
  fs.chmodSync(location.hookFile, 0o755);
}

/**
 * Install the pre-commit hook, but only where there is no hook to damage.
 *
 * Frame writes exactly one hook file: `pre-commit` inside Git's own hooks
 * directory (never tracked), when there is none — or when the existing one
 * is an earlier Frame template nobody edited (STR-02b), which is replaced
 * with the current one. Husky, lefthook, a core.hooksPath folder and any
 * edited or custom hook get the snippet handed back as text — those files
 * are the user's, usually committed, and often generated by their tooling.
 *
 * Returns: { status, message, manualInstructions? }
 *   status: 'installed' | 'upgraded' | 'up-to-date' | 'skipped-custom'
 *           | 'skipped-husky' | 'skipped-no-git' | 'skipped-lefthook' | 'error'
 */
async function installPreCommitHook(projectPath) {
  const { setup, location } = await detectHookSetup(projectPath);

  if (setup === 'no-git') {
    return {
      status: 'skipped-no-git',
      message: 'Not a git repository — pre-commit hook not installed. STRUCTURE.json will only update via manual rescan.'
    };
  }

  if (setup === 'lefthook') {
    // Don't auto-edit lefthook.yml — it's structured config we'd risk
    // breaking. Surface manual instructions instead.
    return {
      status: 'skipped-lefthook',
      message: 'Lefthook detected — add this to your lefthook.yml manually:',
      manualInstructions: [
        'pre-commit:',
        '  commands:',
        '    frame-structure:',
        '      run: node .frame/bin/update-structure.js --staged || true',
        '      env:',
        '        FRAME_PROJECT_ROOT: "{root}"'
      ].join('\n')
    };
  }

  if (setup === 'husky') {
    // Same rule as lefthook: `.husky/pre-commit` is the user's file, tracked
    // in their repo and often generated by their own tooling. Frame writes
    // nothing there — it hands over the snippet and lets them paste it.
    return {
      status: 'skipped-husky',
      message: 'Husky detected — add this snippet to .husky/pre-commit manually:',
      manualInstructions: getStructureHookSnippet()
    };
  }

  if (setup === 'hooks-path') {
    return {
      status: 'skipped-custom',
      message: `core.hooksPath points to ${path.relative(projectPath, location.hooksDir) || location.hooksDir} — add this snippet to its pre-commit manually:`,
      manualInstructions: getStructureHookSnippet()
    };
  }

  if (setup === 'custom') {
    // Existing custom or edited hook — never rewritten. Show what to add.
    return {
      status: 'skipped-custom',
      message: 'Existing pre-commit hook detected — add this snippet to it manually:',
      manualInstructions: getStructureHookSnippet()
    };
  }

  if (setup === 'frame-current') {
    return { status: 'up-to-date', message: 'Frame pre-commit hook is current' };
  }

  // 'vanilla' or 'frame-previous' — Frame's to write
  try {
    writeHook(location);
    return setup === 'frame-previous'
      ? { status: 'upgraded', message: 'Frame pre-commit hook upgraded to stage the commit map from the index' }
      : { status: 'installed', message: 'Pre-commit hook installed' };
  } catch (err) {
    return { status: 'error', message: `Failed to install hook: ${err.message}` };
  }
}

/**
 * On project open: replace an unmodified earlier Frame template with the
 * current one. Nothing else is installed or touched here — a project without
 * a hook gets one only through init, as before.
 */
async function upgradeStructureHook(projectPath) {
  const { setup, location } = await detectHookSetup(projectPath);
  if (setup !== 'frame-previous') return { status: setup === 'frame-current' ? 'up-to-date' : 'untouched' };
  try {
    writeHook(location);
    return { status: 'upgraded' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// The scan's own budget comes from the project's validated policy; the
// parent waits that long plus a grace for the child to report and exit.
const SHUTDOWN_GRACE_MS = 5000;
const KILL_GRACE_MS = 2000;
const STDOUT_CAP = 256 * 1024;
const STDERR_CAP = 4096;
const RESULT_SCHEMA = 'frame.structure.result/1';
const REPAIR_COMMAND = 'node .frame/bin/update-structure.js --full';

function scanTimeoutMs(projectPath) {
  try {
    const { resolvePolicy } = require(path.join(SCRIPTS_SOURCE_DIR, 'structure-discovery'));
    const config = JSON.parse(fs.readFileSync(path.join(projectPath, FRAME_DIR, 'config.json'), 'utf8'));
    return resolvePolicy(config && config.project && config.project.structure).limits.timeoutMs + SHUTDOWN_GRACE_MS;
  } catch (_) {
    // No config or an invalid policy: the child reports the policy error
    // itself; the parent only needs a finite wait.
    return 30000 + SHUTDOWN_GRACE_MS;
  }
}

/** The single JSON envelope a `--json` run prints, or null. */
function parseEnvelope(stdout) {
  const lines = stdout.split('\n').filter((line) => line.trim());
  if (lines.length !== 1) return null;
  try {
    const envelope = JSON.parse(lines[0]);
    return envelope && envelope.schema === RESULT_SCHEMA && envelope.command === 'full' ? envelope : null;
  } catch (_) {
    return null;
  }
}

/** Map a child result envelope onto the bootstrap's initialScan summary. */
function summarizeEnvelope(envelope, code) {
  const counts = envelope.counts || {};
  const fields = {
    attemptId: envelope.attemptId || null,
    state: envelope.state,
    published: Boolean(envelope.published),
    artifact: envelope.artifact || null,
    coverage: envelope.coverage || null,
    extraction: envelope.extraction || null,
    counts: { indexedFiles: counts.indexedFiles ?? null, eligibleFiles: counts.eligibleFiles ?? null },
    reason: envelope.reason || null,
    recoveryPaths: envelope.recoveryPaths || [],
    repairCommand: REPAIR_COMMAND
  };
  if (envelope.exitCode !== code) {
    return { status: 'error', message: `Initial scan reported exit ${envelope.exitCode} but exited ${code}`, ...fields };
  }
  if (envelope.state === 'complete' && code === 0) {
    const empty = counts.indexedFiles === 0;
    return {
      status: 'ok',
      message: empty ? 'Initial STRUCTURE.json scan complete — no eligible files yet' : 'Initial STRUCTURE.json scan complete',
      empty,
      ...fields
    };
  }
  if (envelope.state === 'partial' && code === 1) {
    const incomplete = envelope.coverage && envelope.coverage.coverage === 'partial';
    return {
      status: 'partial',
      message: incomplete
        ? `Initial scan covered only part of the project (${(envelope.coverage.reasons || []).join(', ')})`
        : 'Initial scan complete, but some files could not be parsed',
      ...fields
    };
  }
  return {
    status: 'error',
    message: envelope.busy ? 'Initial scan skipped: another STRUCTURE update is running' : `Initial scan failed: ${envelope.reason || `exit ${code}`}`,
    ...fields
  };
}

/**
 * Run the parser in full mode once so STRUCTURE.json gets populated with
 * the project's existing files. The child runs asynchronously (the main
 * event loop stays free) with FRAME_PROJECT_ROOT targeting this project.
 *
 * The result is taken from the child's `--json` envelope, never from the
 * exit code alone: a missing, malformed or partial result is not success.
 * Both output streams are drained with bounded capture. The promise settles
 * exactly once. On timeout the child is terminated and, after it has
 * exited, only the attempt this call started is reconciled — a newer
 * attempt wins, and an artifact the child already published is kept, never
 * rolled back. A child that cannot be terminated keeps its lock.
 *
 * options (tests): parserPath, nodePath, timeoutMs, env, onChildExit
 * Returns: Promise<{ status: 'ok'|'partial'|'error', message, … }>
 */
function runInitialFullScan(projectPath, options = {}) {
  const parserPath = options.parserPath || path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, 'update-structure.js');
  if (!fs.existsSync(parserPath)) {
    return Promise.resolve({
      status: 'error',
      message: 'Parser script not found at .frame/bin/update-structure.js',
      repairCommand: REPAIR_COMMAND
    });
  }
  const attemptId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs || scanTimeoutMs(projectPath);

  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stdoutOverflow = false;
    let stderr = '';
    let timedOut = false;
    let timer = null;
    let killTimer = null;
    let abandonTimer = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(abandonTimer);
      resolve({ attemptId, ...result });
    };

    let child;
    try {
      child = spawn(options.nodePath || 'node', [parserPath, '--full', '--json'], {
        cwd: projectPath,
        env: { ...process.env, ...(options.env || {}), FRAME_PROJECT_ROOT: projectPath, FRAME_STRUCTURE_ATTEMPT_ID: attemptId },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ attemptId, status: 'error', message: `Initial scan failed to start: ${err.message}`, repairCommand: REPAIR_COMMAND });
      return;
    }

    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length <= STDOUT_CAP) stdout += chunk.toString();
      else stdoutOverflow = true; // keep draining; the result is now invalid
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString().slice(0, STDERR_CAP - stderr.length);
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        abandonTimer = setTimeout(() => {
          // Still alive after SIGKILL: its lock stays; nothing is reconciled.
          settle({ status: 'error', reason: 'child-unresponsive', message: 'Initial scan did not stop; its update lock is left in place', repairCommand: REPAIR_COMMAND });
        }, KILL_GRACE_MS);
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (err) => {
      // Never started (e.g. no node binary): there is no close to wait for.
      if (child.pid === undefined) {
        settle({ status: 'error', message: `Initial scan failed: ${err.message}`, repairCommand: REPAIR_COMMAND });
      }
    });

    child.on('close', async (code, signal) => {
      if (settled) return;
      if (options.onChildExit) {
        try { await options.onChildExit({ code, signal, timedOut }); } catch (_) { /* test hook */ }
      }
      if (timedOut || signal) {
        let outcome = null;
        try {
          const structureState = require(path.join(SCRIPTS_SOURCE_DIR, 'structure-state'));
          outcome = structureState.reconcileAttempt(projectPath, attemptId);
        } catch (err) {
          outcome = { outcome: 'error', error: err };
        }
        const record = outcome && outcome.record;
        const ours = outcome && (outcome.outcome === 'reconciled' || outcome.outcome === 'finished');
        settle({
          status: 'error',
          reason: timedOut ? 'timeout' : `signal-${signal}`,
          message: timedOut ? `Initial scan timed out after ${Math.round(timeoutMs / 1000)}s` : `Initial scan was terminated (${signal})`,
          reconciliation: outcome ? outcome.outcome : 'error',
          published: ours ? Boolean(record && record.published) : undefined,
          acknowledged: ours ? false : undefined,
          repairCommand: REPAIR_COMMAND
        });
        return;
      }
      const envelope = stdoutOverflow ? null : parseEnvelope(stdout);
      if (!envelope) {
        settle({
          status: 'error',
          reason: 'invalid-result',
          message: `Initial scan returned no valid result (exit ${code})${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
          repairCommand: REPAIR_COMMAND
        });
        return;
      }
      settle(summarizeEnvelope(envelope, code));
    });
  });
}

/**
 * Top-level bootstrap orchestrator. Called from frameProject.js after the
 * standard init steps. structureWasCreated tells us whether THIS init run
 * created STRUCTURE.json (vs. preserving an existing one) — we only do the
 * initial scan when we created the file, never overwriting user content.
 * Summary shape is stable: { copied, hook, initialScan }.
 */
async function bootstrapStructure(projectPath, structureWasCreated) {
  const summary = {
    copied: [],
    hook: null,
    initialScan: null
  };

  const staged = stageParserScripts(projectPath);
  summary.copied = staged.copied;
  // Not opted in: the tools ship (so opting in needs no re-init), nothing else runs.
  if (!structureEnabled(projectPath)) {
    summary.initialScan = { status: 'skipped-disabled', verified: false, message: PAUSED_MESSAGE, repairCommand: REPAIR_COMMAND };
    return summary;
  }
  summary.hook = await installPreCommitHook(projectPath);

  const parserPresent = fs.existsSync(path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, 'update-structure.js'));
  if (structureWasCreated && staged.unavailable.includes('update-structure.js') && !parserPresent) {
    summary.initialScan = {
      status: 'error',
      reason: 'tooling-unavailable',
      message: `STRUCTURE tooling could not be installed: ${staged.failed.map((f) => f.file).join(', ')}`,
      repairCommand: REPAIR_COMMAND
    };
  } else if (structureWasCreated) {
    summary.initialScan = await runInitialFullScan(projectPath);
  } else {
    summary.initialScan = {
      status: 'skipped-existing',
      verified: false,
      message: 'STRUCTURE.json existed before init — preserved as-is, not rescanned. To rebuild it: node .frame/bin/update-structure.js --full',
      repairCommand: REPAIR_COMMAND
    };
  }

  return summary;
}

/**
 * Install the pre-commit hook for a project that opted into the module map
 * after init (init installs it only when the map is on). The same rules as
 * init: only a vanilla .git/hooks gets a file — Husky, lefthook, core.hooksPath
 * and custom hooks get instructions back, and a current Frame hook is left as
 * it is. A project without the map is not touched.
 */
async function ensureStructureHook(projectPath) {
  if (!structureEnabled(projectPath)) return { status: 'disabled' };
  return installPreCommitHook(projectPath);
}

module.exports = {
  ensureStructureHook,
  bootstrapStructure,
  copyParserScripts,
  stageParserScripts,
  PARSER_FILES,
  PARSER_REQUIRES,
  LIFECYCLE_REQUIRES,
  detectHookSetup,
  installPreCommitHook,
  upgradeStructureHook,
  runInitialFullScan
};
