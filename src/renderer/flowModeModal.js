/**
 * Flow Mode Modal (full-auto-spec-flow)
 *
 * The door Generate Plan and Resume Full Auto… open: run the rest of the spec
 * step by step (today's flow, one phase per click) or in full auto (plan,
 * tasks and implement in one new session launched with the autonomous
 * permission flags).
 *
 * Same idiom as implementModeModal — a dynamically created
 * `spec-modal-overlay` resolved through a Promise, reusing its option classes.
 * Like that modal it also asks where a step-by-step run goes when the spec's
 * lane is alive, so two stacked dialogs never appear. Full auto always opens a
 * new terminal: a running session cannot gain the permission flags.
 *
 * Result contract:
 *   { flow: 'step-by-step'|'full-auto', destination: 'continue'|'new' }  on confirm
 *   null                                                                  on Escape / backdrop / Cancel
 *     (the caller writes nothing and dispatches nothing on null)
 */

const { escapeHtml } = require('./htmlUtils');
const { FLOW_STEP_BY_STEP, FLOW_FULL_AUTO } = require('../shared/specFlow');

const FLOWS = [
  {
    id: FLOW_STEP_BY_STEP,
    label: 'Step by step',
    desc: 'Generate the plan now; you start tasks and implementation yourself when you are ready, one phase at a time.'
  },
  {
    id: FLOW_FULL_AUTO,
    label: 'Full auto',
    desc: 'Plan, tasks and implementation run to the end in one new session with the autonomous permission flags — no questions, one commit per task, reports at the end.'
  }
];

const FULL_AUTO_NEW_REASON =
  'Full auto needs a session launched with its permission flags, so it always opens a new terminal.';

/**
 * Open the modal.
 *
 * @param {object} opts
 * @param {string}      opts.slug     - spec slug
 * @param {string}      [opts.title]  - spec title (heading copy only)
 * @param {string|null} [opts.current]- the spec's recorded flow_mode; preselected
 * @param {object|null} [opts.lane]   - getSpecLaneInfo(slug); the destination
 *                                       section shows only when its agent is live
 * @param {boolean}     [opts.resume] - opened from Resume Full Auto… (copy only)
 * @returns {Promise<{flow:string, destination:'continue'|'new'}|null>}
 */
function open({ slug, title = null, current = null, lane = null, resume = false } = {}) {
  return new Promise((resolve) => {
    const laneAlive = !!(lane && lane.agentName);
    let flow = current === FLOW_FULL_AUTO ? FLOW_FULL_AUTO : FLOW_STEP_BY_STEP;
    let destination = laneAlive ? 'continue' : 'new';

    const overlay = document.createElement('div');
    overlay.className = 'spec-modal-overlay';
    overlay.innerHTML = `
      <div class="spec-modal" role="dialog" aria-modal="true" aria-labelledby="flow-mode-title">
        <h3 id="flow-mode-title">${resume ? 'Continue this spec' : 'How should the rest run?'}</h3>
        <p>Choose how <strong>${escapeHtml(title || slug)}</strong> goes on from here.</p>
        <div class="impl-mode-list" role="radiogroup" aria-label="Flow mode"></div>
        <div class="impl-dest-section"></div>
        <div class="spec-modal-actions">
          <button type="button" class="btn btn-secondary flow-cancel">Cancel</button>
          <button type="button" class="btn btn-primary flow-confirm">Start</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('.impl-mode-list');
    const destEl = overlay.querySelector('.impl-dest-section');

    function renderFlows() {
      listEl.innerHTML = FLOWS.map((f) => `
        <button type="button" class="impl-mode-option${f.id === flow ? ' selected' : ''}"
                role="radio" aria-checked="${f.id === flow ? 'true' : 'false'}" data-flow="${f.id}">
          <span class="impl-mode-name">${escapeHtml(f.label)}</span>
          <span class="impl-mode-desc">${escapeHtml(f.desc)}</span>
        </button>`).join('');
      listEl.querySelectorAll('.impl-mode-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          flow = btn.dataset.flow;
          renderFlows();
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
      const blocked = flow === FLOW_FULL_AUTO;
      if (blocked) destination = 'new';
      const frameName = escapeHtml(lane.name || 'this Frame');
      destEl.innerHTML = `
        <div class="impl-dest-label">Where should it run?</div>
        <div class="impl-dest-options">
          <button type="button"
                  class="impl-dest-option${destination === 'continue' ? ' selected' : ''}${blocked ? ' disabled' : ''}"
                  data-dest="continue" ${blocked ? 'disabled aria-disabled="true"' : ''}>
            <span class="impl-dest-name">Continue in ${frameName}</span>
            ${blocked ? `<span class="impl-dest-reason">${escapeHtml(FULL_AUTO_NEW_REASON)}</span>` : ''}
          </button>
          <button type="button" class="impl-dest-option${destination === 'new' ? ' selected' : ''}" data-dest="new">
            <span class="impl-dest-name">Open a new terminal</span>
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
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };

    overlay.querySelector('.flow-cancel').addEventListener('click', () => done(null));
    overlay.querySelector('.flow-confirm').addEventListener('click', () => {
      done({ flow, destination: laneAlive && flow !== FLOW_FULL_AUTO ? destination : 'new' });
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener('keydown', onKey, true);

    renderFlows();
    renderDest();
    requestAnimationFrame(() => {
      const confirm = overlay.querySelector('.flow-confirm');
      if (confirm) confirm.focus();
    });
  });
}

module.exports = { open };
