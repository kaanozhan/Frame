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
const workspace = require('./workspace');
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
 * Check which Frame files already exist in the project
 */
function checkExistingFrameFiles(projectPath) {
  const existingFiles = [];
  const filesToCheck = [
    { name: 'AGENTS.md', path: path.join(projectPath, FRAME_FILES.AGENTS) },
    { name: 'CLAUDE.md', path: path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK) },
    { name: 'STRUCTURE.json', path: path.join(projectPath, FRAME_FILES.STRUCTURE) },
    { name: 'PROJECT_NOTES.md', path: path.join(projectPath, FRAME_FILES.NOTES) },
    { name: 'tasks.json', path: path.join(projectPath, FRAME_FILES.TASKS) },
    { name: 'QUICKSTART.md', path: path.join(projectPath, FRAME_FILES.QUICKSTART) },
    { name: '.frame/', path: path.join(projectPath, FRAME_DIR) }
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

  // Check if CLAUDE.md exists as a real file (not symlink) — existing project scenario
  const claudeMdPath = path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK);
  const hasExistingClaudeMd = fs.existsSync(claudeMdPath) && !fs.lstatSync(claudeMdPath).isSymbolicLink();

  let message = 'This will create the following files in your project:\n\n';
  message += '  • .frame/ (config directory)\n';
  message += '  • .frame/bin/ (AI tool wrappers)\n';
  message += '  • AGENTS.md (AI instructions)\n';
  message += '  • CLAUDE.md (symlink to AGENTS.md)\n';
  message += '  • STRUCTURE.json (module map)\n';
  message += '  • PROJECT_NOTES.md (session notes)\n';
  message += '  • tasks.json (task tracking)\n';
  message += '  • QUICKSTART.md (getting started)\n';

  if (hasExistingClaudeMd) {
    message += '\n📎 An existing CLAUDE.md was found. Its content will be preserved and appended to AGENTS.md. CLAUDE.md will then become a symlink to AGENTS.md.\n';
  }

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
  const gitSharing = (options.gitSharing || previousSharing) === 'local' ? 'local' : 'repo';
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
  config.settings.gitSharing = gitSharing;
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

  // .claude/rules/frame.md — the pointer Claude Code loads at session start.
  // The whole native-delivery mechanism: two lines that @-import
  // .frame/AGENTS.md, replacing the CLAUDE.md symlink Frame used to plant.
  ensureClaudePointer(projectPath);

  // Create .frame/bin directory for AI tool wrappers
  const binDirPath = path.join(frameDirPath, FRAME_BIN_DIR);
  await fsp.mkdir(binDirPath, { recursive: true });

  // Create Codex CLI wrapper script
  const codexWrapperPath = path.join(binDirPath, 'codex');
  if (!fs.existsSync(codexWrapperPath)) {
    await fsp.writeFile(codexWrapperPath, templates.getCodexWrapperTemplate(), { mode: 0o755 });
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
  // Code sessions. Merge-safe by contract — never clobbers an existing
  // .claude/settings.json, non-fatal like the bootstrap above.
  let specHintSummary = null;
  try {
    specHintSummary = installSpecHintHook(projectPath, {
      file: gitSharing === 'local' ? 'settings.local.json' : 'settings.json'
    });
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

// ─── Claude Code pointer file ─────────────────────────────

/**
 * Write `.claude/rules/frame.md` — the only thing Frame puts outside
 * `.frame/`. Claude Code loads `.claude/rules/*.md` natively at session start
 * and follows the `@` import to `.frame/AGENTS.md`, which is how Frame reaches
 * a session without a launch wrapper or a root file. Rewritten every init so a
 * stale pointer heals; a user who deletes it has detached on purpose.
 */
function ensureClaudePointer(projectPath) {
  const rulePath = path.join(projectPath, ...CLAUDE_RULE_PATH.split('/'));
  try {
    fs.mkdirSync(path.dirname(rulePath), { recursive: true });
    fs.writeFileSync(rulePath, templates.getClaudeRuleTemplate(), 'utf8');
    return true;
  } catch (err) {
    console.warn('[frame] could not write .claude/rules/frame.md (non-fatal):', err.message);
    return false;
  }
}

// ─── Spec-knowledge hook install ──────────────────────────

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
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      return {
        installed: false,
        manual: true,
        reason: `.claude/${file} is not valid JSON (${err.message}); add the spec-hint hooks by hand — see .frame/docs/REFERENCE.md "Spec Knowledge Layer"`
      };
    }
  }

  settings.hooks = settings.hooks || {};
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

  if (added > 0) {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
  return { installed: true, added, file };
}

/**
 * Take Frame's hook entries back out of a Claude settings file. Exact-match on
 * the command string (the current guarded form and the older unguarded one) —
 * a hook the user wrote, even one that calls spec-hint.js differently, is not
 * ours to remove. Empty event arrays and an empty `hooks` object are cleaned
 * up so removal leaves no Frame-shaped residue; every other key survives.
 */
function removeSpecHintHook(projectPath, { file = 'settings.json' } = {}) {
  const settingsPath = path.join(projectPath, '.claude', file);
  if (!fs.existsSync(settingsPath)) return { removed: 0 };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
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
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
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
    return { success: true, alreadyEnabled: true };
  }

  config.features.specDriven = true;
  writeFrameConfig(projectPath, config);

  ensureSpecDrivenArtifacts(projectPath, config);
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
    },
    {
      file: frameStore.resolvePath(projectPath, FRAME_FILES.AGENTS),
      body: templates.SPEC_DRIVEN_CORE_SECTION,
      legacyMatchers: templates.AGENTS_SPEC_LEGACY_MATCHERS
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
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.CHECK_IS_FRAME_PROJECT, (event, projectPath) => {
    const isFrame = isFrameProject(projectPath);
    workspace.updateProjectFrameStatus(projectPath, isFrame);
    event.sender.send(IPC.IS_FRAME_PROJECT_RESULT, { projectPath, isFrame });
    event.sender.send(IPC.WORKSPACE_UPDATED, workspace.getProjects());
  });

  ipcMain.on(IPC.INITIALIZE_FRAME_PROJECT, async (event, { projectPath, projectName, confirmed }) => {
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

      const config = await initializeFrameProject(projectPath, projectName);
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
}

module.exports = {
  init,
  isFrameProject,
  getFrameConfig,
  initializeFrameProject,
  runProjectInit,
  ensureClaudePointer,
  installSpecHintHook,
  removeSpecHintHook,
  isSpecDrivenEnabled,
  enableSpecDriven,
  disableSpecDriven,
  setSpecDrivenEnabled,
  upgradeSpecDocs,
  setupIPC
};
