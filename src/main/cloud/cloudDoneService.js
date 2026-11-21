/**
 * cloudDoneService — the Electron shell around reporting a started brief's
 * parts to Frame Cloud (frame-cloud-brief-done).
 *
 * Holds no decisions (that is cloudDone.js). After a Briefs read answers,
 * `report` lists the folder's branches, asks the core what to send, resolves
 * each candidate's branch tip once, reads its record at that tip through git
 * (no checkout, so it works from whatever branch is open), and sends the due
 * `brief.recordBranch` / `brief.recordCompletion` calls through
 * cloudProjectsService's `call()`. A send that lands pushes
 * `CLOUD_BRIEFS_CHANGED` so the panel reloads; the next read then finds
 * nothing to send, which is what ends the loop (D8).
 *
 * There is no queue and no watcher: a failure is logged and the next read
 * sends the difference again (D6). The token stays in main.
 */

const path = require('path');
const { IPC } = require('../../shared/ipcChannels');
const { FRAME_FILES } = require('../../shared/frameConstants');
const logger = require('../logger');
const frameStore = require('../frameStore');
const git = require('../gitBranchesManager');
const cloudProjectsService = require('./cloudProjectsService');
const cloudStartService = require('./cloudStartService');
const cloudBriefs = require('./cloudBriefs');
const core = require('./cloudDone');

/**
 * The cloud's answers that this send can never get past, logged as such and
 * never held for a retry. `ALREADY_DONE` is no longer forever: since manual
 * Done (frame-cloud-brief-manual-done) a person can move a Done brief back to
 * Active, and because nothing is held, the next read after that move sends
 * whatever is missing. Only Active briefs are reported in the first place.
 */
const FINAL_REFUSALS = new Set(['PART_DROPPED', 'PART_MERGED', 'NOT_STARTED', 'ALREADY_DONE', 'ALREADY_CLOSED']);

/** A commit's content never changes, so "finished at this tip" is kept; the map is cleared when it grows. */
const FINISHED_MEMO_MAX = 500;

let mainWindow = null;
const running = new Set(); // folder paths with a report in flight
const finishedMemo = new Map(); // `${folder}\0${tip}\0${shape}\0${ref}` → boolean

function errorText(err) {
  return (err && (err.message || err.error)) || String(err);
}

/** The folder's tasks.json, relative to the folder and with forward slashes; null when it sits outside it. */
function tasksRelPath(folderPath) {
  const rel = path.relative(folderPath, frameStore.resolvePath(folderPath, FRAME_FILES.TASKS));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** This folder's local branch names, or null when git cannot list them. */
async function localBranchNames(folderPath) {
  const list = await git.loadBranches(folderPath);
  if (!list || list.error || !Array.isArray(list.branches)) return null;
  return new Set(list.branches.filter((b) => b && !b.isRemote).map((b) => b.name));
}

/**
 * Is the candidate's record finished at `tip`? Read with `git show` from the
 * commit itself, once per tip (`tasksAt`, this report) and once per tip and
 * ref across reports (`finishedMemo`). A read that fails is not remembered.
 */
async function finishedAt(folderPath, tip, candidate, relPath, tasksAt) {
  const key = `${folderPath}\0${tip}\0${candidate.shape}\0${candidate.ref}`;
  if (finishedMemo.has(key)) return finishedMemo.get(key);
  if (!tasksAt.has(tip)) {
    const text = await git.showFileAt(folderPath, tip, relPath);
    let tasks = null;
    if (text !== null) {
      try {
        tasks = JSON.parse(text);
      } catch {
        tasks = null;
      }
    }
    tasksAt.set(tip, tasks);
  }
  const tasks = tasksAt.get(tip);
  if (!tasks) return false;
  const finished = core.isFinished({ shape: candidate.shape, ref: candidate.ref, tasks });
  if (finishedMemo.size >= FINISHED_MEMO_MAX) finishedMemo.clear();
  finishedMemo.set(key, finished);
  return finished;
}

/** Should `tip` be sent over the cloud's `stored` completion (D12)? git answers the two history questions. */
async function completionDue(folderPath, stored, tip) {
  if (!stored || stored === tip) return core.completionDue({ stored, tip });
  const storedKnown = core.isSha(stored) && await git.commitExists(folderPath, stored);
  const tipAtOrBeforeStored = storedKnown && await git.isAncestor(folderPath, tip, stored);
  return core.completionDue({ stored, tip, storedKnown, tipAtOrBeforeStored });
}

/**
 * Send one record through `call()`. A final refusal is logged as information,
 * anything else as a warning; neither is held for later. → landed?
 */
async function send(label, fn) {
  const result = await cloudProjectsService.call(async (ctx) => {
    try {
      await fn(ctx);
      return { refused: null };
    } catch (err) {
      if (err && FINAL_REFUSALS.has(err.message)) return { refused: err.message };
      throw err;
    }
  });
  if (!result.ok) {
    logger.warn('cloudDone', `${label} was not sent: ${result.reason}`);
    return false;
  }
  if (result.value.refused) {
    logger.info('cloudDone', `${label} was refused: ${result.value.refused}`);
    return false;
  }
  return true;
}

function push(folderPath) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.CLOUD_BRIEFS_CHANGED, { folderPath });
  }
}

async function run(folderPath, project, briefs) {
  // Nothing Active: no git work at all.
  if (!briefs.some(core.isActiveBrief)) return;
  const localBranches = await localBranchNames(folderPath);
  if (!localBranches) {
    logger.warn('cloudDone', 'could not list the folder\'s branches');
    return;
  }
  const { branches, completions } = core.plan({
    briefs,
    begun: (number, partId) => cloudStartService.begunEntry(project.id, number, partId),
    localBranches,
  });

  let landed = false;
  for (const b of branches) {
    const sent = await send(`the branch of brief #${b.number} part ${b.partId}`, (ctx) =>
      cloudBriefs.recordBranch({ ...ctx, id: b.id, partId: b.partId, branch: b.branch, baseSha: b.baseSha }));
    landed = landed || sent;
  }

  if (completions.length > 0) {
    const relPath = tasksRelPath(folderPath);
    const tips = new Map(); // branch → tip, resolved once per report
    const tasksAt = new Map(); // tip → parsed tasks.json, read once per report
    for (const c of completions) {
      if (!tips.has(c.branch)) tips.set(c.branch, await git.branchTipSha(folderPath, c.branch));
      const tip = tips.get(c.branch);
      if (!core.isSha(tip) || !relPath) continue;
      if (!(await completionDue(folderPath, c.stored, tip))) continue;
      if (!(await finishedAt(folderPath, tip, c, relPath, tasksAt))) continue;
      const sent = await send(`the completion of brief #${c.number} part ${c.partId}`, (ctx) =>
        cloudBriefs.recordCompletion({ ...ctx, id: c.id, partId: c.partId, sha: tip }));
      landed = landed || sent;
    }
  }

  if (landed) push(folderPath);
}

/**
 * Report what this machine knows about the listed briefs' parts. Single-flight
 * per folder: a read that arrives while a report runs starts none. Never
 * throws; a failure is logged.
 */
async function report(folderPath, project, briefs) {
  if (typeof folderPath !== 'string' || !folderPath || !project || !project.id) return;
  // Both reports are writes (`work`); a viewer's Briefs read sends nothing.
  if (!cloudProjectsService.can('work')) return;
  if (running.has(folderPath)) return;
  running.add(folderPath);
  try {
    await run(folderPath, project, Array.isArray(briefs) ? briefs : []);
  } catch (err) {
    logger.warn('cloudDone', `report failed: ${errorText(err)}`);
  } finally {
    running.delete(folderPath);
  }
}

function init(window) {
  mainWindow = window;
}

module.exports = {
  init,
  report,
};
