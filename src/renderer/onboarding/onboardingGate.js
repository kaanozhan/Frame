/**
 * The onboarding screen's gate (first-run-onboarding-screen spec, D4 / D5).
 *
 * Two questions, one answer: does the first-run screen show, and can it be
 * dismissed with Escape or a ×. Everything that decides it lives here, with
 * no DOM and no `ipcRenderer`, so the branching part of the surface is
 * testable even though the surface itself is not — the same split
 * `dock/dockState.js` and `home/agentRows.js` make.
 *
 * The screen is gated on the project count alone. Nothing is persisted when
 * the user skips: a skip is for that launch, and the screen stops appearing
 * the moment a project exists rather than the moment someone dismisses it.
 */

/** Boot: the loader consults the gate once, on the first PROJECT_REGISTRY_DATA. */
const LAUNCH = 'launch';
/** The palette's Show the Start Screen command, at any project count. */
const COMMAND = 'command';

/**
 * @param {object} input
 * @param {'launch'|'command'} input.trigger  what is asking
 * @param {Array} input.projects             the PROJECT_REGISTRY_DATA payload
 * @returns {{ show: boolean, dismissible: boolean }}
 */
function decide({ trigger, projects } = {}) {
  // Summoned on purpose, so it always shows, and it behaves like any other
  // overlay the user opened: × and Escape both close it.
  if (trigger === COMMAND) return { show: true, dismissible: true };

  // At boot the screen is the app's state rather than a dialog over it, so
  // Skip is the only way past it — hence dismissible: false on every path.
  //
  // Only an array we can count is an answer. A missing or malformed payload
  // means the renderer does not know how many projects there are, and showing
  // a first-run screen to someone who already has projects is the worse of
  // the two failures — so unknown is not treated as empty.
  if (!Array.isArray(projects)) return { show: false, dismissible: false };

  return { show: projects.length === 0, dismissible: false };
}

module.exports = { decide, LAUNCH, COMMAND };
