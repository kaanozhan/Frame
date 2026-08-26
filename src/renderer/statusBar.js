/**
 * Status Bar Module
 *
 * The thin bar at the foot of the window: ambient state you glance at, as
 * opposed to the top bar's controls you click (status-bar spec).
 *
 * Today it carries the Claude usage meters, moved here from the top bar with
 * their behaviour unchanged — live CLAUDE_USAGE_DATA pushes, click to
 * refresh, main's reason shown on error, and warning/critical fills at 50%
 * and 80%. The bar's left half is a declared slot with nothing in it yet.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let barEl = null;

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

module.exports = { init };
