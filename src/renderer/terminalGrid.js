/**
 * Terminal Grid Module
 *
 * Renders the detail view's multi-cell layout (1x2, 2x2, ...). Each cell is
 * an assignable slot: a lane mounted with a header dropdown to swap which
 * lane the cell shows, or — when unassigned — a "New Lane" placeholder that
 * creates a terminal in place (same affordance as the board's add card).
 * 1x1 is handled by MultiTerminalUI directly; this module only renders
 * multi-cell layouts.
 */

const laneStatus = require('./laneStatus');
const { ChevronDown, Plus, Maximize2 } = require('lucide');

const GRID_LAYOUTS = {
  '1x1': { rows: 1, cols: 1 },
  '1x2': { rows: 1, cols: 2 },
  '1x3': { rows: 1, cols: 3 },
  '1x4': { rows: 1, cols: 4 },
  '2x1': { rows: 2, cols: 1 },
  '2x2': { rows: 2, cols: 2 },
  '3x1': { rows: 3, cols: 1 },
  '3x2': { rows: 3, cols: 2 },
  '3x3': { rows: 3, cols: 3 }
};

function lucideIcon(data, size = 13) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrs ? attrStr : ''}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

class TerminalGrid {
  /**
   * @param {TerminalManager} manager
   * @param {Object} callbacks
   * @param {Function} callbacks.onAssign   - (cellIndex, terminalId)
   * @param {Function} callbacks.onNewLane  - (cellIndex)
   * @param {Function} callbacks.onMaximize - (terminalId) back to 1x1
   */
  constructor(manager, callbacks = {}) {
    this.manager = manager;
    this.callbacks = callbacks;
    this.container = null;
    this.cellMenu = null;
    this._layout = '1x1';
    this._createCellMenu();

    // Keep cell-header status dots live without remounting terminals
    laneStatus.onChange((terminalId) => {
      if (!this.container || !this.container.isConnected) return;
      const dot = this.container.querySelector(
        `.grid-cell[data-terminal-id="${terminalId}"] .lane-status-dot`
      );
      if (dot) dot.className = `lane-status-dot ${laneStatus.getStatus(terminalId).status}`;
    });
  }

  /**
   * Render the grid into a container.
   * @param {HTMLElement} container
   * @param {Array<string|null>} assignments - terminalId per cell, null = empty
   * @param {string} layout - key of GRID_LAYOUTS
   */
  render(container, assignments, layout) {
    this.container = container;
    this._layout = layout;
    const config = GRID_LAYOUTS[layout] || GRID_LAYOUTS['2x2'];

    container.innerHTML = '';
    // Additive — the container is the detail view's content area and must
    // keep its layout classes (flex sizing comes from detail-content-area).
    container.classList.add('terminal-grid');
    container.style.display = 'grid';
    container.style.gridTemplateRows = `repeat(${config.rows}, 1fr)`;
    container.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
    container.style.gap = '2px';
    container.style.height = '100%';

    const cellCount = config.rows * config.cols;
    for (let i = 0; i < cellCount; i++) {
      const terminalId = assignments[i] || null;
      const instance = terminalId ? this.manager.getTerminal(terminalId) : null;

      if (instance) {
        const cell = this._createCell(instance.state, i);
        container.appendChild(cell);
        this.manager.mountTerminal(terminalId, cell.querySelector('.grid-cell-content'));
      } else {
        container.appendChild(this._createPlaceholderCell(i));
      }
    }
  }

  // ─── Cells ──────────────────────────────────────────────

  _createCell(state, index) {
    const { status } = laneStatus.getStatus(state.id);
    const cell = document.createElement('div');
    cell.className = `grid-cell ${state.isActive ? 'active' : ''}`;
    cell.dataset.terminalId = state.id;
    cell.dataset.index = index;

    cell.innerHTML = `
      <div class="grid-cell-header">
        <button class="grid-cell-switcher" title="Switch frame in this cell">
          <span class="lane-status-dot ${status}"></span>
          <span class="grid-cell-name">${this._escapeHtml(state.customName || state.name)}</span>
          ${lucideIcon(ChevronDown, 12)}
        </button>
        <div class="grid-cell-actions">
          ${this._layout !== '1x1' ? `<button class="btn-grid-maximize" title="Maximize (1×1)">${lucideIcon(Maximize2, 12)}</button>` : ''}
          <button class="btn-grid-close" title="Close frame">×</button>
        </div>
      </div>
      <div class="grid-cell-content"></div>
      <button class="btn-scroll-bottom-overlay btn-scroll-bottom-cell" title="Scroll to bottom">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    `;

    this._setupCellEvents(cell, state.id, index);
    return cell;
  }

  _createPlaceholderCell(index) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell grid-cell-empty';
    cell.dataset.index = index;
    cell.innerHTML = `
      <div class="grid-cell-empty-inner">
        ${lucideIcon(Plus, 20)}
        <span>New Frame</span>
      </div>
    `;
    cell.addEventListener('click', () => {
      if (this.callbacks.onNewLane) this.callbacks.onNewLane(index);
    });
    return cell;
  }

  _setupCellEvents(cell, terminalId, index) {
    // Click to focus
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.grid-cell-actions') || e.target.closest('.grid-cell-switcher')) return;
      this.manager.setActiveTerminal(terminalId);
      this._updateActiveCell(terminalId);
    });

    // Cell lane switcher dropdown
    cell.querySelector('.grid-cell-switcher').addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      this._showCellMenu(rect.left, rect.bottom + 4, index, terminalId);
    });

    // Maximize back to single view (absent in 1x1)
    const maximizeBtn = cell.querySelector('.btn-grid-maximize');
    if (maximizeBtn) {
      maximizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks.onMaximize) this.callbacks.onMaximize(terminalId);
      });
    }

    // Close lane
    cell.querySelector('.btn-grid-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.manager.closeTerminal(terminalId);
    });

    // Scroll to bottom
    cell.querySelector('.btn-scroll-bottom-cell').addEventListener('click', (e) => {
      e.stopPropagation();
      const instance = this.manager.terminals.get(terminalId);
      if (instance) instance.terminal.scrollToBottom();
    });
  }

  _updateActiveCell(activeId) {
    this.container.querySelectorAll('.grid-cell').forEach((cell) => {
      cell.classList.toggle('active', cell.dataset.terminalId === activeId);
    });
  }

  // ─── Cell lane menu ─────────────────────────────────────

  _createCellMenu() {
    this.cellMenu = document.createElement('div');
    this.cellMenu.className = 'terminal-context-menu lane-menu grid-cell-menu';
    document.body.appendChild(this.cellMenu);

    document.addEventListener('click', (e) => {
      if (!this.cellMenu.contains(e.target) && !e.target.closest('.grid-cell-switcher')) {
        this._hideCellMenu();
      }
    });
    document.addEventListener('scroll', () => this._hideCellMenu(), true);
  }

  _showCellMenu(x, y, cellIndex, currentTerminalId) {
    this.cellMenu.innerHTML = '';

    this.manager.getTerminalStates().forEach((t) => {
      const { status, agentName } = laneStatus.getStatus(t.id);
      const item = document.createElement('div');
      item.className = 'terminal-context-menu-item';
      if (t.id === currentTerminalId) item.classList.add('active-lane');
      item.innerHTML = `
        <span class="lane-status-dot ${status}"></span>
        <span class="lane-menu-item-name">${this._escapeHtml(t.customName || t.name)}</span>
        ${agentName ? `<span class="lane-menu-item-status">${this._escapeHtml(agentName)}</span>` : ''}
      `;
      item.addEventListener('click', () => {
        this._hideCellMenu();
        if (t.id !== currentTerminalId && this.callbacks.onAssign) {
          this.callbacks.onAssign(cellIndex, t.id);
        }
      });
      this.cellMenu.appendChild(item);
    });

    this.cellMenu.style.left = `${x}px`;
    this.cellMenu.style.top = `${y}px`;
    this.cellMenu.classList.add('visible');

    const rect = this.cellMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.cellMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.cellMenu.style.top = `${y - rect.height}px`;
    }
  }

  _hideCellMenu() {
    if (this.cellMenu) this.cellMenu.classList.remove('visible');
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }
}

module.exports = { TerminalGrid, GRID_LAYOUTS };
