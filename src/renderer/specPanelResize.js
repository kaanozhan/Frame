/**
 * Specs Panel Resize Module
 *
 * Mirror of the sidebar resize pattern but for the right-anchored Specs
 * panel. Drag the left edge of the panel to grow/shrink it. Width persists
 * to localStorage so it survives reloads. Double-click resets to default.
 */

const STORAGE_KEY = 'specs-panel-width';
const MIN_WIDTH = 360;
const MAX_WIDTH = 1000;
const DEFAULT_WIDTH = 420;
const WIDE_WIDTH = 800;
// Threshold for "is the panel currently in wide mode?" — anything ≥ this is
// considered wide. Used to flip the toolbar button's intent.
const WIDE_THRESHOLD = 600;

let panelEl = null;
let handleEl = null;
let toggleBtnEl = null;
let isResizing = false;
let startX = 0;
let startWidth = 0;

function init() {
  panelEl = document.getElementById('specs-panel');
  handleEl = document.getElementById('specs-panel-resize-handle');
  toggleBtnEl = document.getElementById('specs-wide-toggle');
  if (!panelEl || !handleEl) return;

  // Restore saved width
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= MIN_WIDTH && w <= MAX_WIDTH) {
      panelEl.style.width = `${w}px`;
    }
  }
  refreshToggleIcon();

  handleEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  handleEl.addEventListener('dblclick', resetWidth);

  if (toggleBtnEl) {
    toggleBtnEl.addEventListener('click', toggleWide);
  }
}

function onMouseDown(e) {
  e.preventDefault();
  isResizing = true;
  startX = e.clientX;
  startWidth = panelEl.offsetWidth;
  handleEl.classList.add('dragging');
  document.body.classList.add('sidebar-resizing'); // reuse the global cursor / no-select class
}

function onMouseMove(e) {
  if (!isResizing) return;
  // Panel is right-anchored: dragging the handle leftward grows the panel,
  // so width grows by the negative of deltaX.
  const deltaX = e.clientX - startX;
  let newWidth = startWidth - deltaX;
  newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
  panelEl.style.width = `${newWidth}px`;
}

function onMouseUp() {
  if (!isResizing) return;
  isResizing = false;
  handleEl.classList.remove('dragging');
  document.body.classList.remove('sidebar-resizing');
  localStorage.setItem(STORAGE_KEY, panelEl.offsetWidth.toString());
  refreshToggleIcon();
}

function resetWidth() {
  if (!panelEl) return;
  panelEl.style.width = `${DEFAULT_WIDTH}px`;
  localStorage.setItem(STORAGE_KEY, DEFAULT_WIDTH.toString());
  refreshToggleIcon();
}

// One-tap expand / compact. Flips between the default narrow width and a
// preset wide width. Drag handle still works for fine-tuning.
function toggleWide() {
  if (!panelEl) return;
  const currentWidth = panelEl.offsetWidth;
  const target = currentWidth >= WIDE_THRESHOLD ? DEFAULT_WIDTH : WIDE_WIDTH;
  panelEl.style.width = `${target}px`;
  localStorage.setItem(STORAGE_KEY, target.toString());
  refreshToggleIcon();
}

function refreshToggleIcon() {
  if (!toggleBtnEl || !panelEl) return;
  const isWide = panelEl.offsetWidth >= WIDE_THRESHOLD;
  toggleBtnEl.classList.toggle('is-wide', isWide);
  toggleBtnEl.title = isWide ? 'Compact panel' : 'Expand panel';
  toggleBtnEl.setAttribute('aria-label', toggleBtnEl.title);
}

module.exports = { init, resetWidth, toggleWide };
