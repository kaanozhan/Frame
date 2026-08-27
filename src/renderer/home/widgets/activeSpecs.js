/**
 * Active Specs widget.
 *
 * Carried over from `LaneBoard._buildSpecsCard` / `_updateSpecsCard` with its
 * rendering unchanged (G3, S4): what phase the active specs are in, how much
 * is already behind you, and a row per spec that opens it. The card is a
 * summary and an entry point — the specs dashboard is the full surface.
 *
 * One instance per board, which is one per renderer (C2), so the card's DOM
 * refs live on the widget object; `dispose()` drops them.
 */

const { FileText, ArrowRight } = require('lucide');
const { escapeHtml } = require('./../../htmlUtils');
const { widgetShell, statsHtml, moreHtml, MAX_ROWS } = require('./../widgetShell');

const SPEC_PHASE_ORDER = ['implementing', 'tasks_generated', 'planned', 'specified', 'draft', 'done'];

module.exports = {
  id: 'specs',
  title: 'Active Specs',
  icon: FileText,
  sources: ['specs'],
  defaultSpan: 1,
  defaultEnabled: true,

  isAvailable: () => true,

  mount(el) {
    this.card = widgetShell({
      id: 'specs',
      icon: FileText,
      title: 'Active Specs',
      actionLabel: 'Open specs',
      actionIcon: ArrowRight,
      onOpen: () => require('./../../specsDashboard').show(),
      onAction: () => require('./../../specsDashboard').show()
    });
    el.appendChild(this.card.el);
  },

  update({ specs }) {
    const card = this.card;
    if (!card) return;

    // The `!malformed` filter already happened in homeData's specs source
    // (C3) — a spec whose folder cannot be read never reaches a widget.
    const active = (specs || [])
      .filter(s => s.phase !== 'done')
      .sort((a, b) => SPEC_PHASE_ORDER.indexOf(a.phase) - SPEC_PHASE_ORDER.indexOf(b.phase));

    const done = (specs || []).filter(s => s.phase === 'done').length;

    card.count.textContent = String(active.length);
    if (active.length === 0) {
      // Nothing to summarise means the card has a better job: saying what a
      // spec is for, to someone who has not written one yet.
      card.body.innerHTML = `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">No specs yet.</p>
          <p>A spec is what you're building and why. Frame turns it into a plan,
             then a task list, and keeps both in the repo so the next session
             starts where this one stopped.</p>
          <p class="home-card-onboard-how">Open specs below to write your first one.</p>
        </div>
      `;
      return;
    }

    // What phase the active ones are in, and how much is already behind you.
    const byPhase = SPEC_PHASE_ORDER
      .filter(ph => ph !== 'done')
      .map(ph => [active.filter(s => s.phase === ph).length, String(ph).replace('_', ' ')])
      .filter(([n]) => n > 0);
    if (done > 0) byPhase.push([done, 'done']);

    const dispatch = require('./../../agentDispatch');
    card.body.innerHTML = statsHtml(byPhase) + active.slice(0, MAX_ROWS).map(s => `
      <button type="button" class="home-card-row" data-slug="${escapeHtml(s.slug)}">
        <span class="home-card-row-name">${dispatch.specStatusDotHtml(s.slug)}${escapeHtml(s.title || s.slug)}</span>
        <span class="spec-phase-badge phase-${escapeHtml(s.phase)}">${escapeHtml(String(s.phase).replace('_', ' '))}</span>
      </button>
    `).join('') + moreHtml(active.length - MAX_ROWS);

    card.body.querySelectorAll('.home-card-row').forEach((row) => {
      row.addEventListener('click', () => require('./../../specSection').openInNewTab(row.dataset.slug));
    });
  },

  dispose() {
    this.card = null;
  }
};
