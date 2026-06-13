/**
 * Lane Board Module
 *
 * The Lane Orchestrator home screen: a card grid where every card is a lane
 * (= one terminal of the current project). Cards show metadata + a live
 * activity badge from laneStatus; clicking a card enters the lane's detail
 * view. The final card is "+ New Lane".
 *
 * Rendered by MultiTerminalUI into its content container when
 * viewMode === 'board' — a view mode, not an overlay.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const laneRail = require('./laneRail');
const { Plus, Pencil, X, FolderOpen, GitBranch, Bot, FileText, CheckSquare } = require('lucide');

const STATUS_LABELS = {
  'idle': 'Idle',
  'running': 'Running',
  'agent-working': 'Agent working',
  'agent-approval': 'Needs approval',
  'agent-input': 'Awaiting input'
};

// "Running · npm run dev" beats a bare "Running" when we know what's
// running. Falls back to the process name when no command line is known.
function statusLabel(status, foreground, commandLine) {
  if (status === 'running') {
    const what = cleanCommand(commandLine) || foreground;
    if (what) return `Running · ${what}`;
  }
  return STATUS_LABELS[status];
}

// "/usr/local/bin/node /Users/x/proj/server.js --port 3000"
// → "node server.js --port 3000": basename every path-looking token so the
// label reads like what the user typed, not like absolute-path soup.
function cleanCommand(commandLine) {
  if (!commandLine) return null;
  return commandLine
    .trim()
    .split(/\s+/)
    .map((tok) => (tok.startsWith('/') || tok.startsWith('~') ? tok.split('/').pop() : tok))
    .join(' ');
}

// Agent identity (the card chip) comes live from laneStatus's foreground
// detection — never a static tag, so failed launches leave nothing behind.

// Assignment chip (what the lane works on): the icon already says spec vs
// task, so spec labels drop the baked-in "spec: " prefix and show the slug.
function assignmentIcon(assignment) {
  return assignment.kind === 'spec' ? FileText : CheckSquare;
}

function assignmentText(assignment) {
  if (assignment.kind === 'spec') return assignment.ref || assignment.label;
  return assignment.label;
}

function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

function formatRelativeTime(ts) {
  if (!ts) return 'no activity yet';
  const diff = Date.now() - ts;
  if (diff < 10000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return `${Math.floor(diff / 1000)}s ago`;
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

class LaneBoard {
  /**
   * @param {TerminalManager} manager
   * @param {Object} callbacks
   * @param {Function} callbacks.onEnterLane - (terminalId) => void
   */
  constructor(manager, { onEnterLane }) {
    this.manager = manager;
    this.onEnterLane = onEnterLane;
    this.container = null;
    this.boardEl = null;
    this.shellMenu = null;
    this.availableShells = [];
    this._ticker = null;
    this._branch = null;
    this._branchProject = null;

    this._createShellMenu();
    this._loadAvailableShells();

    // Live badge/label updates while the board is visible
    laneStatus.onChange((terminalId) => {
      if (this._isVisible()) this._updateCardStatus(terminalId);
    });

    // Current branch comes from the git status watcher fileTreeUI already
    // starts per project — cards show it instead of the (redundant) project.
    ipcRenderer.on(IPC.GIT_STATUS_DATA, (event, payload) => {
      this._branch = payload.isRepo ? payload.branch : null;
      this._branchProject = payload.projectPath;
      if (this._isVisible()) this._updateBranchChips();
    });
  }

  /**
   * Full render into the given container.
   */
  render(container, state) {
    this.container = container;
    container.innerHTML = '';

    this.boardEl = document.createElement('div');
    this.boardEl.className = 'lane-board';

    if (!state.currentProjectPath) {
      // Lanes live inside a project — ask for one before anything else.
      // No rail either: specs/tasks are project-scoped too.
      this.boardEl.appendChild(this._renderNoProjectState());
      container.appendChild(this.boardEl);
      return;
    }

    if (state.terminals.length === 0) {
      this.boardEl.appendChild(this._renderEmptyState());
    } else {
      const grid = document.createElement('div');
      grid.className = 'lane-board-grid';
      state.terminals.forEach((t) => grid.appendChild(this._renderCard(t)));
      grid.appendChild(this._renderNewLaneCard(state));
      this.boardEl.appendChild(grid);
    }

    // Board (left) + specs/tasks context rail (right)
    const layout = document.createElement('div');
    layout.className = 'lane-board-layout';
    layout.appendChild(this.boardEl);

    const railEl = document.createElement('div');
    layout.appendChild(railEl);
    laneRail.render(railEl, state.currentProjectPath);

    container.appendChild(layout);
    this._startTicker();
  }

  // ─── Cards ──────────────────────────────────────────────

  _renderCard(t) {
    const { status, lastActivityAt, foreground, commandLine, agentName } = laneStatus.getStatus(t.id);
    const branch = (this._branchProject === t.projectPath) ? this._branch : null;

    const card = document.createElement('div');
    card.className = 'lane-card';
    card.dataset.terminalId = t.id;
    card.innerHTML = `
      <div class="lane-card-header">
        <span class="lane-status-dot ${status}"></span>
        <span class="lane-card-name">${this._escapeHtml(t.customName || t.name)}</span>
        <button class="lane-card-action lane-card-rename" title="Rename frame">${lucideIcon(Pencil, 13)}</button>
        <button class="lane-card-action lane-card-close" title="Close frame">${lucideIcon(X, 14)}</button>
      </div>
      <div class="lane-card-meta">
        <span class="lane-card-branch" style="${branch ? '' : 'display:none'}">${lucideIcon(GitBranch, 11)}<span class="lane-card-branch-name">${this._escapeHtml(branch || '')}</span></span>
        <span class="lane-card-agent-badge" style="${agentName ? '' : 'display:none'}">${lucideIcon(Bot, 11)}<span>Agent</span></span>
        <span class="lane-card-tool" style="${agentName ? '' : 'display:none'}">${this._escapeHtml(agentName || '')}</span>
      </div>
      ${t.assignment ? `
      <div class="lane-card-assignment">
        <span class="lane-assignment-chip${agentName ? '' : ' dimmed'}" title="${this._escapeHtml(t.assignment.label)}">
          ${lucideIcon(assignmentIcon(t.assignment), 11)}<span class="lane-assignment-chip-label">${this._escapeHtml(assignmentText(t.assignment))}</span>
        </span>
      </div>` : ''}
      <div class="lane-card-footer">
        <span class="lane-card-status-label ${status}" title="${this._escapeHtml(commandLine || '')}">${this._escapeHtml(statusLabel(status, foreground, commandLine))}</span>
        <span class="lane-card-activity" data-ts="${lastActivityAt || ''}">${formatRelativeTime(lastActivityAt)}</span>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.lane-card-action') || e.target.closest('.lane-rename-input')) return;
      this.onEnterLane(t.id);
    });

    card.querySelector('.lane-card-close').addEventListener('click', () => {
      this.manager.closeTerminal(t.id);
    });

    card.querySelector('.lane-card-rename').addEventListener('click', () => {
      this._startRename(card, t);
    });

    return card;
  }

  _renderNewLaneCard(state) {
    const card = document.createElement('div');
    card.className = 'lane-card lane-card-new';
    const atMax = state.terminals.length >= this.manager.maxTerminals;
    if (atMax) {
      card.classList.add('disabled');
      card.title = `Maximum frames (${this.manager.maxTerminals}) reached for this project`;
    } else {
      card.title = 'New Frame — click to select shell, right-click for default';
    }
    card.innerHTML = `
      <div class="lane-card-new-inner">
        ${lucideIcon(Plus, 22)}
        <span>New Frame</span>
      </div>
    `;

    if (!atMax) {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = card.getBoundingClientRect();
        this._showShellMenu(rect.left, rect.top + 40);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._createLane();
      });
    }

    return card;
  }

  _renderNoProjectState() {
    const empty = document.createElement('div');
    empty.className = 'lane-board-empty';
    empty.innerHTML = `
      <div class="lane-board-empty-icon">${lucideIcon(FolderOpen, 26)}</div>
      <p class="lane-board-empty-title">No project selected</p>
      <p class="lane-board-empty-hint">Frames belong to a project. Pick one from the sidebar, or select a folder to get started.</p>
      <button class="lane-board-empty-cta">Select Project Folder</button>
    `;
    empty.querySelector('.lane-board-empty-cta').addEventListener('click', () => {
      // Same entry point as the sidebar button (idiom: ai.startSession does this too)
      const btn = document.getElementById('btn-select-project');
      if (btn) btn.click();
    });
    return empty;
  }

  _renderEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'lane-board-empty';
    empty.innerHTML = `
      <div class="lane-board-empty-icon">${lucideIcon(Plus, 28)}</div>
      <p class="lane-board-empty-title">No frames yet</p>
      <p class="lane-board-empty-hint">A frame is a terminal where you run your shell or an AI session.</p>
      <button class="lane-board-empty-cta">Create your first frame</button>
    `;
    empty.querySelector('.lane-board-empty-cta').addEventListener('click', () => {
      this._createLane();
    });
    return empty;
  }

  async _createLane(shellPath = null) {
    const options = shellPath ? { shell: shellPath } : {};
    const id = await this.manager.createTerminal({
      ...options,
      projectPath: this.manager.getCurrentProject()
    });
    if (id) this.onEnterLane(id);
  }

  // ─── Rename ─────────────────────────────────────────────

  _startRename(card, t) {
    const nameSpan = card.querySelector('.lane-card-name');
    if (!nameSpan) return;
    const currentName = nameSpan.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lane-rename-input';
    input.value = currentName;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim() || currentName;
      const span = document.createElement('span');
      span.className = 'lane-card-name';
      span.textContent = newName;
      if (input.parentNode) input.replaceWith(span);
      this.manager.renameTerminal(t.id, newName);
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  // ─── Live updates ───────────────────────────────────────

  _isVisible() {
    return !!(this.boardEl && this.boardEl.isConnected);
  }

  _updateCardStatus(terminalId) {
    const card = this.boardEl.querySelector(`.lane-card[data-terminal-id="${terminalId}"]`);
    if (!card) return;
    const { status, lastActivityAt, foreground, commandLine, agentName } = laneStatus.getStatus(terminalId);

    const dot = card.querySelector('.lane-status-dot');
    if (dot) dot.className = `lane-status-dot ${status}`;

    const label = card.querySelector('.lane-card-status-label');
    if (label) {
      label.className = `lane-card-status-label ${status}`;
      label.textContent = statusLabel(status, foreground, commandLine);
      label.title = commandLine || '';
    }

    // Agent badge + tool chip follow the live foreground process — they
    // appear when an AI tool actually runs, disappear when it exits.
    const badge = card.querySelector('.lane-card-agent-badge');
    if (badge) badge.style.display = agentName ? '' : 'none';
    const chip = card.querySelector('.lane-card-tool');
    if (chip) {
      chip.style.display = agentName ? '' : 'none';
      chip.textContent = agentName || '';
    }

    // Assignment chip stays (provenance) but fades while no live agent
    // is in the lane.
    const assignChip = card.querySelector('.lane-assignment-chip');
    if (assignChip) assignChip.classList.toggle('dimmed', !agentName);

    const activity = card.querySelector('.lane-card-activity');
    if (activity) {
      activity.dataset.ts = lastActivityAt || '';
      activity.textContent = formatRelativeTime(lastActivityAt);
    }
  }

  _updateBranchChips() {
    this.boardEl.querySelectorAll('.lane-card-branch').forEach((chip) => {
      if (this._branch) {
        chip.style.display = '';
        const nameEl = chip.querySelector('.lane-card-branch-name');
        if (nameEl) nameEl.textContent = this._branch;
      } else {
        chip.style.display = 'none';
      }
    });
  }

  _startTicker() {
    if (this._ticker) clearInterval(this._ticker);
    this._ticker = setInterval(() => {
      if (!this._isVisible()) {
        clearInterval(this._ticker);
        this._ticker = null;
        return;
      }
      this.boardEl.querySelectorAll('.lane-card-activity').forEach((el) => {
        const ts = el.dataset.ts ? Number(el.dataset.ts) : null;
        el.textContent = formatRelativeTime(ts);
      });
    }, 30000);
  }

  // ─── Shell menu (same idiom as terminalTabBar's) ────────

  _createShellMenu() {
    this.shellMenu = document.createElement('div');
    this.shellMenu.className = 'terminal-context-menu shell-menu lane-shell-menu';
    document.body.appendChild(this.shellMenu);

    document.addEventListener('click', (e) => {
      if (!this.shellMenu.contains(e.target) && !e.target.closest('.lane-card-new')) {
        this._hideShellMenu();
      }
    });
    document.addEventListener('scroll', () => this._hideShellMenu(), true);
  }

  async _loadAvailableShells() {
    try {
      this.availableShells = await this.manager.getAvailableShells();
    } catch (err) {
      console.error('Failed to load available shells:', err);
      this.availableShells = [];
    }
  }

  _showShellMenu(x, y) {
    this.shellMenu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'shell-menu-header';
    header.textContent = 'Select Shell';
    this.shellMenu.appendChild(header);

    if (this.availableShells.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'terminal-context-menu-item';
      loading.textContent = 'Loading...';
      loading.style.opacity = '0.5';
      this.shellMenu.appendChild(loading);
      this._loadAvailableShells().then(() => {
        if (this.shellMenu.classList.contains('visible')) this._showShellMenu(x, y);
      });
    } else {
      this.availableShells.forEach((shell) => {
        const item = document.createElement('div');
        item.className = 'terminal-context-menu-item';
        if (shell.isDefault) item.classList.add('default');
        item.innerHTML = `
          <span>${this._escapeHtml(shell.name)}</span>
          ${shell.isDefault ? '<span class="shell-default-badge">default</span>' : ''}
        `;
        item.addEventListener('click', () => {
          this._hideShellMenu();
          this._createLane(shell.path);
        });
        this.shellMenu.appendChild(item);
      });
    }

    this.shellMenu.style.left = `${x}px`;
    this.shellMenu.style.top = `${y}px`;
    this.shellMenu.classList.add('visible');

    const rect = this.shellMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.shellMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.shellMenu.style.top = `${y - rect.height}px`;
    }
  }

  _hideShellMenu() {
    if (this.shellMenu) this.shellMenu.classList.remove('visible');
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }
}

module.exports = { LaneBoard, formatRelativeTime, STATUS_LABELS, cleanCommand, assignmentIcon, assignmentText };
