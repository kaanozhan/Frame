/**
 * Instrument Rail
 *
 * A fixed column of icons at the app's outer edge — the last flex child of
 * `#main-content`, so panels open inboard of it and the rail itself never
 * moves. That fixity is the point: a landmark that slides sideways every
 * time a panel toggles cannot build muscle memory.
 *
 * The semantic split: the left sidebar rail is the *project's content*
 * (projects, files, changes, agent); this rail is *Frame's own instruments*.
 *
 * These six destinations used to live behind the `⋯` overflow menu in
 * terminalTabBar — invisible until found. They are deliberately *moved*, not
 * duplicated: two entry points to the same six things is the worst outcome,
 * so the menu and its toggle button are gone.
 *
 * The six are not homogeneous — Specs and Tasks open full-screen dashboards,
 * Claude/GitHub/Prompts open side panels, Overview flips a view mode — so
 * the rail is a launcher, not a mode switcher, and a separator keeps
 * Activity (an observation tool, not a destination) in its own group.
 *
 * Expanding widens the rail just far enough to show the names. It is not a
 * panel and never grows content; the state persists in localStorage, the
 * same mechanic laneRail and sectionRail already use.
 */

const {
  Activity,
  FileText,
  CheckSquare,
  Sparkles,
  Github,
  MessageSquare,
  LayoutGrid,
  Sun,
  Moon,
  PanelLeftOpen,
  PanelLeftClose
} = require('lucide');

const activityPanel = require('./activityPanel');
const specsDashboard = require('./specsDashboard');
const tasksDashboard = require('./tasksDashboard');
const pluginsPanel = require('./pluginsPanel');
const githubPanel = require('./githubPanel');
const promptsPanel = require('./promptsPanel');

const STORAGE_KEY = 'frame.instrumentRail';

let railEl = null;
let initialized = false;
let expanded = false;
let hooks = {}; // { onOverviewToggle, isOverviewVisible } — owned by multiTerminalUI

function lucideIcon(data, size = 18) {
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

function readExpanded() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').expanded === true;
  } catch {
    return false;
  }
}

function writeExpanded(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ expanded: value }));
  } catch {
    /* a preference is never worth an exception */
  }
}

function safeCall(fn) {
  try {
    return typeof fn === 'function' ? Boolean(fn()) : false;
  } catch {
    return false;
  }
}

/**
 * `visible` is optional on purpose: not every destination exposes an
 * open/closed state, and a dashboard that reports nothing simply never
 * lights up rather than lying about it.
 */
const ITEMS = [
  { key: 'specs', label: 'Specs', icon: FileText, action: () => specsDashboard.toggle() },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare, action: () => tasksDashboard.toggle() },
  {
    key: 'claude',
    label: 'Claude',
    icon: Sparkles,
    action: () => pluginsPanel.toggle(),
    visible: () => safeCall(pluginsPanel.getIsVisible)
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: Github,
    action: () => githubPanel.toggle(),
    visible: () => safeCall(githubPanel.getIsVisible)
  },
  {
    key: 'prompts',
    label: 'Prompts',
    icon: MessageSquare,
    action: () => promptsPanel.toggle(),
    visible: () => safeCall(promptsPanel.getIsVisible)
  },
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    action: () => hooks.onOverviewToggle && hooks.onOverviewToggle(),
    // Overview is a view mode, not a panel — without this hook it would be
    // the one item that never reflects its own state.
    visible: () => safeCall(hooks.isOverviewVisible)
  },
  { separator: true },
  {
    key: 'activity',
    label: 'Activity',
    icon: Activity,
    action: () => activityPanel.toggle(),
    visible: () => activityPanel.isVisible()
  }
];

function itemHtml(item) {
  if (item.separator) return '<div class="instrument-rail-sep" role="separator"></div>';
  const active = item.visible ? item.visible() : false;
  const label = expanded ? `<span class="instrument-rail-label">${item.label}</span>` : '';
  return `<button type="button" class="instrument-rail-btn${active ? ' active' : ''}" data-instrument="${item.key}" title="${item.label}" aria-label="${item.label}" tabindex="-1">${lucideIcon(item.icon)}${label}</button>`;
}

// ─── theme ────────────────────────────────────────────────
//
// Moved here from terminalTabBar's overflow menu, which was its only home.
// terminalManager already observes `data-theme` on the root element, so
// flipping the attribute is the whole contract — nothing else to notify.

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('frame-theme', next);
  } catch {
    /* a preference is never worth an exception */
  }
}

/** The rail's bottom cluster: settings-ish controls, not destinations. */
function footerHtml() {
  const dark = currentTheme() === 'dark';
  const themeTitle = dark ? 'Switch to light mode' : 'Switch to dark mode';
  const themeLabel = expanded ? `<span class="instrument-rail-label">${dark ? 'Light mode' : 'Dark mode'}</span>` : '';
  const theme = `<button type="button" class="instrument-rail-btn" data-rail-theme title="${themeTitle}" aria-label="${themeTitle}" tabindex="-1">${lucideIcon(dark ? Sun : Moon)}${themeLabel}</button>`;

  const railTitle = expanded ? 'Collapse the rail' : 'Expand to show names';
  const railLabel = expanded ? '<span class="instrument-rail-label">Collapse</span>' : '';
  const toggle = `<button type="button" class="instrument-rail-btn instrument-rail-toggle" data-rail-toggle title="${railTitle}" aria-label="${railTitle}" tabindex="-1">${lucideIcon(expanded ? PanelLeftOpen : PanelLeftClose)}${railLabel}</button>`;

  return `<div class="instrument-rail-footer">${theme}${toggle}</div>`;
}

function render() {
  if (!railEl) return;
  railEl.classList.toggle('expanded', expanded);
  // Destinations at the top, controls at the bottom: putting the expand
  // toggle up top would compete with the first destination and push the
  // most-used icon down.
  railEl.innerHTML = `<div class="instrument-rail-items">${ITEMS.map(itemHtml).join('')}</div>${footerHtml()}`;
}

function init(options) {
  if (options) hooks = options;
  if (initialized) {
    render();
    return;
  }
  railEl = document.getElementById('instrument-rail');
  if (!railEl) return;
  initialized = true;
  expanded = readExpanded();

  railEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-rail-toggle]')) {
      expanded = !expanded;
      writeExpanded(expanded);
      render();
      return;
    }
    if (e.target.closest('[data-rail-theme]')) {
      toggleTheme();
      render(); // swap sun/moon
      return;
    }
    const btn = e.target.closest('[data-instrument]');
    if (!btn) return;
    const item = ITEMS.find((i) => i.key === btn.dataset.instrument);
    if (!item) return;
    item.action();
    render(); // reflect the new open/closed state on the icons
  });

  render();
}

module.exports = { init, render };
