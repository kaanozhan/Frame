/**
 * Last Sessions widget.
 *
 * The three most recent Claude transcripts for this project, each one click
 * from being resumed. Home's answer to "where was I" — the sessions panel is
 * still the full list.
 *
 * Claude-only, on purpose. Transcripts are a Claude Code format, so under a
 * different default tool this widget is not mounted at all rather than shown
 * empty (D6). The user asked for no "Claude" chip on the rows for now —
 * recorded in PROJECT_NOTES, with Codex to follow.
 *
 * Resume goes through `agentDispatch.resumeClaudeSession` and nowhere else:
 * it validates the id before it reaches a command line and opens its own
 * terminal rather than typing into a focused one — the failure
 * `sessions-from-transcripts` fixed (C4). Failures speak through
 * `notify.error` (C7).
 */

const { History, RotateCcw, GitBranch } = require('lucide');
const { escapeHtml } = require('./../../htmlUtils');
const notify = require('./../../notify');
const homeData = require('./../homeData');
const { sessionRows } = require('./../sessionRows');
const { widgetShell, lucideIcon } = require('./../widgetShell');

module.exports = {
  id: 'sessions',
  title: 'Last Sessions',
  icon: History,
  sources: ['sessions'],
  defaultSpan: 1,
  defaultEnabled: true,

  /**
   * Not mounted under a non-Claude default tool. When the config has not
   * arrived yet the widget is shown: a Home that hides a card while it waits
   * for IPC is worse than one that shows a card the next visit removes.
   */
  isAvailable() {
    const tool = homeData.get('aiTool');
    const current = tool && tool.current;
    return !current || current.id === 'claude';
  },

  mount(el, ctx) {
    this.ctx = ctx;
    this.card = widgetShell({
      id: 'sessions',
      icon: History,
      title: 'Last Sessions',
      actionLabel: 'All sessions',
      actionIcon: RotateCcw,
      onOpen: () => this._openPanel(),
      onAction: () => this._openPanel()
    });
    el.appendChild(this.card.el);
  },

  update({ sessions }) {
    const card = this.card;
    if (!card) return;

    const rows = sessionRows(sessions);
    card.count.textContent = String(rows.length);

    if (rows.length === 0) {
      card.body.innerHTML = `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">No sessions yet.</p>
          <p>Every Claude Code conversation in this project is recorded as a
             transcript. Once you have one, the last three land here and a click
             picks up where you stopped.</p>
        </div>
      `;
      return;
    }

    card.body.innerHTML = rows.map(r => `
      <button type="button" class="home-card-row session-row" data-session-id="${escapeHtml(r.id)}"
              title="Resume this session in a new terminal">
        <span class="home-card-row-name">${escapeHtml(r.title)}</span>
        <span class="home-card-row-meta">
          ${escapeHtml(r.relative)} · ${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}
          ${r.branch ? `<span class="home-session-branch">${lucideIcon(GitBranch, 10)}${escapeHtml(r.branch)}</span>` : ''}
        </span>
      </button>
    `).join('');

    card.body.querySelectorAll('.session-row').forEach((row) => {
      row.addEventListener('click', () => this._resume(row.dataset.sessionId));
    });
  },

  /**
   * `resumeClaudeSession` reports the failures it knows about — no project,
   * a malformed id, no terminal to be had. The catch is for the ones it
   * cannot, so a click never dies in silence (C7).
   */
  _resume(sessionId) {
    Promise.resolve()
      .then(() => require('./../../agentDispatch').resumeClaudeSession(sessionId))
      .catch(err => notify.error(`Could not resume that session: ${err.message || 'resume failed'}`));
  },

  /**
   * The panel is the full list, and this lands on it exactly where the left
   * menu's Claude entry plus a click on the Sessions tab would: the panel
   * mounted as the centre view (`showPanel`, not `togglePanel` — an action
   * labelled "All sessions" must never close them), then the Sessions tab
   * selected.
   *
   * The tab is only switched when it is not already Sessions. `showPanel`
   * runs the panel's own `show()`, which reloads whichever tab is current,
   * so switching unconditionally would load the same transcripts twice.
   */
  _openPanel() {
    try {
      const ui = require('./../../terminal').getMultiTerminalUI();
      if (!ui) {
        notify.error('Terminal system is not ready yet');
        return;
      }
      const panel = require('./../../pluginsPanel');
      ui.showPanel('claude');
      if (panel.getTab() !== 'sessions') panel.setTab('sessions');
    } catch (err) {
      notify.error(`Could not open the sessions panel: ${err.message || 'the panel did not open'}`);
    }
  },

  dispose() {
    this.card = null;
    this.ctx = null;
  }
};
