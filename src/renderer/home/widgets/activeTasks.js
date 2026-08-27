/**
 * Active Tasks widget.
 *
 * Carried over from `LaneBoard._buildTasksCard` / `_updateTasksCard` /
 * `_wireTaskCard` with its rendering unchanged (G3, S4). The card answers
 * "what is being worked on right now", in three states:
 *
 *   - work in progress  → list it, one click hands any row to a terminal
 *   - none, but pending → say so plainly, then list what is queued
 *   - nothing at all    → say what a task is for
 *
 * Above all three, when a spec is holding tasks that nobody has implemented
 * yet, a warning: that work is real, it is just owned somewhere else, and it
 * is the thing most likely to be forgotten.
 */

const { CheckSquare, ArrowRight, Play, AlertTriangle } = require('lucide');
const { escapeHtml } = require('./../../htmlUtils');
const { widgetShell, lucideIcon, statsHtml, tally, moreHtml, MAX_ROWS } = require('./../widgetShell');

module.exports = {
  id: 'tasks',
  title: 'Active Tasks',
  icon: CheckSquare,
  sources: ['tasks'],
  defaultSpan: 1,
  defaultEnabled: true,

  isAvailable: () => true,

  mount(el) {
    this.card = widgetShell({
      id: 'tasks',
      icon: CheckSquare,
      title: 'Active Tasks',
      actionLabel: 'Open tasks',
      actionIcon: ArrowRight,
      onOpen: () => require('./../../tasksDashboard').show(),
      onAction: () => require('./../../tasksDashboard').show()
    });
    el.appendChild(this.card.el);
  },

  update({ tasks }) {
    const card = this.card;
    if (!card) return;
    this._tasks = tasks || [];

    const allOpen = this._tasks.filter(t => t.status === 'in_progress' || t.status === 'pending');
    // A spec's tasks are that spec's business — it tracks them, implements
    // them and closes them. Listing them here too would make one pile of work
    // look like two, and put a Run button next to something an implement run
    // already owns.
    const isSpecTask = (t) => String(t.source || '').startsWith('spec:');
    const specWaiting = allOpen.filter(t => isSpecTask(t) && t.status === 'pending');
    const specCount = new Set(specWaiting.map(t => String(t.source).split(':')[1])).size;

    const open = allOpen.filter(t => !isSpecTask(t));
    const active = open.filter(t => t.status === 'in_progress');
    const pending = open.filter(t => t.status === 'pending');

    card.count.textContent = String(active.length);

    const warning = specWaiting.length
      ? `<button type="button" class="home-card-warn">${lucideIcon(AlertTriangle, 12)}<span>${specWaiting.length} task${specWaiting.length === 1 ? '' : 's'} in ${specCount} spec${specCount === 1 ? '' : 's'} waiting to be implemented</span></button>`
      : '';

    // Nothing of our own in either state — the card explains itself instead.
    if (open.length === 0) {
      card.body.innerHTML = warning + (specWaiting.length ? `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">Nothing outside the specs.</p>
          <p>Every open task belongs to a spec, which tracks it through plan
             and implementation.</p>
        </div>
      ` : `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">Nothing pending.</p>
          <p>Tasks are the small units of work Frame tracks between sessions —
             written by hand, or generated from a spec's plan.</p>
          <p class="home-card-onboard-how">Open tasks below to add one.</p>
        </div>
      `);
      this._wire();
      return;
    }

    // What kind of work it is beats how urgent someone once said it was: a
    // fix and a feature are different jobs, "medium" and "medium" are not.
    const catOf = (t) => t.category || 'task';
    const rowHtml = (t) => `
      <div class="home-card-row task-row ${t.status === 'in_progress' ? 'running' : ''}" data-id="${escapeHtml(t.id)}">
        <span class="home-card-row-name">${escapeHtml(t.title || '')}</span>
        <span class="home-card-cat cat-${escapeHtml(catOf(t))}">${escapeHtml(catOf(t))}</span>
        <button type="button" class="home-card-run" data-run="${escapeHtml(t.id)}"
                title="Start this task in a terminal">${lucideIcon(Play, 11)}</button>
      </div>
    `;

    const byStatus = [[active.length, 'in progress'], [pending.length, 'pending']]
      .filter(([n]) => n > 0);

    if (active.length > 0) {
      // The active list is the card's job; the queue behind it is a number.
      card.body.innerHTML = warning
        + statsHtml(byStatus)
        + statsHtml(tally(active, catOf), 'subtle')
        + active.slice(0, MAX_ROWS).map(rowHtml).join('')
        + moreHtml(active.length - MAX_ROWS);
    } else {
      // Nothing running. Saying only that would waste the card, so the queue
      // takes over: what is waiting, and what kind of work it is.
      card.body.innerHTML = warning
        + statsHtml(byStatus)
        + statsHtml(tally(pending, catOf), 'subtle')
        + '<div class="home-card-note">No active tasks — next up:</div>'
        + pending.slice(0, MAX_ROWS).map(rowHtml).join('')
        + moreHtml(pending.length - MAX_ROWS);
    }

    this._wire();
  },

  /**
   * The row opens the task; the play button hands it to a terminal through
   * the same modal + dispatch every other surface runs tasks through; the
   * warning leads to the specs that own the work it names.
   */
  _wire() {
    const card = this.card;
    card.body.querySelectorAll('.task-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.home-card-run')) return;
        require('./../../taskSection').openInNewTab(row.dataset.id);
      });
    });
    card.body.querySelectorAll('.home-card-run').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = this._tasks.find(t => t.id === btn.dataset.run);
        if (task) require('./../../tasksPanel').openRunFlow(task);
      });
    });
    const warn = card.body.querySelector('.home-card-warn');
    if (warn) warn.addEventListener('click', () => require('./../../specsDashboard').show());
  },

  dispose() {
    this.card = null;
    this._tasks = [];
  }
};
