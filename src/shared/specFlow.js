/**
 * specFlow — the rules behind a spec's flow mode (full-auto-spec-flow spec).
 *
 * A spec's `status.json` may carry `flow_mode`:
 *   - "step-by-step" — today's flow: the user drives plan, tasks and implement
 *     from the next-action button, one phase per click.
 *   - "full-auto"    — the rest of the spec runs start to finish in one new
 *     session launched with the autonomous permission flags (`spec.auto`).
 * Absent means step by step, exactly as before the key existed.
 *
 * Pure: no filesystem, no DOM, no IPC. Shared by the renderer (trigger, button,
 * locked bar) and main.
 */

const FLOW_STEP_BY_STEP = 'step-by-step';
const FLOW_FULL_AUTO = 'full-auto';
const FLOW_MODES = [FLOW_STEP_BY_STEP, FLOW_FULL_AUTO];

// Phases a full-auto run still has work in. `draft` has no spec.md yet and
// `done` has nothing left, so neither is ever resumed.
const RESUMABLE_PHASES = new Set(['specified', 'planned', 'tasks_generated', 'implementing']);

/**
 * The flow mode a status (or a SPEC_DATA list entry) declares, or null when it
 * declares none or an unknown value. Null means "behave as today".
 */
function normalizeFlowMode(status) {
  const mode = status && typeof status.flow_mode === 'string' ? status.flow_mode : null;
  return FLOW_MODES.includes(mode) ? mode : null;
}

/**
 * Whether Frame should start a full-auto run now.
 *
 * Only a transition this window saw happen counts: the previous snapshot of
 * the spec did not say full auto, the new one does, the spec is still at
 * `specified`, and its slug is bound to a lane in this window (the Spec Creator
 * lane that just wrote it). A spec that arrives already in full auto — a
 * project opened, a `git pull`, another window's write — never starts a run on
 * its own: a file write alone must not launch an agent with elevated
 * permissions.
 *
 * @param {object|null} prevEntry - the spec in the previous SPEC_DATA push (null when it was not in it)
 * @param {object|null} nextEntry - the spec in the current push
 * @param {boolean} isBound - the slug is bound to a lane in this window
 */
function shouldStartFullAuto(prevEntry, nextEntry, isBound) {
  if (!isBound || !prevEntry || !nextEntry) return false;
  if (normalizeFlowMode(prevEntry) === FLOW_FULL_AUTO) return false;
  if (normalizeFlowMode(nextEntry) !== FLOW_FULL_AUTO) return false;
  return nextEntry.phase === 'specified';
}

/**
 * The next action for a full-auto spec with no live run, or null when the
 * spec is not in full auto, has nothing left, or a run is live (the bar shows
 * the locked state instead).
 *
 * The "…" signals the flow modal: resuming opens it with Full auto
 * preselected, so the same door also leads back to step by step.
 */
function fullAutoResumeAction(status, laneAlive) {
  if (normalizeFlowMode(status) !== FLOW_FULL_AUTO) return null;
  if (!status || !RESUMABLE_PHASES.has(status.phase)) return null;
  if (laneAlive) return null;
  return {
    command: 'spec.auto',
    label: 'Resume Full Auto…',
    hint: 'Frame continues this spec in full auto from where it stopped.'
  };
}

/**
 * The heading of the locked bar while a full-auto run is live.
 *
 * @param {string} phase - the spec's current phase
 * @param {{completed:number,total:number}|null} counts - the spec's task counts
 * @param {string|null} laneStatus - the lane's status; 'agent-input' means the
 *   agent finished its turn and is waiting at the prompt, which in a run that
 *   never checks in means it hit a stop condition and needs the user
 */
function fullAutoStageLabel(phase, counts, laneStatus) {
  if (laneStatus === 'agent-input') return 'Full auto · needs you';
  if (laneStatus === 'agent-approval') return 'Full auto · waiting for permission';
  switch (phase) {
    case 'specified':
      return 'Full auto · planning';
    case 'planned':
      return 'Full auto · tasks';
    case 'tasks_generated':
    case 'implementing':
      return counts && counts.total > 0
        ? `Full auto · implementing ${counts.completed}/${counts.total}`
        : 'Full auto · implementing';
    default:
      return 'Full auto';
  }
}

module.exports = {
  FLOW_STEP_BY_STEP,
  FLOW_FULL_AUTO,
  FLOW_MODES,
  normalizeFlowMode,
  shouldStartFullAuto,
  fullAutoResumeAction,
  fullAutoStageLabel
};
