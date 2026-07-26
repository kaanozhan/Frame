/**
 * Instrument Rail
 *
 * A fixed column of icons at the app's outer edge — the last flex child of
 * `#main-content`, so panels open inboard of it and the rail itself never
 * moves. That fixity is the whole point: a landmark that slides sideways
 * every time a panel toggles cannot build muscle memory, which is why
 * activity bars live on the outermost edge.
 *
 * The semantic split it establishes: the left sidebar rail is the *project's
 * content* (projects, files, changes, agent); this rail is *Frame's own
 * instruments*. Today Activity is the only item. The six destinations still
 * behind the `⋯` overflow menu in terminalTabBar.js belong here too, but
 * moving them touches five panel modules at once and is its own spec — the
 * rail is built to host them, not to hold them yet.
 *
 * Visual idiom is the existing `.lane-rail-strip-btn` treatment (laneRail.js,
 * laneDetailRail.js, sectionRail.js), not a new one.
 */

const { Activity } = require('lucide');
const activityPanel = require('./activityPanel');

let railEl = null;
let initialized = false;

function lucideIcon(data, size = 15) {
  const children = data
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}/>`;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

// One entry per instrument. Shaped like terminalTabBar's overflow-menu array
// so the migration in the follow-up spec is a move, not a rewrite.
const ITEMS = [
  {
    key: 'activity',
    label: 'Activity',
    title: 'Activity — what Frame is doing on its own',
    icon: () => lucideIcon(Activity),
    action: () => activityPanel.toggle(),
    isActive: () => activityPanel.isVisible()
  }
];

function render() {
  if (!railEl) return;
  railEl.innerHTML = ITEMS.map(
    (item) =>
      `<button type="button" class="instrument-rail-btn${item.isActive() ? ' active' : ''}" data-instrument="${item.key}" title="${item.title}" aria-label="${item.label}" tabindex="-1">${item.icon()}</button>`
  ).join('');
}

function init() {
  if (initialized) return;
  railEl = document.getElementById('instrument-rail');
  if (!railEl) return;
  initialized = true;

  railEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-instrument]');
    if (!btn) return;
    const item = ITEMS.find((i) => i.key === btn.dataset.instrument);
    if (!item) return;
    item.action();
    render(); // reflect the new open/closed state on the icon
  });

  render();
}

module.exports = { init, render };
