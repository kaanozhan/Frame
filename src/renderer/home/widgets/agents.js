/**
 * Agents widget.
 *
 * What is running, and how to start one more. Two jobs, and the second is
 * why the top bar can drop its tool `<select>`: the launcher lives here now,
 * where there is room for the choice next to the button (G8).
 *
 * Rows are `agentRows`' output — the filter and the attention order are
 * tested there, not here (C8). This module's job is drawing them and wiring
 * the clicks. Every action that can fail says so through `notify.error` (C7);
 * none of them touches `ipcRenderer` (D3, S6) — `homeData` owns the write.
 */

const { Bot, Play } = require('lucide');
const { escapeHtml } = require('./../../htmlUtils');
const notify = require('./../../notify');
const laneStatus = require('./../../laneStatus');
const homeData = require('./../homeData');
const { agentRows } = require('./../agentRows');
const { widgetShell, lucideIcon, MAX_ROWS } = require('./../widgetShell');

module.exports = {
  id: 'agents',
  title: 'Agents',
  icon: Bot,
  sources: ['lanes', 'aiTool'],
  defaultSpan: 1,
  defaultEnabled: true,

  isAvailable: () => true,

  mount(el, ctx) {
    this.ctx = ctx;
    this.card = widgetShell({
      id: 'agents',
      icon: Bot,
      title: 'Agents',
      // The header is not a doorway: there is no Agents surface to open, and
      // a chevron that leads to the Terminals section would be a lie.
      onOpen: null
    });

    // The launcher is the card's footer and is always there — an agent you
    // want to start is not something you only want when none is running.
    this.launcher = document.createElement('div');
    this.launcher.className = 'home-card-action home-agent-launcher';
    this.launcher.innerHTML = `
      <select class="ai-tool-select home-agent-tool" title="Default agent"></select>
      <button type="button" class="home-agent-start" title="Start the default agent">
        ${lucideIcon(Play, 11)}<span>Start</span>
      </button>
    `;
    this.card.el.appendChild(this.launcher);

    this.toolEl = this.launcher.querySelector('.home-agent-tool');
    this.toolEl.addEventListener('change', () => this._setTool(this.toolEl.value));

    const start = this.launcher.querySelector('.home-agent-start');
    // startDefaultAgent already routes every failure it can hit to
    // notify.error; this catches the ones it cannot reach.
    start.addEventListener('click', () => {
      Promise.resolve()
        .then(() => require('./../../agentDispatch').startDefaultAgent())
        .catch(err => notify.error(`Could not start the agent: ${err.message || 'launch failed'}`));
    });
    // The same right-click affordance the old New-terminal tile had: pick the
    // shell the agent will run in.
    start.addEventListener('contextmenu', (e) => {
      if (!ctx.showShellMenu) return;
      e.preventDefault();
      ctx.showShellMenu(e.clientX, e.clientY);
    });

    el.appendChild(this.card.el);
  },

  update({ lanes, aiTool }) {
    const card = this.card;
    if (!card) return;

    this._renderTool(aiTool);

    const rows = agentRows(lanes);
    card.count.textContent = String(rows.length);

    if (rows.length === 0) {
      card.body.innerHTML = `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">No agents running.</p>
          <p>An agent is an AI session in a terminal. Frame watches each one and
             tells you here when it finishes, needs input, or asks to run
             something.</p>
          <p class="home-card-onboard-how">Pick a tool below and press Start.</p>
        </div>
      `;
      return;
    }

    // Approval first, then input, then working — the order agentRows fixed.
    // The mark and the label come from laneStatus so that Home and the rails
    // describe the same state in the same words.
    card.body.innerHTML = rows.slice(0, MAX_ROWS).map((r) => {
      const mark = laneStatus.attentionMark(r.status);
      const label = laneStatus.statusLabel(r.status, { agentName: r.agentName, short: true });
      const when = laneStatus.formatRelativeTime(r.lastActivityAt);
      return `
        <button type="button" class="home-card-row ${r.status}" data-id="${escapeHtml(r.id)}"
                title="${escapeHtml(label)}">
          <span class="home-card-row-name">
            <span class="lane-status-dot ${r.status}"></span>${escapeHtml(r.name)}
          </span>
          ${mark ? `<span class="home-card-row-mark">${mark}</span>` : ''}
          <span class="home-card-row-meta">${escapeHtml(label)}${when ? ` · ${escapeHtml(when)}` : ''}</span>
        </button>
      `;
    }).join('') + (rows.length > MAX_ROWS
      ? `<div class="home-card-more">+${rows.length - MAX_ROWS} more</div>`
      : '');

    // A row is the way into the lane it names — the whole reason to list it.
    card.body.querySelectorAll('.home-card-row').forEach((row) => {
      row.addEventListener('click', () => this.ctx.enterLane(row.dataset.id));
    });
  },

  /** The options and the selection, from homeData's `aiTool` source. */
  _renderTool(aiTool) {
    const available = (aiTool && aiTool.available) || {};
    const current = aiTool && aiTool.current;
    const ids = Object.keys(available);

    // Rebuilding the options on every tick would fight the open dropdown.
    if (ids.join(',') !== this._toolIds) {
      this._toolIds = ids.join(',');
      this.toolEl.innerHTML = ids.map(id => {
        const name = String(available[id].name || id).replace(' Code', '').replace(' CLI', '');
        return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
      }).join('');
    }

    if (current && this.toolEl.value !== current.id) this.toolEl.value = current.id;
    this._toolId = current ? current.id : null;
  },

  _setTool(toolId) {
    homeData.setAiTool(toolId)
      .then((ok) => {
        if (ok !== false) return;
        // Nothing changed, so the select must not claim otherwise.
        if (this._toolId) this.toolEl.value = this._toolId;
        notify.error('Could not switch the default agent');
      })
      .catch((err) => {
        if (this._toolId) this.toolEl.value = this._toolId;
        notify.error(`Could not switch the default agent: ${err.message || 'the change was rejected'}`);
      });
  },

  dispose() {
    this.card = null;
    this.launcher = null;
    this.toolEl = null;
    this._toolIds = null;
    this.ctx = null;
  }
};
