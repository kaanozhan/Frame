/**
 * Sidebar Resize Module
 * Allows users to drag and resize the sidebar width
 */

const STORAGE_KEY = 'sidebar-width';
const HIDDEN_KEY = 'sidebar-hidden';
const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 260;

let sidebar = null;
let isHidden = false;
let widthBeforeHide = DEFAULT_WIDTH;
let resizeHandle = null;
let isResizing = false;
let startX = 0;
let startWidth = 0;
let onResizeCallback = null;

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
    sidebar.style.display = 'none';
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

  resizeHandle.classList.add('dragging');
  document.body.classList.add('sidebar-resizing');
}

/**
 * Handle mouse move during resize
 * @param {MouseEvent} e
 */
function handleMouseMove(e) {
  if (!isResizing) return;

  const deltaX = e.clientX - startX;
  let newWidth = startWidth + deltaX;

  // Clamp to min/max
  newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));

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
 * Hide sidebar
 */
function hide() {
  if (!sidebar || isHidden) return;

  widthBeforeHide = sidebar.offsetWidth;
  sidebar.style.display = 'none';
  isHidden = true;
  localStorage.setItem(HIDDEN_KEY, 'true');

  if (onResizeCallback) {
    onResizeCallback(0);
  }
}

/**
 * Show sidebar
 */
function show() {
  if (!sidebar || !isHidden) return;

  sidebar.style.display = '';
  sidebar.style.width = `${widthBeforeHide}px`;
  isHidden = false;
  localStorage.setItem(HIDDEN_KEY, 'false');

  if (onResizeCallback) {
    onResizeCallback(widthBeforeHide);
  }
}

/**
 * Check if sidebar is hidden
 */
function isVisible() {
  return !isHidden;
}

module.exports = {
  init,
  getWidth,
  setWidth,
  resetWidth,
  toggle,
  hide,
  show,
  isVisible
};
