/**
 * Frame Project Module
 * Handles Frame project initialization and detection
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_CONFIG_FILE, FRAME_BIN_DIR } = require('../shared/frameConstants');
const templates = require('../shared/frameTemplates');
const workspace = require('./workspace');
const frameStore = require('./frameStore');
const gitExclude = require('./gitExclude');
const gitSharing = require('./gitSharing');
const instructionDiscovery = require('./instructionDiscovery');
const embeddedMigration = require('./embeddedMigration');
const structureBootstrap = require('./structureBootstrap');
const commandStaging = require('./commandStaging');
const docsManagedBlock = require('../shared/docsManagedBlock');
const perfMonitor = require('./perfMonitor');
const activityLog = require('./activityLog');
const detector = require('../../scripts/detect-project');

let mainWindow = null;

/**
 * Initialize frame project module
 */
function init(window) {
  mainWindow = window;
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
 * Which Frame artifacts already exist — all of them inside `.frame/`.
 *
 * Root files are deliberately not checked: Frame neither creates nor
 * overwrites anything there any more, so a root `AGENTS.md` is the repo's own
 * business and has no place in a "will not be overwritten" warning.
 */
function checkExistingFrameFiles(projectPath) {
  const existingFiles = [];
  const filesToCheck = [
    { name: '.frame/', path: path.join(projectPath, FRAME_DIR) },
    { name: '.frame/STRUCTURE.json', path: frameStore.structurePath(projectPath) },
    { name: '.frame/PROJECT_NOTES.md', path: frameStore.notesPath(projectPath) },
    { name: '.frame/tasks.json', path: frameStore.tasksPath(projectPath) },
    { name: '.frame/QUICKSTART.md', path: frameStore.quickstartPath(projectPath) }
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
  const discovered = instructionDiscovery.get(projectPath).nativeFiles;

  let message = 'Frame will create one directory in your project and touch nothing else:\n\n';
  message += '  • .frame/ — config, bin/, docs/, specs/\n';
  message += '  • .frame/STRUCTURE.json (module map)\n';
  message += '  • .frame/PROJECT_NOTES.md (session notes)\n';
  message += '  • .frame/tasks.json (task tracking)\n';
  message += '  • .frame/QUICKSTART.md (getting started)\n';
  message += '\nNo file outside .frame/ is created, modified or deleted. ';
  message += 'By default .frame/ is kept out of git via .git/info/exclude, so git status stays clean.\n';

  if (discovered.length > 0) {
    message += '\n📎 Your existing instruction files stay exactly as they are — Frame reads them to point your AI tool at them:\n';
    message += discovered.map(f => `  • ${path.relative(projectPath, f.path)}`).join('\n');
    message += '\n';
  }

  if (existingFiles.length > 0) {
    message += '\n⚠️ These already exist and will NOT be overwritten:\n';
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

function initializeFrameProject(projectPath, projectName, options) {
  if (inFlightInits.has(projectPath)) return inFlightInits.get(projectPath);
  const run = doInitializeFrameProject(projectPath, projectName, options)
    .finally(() => inFlightInits.delete(projectPath));
  inFlightInits.set(projectPath, run);
  return run;
}

async function doInitializeFrameProject(projectPath, projectName, options) {
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
  const frameDirPath = path.join(projectPath, FRAME_DIR);
  const gitSharingMode = options.gitSharing === 'repo' ? 'repo' : 'local';

  // Before the first artifact exists, not after: the exclude entry is what
  // keeps `git status` clean, and a .frame/ that appears untracked-and-visible
  // even for a moment is the fingerprint this whole model exists to avoid.
  // The mode is passed in explicitly (D5) — the config it will live in does
  // not exist yet, so in repo mode the block is simply never written.
  gitExclude.ensure(projectPath, gitSharingMode);

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

  // Create .frame/config.json (carrying the detected project block). Both
  // init answers are baked into this single write — never written then
  // rewritten (D5).
  const config = templates.getFrameConfigTemplate(name, {
    gitSharing: gitSharingMode,
    specDriven: options.specDriven !== false
  });
  if (detectedProject) {
    config.project = detectedProject;
  }
  await fsp.writeFile(
    path.join(frameDirPath, FRAME_CONFIG_FILE),
    JSON.stringify(config, null, 2),
    'utf8'
  );

  // .frame/.gitignore — the machine-local manifest. Written unconditionally
  // (D2): harmless in local mode (the whole directory is excluded anyway),
  // and in repo mode it is itself committed, so a teammate inherits the
  // protection before Frame has ever run on their machine.
  gitSharing.writeFrameGitignore(projectPath);

  // ── Every artifact below lands inside .frame/ ────────────────
  //
  // What used to happen here: a root AGENTS.md was written, an existing
  // CLAUDE.md was read, deleted and replaced with a symlink, GEMINI.md the
  // same, and STRUCTURE/NOTES/tasks/QUICKSTART were dropped at the root. None
  // of that is allowed now — a repository the user does not own must be
  // byte-identical after Frame has been through it.
  //
  // Existing instruction files are discovered read-only (instructionDiscovery)
  // and reached at launch time by pointer (contextPreamble). Nothing is merged
  // out of them and nothing replaces them.
  //
  // No `.frame/AGENTS.md` is seeded either: Frame's own conventions live in
  // the global layer, so a project layer should appear only when there is
  // genuinely project-specific Frame context to record.

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
    frameStore.structurePath(projectPath),
    templates.getStructureTemplate(name, detectedProject)
  );

  await createFileIfNotExists(
    frameStore.notesPath(projectPath),
    templates.getNotesTemplate(name)
  );

  await createFileIfNotExists(
    frameStore.tasksPath(projectPath),
    templates.getTasksTemplate(name)
  );

  await createFileIfNotExists(
    frameStore.quickstartPath(projectPath),
    templates.getQuickstartTemplate(name, detectedProject)
  );

  // Create .frame/bin directory for AI tool wrappers
  const binDirPath = path.join(frameDirPath, FRAME_BIN_DIR);
  await fsp.mkdir(binDirPath, { recursive: true });

  // Wrapper scripts for every configured tool, from the one generator that
  // knows each tool's injection record. Written through aiToolManager rather
  // than here so a fresh init and a re-open produce byte-identical wrappers —
  // a second generator is how the shapes drift apart in the first place.
  try {
    require('./aiToolManager').refreshLaunchAssets(projectPath);
  } catch (err) {
    console.warn('[frame] launch asset generation failed (non-fatal):', err.message);
  }

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
  // Code sessions. Delivered by launch flag now — the project's own
  // .claude/settings.json is never read or written. Non-fatal like the
  // bootstrap above.
  let specHintSummary = null;
  try {
    specHintSummary = installSpecHintHook(projectPath);
    if (specHintSummary.manual) {
      console.warn('[frame] spec-hint hook needs manual install:', specHintSummary.reason);
    }
  } catch (err) {
    console.warn('[frame] spec-hint hook install failed (non-fatal):', err.message);
  }

  // Update workspace to mark as Frame project
  workspace.updateProjectFrameStatus(projectPath, true);

  return { ...config, _structureBootstrap: structureBootstrapSummary, _specHintHook: specHintSummary };
}

// ─── Spec-knowledge hook ──────────────────────────────────

/**
 * Make the spec-hint hooks available to Claude Code.
 *
 * These used to be merged into the project's tracked `.claude/settings.json`.
 * The overlay forbids that — it is a file the repo owns — so the hooks are now
 * written into `.frame/runtime/claude-settings.json` and passed at launch with
 * `--settings` (see aiToolManager.getLaunchCommand). Nothing is installed into
 * the project; this reports what the launcher will do, so init's summary stays
 * honest.
 *
 * Still gated on the active tool being Claude Code: other CLIs have no hook
 * system and keep the advisory layer that reaches them through the preamble.
 */
function installSpecHintHook(projectPath) {
  // Lazy require — aiToolManager pulls telemetry; keep init's module graph flat.
  const aiToolManager = require('./aiToolManager');
  const active = aiToolManager.getActiveTool();
  if (!active || active.id !== 'claude') {
    return { installed: false, reason: `active tool is ${active ? active.id : 'none'} — advisory layer only` };
  }
  return {
    installed: true,
    viaLaunchFlag: true,
    reason: 'delivered at launch via --settings from .frame/runtime/claude-settings.json'
  };
}

// ─── Spec-Driven Development toggle ──────────────────────────
//
// Reads/writes the `features.specDriven` flag in .frame/config.json, and
// that is now the whole of it.
//
// The toggle used to also perform surgery on the project's AGENTS.md —
// appending the managed spec section on enable, stripping it on disable —
// because that file was where an AI session learned the workflow. Frame's
// instructions live in one user-scoped copy now, shared by every project, so
// there is no per-project file to edit and no way to express "on here, off
// there" in it. The activation signal moved to the launch preamble, which
// reads this flag at every launch: on → an activation paragraph, off →
// nothing about specs at all.
//
// Enabling still makes sure the artifacts exist (.frame/specs/, the staged
// command templates, REFERENCE.md). Disabling never deletes specs on disk.

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
    return { success: true, alreadyEnabled: true };
  }

  config.features.specDriven = true;
  writeFrameConfig(projectPath, config);

  ensureSpecDrivenArtifacts(projectPath, config);
  return { success: true };
}

/**
 * Turn the workflow off: flip the flag. The next launch composes a preamble
 * with no mention of specs, which is what stops AI sessions being told to
 * write them. Never touches .frame/specs/ — the user's specs stay on disk
 * and come back into view if they re-enable.
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

  // Make sure .frame/docs/REFERENCE.md exists — pre-split projects won't
  // have it yet, and the staged spec commands point into it.
  const docsDir = path.join(projectPath, FRAME_DIR, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const referencePath = path.join(docsDir, 'REFERENCE.md');
  if (!fs.existsSync(referencePath)) {
    fs.writeFileSync(referencePath, templates.getReferenceTemplate(name), 'utf8');
  }

  // No AGENTS.md branch: enabling the workflow is a flag write and nothing
  // more. The agent learns it is on from the launch preamble, which reads
  // the flag fresh every time.
}

// ─── Spec docs upgrade on project open (cli-spec-command-parity) ─────
//
// .frame/docs/REFERENCE.md carries a Frame-managed spec section; the
// managed-block engine upgrades it in place when Frame's shipped content is
// newer (version stamp) or migrates a byte-identical legacy section once.
// The project's own AGENTS.md is no longer in this list — Frame does not
// write the project root, and the shared copy is globalLayer's to upgrade.
// Everything outside the block — and any file the user deleted or heavily
// rewrote — is left alone. Files are never created here, only rewritten on
// change.

function upgradeSpecDocs(projectPath) {
  if (!projectPath || !isFrameProject(projectPath)) return;

  const docs = [
    {
      file: path.join(projectPath, FRAME_DIR, 'docs', 'REFERENCE.md'),
      body: templates.SPEC_DRIVEN_SECTION,
      legacyMatchers: templates.REFERENCE_SPEC_LEGACY_MATCHERS
    }
  ];

  for (const doc of docs) {
    let text;
    try {
      text = fs.readFileSync(doc.file, 'utf8');
    } catch (_) {
      continue; // missing file — never create it
    }
    const upgraded = docsManagedBlock.upgradeDoc(text, {
      body: doc.body,
      version: templates.SPEC_SECTION_VERSION,
      legacyMatchers: doc.legacyMatchers
    });
    if (upgraded !== null && upgraded !== text) {
      try {
        fs.writeFileSync(doc.file, upgraded, 'utf8');
      } catch (err) {
        console.warn(`[frame] spec docs upgrade failed for ${doc.file} (non-fatal):`, err.message);
      }
    }
  }
}

/**
 * Migrate a project the user is waiting on, reporting to the modal.
 *
 * The distinction from the startup sweep needs no stored state: if the sweep
 * had succeeded, this project would no longer be legacy — so reaching here
 * means it was added after the sweep, or it failed or deferred during one.
 * Either way the user just selected it and is waiting, which is exactly when
 * blocking UI is earned (D13).
 *
 * Everything the modal renders travels on MIGRATION_PROGRESS: `start`, one
 * `artifact` per file, then `done` carrying the end state.
 */
function runForegroundMigration(sender, projectPath) {
  // The sweep may already be working on this project; a second migration must
  // not start, and a modal must not flash for one that is already handled.
  if (embeddedMigration.isMigrating(projectPath)) return;

  const detected = embeddedMigration.plan(projectPath);
  if (!detected.legacy) return;

  const send = (payload) => {
    if (sender && !sender.isDestroyed()) sender.send(IPC.MIGRATION_PROGRESS, { projectPath, ...payload });
  };

  send({
    phase: 'start',
    name: path.basename(projectPath),
    total: detected.artifacts.length,
    backupDir: detected.backupDir
  });

  let done = 0;
  const result = embeddedMigration.migrateProject(projectPath, {
    onProgress: (artifact) => {
      done += 1;
      send({ phase: 'artifact', rel: artifact.rel, disposition: artifact.disposition, done, total: detected.artifacts.length });
    }
  });

  send({
    phase: 'done',
    status: result.status,
    dirty: result.dirty || [],
    restored: (result.restored || []).length,
    error: result.error,
    backupDir: result.backupDir || detected.backupDir
  });
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  // The failure screen's retry: re-runs against the current disk state, which
  // is the only thing that can have changed. (Removing and re-adding the
  // project would not — it only drops a registry entry.)
  ipcMain.on(IPC.RETRY_MIGRATION, (event, { projectPath }) => {
    runForegroundMigration(event.sender, projectPath);
  });

  ipcMain.on(IPC.CHECK_IS_FRAME_PROJECT, (event, projectPath) => {
    const isFrame = isFrameProject(projectPath);
    // Re-evaluated on every open, which is what makes opting in work: a team
    // that has committed .frame/ gets our exclude line removed here, on every
    // clone, without anyone running a command. ensureOnOpen also derives and
    // persists the mode for pre-upgrade projects (D4) and maintains
    // .frame/.gitignore, which is how existing projects gain it.
    if (isFrame) gitSharing.ensureOnOpen(projectPath);

    // Full re-scan per open; the watcher underneath is only an optimization.
    const discovery = instructionDiscovery.refresh(projectPath);
    instructionDiscovery.startWatching(projectPath);

    // Wrappers and preambles are regenerated here, not only when Frame
    // launches a given tool. That is what keeps a stale one out of reach:
    // generation used to be launch-only, so a project never opened with a
    // given CLI kept whatever wrapper an older Frame wrote — harmless while
    // nothing could resolve it, and a script shadowing the real CLI the
    // moment `.frame/bin` joined the terminal's PATH. Writes only when the
    // content differs, so a second open touches nothing. Non-fatal.
    if (isFrame) {
      try {
        // Lazy require — aiToolManager pulls telemetry; keep the graph flat.
        require('./aiToolManager').refreshLaunchAssets(projectPath);
      } catch (err) {
        console.warn('[frame] launch asset refresh failed (non-fatal):', err.message);
      }
    }

    // A pre-overlay project still has its Frame files at the root, where
    // nothing reads them any more. Frame migrates it rather than warning about
    // it — a condition the tool resolves by itself does not get a banner.
    //
    // Not gated on `isFrame`: a pre-overlay init wrote .frame/config.json
    // *and* the root files, so every project this covers looks like a Frame
    // project. The root layout is the signal, not the absence of .frame/.
    if (discovery.legacyLayout) runForegroundMigration(event.sender, projectPath);

    workspace.updateProjectFrameStatus(projectPath, isFrame);
    event.sender.send(IPC.IS_FRAME_PROJECT_RESULT, { projectPath, isFrame });
    event.sender.send(IPC.WORKSPACE_UPDATED, workspace.getProjects());
  });

  ipcMain.on(IPC.INITIALIZE_FRAME_PROJECT, async (event, { projectPath, projectName, confirmed, options }) => {
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

      const config = await initializeFrameProject(projectPath, projectName, options);
      // Lazy require, same reason as aiToolManager below: telemetry pulls
      // @aptabase/electron → electron, and CI runs the suite with no
      // node_modules. Keep this module's load graph Electron-free.
      require('./telemetry').track('project_initialized');
      require('./telemetry').track('project_sharing_set', {
        mode: options && options.gitSharing === 'repo' ? 'repo' : 'local',
        source: 'init'
      });
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

  // Git Sharing (per project). GET_GIT_SHARING_STATE serves the Project
  // Settings modal *and* the init modal's "hide the choice outside a git
  // repo" — it must work before .frame/ exists. SET_GIT_SHARING is the single
  // write path for every later mode change (modal toggle and sharing hint).
  ipcMain.handle(IPC.GET_GIT_SHARING_STATE, (event, projectPath) =>
    gitSharing.getState(projectPath)
  );
  ipcMain.handle(IPC.SET_GIT_SHARING, (event, { projectPath, mode }) => {
    const result = gitSharing.setMode(projectPath, mode);
    if (result.success) {
      require('./telemetry').track('project_sharing_set', { mode, source: 'settings' });
    }
    return result;
  });
}

module.exports = {
  init,
  isFrameProject,
  getFrameConfig,
  initializeFrameProject,
  isSpecDrivenEnabled,
  enableSpecDriven,
  disableSpecDriven,
  setSpecDrivenEnabled,
  upgradeSpecDocs,
  setupIPC
};
