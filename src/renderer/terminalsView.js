/**
 * Terminals View Module
 *
 * The project's default center view (terminals-view spec): every terminal of
 * the current project rendered as a live pane at once — no cell assignment,
 * no entering. A layout bar switches 1/2/3 columns, pane headers drag to
 * reorder, ⤢ maximizes one pane and ❐ returns to the grid. View preferences
 * ({cols, order, maximizedId}) persist per project in localStorage.
 *
 * Naming rule (terminals-view spec): code says "lane"/"tv", user-facing
 * strings say "terminal".
 */

const laneStatus = require('./laneStatus');
const { escapeHtml } = require('./htmlUtils');
const { Plus, Maximize2, Minimize2, Pencil, X } = require('lucide');

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
      const { status, agentName } = laneStatus.getStatus(terminalId);
      const dot = pane.querySelector('.lane-status-dot');
      if (dot) dot.className = `lane-status-dot ${status}`;
      const agent = pane.querySelector('.tv-pane-agent');
      if (agent) agent.textContent = agentName ? `· ${agentName}` : '';
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
      maximizedId: stored.maximizedId || null
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
    if (prefs.maximizedId && !terminals.some(t => t.id === prefs.maximizedId)) {
      prefs = this._updatePrefs({ maximizedId: null });
    }

    const view = document.createElement('div');
    view.className = 'terminals-view';
    container.appendChild(view);

    if (terminals.length === 0) {
      view.appendChild(this._buildEmptyState());
      return;
    }

    view.appendChild(this._buildLayoutBar(prefs));

    const grid = document.createElement('div');
    grid.className = `tv-grid ${prefs.maximizedId ? 'maximized' : ''}`;
    grid.style.gridTemplateColumns = `repeat(${prefs.maximizedId ? 1 : prefs.cols}, 1fr)`;
    view.appendChild(grid);

    const shown = prefs.maximizedId
      ? terminals.filter(t => t.id === prefs.maximizedId)
      : terminals;

    shown.forEach((t) => {
      const pane = this._buildPane(t, prefs);
      grid.appendChild(pane);
      this.manager.mountTerminal(t.id, pane.querySelector('.tv-pane-content'));
    });

    // Ghost pane: create in place, hidden while a pane is maximized
    if (!prefs.maximizedId && terminals.length < this.manager.maxTerminals) {
      grid.appendChild(this._buildGhostPane());
    }

    this._observePanes(grid);
  }

  // ─── Pieces ─────────────────────────────────────────────

  _buildLayoutBar(prefs) {
    const bar = document.createElement('div');
    bar.className = 'tv-bar';
    bar.innerHTML = `
      <span class="tv-bar-label">LAYOUT</span>
      ${[1, 2, 3].map(n => `
        <button class="tv-bar-btn ${!prefs.maximizedId && prefs.cols === n ? 'on' : ''}" data-cols="${n}" title="${n} column${n > 1 ? 's' : ''}">${'▮'.repeat(n)} ${n}</button>
      `).join('')}
      ${prefs.maximizedId ? `<button class="tv-bar-btn on" data-grid-back title="Back to grid">${lucideIcon(Minimize2, 12)} grid</button>` : ''}
      <span class="tv-bar-hint">drag header to reorder · bottom edge to resize · ⤢ to focus</span>
    `;

    bar.querySelectorAll('[data-cols]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._updatePrefs({ cols: Number(btn.dataset.cols), maximizedId: null });
        this._rerender();
      });
    });
    const back = bar.querySelector('[data-grid-back]');
    if (back) {
      back.addEventListener('click', () => {
        this._updatePrefs({ maximizedId: null });
        this._rerender();
      });
    }
    return bar;
  }

  _buildPane(state, prefs) {
    const { status, agentName } = laneStatus.getStatus(state.id);
    const maximized = prefs.maximizedId === state.id;
    const pane = document.createElement('div');
    pane.className = `tv-pane ${state.isActive ? 'active' : ''} ${maximized ? 'maximized' : ''}`;
    pane.dataset.terminalId = state.id;

    pane.innerHTML = `
      <div class="tv-pane-header" draggable="${maximized ? 'false' : 'true'}" title="Drag to reorder">
        <span class="lane-status-dot ${status}"></span>
        <span class="tv-pane-name">${escapeHtml(state.customName || state.name)}</span>
        <span class="tv-pane-agent">${agentName ? `· ${escapeHtml(agentName)}` : ''}</span>
        <span class="tv-pane-actions">
          <button class="tv-pane-btn" data-rename title="Rename terminal">${lucideIcon(Pencil, 11)}</button>
          <button class="tv-pane-btn" data-maximize title="${maximized ? 'Back to grid' : 'Maximize pane'}">${lucideIcon(maximized ? Minimize2 : Maximize2, 12)}</button>
          <button class="tv-pane-btn" data-close title="Close terminal">${lucideIcon(X, 12)}</button>
        </span>
      </div>
      <div class="tv-pane-content"></div>
      <button class="btn-scroll-bottom-overlay btn-scroll-bottom-cell" title="Scroll to bottom">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    `;

    this._setupPaneEvents(pane, state.id);
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

  _setupPaneEvents(pane, terminalId) {
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

    pane.querySelector('[data-maximize]').addEventListener('click', (e) => {
      e.stopPropagation();
      const prefs = this._prefs();
      this._updatePrefs({ maximizedId: prefs.maximizedId === terminalId ? null : terminalId });
      this.manager.setActiveTerminal(terminalId);
      this._rerender();
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

    // Drag-to-reorder (prototype behavior: drag header, drop on a pane)
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
      header.draggable = !pane.classList.contains('maximized');
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
