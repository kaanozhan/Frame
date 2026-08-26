/**
 * Terminals View Module
 *
 * The project's default center view, in two bodies. The grid is every
 * terminal of the project as a live pane at once — 1/2/3 columns, headers
 * dragged to reorder. A pane's ⤢ enlarges that one terminal to fill the
 * section; the way back out is the top bar's Terminals chip, which is always
 * there — an enlarged pane carries no shrink control of its own.
 *
 * The navigation is *not* here. Every live terminal of the project is a chip
 * in the top bar beside Terminals itself (terminalTabBar), whether it has
 * ever been enlarged or not: Terminals is the grid, a chip is that terminal
 * enlarged — the two bodies this module draws. Which one is showing lives in
 * the per-project prefs ({cols, order, shownTerminal}) in localStorage, so
 * switching project keeps each project's place; ids do not survive a
 * restart, so a fresh launch opens the grid.
 *
 * One rule the layer cannot break (C1): mountTerminal *moves* the DOM element
 * rather than copying it, so the body being drawn must mount its terminals
 * every single render. "It was already mounted" is never true across an
 * grid↔enlarged switch, and assuming it silently empties the pane.
 *
 * Naming rule (terminals-view spec): code says "lane"/"tv", user-facing
 * strings say "terminal".
 */

const laneStatus = require('./laneStatus');
const { statusLabel, attentionMark, assignmentIcon, assignmentText } = laneStatus;
const otherTerminalsRail = require('./otherTerminalsRail');
const { escapeHtml } = require('./htmlUtils');
const { Plus, Maximize2, Pencil, X } = require('lucide');

const PREFS_KEY = 'frame-terminals-view';
const GLOBAL_PROJECT_KEY = '__global__';

// The one definition of what "no terminals" says. Home's Terminals card
// draws the same words in a single line; the same sentence written twice and
// drifting apart is exactly the duplication this spec set out to remove.
// The orchestrator labels its conductor lane with a sentinel ref rather than
// a real slug (orchestrator.js) — that assignment is a name, not a
// destination. A chip like it stays a label instead of leading nowhere.
const NON_NAVIGABLE_REFS = new Set(['__conductor__']);

const EMPTY_TITLE = 'No terminals yet';
const EMPTY_HINT = 'A terminal is where you run your shell or an AI session.';

function lucideIcon(data, size = 13) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrs ? attrStr : ''}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

function _loadAllPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function _saveProjectPrefs(projectKey, prefs) {
  try {
    const all = _loadAllPrefs();
    all[projectKey] = prefs;
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch (err) {
    console.error('Failed to save terminals view prefs:', err);
  }
}

class TerminalsView {
  /**
   * @param {TerminalManager} manager
   * @param {Object} callbacks
   * @param {Function} callbacks.onNewTerminal - create a terminal (cap feedback included)
   * @param {Function} callbacks.onEnterLane - (terminalId) => go to that terminal
   */
  constructor(manager, callbacks = {}) {
    this.manager = manager;
    this.callbacks = callbacks;
    this.container = null;
    this._dragId = null;
    this._resizeObserver = null;
    this._fitTimers = new Map();

    // Keep pane-header status dots and agent labels live without remounting
    laneStatus.onChange((terminalId) => {
      if (!this.container || !this.container.isConnected) return;
      const pane = this.container.querySelector(`.tv-pane[data-terminal-id="${terminalId}"]`);
      if (!pane) return;
      const { status, agentName, foreground, commandLine } = laneStatus.getStatus(terminalId);
      const dot = pane.querySelector('.lane-status-dot');
      if (dot) dot.className = `lane-status-dot ${status}`;

      const mark = attentionMark(status);
      const attention = pane.querySelector('.tv-pane-attention');
      if (attention) {
        attention.className = `tv-pane-attention ${status}`;
        attention.textContent = mark || '';
        attention.setAttribute('aria-hidden', String(!mark));
      }

      const label = pane.querySelector('.tv-pane-status');
      if (label) {
        label.className = `tv-pane-status ${status}`;
        label.textContent = statusLabel(status, { agentName, foreground, commandLine, short: true });
        label.title = commandLine || '';
      }
    });
  }

  // ─── Preferences ────────────────────────────────────────

  _projectKey() {
    return this.manager.getCurrentProject() || GLOBAL_PROJECT_KEY;
  }

  _prefs() {
    const stored = _loadAllPrefs()[this._projectKey()] || {};
    return {
      cols: [1, 2, 3].includes(stored.cols) ? stored.cols : 2,
      order: Array.isArray(stored.order) ? stored.order : [],
      // Chips the user dropped from the top bar. Stored as what is *hidden*
      // rather than what is shown, so a terminal created later is in the bar
      // by default — the bar is the project's terminals, minus the ones the
      // user took out of the way.
      hiddenFromBar: Array.isArray(stored.hiddenFromBar) ? stored.hiddenFromBar : [],
      shownTerminal: stored.shownTerminal || null
    };
  }

  _updatePrefs(patch) {
    const next = { ...this._prefs(), ...patch };
    _saveProjectPrefs(this._projectKey(), next);
    return next;
  }

  /**
   * Saved order normalized against the open terminals: dead ids dropped,
   * new terminals appended in creation order (prototype's cfg normalization).
   */
  _orderedTerminals(prefs) {
    const terminals = this.manager.getTerminalStates();
    const byId = new Map(terminals.map(t => [t.id, t]));
    const ordered = prefs.order.filter(id => byId.has(id)).map(id => byId.get(id));
    const missing = terminals.filter(t => !prefs.order.includes(t.id));
    return ordered.concat(missing);
  }

  /**
   * What the top bar's breadcrumb draws: the grid's terminals in the grid's
   * own order — so dragging a pane moves its chip too — minus the chips the
   * user dropped. The grid is unaffected: a dropped chip is out of the way,
   * not out of the project.
   */
  barTerminals() {
    const prefs = this._prefs();
    const hidden = new Set(prefs.hiddenFromBar);
    return this._orderedTerminals(prefs).filter(t => !hidden.has(t.id));
  }

  /**
   * Drop a terminal's chip from the top bar. The terminal is untouched; only
   * the breadcrumb forgets it, until something takes the user back to it.
   */
  hideFromBar(terminalId) {
    const prefs = this._prefs();
    if (prefs.hiddenFromBar.includes(terminalId)) return;
    this._updatePrefs({ hiddenFromBar: [...prefs.hiddenFromBar, terminalId] });
  }

  // ─── Render ─────────────────────────────────────────────

  render(container) {
    this.container = container;
    this._disconnectObserver();
    container.innerHTML = '';

    const terminals = this._orderedTerminals(this._prefs());
    // Persist the normalized order so drag indices stay stable
    let prefs = this._updatePrefs({ order: terminals.map(t => t.id) });
    prefs = this._normalizeShown(prefs, terminals);

    const view = document.createElement('div');
    view.className = 'terminals-view';
    container.appendChild(view);

    if (terminals.length === 0) {
      view.appendChild(this._buildEmptyState());
      return;
    }

    const shown = prefs.shownTerminal
      ? terminals.find(t => t.id === prefs.shownTerminal)
      : null;
    if (shown) {
      this._renderSingle(view, shown, prefs, terminals);
    } else {
      this._renderOverview(view, terminals, prefs);
    }
  }

  /**
   * Overview: today's grid, unchanged — 1/2/3 columns, drag to reorder, drag
   * the bottom edge to resize, the ghost pane at the end.
   */
  _renderOverview(view, terminals, prefs) {
    view.appendChild(this._buildLayoutBar(prefs));

    const grid = document.createElement('div');
    grid.className = 'tv-grid';
    grid.style.gridTemplateColumns = `repeat(${prefs.cols}, 1fr)`;
    view.appendChild(grid);

    terminals.forEach((t) => {
      const pane = this._buildPane(t, prefs);
      grid.appendChild(pane);
      this.manager.mountTerminal(t.id, pane.querySelector('.tv-pane-content'));
    });

    // Ghost pane: create in place
    if (terminals.length < this.manager.maxTerminals) {
      grid.appendChild(this._buildGhostPane());
    }

    this._observePanes(grid);
  }

  /**
   * The enlarged body: one terminal filling the section, with the Other
   * Terminals rail beside it. It mounts here every render — the element was
   * in a grid pane a moment ago (C1).
   */
  _renderSingle(view, state, prefs, terminals) {
    const body = document.createElement('div');
    body.className = 'tv-single';
    view.appendChild(body);

    const pane = this._buildPane(state, prefs, { single: true });
    body.appendChild(pane);
    this.manager.mountTerminal(state.id, pane.querySelector('.tv-pane-content'));

    // The rail only exists here: looking at one terminal is the only place
    // you cannot see the others. The grid never gets it.
    const railEl = document.createElement('div');
    body.appendChild(railEl);
    otherTerminalsRail.render(railEl, { terminals, currentId: state.id }, {
      onEnterLane: (id) => this._goToTerminal(id),
      onNewLane: () => this.callbacks.onNewTerminal && this.callbacks.onNewTerminal(),
      onLayoutChange: () => setTimeout(() => this.manager.fitTerminal(state.id), 60)
    });

    this._observePanes(body);
  }

  /**
   * Go to another terminal from inside the section. Routed through the host's
   * enterLane where there is one, so the single choke point stays single.
   */
  _goToTerminal(terminalId) {
    if (this.callbacks.onEnterLane) this.callbacks.onEnterLane(terminalId);
    else this.showTerminal(terminalId);
  }

  // ─── Which body is showing ──────────────────────────────

  /**
   * The prefs that name terminals, against the live set: a shown id that is
   * gone falls back to the grid, and dead ids drop out of the hidden list.
   * This is how a closed terminal (pane ×, Cmd+Shift+W, the process dying)
   * lets go of both — no listener, just the next render.
   */
  _normalizeShown(prefs, terminals) {
    const live = new Set(terminals.map(t => t.id));
    const patch = {};
    if (prefs.shownTerminal && !live.has(prefs.shownTerminal)) patch.shownTerminal = null;
    const hidden = prefs.hiddenFromBar.filter(id => live.has(id));
    if (hidden.length !== prefs.hiddenFromBar.length) patch.hiddenFromBar = hidden;
    return Object.keys(patch).length ? this._updatePrefs(patch) : prefs;
  }

  /**
   * Enlarge one terminal to fill the section. The pane's ⤢ and the top bar's
   * chip for that terminal both land here — one destination, so there is no
   * second "big" state to keep in sync.
   *
   * `render: false` writes the prefs and stops. enterLane uses it to choose
   * the body *before* switching the view mode, so the section is drawn once,
   * already showing this terminal, instead of drawing the grid and then
   * redrawing.
   */
  showTerminal(terminalId, { render = true } = {}) {
    // Going back to a terminal puts its chip back: you cannot be looking at
    // a terminal the breadcrumb refuses to name.
    this._updatePrefs({
      shownTerminal: terminalId,
      hiddenFromBar: this._prefs().hiddenFromBar.filter(id => id !== terminalId)
    });
    if (!render) return;
    this.manager.setActiveTerminal(terminalId);
    this._rerender();
  }

  /**
   * Back to the grid — what the top bar's Terminals chip resolves to.
   * `render: false` writes the pref and stops, for callers that are about to
   * switch into the section anyway (see showTerminal).
   */
  showOverview({ render = true } = {}) {
    if (this._prefs().shownTerminal === null) return;
    this._updatePrefs({ shownTerminal: null });
    if (render) this._rerender();
  }

  /** The enlarged terminal's id, or null while the grid is showing. */
  getShownTerminal() {
    return this._prefs().shownTerminal;
  }

  // ─── Pieces ─────────────────────────────────────────────

  _buildLayoutBar(prefs) {
    const bar = document.createElement('div');
    bar.className = 'tv-bar';
    bar.innerHTML = `
      <span class="tv-bar-label">LAYOUT</span>
      ${[1, 2, 3].map(n => `
        <button class="tv-bar-btn ${prefs.cols === n ? 'on' : ''}" data-cols="${n}" title="${n} column${n > 1 ? 's' : ''}">${'▮'.repeat(n)} ${n}</button>
      `).join('')}
      <span class="tv-bar-hint">drag header to reorder · bottom edge to resize · ⤢ to enlarge</span>
    `;

    bar.querySelectorAll('[data-cols]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._updatePrefs({ cols: Number(btn.dataset.cols) });
        this._rerender();
      });
    });
    return bar;
  }

  /**
   * The pane. `single` is the enlarged variant: it fills the section, so
   * there is nothing to reorder it against and it is already as big as it
   * gets — no drag and no ⤢. It carries no shrink control either: Terminals
   * lives in the top bar at all times and is the way back to the grid.
   *
   * What the enlarged variant *does* carry is the spec or task the terminal
   * is working on, as a chip at the right of the header. It belongs here and
   * not in the grid: the grid's panes are narrow and already say what they
   * are doing, while filling the screen with one terminal is exactly when
   * "what is this for, and where do I read about it" stops being answerable
   * from anything else on screen.
   */
  _buildPane(state, prefs, { single = false } = {}) {
    const { status, agentName, foreground, commandLine } = laneStatus.getStatus(state.id);
    const mark = attentionMark(status);
    const assignment = single ? state.assignment : null;
    const pane = document.createElement('div');
    pane.className = `tv-pane ${state.isActive ? 'active' : ''} ${single ? 'tv-pane-single' : ''}`;
    pane.dataset.terminalId = state.id;

    pane.innerHTML = `
      <div class="tv-pane-header${assignment ? ' has-assign' : ''}" draggable="${!single}" title="${single ? '' : 'Drag to reorder'}">
        <span class="lane-status-dot ${status}"></span>
        <span class="tv-pane-name">${escapeHtml(state.customName || state.name)}</span>
        <span class="tv-pane-attention ${status}" aria-hidden="${!mark}">${mark || ''}</span>
        <span class="tv-pane-status ${status}" title="${escapeHtml(commandLine || '')}">${escapeHtml(statusLabel(status, { agentName, foreground, commandLine, short: true }))}</span>
        ${this._buildAssignmentChip(assignment, agentName)}
        <span class="tv-pane-actions">
          <button class="tv-pane-btn" data-rename title="Rename terminal">${lucideIcon(Pencil, 11)}</button>
          ${single ? '' : `<button class="tv-pane-btn" data-enlarge title="Enlarge this terminal">${lucideIcon(Maximize2, 12)}</button>`}
          <button class="tv-pane-btn" data-close title="Close terminal">${lucideIcon(X, 12)}</button>
        </span>
      </div>
      <div class="tv-pane-content"></div>
      <button class="btn-scroll-bottom-overlay btn-scroll-bottom-cell" title="Scroll to bottom">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    `;

    this._setupPaneEvents(pane, state.id, { single });
    return pane;
  }

  /**
   * The spec / task chip for the enlarged header. A chip that leads somewhere
   * is a button; one that does not — the orchestrator's conductor label — is
   * a span, so nothing offers a click that goes nowhere.
   */
  _buildAssignmentChip(assignment, agentName) {
    if (!assignment) return '';
    const canOpen = !!assignment.ref && !NON_NAVIGABLE_REFS.has(assignment.ref);
    const body = `${lucideIcon(assignmentIcon(assignment), 11)}<span class="lane-assignment-chip-label">${escapeHtml(assignmentText(assignment))}</span>`;
    const cls = `lane-assignment-chip tv-pane-assign${agentName ? '' : ' dimmed'}`;
    const label = escapeHtml(assignment.label || '');

    if (!canOpen) return `<span class="${cls}" title="${label}">${body}</span>`;
    return `
      <button type="button" class="${cls}"
              data-assign-kind="${escapeHtml(assignment.kind || '')}"
              data-assign-ref="${escapeHtml(assignment.ref)}"
              title="Open ${label}">${body}</button>
    `;
  }

  _buildGhostPane() {
    const ghost = document.createElement('div');
    ghost.className = 'tv-ghost';
    ghost.innerHTML = `${lucideIcon(Plus, 16)}<span>New terminal</span>`;
    ghost.addEventListener('click', () => {
      if (this.callbacks.onNewTerminal) this.callbacks.onNewTerminal();
    });
    return ghost;
  }

  _buildEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'tv-empty';
    empty.innerHTML = `
      <p class="tv-empty-title">${EMPTY_TITLE}</p>
      <p class="tv-empty-hint">${EMPTY_HINT}</p>
      <button class="tv-empty-cta">${lucideIcon(Plus, 14)}<span>Create your first terminal</span></button>
    `;
    empty.querySelector('.tv-empty-cta').addEventListener('click', () => {
      if (this.callbacks.onNewTerminal) this.callbacks.onNewTerminal();
    });
    return empty;
  }

  // ─── Events ─────────────────────────────────────────────

  _setupPaneEvents(pane, terminalId, { single = false } = {}) {
    // Click anywhere in the pane focuses that terminal
    pane.addEventListener('click', (e) => {
      if (e.target.closest('.tv-pane-btn') || e.target.closest('.lane-rename-input')
        || e.target.closest('.btn-scroll-bottom-overlay')) return;
      if (this.manager.activeTerminalId !== terminalId) {
        this.manager.setActiveTerminal(terminalId);
        this._updateActivePane(terminalId);
      }
      const instance = this.manager.getTerminal(terminalId);
      if (instance && instance.opened) instance.terminal.focus();
    });

    // ⤢ enlarges this terminal to fill the section — the same destination as
    // its chip in the top bar. It goes through the host where there is one:
    // switching bodies changes which chip up there is highlighted, and a
    // local re-render alone would leave the top bar pointing at the body
    // that just left the screen.
    pane.querySelector('[data-enlarge]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToTerminal(terminalId);
    });

    // The chip opens the spec or task this terminal is working on, reusing
    // that section's tab when one is already open — the same route Home's
    // tiles take. It sits inside the pane, and the pane means "focus this
    // terminal", so it has to stop there.
    pane.querySelector('button.tv-pane-assign')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const { assignKind, assignRef } = e.currentTarget.dataset;
      if (assignKind === 'spec') require('./specSection').open(assignRef);
      else require('./taskSection').open(assignRef);
    });

    pane.querySelector('[data-close]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.manager.closeTerminal(terminalId);
    });

    pane.querySelector('[data-rename]').addEventListener('click', (e) => {
      e.stopPropagation();
      this._startRename(pane, terminalId);
    });
    pane.querySelector('.tv-pane-name').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._startRename(pane, terminalId);
    });

    pane.querySelector('.btn-scroll-bottom-overlay').addEventListener('click', (e) => {
      e.stopPropagation();
      const instance = this.manager.getTerminal(terminalId);
      if (instance) instance.terminal.scrollToBottom();
    });

    // Drag-to-reorder (prototype behavior: drag header, drop on a pane).
    // The grid only — the enlarged body is one pane, with nothing to reorder.
    if (single) return;
    const header = pane.querySelector('.tv-pane-header');
    header.addEventListener('dragstart', (e) => {
      this._dragId = terminalId;
      pane.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', terminalId); } catch (_) {}
      e.dataTransfer.effectAllowed = 'move';
    });
    header.addEventListener('dragend', () => {
      pane.classList.remove('dragging');
      this._dragId = null;
    });
    pane.addEventListener('dragover', (e) => {
      if (!this._dragId || this._dragId === terminalId) return;
      e.preventDefault();
      pane.classList.add('dropover');
    });
    pane.addEventListener('dragleave', () => pane.classList.remove('dropover'));
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      pane.classList.remove('dropover');
      const from = this._dragId;
      this._dragId = null;
      if (!from || from === terminalId) return;
      const order = this._prefs().order.filter(id => id !== from);
      const at = order.indexOf(terminalId);
      order.splice(at >= 0 ? at : order.length, 0, from);
      this._updatePrefs({ order });
      this._rerender();
    });
  }

  /**
   * Inline rename in the pane header (same affordance as the board cards).
   * The header's drag is suspended while editing so text selection inside
   * the input doesn't start a pane drag. Committing an actual change goes
   * through manager.renameTerminal → state change → full re-render.
   */
  _startRename(pane, terminalId) {
    const nameSpan = pane.querySelector('.tv-pane-name');
    const header = pane.querySelector('.tv-pane-header');
    if (!nameSpan || pane.querySelector('.lane-rename-input')) return;
    const currentName = nameSpan.textContent;
    header.draggable = false;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lane-rename-input';
    input.value = currentName;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        this.manager.renameTerminal(terminalId, newName); // re-renders the view
        return;
      }
      const span = document.createElement('span');
      span.className = 'tv-pane-name';
      span.textContent = currentName;
      if (input.parentNode) input.replaceWith(span);
      span.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._startRename(pane, terminalId);
      });
      header.draggable = !pane.classList.contains('tv-pane-single');
    };

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  _updateActivePane(activeId) {
    if (!this.container) return;
    this.container.querySelectorAll('.tv-pane').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.terminalId === activeId);
    });
  }

  // ─── Sizing ─────────────────────────────────────────────

  /**
   * Panes are user-resizable (CSS resize) and reflow on column changes —
   * refit each pane's xterm when its box changes, debounced per terminal.
   */
  _observePanes(grid) {
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.closest('.tv-pane')?.dataset.terminalId;
        if (!id) continue;
        clearTimeout(this._fitTimers.get(id));
        this._fitTimers.set(id, setTimeout(() => this.manager.fitTerminal(id), 80));
      }
    });
    grid.querySelectorAll('.tv-pane-content').forEach(el => this._resizeObserver.observe(el));
  }

  _disconnectObserver() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._fitTimers.forEach(t => clearTimeout(t));
    this._fitTimers.clear();
  }

  _rerender() {
    if (this.container) this.render(this.container);
  }
}

module.exports = { TerminalsView, EMPTY_TITLE, EMPTY_HINT };
