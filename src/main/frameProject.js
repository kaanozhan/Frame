/**
 * Frame Project Module
 * Handles Frame project initialization and detection
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_CONFIG_FILE, FRAME_FILES, FRAME_BIN_DIR, CLAUDE_RULE_PATH } = require('../shared/frameConstants');
const templates = require('../shared/frameTemplates');
const frameStore = require('./frameStore');
const gitExclude = require('./gitExclude');
const gitSharing = require('./gitSharing');
const layoutMigration = require('./layoutMigration');
const workspace = require('./workspace');
const structureBootstrap = require('./structureBootstrap');
const commandStaging = require('./commandStaging');
const docsManagedBlock = require('../shared/docsManagedBlock');
const docsHealth = require('../shared/docsHealth');
const perfMonitor = require('./perfMonitor');
const activityLog = require('./activityLog');
const detector = require('../../scripts/detect-project');

let mainWindow = null;

/**
 * Initialize frame project module
 */
function init(window) {
  mainWindow = window;

  // .claude/rules/frame.md is a copy of .frame/AGENTS.md, so it goes stale the
  // moment an agent edits AGENTS.md mid-session. tasksManager already watches
  // the meta directory; this rides along rather than opening a second watcher.
  try {
    require('./tasksManager').onMetaFileChange((projectPath, filename) => {
      if (filename === FRAME_FILES.AGENTS) syncClaudeRule(projectPath);
    });
  } catch (err) {
    console.warn('[frame] could not watch AGENTS.md for rule sync (non-fatal):', err.message);
  }
}

/**
 * Check if a project is a Frame project
 */
function isFrameProject(projectPath) {
  const configPath = path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE);
  return fs.existsSync(configPath);
}

/**
 * Get Frame config from project
 */
function getFrameConfig(projectPath) {
  const configPath = path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE);
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

/**
 * Create file if it doesn't exist
 */
async function createFileIfNotExists(filePath, content) {
  if (!fs.existsSync(filePath)) {
    const contentStr = typeof content === 'string'
      ? content
      : JSON.stringify(content, null, 2);
    await fsp.writeFile(filePath, contentStr, 'utf8');
    return true;
  }
  return false;
}

/**
 * Check which Frame files already exist in the project
 */
function checkExistingFrameFiles(projectPath) {
  const existingFiles = [];
  // Only Frame's own paths: a CLAUDE.md or AGENTS.md at the project root is
  // the user's file, and init neither reads nor replaces it, so listing it as
  // "already exists" would describe a conflict that no longer happens.
  const filesToCheck = [
    { name: '.frame/', path: path.join(projectPath, FRAME_DIR) },
    { name: `${FRAME_DIR}/${FRAME_FILES.AGENTS}`, path: path.join(projectPath, FRAME_DIR, FRAME_FILES.AGENTS) },
    { name: `${FRAME_DIR}/${FRAME_FILES.STRUCTURE}`, path: path.join(projectPath, FRAME_DIR, FRAME_FILES.STRUCTURE) },
    { name: `${FRAME_DIR}/${FRAME_FILES.NOTES}`, path: path.join(projectPath, FRAME_DIR, FRAME_FILES.NOTES) },
    { name: `${FRAME_DIR}/${FRAME_FILES.TASKS}`, path: path.join(projectPath, FRAME_DIR, FRAME_FILES.TASKS) },
    { name: `${FRAME_DIR}/${FRAME_FILES.QUICKSTART}`, path: path.join(projectPath, FRAME_DIR, FRAME_FILES.QUICKSTART) },
    { name: CLAUDE_RULE_PATH, path: path.join(projectPath, ...CLAUDE_RULE_PATH.split('/')) }
  ];

  for (const file of filesToCheck) {
    if (fs.existsSync(file.path)) {
      existingFiles.push(file.name);
    }
  }

  return existingFiles;
}

/**
 * Show confirmation dialog before initializing Frame project
 */
async function showInitializeConfirmation(projectPath) {
  const existingFiles = checkExistingFrameFiles(projectPath);

  let message = 'This will create the following files in your project:\n\n';
  message += '  • .frame/ (everything Frame writes lives here)\n';
  message += '  • .frame/AGENTS.md (AI instructions)\n';
  message += '  • .frame/STRUCTURE.json (module map)\n';
  message += '  • .frame/PROJECT_NOTES.md (session notes)\n';
  message += '  • .frame/tasks.json (task tracking)\n';
  message += '  • .frame/QUICKSTART.md (getting started)\n';
  message += "  • .frame/bin/ (Frame's parser and helper scripts)\n";
  message += '  • .claude/rules/frame.md (a synced copy of .frame/AGENTS.md for Claude Code)\n';
  message += '\nNothing is added to your project root, and no existing file is read, moved or replaced.\n';

  if (existingFiles.length > 0) {
    message += '\n⚠️ These files already exist and will NOT be overwritten:\n';
    message += existingFiles.map(f => `  • ${f}`).join('\n');
  }

  message += '\n\nDo you want to continue?';

  // Lazy require: CI runs the test suite with no node_modules, so the pure
  // helpers in this module must load without Electron present.
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox(mainWindow, {
    type: existingFiles.length > 0 ? 'warning' : 'question',
    buttons: ['Cancel', 'Initialize'],
    defaultId: 0,
    cancelId: 0,
    title: 'Initialize as Frame Project',
    message: 'Initialize as Frame Project?',
    detail: message
  });

  return result.response === 1; // 1 = "Initialize" button
}

/**
 * Initialize a project as Frame project.
 *
 * Async end-to-end; a per-project in-flight promise guard means a second
 * IPC call during a running init awaits the first instead of racing it.
 */
const inFlightInits = new Map();

function initializeFrameProject(projectPath, projectName, options = {}) {
  if (inFlightInits.has(projectPath)) return inFlightInits.get(projectPath);
  const run = doInitializeFrameProject(projectPath, projectName, options)
    .finally(() => inFlightInits.delete(projectPath));
  inFlightInits.set(projectPath, run);
  return run;
}

async function doInitializeFrameProject(projectPath, projectName, options = {}) {
  // Point the activity record at this project before init starts, so the
  // work init itself does lands in the right bucket rather than in `app`.
  activityLog.setProject(projectPath);
  perfMonitor.opStart('project-init');
  try {
    return await runProjectInit(projectPath, projectName, options);
  } finally {
    perfMonitor.opEnd('project-init');
  }
}

async function runProjectInit(projectPath, projectName, options = {}) {
  const name = projectName || path.basename(projectPath);
  // Re-init must not reset what the project already decided: identity and
  // sharing mode are carried over unless the caller explicitly picks one.
  const existingConfig = frameStore.readConfig(projectPath);
  const previousSharing = existingConfig && existingConfig.settings && existingConfig.settings.gitSharing;
  // Never name this `gitSharing`: the module of that name is required at the
  // top of this file and a local would shadow it for the whole function.
  const sharingMode = (options.gitSharing || previousSharing) === 'local' ? 'local' : 'repo';
  const frameDirPath = path.join(projectPath, FRAME_DIR);

  // Create .frame directory
  await fsp.mkdir(frameDirPath, { recursive: true });

  // Detect the project's stack first — every template below is parameterized
  // by it and the parser reads it back from config. Non-fatal: a failed
  // detection degrades to the generic templates, never blocks init.
  let detectedProject = null;
  try {
    detectedProject = detector.detectProject(projectPath);
  } catch (err) {
    console.warn('[frame] project detection failed (non-fatal):', err.message);
  }

  // Create .frame/config.json (carrying the detected project block)
  const config = templates.getFrameConfigTemplate(name);
  config.settings.gitSharing = sharingMode;
  if (existingConfig && existingConfig.projectId) {
    config.projectId = existingConfig.projectId;
  }
  if (detectedProject) {
    config.project = detectedProject;
  }
  await fsp.writeFile(
    path.join(frameDirPath, FRAME_CONFIG_FILE),
    JSON.stringify(config, null, 2),
    'utf8'
  );
  // Re-init of a project written before projectId existed: stamp it now, so
  // every Frame project has a stable identity from here on.
  frameStore.ensureProjectId(projectPath);

  // Everything Frame writes lives under .frame/ (plus the one pointer file
  // below). Nothing at the project root is read, consumed or replaced: an
  // existing CLAUDE.md / AGENTS.md / .cursorrules is the user's, and Frame
  // reaching an AI session no longer depends on owning a root file.

  // .frame/AGENTS.md — Spec-Driven Development is ON for new projects (config
  // template sets features.specDriven), so the section ships with the file.
  await createFileIfNotExists(
    frameStore.resolvePath(projectPath, FRAME_FILES.AGENTS),
    templates.getAgentsTemplate(name, { specDriven: true, project: detectedProject })
  );

  // .frame/docs/REFERENCE.md — the reference-on-demand companion to the lean
  // AGENTS.md core (meta-file maintenance rules, loaded only when needed)
  const docsDirPath = path.join(frameDirPath, 'docs');
  await fsp.mkdir(docsDirPath, { recursive: true });
  await createFileIfNotExists(
    path.join(docsDirPath, 'REFERENCE.md'),
    templates.getReferenceTemplate(name)
  );

  // .frame/specs/ — Spec-Driven Development is on for new projects, so the
  // folder exists from the start (tracked by .gitkeep) instead of appearing
  // the first time someone opts in.
  const specsDirPath = path.join(frameDirPath, 'specs');
  await fsp.mkdir(specsDirPath, { recursive: true });
  await createFileIfNotExists(path.join(specsDirPath, '.gitkeep'), '');

  const structureWasCreated = await createFileIfNotExists(
    frameStore.resolvePath(projectPath, FRAME_FILES.STRUCTURE),
    templates.getStructureTemplate(name, detectedProject)
  );

  await createFileIfNotExists(
    frameStore.resolvePath(projectPath, FRAME_FILES.NOTES),
    templates.getNotesTemplate(name)
  );

  await createFileIfNotExists(
    frameStore.resolvePath(projectPath, FRAME_FILES.TASKS),
    templates.getTasksTemplate(name)
  );

  await createFileIfNotExists(
    frameStore.resolvePath(projectPath, FRAME_FILES.QUICKSTART),
    templates.getQuickstartTemplate(name, detectedProject)
  );

  // .claude/rules/frame.md — what Claude Code loads at session start. The
  // whole native-delivery mechanism: a generated copy of .frame/AGENTS.md,
  // replacing the CLAUDE.md symlink Frame used to plant.
  syncClaudeRule(projectPath);

  // Create .frame/bin for Frame's parser and helper scripts
  const binDirPath = path.join(frameDirPath, FRAME_BIN_DIR);
  await fsp.mkdir(binDirPath, { recursive: true });

  // Create Codex CLI wrapper script
  ensureCodexWrapper(projectPath);

  // Bootstrap STRUCTURE.json auto-fill: ship parser scripts to .frame/bin/,
  // install pre-commit hook (with safe detection for husky/lefthook/custom),
  // and run a one-time full scan if STRUCTURE.json was just created.
  // All steps are non-fatal — a failure here must not block the init.
  let structureBootstrapSummary = null;
  try {
    structureBootstrapSummary = await structureBootstrap.bootstrapStructure(
      projectPath,
      structureWasCreated
    );
    console.log('[frame] structure bootstrap:', JSON.stringify(structureBootstrapSummary, null, 2));
  } catch (err) {
    console.warn('[frame] structure bootstrap failed (non-fatal):', err.message);
  }

  // Stage the spec command templates, report assets and launch helper so a
  // CLI session can self-serve the current flow from day one. Non-fatal.
  try {
    commandStaging.stageCommandFiles(projectPath);
  } catch (err) {
    console.warn('[frame] command staging failed (non-fatal):', err.message);
  }

  // Spec-knowledge hook: deterministic spec-history injection for Claude
  // Code sessions. Merge-safe by contract — never clobbers an existing
  // .claude/settings.json, non-fatal like the bootstrap above.
  let specHintSummary = null;
  try {
    specHintSummary = installSpecHintHook(projectPath, {
      file: sharingMode === 'local' ? 'settings.local.json' : 'settings.json'
    });
    if (specHintSummary.manual) {
      console.warn('[frame] spec-hint hook needs manual install:', specHintSummary.reason);
    }
  } catch (err) {
    console.warn('[frame] spec-hint hook install failed (non-fatal):', err.message);
  }

  // Apply the sharing mode's side effects: the managed .frame/.gitignore
  // block, and (mode `local`) the anchored exclude entries. Non-fatal — a
  // project without git still initializes fine.
  try {
    gitSharing.reconcile(projectPath);
  } catch (err) {
    console.warn('[frame] applying sharing mode failed (non-fatal):', err.message);
  }

  // Update workspace to mark as Frame project
  workspace.updateProjectFrameStatus(projectPath, true);

  return { ...config, _structureBootstrap: structureBootstrapSummary, _specHintHook: specHintSummary };
}

// ─── Claude Code pointer file ─────────────────────────────

/**
 * Write `.claude/rules/frame.md` — the only thing Frame puts outside
 * `.frame/`. Claude Code loads `.claude/rules/*.md` natively at session start,
 * which is how Frame reaches a session without a launch wrapper or a root
 * file.
 *
 * It holds a *copy* of `.frame/AGENTS.md`, not an `@` import of it: Claude
 * Code does not expand an import that resolves above the session's working
 * directory, so a session started in a sub-directory loaded this file and got
 * nothing from it (verified against the real CLI). `.frame/AGENTS.md` stays
 * canonical and this copy is rewritten whenever it changes — at init, on
 * project open, after migration, on every spec-driven toggle, and from the
 * meta-directory watcher while Frame runs.
 *
 * Writes only when the content differs: this runs on every project open, and
 * a needless rewrite is a file-watcher event in someone else's editor.
 */
/**
 * The Codex CLI wrapper. Written at init and, since it is the kind of file a
 * project upgraded from an older Frame simply never received, re-ensured on
 * every open. Only ever created when absent — a project that edited its own
 * wrapper keeps it.
 *
 * Deliberately not in `structureBootstrap.PARSER_FILES`: that module sits in
 * another spec's live footprint, and this file already owns the wrapper.
 */
function ensureCodexWrapper(projectPath) {
  const wrapperPath = path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, 'codex');
  if (fs.existsSync(wrapperPath)) return false;
  try {
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, templates.getCodexWrapperTemplate(), { mode: 0o755 });
    return true;
  } catch (err) {
    console.warn('[frame] could not write .frame/bin/codex (non-fatal):', err.message);
    return false;
  }
}

/**
 * Re-ensure on open what a fresh init creates.
 *
 * `ensureSpecDrivenArtifacts` has always known how to produce
 * `.frame/docs/REFERENCE.md` — `audit-q3-core-value-efficacy` T08 put it there
 * expressly "so pre-split projects get it" — but the only callers were
 * enable/disable, and a pre-split project already has the flag on, so the
 * branch never ran. The result was `upgradeSpecDocs` rewriting AGENTS.md into
 * a pointer at a file nothing ever created.
 *
 * Calling it on open finishes what T08 started. Every write inside is guarded
 * by an existence check, so a project that keeps its own reference document,
 * its own wrapper or its own `.gitkeep` is untouched; this only fills gaps.
 *
 * Must run before `upgradeSpecDocs` in the same pass: target, then pointer.
 */
function ensureProjectArtifacts(projectPath) {
  if (!projectPath || !isFrameProject(projectPath)) return false;
  ensureCodexWrapper(projectPath);
  const config = getFrameConfig(projectPath) || {};
  if (config.features && config.features.specDriven === true) {
    const referencePath = path.join(projectPath, FRAME_DIR, 'docs', 'REFERENCE.md');
    const had = fs.existsSync(referencePath);
    try {
      ensureSpecDrivenArtifacts(projectPath, config);
    } catch (err) {
      console.warn('[frame] could not re-ensure spec artifacts (non-fatal):', err.message);
      return false;
    }
    // Creating the document a pointer aims at is the repair for the most
    // common broken state in the field, and it happens with nobody watching.
    if (!had && fs.existsSync(referencePath)) {
      try {
        activityLog.record('docs.repaired', { docs: 1, created: 1 });
      } catch (_) { /* bookkeeping never breaks an open */ }
    }
  }
  return true;
}

function syncClaudeRule(projectPath) {
  const agentsText = frameStore.readAgents(projectPath);
  if (agentsText === null) return false; // nothing to copy — never write an empty rule

  const rulePath = path.join(projectPath, ...CLAUDE_RULE_PATH.split('/'));
  const next = templates.getClaudeRuleTemplate(agentsText);
  try {
    let existing = null;
    try { existing = fs.readFileSync(rulePath, 'utf8'); } catch (_) { /* first write */ }
    if (existing === next) return false;

    fs.mkdirSync(path.dirname(rulePath), { recursive: true });
    fs.writeFileSync(rulePath, next, 'utf8');
    return true;
  } catch (err) {
    console.warn('[frame] could not write .claude/rules/frame.md (non-fatal):', err.message);
    return false;
  }
}

// ─── Spec-knowledge hook install ──────────────────────────

/**
 * The indentation an existing settings file uses, so rewriting it preserves
 * the user's formatting instead of reflowing the whole file to Frame's two
 * spaces (a diff nobody asked for). Falls back to two spaces for a new file.
 */
function detectJsonIndent(text, fallback = 2) {
  const match = /\n([ \t]+)"/.exec(text || '');
  if (!match) return fallback;
  return match[1].includes('\t') ? '\t' : match[1];
}

/** Every hook command in a settings object, whatever shape the file is in. */
function hookCommandsIn(settings) {
  const commands = [];
  const hooks = settings && settings.hooks;
  if (!hooks || typeof hooks !== 'object') return commands;
  for (const list of Object.values(hooks)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      for (const hook of entry.hooks) {
        if (hook && typeof hook.command === 'string') commands.push(hook.command);
      }
    }
  }
  return commands;
}

/** The command strings Frame installs today. */
function frameHookCommands() {
  const commands = new Set();
  for (const entries of Object.values(templates.SPEC_HINT_HOOKS)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) commands.add(hook.command);
    }
  }
  return commands;
}

/**
 * Register the spec-hint hooks in the project's Claude settings file.
 * Gated on the active AI tool being Claude Code — other CLIs have no hook
 * system, they keep the AGENTS.md advisory layer.
 *
 * `file` selects the settings file: `settings.json` (sharing mode `repo`, the
 * default) or `settings.local.json` (mode `local`, so nothing Frame writes
 * shows up in git status).
 *
 * Merge-safe write: read-modify-write preserving every existing key; a hook
 * entry is appended only when an identical one isn't already present, so
 * re-init is idempotent. Unparseable JSON → no write, manual instructions
 * surfaced via the returned summary.
 */
function installSpecHintHook(projectPath, { file = 'settings.json' } = {}) {
  // Lazy require — aiToolManager pulls telemetry; keep init's module graph flat.
  const aiToolManager = require('./aiToolManager');
  const active = aiToolManager.getActiveTool();
  if (!active || active.id !== 'claude') {
    return { installed: false, reason: `active tool is ${active ? active.id : 'none'} — advisory layer only` };
  }

  const settingsDir = path.join(projectPath, '.claude');
  const settingsPath = path.join(settingsDir, file);

  let settings = {};
  let indent = 2;
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      return {
        installed: false,
        manual: true,
        reason: `.claude/${file} is not valid JSON (${err.message}); add the spec-hint hooks by hand — see .frame/docs/REFERENCE.md "Spec Knowledge Layer"`
      };
    }
    indent = detectJsonIndent(raw);
  }

  // A hook the user wired by hand is the layer this install would provide.
  // Adding Frame's entries beside it runs the hint twice and leaves two
  // commands to keep in step, so the file is left alone. Frame's own older
  // command forms are not that case — they are ours to replace, below.
  const ours = frameHookCommands();
  const mine = new Set([...ours, ...templates.LEGACY_SPEC_HINT_COMMANDS]);
  const existing = hookCommandsIn(settings)
    .find((command) => command.includes('spec-hint.js') && !mine.has(command));
  if (existing) {
    return { installed: false, existing: true, file, reason: `a hook already runs spec-hint.js (${existing})` };
  }

  settings.hooks = settings.hooks || {};

  // Upgrade Frame's older entries in place. Left alongside today's they would
  // run the hint twice, and the form Frame shipped before the guard was fixed
  // exits non-zero — reporting a hook failure on every prompt — in any project
  // whose `.frame/bin` is not there.
  const isLegacyEntry = (entry) =>
    entry && Array.isArray(entry.hooks) && entry.hooks.length > 0 &&
    entry.hooks.every((h) => h && templates.LEGACY_SPEC_HINT_COMMANDS.includes(h.command));
  let upgraded = 0;
  for (const eventName of Object.keys(settings.hooks)) {
    const list = settings.hooks[eventName];
    if (!Array.isArray(list)) continue;
    settings.hooks[eventName] = list.filter((entry) => {
      if (!isLegacyEntry(entry)) return true;
      upgraded++;
      return false;
    });
  }

  let added = 0;
  for (const eventName of Object.keys(templates.SPEC_HINT_HOOKS)) {
    const list = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
    for (const entry of templates.SPEC_HINT_HOOKS[eventName]) {
      const sig = JSON.stringify(entry);
      if (!list.some((x) => JSON.stringify(x) === sig)) {
        list.push(entry);
        added++;
      }
    }
    settings.hooks[eventName] = list;
  }

  if (added > 0 || upgraded > 0) {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, indent) + '\n');
  }
  return { installed: true, added, upgraded, file };
}

/**
 * Take Frame's hook entries back out of a Claude settings file. Exact-match on
 * the command string (today's guard, plus every form Frame shipped before) —
 * a hook the user wrote, even one that calls spec-hint.js differently, is not
 * ours to remove. Empty event arrays and an empty `hooks` object are cleaned
 * up so removal leaves no Frame-shaped residue; every other key survives.
 */
function removeSpecHintHook(projectPath, { file = 'settings.json' } = {}) {
  const settingsPath = path.join(projectPath, '.claude', file);
  if (!fs.existsSync(settingsPath)) return { removed: 0 };

  let settings;
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const indent = detectJsonIndent(raw);
  try {
    settings = JSON.parse(raw);
  } catch (err) {
    return { removed: 0, manual: true, reason: `.claude/${file} is not valid JSON` };
  }
  if (!settings.hooks || typeof settings.hooks !== 'object') return { removed: 0 };

  const frameCommands = new Set(templates.LEGACY_SPEC_HINT_COMMANDS);
  for (const entries of Object.values(templates.SPEC_HINT_HOOKS)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) frameCommands.add(hook.command);
    }
  }
  const isFrameEntry = (entry) =>
    entry && Array.isArray(entry.hooks) &&
    entry.hooks.length > 0 &&
    entry.hooks.every((h) => h && frameCommands.has(h.command));

  let removed = 0;
  for (const eventName of Object.keys(settings.hooks)) {
    const list = settings.hooks[eventName];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((entry) => {
      if (!isFrameEntry(entry)) return true;
      removed++;
      return false;
    });
    if (kept.length > 0) settings.hooks[eventName] = kept;
    else delete settings.hooks[eventName];
  }

  if (removed === 0) return { removed: 0 };
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  // Frame's entries were the whole file. Writing back a bare `{}` leaves a
  // shell that tells nobody anything and still shows in `git status` — in
  // sharing mode `local` nothing excludes `.claude/settings.json`, deliberately,
  // because in `repo` mode that file is the team's. Delete it instead, but only
  // while it is untracked: removing a file the user committed is their call,
  // the same line gitSharing draws around `git rm`.
  if (Object.keys(settings).length === 0 && !gitExclude.isPathTracked(projectPath, `.claude/${file}`)) {
    try {
      fs.unlinkSync(settingsPath);
      return { removed, file, deleted: true };
    } catch (err) {
      /* fall through to the write — a settings file we cannot remove is not
         worth failing a mode switch over */
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, indent) + '\n');
  return { removed, file };
}

// ─── Spec-Driven Development toggle ──────────────────────────
//
// Reads/writes the `features.specDriven` flag in .frame/config.json. New
// projects start enabled (config template); pre-existing projects that were
// initialized before that keep whatever they have and can flip it in
// Settings → Workflow.
//
// Enabling re-emits AGENTS.md with the spec section appended (so AI tools
// learn the workflow) and creates an empty .frame/specs/ folder tracked by
// .gitkeep. Disabling flips the flag back and removes the Frame-managed
// spec section from AGENTS.md; specs already on disk are never deleted.

function isSpecDrivenEnabled(projectPath) {
  const config = getFrameConfig(projectPath);
  return Boolean(config && config.features && config.features.specDriven);
}

function enableSpecDriven(projectPath) {
  if (!isFrameProject(projectPath)) {
    return { success: false, error: 'not a Frame project' };
  }

  const config = getFrameConfig(projectPath) || {};
  config.features = config.features || {};
  if (config.features.specDriven === true) {
    // Already enabled — make sure the artifacts exist anyway (handles the
    // case where someone deleted .frame/specs/ manually) and short-circuit.
    ensureSpecDrivenArtifacts(projectPath, config);
    syncClaudeRule(projectPath);
    return { success: true, alreadyEnabled: true };
  }

  config.features.specDriven = true;
  writeFrameConfig(projectPath, config);

  ensureSpecDrivenArtifacts(projectPath, config);
  syncClaudeRule(projectPath); // AGENTS.md gained the spec section
  return { success: true };
}

/**
 * Turn the workflow off: flip the flag and take the Frame-managed spec
 * section back out of AGENTS.md so AI sessions stop being told to write
 * specs. Never touches .frame/specs/ — the user's specs stay on disk (and
 * come back into view if they re-enable).
 */
function disableSpecDriven(projectPath) {
  if (!isFrameProject(projectPath)) {
    return { success: false, error: 'not a Frame project' };
  }

  const config = getFrameConfig(projectPath) || {};
  config.features = config.features || {};
  const wasEnabled = config.features.specDriven === true;
  config.features.specDriven = false;
  writeFrameConfig(projectPath, config);

  // AGENTS.md is user-owned: only remove the section when it is provably
  // Frame's (well-formed managed block). A hand-written or customized
  // section is left alone — same contract as the upgrade path.
  try {
    const existing = frameStore.readAgents(projectPath);
    const stripped = existing === null ? null : stripManagedSpecSection(existing);
    if (stripped !== null && stripped !== existing) {
      frameStore.writeAgents(projectPath, stripped);
    }
  } catch (err) {
    // Missing or unreadable AGENTS.md — the flag flip is what matters.
  }
  syncClaudeRule(projectPath); // AGENTS.md lost the spec section

  return { success: true, alreadyDisabled: !wasEnabled };
}

function setSpecDrivenEnabled(projectPath, enabled) {
  return enabled ? enableSpecDriven(projectPath) : disableSpecDriven(projectPath);
}

function writeFrameConfig(projectPath, config) {
  fs.writeFileSync(
    path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE),
    JSON.stringify(config, null, 2),
    'utf8'
  );
}

/**
 * Remove the marker-wrapped spec section from a doc, together with the `---`
 * separator that precedes it in every shape Frame emits (so removal doesn't
 * leave a double rule behind). Returns null when there is no well-formed
 * managed block — nothing may be removed then.
 */
function stripManagedSpecSection(text) {
  const block = docsManagedBlock.findBlock(text);
  if (!block) return null;
  const head = text.slice(0, block.start).replace(/\n*(-{3,}[ \t]*\n)?\s*$/, '');
  const tail = text.slice(block.end).replace(/^\s*/, '');
  if (!head) return tail;
  if (!tail) return head + '\n';
  return head + '\n\n' + tail;
}

function ensureSpecDrivenArtifacts(projectPath, config) {
  const name = (config && config.name) || path.basename(projectPath);

  // Stage the command templates/assets/helper — enabling spec-driven is the
  // moment a CLI session may start asking for spec commands. Non-fatal.
  try {
    commandStaging.stageCommandFiles(projectPath);
  } catch (err) {
    console.warn('[frame] command staging failed (non-fatal):', err.message);
  }

  // Make sure .frame/specs/ exists with a .gitkeep so it's version-tracked
  const specsDir = path.join(projectPath, FRAME_DIR, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const gitkeepPath = path.join(specsDir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '', 'utf8');
  }

  // Make sure .frame/docs/REFERENCE.md exists — the short spec section in
  // AGENTS.md points into it, and pre-split projects won't have it yet
  const docsDir = path.join(projectPath, FRAME_DIR, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const referencePath = path.join(docsDir, 'REFERENCE.md');
  if (!fs.existsSync(referencePath)) {
    fs.writeFileSync(referencePath, templates.getReferenceTemplate(name), 'utf8');
  }

  // Make sure AGENTS.md has the Spec-Driven Development section so AI
  // tools learn the workflow. We never rewrite the whole file — projects
  // routinely customize their AGENTS.md with their own conventions, and
  // blowing those away on enable would be hostile. Three branches:
  //   1. AGENTS.md doesn't exist → write the full template (specDriven on).
  //   2. AGENTS.md exists, no spec section → APPEND the section just before
  //      the trailing footer marker (or at the very end if no footer).
  //   3. AGENTS.md already has the section → no-op.
  const existing = frameStore.readAgents(projectPath) || '';
  if (!existing) {
    frameStore.writeAgents(
      projectPath,
      templates.getAgentsTemplate(name, { specDriven: true, project: (config && config.project) || null })
    );
  } else if (!existing.includes('Spec-Driven Development')) {
    // Append the short core section (marker-wrapped, stamped current) — the
    // full workflow lives in .frame/docs/REFERENCE.md, guaranteed above
    const sectionBlock = `\n\n---\n\n${templates.renderSpecCoreSection()}\n`;
    const footerMarker = '*This file was automatically created by Frame.';
    const footerIdx = existing.indexOf(footerMarker);
    let updated;
    if (footerIdx >= 0) {
      // Insert just before the footer (and any preceding "---" / blank lines)
      // so the footer remains the literal last block.
      const head = existing.slice(0, footerIdx).replace(/\n*-{3,}\n*$/, '');
      const tail = existing.slice(footerIdx);
      updated = head + sectionBlock + '\n---\n\n' + tail;
    } else {
      updated = existing.replace(/\n*$/, '') + sectionBlock;
    }
    frameStore.writeAgents(projectPath, updated);
  }
  // else: section already present, leave file alone
}

// ─── Spec docs upgrade on project open (cli-spec-command-parity) ─────
//
// REFERENCE.md and AGENTS.md carry a Frame-managed spec section; the
// managed-block engine upgrades it in place when Frame's shipped content is
// newer (version stamp) or migrates a byte-identical legacy section once.
// Everything outside the block is left alone.
//
// Two rules were missing, and between them they produced the delivery gap this
// pass now closes:
//
//   1. **A pointer is never written at nothing.** AGENTS.md's section is a
//      pointer into REFERENCE.md's. Writing it while REFERENCE.md carries no
//      protocol replaces a stale-but-working flow with no flow at all — which
//      is exactly what shipped after the 2026-07-23 matcher fix. REFERENCE.md
//      is therefore settled first, and AGENTS.md is upgraded only once the
//      target is confirmed to carry the block. Confirmed by reading it back,
//      not by predicting it.
//   2. **A document with no section at all is appended to, not skipped.**
//      "Leave it alone" is right for a section the user customized and wrong
//      for a document that never had one. docsHealth draws that line; this
//      pass only acts on it.
//
// A document whose section Frame cannot prove is its own is still never
// written — it comes back in the returned report instead, for the caller to
// surface.

// Both shipped documents end with this line; a block appended to one goes
// above it rather than after it.
const FRAME_DOC_FOOTER = '*This file was automatically created by Frame.';

// Heading stems that mean "this document already has a section about the spec
// workflow", whoever wrote it. Deliberately loose — see docsHealth.headingStem.
const SPEC_HEADING_STEMS = ['spec-driven development'];

/**
 * The spec-section descriptors, in the order they must be settled: the target
 * of a pointer before the pointer itself.
 */
function specDocDescriptors(projectPath) {
  return [
    {
      rel: `${FRAME_DIR}/docs/REFERENCE.md`,
      file: path.join(projectPath, FRAME_DIR, 'docs', 'REFERENCE.md'),
      body: templates.SPEC_DRIVEN_SECTION,
      block: {
        name: docsManagedBlock.SPEC_BLOCK_NAME,
        legacyMatchers: templates.REFERENCE_SPEC_LEGACY_MATCHERS,
        headingStems: SPEC_HEADING_STEMS
      }
    },
    {
      rel: `${FRAME_DIR}/${FRAME_FILES.AGENTS}`,
      file: frameStore.resolvePath(projectPath, FRAME_FILES.AGENTS),
      body: templates.SPEC_DRIVEN_CORE_SECTION,
      // The core section is a pointer into the reference; it may not be
      // written until that document actually carries the protocol.
      pointsAt: `${FRAME_DIR}/docs/REFERENCE.md`,
      block: {
        name: docsManagedBlock.SPEC_BLOCK_NAME,
        legacyMatchers: templates.AGENTS_SPEC_LEGACY_MATCHERS,
        headingStems: SPEC_HEADING_STEMS
      }
    }
  ];
}

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

/**
 * Upgrade the Frame-managed sections and report what could not be settled.
 * Returns the docsHealth report (or null when this is not a Frame project),
 * so the caller can record and surface a broken invariant rather than let it
 * pass silently — the failure mode this whole pass exists to end.
 */
function upgradeSpecDocs(projectPath) {
  if (!projectPath || !isFrameProject(projectPath)) return null;

  const descriptors = specDocDescriptors(projectPath);
  const exists = (rel) => fs.existsSync(path.join(projectPath, rel));
  const survey = () => docsHealth.report(
    descriptors.map((d) => ({
      path: d.rel,
      text: readTextOrNull(d.file),
      blocks: [d.block]
    })),
    exists
  );

  // Two surveys, and the distinction matters. The pass *decides* from the
  // state it found — append or skip is a question about what was there. It
  // *reports* the state it leaves behind, because the report is what the UI
  // raises to the user, and a popover complaining about a section this pass
  // just repaired would be worse than no popover at all.
  const before = survey();
  let written = 0;
  let appended = 0;
  const stateOf = (rel) => {
    const found = before.sections.find((s) => s.doc === rel);
    return found ? found.state : null;
  };

  for (const doc of descriptors) {
    const text = readTextOrNull(doc.file);
    if (text === null) continue; // absent file — creating it is not this pass's job

    // A section Frame cannot prove is its own: report it, never write over it.
    if (stateOf(doc.rel) === 'unmatched') continue;

    // Rule 1 — never aim a pointer at a document that will not carry the
    // protocol. Read the target back rather than assume this pass fixed it.
    if (doc.pointsAt) {
      const targetText = readTextOrNull(path.join(projectPath, doc.pointsAt));
      if (targetText === null || !docsManagedBlock.findBlock(targetText, doc.block.name)) {
        continue;
      }
    }

    const upgraded = docsManagedBlock.upgradeDoc(text, {
      body: doc.body,
      version: templates.SPEC_SECTION_VERSION,
      legacyMatchers: doc.block.legacyMatchers,
      blockName: doc.block.name,
      // Rule 2 — a document with no section at all gets one, additively.
      onAbsent: stateOf(doc.rel) === 'absent' ? 'append' : undefined,
      footerMarker: FRAME_DOC_FOOTER
    });
    if (upgraded !== null && upgraded !== text) {
      try {
        fs.writeFileSync(doc.file, upgraded, 'utf8');
        written += 1;
        if (stateOf(doc.rel) === 'absent') appended += 1;
      } catch (err) {
        console.warn(`[frame] spec docs upgrade failed for ${doc.file} (non-fatal):`, err.message);
      }
    }
  }

  syncClaudeRule(projectPath); // an upgraded AGENTS.md means a stale copy

  const after = survey();
  recordDocsActivity(written, appended, after);
  return after;
}

/**
 * Append the managed spec section to a document the pass deliberately refused
 * to touch, because the user asked for it.
 *
 * The refusal is the whole point of the `unmatched` state: a section Frame
 * cannot prove is its own may hold instructions of the user's that Frame's
 * would contradict, and two overlapping protocols is how an agent ends up
 * following the wrong one. That judgement is the user's to overturn, and this
 * is where they overturn it — never on Frame's initiative.
 *
 * Additive even here: `appendBlock` rewrites nothing, so their section stays
 * exactly where it was, with Frame's beneath it.
 */
function appendSpecSection(projectPath, rel) {
  if (!projectPath || !isFrameProject(projectPath)) {
    return { success: false, error: 'not a Frame project' };
  }
  const doc = specDocDescriptors(projectPath).find((d) => d.rel === rel);
  if (!doc) return { success: false, error: `not a Frame-managed doc: ${rel}` };

  const text = readTextOrNull(doc.file);
  if (text === null) return { success: false, error: `could not read ${rel}` };
  if (docsManagedBlock.findBlock(text, doc.block.name)) {
    return { success: true, alreadyPresent: true };
  }

  const appended = docsManagedBlock.appendBlock(text, {
    body: doc.body,
    version: templates.SPEC_SECTION_VERSION,
    blockName: doc.block.name,
    footerMarker: FRAME_DOC_FOOTER
  });
  if (appended === null || appended === text) {
    return { success: false, error: `nothing to append to ${rel}` };
  }

  try {
    fs.writeFileSync(doc.file, appended, 'utf8');
  } catch (err) {
    return { success: false, error: err.message };
  }
  syncClaudeRule(projectPath);
  try {
    activityLog.record('docs.repaired', { docs: 1, appended: 1 });
  } catch (_) { /* bookkeeping never breaks a repair */ }
  return { success: true, health: docsHealthFor(projectPath) };
}

/**
 * The report on its own, without running the repair pass — what the UI asks
 * for when it wants to know whether to say anything.
 */
function docsHealthFor(projectPath) {
  if (!projectPath || !isFrameProject(projectPath)) return null;
  const descriptors = specDocDescriptors(projectPath);
  return docsHealth.report(
    descriptors.map((d) => ({
      path: d.rel,
      text: readTextOrNull(d.file),
      blocks: [d.block]
    })),
    (rel) => fs.existsSync(path.join(projectPath, rel))
  );
}

/**
 * Put the pass's result on the record. This is the half that was missing when
 * the delivery gap shipped: the repair and the failure both happened silently,
 * so a month passed with nothing to look at.
 *
 * Degradations are one record per reason rather than one per finding — a
 * project that stays broken is reopened every day, and three lines an open is
 * a report, while thirty is noise nobody reads.
 */
function recordDocsActivity(written, appended, report) {
  const emit = (name, fields) => {
    try {
      activityLog.record(name, fields);
    } catch (_) { /* bookkeeping never breaks an open */ }
  };

  if (written > 0) emit('docs.repaired', { docs: written, appended });

  const groups = [
    ['missing-path', report.missingPaths.map((m) => m.path)],
    ['unmatched-section', report.unmatchedSections.map((s) => s.doc)],
    ['unreadable', report.unreadable.map((u) => u.doc)]
  ];
  for (const [reason, paths] of groups) {
    if (paths.length === 0) continue;
    // A single finding names itself; several are counted, because a path
    // field holding one of five would read as the whole story.
    emit('docs.degraded', paths.length === 1
      ? { reason, path: paths[0], count: 1 }
      : { reason, count: paths.length });
  }
}

// ─── Remove Frame from a project ──────────────────────────

/**
 * Delete everything Frame authored in this project and forget it:
 * `.frame/`, the pointer file, Frame's hook entries in both Claude settings
 * files, the managed block in the pre-commit hook, and the exclude block.
 *
 * User files are never touched — not the CLAUDE.md a migration restored, not
 * an AGENTS.md they wrote, not their own hooks. What Frame did not write, it
 * does not remove.
 */
function removeFrame(projectPath) {
  const removed = [];
  const errors = [];

  const drop = (label, fn) => {
    try {
      if (fn() !== false) removed.push(label);
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  };

  // The exclude block first: it names .frame/, so it has to go while the
  // directory (and the git repo's view of it) is still intact.
  drop('.git/info/exclude block', () => gitExclude.removeExcluded(projectPath).removed);

  drop(FRAME_DIR, () => {
    const dir = path.join(projectPath, FRAME_DIR);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  });

  drop(CLAUDE_RULE_PATH, () => {
    const rule = path.join(projectPath, ...CLAUDE_RULE_PATH.split('/'));
    if (!fs.existsSync(rule)) return false;
    fs.unlinkSync(rule);
    // Take the rules/ directory with it when Frame's file was the only thing
    // in it; a directory with someone else's rules stays.
    const rulesDir = path.dirname(rule);
    try {
      if (fs.readdirSync(rulesDir).length === 0) fs.rmdirSync(rulesDir);
    } catch (err) { /* leave it */ }
    return true;
  });

  for (const file of ['settings.json', 'settings.local.json']) {
    drop(`.claude/${file} hooks`, () => removeSpecHintHook(projectPath, { file }).removed > 0);
    // A settings file whose only content was Frame's hooks is a file Frame
    // created. `{}` left behind is still a Frame-authored byte.
    drop(`.claude/${file}`, () => dropEmptySettingsFile(projectPath, file));
  }

  drop('pre-commit hook block', () => removeHookSnippet(projectPath));

  workspace.removeProject(projectPath);
  return { removed, errors, projectPath };
}

/**
 * Delete a Claude settings file that now parses to `{}` — Frame wrote it to
 * hold its hook entries and nothing else ever went in. A file with any key
 * left, or one that does not parse, is not ours to remove.
 */
function dropEmptySettingsFile(projectPath, file) {
  const settingsPath = path.join(projectPath, '.claude', file);
  if (!fs.existsSync(settingsPath)) return false;
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return false;
  }
  if (!settings || typeof settings !== 'object' || Object.keys(settings).length > 0) return false;

  fs.unlinkSync(settingsPath);
  try {
    if (fs.readdirSync(path.join(projectPath, '.claude')).length === 0) {
      fs.rmdirSync(path.join(projectPath, '.claude'));
    }
  } catch (err) { /* someone else's .claude/ stays */ }
  return true;
}

/**
 * What Frame's own pre-commit file looks like once its managed block is gone:
 * the shebang and the two header comment lines it wrote at init. Matching this
 * exactly is what separates "a file Frame created" from "a file the user
 * happens to have written only comments in".
 */
function isFrameOwnedHookResidue(text) {
  if (/^\s*(#![^\n]*\n)?\s*(exit 0\s*)?$/.test(text)) return true;
  const bare = templates.getStructurePreCommitHookTemplate()
    .replace(templates.getStructureHookSnippet(), '');
  const normalize = (s) => s.replace(/\n{2,}/g, '\n').trim();
  return normalize(text) === normalize(bare);
}

/**
 * Strip Frame's marker-wrapped block from whichever pre-commit hook carries
 * it. Anything the user wrote around the block is left exactly as it was, and
 * a file that becomes nothing but a shebang is deleted — but only where Frame
 * is the one that could have written the file. Frame never creates
 * `.husky/pre-commit` (it only offers the snippet to paste), so a Frame block
 * there is in a file the user owns and usually tracks: strip it, keep it.
 */
function removeHookSnippet(projectPath) {
  const candidates = [
    { hookPath: path.join(projectPath, '.git', 'hooks', 'pre-commit'), frameCreates: true },
    { hookPath: path.join(projectPath, '.husky', 'pre-commit'), frameCreates: false }
  ];

  let changed = false;
  for (const { hookPath, frameCreates } of candidates) {
    let text;
    try {
      text = fs.readFileSync(hookPath, 'utf8');
    } catch (err) {
      continue;
    }
    const start = text.indexOf(templates.FRAME_HOOK_MARKER_START);
    if (start === -1) continue;

    const endIdx = text.indexOf(templates.FRAME_HOOK_MARKER_END, start);
    const end = endIdx === -1
      ? text.length
      : endIdx + templates.FRAME_HOOK_MARKER_END.length + 1; // include the newline
    const head = text.slice(0, start);
    const tail = text.slice(end);
    // Appending the snippet to someone's existing hook inserted a blank-line
    // separator; removal has to take that back too, or "no Frame bytes left"
    // is a byte off from what the user actually wrote.
    const next = tail === '' ? head.replace(/\n{2,}$/, '\n') : head + tail;

    // Frame wrote the whole file at init when there was no hook; if nothing
    // but what Frame itself put there is left, the file is ours to remove.
    if (frameCreates && isFrameOwnedHookResidue(next)) fs.unlinkSync(hookPath);
    else fs.writeFileSync(hookPath, next, 'utf8');
    changed = true;
  }
  return changed;
}

/**
 * Everything a project open does to the project, in the order that makes the
 * order safe.
 *
 * The rule the sequence enforces: nothing is written to a project whose
 * layout question is still open. A legacy project used to be read, staged and
 * doc-upgraded *before* anything asked whether it should move — which dirtied
 * `AGENTS.md`, which then made the migration refuse to run, which is the
 * deadlock this exists to end. So the migration goes first, and either it
 * completes (and the stagers run against the new layout) or it is blocked
 * (and nothing runs at all).
 *
 * Returns what `IS_FRAME_PROJECT_RESULT` carries: the layout after the open,
 * and a `migration` field holding the receipt, the blocked report, or null.
 */
async function openProjectLayout(projectPath, hooks = {}) {
  const isFrame = isFrameProject(projectPath);
  if (!isFrame) return { isFrame: false, layout: 'none', migration: null };

  let migration = null;

  if (frameStore.isLegacyLayout(projectPath)) {
    const migrationPlan = layoutMigration.plan(projectPath);

    if (migrationPlan && !migrationPlan.canRun) {
      // The one case that writes nothing: an unmerged path. No stager, no
      // syncClaudeRule, no doc upgrade — the project comes out of the open
      // byte-for-byte as it went in, and the reason names the merge.
      return {
        isFrame: true,
        layout: 'legacy',
        migration: { ran: false, blocked: 'unmerged', unmerged: migrationPlan.unmerged }
      };
    }

    if (migrationPlan) {
      try {
        migration = layoutMigration.run(projectPath, migrationPlan, hooks.onProgress || (() => {}));
      } catch (err) {
        // run() contains its own failures; anything reaching here happened
        // around them. An open never fails over it.
        console.error('[frame] layout migration failed on open:', err);
        migration = { ran: false, reason: 'error', error: err.message, moved: [], backedUp: [], review: [] };
      }
    }
  }

  // `.frame/bin` is committed, so a checkout can carry scripts older than
  // the running Frame — a clone, a linked worktree, a teammate's commit.
  // Both stagers are copy-if-changed, so an up-to-date project is read,
  // compared and left alone. Non-fatal, all of it.
  try {
    structureBootstrap.copyParserScripts(projectPath);
  } catch (err) {
    console.warn('[frame] could not refresh .frame/bin (non-fatal):', err.message);
  }
  try {
    commandStaging.stageCommandFiles(projectPath);
  } catch (err) {
    console.warn('[frame] could not refresh the staged commands (non-fatal):', err.message);
  }
  // Tracked state changes behind Frame's back (a teammate commits .frame/,
  // the user runs `git rm --cached`), so the sharing mode's side effects
  // are re-applied every time the project is opened.
  try {
    gitSharing.reconcile(projectPath);
  } catch (err) {
    console.warn('[frame] could not reconcile the sharing mode (non-fatal):', err.message);
  }
  // The artifacts an older Frame never wrote, then the managed sections at
  // the current generation. 2 before 3: the pointer's target must exist
  // before anything writes a pointer at it. WATCH_SPECS does this too — a
  // project that just migrated cannot wait for that message, or it ends the
  // open with fewer artifacts than an already-migrated one has.
  try {
    ensureProjectArtifacts(projectPath);
    upgradeSpecDocs(projectPath);
  } catch (err) {
    console.warn('[frame] could not refresh the project artifacts (non-fatal):', err.message);
  }
  // The copy Claude Code reads follows .frame/AGENTS.md, which anything
  // may have edited since this project was last open.
  syncClaudeRule(projectPath);

  if (migration && migration.ran) await rearmAfterMigration(projectPath, hooks);

  return {
    isFrame: true,
    layout: frameStore.isLegacyLayout(projectPath) ? 'legacy' : 'overlay',
    migration
  };
}

/**
 * Every meta file just changed address: the watchers are pointed at the
 * directory they left, and the renderer is showing the old tree. Never
 * fatal — a stale watcher is a worse open, not a broken project.
 */
async function rearmAfterMigration(projectPath, hooks = {}) {
  try {
    require('./tasksManager').restartWatching(projectPath);
  } catch (err) {
    console.warn('[frame] could not re-arm the tasks watcher after migration:', err.message);
  }
  try {
    require('./specManager').startWatching(projectPath);
  } catch (err) {
    console.warn('[frame] could not re-arm the spec watcher after migration:', err.message);
  }
  if (typeof hooks.onFileTree !== 'function') return;
  try {
    hooks.onFileTree(await require('./fileTree').getFileTree(projectPath));
  } catch (err) {
    console.warn('[frame] could not refresh the file tree after migration:', err.message);
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.CHECK_IS_FRAME_PROJECT, async (event, projectPath) => {
    const send = (channel, payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };
    const { isFrame, layout, migration } = await openProjectLayout(projectPath, {
      onProgress: (progress) => send(IPC.LAYOUT_MIGRATION_PROGRESS, progress),
      onFileTree: (files) => send(IPC.FILE_TREE_DATA, files)
    });
    workspace.updateProjectFrameStatus(projectPath, isFrame);
    send(IPC.IS_FRAME_PROJECT_RESULT, { projectPath, isFrame, layout, migration });
    send(IPC.WORKSPACE_UPDATED, workspace.getProjects());
  });

  ipcMain.on(IPC.INITIALIZE_FRAME_PROJECT, async (event, { projectPath, projectName, confirmed, gitSharing }) => {
    try {
      // If not already confirmed by renderer modal, show native dialog as fallback
      if (!confirmed) {
        const userConfirmed = await showInitializeConfirmation(projectPath);
        if (!userConfirmed) {
          event.sender.send(IPC.FRAME_PROJECT_INITIALIZED, {
            projectPath,
            success: false,
            cancelled: true
          });
          return;
        }
      }

      const config = await initializeFrameProject(projectPath, projectName, { gitSharing });
      // Lazy require, same reason as aiToolManager below: telemetry pulls
      // @aptabase/electron → electron, and CI runs the suite with no
      // node_modules. Keep this module's load graph Electron-free.
      require('./telemetry').track('project_initialized');
      event.sender.send(IPC.FRAME_PROJECT_INITIALIZED, {
        projectPath,
        config,
        success: true
      });

      // Also send updated workspace
      const projects = workspace.getProjects();
      event.sender.send(IPC.WORKSPACE_UPDATED, projects);
    } catch (err) {
      console.error('Error initializing Frame project:', err);
      event.sender.send(IPC.FRAME_PROJECT_INITIALIZED, {
        projectPath,
        success: false,
        error: err.message
      });
    }
  });

  ipcMain.on(IPC.GET_FRAME_CONFIG, (event, projectPath) => {
    const config = getFrameConfig(projectPath);
    event.sender.send(IPC.FRAME_CONFIG_DATA, { projectPath, config });
  });

  // Spec-Driven Development feature flag
  ipcMain.handle(IPC.IS_SPEC_DRIVEN_ENABLED, (event, projectPath) =>
    isSpecDrivenEnabled(projectPath)
  );
  ipcMain.handle(IPC.ENABLE_SPEC_DRIVEN, (event, projectPath) =>
    enableSpecDriven(projectPath)
  );
  ipcMain.handle(IPC.SET_SPEC_DRIVEN, (event, { projectPath, enabled }) =>
    setSpecDrivenEnabled(projectPath, enabled === true)
  );

  // ─── Doc health ────────────────────────────────────────────
  ipcMain.handle(IPC.GET_DOCS_HEALTH, (event, projectPath) =>
    docsHealthFor(projectPath)
  );
  ipcMain.handle(IPC.APPEND_DOCS_SECTION, (event, { projectPath, doc }) =>
    appendSpecSection(projectPath, doc)
  );

  // ─── Git sharing ───────────────────────────────────────────
  ipcMain.handle(IPC.GET_GIT_SHARING_STATE, (event, projectPath) => {
    if (!projectPath || !isFrameProject(projectPath)) return { error: 'not a Frame project' };
    return gitSharing.getState(projectPath);
  });

  ipcMain.handle(IPC.SET_GIT_SHARING, (event, { projectPath, mode }) => {
    if (!projectPath || !isFrameProject(projectPath)) return { error: 'not a Frame project' };
    return gitSharing.setMode(projectPath, mode);
  });

  ipcMain.handle(IPC.REMOVE_FRAME_FROM_PROJECT, (event, projectPath) => {
    if (!projectPath) return { removed: [], errors: ['no project'] };
    const result = removeFrame(projectPath);
    event.sender.send(IPC.WORKSPACE_UPDATED, workspace.getProjects());
    return result;
  });

  // ─── Migration decisions ───────────────────────────────────
  //
  // The move itself no longer has a handler: it happens inside the project
  // open. What is left here is the half that is genuinely the user's call.
  ipcMain.handle(IPC.GET_MIGRATION_DECISIONS, (event, projectPath) => {
    if (!projectPath || !isFrameProject(projectPath)) return [];
    return layoutMigration.pendingDecisions(projectPath);
  });

  ipcMain.handle(IPC.APPLY_MIGRATION_DECISIONS, (event, { projectPath, decisions }) => {
    if (!projectPath || !isFrameProject(projectPath)) {
      return { ran: false, reason: 'not a Frame project', applied: [], review: [] };
    }
    try {
      return layoutMigration.applyDecisions(projectPath, decisions);
    } catch (err) {
      console.error('[frame] could not apply the migration decisions:', err);
      return { ran: false, reason: 'error', error: err.message, applied: [], review: [] };
    }
  });
}

module.exports = {
  init,
  isFrameProject,
  openProjectLayout,
  getFrameConfig,
  initializeFrameProject,
  runProjectInit,
  syncClaudeRule,
  installSpecHintHook,
  removeSpecHintHook,
  removeFrame,
  isSpecDrivenEnabled,
  enableSpecDriven,
  disableSpecDriven,
  setSpecDrivenEnabled,
  upgradeSpecDocs,
  ensureProjectArtifacts,
  ensureCodexWrapper,
  appendSpecSection,
  docsHealthFor,
  setupIPC
};
