/**
 * Status Bar Module
 *
 * The thin bar at the foot of the window: ambient state you glance at, as
 * opposed to the top bar's controls you click (status-bar spec).
 *
 * On the right, the Claude usage meters, moved here from the top bar with
 * their behaviour unchanged — live CLAUDE_USAGE_DATA pushes, click to
 * refresh, main's reason shown on error, and warning/critical fills at 50%
 * and 80%.
 *
 * On the left, the slot the status-bar spec declared and left empty — now
 * taken, in order, by the current project's git branch (VS Code's idiom: a
 * branch glyph and the name, fed by the same GIT_STATUS_DATA push the file
 * tree decorates from, hidden when the project is not a repo; a click opens
 * the branch picker above it — status-bar-branch-picker spec), the dock's icons (dock-panel-readonly-views spec: one
 * monochrome icon per dock tab, click toggles that tab, the open tab's icon
 * reads as active) and then the agents running in **the other projects**,
 * and only them (D14), which keeps its place. This project's
 * agents are already on screen in Overview and in the sidebar's ◆ chip;
 * repeating them here would earn the obvious "I have 5 agents, why does it
 * say 2?". The label says its scope out loud for the same reason.
 *
 * Three states — none (a muted glyph, the tooltip says what the slot is),
 * some with nothing blocked (a calm count), and something waiting (a
 * coloured pill with the waiting count). The indicator is a button in the
 * same shape as the branch button next to it, and a click opens a popover
 * above it in the branch picker's idiom — same surface, same grouped rows,
 * arrows/Enter/Escape, outside click closes — so the bar has one popover
 * language, not two.
 *
 * At the far right, after the version, the notice tray's `!` indicator
 * (status-bar-notice-tray spec): main's errors and degraded states, which
 * used to be a banner over the app header. Its popover is the bar's third,
 * and still only one of the three is open at a time.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const state = require('./state');
const dock = require('./dock');
const dockState = require('./dock/dockState');
const commandRegistry = require('./commandRegistry');
const { formatShortcut } = require('./platform');
const { escapeHtml } = require('./htmlUtils');
const tooltip = require('./tooltip');
const uiZoom = require('../shared/uiZoom');
const { GitBranch, Bot } = require('lucide');
const branchPicker = require('./statusBar/branchPicker');
const noticeTray = require('./statusBar/noticeTray');
const githubPanel = require('./githubPanel');

// One button per dock tab, in dockState.TABS' canonical order — not the
// strip's, which the user can drag around: the bar is a fixed row of
// muscle-memory targets. Each runs the same registered command the View
// menu, the palette and the shortcut run (D12); the shortcut in the tooltip
// is dockState.TAB_SHORTCUTS' (the registry's source), read here because
// the bar is built before registerCommands() runs.
const DOCK_ICONS = [
  { tab: 'decisions', command: 'dock.decisions', label: 'Project Notes' },
  // 'structure' is parked (dockState.HIDDEN_TABS) — no icon until it ships.
  { tab: 'prompts', command: 'dock.prompts', label: 'Prompts' },
  { tab: 'activity', command: 'dock.activity', label: 'Activity' }
].map((icon) => ({ ...icon, shortcut: dockState.TAB_SHORTCUTS[icon.tab] || '' }));

let barEl = null;
let slotEl = null;
let branchEl = null;
let indicatorEl = null;
let menuEl = null;
let menuOpen = false;
let menuRows = [];        // the popover's rows, in DOM order, for the keyboard
let menuHighlight = -1;
let lastProjects = [];

function init() {
  barEl = document.getElementById('status-bar');
  if (!barEl) {
    // A control that fails to bind must say so — a silently missing status
    // bar would just look like usage data that never arrives.
    console.error('statusBar: #status-bar not found — usage meters will not render');
    return;
  }

  const usage = barEl.querySelector('.claude-usage-bars');
  if (usage) {
    usage.addEventListener('click', () => {
      ipcRenderer.send(IPC.REFRESH_CLAUDE_USAGE);
    });
    tooltip.attach(usage, 'Click to refresh');
  }

  ipcRenderer.on(IPC.CLAUDE_USAGE_DATA, (event, data) => updateUsage(data));
  ipcRenderer.send(IPC.LOAD_CLAUDE_USAGE);

  _buildBranch();
  _buildDockIcons();
  _buildAgentSlot();
  _buildZoom();
  _buildNoticeTray();
}

// ─── The right end: the interface zoom readout ──────────────
// ui-zoom-steps spec, D2. A readout that appears only away from the default
// step — so a zoomed UI always shows its cause — and resets on click, the
// same command as ⌘0. Sits just before the version, the bar's other
// glanceable fact about the app itself. Main owns the step; this follows
// UI_ZOOM_CHANGED like every other subscriber.

function _buildZoom() {
  const version = barEl.querySelector('#app-version');
  const slot = barEl.querySelector('.status-bar-right');
  if (!slot) {
    console.error('statusBar: .status-bar-right not found — the zoom readout will not render');
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sb-zoom';
  btn.hidden = true;
  if (version && version.parentNode === slot) slot.insertBefore(btn, version);
  else slot.appendChild(btn);

  // The status bar can build before registerCommands() runs, so the
  // registry's shortcut is a preference, not a dependency.
  const shortcut = (commandRegistry.getById('view.zoomReset') || {}).shortcut || 'CmdOrCtrl+0';
  tooltip.attach(btn, `Reset zoom (${formatShortcut(shortcut)})`);
  btn.addEventListener('click', () => {
    if (!commandRegistry.runById('view.zoomReset')) {
      console.error('statusBar: view.zoomReset is not registered');
    }
  });

  const render = ({ step }) => {
    btn.hidden = step === uiZoom.DEFAULT_STEP;
    btn.textContent = `${uiZoom.percentFor(step)}%`;
    btn.setAttribute('aria-label', `Interface zoom ${uiZoom.percentFor(step)}% — reset`);
  };
  ipcRenderer.on(IPC.UI_ZOOM_CHANGED, (event, next) => render(next));
  ipcRenderer.invoke(IPC.UI_ZOOM_GET).then(render).catch((err) => {
    console.error('statusBar: could not read the interface zoom', err);
  });
}

// ─── The right end, last: the notice tray ─────────────────
// status-bar-notice-tray spec. Appended after the version so it is the
// bar's bottom-right corner. Opening it closes the branch picker and the
// agents menu; theirs close it.

function _buildNoticeTray() {
  const slot = barEl.querySelector('.status-bar-right');
  if (!slot) {
    console.error('statusBar: .status-bar-right not found — errors from the main process will not be shown');
    return;
  }
  noticeTray.init({
    slotEl: slot,
    onOpen: () => {
      branchPicker.close();
      _closeMenu();
    }
  });
}

// ─── The left slot, first: the current git branch ───────────

function _buildBranch() {
  const slot = barEl.querySelector('.status-bar-left');
  if (!slot) return;

  // A button since status-bar-branch-picker: the click opens the picker
  // above it. Hidden when the project is not a repo, so there is nothing
  // to click there (C6). The picker itself is a child of the slot, like
  // the agents menu, and only one of the two is ever open (C2).
  branchEl = document.createElement('button');
  branchEl.type = 'button';
  branchEl.className = 'sb-branch';
  branchEl.hidden = true;
  branchEl.setAttribute('aria-haspopup', 'dialog');
  branchEl.setAttribute('aria-expanded', 'false');
  slot.appendChild(branchEl);

  branchPicker.init({
    anchorEl: branchEl,
    slotEl: slot,
    onOpen: () => {
      _closeMenu();
      noticeTray.close();
    },
    onManage: () => _manageBranches()
  });
  branchEl.addEventListener('click', () => branchPicker.toggle());

  // Pushes arrive for whichever project main is watching; paint only the
  // one on screen, so a late push from the previous project cannot label
  // this one with its branch.
  ipcRenderer.on(IPC.GIT_STATUS_DATA, (event, payload) => {
    if (!payload || payload.projectPath !== state.getProjectPath()) return;
    _renderBranch(payload.isRepo ? payload.branch : null);
  });
  // Between projects the old name must not linger until the next push, and
  // the picker (its own onProjectChange closes it too) must not show the
  // previous repo's list.
  state.onProjectChange(() => {
    branchPicker.close();
    _renderBranch(null);
  });
}

// "Manage branches…" — the GitHub view's Branches section, where delete,
// worktrees and pull requests already live. The section is expanded first
// (state only, while the tab is off screen), then the same registered
// command the palette runs reveals the sidebar tab; its show() loads every
// expanded section, Branches now among them.
function _manageBranches() {
  githubPanel.revealSection('branches');
  if (!commandRegistry.runById('sidebar.github')) {
    console.error("statusBar: command 'sidebar.github' did not run");
  }
}

function _renderBranch(branch) {
  if (!branchEl) return;
  if (!branch) {
    branchEl.hidden = true;
    branchEl.textContent = '';
    branchPicker.close();
    return;
  }
  branchEl.innerHTML = `${dock.lucideIcon(GitBranch, 16)}<span class="sb-branch-name">${escapeHtml(branch)}</span>`;
  branchEl.title = `On branch ${branch} — click to switch`;
  branchEl.hidden = false;
}

// ─── The left slot, first: the dock's icons ─────────────────

function _buildDockIcons() {
  const slot = barEl.querySelector('.status-bar-left');
  if (!slot) {
    // C7: icons that never appear must not pass for a bar with nothing to
    // show.
    console.error('statusBar: .status-bar-left not found — the dock icons will not render');
    return;
  }

  const group = document.createElement('div');
  group.className = 'sb-dock';
  group.setAttribute('role', 'toolbar');
  group.setAttribute('aria-label', 'Panel');

  const buttons = new Map();
  DOCK_ICONS.forEach(({ tab, command, label, shortcut }) => {
    const entry = dock.DOCK_TABS[tab];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-dock-btn';
    btn.dataset.tab = tab;
    btn.tabIndex = -1;
    btn.setAttribute('aria-label', label);
    // Opens upward: the bar sits on the floor of the window.
    tooltip.attach(btn, shortcut ? `${label} (${formatShortcut(shortcut)})` : label);
    btn.innerHTML = entry ? dock.lucideIcon(entry.icon, 16) : '';
    btn.addEventListener('click', () => {
      if (!commandRegistry.runById(command)) {
        console.error(`statusBar: command '${command}' did not run`);
      }
    });
    group.appendChild(btn);
    buttons.set(tab, btn);
  });

  slot.appendChild(group);

  const paint = ({ open, tab }) => {
    buttons.forEach((btn, key) => {
      const on = open && key === tab;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };
  dock.onChange(paint);
  paint({ open: dock.isOpen(), tab: dock.activeTab() });
}

// ─── The left slot: agents in the other projects ────────────

function _buildAgentSlot() {
  slotEl = barEl.querySelector('.status-bar-left');
  if (!slotEl) return;

  indicatorEl = document.createElement('button');
  indicatorEl.type = 'button';
  indicatorEl.className = 'sb-agents';
  indicatorEl.setAttribute('aria-haspopup', 'dialog');
  indicatorEl.setAttribute('aria-expanded', 'false');
  slotEl.appendChild(indicatorEl);

  menuEl = document.createElement('div');
  menuEl.className = 'sb-agents-menu';
  menuEl.hidden = true;
  menuEl.tabIndex = -1;
  menuEl.setAttribute('role', 'dialog');
  menuEl.setAttribute('aria-label', 'Agents in other projects');
  slotEl.appendChild(menuEl);

  // Click toggles, like the branch button. Outside mousedown closes, the
  // popover's own clicks stay inside — the branch picker's wiring.
  indicatorEl.addEventListener('click', _toggleMenu);
  menuEl.addEventListener('mousedown', (e) => e.stopPropagation());
  menuEl.addEventListener('keydown', _onMenuKeydown);
  menuEl.addEventListener('click', (e) => {
    const row = e.target.closest('.sb-agents-row');
    if (row) _activateRow(row);
  });
  menuEl.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.sb-agents-row');
    if (!row) return;
    const idx = menuRows.indexOf(row);
    if (idx !== menuHighlight) { menuHighlight = idx; _paintMenuHighlight(); }
  });
  document.addEventListener('mousedown', (e) => {
    if (!menuOpen) return;
    if (menuEl.contains(e.target) || indicatorEl.contains(e.target)) return;
    _closeMenu();
  });

  _renderAgents();
}

/**
 * Fed by projectStatusBadges on every recompute — one traversal for every
 * surface that draws this tally.
 *
 * @param {Array} states - terminal states across every project
 * @param {Map<string, {approval: number, input: number}>} counts
 */
function updateAgents(states, counts) {
  const here = state.getProjectPath();
  const byProject = new Map();

  for (const s of states || []) {
    const path = s.projectPath;
    if (!path || path === here) continue; // this project speaks for itself
    const st = laneStatus.getStatus(s.id);
    if (!st.agentName) continue;
    if (!byProject.has(path)) {
      const c = (counts && counts.get(path)) || { approval: 0, input: 0 };
      byProject.set(path, { path, name: _projectName(path), approval: c.approval, input: c.input, agents: [] });
    }
    byProject.get(path).agents.push({
      id: s.id,
      agentName: st.agentName,
      status: st.status,
      terminalName: s.customName || s.name
    });
  }

  // Projects with something waiting first, then by how many agents they run.
  lastProjects = [...byProject.values()].sort((a, b) => {
    const wa = a.approval * 2 + a.input;
    const wb = b.approval * 2 + b.input;
    if (wa !== wb) return wb - wa;
    return b.agents.length - a.agents.length;
  });

  _renderAgents();
}

function _projectName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function _renderAgents() {
  if (!indicatorEl) return;

  const total = lastProjects.reduce((n, p) => n + p.agents.length, 0);
  const approval = lastProjects.reduce((n, p) => n + p.approval, 0);
  const input = lastProjects.reduce((n, p) => n + p.input, 0);
  const waiting = approval + input;
  const icon = dock.lucideIcon(Bot, 16);

  if (total === 0) {
    indicatorEl.className = 'sb-agents empty';
    indicatorEl.innerHTML = icon;
    indicatorEl.title = 'No agents in other projects. Agents running in your '
      + 'other projects show up here, so one waiting on you somewhere else '
      + 'cannot go unnoticed.';
    _closeMenu();
    return;
  }

  // The scope ("in 2 other projects") lives in the tooltip and the popover's
  // header; the bar itself shows the glyph, the count and — only when
  // something is actually waiting — a pill in that status's colour.
  const attention = approval ? 'agent-approval' : input ? 'agent-input' : null;
  indicatorEl.className = `sb-agents${attention ? ` ${attention}` : ''}`;
  const scope = `in ${lastProjects.length} other project${lastProjects.length === 1 ? '' : 's'}`;
  indicatorEl.innerHTML = `${icon}<span class="sb-agents-count">${total}</span>`
    + (waiting ? `<span class="sb-agents-wait">${waiting} waiting</span>` : '');
  indicatorEl.title = [
    `${total} agent${total === 1 ? '' : 's'} ${scope} — not this one`,
    approval ? `${approval} needs approval` : null,
    input ? `${input} awaiting input` : null,
    'Click for the list'
  ].filter(Boolean).join(' · ');

  if (menuOpen) _renderMenu();
}

function _renderMenu() {
  const total = lastProjects.reduce((n, p) => n + p.agents.length, 0);
  const waiting = lastProjects.reduce((n, p) => n + p.approval + p.input, 0);
  const meta = [`${total} agent${total === 1 ? '' : 's'}`, waiting ? `${waiting} waiting` : null].filter(Boolean).join(' · ');
  menuEl.innerHTML = `
    <div class="sb-agents-head">
      <span class="sb-agents-head-title">Other project${lastProjects.length === 1 ? '' : 's'}</span>
      <span class="sb-agents-head-meta">${meta}</span>
    </div>
    <div class="sb-agents-list" role="listbox">
      ${lastProjects.map(p => `
        <div class="sb-agents-group">${escapeHtml(p.name)}<span class="sb-agents-group-count">${p.agents.length}</span></div>
        ${p.agents.map(a => `
          <button type="button" class="sb-agents-row ${a.status}" role="option" data-id="${escapeHtml(a.id)}" data-path="${escapeHtml(p.path)}">
            <span class="lane-status-dot ${a.status}"></span>
            <span class="sb-agents-row-name">${escapeHtml(a.terminalName)}</span>
            <span class="sb-agents-row-status">${escapeHtml(laneStatus.statusLabel(a.status, { agentName: a.agentName, short: true }))}</span>
          </button>
        `).join('')}
      `).join('')}
    </div>`;

  menuRows = [...menuEl.querySelectorAll('.sb-agents-row')];
  if (menuHighlight >= menuRows.length) menuHighlight = menuRows.length - 1;
  _paintMenuHighlight();
}

function _paintMenuHighlight() {
  menuRows.forEach((row, i) => {
    const on = i === menuHighlight;
    row.classList.toggle('highlight', on);
    row.setAttribute('aria-selected', String(on));
    if (on) row.scrollIntoView({ block: 'nearest' });
  });
}

function _activateRow(row) {
  _closeMenu();
  _focus(row.dataset.path, row.dataset.id);
}

function _onMenuKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    _closeMenu({ refocus: true });
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!menuRows.length) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    menuHighlight = (menuHighlight + step + menuRows.length) % menuRows.length;
    _paintMenuHighlight();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (menuHighlight >= 0 && menuRows[menuHighlight]) _activateRow(menuRows[menuHighlight]);
  }
}

// A click switches project when the agent lives elsewhere, then opens its
// terminal's tab — the navigation presenceBar carried before it merged here.
function _focus(projectPath, terminalId) {
  if (projectPath && projectPath !== state.getProjectPath()) {
    state.setProjectPath(projectPath);
  }
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    if (ui) ui.enterLane(terminalId);
  } catch (_) { /* terminal UI not initialized yet */ }
}

function _toggleMenu() {
  if (menuOpen) _closeMenu(); else _openMenu();
}

function _openMenu() {
  if (!menuEl || menuOpen || lastProjects.length === 0) return;
  // One popover in the bar at a time (status-bar-branch-picker C2).
  branchPicker.close();
  noticeTray.close();
  menuOpen = true;
  menuHighlight = 0;
  _renderMenu();
  // Under its own button, not the slot's left edge (the branch picker's
  // anchor is the first thing in the slot; this one is the last).
  menuEl.style.left = `${indicatorEl.offsetLeft}px`;
  menuEl.hidden = false;
  indicatorEl.setAttribute('aria-expanded', 'true');
  menuEl.focus();
}

function _closeMenu({ refocus = false } = {}) {
  if (!menuEl || !menuOpen) return;
  menuOpen = false;
  menuRows = [];
  menuHighlight = -1;
  menuEl.hidden = true;
  menuEl.innerHTML = '';
  indicatorEl.setAttribute('aria-expanded', 'false');
  if (refocus) indicatorEl.focus();
}

/** Paint both meters from a usage push. */
function updateUsage(data) {
  const container = barEl && barEl.querySelector('.claude-usage-bars');
  if (!container) return;

  const sessionItem = container.querySelector('.usage-item.session');
  const weeklyItem = container.querySelector('.usage-item.weekly');

  container.style.display = '';

  if (data.error) {
    // Show the error state with the reason from main (e.g. "sign in via the
    // claude CLI") so the user knows what's degraded and why.
    updateItem(sessionItem, 0, 'N/A', '');
    updateItem(weeklyItem, 0, 'N/A', '');
    container.title = `${data.error}\nClick to refresh`;
    return;
  }

  const sessionUsage = data.fiveHour?.utilization || 0;
  const sessionReset = data.fiveHour?.resetsAt ? formatResetTime(data.fiveHour.resetsAt) : '';
  updateItem(sessionItem, sessionUsage, `${Math.round(sessionUsage)}%`, sessionReset);

  const weeklyUsage = data.sevenDay?.utilization || 0;
  const weeklyReset = data.sevenDay?.resetsAt ? formatResetTime(data.sevenDay.resetsAt) : '';
  updateItem(weeklyItem, weeklyUsage, `${Math.round(weeklyUsage)}%`, weeklyReset);

  container.title = 'Click to refresh';
}

function updateItem(item, usage, percentText, resetText) {
  if (!item) return;

  const fill = item.querySelector('.usage-bar-fill');
  const percent = item.querySelector('.usage-percent');
  const reset = item.querySelector('.usage-reset');

  if (fill) {
    fill.style.width = `${Math.min(usage, 100)}%`;
    fill.className = 'usage-bar-fill';
    if (usage >= 80) {
      fill.classList.add('critical');
    } else if (usage >= 50) {
      fill.classList.add('warning');
    }
  }

  if (percent) percent.textContent = percentText;

  if (reset) reset.textContent = resetText ? `(${resetText})` : '';
}

/** "2h 15m" / "45m" / "3d 4h" until the window resets. */
function formatResetTime(isoString) {
  try {
    const date = new Date(isoString);
    const diffMs = date - new Date();
    if (diffMs < 0) return 'soon';

    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ${diffHours % 24}h`;
  } catch {
    return '';
  }
}

module.exports = { init, updateAgents };
