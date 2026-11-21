/**
 * Frame's gitignored tooling on a server (server-workspace-tooling).
 *
 * `.frame/bin` (hook scripts), `.frame/runtime/commands` (the spec command
 * templates) and `.frame/index` (the spec index) are gitignored, so a clone
 * on the server never gets them from git. The desktop stages them into a
 * project when it opens it; nothing opens a server clone, so they appeared
 * only once a spec command was sent from the desktop (`specs.stage`). Until
 * then a server workspace had no templates — an agent asked for a spec in
 * its terminal found none — and Frame's hooks there stayed silent.
 *
 * `provisionTooling` stages them into the clone from this Frame Server's own
 * package (so they match the code that reads them), then copies them into a
 * workspace's worktree. `provisionIfFrame` does the same only for a Frame
 * project (`.frame/config.json` in the clone), so a project without Frame
 * never gets a `.frame` folder from the server. Only Frame's own
 * gitignored folders are written.
 */

const fs = require('fs');
const path = require('path');
const { FRAME_DIR, FRAME_CONFIG_FILE } = require('../shared/frameConstants');

/** Stage the tooling into `projectPath` (the clone), then into `root` when it is a worktree. Returns the copied relative paths. */
async function provisionTooling(projectPath, root) {
  const structureBootstrap = require('../main/structureBootstrap');
  const commandStaging = require('../main/commandStaging');
  const workspaceTooling = require('../main/workspaceTooling');
  const specIndex = require('../../scripts/spec-index.js');
  structureBootstrap.stageParserScripts(projectPath);
  commandStaging.stageCommandFiles(projectPath);
  try {
    await specIndex.ensureFresh(projectPath);
  } catch (err) {
    console.warn(`[frame-server] spec index not refreshed for ${projectPath}: ${err.message}`);
  }
  if (root && path.resolve(root) !== path.resolve(projectPath)) return workspaceTooling.provision(projectPath, root);
  return [];
}

function isFrameProject(projectPath) {
  try { return fs.existsSync(path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE)); } catch (_) { return false; }
}

/** `provisionTooling` for a Frame project; nothing for any other. Never throws — a workspace action must not fail over it. */
async function provisionIfFrame(projectPath, root) {
  if (!isFrameProject(projectPath)) return [];
  try {
    return await provisionTooling(projectPath, root);
  } catch (err) {
    console.warn(`[frame-server] could not provision Frame tooling in ${root || projectPath}: ${err.message}`);
    return [];
  }
}

module.exports = { provisionTooling, provisionIfFrame, isFrameProject };
