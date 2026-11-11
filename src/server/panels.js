/**
 * Server panels — what a server workspace's panels ask Frame Server
 * (server-workspace-panels spec).
 *
 * The desktop routes a panel call here when its path is a server
 * workspace's folder (or lies under one) or its id is a server workspace's.
 * Each method runs Initiative 1's own module on the server, so git and `gh`
 * run where the code and the credentials are:
 *
 *   files.tree / files.read                      fileTree, fileEditor (read-only)
 *   git.watch / git.unwatch / git.refresh        gitStatusManager → event git.status
 *   git.diff / git.branches / git.switch         gitDiffManager, gitBranchesManager
 *   review.files / review.fileDiff               gitDiffManager (workspace-review)
 *   pr.refresh / pr.push / pr.draft /            workspaceGitState → event pr.state
 *   pr.create / pr.merge / update.run /          (gh and git run here, as the server user;
 *   update.abort                                  workspace-pr-flow rules unchanged)
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

const MAX_READ_BYTES = 2 * 1024 * 1024;

function setup({ shim, registerMethods, broadcast }) {
  const fileTree = require('../main/fileTree');
  const fileEditor = require('../main/fileEditor');
  const gitStatus = require('../main/gitStatusManager');
  const gitDiff = require('../main/gitDiffManager');
  const git = require('../main/gitBranchesManager');
  const prState = require('../main/workspaceGitState');
  gitStatus.init(shim.fakeWindow);
  prState.init(shim.fakeWindow);

  shim.onSend((channel, payload) => {
    if (channel === IPC.GIT_STATUS_DATA) broadcast('git.status', payload || {});
    else if (channel === IPC.WORKSPACE_GIT_STATE) broadcast('pr.state', payload || {});
  });

  const need = (v, what) => {
    if (typeof v !== 'string' || !v) throw new Error(`Missing ${what}.`);
    return v;
  };

  registerMethods({
    'files.tree': async ({ root } = {}) => fileTree.getFileTree(need(root, 'root')),
    'files.read': async ({ filePath } = {}) => {
      need(filePath, 'file path');
      const base = { extension: path.extname(filePath).slice(1).toLowerCase(), fileName: path.basename(filePath), filePath, readOnly: true };
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch (err) { return { ...base, success: false, error: err.message }; }
      if (size > MAX_READ_BYTES) return { ...base, success: false, error: `This file is too large to open from the server (${Math.round(size / 1024 / 1024)} MB).` };
      return { ...fileEditor.readFile(filePath), ...base };
    },
    'git.watch': async ({ root } = {}) => { gitStatus.startWatching(need(root, 'root')); return null; },
    'git.unwatch': async () => { gitStatus.stopWatching(); return null; },
    'git.refresh': async () => { await gitStatus.pushStatus(); return null; },
    'git.diff': async (params = {}) => gitDiff.gitDiff(params),
    'git.branches': async ({ root } = {}) => git.loadBranches(need(root, 'root')),
    'git.switch': async ({ root, branchName } = {}) => git.switchBranch(need(root, 'root'), need(branchName, 'branch')),
    'review.files': async ({ root, base } = {}) => gitDiff.reviewFiles(need(root, 'root'), base),
    'review.fileDiff': async (params = {}) => gitDiff.reviewFileDiff(need(params.root, 'root'), params),
    'pr.refresh': async ({ projectPath } = {}) => {
      prState.setWatched(need(projectPath, 'project'));
      return prState.refresh(projectPath);
    },
    'pr.push': async ({ projectPath, id } = {}) => prState.push(need(projectPath, 'project'), id),
    'pr.draft': async ({ projectPath, id } = {}) => prState.prDraft(need(projectPath, 'project'), id),
    'pr.create': async ({ projectPath, id, title, body, draft } = {}) => prState.prCreate(need(projectPath, 'project'), id, { title, body, draft }),
    'pr.merge': async ({ projectPath, id } = {}) => prState.merge(need(projectPath, 'project'), id),
    'update.run': async ({ projectPath, id } = {}) => prState.updateFromBase(need(projectPath, 'project'), id),
    'update.abort': async ({ projectPath, id } = {}) => prState.abortUpdate(need(projectPath, 'project'), id)
  });

  return {
    stop() {
      try { gitStatus.stopWatching(); } catch (_) { /* already stopped */ }
    },
    // No desktop is connected: nobody receives git status or PR state, so
    // stop watching and polling until one asks again (git.watch / pr.refresh).
    idle() {
      try { gitStatus.stopWatching(); } catch (_) { /* already stopped */ }
      prState.setWatched(null);
    }
  };
}

module.exports = { setup, MAX_READ_BYTES };
