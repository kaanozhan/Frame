/**
 * Frame Project Module
 * Handles Frame project initialization and detection
 */

const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_CONFIG_FILE, FRAME_FILES, FRAME_BIN_DIR } = require('../shared/frameConstants');
const templates = require('../shared/frameTemplates');
const workspace = require('./workspace');

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
function createFileIfNotExists(filePath, content) {
  if (!fs.existsSync(filePath)) {
    const contentStr = typeof content === 'string'
      ? content
      : JSON.stringify(content, null, 2);
    fs.writeFileSync(filePath, contentStr, 'utf8');
    return true;
  }
  return false;
}

/**
 * Create a symlink safely with Windows fallback
 * @param {string} target - The target file name (relative)
 * @param {string} linkPath - The full path for the symlink
 * @returns {boolean} - Whether the operation succeeded
 */
function createSymlinkSafe(target, linkPath) {
  try {
    // Check if symlink/file already exists
    if (fs.existsSync(linkPath)) {
      const stats = fs.lstatSync(linkPath);
      if (stats.isSymbolicLink()) {
        // Remove existing symlink to recreate it
        fs.unlinkSync(linkPath);
      } else {
        // Regular file exists - don't overwrite, skip
        console.warn(`${linkPath} exists and is not a symlink, skipping`);
        return false;
      }
    }

    // Create relative symlink
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (error) {
    // Windows without admin/Developer Mode - copy file as fallback
    if (error.code === 'EPERM' || error.code === 'EPROTO') {
      try {
        const targetPath = path.resolve(path.dirname(linkPath), target);
        if (fs.existsSync(targetPath)) {
          fs.copyFileSync(targetPath, linkPath);
          console.warn(`Symlink not supported, copied ${target} to ${linkPath}`);
          return true;
        }
      } catch (copyError) {
        console.error('Failed to create symlink or copy file:', copyError);
      }
    } else {
      console.error('Failed to create symlink:', error);
    }
    return false;
  }
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
 * Initialize a project as Frame project
 */
function initializeFrameProject(projectPath, projectName) {
  const name = projectName || path.basename(projectPath);
  const frameDirPath = path.join(projectPath, FRAME_DIR);

  // Create .frame directory
  if (!fs.existsSync(frameDirPath)) {
    fs.mkdirSync(frameDirPath, { recursive: true });
  }

  // Create .frame/config.json
  const config = templates.getFrameConfigTemplate(name);
  fs.writeFileSync(
    path.join(frameDirPath, FRAME_CONFIG_FILE),
    JSON.stringify(config, null, 2),
    'utf8'
  );

  // Create root-level Frame files (only if they don't exist)

  // Detect if this was already a Frame project before this init
  // .frame/config.json presence is the canonical indicator
  const wasAlreadyFrameProject = isFrameProject(projectPath);

  // Collect existing MD content to merge into AGENTS.md
  // Only for files that Frame will convert to symlinks (CLAUDE.md, GEMINI.md)
  // or for AGENTS.md if the project was never a Frame project
  let existingInstructions = [];

  // Check CLAUDE.md — real file means existing project directives
  const claudeMdPath = path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK);
  if (fs.existsSync(claudeMdPath)) {
    const stats = fs.lstatSync(claudeMdPath);
    if (!stats.isSymbolicLink()) {
      existingInstructions.push({ label: 'CLAUDE.md', content: fs.readFileSync(claudeMdPath, 'utf8') });
      fs.unlinkSync(claudeMdPath);
    }
  }

  // Check .claude/CLAUDE.md and .claude/claude.md — Claude Code's subfolder convention
  const claudeDirCandidates = [
    path.join(projectPath, '.claude', 'CLAUDE.md'),
    path.join(projectPath, '.claude', 'claude.md')
  ];
  for (const candidate of claudeDirCandidates) {
    if (fs.existsSync(candidate)) {
      existingInstructions.push({ label: '.claude/CLAUDE.md', content: fs.readFileSync(candidate, 'utf8') });
      break; // Only read one
    }
  }

  // Check AGENTS.md — if project was not previously a Frame project, merge its content
  const agentsMdPath = path.join(projectPath, FRAME_FILES.AGENTS);
  let existingAgentsContent = null;
  if (!wasAlreadyFrameProject && fs.existsSync(agentsMdPath)) {
    existingAgentsContent = fs.readFileSync(agentsMdPath, 'utf8');
    existingInstructions.push({ label: 'AGENTS.md', content: existingAgentsContent });
    fs.unlinkSync(agentsMdPath);
  }

  // Build AGENTS.md content: Frame template + any existing instructions appended.
  // Spec-Driven Development section is OFF by default — user opts in via the
  // suggestion modal, which calls enableSpecDriven() to re-emit AGENTS.md
  // with the section.
  let agentsContent = templates.getAgentsTemplate(name, { specDriven: false });
  if (existingInstructions.length > 0) {
    const merged = existingInstructions
      .map(({ label, content }) => `## Existing Instructions (from ${label})\n\n${content}`)
      .join('\n\n---\n\n');
    agentsContent += '\n\n---\n\n' + merged;
  }

  createFileIfNotExists(
    path.join(projectPath, FRAME_FILES.AGENTS),
    agentsContent
  );

  // CLAUDE.md - Symlink to AGENTS.md for Claude Code compatibility
  createSymlinkSafe(
    FRAME_FILES.AGENTS,
    path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK)
  );

  // GEMINI.md - Symlink to AGENTS.md for Gemini CLI compatibility
  // If it exists as a real file, append its content to AGENTS.md then remove it so the symlink can be created
  const geminiMdPath = path.join(projectPath, FRAME_FILES.GEMINI_SYMLINK);
  if (fs.existsSync(geminiMdPath)) {
    const geminiStats = fs.lstatSync(geminiMdPath);
    if (!geminiStats.isSymbolicLink()) {
      const geminiContent = fs.readFileSync(geminiMdPath, 'utf8');
      const agentsPath = path.join(projectPath, FRAME_FILES.AGENTS);
      const current = fs.readFileSync(agentsPath, 'utf8');
      fs.writeFileSync(agentsPath, current + '\n\n---\n\n## Existing Instructions (from GEMINI.md)\n\n' + geminiContent, 'utf8');
      fs.unlinkSync(geminiMdPath);
    }
  }
  createSymlinkSafe(
    FRAME_FILES.AGENTS,
    path.join(projectPath, FRAME_FILES.GEMINI_SYMLINK)
  );

  createFileIfNotExists(
    path.join(projectPath, FRAME_FILES.STRUCTURE),
    templates.getStructureTemplate(name)
  );

  createFileIfNotExists(
    path.join(projectPath, FRAME_FILES.NOTES),
    templates.getNotesTemplate(name)
  );

  createFileIfNotExists(
    path.join(projectPath, FRAME_FILES.TASKS),
    templates.getTasksTemplate(name)
  );

  createFileIfNotExists(
    path.join(projectPath, FRAME_FILES.QUICKSTART),
    templates.getQuickstartTemplate(name)
  );

  // Create .frame/bin directory for AI tool wrappers
  const binDirPath = path.join(frameDirPath, FRAME_BIN_DIR);
  if (!fs.existsSync(binDirPath)) {
    fs.mkdirSync(binDirPath, { recursive: true });
  }

  // Create Codex CLI wrapper script
  const codexWrapperPath = path.join(binDirPath, 'codex');
  if (!fs.existsSync(codexWrapperPath)) {
    fs.writeFileSync(codexWrapperPath, templates.getCodexWrapperTemplate(), { mode: 0o755 });
  }

  // Update workspace to mark as Frame project
  workspace.updateProjectFrameStatus(projectPath, true);

  return config;
}

// ─── Spec-Driven Development opt-in (Slice 1.5) ──────────────
//
// Reads/writes the `features.specDriven` flag in .frame/config.json.
// Enabling also re-emits AGENTS.md with the spec section appended (so AI
// tools learn the workflow) and creates an empty .frame/specs/ folder
// tracked by .gitkeep. Designed to be reversible by the user via direct
// edits — slice 1 doesn't ship a "disable" path.

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
  fs.writeFileSync(
    path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE),
    JSON.stringify(config, null, 2),
    'utf8'
  );

  ensureSpecDrivenArtifacts(projectPath, config);
  return { success: true };
}

function ensureSpecDrivenArtifacts(projectPath, config) {
  const name = (config && config.name) || path.basename(projectPath);

  // Make sure .frame/specs/ exists with a .gitkeep so it's version-tracked
  const specsDir = path.join(projectPath, FRAME_DIR, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const gitkeepPath = path.join(specsDir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '', 'utf8');
  }

  // Make sure AGENTS.md has the Spec-Driven Development section so AI
  // tools learn the workflow. We never rewrite the whole file — projects
  // routinely customize their AGENTS.md with their own conventions, and
  // blowing those away on enable would be hostile. Three branches:
  //   1. AGENTS.md doesn't exist → write the full template (specDriven on).
  //   2. AGENTS.md exists, no spec section → APPEND the section just before
  //      the trailing footer marker (or at the very end if no footer).
  //   3. AGENTS.md already has the section → no-op.
  const agentsPath = path.join(projectPath, FRAME_FILES.AGENTS);
  let existing = '';
  try {
    existing = fs.readFileSync(agentsPath, 'utf8');
  } catch (err) {
    existing = '';
  }
  if (!existing) {
    fs.writeFileSync(agentsPath, templates.getAgentsTemplate(name, { specDriven: true }), 'utf8');
  } else if (!existing.includes('Spec-Driven Development')) {
    const sectionBlock = `\n\n---\n\n${templates.SPEC_DRIVEN_SECTION}\n`;
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
    fs.writeFileSync(agentsPath, updated, 'utf8');
  }
  // else: section already present, leave file alone
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

      const config = initializeFrameProject(projectPath, projectName);
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

  // Spec-Driven Development opt-in
  ipcMain.handle(IPC.IS_SPEC_DRIVEN_ENABLED, (event, projectPath) =>
    isSpecDrivenEnabled(projectPath)
  );
  ipcMain.handle(IPC.ENABLE_SPEC_DRIVEN, (event, projectPath) =>
    enableSpecDriven(projectPath)
  );
}

module.exports = {
  init,
  isFrameProject,
  getFrameConfig,
  initializeFrameProject,
  isSpecDrivenEnabled,
  enableSpecDriven,
  setupIPC
};
