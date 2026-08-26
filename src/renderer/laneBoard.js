/**
 * Lane Board Module — Home
 *
 * The project board. Four cards, each a summary of one surface and the way
 * into it: Terminals, Orchestration, Specs, Tasks. The rule that decides what
 * belongs on a card: **a card is a summary and an entry point; the sidebar is
 * the full surface.** Cards do not replace the dashboards, they lead to them.
 *
 * Rendered by MultiTerminalUI into its content container when
 * viewMode === 'board' — a view mode, not an overlay. Without a project there
 * is no Home: project selection takes priority and gets the whole area.
 *
 * Mount/update split (C2). Four live data cards rebuilt on every state change
 * is precisely the shape of the IPC storm measured on 2026-08-20 (~100
 * round-trips/sec, 163% CPU), so `mount()` builds the DOM once and `update()`
 * patches text and small list bodies in place. The host's `_renderBoardView`
 * holds the matching guard.
 *
 * Specs and Tasks ride the SPEC_DATA / TASKS_DATA pushes the panels already
 * use — the subscriptions the retired laneRail owned, `!malformed` filter and
 * all (C6) — so no new IPC channel exists for Home.
 *
 * Naming convention (revised by the terminals-view spec, 2026-08-20;
 * overturns the 2026-06-11 rule): code, module names, and DOM ids still say
 * "lane" (laneBoard, btn-lane-home, _createLane); user-facing vocabulary
 * says "Terminal" for a work stream and "Home" for this board. Keep new
 * code on the same rule — don't half-rename in either direction.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const { statusLabel, attentionMark } = laneStatus;
const { Plus, FolderOpen, Bot, FileText, CheckSquare, ArrowUpRight, Boxes } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');

// A card is a teaser, not a list. Past this the dashboards take over.
const MAX_ROWS = 3;

const SPEC_PHASE_ORDER = ['implementing', 'tasks_generated', 'planned', 'specified', 'draft', 'done'];

function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

class LaneBoard {
  /**
   * @param {TerminalManager} manager
   * @param {Object} callbacks
   * @param {Function} callbacks.onEnterLane - (terminalId) => void
   * @param {Function} callbacks.onOpenTerminals - () => show the Terminals section
   */
  constructor(manager, { onEnterLane, onOpenTerminals }) {
    this.manager = manager;
    this.onEnterLane = onEnterLane;
    this.onOpenTerminals = onOpenTerminals;
    this.container = null;
    this.boardEl = null;
    this.cards = null;
    this.shellMenu = null;
    this.availableShells = [];
    this._specs = [];
    this._tasks = [];
    this._dataProject = null;
    this._lastState = null;

    this._createShellMenu();
    this._loadAvailableShells();

    // Live agent state on the Terminals card.
    laneStatus.onChange(() => {
      if (this._isVisible() && this._lastState) this._updateTerminalsCard(this._lastState);
    });

    // Init-once across instances: LaneBoard is a singleton, and a second
    // construction must not stack another set of listeners (C5). These are
    // the subscriptions laneRail used to own.
    if (!LaneBoard._dataListenersBound) {
      LaneBoard._dataListenersBound = true;
      ipcRenderer.on(IPC.SPEC_DATA, (event, { specs }) => {
        LaneBoard._instance._specs = specs || [];
        LaneBoard._instance._refreshData();
      });
      ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
        LaneBoard._instance._tasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
        LaneBoard._instance._refreshData();
      });
      // The spec/task activity dots track the assigned terminals' agents.
      const dispatch = require('./agentDispatch');
      dispatch.onSpecLaneActivity(() => LaneBoard._instance._refreshData());
      dispatch.onTaskLaneActivity(() => LaneBoard._instance._refreshData());
    }
    LaneBoard._instance = this;
  }

  // ─── Mount / update (C2) ────────────────────────────────

  /**
   * Build the board's DOM. Called once per visit to Home; every state change
   * after that goes through update().
   */
  mount(container, state) {
    this.container = container;
    container.innerHTML = '';

    this.boardEl = document.createElement('div');
    this.boardEl.className = 'lane-board';
    container.appendChild(this.boardEl);

    if (!state.currentProjectPath) {
      // Terminals, specs and tasks are all project-scoped — asking for a
      // project is the only thing Home can usefully do without one.
      this.cards = null;
      this.boardEl.appendChild(this._renderNoProjectState());
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'home-cards';
    this.cards = {
      terminals: this._buildTerminalsCard(),
      orchestration: this._buildOrchestrationCard(),
      specs: this._buildSpecsCard(),
      tasks: this._buildTasksCard()
    };
    Object.values(this.cards).forEach(c => grid.appendChild(c.el));
    this.boardEl.appendChild(grid);

    this.update(state);
  }

  /** Patch the cards in place. Never rebuilds the board. */
  update(state) {
    this._lastState = state;
    if (!this.cards) return;

    if (state.currentProjectPath !== this._dataProject) {
      this._dataProject = state.currentProjectPath;
      this._specs = [];
      this._tasks = [];
      this._fetchForProject(state.currentProjectPath);
    }

    this._updateTerminalsCard(state);
    this._updateOrchestrationCard();
    this._updateSpecsCard();
    this._updateTasksCard();
  }

  /** True when this container already holds a mounted board for this project. */
  isMountedIn(container, state) {
    return !!this.boardEl
      && this.boardEl.isConnected
      && this.boardEl.parentNode === container
      && !!this.cards === !!state.currentProjectPath;
  }

  // ─── Cards ──────────────────────────────────────────────

  /**
   * One card shell: a header that opens the surface, a body the update
   * methods write into, and a footer action.
   */
  _card({ key, icon, title, actionLabel, onOpen, onAction, onActionContext }) {
    const el = document.createElement('div');
    el.className = `home-card home-card-${key}`;
    el.innerHTML = `
      <button class="home-card-header" type="button">
        <span class="home-card-icon">${lucideIcon(icon, 15)}</span>
        <span class="home-card-title">${title}</span>
        <span class="home-card-count"></span>
        <span class="home-card-open">${lucideIcon(ArrowUpRight, 13)}</span>
      </button>
      <div class="home-card-body"></div>
      <button class="home-card-action" type="button">${lucideIcon(Plus, 13)}<span>${actionLabel}</span></button>
    `;
    el.querySelector('.home-card-header').addEventListener('click', onOpen);
    const action = el.querySelector('.home-card-action');
    action.addEventListener('click', (e) => { e.stopPropagation(); onAction(); });
    if (onActionContext) {
      action.addEventListener('contextmenu', (e) => { e.preventDefault(); onActionContext(e); });
    }
    return {
      el,
      count: el.querySelector('.home-card-count'),
      body: el.querySelector('.home-card-body'),
      action
    };
  }

  _buildTerminalsCard() {
    const card = this._card({
      key: 'terminals',
      icon: Boxes,
      title: 'Terminals',
      actionLabel: 'New terminal',
      onOpen: () => this.onOpenTerminals && this.onOpenTerminals(),
      // Direct: one click makes a terminal with the default shell and goes to
      // it. Right-click still picks a shell, the way the old new-lane card did.
      onAction: () => this._createLane(),
      onActionContext: (e) => this._showShellMenu(e.clientX, e.clientY)
    });
    card.action.title = 'New Terminal — right-click to pick a shell';
    return card;
  }

  _buildOrchestrationCard() {
    const orchestrator = require('./orchestrator'); // lazy — load-order coupling
    const card = this._card({
      key: 'orchestration',
      icon: Bot,
      title: 'Orchestration',
      actionLabel: 'Start Orchestrator',
      onOpen: () => orchestrator.open(),
      onAction: () => orchestrator.open()
    });
    card.el.querySelector('.home-card-count').style.display = 'none';
    return card;
  }

  _buildSpecsCard() {
    return this._card({
      key: 'specs',
      icon: FileText,
      title: 'Specs',
      actionLabel: 'Open specs',
      onOpen: () => require('./specsDashboard').show(),
      onAction: () => require('./specsDashboard').show()
    });
  }

  _buildTasksCard() {
    return this._card({
      key: 'tasks',
      icon: CheckSquare,
      title: 'Tasks',
      actionLabel: 'Open tasks',
      onOpen: () => require('./tasksDashboard').show(),
      onAction: () => require('./tasksDashboard').show()
    });
  }

  // ─── Card contents ──────────────────────────────────────

  _updateTerminalsCard(state) {
    const card = this.cards && this.cards.terminals;
    if (!card) return;

    const terminals = state.terminals || [];
    card.count.textContent = String(terminals.length);

    if (terminals.length === 0) {
      card.body.innerHTML = '<div class="home-card-empty">No terminals yet — a terminal is where you run your shell or an AI session.</div>';
      return;
    }

    // Agents first, and the ones waiting on the user before those: the card
    // exists to answer "is anything asking for me?" at a glance.
    const rows = terminals
      .map(t => ({ t, s: laneStatus.getStatus(t.id) }))
      .filter(({ s }) => s.agentName)
      .sort((a, b) => _attentionRank(a.s.status) - _attentionRank(b.s.status));

    if (rows.length === 0) {
      card.body.innerHTML = `<div class="home-card-note">${terminals.length} open · no agents running</div>`;
      return;
    }

    card.body.innerHTML = rows.slice(0, MAX_ROWS).map(({ t, s }) => {
      const mark = attentionMark(s.status);
      return `
        <button type="button" class="home-card-row ${s.status}" data-id="${escapeHtml(t.id)}">
          <span class="lane-status-dot ${s.status}"></span>
          <span class="home-card-row-name">${escapeHtml(t.customName || t.name)}</span>
          ${mark ? `<span class="home-card-row-mark">${mark}</span>` : ''}
          <span class="home-card-row-meta">${escapeHtml(statusLabel(s.status, { agentName: s.agentName, short: true }))}</span>
        </button>
      `;
    }).join('') + _moreHtml(rows.length - MAX_ROWS);

    card.body.querySelectorAll('.home-card-row').forEach((row) => {
      row.addEventListener('click', () => this.onEnterLane(row.dataset.id));
    });
  }

  _updateOrchestrationCard() {
    const card = this.cards && this.cards.orchestration;
    if (!card) return;
    const orchestrator = require('./orchestrator');
    const active = orchestrator.isActive && orchestrator.isActive();

    card.el.classList.toggle('active', !!active);
    card.body.innerHTML = active
      ? '<div class="home-card-note"><span class="home-card-running">running</span> — several specs in parallel with a conductor</div>'
      : '<div class="home-card-empty">Run several specs in parallel, each in its own worktree, with a conductor scheduling them.</div>';
    card.action.querySelector('span').textContent = active ? 'Open Orchestrator' : 'Start Orchestrator';
    card.action.title = active
      ? 'Open Orchestrator — reattach to the running session (does not restart it)'
      : 'Start Orchestrator — run several specs in parallel with a conductor';
  }

  _updateSpecsCard() {
    const card = this.cards && this.cards.specs;
    if (!card) return;

    // The !malformed filter travels with the subscription (C6) — a spec whose
    // folder cannot be read is not an active spec, it is a broken one.
    const active = this._specs
      .filter(s => s.phase !== 'done' && !s.malformed)
      .sort((a, b) => SPEC_PHASE_ORDER.indexOf(a.phase) - SPEC_PHASE_ORDER.indexOf(b.phase));

    card.count.textContent = String(active.length);
    if (active.length === 0) {
      card.body.innerHTML = '<div class="home-card-empty">No active specs.</div>';
      return;
    }

    const dispatch = require('./agentDispatch');
    card.body.innerHTML = active.slice(0, MAX_ROWS).map(s => `
      <button type="button" class="home-card-row" data-slug="${escapeHtml(s.slug)}">
        <span class="home-card-row-name">${dispatch.specStatusDotHtml(s.slug)}${escapeHtml(s.title || s.slug)}</span>
        <span class="spec-phase-badge phase-${escapeHtml(s.phase)}">${escapeHtml(String(s.phase).replace('_', ' '))}</span>
      </button>
    `).join('') + _moreHtml(active.length - MAX_ROWS);

    card.body.querySelectorAll('.home-card-row').forEach((row) => {
      row.addEventListener('click', () => require('./specSection').openInNewTab(row.dataset.slug));
    });
  }

  _updateTasksCard() {
    const card = this.cards && this.cards.tasks;
    if (!card) return;

    const open = this._tasks.filter(t => t.status === 'in_progress' || t.status === 'pending');
    const running = open.filter(t => t.status === 'in_progress').length;

    card.count.textContent = String(open.length);
    if (open.length === 0) {
      card.body.innerHTML = '<div class="home-card-empty">Nothing pending.</div>';
      return;
    }

    const ordered = [...open].sort((a, b) =>
      (a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1));

    card.body.innerHTML =
      `<div class="home-card-note">${running} in progress · ${open.length - running} pending</div>`
      + ordered.slice(0, MAX_ROWS).map(t => `
        <div class="home-card-row static">
          <span class="home-card-row-name">${escapeHtml(t.title || '')}</span>
          <span class="home-card-row-meta">${escapeHtml(t.priority || 'medium')}</span>
        </div>
      `).join('') + _moreHtml(open.length - MAX_ROWS);
  }

  _renderNoProjectState() {
    const empty = document.createElement('div');
    empty.className = 'lane-board-empty';
    empty.innerHTML = `
      <div class="lane-board-empty-icon">${lucideIcon(FolderOpen, 26)}</div>
      <p class="lane-board-empty-title">No project added yet</p>
      <p class="lane-board-empty-hint">Add a project to get started — open a folder, create a new project, or clone a repo.</p>
      <button class="lane-board-empty-cta">Add New Project</button>
    `;
    empty.querySelector('.lane-board-empty-cta').addEventListener('click', () => {
      // Same flow as the sidebar Projects "Add new Project" button — the Open
      // Project modal (open folder / create / clone). Lazy-required to avoid
      // load-order coupling.
      require('./openProjectModal').open();
    });
    return empty;
  }

  // ─── Data ───────────────────────────────────────────────

  _fetchForProject(projectPath) {
    ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
    ipcRenderer.invoke(IPC.LIST_SPECS, projectPath)
      .then((fresh) => {
        if (!Array.isArray(fresh)) return;
        this._specs = fresh;
        this._refreshData();
      })
      .catch(() => { /* the SPEC_DATA push will cover it */ });
  }

  /** A data push repaints only the two cards that read it. */
  _refreshData() {
    if (!this._isVisible() || !this.cards) return;
    this._updateSpecsCard();
    this._updateTasksCard();
  }

  async _createLane(shellPath = null) {
    const options = shellPath ? { shell: shellPath } : {};
    let id = null;
    try {
      id = await this.manager.createTerminal({
        ...options,
        projectPath: this.manager.getCurrentProject()
      });
    } catch (err) {
      notify.error(`Could not create a new terminal: ${err.message || 'terminal creation failed'}`);
      return;
    }
    if (!id) {
      notify.error(`Could not create a new terminal — maximum (${this.manager.maxTerminals}) reached for this project`);
      return;
    }
    this.onEnterLane(id);
  }

  _isVisible() {
    return !!(this.boardEl && this.boardEl.isConnected);
  }

  // ─── Shell menu (same idiom as terminalTabBar's) ────────

  _createShellMenu() {
    this.shellMenu = document.createElement('div');
    this.shellMenu.className = 'terminal-context-menu shell-menu lane-shell-menu';
    document.body.appendChild(this.shellMenu);

    document.addEventListener('click', (e) => {
      if (!this.shellMenu.contains(e.target) && !e.target.closest('.home-card-action')) {
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
          <span>${escapeHtml(shell.name)}</span>
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

}

// Waiting on the user first, then working, then everything else.
function _attentionRank(status) {
  return { 'agent-approval': 0, 'agent-input': 1, 'agent-working': 2 }[status] ?? 3;
}

function _moreHtml(extra) {
  return extra > 0 ? `<div class="home-card-more">+${extra} more</div>` : '';
}

module.exports = { LaneBoard };
