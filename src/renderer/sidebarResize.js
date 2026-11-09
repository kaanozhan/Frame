/**
 * Sidebar Resize Module
 * Allows users to drag and resize the sidebar width.
 *
 * Hide / show collapse the sidebar to its rail (2026-09-14, overturning the
 * shell-chrome spec's "fully hidden"): `#sidebar.collapsed` keeps the icon
 * rail (Projects / Files / Changes / GitHub …) and drops the panel beside
 * it, VS Code activity-bar style — a rail click reveals the panel again
 * (index.js revealSidebarTab → show()). The CSS for the collapsed state
 * lives in layout.css; this module only flips the class and the width.
 *
 * Drag to collapse (2026-09-16): MIN_WIDTH is a detent, not a wall. The panel
 * stops there while the pointer keeps going; pull COLLAPSE_PULL px past it
 * and the sidebar collapses to the rail mid-drag, as if toggled. Keep dragging back out (or
 * grab the handle beside the rail later) and once the pointer comes back
 * within REOPEN_PULL of the detent, it reopens at MIN_WIDTH and follows.
 */

const STORAGE_KEY = 'sidebar-width';
const HIDDEN_KEY = 'sidebar-hidden';
const MIN_WIDTH = 231;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;
// How far past MIN_WIDTH the pointer must go before the sidebar collapses:
// with MIN_WIDTH 231 that is onto the icon rail, near the most the window
// leaves room for (~240px to its left edge).
const COLLAPSE_PULL = 190;
// While collapsed, how close to MIN_WIDTH the pointer must come to reopen.
// Less than COLLAPSE_PULL, so the two thresholds don't flicker at one spot.
const REOPEN_PULL = 50;

let sidebar = null;
let isHidden = false;
let widthBeforeHide = DEFAULT_WIDTH;
let resizeHandle = null;
let isResizing = false;
let startX = 0;
let startWidth = 0;
// Width at mousedown when the drag began expanded — what ⌘B restores after a
// drag that ended collapsed.
let dragRestoreWidth = DEFAULT_WIDTH;
let onResizeCallback = null;
const listeners = new Set();

/** Tell every onChange listener whether the sidebar is now visible. */
function emitChange() {
  const visible = !isHidden;
  listeners.forEach((fn) => {
    try { fn(visible); } catch (err) { console.error('sidebarResize: onChange listener failed:', err); }
  });
}

/**
 * Initialize sidebar resize functionality
 * @param {Function} onResize - Optional callback when resize completes
 */
function init(onResize) {
  sidebar = document.getElementById('sidebar');
  resizeHandle = document.getElementById('sidebar-resize-handle');
  onResizeCallback = onResize;

  if (!sidebar || !resizeHandle) {
    console.error('Sidebar resize: Required elements not found');
    return;
  }

  // Restore saved width
  const savedWidth = localStorage.getItem(STORAGE_KEY);
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
      sidebar.style.width = `${width}px`;
      widthBeforeHide = width;
    }
  }

  // Restore hidden state
  const savedHidden = localStorage.getItem(HIDDEN_KEY);
  if (savedHidden === 'true') {
    isHidden = true;
    sidebar.style.width = '';
    sidebar.classList.add('collapsed');
  }

  // Setup event listeners
  resizeHandle.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  // Handle double-click to reset width
  resizeHandle.addEventListener('dblclick', resetWidth);
}

/**
 * Handle mouse down on resize handle
 * @param {MouseEvent} e
 */
function handleMouseDown(e) {
  e.preventDefault();
  isResizing = true;
  startX = e.clientX;
  startWidth = sidebar.offsetWidth;
  dragRestoreWidth = isHidden ? widthBeforeHide : startWidth;

  resizeHandle.classList.add('dragging');
  document.body.classList.add('sidebar-resizing');
}

/**
 * Handle mouse move during resize
 * @param {MouseEvent} e
 */
function handleMouseMove(e) {
  if (!isResizing) return;

  // Where the panel's right edge would be if it followed the pointer exactly.
  // The sidebar's left edge never moves, so this holds across a mid-drag
  // collapse / reopen too.
  const pulled = startWidth + (e.clientX - startX);

  if (isHidden) {
    if (pulled < MIN_WIDTH - REOPEN_PULL) return;
    widthBeforeHide = MIN_WIDTH;
    show();
    return;
  }

  if (pulled < MIN_WIDTH - COLLAPSE_PULL) {
    hide();
    widthBeforeHide = dragRestoreWidth >= MIN_WIDTH ? dragRestoreWidth : DEFAULT_WIDTH;
    return;
  }

  const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pulled));

  sidebar.style.width = `${newWidth}px`;
}

/**
 * Handle mouse up to finish resize
 * @param {MouseEvent} e
 */
function handleMouseUp(e) {
  if (!isResizing) return;

  isResizing = false;
  resizeHandle.classList.remove('dragging');
  document.body.classList.remove('sidebar-resizing');

  // Ended collapsed: hide() already saved that and refit the terminal.
  if (isHidden) {
    localStorage.setItem(STORAGE_KEY, widthBeforeHide.toString());
    return;
  }

  // Save width to localStorage
  const currentWidth = sidebar.offsetWidth;
  localStorage.setItem(STORAGE_KEY, currentWidth.toString());

  // Trigger resize callback
  if (onResizeCallback) {
    onResizeCallback(currentWidth);
  }
}

/**
 * Reset sidebar width to default
 */
function resetWidth() {
  if (isHidden) {
    widthBeforeHide = DEFAULT_WIDTH;
    localStorage.setItem(STORAGE_KEY, DEFAULT_WIDTH.toString());
    show();
    return;
  }

  sidebar.style.width = `${DEFAULT_WIDTH}px`;
  localStorage.setItem(STORAGE_KEY, DEFAULT_WIDTH.toString());

  if (onResizeCallback) {
    onResizeCallback(DEFAULT_WIDTH);
  }
}

/**
 * Get current sidebar width
 * @returns {number}
 */
function getWidth() {
  return sidebar ? sidebar.offsetWidth : DEFAULT_WIDTH;
}

/**
 * Set sidebar width programmatically
 * @param {number} width
 */
function setWidth(width) {
  if (!sidebar) return;

  const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
  sidebar.style.width = `${clampedWidth}px`;
  localStorage.setItem(STORAGE_KEY, clampedWidth.toString());

  if (onResizeCallback) {
    onResizeCallback(clampedWidth);
  }
}

/**
 * Toggle sidebar visibility
 */
function toggle() {
  if (!sidebar) return;

  if (isHidden) {
    show();
  } else {
    hide();
  }
}

/**
 * Collapse the sidebar to its rail (the panel goes, the icons stay).
 *
 * `{ persist: false }` collapses without touching the stored preference — for
 * the automatic collapse while the registry has no projects, where the panel
 * has nothing to show. A rule the app applied on the user's behalf must not
 * come back as the user's own setting after they add a project.
 */
function hide({ persist = true } = {}) {
  if (!sidebar || isHidden) return;

  widthBeforeHide = sidebar.offsetWidth;
  sidebar.style.width = '';
  sidebar.classList.add('collapsed');
  isHidden = true;
  if (persist) localStorage.setItem(HIDDEN_KEY, 'true');

  if (onResizeCallback) {
    onResizeCallback(0);
  }
  emitChange();
}

/**
 * Bring the panel back at the width it had before collapsing.
 */
function show({ persist = true } = {}) {
  if (!sidebar || !isHidden) return;

  sidebar.classList.remove('collapsed');
  sidebar.style.width = `${widthBeforeHide}px`;
  isHidden = false;
  if (persist) localStorage.setItem(HIDDEN_KEY, 'false');

  if (onResizeCallback) {
    onResizeCallback(widthBeforeHide);
  }
  emitChange();
}

/**
 * Check if sidebar is hidden
 */
function isVisible() {
  return !isHidden;
}

/**
 * Follow the sidebar: fn(visible) after every hide / show, whichever entry
 * point caused it (⌘B, the View menu, the palette, the header's toggle).
 * Same shape as dock.onChange; returns an unsubscribe. Not called for the
 * state restored at init — read isVisible() for that.
 */
function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = {
  init,
  getWidth,
  setWidth,
  resetWidth,
  toggle,
  hide,
  show,
  isVisible,
  onChange
};
