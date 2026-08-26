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
 * On the left, the slot the status-bar spec declared and left empty: agents
 * running in **the other projects**, and only them (D14). This project's
 * agents are already on screen in Overview and in the sidebar's ◆ chip;
 * repeating them here would earn the obvious "I have 5 agents, why does it
 * say 2?". The label says its scope out loud for the same reason.
 *
 * Three states — none (a quiet hint that teaches what the slot is), some with
 * nothing blocked (a calm count), and something waiting (prominent). Hover
 * opens the menu, a click acts: the bar's own idiom, the same one the usage
 * meters follow. The menu opens upward because the bar is at the foot of the
 * window, with an open delay and a forgiving close so crossing it by accident
 * costs nothing.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');

// A hover menu needs both: long enough that a pointer crossing the slot does
// not open it, forgiving enough that reaching the menu never loses it.
const MENU_OPEN_MS = 180;
const MENU_CLOSE_MS = 320;

let barEl = null;
let slotEl = null;
let indicatorEl = null;
let menuEl = null;
let openTimer = null;
let closeTimer = null;
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
  }

  ipcRenderer.on(IPC.CLAUDE_USAGE_DATA, (event, data) => updateUsage(data));
  ipcRenderer.send(IPC.LOAD_CLAUDE_USAGE);

  _buildAgentSlot();
}

// ─── The left slot: agents in the other projects ────────────

function _buildAgentSlot() {
  slotEl = barEl.querySelector('.status-bar-left');
  if (!slotEl) return;

  indicatorEl = document.createElement('button');
  indicatorEl.type = 'button';
  indicatorEl.className = 'sb-agents';
  slotEl.appendChild(indicatorEl);

  menuEl = document.createElement('div');
  menuEl.className = 'sb-agents-menu';
  slotEl.appendChild(menuEl);

  // Hover opens, a click acts. Both the trigger and the menu keep it open,
  // so the pointer can travel between them.
  [indicatorEl, menuEl].forEach((el) => {
    el.addEventListener('mouseenter', _scheduleOpen);
    el.addEventListener('mouseleave', _scheduleClose);
  });
  indicatorEl.addEventListener('focus', _openMenu);
  indicatorEl.addEventListener('click', _openMenu);
  slotEl.addEventListener('focusout', (e) => {
    if (!slotEl.contains(e.relatedTarget)) _closeMenu();
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

  if (total === 0) {
    indicatorEl.className = 'sb-agents empty';
    indicatorEl.textContent = 'No agents elsewhere';
    indicatorEl.title = 'Agents running in your other projects show up here. '
      + "This project's own agents are in the sidebar and in Overview.";
    _closeMenu(true);
    return;
  }

  const attention = approval ? 'agent-approval' : input ? 'agent-input' : null;
  const mark = attention ? laneStatus.attentionMark(attention) : '';
  indicatorEl.className = `sb-agents${attention ? ` ${attention}` : ''}`;
  indicatorEl.textContent = waiting
    ? `◆ ${total} agent${total === 1 ? '' : 's'} elsewhere ${mark} ${waiting} waiting`
    : `◆ ${total} agent${total === 1 ? '' : 's'} elsewhere`;
  indicatorEl.title = [
    `${total} agent${total === 1 ? '' : 's'} in ${lastProjects.length} other project${lastProjects.length === 1 ? '' : 's'}`,
    approval ? `${approval} needs approval` : null,
    input ? `${input} awaiting input` : null,
    'Hover for the list'
  ].filter(Boolean).join(' · ');

  if (menuEl.classList.contains('open')) _renderMenu();
}

function _renderMenu() {
  menuEl.innerHTML = lastProjects.map(p => `
    <div class="sb-agents-group">
      <div class="sb-agents-project">${escapeHtml(p.name)}</div>
      ${p.agents.map(a => `
        <button type="button" class="sb-agents-row ${a.status}" data-id="${escapeHtml(a.id)}" data-path="${escapeHtml(p.path)}">
          <span class="lane-status-dot ${a.status}"></span>
          <span class="sb-agents-row-name">${escapeHtml(a.terminalName)}</span>
          <span class="sb-agents-row-status">${escapeHtml(laneStatus.statusLabel(a.status, { agentName: a.agentName, short: true }))}</span>
        </button>
      `).join('')}
    </div>
  `).join('');

  menuEl.querySelectorAll('.sb-agents-row').forEach((row) => {
    row.addEventListener('click', () => {
      _closeMenu(true);
      _focus(row.dataset.path, row.dataset.id);
    });
  });
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

function _scheduleOpen() {
  clearTimeout(closeTimer);
  clearTimeout(openTimer);
  openTimer = setTimeout(_openMenu, MENU_OPEN_MS);
}

function _scheduleClose() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(_closeMenu, MENU_CLOSE_MS);
}

function _openMenu() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (!menuEl || lastProjects.length === 0) return;
  _renderMenu();
  menuEl.classList.add('open');
}

function _closeMenu(immediate = false) {
  clearTimeout(openTimer);
  if (immediate) clearTimeout(closeTimer);
  if (menuEl) menuEl.classList.remove('open');
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
