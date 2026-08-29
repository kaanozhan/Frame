/**
 * Spec-Driven Development Manager
 *
 * Owns .frame/specs/<slug>/{spec.md, plan.md, tasks.md, status.json}
 * for the active project. CRUD + file watcher + IPC.
 *
 * Data model is documented in PROJECT_NOTES.md (2026-04-29 entry).
 *
 * Mirrors the tasksManager.js pattern: stateless module-level functions
 * that take projectPath as input, plus a single watcher that lives for
 * the lifetime of the active project session.
 */

const fs = require('fs');
const path = require('path');
const fsSafe = require('./fsSafe');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_BIN_DIR, FRAME_CONFIG_FILE, FRAME_FILES, ORCH_META_FILES } = require('../shared/frameConstants');
const frameStore = require('./frameStore');
const tasksManager = require('./tasksManager');
const commandStaging = require('./commandStaging');
const frameProject = require('./frameProject');
const telemetry = require('./telemetry');
const activityLog = require('./activityLog');
const perfMonitor = require('./perfMonitor');

const SPECS_DIR_NAME = 'specs';
const STATUS_FILE = 'status.json';
const SPEC_FILE = 'spec.md';
const PLAN_FILE = 'plan.md';
const TASKS_FILE = 'tasks.md';
const OUTCOME_FILE = 'outcome.md';
const PLAN_REPORT_FILE = 'plan-report.html';
const IMPLEMENT_REPORT_FILE = 'implement-report.html';

const PHASES = ['draft', 'specified', 'planned', 'tasks_generated', 'implementing', 'done'];
const AI_TOOLS = ['claude-code', 'codex', 'gemini'];

const WATCH_DEBOUNCE_MS = 250;
const SELF_WRITE_GUARD_MS = 250;
const SLUG_MAX_LEN = 48;

let mainWindow = null;
let activeWatcher = null;
let activeTasksWatcher = null;
let activeWatchedProject = null;
let watchDebounce = null;
let tasksWatchDebounce = null;
// Stamped by writeStatus so the recursive specs watcher can drop the events
// our own status.json writes fire (mirrors tasksManager's lastSelfWriteAt).
let lastSelfWriteAt = 0;
// Last SPEC_DATA payload sent — skip-unchanged gate for pushSpecData.
let lastSpecPayloadJson = '';
// Slugs with a live agent mid-turn on their lane (renderer-fed via
// SPEC_AGENT_ACTIVITY). While a slug is here, file-existence phase
// advancement is deferred: command templates write plan.md / tasks.md
// stages before the turn (and its status.json update) is finished.
const busySpecSlugs = new Set();

// ─── Path helpers ──────────────────────────────────────────

function getSpecsRoot(projectPath) {
  return path.join(projectPath, FRAME_DIR, SPECS_DIR_NAME);
}

function getSpecDir(projectPath, slug) {
  return path.join(getSpecsRoot(projectPath), slug);
}

// ─── Validation ────────────────────────────────────────────
//
// Shape check only — phase enum, required fields, ISO date strings.
// Returns null when valid, or a human-readable reason string.

/**
 * Fill in the fields of a status.json that the folder itself already
 * answers, and report which ones were filled.
 *
 * Issue #122: Frame's own conductor agent wrote spec folders with `title`,
 * `phase` and timestamps — the fields the staged templates name — and the
 * panel then hid all five specs, because the validator also requires `slug`
 * and `generated_task_ids`. Both are derivable: the slug IS the folder's
 * name, and a spec that generated no tasks has none.
 *
 * An existing slug is never touched. A folder name disagreeing with a
 * recorded slug is a rename question, and rewriting it here would silently
 * cut every `source: spec:<slug>:T##` link in tasks.json.
 *
 * Returns { status, filled } — `status` is the same object when nothing was
 * missing, so callers can skip writing.
 */
function repairSpecStatus(obj, folderName) {
  if (!obj || typeof obj !== 'object') return { status: obj, filled: [] };

  const filled = [];
  const status = { ...obj };

  if ((typeof status.slug !== 'string' || !status.slug) && folderName) {
    status.slug = folderName;
    filled.push('slug');
  }
  if (!Array.isArray(status.generated_task_ids)) {
    status.generated_task_ids = [];
    filled.push('generated_task_ids');
  }

  return filled.length ? { status, filled } : { status: obj, filled: [] };
}

function validateSpecStatus(obj) {
  if (!obj || typeof obj !== 'object') return 'not an object';
  if (typeof obj.slug !== 'string' || !obj.slug) return 'missing slug';
  if (typeof obj.title !== 'string' || !obj.title) return 'missing title';
  if (!PHASES.includes(obj.phase)) return `invalid phase: ${obj.phase}`;
  if (obj.ai_tool != null && !AI_TOOLS.includes(obj.ai_tool)) {
    return `invalid ai_tool: ${obj.ai_tool}`;
  }
  if (!Array.isArray(obj.generated_task_ids)) return 'generated_task_ids must be an array';
  for (const k of ['created_at', 'updated_at', 'last_phase_at']) {
    if (obj[k] != null && Number.isNaN(Date.parse(obj[k]))) {
      return `invalid timestamp: ${k}`;
    }
  }
  return null;
}

// ─── Filesystem helpers ────────────────────────────────────

function readFileSafe(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch (err) {
    console.error('specManager: read failed', p, err);
    return null;
  }
}

function readStatus(projectPath, slug) {
  const statusPath = path.join(getSpecDir(projectPath, slug), STATUS_FILE);
  const { data, source, error } = fsSafe.readJsonWithRecovery(statusPath);
  if (source === 'bak') {
    console.error('specManager: status.json was corrupt — restored from .bak', slug);
  } else if (error) {
    console.error('specManager: status.json parse failed (corrupt copy preserved)', slug, error.message);
  }
  return data;
}

function writeStatus(projectPath, slug, status) {
  const dir = getSpecDir(projectPath, slug);
  fs.mkdirSync(dir, { recursive: true });
  const statusPath = path.join(dir, STATUS_FILE);
  const next = JSON.stringify(status, null, 2) + '\n';
  // Write-if-changed: reconcile/sync passes call this for every spec on
  // every push — identical content must not touch the disk (or re-fire the
  // recursive watcher).
  try {
    if (fs.readFileSync(statusPath, 'utf8') === next) return;
  } catch (_) {
    // missing/unreadable — fall through to write
  }
  lastSelfWriteAt = Date.now();
  fsSafe.writeFileAtomic(statusPath, next);
  // A real status write = a phase/content transition → refresh the
  // spec-knowledge index (debounced; ensureFresh itself no-ops when fresh).
  scheduleIndexRefresh(projectPath);
}

// ─── Spec-knowledge index refresh ─────────────────────────
//
// The derived .frame/index/spec-index.json is gitignored and lazily
// rebuilt; Frame's job is keeping it warm so the read-only hook
// (scripts/spec-hint.js) and the {spec_catalog} embed find it fresh.
// Same bundled-scripts location contract as structureBootstrap.

const specIndexLib = require(path.join(__dirname, '..', '..', 'scripts', 'spec-index.js'));

/** mtime of the derived index, or 0 — used to tell a rebuild from a no-op. */
function indexStamp(projectPath) {
  try {
    return fs.statSync(path.join(projectPath, FRAME_DIR, 'index', 'spec-index.json')).mtimeMs;
  } catch {
    return 0;
  }
}

let indexRefreshTimer = null;
function scheduleIndexRefresh(projectPath) {
  if (indexRefreshTimer) clearTimeout(indexRefreshTimer);
  indexRefreshTimer = setTimeout(() => {
    indexRefreshTimer = null;
    const startedAt = Date.now();
    const before = indexStamp(projectPath);
    specIndexLib.ensureFresh(projectPath).then(() => {
      // ensureFresh no-ops when the index is already current, and a no-op is
      // worth recording: otherwise the panel cannot tell a healthy skip from
      // a refresh that never ran.
      if (indexStamp(projectPath) === before) {
        activityLog.record('index.fresh', { reason: 'already-fresh' });
      } else {
        activityLog.record('index.rebuilt', { ms: Date.now() - startedAt });
      }
    }).catch((err) => {
      console.warn('specManager: spec-index refresh failed (non-fatal):', err.message);
    });
  }, 2000);
  if (typeof indexRefreshTimer.unref === 'function') indexRefreshTimer.unref();
}

/**
 * One line per non-excluded spec for the spec.new catalog embed. Reads the
 * warm index synchronously (getCommandPrompt is a sync IPC path); a cold
 * index falls back to a bare slug/title/phase listing and the scheduled
 * refresh warms it for the next dispatch.
 */
function buildSpecCatalog(projectPath) {
  scheduleIndexRefresh(projectPath);
  try {
    const idx = JSON.parse(fs.readFileSync(
      path.join(projectPath, FRAME_DIR, 'index', 'spec-index.json'), 'utf8'));
    const lines = specIndexLib.catalogLines(idx);
    if (lines.length) return lines.join('\n');
  } catch (_) { /* cold start — fall through */ }
  try {
    return listSpecs(projectPath)
      .filter((s) => !s.superseded_by)
      .map((s) => `- ${s.slug} · ${s.title} · ${s.phase}`)
      .join('\n');
  } catch (_) {
    return '';
  }
}

// ─── Public API ────────────────────────────────────────────

function listSpecs(projectPath) {
  const root = getSpecsRoot(projectPath);
  if (!fs.existsSync(root)) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.error('specManager: listSpecs readdir failed', err);
    return [];
  }

  // Load tasks once so reconcilePhase can look at task statuses (the
  // implementing → done transition is task-driven). Cheap on the order
  // of dozens of specs; if this ever becomes a hot path we can cache.
  let tasksData = null;
  try {
    tasksData = tasksManager.loadTasks(projectPath);
  } catch (err) {
    tasksData = null;
  }

  const specs = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // A directory holding none of the spec artifacts is not a spec — a
    // stray backup or scratch folder under .frame/specs/ stays invisible
    // rather than becoming a "malformed spec" card (issue #122 fix).
    if (!looksLikeSpecFolder(projectPath, ent.name)) continue;
    // Reconcile phase from filesystem state + task statuses — catches the
    // case where the AI wrote a plan.md / tasks.md but didn't (or couldn't)
    // update status.json, and also flips to implementing/done as the user
    // moves spec tasks through their lifecycle.
    reconcilePhase(projectPath, ent.name, tasksData);
    const status = readStatus(projectPath, ent.name);
    if (!status) {
      specs.push(malformedSpec(ent.name, null, 'is missing or unreadable'));
      continue;
    }

    // Fill what the folder already answers, and persist it once so the rest
    // of Frame reads the same file the panel now accepts.
    const { status: repaired, filled } = repairSpecStatus(status, ent.name);
    if (filled.length) {
      console.warn(`specManager: repaired ${ent.name}/status.json — filled ${filled.join(', ')}`);
      try {
        writeStatus(projectPath, ent.name, repaired);
      } catch (err) {
        console.error('specManager: could not persist the repair', ent.name, err.message);
      }
    }

    // Whatever is still wrong cannot be derived from the folder. It is shown
    // with its reason instead of disappearing: a spec the user can see and
    // fix beats a spec Frame pretends does not exist (issue #122).
    const reason = validateSpecStatus(repaired);
    if (reason) {
      console.warn(`specManager: ${ent.name}/status.json is unusable — ${reason}`);
      specs.push(malformedSpec(ent.name, repaired, reason));
      continue;
    }
    const status_ = repaired;
    const specTasks = collectSpecTasks(status_.slug, tasksData);
    const completedCount = specTasks.filter(t => t.status === 'completed').length;
    specs.push({
      slug: status_.slug,
      title: status_.title,
      phase: status_.phase,
      ai_tool: status_.ai_tool || null,
      task_count: specTasks.length || status_.generated_task_ids.length,
      completed_count: completedCount,
      created_at: status_.created_at || null,
      updated_at: status_.updated_at || null
    });
  }
  // Malformed first: a spec Frame cannot read needs a human, and sorting it
  // by a timestamp it doesn't have buried it under everything else.
  specs.sort((a, b) => {
    if (!!a.malformed !== !!b.malformed) return a.malformed ? -1 : 1;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });
  return specs;
}

/** A folder is a spec if it carries at least one of the chain's artifacts. */
function looksLikeSpecFolder(projectPath, folderName) {
  const dir = getSpecDir(projectPath, folderName);
  return [STATUS_FILE, SPEC_FILE, PLAN_FILE, TASKS_FILE, OUTCOME_FILE]
    .some(name => fs.existsSync(path.join(dir, name)));
}

/**
 * A spec folder Frame cannot read as a spec, rendered as itself rather than
 * dropped. It carries the folder name as its slug so every existing
 * slug-keyed path in the renderer keeps working, `phase: null` so nothing
 * mistakes it for a live phase, and the validator's reason for the user.
 */
function malformedSpec(folderName, status, reason) {
  return {
    slug: folderName,
    title: (status && typeof status.title === 'string' && status.title) || folderName,
    phase: null,
    malformed: reason,
    ai_tool: null,
    task_count: 0,
    completed_count: 0,
    created_at: (status && status.created_at) || null,
    updated_at: (status && status.updated_at) || null
  };
}

// ─── Phase derivation ──────────────────────────────────────
//
// Auto-advance phase based on which files exist on disk. The AI tool is
// supposed to update status.json after writing each artifact, but we don't
// rely on that — defense in depth.

function fileExists(projectPath, slug, name) {
  return fs.existsSync(path.join(getSpecDir(projectPath, slug), name));
}

function derivePhase(projectPath, slug, currentPhase, tasksDataOrNull, recordedTaskIds) {
  // No task data at all — the file could not be read, or an older Frame is
  // looking in the pre-`.frame/` place. "I don't know" is not "no tasks":
  // deriving from files alone here walked every finished spec in this
  // repository back from `done` to `tasks_generated`. Keep what is recorded.
  if (!tasksDataOrNull) return currentPhase;

  // Once spec-derived tasks exist, their statuses drive the implementing →
  // done transition. This overrides the file-based check so flipping a task
  // back to pending automatically rewinds the phase too.
  const specTasks = collectSpecTasks(slug, tasksDataOrNull);
  if (specTasks.length > 0) {
    const allCompleted = specTasks.every(t => t.status === 'completed');
    const anyStarted = specTasks.some(t => t.status === 'in_progress' || t.status === 'completed');
    if (allCompleted) return 'done';
    if (anyStarted) return 'implementing';
    // No started tasks → fall through to file-based check
  } else if (recordedTaskCount(projectPath, slug, recordedTaskIds) > 0) {
    // status.json records ids that tasks.json no longer carries. An
    // unreadable tasks.json is replaced with a fresh empty one, so the next
    // read looks like "this spec has no tasks" rather than "unreadable" —
    // and that walks a finished spec back just as a missing file did. Losing
    // the records is still "I don't know". A regenerate that legitimately
    // ends with no tasks rewrites `generated_task_ids` to [] and falls
    // through to the file-based check below.
    return currentPhase;
  }

  // A live agent is mid-turn on this spec: the command templates write
  // plan.md / tasks.md before their later stages (report, status.json
  // update) run, so advancing on file existence here would show a phase
  // ahead of reality. Hold the recorded phase — the busy→idle signal
  // triggers a reconcile that applies the fallback once the turn ends.
  if (busySpecSlugs.has(slug)) return currentPhase;

  if (fileExists(projectPath, slug, TASKS_FILE)) return 'tasks_generated';
  if (fileExists(projectPath, slug, PLAN_FILE)) return 'planned';
  if (fileExists(projectPath, slug, SPEC_FILE)) return 'specified';
  return 'draft';
}

function recordedTaskCount(projectPath, slug, recordedTaskIds) {
  if (Array.isArray(recordedTaskIds)) return recordedTaskIds.length;
  const status = readStatus(projectPath, slug);
  return status && Array.isArray(status.generated_task_ids) ? status.generated_task_ids.length : 0;
}

function collectSpecTasks(slug, tasksData) {
  if (!tasksData || !Array.isArray(tasksData.tasks)) return [];
  const prefix = `spec:${slug}:`;
  return tasksData.tasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
}

// A second Frame open on the same project — an older build that reads the
// pre-`.frame/` layout and derives phases differently — rewrites status.json
// the moment this one corrects it, and the two watchers answer each other
// indefinitely: disk writes, git churn and a phase that never settles.
//
// The signature is returning to the same phase over and over in a short
// space of time. A spec's own lifecycle climbs draft → … → done without
// repeating itself, and someone iterating — flipping a task back to pending,
// finishing it again — revisits a phase a few times across a working session.
// Two Frames answering each other do it within seconds, so the window is what
// separates them; a session-long tally would eventually punish real work.
const MAX_WRITES_PER_PHASE = 3;
const PHASE_WRITE_WINDOW_MS = 60 * 1000;
const phaseWrites = new Map();

function countPhaseWrite(projectPath, slug, phase, now) {
  const key = `${projectPath}::${slug}::${phase}`;
  const times = (phaseWrites.get(key) || []).filter((t) => now - t < PHASE_WRITE_WINDOW_MS);
  times.push(now);
  phaseWrites.set(key, times);
  return times.length;
}

function reconcilePhase(projectPath, slug, tasksDataOrNull) {
  const status = readStatus(projectPath, slug);
  if (!status) return;
  const newPhase = derivePhase(projectPath, slug, status.phase, tasksDataOrNull, status.generated_task_ids);
  if (newPhase === status.phase) return;

  const writes = countPhaseWrite(projectPath, slug, newPhase, Date.now());
  if (writes > MAX_WRITES_PER_PHASE) {
    if (writes === MAX_WRITES_PER_PHASE + 1) {
      console.warn(
        `specManager: "${slug}" keeps returning to "${newPhase}" — leaving it alone. ` +
        'Another Frame is probably open on this project; close the older one.'
      );
    }
    return;
  }

  const now = new Date().toISOString();
  writeStatus(projectPath, slug, {
    ...status,
    phase: newPhase,
    updated_at: now,
    last_phase_at: now
  });
  // Deliberately no `spec_phase_advanced` here. That event measures a spec
  // being carried through the workflow; this path is Frame reconciling on its
  // own, it fires on regressions as readily as advances, and a bulk reconcile
  // — opening a repository an older Frame walked backwards — sends one per
  // spec in a burst and trips the analytics rate limit. The activity record
  // below is where reconciliation belongs.
  //
  // Nobody asked for this: reconcile derives the phase from task statuses and
  // rewrites status.json on its own. A conflicted tasks.json once walked 18
  // specs backwards from `done` here with no trace at all.
  activityLog.record('spec.phase_reconciled', { slug, from: status.phase, to: newPhase });
}

// ─── Command template loading + interpolation ──────────────
//
// Templates live in src/templates/commands/<aiTool>/<command>.md (Frame
// defaults). Projects can override per-template by dropping a file into
// .frame/templates/commands/<aiTool>/<command>.md. {placeholder} tokens
// are substituted via a simple regex — no expression evaluation.

const FRAME_TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SUPPORTED_COMMANDS = ['spec.new', 'spec.plan', 'spec.tasks', 'spec.implement'];

function getDefaultTemplatePath(aiTool, command) {
  return path.join(FRAME_TEMPLATES_DIR, 'commands', aiTool, `${command}.md`);
}

function getOverrideTemplatePath(projectPath, aiTool, command) {
  return path.join(projectPath, FRAME_DIR, 'templates', 'commands', aiTool, `${command}.md`);
}

function loadCommandTemplate(projectPath, aiTool, command) {
  const override = readFileSafe(getOverrideTemplatePath(projectPath, aiTool, command));
  if (override) return override;
  return readFileSafe(getDefaultTemplatePath(aiTool, command));
}

function interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    return vars[key] != null ? String(vars[key]) : m;
  });
}

// `spec.new` is the one command that runs *before* a spec exists: the New Spec
// launcher hands the agent the user's raw text and the agent derives the slug,
// creates the folder and authors spec.md. So a slug-less call is legitimate for
// that command only — every other command reads an existing status.json.
const isSlugless = (slug, command) => !slug && command === 'spec.new';

function getCommandPrompt(projectPath, slug, command, aiTool, description) {
  if (!SUPPORTED_COMMANDS.includes(command)) return { error: `unknown command: ${command}` };
  const tool = aiTool || 'claude-code';
  const slugless = isSlugless(slug, command);
  // No slug means no status.json to read — the guard would reject the very
  // call the launcher makes. Every other path still requires the spec to
  // exist, and a slug-less call to one of them is a plain `spec not found`
  // rather than the TypeError readStatus(…, null) used to raise.
  const status = slug ? readStatus(projectPath, slug) : null;
  if (!slugless && !status) return { error: 'spec not found' };
  const template = loadCommandTemplate(projectPath, tool, command);
  if (!template) return { error: `no ${tool} template for ${command}` };
  const vars = {
    project_path: projectPath,
    // The user's free-form text, verbatim. Empty for every command whose
    // template carries no {description} token.
    description: description == null ? '' : String(description),
    report_template_path: REPORT_TEMPLATE_REL,
    report_generator_path: REPORT_GENERATOR_REL,
    // Full spec catalog only where it's consumed (spec.new's relatedness
    // evaluation and slug disambiguation) — other templates carry no
    // {spec_catalog} token.
    spec_catalog: command === 'spec.new' ? buildSpecCatalog(projectPath) : ''
  };
  // Deliberately absent on the slug-less path rather than blanked: neither
  // value exists yet, and the agent is the one that decides them.
  if (!slugless) {
    vars.slug = slug;
    vars.title = status.title;
  }
  return { prompt: interpolate(template, vars) };
}

// ─── Prompt file writer ──────────────────────────────────────
//
// Claude Code's terminal paste handler collapses large pastes into
// `[Pasted text #N +M lines]` placeholders, swallowing prompt bodies. To
// route around that, we write the interpolated prompt to a file under
// .frame/runtime/prompts/ and hand the renderer a short instruction it
// can safely send to the terminal. Claude's Read tool then fetches the
// file directly — full prompt arrives intact.

const RUNTIME_PROMPTS_DIR = path.join(FRAME_DIR, 'runtime', 'prompts');
const RUNTIME_ASSETS_DIR = path.join(FRAME_DIR, 'runtime', 'assets');
const REPORT_TEMPLATE_FILE = 'plan-report-template.html';
const REPORT_GENERATOR_FILE = 'build-implement-report.mjs';

const assetRelPath = (file) => path.posix.join(RUNTIME_ASSETS_DIR.replace(/\\/g, '/'), file);
const REPORT_TEMPLATE_REL = assetRelPath(REPORT_TEMPLATE_FILE);
const REPORT_GENERATOR_REL = assetRelPath(REPORT_GENERATOR_FILE);

// Which packaged assets each command needs on disk. Driven by the command
// rather than hardcoded: spec.plan's agent fills a template, spec.implement's
// runs a generator, and a terminal CLI can read neither from inside app.asar.
const COMMAND_ASSETS = {
  'spec.plan': [REPORT_TEMPLATE_FILE],
  'spec.implement': [REPORT_GENERATOR_FILE]
};

// Copied into .frame/runtime/assets/ on every dispatch, so a project's own
// override under .frame/templates/commands/<tool>/ is picked up as it changes.
function stageCommandAsset(projectPath, aiTool, file) {
  const tool = aiTool || 'claude-code';
  const override = path.join(projectPath, FRAME_DIR, 'templates', 'commands', tool, file);
  const fallback = path.join(FRAME_TEMPLATES_DIR, 'commands', tool, file);
  const source = fs.existsSync(override) ? override : fallback;
  let content;
  try {
    content = fs.readFileSync(source, 'utf8');
  } catch (err) {
    console.error(`specManager: command asset missing (${source}) — staging skipped`, err.message);
    return;
  }
  try {
    const assetsDir = path.join(projectPath, RUNTIME_ASSETS_DIR);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, file), content, 'utf8');
  } catch (err) {
    console.error(`specManager: staging ${file} failed`, err);
  }
}

function stageCommandAssets(projectPath, command, aiTool) {
  for (const file of COMMAND_ASSETS[command] || []) {
    stageCommandAsset(projectPath, aiTool, file);
  }
}

// ─── Command file staging ─────────────────────────────────────
//
// The staging of raw command templates, report assets and the launch helper
// into .frame/runtime/commands/<tool>/ and .frame/bin/ lives in
// commandStaging.js (cli-spec-command-parity) — it covers all four spec
// commands so a CLI session can self-serve the current flow. It runs on
// project open (WATCH_SPECS), init/enable, and every implement dispatch.

// ─── Implement-mode permissions ───────────────────────────────
//
// The autonomous implement mode runs a whole spec without a prompt between
// tasks, which is a launch-time concern: permissions cannot be set from
// inside a running session. Frame writes this file and the dispatch passes
// it as `--settings <path> --permission-mode auto`. It lives under .frame/
// so nothing is ever written to the user's own .claude/.
//
// The denylist carries the safety load. Deny is evaluated before anything
// else and cannot be overridden at a lower scope, so "never push" stops
// being a request in the prompt and becomes mechanically impossible — auto
// mode's classifier would otherwise permit pushing to the working repo.
// The allowlist only covers the known hot path so it resolves as rules
// without a classifier pass; anything else unanticipated but harmless is
// the classifier's job, not ours to enumerate.

const IMPLEMENT_PERMISSIONS_FILE = 'implement-permissions.json';

// Pushing, and history rewrites other than the mode's own `commit --amend`
// (which is safe precisely because nothing is pushed).
const IMPLEMENT_DENY = [
  'Bash(git push)',
  'Bash(git push *)',
  'Bash(git reset --hard *)',
  'Bash(git rebase *)',
  'Bash(git filter-branch *)',
  'Bash(git filter-repo *)',
  'Bash(git reflog expire *)',
  'Bash(git update-ref -d *)'
];

// Editing, and the git plumbing the loop needs: stage, commit, read a hash,
// read a diff. `Edit` covers Write and NotebookEdit too — file permission
// checks only match Edit() and Read() rules, so a Write() rule would be
// accepted and then never consulted.
const IMPLEMENT_ALLOW = [
  'Edit',
  'Read',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git show *)',
  'Bash(git log *)',
  'Bash(git rev-parse *)'
];

// The project's own check, in descending order of what actually verifies a
// change. Absent or blank means the run proceeds without one and says so —
// inventing a command is worse than admitting there isn't one.
function resolveVerificationCommand(projectPath) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE), 'utf8'));
  } catch (_) {
    return null;
  }
  const commands = (config && config.project && config.project.commands) || {};
  for (const key of ['test', 'lint', 'build']) {
    const value = typeof commands[key] === 'string' ? commands[key].trim() : '';
    if (value) return value;
  }
  return null;
}

function buildImplementPermissions(verification) {
  const allow = [...IMPLEMENT_ALLOW];
  if (verification) {
    // Exact plus prefix: `npm test` and `npm test -- --watch=false` both
    // resolve as rules. The space before `*` is load-bearing — `npm test*`
    // would also match an unrelated `npm testfoo`.
    allow.push(`Bash(${verification})`, `Bash(${verification} *)`);
  }
  return {
    permissions: {
      allow,
      deny: [...IMPLEMENT_DENY]
    }
  };
}

// Writes .frame/implement-permissions.json and reports what it resolved, so
// the dispatch can pass the path and the prompt can state the check it has.
function writeImplementPermissions(projectPath) {
  const verification = resolveVerificationCommand(projectPath);
  const absPath = path.join(projectPath, FRAME_DIR, IMPLEMENT_PERMISSIONS_FILE);
  try {
    fs.mkdirSync(path.join(projectPath, FRAME_DIR), { recursive: true });
    fsSafe.writeFileAtomic(absPath, JSON.stringify(buildImplementPermissions(verification), null, 2) + '\n');
  } catch (err) {
    console.error('specManager: implement permissions write failed', err);
    return { success: false, error: err.message };
  }
  return { success: true, absPath, verification };
}

// ─── Implement launch hint (D10) ──────────────────────────────
//
// Frame launches the CLI before the prompt can ask which mode the user
// wants, so it launches with the flags matching the *last* choice on this
// spec (status.json `implement_mode`), else the project default
// (.frame/config.json `implement.defaultMode`), else none. Picking a less
// autonomous mode than the flags allow is harmless; picking a more
// autonomous one costs one re-dispatch, which the prompt asks for.

const IMPLEMENT_MODE_AUTONOMOUS = 'autonomous';

function resolveImplementLaunchHint(projectPath, slug) {
  const status = readStatus(projectPath, slug);
  if (status && typeof status.implement_mode === 'string' && status.implement_mode) {
    return status.implement_mode;
  }
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE), 'utf8'));
    const mode = config && config.implement && config.implement.defaultMode;
    if (typeof mode === 'string' && mode) return mode;
  } catch (_) { /* no config, or unreadable — no hint */ }
  return null;
}

// The flags the lane's launch line needs for this dispatch. Only the
// autonomous mode needs any: without them every edit stops on a permission
// prompt, which is the exact thing that mode exists to avoid.
function getImplementLaunchFlags(projectPath, slug) {
  if (resolveImplementLaunchHint(projectPath, slug) !== IMPLEMENT_MODE_AUTONOMOUS) return [];
  const perms = writeImplementPermissions(projectPath);
  if (!perms.success) return [];
  return ['--settings', perms.absPath, '--permission-mode', 'auto'];
}

// A slug-less run has no stable name to key the prompt file on — `${slug}__`
// would yield `null__spec.new.md` and let every run overwrite the last. The
// prompt file *is* the recovery surface for the user's text when a run fails
// or its terminal is closed, so each run keeps its own: a millisecond stamp,
// disambiguated further if two land inside the same millisecond.
function specNewPromptFilename(date) {
  const ts = (date || new Date()).toISOString().replace(/[-:]/g, '').replace('.', '');
  return `spec.new__${ts}.md`;
}

function uniquePromptFilename(promptsDir, filename) {
  if (!fs.existsSync(path.join(promptsDir, filename))) return filename;
  const base = filename.replace(/\.md$/, '');
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}.md`;
    if (!fs.existsSync(path.join(promptsDir, candidate))) return candidate;
  }
}

function buildSpecCommandFile(projectPath, slug, command, aiTool, description) {
  const result = getCommandPrompt(projectPath, slug, command, aiTool, description);
  if (result.error) return result;
  const promptsDir = path.join(projectPath, RUNTIME_PROMPTS_DIR);
  fs.mkdirSync(promptsDir, { recursive: true });
  const slugless = isSlugless(slug, command);
  // Staging a slug-less spec.new prompt is the one thing only Frame's own New
  // Spec launcher does — it is the origin signal for the telemetry below.
  if (slugless) markSpecNewLaunch();
  const filename = slugless
    ? uniquePromptFilename(promptsDir, specNewPromptFilename())
    : `${slug}__${command}.md`;
  const absPath = path.join(promptsDir, filename);
  fs.writeFileSync(absPath, result.prompt, 'utf8');
  stageCommandAssets(projectPath, command, aiTool);
  // Implement dispatches also refresh the staged templates, assets and helper
  // so an out-of-app helper launch always finds the latest on disk.
  if (command === 'spec.implement') commandStaging.stageCommandFiles(projectPath);
  const relPath = path.posix.join(RUNTIME_PROMPTS_DIR.replace(/\\/g, '/'), filename);
  return {
    success: true,
    relPath,
    // Empty for every command but spec.implement, and for spec.implement
    // unless the launch hint is autonomous. The renderer passes these
    // through to the CLI launch line without interpreting them.
    launchFlags: command === 'spec.implement' ? getImplementLaunchFlags(projectPath, slug) : [],
    instruction: `Read ${relPath} and follow its instructions exactly.`
  };
}

// ─── tasks.md → tasks.json sync (Slice 1.8) ────────────────
//
// When a spec advances to phase `tasks_generated`, parse its tasks.md and
// upsert each entry into the project's tasks.json with a `source` marker
// of the form `spec:<slug>:T<n>`. Re-syncs update titles in place but
// preserve user-set status (pending → in_progress → completed).
//
// Known limitation: deleting a spec-sourced task in the Tasks panel will
// have it re-imported on the next sync. Slice 3 can track dismissals.

const TASK_LINE_RE = /^\s*-\s*(T\d{1,3})\s*[·:.\-—]?\s*(.+?)\s*$/;

function parseTasksMarkdown(content) {
  if (!content) return [];
  const out = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(TASK_LINE_RE);
    if (!m) continue;
    const description = m[2].trim();
    if (!description) continue;
    out.push({ taskId: m[1], description });
  }
  return out;
}

// ─── plan.md → footprint (orchestration conflict detection) ──
//
// The plan command template emits a `## Footprint` section: a flat list of
// `- <path|glob>` bullets naming the source files a spec creates/modifies. The
// orchestrator parses these to detect collisions between specs running in
// parallel worktrees. Meta files (tasks.json / STRUCTURE.json / PROJECT_NOTES.md
// / AGENTS.md|CLAUDE.md) are excluded — the template says so, and we filter
// defensively here too so a stray entry can't mark every spec as conflicting.

const FOOTPRINT_HEADING_RE = /^\s*#{1,6}\s+footprint\s*$/i;
const ANY_HEADING_RE = /^\s*#{1,6}\s+/;
const FOOTPRINT_ITEM_RE = /^\s*-\s+(.+?)\s*$/;

function parseFootprintMarkdown(content) {
  if (!content) return [];
  const out = [];
  let inSection = false;
  for (const line of content.split(/\r?\n/)) {
    if (FOOTPRINT_HEADING_RE.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (ANY_HEADING_RE.test(line)) break; // next heading ends the Footprint section
    const m = line.match(FOOTPRINT_ITEM_RE);
    if (!m) continue;
    const item = m[1].trim().replace(/^`+|`+$/g, '').trim();
    if (!item) continue;
    if (/^[_*].*[_*]$/.test(item)) continue;            // placeholder e.g. _…_
    if (ORCH_META_FILES.includes(item.split('/').pop())) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function getSpecFootprint(projectPath, slug) {
  const plan = readFileSafe(path.join(getSpecDir(projectPath, slug), PLAN_FILE));
  return parseFootprintMarkdown(plan);
}

function syncTasksFromMarkdown(projectPath, slug) {
  const tasksMdPath = path.join(getSpecDir(projectPath, slug), TASKS_FILE);
  const md = readFileSafe(tasksMdPath);
  if (!md) return { synced: 0 };

  const parsed = parseTasksMarkdown(md);
  if (parsed.length === 0) return { synced: 0 };

  // tasksManager.loadTasks owns shape normalization (flat array since v2.0,
  // legacy nested shape transparently migrated). Going through it also
  // wires us into the self-write guard so our writes don't trigger the
  // tasks.json file watcher into a loop.
  const tasksData = tasksManager.loadTasks(projectPath);
  if (!tasksData) return { synced: 0, error: 'no tasks.json in project' };
  if (!Array.isArray(tasksData.tasks)) tasksData.tasks = [];

  const now = new Date().toISOString();
  const generatedIds = [];
  let added = 0, updated = 0, unchanged = 0;

  for (const item of parsed) {
    const sourceMarker = `spec:${slug}:${item.taskId}`;
    const id = `task-spec-${slug}-${item.taskId}`;
    const existing = tasksData.tasks.find(t => t && t.source === sourceMarker);
    if (existing) {
      generatedIds.push(existing.id);
      if (existing.title !== item.description) {
        existing.title = item.description;
        existing.updatedAt = now;
        updated++;
      } else {
        unchanged++;
      }
    } else {
      tasksData.tasks.push({
        id,
        title: item.description,
        description: '',
        source: sourceMarker,
        status: 'pending',
        priority: 'medium',
        category: 'feature',
        context: `From spec: ${slug}`,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      });
      tasksData.metadata = tasksData.metadata || {};
      tasksData.metadata.totalCreated = (tasksData.metadata.totalCreated || 0) + 1;
      generatedIds.push(id);
      added++;
    }
  }

  // Only save if something actually changed — saveTasks bumps lastUpdated and
  // the self-write guard, both of which we want to keep stable on no-op syncs.
  if (added > 0 || updated > 0) {
    tasksManager.saveTasks(projectPath, tasksData);
  }

  // Reflect the latest mapping in status.json so the panel shows accurate
  // task counts even after re-imports.
  const status = readStatus(projectPath, slug);
  if (status && !arraysEqual(status.generated_task_ids, generatedIds)) {
    writeStatus(projectPath, slug, {
      ...status,
      generated_task_ids: generatedIds,
      updated_at: now
    });
  }

  // Push a fresh TASKS_DATA so any open Tasks panel / Kanban dashboard
  // picks up the new rows without needing a manual reload.
  if ((added > 0 || updated > 0) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.TASKS_DATA, { projectPath, tasks: tasksData });
  }

  return { synced: parsed.length, added, updated, unchanged };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function syncAllSpecTasks(projectPath) {
  const root = getSpecsRoot(projectPath);
  if (!fs.existsSync(root)) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(root, ent.name, TASKS_FILE))) {
      syncTasksFromMarkdown(projectPath, ent.name);
    }
  }
}

function getSpec(projectPath, slug) {
  const dir = getSpecDir(projectPath, slug);
  if (!fs.existsSync(dir)) return null;
  const status = readStatus(projectPath, slug);
  if (!status) return null;
  const reportPath = path.join(dir, PLAN_REPORT_FILE);
  const implementReportPath = path.join(dir, IMPLEMENT_REPORT_FILE);
  return {
    status,
    spec: readFileSafe(path.join(dir, SPEC_FILE)),
    plan: readFileSafe(path.join(dir, PLAN_FILE)),
    tasks: readFileSafe(path.join(dir, TASKS_FILE)),
    outcome: readFileSafe(path.join(dir, OUTCOME_FILE)),
    planReportPath: fs.existsSync(reportPath) ? reportPath : null,
    implementReportPath: fs.existsSync(implementReportPath) ? implementReportPath : null,
    // Resolved implement-mode hint (status.implement_mode → config
    // implement.defaultMode → null), so the modal's preselection and the
    // next-action button's label read one authoritative value instead of
    // re-deriving the resolution in the renderer.
    implementHint: resolveImplementLaunchHint(projectPath, slug)
  };
}

/**
 * Search specs by keyword over their spec.md content. Case-insensitive
 * substring match. Returns the array of matching slugs, or null for an
 * empty/whitespace query (meaning "no search active" — caller shows all).
 * Used by the specs dashboard search box; the renderer intersects the
 * result with the active phase filter.
 */
function searchSpecs(projectPath, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const root = getSpecsRoot(projectPath);
  if (!fs.existsSync(root)) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.error('specManager: searchSpecs readdir failed', err);
    return [];
  }
  const matches = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const body = readFileSafe(path.join(getSpecDir(projectPath, ent.name), SPEC_FILE));
    if (body && body.toLowerCase().includes(q)) matches.push(ent.name);
  }
  return matches;
}

function updateSpecStatus(projectPath, slug, partial) {
  const current = readStatus(projectPath, slug);
  if (!current) return { error: 'spec not found' };
  const phaseChanged = partial && partial.phase && partial.phase !== current.phase;
  const now = new Date().toISOString();
  // Repair first: a status.json written without `slug` / `generated_task_ids`
  // used to fail validation here too, so an agent-created spec could not have
  // its phase advanced through the API either (issue #122).
  const { status: base } = repairSpecStatus(current, slug);
  const merged = {
    ...base,
    ...partial,
    slug: base.slug, // slug is immutable
    updated_at: now,
    last_phase_at: phaseChanged ? now : base.last_phase_at
  };
  const reason = validateSpecStatus(merged);
  if (reason) return { error: reason };
  writeStatus(projectPath, slug, merged);
  if (phaseChanged) telemetry.track('spec_phase_advanced', { phase: merged.phase });
  return { status: merged };
}

function deleteSpec(projectPath, slug) {
  const dir = getSpecDir(projectPath, slug);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// Rename a spec: moves the folder, updates status.json's slug field, and
// rewrites every spec-derived task's `source` marker in tasks.json so the
// linkage is preserved. Optionally also updates the display title.
//
// Validation rules for the new slug:
//   - kebab-case [a-z0-9-]+, no leading/trailing hyphens, no double hyphens
//   - max length SLUG_MAX_LEN
//   - must not collide with another spec in the project
//
// Returns { success: true, slug, status } on success, { error } on failure.
function renameSpec(projectPath, oldSlug, opts) {
  const next = opts || {};
  const wantSlug = next.slug != null;
  const wantTitle = next.title != null && typeof next.title === 'string';

  if (!wantSlug && !wantTitle) return { error: 'nothing to rename' };

  // Resolve current spec
  const oldDir = getSpecDir(projectPath, oldSlug);
  if (!fs.existsSync(oldDir)) return { error: 'spec not found' };
  const status = readStatus(projectPath, oldSlug);
  if (!status) return { error: 'status.json missing' };

  let newSlug = oldSlug;
  let folderRenamed = false;

  if (wantSlug) {
    const candidate = String(next.slug).trim();
    const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!candidate || !slugRe.test(candidate)) {
      return { error: 'invalid slug — use kebab-case (a-z, 0-9, single hyphens)' };
    }
    if (candidate.length > SLUG_MAX_LEN) {
      return { error: `slug too long (max ${SLUG_MAX_LEN} chars)` };
    }
    if (candidate !== oldSlug) {
      const collidingDir = getSpecDir(projectPath, candidate);
      if (fs.existsSync(collidingDir)) return { error: 'slug already in use' };

      // Move folder first; if anything fails after this, we still have data
      try {
        fs.renameSync(oldDir, collidingDir);
        folderRenamed = true;
        newSlug = candidate;
      } catch (err) {
        return { error: 'could not rename folder: ' + err.message };
      }
    }
  }

  const now = new Date().toISOString();
  const newStatus = {
    ...status,
    slug: newSlug,
    title: wantTitle ? String(next.title).trim() || status.title : status.title,
    updated_at: now
  };
  writeStatus(projectPath, newSlug, newStatus);

  // Update every spec-derived task's source marker if the slug changed.
  // Keep going even if this fails — folder rename is the canonical change.
  if (folderRenamed) {
    try {
      const tasksData = tasksManager.loadTasks(projectPath);
      if (tasksData && Array.isArray(tasksData.tasks)) {
        const oldPrefix = `spec:${oldSlug}:`;
        const newPrefix = `spec:${newSlug}:`;
        const oldIdPrefix = `task-spec-${oldSlug}-`;
        const newIdPrefix = `task-spec-${newSlug}-`;
        let touched = 0;
        for (const task of tasksData.tasks) {
          if (task && typeof task.source === 'string' && task.source.startsWith(oldPrefix)) {
            task.source = newPrefix + task.source.slice(oldPrefix.length);
            // Also rewrite the deterministic id so it stays in sync
            if (task.id && task.id.startsWith(oldIdPrefix)) {
              task.id = newIdPrefix + task.id.slice(oldIdPrefix.length);
            }
            // Keep context field readable too
            if (task.context === `From spec: ${oldSlug}`) {
              task.context = `From spec: ${newSlug}`;
            }
            task.updatedAt = now;
            touched++;
          }
        }
        if (touched > 0) {
          tasksManager.saveTasks(projectPath, tasksData);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.TASKS_DATA, { projectPath, tasks: tasksData });
          }
        }

        // Also update generated_task_ids in status.json so back-references stay valid
        if (Array.isArray(newStatus.generated_task_ids) && newStatus.generated_task_ids.length > 0) {
          newStatus.generated_task_ids = newStatus.generated_task_ids.map(id =>
            id.startsWith(oldIdPrefix) ? newIdPrefix + id.slice(oldIdPrefix.length) : id
          );
          writeStatus(projectPath, newSlug, newStatus);
        }
      }
    } catch (err) {
      console.error('specManager: tasks.json source-marker update failed', err);
    }
  }

  // Trigger a fresh SPEC_DATA push so the panel reflects the new slug
  pushSpecData(projectPath);

  return { success: true, slug: newSlug, status: newStatus };
}

// ─── Watcher ───────────────────────────────────────────────
//
// fs.watch with recursive: true. Supported on macOS, Windows, and Linux
// (Node ≥ 20.5). Electron 28 ships with a Node version that supports this
// across all three platforms — if that ever changes, swap in a poller.

// Burst state for the two watchers: raw fire count and the distinct files
// behind it, both reset when the debounce flushes.
let specsBurst = { fires: 0, files: new Set() };
let specTasksFires = 0;

function startWatching(projectPath) {
  stopWatching();
  if (!projectPath) return;
  // A fresh watch means a fresh renderer (boot, reload, project switch) —
  // force the next push through the skip-unchanged gate so it always paints,
  // and drop stale busy flags: the new renderer re-derives lane activity
  // from scratch and re-sends it.
  lastSpecPayloadJson = '';
  busySpecSlugs.clear();
  // A project whose layout question is still open gets nothing written to it,
  // this directory included. `openProjectLayout` either settles the question
  // or leaves the project alone; until it has, creating `.frame/specs/` here
  // would be exactly the pre-consent write the overlay promised not to make —
  // and it arrives by whichever IPC message the renderer happens to send
  // first, which is why the gate lives here and not only in the open path.
  if (frameStore.isLegacyLayout(projectPath)) return;

  const root = getSpecsRoot(projectPath);
  // Ensure the directory exists so fs.watch doesn't throw on a fresh project
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (err) {
    console.error('specManager: could not create specs root', err);
    return;
  }
  try {
    activeWatcher = fsSafe.safeWatch(root, { recursive: true }, (_event, filename) => {
      // Our own writeStatus calls fire this watcher too — drop them.
      if (Date.now() - lastSelfWriteAt < SELF_WRITE_GUARD_MS) {
        activityLog.record('watch.suppressed', { watcher: 'specs', reason: 'self-write' });
        return;
      }
      specsBurst.fires += 1;
      if (filename) specsBurst.files.add(String(filename));
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        // Reported when the debounce flushes, so the record carries what the
        // burst actually was rather than one row per raw fs event.
        activityLog.record('watch.fired', {
          watcher: 'specs',
          changes: specsBurst.files.size || specsBurst.fires,
          collapsed: specsBurst.fires,
          triggered: 'push'
        });
        specsBurst = { fires: 0, files: new Set() };
        pushSpecData(projectPath);
      }, WATCH_DEBOUNCE_MS);
    }, () => { activeWatcher = null; });
    activeWatchedProject = projectPath;
  } catch (err) {
    console.error('specManager: fs.watch failed', err);
    return;
  }

  // Also watch tasks.json — spec phase transitions to "implementing" /
  // "done" are driven by spec-derived task statuses, so a status flip in
  // the Tasks panel needs to refresh SPEC_DATA too. Independent watcher
  // so we don't depend on tasksManager's internal pub/sub.
  const tasksJsonPath = frameStore.resolvePath(projectPath, FRAME_FILES.TASKS);
  if (fs.existsSync(tasksJsonPath)) {
    try {
      activeTasksWatcher = fsSafe.safeWatch(tasksJsonPath, null, () => {
        // tasks.json writes we caused ourselves (syncTasksFromMarkdown /
        // renameSpec go through tasksManager.saveTasks) must not re-trigger
        // a push — that was the audit's watcher feedback loop.
        if (Date.now() - tasksManager.getLastSelfWriteAt() < SELF_WRITE_GUARD_MS) {
          activityLog.record('watch.suppressed', { watcher: 'spec-tasks', reason: 'self-write' });
          return;
        }
        specTasksFires += 1;
        if (tasksWatchDebounce) clearTimeout(tasksWatchDebounce);
        tasksWatchDebounce = setTimeout(() => {
          activityLog.record('watch.fired', {
            watcher: 'spec-tasks',
            changes: 1,
            collapsed: specTasksFires,
            triggered: 'push'
          });
          specTasksFires = 0;
          pushSpecData(projectPath);
        }, WATCH_DEBOUNCE_MS);
      }, () => { activeTasksWatcher = null; });
    } catch (err) {
      console.error('specManager: tasks.json watch failed', err);
    }
  }

  // Initial snapshot so the panel paints something immediately
  pushSpecData(projectPath);
}

function stopWatching() {
  if (activeWatcher) {
    try { activeWatcher.close(); } catch (err) { /* ignore */ }
  }
  activeWatcher = null;
  if (activeTasksWatcher) {
    try { activeTasksWatcher.close(); } catch (err) { /* ignore */ }
  }
  activeTasksWatcher = null;
  activeWatchedProject = null;
  busySpecSlugs.clear();
  // Another project's specs are not this one's creations — the next push
  // reseeds from whatever that project already has on disk.
  authoredSpecSlugs = null;
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
  if (tasksWatchDebounce) {
    clearTimeout(tasksWatchDebounce);
    tasksWatchDebounce = null;
  }
}

// ─── spec_created ─────────────────────────────────────────
//
// The event used to fire inside createSpec, which no longer exists — and it
// fired *before* the write that produced spec.md, unconditionally, so every
// empty-description creation counted a spec that was only a status.json.
//
// The trigger is now "this slug's spec.md exists and did not before", checked
// on the watcher's own push. Keyed on spec.md rather than the folder or
// status.json on purpose: a folder whose authoring failed is not a spec that
// was created. Specs written by the CLI or the conductor now count too, which
// is what PRIVACY.md already documents the event as meaning.
//
// null = no snapshot yet. The first push after a project opens seeds it from
// what is already on disk, so nothing is backfilled and a deleted-then-
// rewritten spec.md is not counted twice.
let authoredSpecSlugs = null;

// Outstanding New Spec launches — one timestamp per slug-less spec.new prompt
// Frame staged, consumed by the spec it produces. A run the user abandoned
// would otherwise sit here forever and attribute someone else's spec to the
// button, so a marker expires; `button` may undercount, never overcount.
const SPEC_NEW_LAUNCH_TTL_MS = 30 * 60 * 1000;
let pendingSpecNewLaunches = [];

function markSpecNewLaunch() {
  pendingSpecNewLaunches.push(Date.now());
}

function consumeSpecNewLaunch() {
  const cutoff = Date.now() - SPEC_NEW_LAUNCH_TTL_MS;
  pendingSpecNewLaunches = pendingSpecNewLaunches.filter((at) => at >= cutoff);
  return pendingSpecNewLaunches.length ? (pendingSpecNewLaunches.shift(), true) : false;
}

/**
 * How this spec was started, from Frame's own state — never guessed from the
 * agent. The launcher marker wins because it is the only positive evidence;
 * `conductor` is read from the orchestration session; everything else is a
 * user asking an agent directly, whether in a conversation or by typing the
 * command. Required lazily: orchestrationManager requires this module.
 */
function resolveSpecOrigin(projectPath) {
  if (consumeSpecNewLaunch()) return 'button';
  try {
    const orchState = require('./orchestrationManager').getState(projectPath);
    if (orchState && orchState.active) return 'conductor';
  } catch (err) {
    console.error('specManager: orchestration state unreadable for spec origin', err.message);
  }
  return 'agent';
}

function trackNewlyAuthoredSpecs(projectPath, specs) {
  const authored = new Set();
  for (const spec of specs) {
    if (fileExists(projectPath, spec.slug, SPEC_FILE)) authored.add(spec.slug);
  }
  const previous = authoredSpecSlugs;
  authoredSpecSlugs = authored;
  if (!previous) return;

  const appeared = [...authored].filter((slug) => !previous.has(slug));
  // Two specs in one push: nothing says which launch produced which, so
  // neither is attributed. The event still fires — it is the origin that is
  // unknown, not the creation.
  const attributable = appeared.length === 1;
  for (const _slug of appeared) {
    const origin = attributable ? resolveSpecOrigin(projectPath) : null;
    telemetry.track('spec_created', origin ? { origin } : undefined);
  }
}

function pushSpecData(projectPath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  perfMonitor.opStart('spec-push');
  // Sync any spec with tasks.md → tasks.json before listing, so renderer
  // sees consistent task counts and the Tasks panel auto-refreshes. The
  // tasks.json parse behind both calls is served once by tasksManager's
  // load cache.
  syncAllSpecTasks(projectPath);
  const specs = listSpecs(projectPath);
  perfMonitor.opEnd('spec-push');
  // Before the skip-unchanged gate: a newly authored spec.md must be counted
  // on the push that first sees it, whatever the payload comparison decides.
  trackNewlyAuthoredSpecs(projectPath, specs);
  // Skip-unchanged: same channel, same payload shape — but only send when
  // the data actually changed since the last push.
  const payloadJson = JSON.stringify({ projectPath, specs });
  if (payloadJson === lastSpecPayloadJson) return;
  lastSpecPayloadJson = payloadJson;
  mainWindow.webContents.send(IPC.SPEC_DATA, { projectPath, specs });
}

// ─── Init + IPC ────────────────────────────────────────────

function init(window) {
  mainWindow = window;
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LIST_SPECS, (event, projectPath) =>
    listSpecs(projectPath)
  );
  ipcMain.handle(IPC.SEARCH_SPECS, (event, { projectPath, query }) =>
    searchSpecs(projectPath, query)
  );
  ipcMain.handle(IPC.GET_SPEC, (event, { projectPath, slug }) =>
    getSpec(projectPath, slug)
  );
  ipcMain.handle(IPC.UPDATE_SPEC_STATUS, (event, { projectPath, slug, partial }) =>
    updateSpecStatus(projectPath, slug, partial)
  );
  ipcMain.handle(IPC.RENAME_SPEC, (event, { projectPath, oldSlug, opts }) =>
    renameSpec(projectPath, oldSlug, opts)
  );
  ipcMain.handle(IPC.GET_SPEC_PROMPT, (event, { projectPath, slug, command, aiTool, description }) =>
    getCommandPrompt(projectPath, slug, command, aiTool, description)
  );
  ipcMain.handle(IPC.BUILD_SPEC_COMMAND_FILE, (event, { projectPath, slug, command, aiTool, description }) =>
    buildSpecCommandFile(projectPath, slug, command, aiTool, description)
  );
  ipcMain.on(IPC.WATCH_SPECS, (event, projectPath) => {
    startWatching(projectPath);
    // Project open, in three steps whose order is load-bearing:
    //
    //   1. stage the command templates, report assets and launch helper, so a
    //      CLI session can self-serve the current flow before any dispatch;
    //   2. re-ensure the artifacts a project upgraded from an older Frame
    //      never received — above all `.frame/docs/REFERENCE.md`;
    //   3. upgrade the docs' managed sections to the current generation.
    //
    // 2 before 3 is the fix: the pointer's target must exist before anything
    // writes a pointer at it. Both live in this one handler rather than
    // splitting across IS_FRAME_PROJECT precisely so that ordering is a single
    // synchronous block instead of two IPC messages racing.
    //
    // Never breaks watching.
    //
    // Skipped entirely while the layout is unsettled: step 3 resolves its
    // target through frameStore, which for an unmigrated project is the
    // *root* AGENTS.md — writing there before the move is what dirtied the
    // file and then made the migration refuse to run.
    if (frameStore.isLegacyLayout(projectPath)) return;
    try {
      commandStaging.stageCommandFiles(projectPath);
      frameProject.ensureProjectArtifacts(projectPath);
      frameProject.upgradeSpecDocs(projectPath);
    } catch (err) {
      console.error('specManager: command staging failed', err);
    }
  });
  ipcMain.on(IPC.UNWATCH_SPECS, () => {
    stopWatching();
  });
  ipcMain.on(IPC.SPEC_AGENT_ACTIVITY, (event, payload) => {
    const { slug, busy } = payload || {};
    if (typeof slug !== 'string' || !slug) return;
    const wasBusy = busySpecSlugs.has(slug);
    if (busy) busySpecSlugs.add(slug);
    else busySpecSlugs.delete(slug);
    // Busy → idle is the moment the deferred file-based reconcile runs —
    // catches agents that wrote artifacts but never updated status.json.
    if (wasBusy && !busy && activeWatchedProject) pushSpecData(activeWatchedProject);
  });
}

module.exports = {
  init,
  setupIPC,
  // Exported for tests
  validateSpecStatus,
  repairSpecStatus,
  listSpecs,
  searchSpecs,
  getSpec,
  updateSpecStatus,
  renameSpec,
  deleteSpec,
  derivePhase,
  reconcilePhase,
  startWatching,
  getCommandPrompt,
  buildSpecCommandFile,
  specNewPromptFilename,
  buildImplementPermissions,
  resolveVerificationCommand,
  writeImplementPermissions,
  resolveImplementLaunchHint,
  getImplementLaunchFlags,
  parseTasksMarkdown,
  syncTasksFromMarkdown,
  parseFootprintMarkdown,
  getSpecFootprint
};
