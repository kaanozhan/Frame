/**
 * GitHub Manager Module
 * Handles GitHub integration using gh CLI
 */

const { exec } = require('child_process');
const { shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;
let currentProjectPath = null;

/**
 * Initialize GitHub manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Set current project path
 */
function setProjectPath(projectPath) {
  currentProjectPath = projectPath;
}

/**
 * Check if gh CLI is available
 */
function checkGhCli() {
  return new Promise((resolve) => {
    exec('gh --version', (error) => {
      resolve(!error);
    });
  });
}

/**
 * Check if current directory is a git repo with GitHub remote
 */
function checkGitHubRepo(projectPath) {
  return new Promise((resolve) => {
    exec('gh repo view --json nameWithOwner', { cwd: projectPath }, (error, stdout) => {
      if (error) {
        resolve({ isGitHubRepo: false, repoName: null });
      } else {
        try {
          const data = JSON.parse(stdout);
          resolve({ isGitHubRepo: true, repoName: data.nameWithOwner });
        } catch {
          resolve({ isGitHubRepo: false, repoName: null });
        }
      }
    });
  });
}

/**
 * Load GitHub issues for current project
 */
async function loadIssues(projectPath, state = 'open') {
  const ghAvailable = await checkGhCli();
  if (!ghAvailable) {
    return { error: 'gh CLI not installed', issues: [] };
  }

  const repoInfo = await checkGitHubRepo(projectPath);
  if (!repoInfo.isGitHubRepo) {
    return { error: 'Not a GitHub repository', issues: [] };
  }

  return new Promise((resolve) => {
    const cmd = `gh issue list --state ${state} --json number,title,state,author,labels,createdAt,updatedAt,url --limit 50`;

    exec(cmd, { cwd: projectPath }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: stderr || error.message, issues: [], repoName: repoInfo.repoName });
      } else {
        try {
          const issues = JSON.parse(stdout);
          resolve({ error: null, issues, repoName: repoInfo.repoName });
        } catch (e) {
          resolve({ error: 'Failed to parse issues', issues: [], repoName: repoInfo.repoName });
        }
      }
    });
  });
}

/**
 * Open issue in browser
 */
function openIssue(url) {
  if (url) {
    shell.openExternal(url);
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  // Load issues
  ipcMain.handle(IPC.LOAD_GITHUB_ISSUES, async (event, { projectPath, state }) => {
    const path = projectPath || currentProjectPath;
    if (!path) {
      return { error: 'No project selected', issues: [] };
    }
    return await loadIssues(path, state);
  });

  // Open issue in browser
  ipcMain.on(IPC.OPEN_GITHUB_ISSUE, (event, url) => {
    openIssue(url);
  });
}

module.exports = {
  init,
  setProjectPath,
  setupIPC,
  loadIssues,
  openIssue
};
