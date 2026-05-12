/**
 * Dialogs Module
 * Handles system dialogs - folder picker, file dialogs
 */

const { dialog, app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;
let onProjectSelected = null;

/**
 * Initialize dialogs module
 */
function init(window, callback) {
  mainWindow = window;
  onProjectSelected = callback;
}

/**
 * Show folder picker dialog
 */
async function showFolderPicker(event) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];

    if (onProjectSelected) {
      onProjectSelected(selectedPath);
    }

    event.sender.send(IPC.PROJECT_SELECTED, selectedPath);
    return selectedPath;
  }

  return null;
}

/**
 * Show new project dialog
 */
async function showNewProjectDialog(event) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Location for New Project',
    buttonLabel: 'Create Project Here'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];

    if (onProjectSelected) {
      onProjectSelected(selectedPath);
    }

    event.sender.send(IPC.PROJECT_SELECTED, selectedPath);
    return selectedPath;
  }

  return null;
}

/**
 * Clone a GitHub repo and initialize it as a Frame project
 */
async function cloneGithubRepo(event, repoUrl) {
  // Ask user where to clone
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Destination Folder',
    buttonLabel: 'Clone Here'
  });

  if (result.canceled || result.filePaths.length === 0) {
    event.sender.send(IPC.CLONE_GITHUB_REPO_RESULT, { success: false, cancelled: true });
    return;
  }

  const destinationDir = result.filePaths[0];
  const repoName = repoUrl.split('/').pop().replace(/\.git$/, '');
  const projectPath = path.join(destinationDir, repoName);

  const gitProcess = spawn('git', ['clone', repoUrl, projectPath]);

  let errorOutput = '';
  gitProcess.stderr.on('data', (data) => {
    // git clone writes progress to stderr — not always an error
    errorOutput += data.toString();
  });

  gitProcess.on('close', (code) => {
    if (code !== 0) {
      event.sender.send(IPC.CLONE_GITHUB_REPO_RESULT, {
        success: false,
        error: errorOutput || `git clone exited with code ${code}`
      });
      return;
    }

    if (onProjectSelected) {
      onProjectSelected(projectPath);
    }

    event.sender.send(IPC.CLONE_GITHUB_REPO_RESULT, { success: true, projectPath });
  });
}

/**
 * Recursively copy a directory using node:fs reads + writes. Avoids
 * fs.cpSync because that doesn't reliably work from inside Electron's
 * asar archive; readFileSync + writeFileSync goes through the
 * transparent asar layer and works in both dev and packaged builds.
 */
function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (ent.isFile()) {
      const data = fs.readFileSync(from);
      fs.writeFileSync(to, data);
    }
  }
}

/**
 * Open the bundled sample project, copying it into the user's app-data
 * directory on first use so they can poke at it without affecting the
 * source. We copy lazily — only on first open — and leave any edits the
 * user makes alone afterward; this is a "training wheels" project, not
 * a pristine demo that resets every launch.
 */
async function openSampleProject(event) {
  const sourceDir = path.join(__dirname, '..', 'templates', 'sample-project');
  const targetDir = path.join(app.getPath('userData'), 'sample-project');

  if (!fs.existsSync(sourceDir)) {
    console.error('Sample project template missing at', sourceDir);
    return null;
  }

  if (!fs.existsSync(targetDir)) {
    try {
      copyDirRecursive(sourceDir, targetDir);
    } catch (err) {
      console.error('Failed to copy sample project:', err);
      return null;
    }
  }

  if (onProjectSelected) {
    onProjectSelected(targetDir);
  }
  event.sender.send(IPC.PROJECT_SELECTED, targetDir);
  return targetDir;
}

/**
 * Path used by the renderer to detect "this is the sample project" so
 * the banner / read-only hints can show. Exposed via IPC.invoke.
 */
function getSampleProjectPath() {
  return path.join(app.getPath('userData'), 'sample-project');
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.SELECT_PROJECT_FOLDER, async (event) => {
    await showFolderPicker(event);
  });

  ipcMain.on(IPC.CREATE_NEW_PROJECT, async (event) => {
    await showNewProjectDialog(event);
  });

  ipcMain.on(IPC.CLONE_GITHUB_REPO, async (event, repoUrl) => {
    await cloneGithubRepo(event, repoUrl);
  });

  ipcMain.on(IPC.OPEN_SAMPLE_PROJECT, async (event) => {
    await openSampleProject(event);
  });

  ipcMain.handle(IPC.GET_SAMPLE_PROJECT_PATH, () => getSampleProjectPath());
}

module.exports = {
  init,
  showFolderPicker,
  showNewProjectDialog,
  openSampleProject,
  getSampleProjectPath,
  setupIPC
};
