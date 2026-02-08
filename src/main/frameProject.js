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

  let message = 'This will create the following files in your project:\n\n';
  message += '  • .frame/ (config directory)\n';
  message += '  • .frame/bin/ (AI tool wrappers)\n';
  message += '  • AGENTS.md (AI instructions)\n';
  message += '  • CLAUDE.md (symlink to AGENTS.md)\n';
  message += '  • STRUCTURE.json (module map)\n';
  message += '  • PROJECT_NOTES.md (session notes)\n';
  message += '  • tasks.json (task tracking)\n';
  message += '  • QUICKSTART.md (getting started)\n';

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

  // AGENTS.md - Main instructions file for AI assistants
  createFileIfNotExists(
    path.join(projectPath, FRAME_FILES.AGENTS),
    templates.getAgentsTemplate(name)
  );

  // CLAUDE.md - Symlink to AGENTS.md for Claude Code compatibility
  createSymlinkSafe(
    FRAME_FILES.AGENTS,
    path.join(projectPath, FRAME_FILES.CLAUDE_SYMLINK)
  );

  // GEMINI.md - Symlink to AGENTS.md for Gemini CLI compatibility
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

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.CHECK_IS_FRAME_PROJECT, (event, projectPath) => {
    const isFrame = isFrameProject(projectPath);
    event.sender.send(IPC.IS_FRAME_PROJECT_RESULT, { projectPath, isFrame });
  });

  ipcMain.on(IPC.INITIALIZE_FRAME_PROJECT, async (event, { projectPath, projectName }) => {
    try {
      // Show confirmation dialog first
      const confirmed = await showInitializeConfirmation(projectPath);

      if (!confirmed) {
        // User cancelled
        event.sender.send(IPC.FRAME_PROJECT_INITIALIZED, {
          projectPath,
          success: false,
          cancelled: true
        });
        return;
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
}

module.exports = {
  init,
  isFrameProject,
  getFrameConfig,
  initializeFrameProject,
  setupIPC
};
