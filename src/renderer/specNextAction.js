/**
 * Spec Next-Action Bar (shared)
 *
 * One implementation of the "what's the next step" bar that the spec detail
 * surfaces (specSection, specPanel, specsDashboard) all render. It used to
 * live as three near-identical `nextActionForPhase` + `renderNextActionBar`
 * copies; the label × lock × progress logic this module adds would have been
 * a bug farm in triplicate.
 *
 * The surfaces keep their own click wiring — they call `nextActionForPhase`
 * for the command and null-check, render `renderNextActionBar(...)`, and
 * attach their own listener to the button (each passing its own `buttonId`).
 *
 * The idle button never carries a mode. It always reads "Implement Tasks…"
 * and opens the modal, where the mode is chosen per run; a past choice recorded
 * in status.json only preselects there. This is deliberate: latching the label
 * to the last mode left a "Run Custom Flow" (or "Start Guided Run") hanging on
 * an abandoned spec with no way back. The resolved mode only shapes the
 * *locked* bar, and only while a run is genuinely live.
 *
 * Progress ("2/7 done") comes from tasks.json (`counts`), never from the lane
 * or the mode — so it stays accurate across kills, restarts and app closes.
 *
 * Two lock regimes:
 *   - turn-scoped: a live agent mid-turn locks the button until it finishes.
 *     Correct for step-by-step / custom / the pre-mode state, where idling for
 *     approval between tasks is expected.
 *   - run-liveness: for the continuous modes (guided, autonomous) the lock
 *     must survive turn boundaries — the run keeps going on its own, so the
 *     button stays locked while the lane is alive and tasks remain, showing
 *     live progress, and self-releases when the agent dies or the last task
 *     completes. All inputs are derived per render (no stored busy flag), so
 *     a closed Frame drops the lane and the lock releases on its own.
 */

const { escapeHtml } = require('./htmlUtils');

// Base next-action per phase. Every phase carries a fixed label; the implement
// phase's "Implement Tasks…" opens the mode modal rather than naming a mode.
function nextActionForPhase(phase) {
  switch (phase) {
    case 'draft':
      return { command: 'spec.new', label: 'Write the Spec', hint: 'Frame turns your description into a structured spec.md.' };
    case 'specified':
      return { command: 'spec.plan', label: 'Generate Plan', hint: 'Frame breaks this spec into a technical plan (plan.md).' };
    case 'planned':
      return { command: 'spec.tasks', label: 'Break into Tasks', hint: 'Frame splits the plan into discrete, trackable tasks.' };
    case 'tasks_generated':
    case 'implementing':
      return { command: 'spec.implement', label: 'Implement Tasks…', hint: 'Choose how Frame implements the remaining tasks.' };
    default:
      return null; // 'done' or unknown — no action
  }
}

// Modes whose run spans multiple agent turns — their lock is run-liveness,
// not turn-scoped.
const CONTINUOUS_MODES = new Set(['guided', 'autonomous']);

/**
 * Count this spec's tasks from the full task list. Shared so all three
 * surfaces compute progress identically.
 * @returns {{completed:number, total:number, pending:number}}
 */
function taskCounts(allTasks, slug) {
  const prefix = `spec:${slug}:`;
  const items = (Array.isArray(allTasks) ? allTasks : [])
    .filter((t) => t && typeof t.source === 'string' && t.source.startsWith(prefix));
  const completed = items.filter((t) => t.status === 'completed').length;
  const pending = items.filter((t) => t.status !== 'completed').length;
  return { completed, total: items.length, pending };
}

/**
 * Render the next-action bar.
 *
 * @param {object} opts
 * @param {object} opts.action   - from nextActionForPhase(phase)
 * @param {object|null} opts.lane - getSpecLaneInfo(slug)
 * @param {string|null} [opts.hint] - resolved implement mode; picks the lock
 *                                     regime (continuous vs turn-scoped) while a
 *                                     run is live. Never affects the idle label.
 * @param {object|null} [opts.counts] - taskCounts(allTasks, slug); drives the
 *                                       progress copy and the run-liveness gate
 * @param {string} [opts.buttonId] - id for the idle button (surface's click
 *                                    wiring queries it)
 * @returns {string} HTML
 */
function renderNextActionBar({ action, lane, hint = null, counts = null, buttonId = 'spec-action-btn' } = {}) {
  if (!action) return '';
  const isImplement = action.command === 'spec.implement';
  // The idle label never latches to a mode. The mode is chosen in the modal
  // (this button opens it), so a past choice must not colour the button — that
  // was the "Run Custom Flow" that lingered after the run was abandoned. The
  // resolved mode only shapes the *locked* bar below, and only while a run is
  // genuinely live. `action.label` is "Implement Tasks…" for the implement
  // phase; the "…" signals the modal.
  const label = action.label;
  const alive = !!(lane && lane.agentName);

  // Run-liveness lock — continuous mode, live agent, tasks still pending.
  // When counts are unknown, a live agent alone holds the lock (fail closed
  // against a double dispatch; the lane going away still releases it).
  if (isImplement && CONTINUOUS_MODES.has(hint) && alive && (!counts || counts.pending > 0)) {
    const waiting = lane.status === 'agent-approval';
    const heading = waiting
      ? 'Waiting for permission'
      : (counts ? `Running — ${counts.completed}/${counts.total} tasks` : 'Running');
    return _lockedBar({ heading, sub: `in ${lane.name}`, label });
  }

  // Turn-scoped lock — a live agent mid-turn locks the button until it
  // finishes its turn (step-by-step / custom / no-mode-yet).
  if (lane && lane.busy) {
    const verb = lane.status === 'agent-approval' ? 'Waiting for approval' : 'Working';
    return _lockedBar({
      heading: `${verb} in ${lane.name}`,
      sub: 'Unlocks when the agent finishes its turn.',
      label
    });
  }

  // Idle — the actionable button. For implement, progress from tasks.json
  // (durable, lane- and mode-independent) is the subtext: it stays accurate
  // across kills, restarts and app closes. Falls back to the phase hint when
  // there are no tasks to count yet.
  const sub = isImplement && counts && counts.total > 0
    ? `${counts.completed}/${counts.total} done`
    : action.hint;
  return `
    <div class="spec-next-action">
      <div class="spec-next-action-text">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(sub)}</span>
      </div>
      <button class="btn btn-primary spec-action-btn" id="${escapeHtml(buttonId)}">
        ${escapeHtml(label)}
      </button>
    </div>
  `;
}

function _lockedBar({ heading, sub, label }) {
  return `
    <div class="spec-next-action spec-next-action-busy">
      <div class="spec-next-action-text">
        <strong>${escapeHtml(heading)}</strong>
        <span>${escapeHtml(sub)}</span>
      </div>
      <button class="btn btn-primary spec-action-btn" disabled>
        <span class="spec-action-spinner"></span>${escapeHtml(label)}
      </button>
    </div>
  `;
}

module.exports = {
  nextActionForPhase,
  taskCounts,
  renderNextActionBar
};
