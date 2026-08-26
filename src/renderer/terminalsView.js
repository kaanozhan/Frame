/**
 * Terminals View Module
 *
 * The project's default center view. Its first row is a tab strip:
 * `[Overview] [Terminal N] …`. Overview is leftmost, always there and never
 * closable, and holds the terminals-view grid — every terminal of the project
 * as a live pane at once, 1/2/3 columns, headers dragged to reorder. Any other
 * tab is one terminal on its own, no cells and no layout choice.
 *
 * The tab strip is navigation among what you opened; closing a tab drops the
 * tab, never the terminal. Tabs live in the per-project prefs
 * ({cols, order, openTabs, activeTab}) in localStorage, so
 * switching project keeps each project's strip; ids do not survive a restart,
 * so a fresh launch opens Overview.
 *
 * One rule the layer cannot break (C1): mountTerminal *moves* the DOM element
 * rather than copying it, so the body being drawn must mount its terminals
 * every single render. "It was already mounted" is never true across an
 * Overview↔tab switch, and assuming it silently empties the pane.
 *
 * Naming rule (terminals-view spec): code says "lane"/"tv", user-facing
 * strings say "terminal".
 */

const laneStatus = require('./laneStatus');
const { statusLabel, attentionMark } = laneStatus;
const otherTerminalsRail = require('./otherTerminalsRail');
const { escapeHtml } = require('./htmlUtils');
const { Plus, Search, Pencil, X } = require('lucide');

const PREFS_KEY = 'frame-terminals-view';
const GLOBAL_PROJECT_KEY = '__global__';

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

    // The strip's dots are the same signal one level up — a tabbed terminal
    // is often the one you are not looking at.
    laneStatus.onChange((terminalId) => {
      if (!this.container || !this.container.isConnected) return;
      const tab = this.container.querySelector(`.tv-tab[data-terminal-id="${terminalId}"]`);
      if (!tab) return;
      const dot = tab.querySelector('.lane-status-dot');
      if (dot) dot.className = `lane-status-dot ${laneStatus.getStatus(terminalId).status}`;
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
      openTabs: Array.isArray(stored.openTabs) ? stored.openTabs : [],
      activeTab: stored.activeTab || null
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

  // ─── Render ─────────────────────────────────────────────

  render(container) {
    this.container = container;
    this._disconnectObserver();
    container.innerHTML = '';

    const terminals = this._orderedTerminals(this._prefs());
    // Persist the normalized order so drag indices stay stable
    let prefs = this._updatePrefs({ order: terminals.map(t => t.id) });
    prefs = this._normalizeTabs(prefs, terminals);

    const view = document.createElement('div');
    view.className = 'terminals-view';
    container.appendChild(view);

    if (terminals.length === 0) {
      view.appendChild(this._buildEmptyState());
      return;
    }

    view.appendChild(this._buildTabStrip(prefs, terminals));

    const active = prefs.activeTab
      ? terminals.find(t => t.id === prefs.activeTab)
      : null;
    if (active) {
      this._renderSingle(view, active, prefs, terminals);
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
   * A tab's body: one terminal, filling the section, with the Other Terminals
   * rail beside it. It mounts here every render — the element was in an
   * Overview pane a moment ago (C1).
   */
  _renderSingle(view, state, prefs, terminals) {
    const body = document.createElement('div');
    body.className = 'tv-single';
    view.appendChild(body);

    const pane = this._buildPane(state, prefs, { single: true });
    body.appendChild(pane);
    this.manager.mountTerminal(state.id, pane.querySelector('.tv-pane-content'));

    // The rail only exists here: looking at one terminal is the only place
    // you cannot see the others. Overview never gets it.
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
    else this.openTab(terminalId);
  }

  // ─── Tabs ───────────────────────────────────────────────

  /**
   * Tabs against the live terminals: a dead id drops its tab, and an active
   * tab that is gone falls back to Overview. This is how a closed terminal
   * (pane ×, Cmd+Shift+W, the process dying) loses its tab — no listener,
   * just the next render.
   */
  _normalizeTabs(prefs, terminals) {
    const live = new Set(terminals.map(t => t.id));
    const openTabs = prefs.openTabs.filter(id => live.has(id));
    const activeTab = openTabs.includes(prefs.activeTab) ? prefs.activeTab : null;
    if (openTabs.length === prefs.openTabs.length && activeTab === prefs.activeTab) {
      return prefs;
    }
    return this._updatePrefs({ openTabs, activeTab });
  }

  /**
   * Open a terminal in its own tab, or switch to it when the tab is already
   * there — never a second tab for one terminal.
   *
   * `render: false` writes the prefs and stops. enterLane uses it to set the
   * tab *before* switching the view mode, so the section is drawn once,
   * already showing this terminal, instead of drawing Overview and then
   * redrawing on the tab.
   */
  openTab(terminalId, { render = true } = {}) {
    const prefs = this._prefs();
    const openTabs = prefs.openTabs.includes(terminalId)
      ? prefs.openTabs
      : [...prefs.openTabs, terminalId];
    this._updatePrefs({ openTabs, activeTab: terminalId });
    if (!render) return;
    this.manager.setActiveTerminal(terminalId);
    this._rerender();
  }

  /**
   * Drop a tab from the strip. The terminal keeps running and stays in
   * Overview — × means "drop from this strip", never "destroy", at every
   * level of the interface.
   */
  closeTab(terminalId) {
    const prefs = this._prefs();
    if (!prefs.openTabs.includes(terminalId)) return;
    this._updatePrefs({
      openTabs: prefs.openTabs.filter(id => id !== terminalId),
      activeTab: prefs.activeTab === terminalId ? null : prefs.activeTab
    });
    this._rerender();
  }

  /** Back to the grid. */
  showOverview() {
    if (this._prefs().activeTab === null) return;
    this._updatePrefs({ activeTab: null });
    this._rerender();
  }

  /** The focused tab's terminal id, or null while Overview is showing. */
  getActiveTab() {
    return this._prefs().activeTab;
  }

  // ─── Pieces ─────────────────────────────────────────────

  _buildTabStrip(prefs, terminals) {
    const strip = document.createElement('div');
    strip.className = 'tv-tabs';
    strip.setAttribute('role', 'tablist');

    const overview = document.createElement('div');
    overview.className = `tv-tab tv-tab-overview ${prefs.activeTab ? '' : 'on'}`;
    overview.setAttribute('role', 'tab');
    overview.tabIndex = 0;
    overview.innerHTML = '<span class="tv-tab-name">Overview</span>';
    overview.addEventListener('click', () => this.showOverview());
    overview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showOverview(); }
    });
    strip.appendChild(overview);

    const byId = new Map(terminals.map(t => [t.id, t]));
    prefs.openTabs.forEach((id) => {
      const t = byId.get(id);
      if (!t) return;
      const { status } = laneStatus.getStatus(id);
      const tab = document.createElement('div');
      tab.className = `tv-tab ${prefs.activeTab === id ? 'on' : ''}`;
      tab.dataset.terminalId = id;
      tab.setAttribute('role', 'tab');
      tab.tabIndex = 0;
      tab.innerHTML = `
        <span class="lane-status-dot ${status}"></span>
        <span class="tv-tab-name">${escapeHtml(t.customName || t.name)}</span>
        <button class="tv-tab-close" title="Close tab — the terminal keeps running">${lucideIcon(X, 11)}</button>
      `;
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.tv-tab-close')) return;
        this.openTab(id);
      });
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openTab(id); }
      });
      tab.querySelector('.tv-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(id);
      });
      strip.appendChild(tab);
    });

    // The strip scrolls rather than truncating (up to 9 terminals per
    // project), so keep the focused tab in view after a switch.
    requestAnimationFrame(() => {
      const on = strip.querySelector('.tv-tab.on');
      if (on && strip.isConnected) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    return strip;
  }

  _buildLayoutBar(prefs) {
    const bar = document.createElement('div');
    bar.className = 'tv-bar';
    bar.innerHTML = `
      <span class="tv-bar-label">LAYOUT</span>
      ${[1, 2, 3].map(n => `
        <button class="tv-bar-btn ${prefs.cols === n ? 'on' : ''}" data-cols="${n}" title="${n} column${n > 1 ? 's' : ''}">${'▮'.repeat(n)} ${n}</button>
      `).join('')}
      <span class="tv-bar-hint">drag header to reorder · bottom edge to resize · 🔍 to open in a tab</span>
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
   * The pane. `single` is the tab body's variant: it fills the section, so
   * there is nothing to reorder it against and it is already the tab the
   * magnifier would open — no drag, no magnifier.
   */
  _buildPane(state, prefs, { single = false } = {}) {
    const { status, agentName, foreground, commandLine } = laneStatus.getStatus(state.id);
    const mark = attentionMark(status);
    const pane = document.createElement('div');
    pane.className = `tv-pane ${state.isActive ? 'active' : ''} ${single ? 'tv-pane-single' : ''}`;
    pane.dataset.terminalId = state.id;

    pane.innerHTML = `
      <div class="tv-pane-header" draggable="${!single}" title="${single ? '' : 'Drag to reorder'}">
        <span class="lane-status-dot ${status}"></span>
        <span class="tv-pane-name">${escapeHtml(state.customName || state.name)}</span>
        <span class="tv-pane-attention ${status}" aria-hidden="${!mark}">${mark || ''}</span>
        <span class="tv-pane-status ${status}" title="${escapeHtml(commandLine || '')}">${escapeHtml(statusLabel(status, { agentName, foreground, commandLine, short: true }))}</span>
        <span class="tv-pane-actions">
          <button class="tv-pane-btn" data-rename title="Rename terminal">${lucideIcon(Pencil, 11)}</button>
          ${single ? '' : `<button class="tv-pane-btn" data-open title="Open in its own tab">${lucideIcon(Search, 12)}</button>`}
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
      <p class="tv-empty-title">No terminals yet</p>
      <p class="tv-empty-hint">A terminal is where you run your shell or an AI session.</p>
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

    // The magnifier means "open this terminal in its own tab" — not
    // "enlarge it here". Already open, it switches to that tab.
    const openBtn = pane.querySelector('[data-open]');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openTab(terminalId);
      });
    }

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
    // Overview only — a tab body holds one pane, with nothing to reorder.
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

module.exports = { TerminalsView };
