/**
 * queueRunner — gets one queue item ready to run (work-queue spec, T08).
 *
 * Machine-agnostic: the desktop and Frame Server both call `prepare` with
 * their own checkout (the Mac's main checkout, or a server clone). It does
 * everything mechanical before an agent starts (plan D10), and returns what
 * the host needs to start it:
 *
 *   { cwd, worktree: { path, branch } | null, launchFlags, prompt, command }
 *
 *  - Where it runs (D14, D18): a spec whose folder already lives in a Frame
 *    workspace runs in that workspace's checkout; everything else gets its
 *    own plain git worktree, reused when the item already has one (resume).
 *  - The worktree works like the main checkout for Frame (D15): tooling is
 *    provisioned into it, and a spec folder main has but the worktree lacks
 *    (an uncommitted spec — the usual case) is copied in.
 *  - What it runs:
 *      spec, full auto → spec.auto, with flow_mode full-auto and
 *        implement_mode autonomous recorded in the copy it runs (D20);
 *      spec, step by step → the next phase's command (D20);
 *      task → the Play prompt with the main checkout's tasks.json (D17) and
 *        the full-auto launch flags (D2).
 *    Claude Code only (D12).
 */

const fs = require('fs');
const path = require('path');
const rules = require('../shared/queueRules');
const { buildTaskPrompt } = require('../renderer/tasks/runPrompt');

const AI_TOOL = 'claude-code';

function specDirIn(root, slug) {
  return require('./frameStore').resolveSpecDir(root, slug);
}

function readStatusAt(root, slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(specDirIn(root, slug), 'status.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

/** The checkout a spec already lives in when that is a Frame workspace, else null (D18). */
function workspaceRootOf(checkout, slug) {
  try {
    const loc = require('./specManager').specLocation(checkout, slug);
    // A queue worktree (D16) is not a workspace: the item keeps its worktree.
    if (!loc || !loc.workspace || loc.workspace.queue) return null;
    return loc.root && path.resolve(loc.root) !== path.resolve(checkout) ? loc.root : null;
  } catch (_) {
    return null;
  }
}

/** Copies main's spec folder into the worktree when the worktree has none (D15). */
function copySpecIn(checkout, worktree, slug) {
  const from = specDirIn(checkout, slug);
  const to = specDirIn(worktree, slug);
  if (fs.existsSync(path.join(to, 'status.json')) || !fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  return true;
}

async function worktreeFor(checkout, item) {
  const git = require('./gitBranchesManager');
  const taken = await git.queueBranches(checkout);
  const key = rules.worktreeKey(item, taken);
  const res = await git.createQueueWorktree(checkout, { key, existing: item.worktree });
  if (res.error) throw new Error(`Could not create the worktree: ${res.error}`);
  return { path: res.path, branch: res.branch };
}

function tasksPathOf(checkout) {
  const frameStore = require('./frameStore');
  const { FRAME_FILES } = require('../shared/frameConstants');
  return path.resolve(frameStore.resolvePath(checkout, FRAME_FILES.TASKS));
}

function findTask(checkout, taskId) {
  const data = require('./tasksManager').loadTasks(checkout);
  const list = data && Array.isArray(data.tasks) ? data.tasks : [];
  return list.find((t) => t && t.id === taskId) || null;
}

async function prepareSpec(checkout, item) {
  const specManager = require('./specManager');
  let cwd = workspaceRootOf(checkout, item.ref);
  let worktree = null;
  if (!cwd) {
    worktree = await worktreeFor(checkout, item);
    cwd = worktree.path;
    copySpecIn(checkout, cwd, item.ref);
  }
  require('./workspaceTooling').provision(checkout, cwd);
  const status = readStatusAt(cwd, item.ref);
  if (!status) throw new Error(`The spec ${item.ref} was not found.`);
  const command = rules.startCommand(item, status.phase);
  if (!command) throw new Error(`The spec ${item.ref} has nothing left to run (phase ${status.phase}).`);
  if (command === 'spec.auto') {
    const res = specManager.updateSpecStatusIn(cwd, item.ref, { flow_mode: 'full-auto', implement_mode: 'autonomous' });
    if (res && res.error) throw new Error(`Could not record full auto for ${item.ref}: ${res.error}`);
  }
  const staged = specManager.buildSpecCommandFileIn(cwd, checkout, item.ref, command, AI_TOOL, '');
  if (!staged || staged.error || !staged.success) throw new Error(`Could not stage ${command} for ${item.ref}: ${(staged && staged.error) || 'unknown error'}`);
  return { cwd, worktree, command, launchFlags: staged.launchFlags || [], prompt: staged.instruction, phase: status.phase };
}

async function prepareTask(checkout, item, { confirm = 'ask' } = {}) {
  const task = findTask(checkout, item.ref);
  if (!task) throw new Error(`The task ${item.ref} no longer exists.`);
  const worktree = await worktreeFor(checkout, item);
  require('./workspaceTooling').provision(checkout, worktree.path);
  // The queue's "Before starting" setting: ask like Play, or decide and go on.
  const prompt = buildTaskPrompt(task, { tasksPath: tasksPathOf(checkout), decide: confirm === 'decide' });
  const launchFlags = require('./specManager').getAutoLaunchFlags(worktree.path, AI_TOOL);
  return { cwd: worktree.path, worktree, command: null, launchFlags, prompt, task };
}

/**
 * Everything a queue item needs before its agent starts. Throws with a
 * message the Chief can report when the item cannot run.
 */
async function prepare(checkout, item) {
  if (!checkout || !item) throw new Error('Nothing to prepare.');
  if (item.kind === rules.KINDS.SPEC) return prepareSpec(checkout, item);
  if (item.kind === rules.KINDS.TASK) return prepareTask(checkout, item, { confirm: require('./queueStore').load(checkout).confirm });
  throw new Error('Unknown item kind.');
}

module.exports = { prepare, AI_TOOL, _copySpecIn: copySpecIn };
