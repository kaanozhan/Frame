/**
 * Terminal Grid Module
 * Handles grid layout for multiple terminals
 */

const GRID_LAYOUTS = {
  '1x2': { rows: 1, cols: 2 },
  '1x3': { rows: 1, cols: 3 },
  '1x4': { rows: 1, cols: 4 },
  '2x1': { rows: 2, cols: 1 },
  '2x2': { rows: 2, cols: 2 },
  '3x1': { rows: 3, cols: 1 },
  '3x2': { rows: 3, cols: 2 },
  '3x3': { rows: 3, cols: 3 }
};

class TerminalGrid {
  constructor(container, manager) {
    this.container = container;
    this.manager = manager;
    this.cellSizes = new Map(); // Store custom cell sizes
  }

  /**
   * Render grid with terminals
   */
  render(terminals, layout) {
    const config = GRID_LAYOUTS[layout] || GRID_LAYOUTS['2x2'];

    // Clear container
    this.container.innerHTML = '';
    this.container.className = 'terminal-grid';

    // Set grid template
    this.container.style.display = 'grid';
    this.container.style.gridTemplateRows = `repeat(${config.rows}, 1fr)`;
    this.container.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
    this.container.style.gap = '2px';
    this.container.style.height = '100%';
    this.container.style.backgroundColor = '#3e3e42';

    // Calculate max cells
    const maxCells = config.rows * config.cols;
    const terminalsToShow = terminals.slice(0, maxCells);

    // Create cells
    terminalsToShow.forEach((terminal, index) => {
      const cell = this._createCell(terminal, index);
      this.container.appendChild(cell);

      // Mount terminal in cell content
      const contentArea = cell.querySelector('.grid-cell-content');
      this.manager.mountTerminal(terminal.id, contentArea);
    });
  }

  /**
   * Create a grid cell
   */
  _createCell(terminal, index) {
    const cell = document.createElement('div');
    cell.className = `grid-cell ${terminal.isActive ? 'active' : ''}`;
    cell.dataset.terminalId = terminal.id;
    cell.dataset.index = index;

    cell.innerHTML = `
      <div class="grid-cell-header">
        <span class="grid-cell-name">${this._escapeHtml(terminal.customName || terminal.name)}</span>
        <div class="grid-cell-actions">
          <button class="btn-grid-focus" title="Focus">◎</button>
          <button class="btn-grid-close" title="Close">×</button>
        </div>
      </div>
      <div class="grid-cell-content"></div>
      <div class="grid-resizer grid-resizer-right"></div>
      <div class="grid-resizer grid-resizer-bottom"></div>
    `;

    this._setupCellEvents(cell, terminal.id);
    return cell;
  }

  /**
   * Setup cell event handlers
   */
  _setupCellEvents(cell, terminalId) {
    // Click to focus
    cell.addEventListener('click', (e) => {
      if (!e.target.closest('.grid-cell-actions')) {
        this.manager.setActiveTerminal(terminalId);
        this._updateActiveCell(terminalId);
      }
    });

    // Focus button
    cell.querySelector('.btn-grid-focus').addEventListener('click', (e) => {
      e.stopPropagation();
      this.manager.setActiveTerminal(terminalId);
      this.manager.setViewMode('tabs'); // Switch to tabs to show focused terminal
    });

    // Close button
    cell.querySelector('.btn-grid-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.manager.closeTerminal(terminalId);
    });

    // Setup resizers
    this._setupResizer(cell, 'right');
    this._setupResizer(cell, 'bottom');
  }

  /**
   * Update active cell styling
   */
  _updateActiveCell(activeId) {
    const cells = this.container.querySelectorAll('.grid-cell');
    cells.forEach(cell => {
      cell.classList.toggle('active', cell.dataset.terminalId === activeId);
    });
  }

  /**
   * Setup resizer for a cell
   */
  _setupResizer(cell, direction) {
    const resizer = cell.querySelector(`.grid-resizer-${direction}`);
    if (!resizer) return;

    let startPos, startSize, siblingCell, siblingStartSize;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();

      const isHorizontal = direction === 'right';
      startPos = isHorizontal ? e.clientX : e.clientY;
      startSize = isHorizontal ? cell.offsetWidth : cell.offsetHeight;

      // Find sibling cell
      const cells = Array.from(this.container.querySelectorAll('.grid-cell'));
      const index = cells.indexOf(cell);

      if (isHorizontal) {
        // Find cell to the right
        siblingCell = cells[index + 1];
      } else {
        // Find cell below (next row)
        const cols = parseInt(this.container.style.gridTemplateColumns.match(/repeat\((\d+)/)?.[1] || 2);
        siblingCell = cells[index + cols];
      }

      if (siblingCell) {
        siblingStartSize = isHorizontal ? siblingCell.offsetWidth : siblingCell.offsetHeight;
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
      resizer.classList.add('active');
    });

    const onMouseMove = (e) => {
      const isHorizontal = direction === 'right';
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPos - startPos;

      // Apply constraints
      const minSize = 150;
      const newSize = Math.max(minSize, startSize + delta);

      if (siblingCell && siblingStartSize) {
        const siblingNewSize = Math.max(minSize, siblingStartSize - delta);
        if (siblingNewSize < minSize) return;
      }

      // Store custom size
      this.cellSizes.set(cell.dataset.index, {
        ...this.cellSizes.get(cell.dataset.index),
        [isHorizontal ? 'width' : 'height']: newSize
      });

      // Fit terminals after resize
      this.manager.fitAll();
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      resizer.classList.remove('active');
    };
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

module.exports = { TerminalGrid, GRID_LAYOUTS };
