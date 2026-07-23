/**
 * Implement Mode Modal
 *
 * The single door the implement button opens: pick a mode, and — only when
 * the spec already has a live lane — pick where it runs. It absorbs the old
 * `_askContinueOrNew` dialog so two stacked modals never appear; the ordering
 * flip (modal → record implement_mode → stage → dispatch) lives in the caller
 * (agentDispatch.dispatchSpecCommand).
 *
 * Built the same way as agentDispatch's own overlays — a dynamically created
 * `spec-modal-overlay`, resolved through a Promise — rather than the
 * pre-baked-HTML pattern of taskConfirmModal, because it must render four
 * mode entries and a conditional destination section that react to each
 * other. No pre-existing markup in index.html to keep in sync.
 *
 * Result contract:
 *   { mode: 'step-by-step'|'guided'|'autonomous'|'custom',
 *     destination: 'continue'|'new' }   on confirm
 *   null                                 on Escape / backdrop / Cancel
 *     (the caller writes nothing and dispatches nothing on null)
 */

const { escapeHtml } = require('./htmlUtils');

// The four rungs of the mode ladder. Order is the display order; `id` is the
// persisted `implement_mode` value. Descriptions say what the user *gets*,
// not just what the mode is called.
const MODES = [
  {
    id: 'step-by-step',
    label: 'Step by step',
    desc: 'Implement one task, report what changed and why, then wait for your approval to commit and move on.'
  },
  {
    id: 'guided',
    label: 'Guided run',
    desc: 'Run every task in order with no check-ins between them — the CLI’s own permission prompts pace it — and build the live implementation report.'
  },
  {
    id: 'autonomous',
    label: 'Autonomous + report',
    desc: 'Run every task unattended, one commit each, refreshing the HTML report as each lands. Needs a session launched with the autonomous permission flags.'
  },
  {
    id: 'custom',
    label: 'Describe your own',
    desc: 'Tell the agent how to run this — commit cadence, whether to verify, whether to report — in its own session.'
  }
];

const VALID_MODES = new Set(MODES.map((m) => m.id));

const AUTONOMOUS_CONTINUE_REASON =
  'Autonomous needs a session launched with its permission flags, and this '
  + 'Frame wasn’t — continuing here couldn’t keep that mode. Open a new Frame instead.';

/**
 * Open the modal.
 *
 * @param {object} opts
 * @param {string}      opts.slug   - spec slug
 * @param {string}      [opts.title]- spec title (heading copy only)
 * @param {string|null} [opts.hint] - resolved implement hint; the matching
 *                                     mode is preselected
 * @param {object|null} [opts.lane] - getSpecLaneInfo(slug); the destination
 *                                     section shows only when its agent is
 *                                     live. `lane.launchedAutonomous` gates
 *                                     autonomous "Continue".
 * @returns {Promise<{mode:string, destination:'continue'|'new'}|null>}
 */
function open({ slug, title = null, hint = null, lane = null } = {}) {
  return new Promise((resolve) => {
    const laneAlive = !!(lane && lane.agentName);
    let mode = VALID_MODES.has(hint) ? hint : 'step-by-step';
    // Continue is the natural default for a live lane; a hidden section (no
    // live lane) always resolves to a new Frame.
    let destination = laneAlive ? 'continue' : 'new';

    const overlay = document.createElement('div');
    overlay.className = 'spec-modal-overlay';
    overlay.innerHTML = `
      <div class="spec-modal spec-implement-modal" role="dialog" aria-modal="true" aria-labelledby="impl-mode-title">
        <h3 id="impl-mode-title">How should this run?</h3>
        <p>Choose how <strong>${escapeHtml(title || slug)}</strong> implements its remaining tasks.</p>
        <div class="impl-mode-list" role="radiogroup" aria-label="Implement mode"></div>
        <div class="impl-dest-section"></div>
        <div class="spec-modal-actions">
          <button type="button" class="btn btn-secondary impl-cancel">Cancel</button>
          <button type="button" class="btn btn-primary impl-confirm">Start</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('.impl-mode-list');
    const destEl = overlay.querySelector('.impl-dest-section');

    // Autonomous "Continue" is impossible unless the live lane was itself
    // launched with the autonomous flags — otherwise every edit would stop on
    // a prompt, the precise thing the mode avoids.
    const autonomousContinueBlocked = () =>
      mode === 'autonomous' && laneAlive && !lane.launchedAutonomous;

    function renderModes() {
      listEl.innerHTML = MODES.map((m) => `
        <button type="button" class="impl-mode-option${m.id === mode ? ' selected' : ''}"
                role="radio" aria-checked="${m.id === mode ? 'true' : 'false'}" data-mode="${m.id}">
          <span class="impl-mode-name">${escapeHtml(m.label)}</span>
          <span class="impl-mode-desc">${escapeHtml(m.desc)}</span>
        </button>`).join('');
      listEl.querySelectorAll('.impl-mode-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode;
          renderModes();
          renderDest();
        });
      });
    }

    function renderDest() {
      if (!laneAlive) {
        destEl.innerHTML = '';
        destination = 'new';
        return;
      }
      const blocked = autonomousContinueBlocked();
      // A blocked autonomous choice forces a new Frame; any other switch that
      // left destination undefined falls back to Continue.
      if (blocked) destination = 'new';
      else if (destination !== 'continue' && destination !== 'new') destination = 'continue';

      const frameName = escapeHtml(lane.name || 'this Frame');
      destEl.innerHTML = `
        <div class="impl-dest-label">Where should it run?</div>
        <div class="impl-dest-options">
          <button type="button"
                  class="impl-dest-option${destination === 'continue' ? ' selected' : ''}${blocked ? ' disabled' : ''}"
                  data-dest="continue" ${blocked ? 'disabled aria-disabled="true"' : ''}>
            <span class="impl-dest-name">Continue in ${frameName}</span>
            ${blocked ? `<span class="impl-dest-reason">${escapeHtml(AUTONOMOUS_CONTINUE_REASON)}</span>` : ''}
          </button>
          <button type="button" class="impl-dest-option${destination === 'new' ? ' selected' : ''}" data-dest="new">
            <span class="impl-dest-name">Open a new Frame</span>
          </button>
        </div>`;
      destEl.querySelectorAll('.impl-dest-option').forEach((btn) => {
        if (btn.disabled) return;
        btn.addEventListener('click', () => {
          destination = btn.dataset.dest;
          renderDest();
        });
      });
    }

    const done = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    // Capture phase so Escape beats any surface-level Esc handler, matching
    // taskConfirmModal's contract.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };

    overlay.querySelector('.impl-cancel').addEventListener('click', () => done(null));
    overlay.querySelector('.impl-confirm').addEventListener('click', () => {
      done({ mode, destination: laneAlive ? destination : 'new' });
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener('keydown', onKey, true);

    renderModes();
    renderDest();
    requestAnimationFrame(() => {
      const confirm = overlay.querySelector('.impl-confirm');
      if (confirm) confirm.focus();
    });
  });
}

module.exports = { open };
