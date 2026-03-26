/**
 * Dialogs Module
 * Handles system dialogs - folder picker, file dialogs
 */

const { dialog } = require('electron');
const { spawn } = require('child_process');
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
}

module.exports = {
  init,
  showFolderPicker,
  showNewProjectDialog,
  setupIPC
};
