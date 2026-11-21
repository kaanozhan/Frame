/**
 * cloudDone — the pure core of reporting a started brief's parts to Frame
 * Cloud: the branch each was begun on (`brief.recordBranch`) and the commit
 * where it finished (`brief.recordCompletion`). The cloud decides merged and
 * Done from those facts (FrameCloud brief-done); Frame only reports them.
 *
 * Nothing here touches git, a file or the network. cloudDoneService.js
 * resolves branch tips and reads records at them, then asks this module what
 * to send. There is no queue: every Briefs read compares what the cloud shows
 * with what this machine knows and sends only the difference, which the cloud
 * ignores when it repeats (frame-cloud-brief-done D6).
 */

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

/** A full commit id as `git rev-parse` prints it: 40 lowercase hex characters. */
function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

/**
 * Whether a part counts as merged: the cloud saw it on a target (`mergedAt`)
 * and that target is still the brief's (`mergedBase === target`). The web's
 * `countsAsMerged`, and the same rule as cloudBriefsCopy's.
 */
function countsAsMerged(part, target) {
  const p = part || {};
  return Boolean(p.mergedAt) && isNonEmpty(target) && p.mergedBase === target;
}

/** Started, not Done, not closed: the only briefs whose parts are reported (D14). */
function isActiveBrief(brief) {
  const b = obj(brief);
  return b.status === 'active' && Boolean(b.startedAt) && Array.isArray(b.parts);
}

/** A part still to report: linked to a record, not dropped, not merged into the brief's target (D14). */
function isLivePart(part, target) {
  const p = obj(part);
  return isNonEmpty(p.id) && isNonEmpty(p.recordRef) && !p.droppedAt && !countsAsMerged(p, target);
}

/**
 * What to send for the listed briefs.
 * - `briefs`: normalized briefs with their parts (`branch`, `completionSha`, …).
 * - `begun(number, partId)`: this machine's begun entry (`{ branch, baseSha? }`) or null.
 * - `localBranches`: a Set of this folder's local branch names.
 *
 * A branch is due only while the cloud has none and this machine's entry
 * carries its base commit (D10): resending whenever they differ would let a
 * stale entry here overwrite another machine's re-Begin. A completion
 * candidate reads the cloud's `branch` when this folder has it, else this
 * machine's begun branch, else nothing — the machine that holds the branch
 * reports it (D11).
 * → `{ branches: [{ id, number, partId, branch, baseSha }],
 *      completions: [{ id, number, partId, ref, shape, branch, stored }] }`.
 */
function plan({ briefs, begun, localBranches } = {}) {
  const has = (name) => isNonEmpty(name) && localBranches instanceof Set && localBranches.has(name);
  const entryOf = typeof begun === 'function' ? begun : () => null;
  const branches = [];
  const completions = [];
  for (const brief of arr(briefs)) {
    if (!isActiveBrief(brief)) continue;
    for (const part of brief.parts) {
      if (!isLivePart(part, brief.targetBranch)) continue;
      const entry = obj(entryOf(brief.number, part.id));
      if (!isNonEmpty(part.branch) && isNonEmpty(entry.branch) && isSha(entry.baseSha)) {
        branches.push({ id: brief.id, number: brief.number, partId: part.id, branch: entry.branch, baseSha: entry.baseSha });
      }
      let branch = null;
      if (has(part.branch)) branch = part.branch;
      else if (has(entry.branch)) branch = entry.branch;
      if (!branch) continue;
      completions.push({
        id: brief.id,
        number: brief.number,
        partId: part.id,
        ref: part.recordRef,
        shape: part.shape,
        branch,
        stored: isNonEmpty(part.completionSha) ? part.completionSha : null,
      });
    }
  }
  return { branches, completions };
}

/**
 * Whether a part's record is finished in `tasks` (a `tasks.json` as read at
 * the branch tip, or its `tasks` array). Mirrors specManager.derivePhase: a
 * spec part is finished when at least one task's `source` starts with
 * `spec:<slug>:` and every such task is `completed`; a task part when its row
 * is `completed`. `status.json` is not read, since the phase is derived from
 * the tasks (D13).
 */
function isFinished({ shape, ref, tasks } = {}) {
  if (!isNonEmpty(ref)) return false;
  const rows = (Array.isArray(tasks) ? tasks : arr(obj(tasks).tasks)).filter((t) => t && typeof t === 'object');
  if (shape === 'spec') {
    const prefix = `spec:${ref}:`;
    const own = rows.filter((t) => typeof t.source === 'string' && t.source.startsWith(prefix));
    return own.length > 0 && own.every((t) => t.status === 'completed');
  }
  if (shape === 'task') {
    const row = rows.find((t) => t.id === ref);
    return Boolean(row) && row.status === 'completed';
  }
  return false;
}

/**
 * Whether the tip should be sent as the part's completion, given that the
 * record is finished there (D12). `stored` is the cloud's `completionSha`,
 * `storedKnown` whether this repository has that commit, and
 * `tipAtOrBeforeStored` whether the tip is an ancestor of it (or equal).
 * - nothing stored → due;
 * - the tip itself stored → not due;
 * - a stored commit this repository does not know is another machine's newer
 *   work → not due;
 * - stored at or after the tip → not due;
 * - otherwise the tip moved on, or the branch was rebased → due.
 */
function completionDue({ stored, tip, storedKnown, tipAtOrBeforeStored } = {}) {
  if (!isSha(tip)) return false;
  if (!isNonEmpty(stored)) return true;
  if (stored === tip) return false;
  if (!storedKnown) return false;
  return !tipAtOrBeforeStored;
}

module.exports = {
  isSha,
  countsAsMerged,
  isActiveBrief,
  isLivePart,
  plan,
  isFinished,
  completionDue,
};
