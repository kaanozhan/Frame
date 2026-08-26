/**
 * Lane Board Module — Home
 *
 * The project board. Three cards, each a summary of one surface and the way
 * into it: Terminals, Active Specs, Active Tasks. The rule that decides what
 * belongs on a card: **a card is a summary and an entry point; the sidebar is
 * the full surface.** Cards do not replace the dashboards, they lead to them.
 * Orchestration is deliberately absent — it is a surface you open, and the
 * sidebar's Work group opens it as a top-bar tab.
 *
 * Rendered by MultiTerminalUI into its content container when
 * viewMode === 'board' — a view mode, not an overlay. Without a project there
 * is no Home: project selection takes priority and gets the whole area.
 *
 * Mount/update split (C2). Live data cards rebuilt on every state change
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
const { statusLabel, attentionMark, formatRelativeTime, assignmentIcon, assignmentText } = laneStatus;
const { Plus, FolderOpen, Bot, FileText, CheckSquare, ArrowUpRight, ArrowRight, Play, AlertTriangle, Boxes, GitBranch } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');
// Home says the same thing about an empty project as the section does — from
// the section's own definition, so it can only ever be said one way.
const { EMPTY_TITLE, EMPTY_HINT } = require('./terminalsView');

// A card is a teaser, not a list. Past this the dashboards take over — but a
// card now owns a quarter of the board, so the teaser can be worth the space.
const MAX_ROWS = 6;
// Six cells, 3×2. The cap is a legibility budget, not a data limit: past it
// the last cell becomes "+N more" rather than nine boxes shrunk to fit.
const MAX_TILES = 6;

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
    this._branch = null;
    this._branchProject = null;
    this.headerEl = null;

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
      // The branch comes from the git status watcher fileTreeUI already starts
      // per project — no new IPC for the header either.
      ipcRenderer.on(IPC.GIT_STATUS_DATA, (event, payload) => {
        const b = LaneBoard._instance;
        b._branch = payload.isRepo ? payload.branch : null;
        b._branchProject = payload.projectPath;
        if (b._isVisible()) b._updateHeader();
      });
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

    this.headerEl = this._buildHeader();
    this.boardEl.appendChild(this.headerEl);

    this.cards = {
      terminals: this._buildTerminalsCard(),
      specs: this._buildSpecsCard(),
      tasks: this._buildTasksCard()
    };

    // Two groups, because the cards answer two different questions: what is
    // running right now, and what the project has planned. Splitting them
    // also gives the board a reading order instead of a grid of equals.
    // Orchestration is not here — it is a surface you open, and it opens as a
    // top-bar tab from the sidebar's Work group.
    this.boardEl.appendChild(this._buildGroup('Work',
      [this.cards.terminals]));
    this.boardEl.appendChild(this._buildGroup('Project planning',
      [this.cards.specs, this.cards.tasks]));

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

    this._updateHeader();
    this._updateTerminalsCard(state);
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

  // ─── Header ─────────────────────────────────────────────

  /**
   * Home opens on a project, so it should say which one: the name and the
   * branch it is on. The path is not repeated here — the sidebar already
   * carries it, and Home is not where you go to check a directory.
   */
  _buildHeader() {
    const el = document.createElement('div');
    el.className = 'home-header';
    el.innerHTML = `
      <div class="home-header-top">
        <h1 class="home-header-name"></h1>
        <span class="home-header-branch">${lucideIcon(GitBranch, 12)}<span class="home-header-branch-name"></span></span>
      </div>
    `;
    return el;
  }

  _updateHeader() {
    if (!this.headerEl) return;
    const path = this._lastState && this._lastState.currentProjectPath;
    if (!path) return;

    this.headerEl.querySelector('.home-header-name').textContent = _projectName(path);

    // The watcher reports per project — a branch from the project you just
    // left is not this project's branch.
    const branch = this._branchProject === path ? this._branch : null;
    const chip = this.headerEl.querySelector('.home-header-branch');
    chip.style.display = branch ? '' : 'none';
    if (branch) this.headerEl.querySelector('.home-header-branch-name').textContent = branch;
  }

  /** A titled row of cards. The two groups split the board's height evenly. */
  _buildGroup(title, cards) {
    const group = document.createElement('section');
    group.className = 'home-group';

    const heading = document.createElement('h2');
    heading.className = 'home-group-title';
    heading.textContent = title;
    group.appendChild(heading);

    const grid = document.createElement('div');
    // A lone card takes the whole row — the Work group is Terminals only, and
    // half a row of card next to half a row of nothing is worse than either.
    grid.className = cards.length === 1 ? 'home-cards home-cards-solo' : 'home-cards';
    cards.forEach(c => grid.appendChild(c.el));
    group.appendChild(grid);

    return group;
  }

  // ─── Cards ──────────────────────────────────────────────

  /**
   * One card shell: a header that opens the surface, a body the update
   * methods write into, and a footer action.
   */
  _card({ key, icon, title, actionLabel, actionIcon = Plus, onOpen, onAction, onActionContext }) {
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
      <button class="home-card-action" type="button">${lucideIcon(actionIcon, 13)}<span>${actionLabel}</span></button>
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
      // Creating a terminal lives in the grid now, as a tile in the first
      // free slot — so the footer is free to be the way out to the full grid.
      actionLabel: 'See Overview',
      actionIcon: ArrowRight,
      onOpen: () => this.onOpenTerminals && this.onOpenTerminals(),
      onAction: () => this.onOpenTerminals && this.onOpenTerminals()
    });
    card.action.title = 'Open the Terminals section on Overview';
    return card;
  }

  _buildSpecsCard() {
    return this._card({
      key: 'specs',
      icon: FileText,
      title: 'Active Specs',
      actionLabel: 'Open specs',
      actionIcon: ArrowRight,
      onOpen: () => require('./specsDashboard').show(),
      onAction: () => require('./specsDashboard').show()
    });
  }

  _buildTasksCard() {
    return this._card({
      key: 'tasks',
      icon: CheckSquare,
      title: 'Active Tasks',
      actionLabel: 'Open tasks',
      actionIcon: ArrowRight,
      onOpen: () => require('./tasksDashboard').show(),
      onAction: () => require('./tasksDashboard').show()
    });
  }

  // ─── Card contents ──────────────────────────────────────

  /**
   * Terminals as tiles, six at a time in a 3×2 grid. The tiles are large on
   * purpose, so they carry what you would otherwise open a terminal to find
   * out: what it is running, what it was assigned, and how long since it last
   * said anything. Past six the last cell says how many are not shown and
   * leads to Overview — never a silent truncation.
   */
  _updateTerminalsCard(state) {
    const card = this.cards && this.cards.terminals;
    if (!card) return;

    const terminals = state.terminals || [];
    card.count.textContent = String(terminals.length);

    if (terminals.length === 0) {
      // An empty project deserves the middle of the card, not a lone dashed
      // box in the top-left corner of a lot of nothing.
      card.body.innerHTML = `
        <div class="home-tiles-empty">
          <p class="home-tiles-empty-title">${EMPTY_TITLE}</p>
          <p class="home-tiles-empty-hint">${EMPTY_HINT}</p>
          <button type="button" class="home-tile-new home-tiles-empty-cta">
            ${lucideIcon(Plus, 14)}<span>New terminal</span>
          </button>
        </div>
      `;
      this._wireTerminalTiles(card);
      return;
    }

    // Waiting agents first: the card exists to answer "is anything asking
    // for me?" before it answers "what is open".
    const rows = terminals
      .map(t => ({ t, s: laneStatus.getStatus(t.id) }))
      .sort((a, b) => _attentionRank(a.s.status) - _attentionRank(b.s.status));

    // The overflow tile costs a slot, so what it hides is one more than the
    // count over the cap — get that wrong and the label quietly lies.
    const overflow = rows.length > MAX_TILES ? rows.length - (MAX_TILES - 1) : 0;
    const shown = overflow > 0 ? rows.slice(0, MAX_TILES - 1) : rows.slice(0, MAX_TILES);

    const tiles = shown.map(({ t, s }) => {
      const mark = attentionMark(s.status);
      const full = statusLabel(s.status, { agentName: s.agentName, foreground: s.foreground, commandLine: s.commandLine });
      return `
        <button type="button" class="home-tile ${s.status}" data-id="${escapeHtml(t.id)}" title="${escapeHtml(full)}">
          <span class="home-tile-top">
            <span class="lane-status-dot ${s.status}"></span>
            <span class="home-tile-name">${escapeHtml(t.customName || t.name)}</span>
            ${mark ? `<span class="home-tile-mark">${mark}</span>` : ''}
          </span>
          <span class="home-tile-status">${escapeHtml(full)}</span>
          ${t.assignment ? `
          <span class="lane-assignment-chip home-tile-assign${s.agentName ? '' : ' dimmed'}"
                role="button" tabindex="0"
                data-assign-kind="${escapeHtml(t.assignment.kind || '')}"
                data-assign-ref="${escapeHtml(t.assignment.ref || '')}"
                title="Open ${escapeHtml(t.assignment.label)}">
            ${lucideIcon(assignmentIcon(t.assignment), 11)}<span class="lane-assignment-chip-label">${escapeHtml(assignmentText(t.assignment))}</span>
          </span>` : ''}
          <span class="home-tile-time">${escapeHtml(formatRelativeTime(s.lastActivityAt))}</span>
        </button>
      `;
    });

    if (overflow > 0) {
      tiles.push(`<button type="button" class="home-tile home-tile-more">+${overflow} more</button>`);
    } else if (terminals.length < this.manager.maxTerminals && tiles.length < MAX_TILES) {
      // New terminal takes the next free cell, when the project and the grid
      // both have room.
      tiles.push(`<button type="button" class="home-tile home-tile-new">${lucideIcon(Plus, 16)}<span>New terminal</span></button>`);
    }

    card.body.innerHTML = `<div class="home-tiles">${tiles.join('')}</div>`;
    this._wireTerminalTiles(card);
  }

  /**
   * A tile lands you in that terminal; its assignment chip opens the spec or
   * task it is working on instead — reusing that section's tab when one is
   * already open, rather than stacking duplicates. New makes a terminal
   * (right-click picks the shell); +N more goes to Overview.
   */
  _wireTerminalTiles(card) {
    card.body.querySelectorAll('.home-tile[data-id]').forEach((tile) => {
      tile.addEventListener('click', () => this.onEnterLane(tile.dataset.id));
    });
    card.body.querySelectorAll('.home-tile-assign').forEach((chip) => {
      const go = (e) => {
        // The chip sits inside the tile, and the tile means "go to this
        // terminal" — without this the chip would do both.
        e.stopPropagation();
        const { assignKind, assignRef } = chip.dataset;
        if (!assignRef) return;
        if (assignKind === 'spec') require('./specSection').open(assignRef);
        else require('./taskSection').open(assignRef);
      };
      chip.addEventListener('click', go);
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
      });
    });

    const add = card.body.querySelector('.home-tile-new');
    if (add) {
      add.title = 'New Terminal — right-click to pick a shell';
      add.addEventListener('click', () => this._createLane());
      add.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showShellMenu(e.clientX, e.clientY);
      });
    }
    const more = card.body.querySelector('.home-tile-more');
    if (more) more.addEventListener('click', () => this.onOpenTerminals && this.onOpenTerminals());
  }

  _updateSpecsCard() {
    const card = this.cards && this.cards.specs;
    if (!card) return;

    // The !malformed filter travels with the subscription (C6) — a spec whose
    // folder cannot be read is not an active spec, it is a broken one.
    const active = this._specs
      .filter(s => s.phase !== 'done' && !s.malformed)
      .sort((a, b) => SPEC_PHASE_ORDER.indexOf(a.phase) - SPEC_PHASE_ORDER.indexOf(b.phase));

    const done = this._specs.filter(s => s.phase === 'done' && !s.malformed).length;

    card.count.textContent = String(active.length);
    if (active.length === 0) {
      // Nothing to summarise means the card has a better job: saying what a
      // spec is for, to someone who has not written one yet.
      card.body.innerHTML = `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">No specs yet.</p>
          <p>A spec is what you're building and why. Frame turns it into a plan,
             then a task list, and keeps both in the repo so the next session
             starts where this one stopped.</p>
          <p class="home-card-onboard-how">Open specs below to write your first one.</p>
        </div>
      `;
      return;
    }

    // What phase the active ones are in, and how much is already behind you.
    const byPhase = SPEC_PHASE_ORDER
      .filter(ph => ph !== 'done')
      .map(ph => [active.filter(s => s.phase === ph).length, String(ph).replace('_', ' ')])
      .filter(([n]) => n > 0);
    if (done > 0) byPhase.push([done, 'done']);

    const dispatch = require('./agentDispatch');
    card.body.innerHTML = _statsHtml(byPhase) + active.slice(0, MAX_ROWS).map(s => `
      <button type="button" class="home-card-row" data-slug="${escapeHtml(s.slug)}">
        <span class="home-card-row-name">${dispatch.specStatusDotHtml(s.slug)}${escapeHtml(s.title || s.slug)}</span>
        <span class="spec-phase-badge phase-${escapeHtml(s.phase)}">${escapeHtml(String(s.phase).replace('_', ' '))}</span>
      </button>
    `).join('') + _moreHtml(active.length - MAX_ROWS);

    card.body.querySelectorAll('.home-card-row').forEach((row) => {
      row.addEventListener('click', () => require('./specSection').openInNewTab(row.dataset.slug));
    });
  }

  /**
   * Active Tasks. The card answers "what is being worked on right now", in
   * three states:
   *
   *   - work in progress  → list it, one click hands any row to a terminal
   *   - none, but pending → say so plainly, then list what is queued
   *   - nothing at all    → say what a task is for
   *
   * Above all three, when a spec is holding tasks that nobody has implemented
   * yet, a warning: that work is real, it is just owned somewhere else, and
   * it is the thing most likely to be forgotten.
   */
  _updateTasksCard() {
    const card = this.cards && this.cards.tasks;
    if (!card) return;

    const allOpen = this._tasks.filter(t => t.status === 'in_progress' || t.status === 'pending');
    // A spec's tasks are that spec's business — it tracks them, implements
    // them and closes them. Listing them here too would make one pile of work
    // look like two, and put a Run button next to something an implement run
    // already owns.
    const isSpecTask = (t) => String(t.source || '').startsWith('spec:');
    const specWaiting = allOpen.filter(t => isSpecTask(t) && t.status === 'pending');
    const specCount = new Set(specWaiting.map(t => String(t.source).split(':')[1])).size;

    const open = allOpen.filter(t => !isSpecTask(t));
    const active = open.filter(t => t.status === 'in_progress');
    const pending = open.filter(t => t.status === 'pending');

    card.count.textContent = String(active.length);

    const warning = specWaiting.length
      ? `<button type="button" class="home-card-warn">${lucideIcon(AlertTriangle, 12)}<span>${specWaiting.length} task${specWaiting.length === 1 ? '' : 's'} in ${specCount} spec${specCount === 1 ? '' : 's'} waiting to be implemented</span></button>`
      : '';

    // Nothing of our own in either state — the card explains itself instead.
    if (open.length === 0) {
      card.body.innerHTML = warning + (specWaiting.length ? `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">Nothing outside the specs.</p>
          <p>Every open task belongs to a spec, which tracks it through plan
             and implementation.</p>
        </div>
      ` : `
        <div class="home-card-onboard">
          <p class="home-card-onboard-lead">Nothing pending.</p>
          <p>Tasks are the small units of work Frame tracks between sessions —
             written by hand, or generated from a spec's plan.</p>
          <p class="home-card-onboard-how">Open tasks below to add one.</p>
        </div>
      `);
      this._wireTaskCard(card);
      return;
    }

    // What kind of work it is beats how urgent someone once said it was: a
    // fix and a feature are different jobs, "medium" and "medium" are not.
    const catOf = (t) => t.category || 'task';
    const rowHtml = (t) => `
      <div class="home-card-row task-row ${t.status === 'in_progress' ? 'running' : ''}" data-id="${escapeHtml(t.id)}">
        <span class="home-card-row-name">${escapeHtml(t.title || '')}</span>
        <span class="home-card-cat cat-${escapeHtml(catOf(t))}">${escapeHtml(catOf(t))}</span>
        <button type="button" class="home-card-run" data-run="${escapeHtml(t.id)}"
                title="Start this task in a terminal">${lucideIcon(Play, 11)}</button>
      </div>
    `;

    const byStatus = [[active.length, 'in progress'], [pending.length, 'pending']]
      .filter(([n]) => n > 0);

    if (active.length > 0) {
      // The active list is the card's job; the queue behind it is a number.
      card.body.innerHTML = warning
        + _statsHtml(byStatus)
        + _statsHtml(_tally(active, catOf), 'subtle')
        + active.slice(0, MAX_ROWS).map(rowHtml).join('')
        + _moreHtml(active.length - MAX_ROWS);
    } else {
      // Nothing running. Saying only that would waste the card, so the queue
      // takes over: what is waiting, and what kind of work it is.
      card.body.innerHTML = warning
        + _statsHtml(byStatus)
        + _statsHtml(_tally(pending, catOf), 'subtle')
        + '<div class="home-card-note">No active tasks — next up:</div>'
        + pending.slice(0, MAX_ROWS).map(rowHtml).join('')
        + _moreHtml(pending.length - MAX_ROWS);
    }

    this._wireTaskCard(card);
  }

  /**
   * The row opens the task; the play button hands it to a terminal through
   * the same modal + dispatch every other surface runs tasks through; the
   * warning leads to the specs that own the work it names.
   */
  _wireTaskCard(card) {
    card.body.querySelectorAll('.task-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.home-card-run')) return;
        require('./taskSection').openInNewTab(row.dataset.id);
      });
    });
    card.body.querySelectorAll('.home-card-run').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = this._tasks.find(t => t.id === btn.dataset.run);
        if (task) require('./tasksPanel').openRunFlow(task);
      });
    });
    const warn = card.body.querySelector('.home-card-warn');
    if (warn) warn.addEventListener('click', () => require('./specsDashboard').show());
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

function _projectName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

// Waiting on the user first, then working, then busy, then idle.
function _attentionRank(status) {
  return { 'agent-approval': 0, 'agent-input': 1, 'agent-working': 2, running: 3, idle: 4 }[status] ?? 4;
}

/**
 * A compact "12 feature · 6 fix" strip. Counts lead, because the number is
 * what the eye is here for; the label follows quietly.
 */
function _statsHtml(pairs, variant = '') {
  if (!pairs.length) return '';
  return `<div class="home-card-stats ${variant}">`
    + pairs.map(([n, label]) =>
      `<span class="home-card-stat"><b>${n}</b>${escapeHtml(String(label))}</span>`).join('')
    + '</div>';
}

/** Count by key, biggest first, with a tail past the fourth. */
function _tally(items, keyOf) {
  const counts = new Map();
  for (const it of items) {
    const k = keyOf(it);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, 4).map(([k, n]) => [n, k]);
  const tail = sorted.slice(4).reduce((n, [, c]) => n + c, 0);
  if (tail > 0) head.push([tail, 'other']);
  return head;
}

function _moreHtml(extra) {
  return extra > 0 ? `<div class="home-card-more">+${extra} more</div>` : '';
}

module.exports = { LaneBoard };
