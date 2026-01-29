/**
 * Terminal Tab Bar Module
 * Renders and manages the terminal tab bar UI
 */

const tasksPanel = require('./tasksPanel');
const pluginsPanel = require('./pluginsPanel');
const githubPanel = require('./githubPanel');

class TerminalTabBar {
  constructor(container, manager) {
    this.container = container;
    this.manager = manager;
    this.element = null;
    this._render();
  }

  _render() {
    this.element = document.createElement('div');
    this.element.className = 'terminal-tab-bar';
    this.element.innerHTML = `
      <div class="terminal-tabs"></div>
      <div class="terminal-tab-actions">
        <button class="btn-new-terminal" title="New Terminal (Ctrl+Shift+T)">+</button>
        <button class="btn-view-toggle" title="Toggle Grid View">⊞</button>
        <select class="grid-layout-select" title="Grid Layout">
          <option value="1x2">1×2</option>
          <option value="1x3">1×3</option>
          <option value="1x4">1×4</option>
          <option value="2x1">2×1</option>
          <option value="2x2" selected>2×2</option>
          <option value="3x1">3×1</option>
          <option value="3x2">3×2</option>
          <option value="3x3">3×3</option>
        </select>
        <button class="btn-tasks-toggle" title="Toggle Tasks Panel (Ctrl+Shift+T)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          Tasks
        </button>
        <button class="btn-plugins-toggle" title="Toggle Plugins Panel (Ctrl+Shift+P)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          Plugins
        </button>
        <button class="btn-github-toggle" title="Toggle GitHub Panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
          GitHub
        </button>
      </div>
    `;

    this.container.appendChild(this.element);
    this._setupEventHandlers();
  }

  /**
   * Update tab bar based on state
   */
  update(state) {
    const tabsContainer = this.element.querySelector('.terminal-tabs');

    // Render tabs
    tabsContainer.innerHTML = state.terminals.map(t => `
      <div class="terminal-tab ${t.isActive ? 'active' : ''}" data-terminal-id="${t.id}">
        <span class="tab-name">${this._escapeHtml(t.customName || t.name)}</span>
        ${state.terminals.length > 1 ? `<button class="tab-close" data-terminal-id="${t.id}" title="Close">×</button>` : ''}
      </div>
    `).join('');

    // Update view toggle button
    const toggleBtn = this.element.querySelector('.btn-view-toggle');
    toggleBtn.textContent = state.viewMode === 'tabs' ? '⊞' : '☐';
    toggleBtn.title = state.viewMode === 'tabs' ? 'Switch to Grid View' : 'Switch to Tab View';

    // Show/hide grid layout selector
    const layoutSelect = this.element.querySelector('.grid-layout-select');
    layoutSelect.style.display = state.viewMode === 'grid' ? 'inline-block' : 'none';
    layoutSelect.value = state.gridLayout;

    // Disable new terminal button if at max
    const newBtn = this.element.querySelector('.btn-new-terminal');
    newBtn.disabled = state.terminals.length >= this.manager.maxTerminals;
    newBtn.title = newBtn.disabled ? 'Maximum terminals reached' : 'New Terminal (Ctrl+Shift+T)';
  }

  _setupEventHandlers() {
    // Tab click - activate terminal
    this.element.addEventListener('click', (e) => {
      const tab = e.target.closest('.terminal-tab');
      if (tab && !e.target.classList.contains('tab-close')) {
        const terminalId = tab.dataset.terminalId;
        this.manager.setActiveTerminal(terminalId);
      }
    });

    // Close button click
    this.element.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        const terminalId = e.target.dataset.terminalId;
        this.manager.closeTerminal(terminalId);
      }
    });

    // Double-click to rename
    this.element.addEventListener('dblclick', (e) => {
      const tab = e.target.closest('.terminal-tab');
      if (tab) {
        this._startRename(tab);
      }
    });

    // New terminal button
    this.element.querySelector('.btn-new-terminal').addEventListener('click', () => {
      this.manager.createTerminal();
    });

    // View toggle button
    this.element.querySelector('.btn-view-toggle').addEventListener('click', () => {
      const newMode = this.manager.viewMode === 'tabs' ? 'grid' : 'tabs';
      this.manager.setViewMode(newMode);
    });

    // Grid layout selector
    this.element.querySelector('.grid-layout-select').addEventListener('change', (e) => {
      this.manager.setGridLayout(e.target.value);
    });

    // Tasks toggle button
    this.element.querySelector('.btn-tasks-toggle').addEventListener('click', () => {
      tasksPanel.toggle();
    });

    // Plugins toggle button
    this.element.querySelector('.btn-plugins-toggle').addEventListener('click', () => {
      pluginsPanel.toggle();
    });

    // GitHub toggle button
    this.element.querySelector('.btn-github-toggle').addEventListener('click', () => {
      githubPanel.toggle();
    });
  }

  _startRename(tabElement) {
    const nameSpan = tabElement.querySelector('.tab-name');
    const currentName = nameSpan.textContent;
    const terminalId = tabElement.dataset.terminalId;

    // Create input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = currentName;

    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = () => {
      const newName = input.value.trim() || currentName;
      this.manager.renameTerminal(terminalId, newName);
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        input.value = currentName;
        input.blur();
      }
    });
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

module.exports = { TerminalTabBar };
