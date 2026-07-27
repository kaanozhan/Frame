/**
 * Activity Panel
 *
 * Shows the work Frame does on its own — watchers firing, spec phases it
 * reconciled, state it quietly recovered, hooks that ran in processes the
 * app never sees. Deliberately not a log viewer: the default view is the
 * labelled sentences, and the raw records live behind a toggle.
 *
 * Suppressions (a guard that prevented work) render muted rather than
 * hidden. Without them the panel would show silence, and silence means
 * either "healthy and nothing needed" or "dead" — the one question this
 * panel exists to answer.
 *
 * A side panel, never a modal: activity is what you watch *while* an agent
 * works, so it must not take the terminal away.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { escapeHtml } = require('./htmlUtils');

const MAX_ROWS = 500;

let panelEl = null;
let listEl = null;
let emptyEl = null;
let countEl = null;
let entries = [];
let showDetail = false;
let sourceFilter = 'all';
let initialized = false;

// Event name → the group the source filter offers. Kept here rather than in
// the shared registry: this is a presentation grouping, not policy.
const SOURCE_GROUPS = {
  'hint.injected': 'hooks',
  'hint.quiet': 'hooks',
  'script.ran': 'hooks',
  'watch.fired': 'watchers',
  'watch.suppressed': 'watchers',
  'poll.skipped': 'watchers',
  'spec.phase_reconciled': 'specs',
  'index.rebuilt': 'specs',
  'index.fresh': 'specs',
  'state.recovered': 'recovery',
  'state.corrupt_preserved': 'recovery'
};

const FILTERS = [
  ['all', 'All'],
  ['hooks', 'Hooks'],
  ['watchers', 'Watchers'],
  ['specs', 'Specs'],
  ['recovery', 'Recovery']
];

function groupOf(entry) {
  return SOURCE_GROUPS[entry.ev] || 'other';
}

function visible(entry) {
  if (sourceFilter !== 'all' && groupOf(entry) !== sourceFilter) return false;
  // Default view is the labelled sentences; detail mode shows everything,
  // including events the registry deliberately left unlabelled.
  return showDetail || Boolean(entry.label);
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

/** The raw record, minus what the row already shows. */
function detailOf(entry) {
  const parts = [];
  for (const [key, value] of Object.entries(entry)) {
    if (['ev', 'kind', 'label', 't', 'v'].includes(key)) continue;
    parts.push(`${key}=${value}`);
  }
  return `${entry.ev}${parts.length ? ` · ${parts.join(' ')}` : ''}`;
}

function rowHtml(entry) {
  const suppressed = entry.kind === 'suppression';
  const cls = `activity-row${suppressed ? ' activity-row-suppressed' : ''}`;
  const text = entry.label || detailOf(entry);
  const detail = showDetail && entry.label ? `<div class="activity-row-detail">${escapeHtml(detailOf(entry))}</div>` : '';
  return `<div class="${cls}">
    <span class="activity-row-time">${escapeHtml(formatTime(entry.t))}</span>
    <span class="activity-row-body">
      <span class="activity-row-text">${escapeHtml(text)}</span>
      ${detail}
    </span>
  </div>`;
}

function render() {
  if (!listEl) return;
  const shown = entries.filter(visible).slice(-MAX_ROWS);
  listEl.innerHTML = shown.map(rowHtml).join('');
  listEl.scrollTop = listEl.scrollHeight;

  if (emptyEl) emptyEl.style.display = shown.length ? 'none' : 'block';
  if (countEl) {
    const suppressions = shown.filter((e) => e.kind === 'suppression').length;
    countEl.textContent = shown.length
      ? `${shown.length} event${shown.length === 1 ? '' : 's'}${suppressions ? ` · ${suppressions} suppressed` : ''}`
      : '';
  }
}

function addEntries(incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return;
  entries.push(...incoming);
  if (entries.length > MAX_ROWS * 4) entries.splice(0, entries.length - MAX_ROWS * 4);
  render();
}

async function loadBacklog() {
  try {
    const res = await ipcRenderer.invoke(IPC.GET_ACTIVITY);
    entries = Array.isArray(res && res.entries) ? res.entries : [];
    render();
  } catch {
    // A backlog we cannot read is an empty panel, not an error dialog.
    entries = [];
    render();
  }
}

function buildControls() {
  const filters = FILTERS.map(
    ([key, text]) =>
      `<button type="button" class="activity-filter-btn${key === sourceFilter ? ' active' : ''}" data-activity-filter="${key}" tabindex="-1">${text}</button>`
  ).join('');
  return `<div class="activity-filters">${filters}</div>
    <label class="activity-detail-toggle">
      <input type="checkbox" id="activity-detail-check" tabindex="-1">
      <span>Detailed</span>
    </label>`;
}

function wireControls() {
  const controls = panelEl.querySelector('.activity-controls');
  if (!controls) return;
  controls.innerHTML = buildControls();

  controls.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-activity-filter]');
    if (!btn) return;
    sourceFilter = btn.dataset.activityFilter;
    controls.querySelectorAll('[data-activity-filter]').forEach((b) => {
      b.classList.toggle('active', b.dataset.activityFilter === sourceFilter);
    });
    render();
  });

  const check = controls.querySelector('#activity-detail-check');
  if (check) {
    check.addEventListener('change', () => {
      showDetail = check.checked;
      render();
    });
  }
}

function init() {
  if (initialized) return;
  panelEl = document.getElementById('activity-panel');
  if (!panelEl) return;
  listEl = document.getElementById('activity-list');
  emptyEl = document.getElementById('activity-empty');
  countEl = document.getElementById('activity-count');
  initialized = true;

  wireControls();

  const close = document.getElementById('activity-close');
  if (close) close.addEventListener('click', hide);

  // Batches arrive coalesced from main; appending is the only work the
  // renderer does per batch.
  ipcRenderer.on(IPC.ACTIVITY_DATA, (_e, payload) => {
    addEntries(payload && payload.entries);
  });

  // The record keeps filling whether or not the panel is open, so the
  // backlog is fetched once at startup rather than on first show.
  loadBacklog();
}

function show() {
  init();
  if (!panelEl) return;
  panelEl.classList.add('visible');
  loadBacklog();
}

function hide() {
  if (panelEl) panelEl.classList.remove('visible');
}

function toggle() {
  init();
  if (!panelEl) return;
  if (panelEl.classList.contains('visible')) hide();
  else show();
}

function isVisible() {
  return Boolean(panelEl && panelEl.classList.contains('visible'));
}

module.exports = { init, show, hide, toggle, isVisible };
