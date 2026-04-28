/**
 * File Tree UI Module
 * Renders collapsible file tree in sidebar
 */

const { ipcRenderer, clipboard } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let fileTreeElement = null;
let currentProjectPath = null;
let onFileClickCallback = null;
let focusedItem = null;

// Search filter state
let searchInput = null;
let searchClearBtn = null;
let searchWrapper = null;
let currentQuery = '';

// Context menu state
let contextMenuEl = null;
let contextMenuPath = null;

/**
 * Initialize file tree UI
 */
function init(elementId, getProjectPath) {
  fileTreeElement = document.getElementById(elementId);

  // Store reference to get current project path
  if (typeof getProjectPath === 'function') {
    currentProjectPath = getProjectPath;
  }

  setupIPC();
  setupSearch();
  setupContextMenu();
}

/**
 * Set project path getter
 */
function setProjectPathGetter(getter) {
  currentProjectPath = getter;
}

/**
 * Set file click callback
 */
function setOnFileClick(callback) {
  onFileClickCallback = callback;
}

/**
 * Render file tree recursively
 */
function renderFileTree(files, parentElement, indent = 0) {
  files.forEach(file => {
    // Create wrapper for folder + children
    const wrapper = document.createElement('div');
    wrapper.className = 'file-wrapper';

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item' + (file.isDirectory ? ' folder' : '');
    fileItem.style.paddingLeft = `${8 + indent * 16}px`;
    fileItem.tabIndex = 0; // Make focusable
    fileItem.dataset.path = file.path;

    // Add arrow for folders
    if (file.isDirectory) {
      const arrow = document.createElement('span');
      arrow.textContent = '▶ ';
      arrow.style.fontSize = '10px';
      arrow.style.marginRight = '4px';
      arrow.style.display = 'inline-block';
      arrow.style.transition = 'transform 0.2s';
      arrow.className = 'folder-arrow';
      fileItem.appendChild(arrow);
    }

    // File icon
    const icon = document.createElement('span');
    if (file.isDirectory) {
      icon.className = 'file-icon folder-icon';
    } else {
      const ext = file.name.split('.').pop();
      icon.className = `file-icon file-icon-${ext}`;
      if (!['js', 'json', 'md'].includes(ext)) {
        icon.className = 'file-icon file-icon-default';
      }
    }

    // File name
    const name = document.createElement('span');
    name.textContent = file.name;

    fileItem.appendChild(icon);
    fileItem.appendChild(name);
    wrapper.appendChild(fileItem);

    // Context menu (right-click) — works for both files and folders
    fileItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, file.path);
    });

    // Create children container for folders
    if (file.isDirectory && file.children && file.children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'folder-children';
      childrenContainer.style.display = 'none'; // Start collapsed

      // Recursively render children
      renderFileTree(file.children, childrenContainer, indent + 1);
      wrapper.appendChild(childrenContainer);

      // Toggle folder on click
      fileItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const arrow = fileItem.querySelector('.folder-arrow');
        const isExpanded = childrenContainer.style.display !== 'none';

        if (isExpanded) {
          childrenContainer.style.display = 'none';
          arrow.style.transform = 'rotate(0deg)';
        } else {
          childrenContainer.style.display = 'block';
          arrow.style.transform = 'rotate(90deg)';
        }
      });
    } else if (!file.isDirectory) {
      // File click handler - open in editor
      fileItem.addEventListener('click', () => {
        if (onFileClickCallback) {
          onFileClickCallback(file.path, 'fileTree');
        }
      });
    }

    parentElement.appendChild(wrapper);
  });
}

/**
 * Clear file tree
 */
function clearFileTree() {
  if (fileTreeElement) {
    fileTreeElement.innerHTML = '';
  }
}

/**
 * Refresh file tree
 */
function refreshFileTree(projectPath) {
  const path = projectPath || (currentProjectPath && currentProjectPath());
  if (path) {
    ipcRenderer.send(IPC.LOAD_FILE_TREE, path);
  }
}

/**
 * Load file tree for path
 */
function loadFileTree(projectPath) {
  ipcRenderer.send(IPC.LOAD_FILE_TREE, projectPath);
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.FILE_TREE_DATA, (event, files) => {
    clearFileTree();
    renderFileTree(files, fileTreeElement);
    // Re-apply any active search filter to the new tree
    if (currentQuery) applyFilter(currentQuery);
  });
}

/**
 * Focus file tree for keyboard navigation
 */
function focus() {
  if (!fileTreeElement) return;

  const items = getVisibleItems();
  if (items.length === 0) return;

  // If we have a previously focused item that's still in the DOM, use it
  let targetItem = null;
  if (focusedItem && fileTreeElement.contains(focusedItem)) {
    targetItem = focusedItem;
  } else {
    targetItem = items[0];
  }

  targetItem.focus();
  targetItem.classList.add('focused');
  focusedItem = targetItem;

  // Setup keyboard navigation (one-time)
  if (!fileTreeElement.dataset.keyboardSetup) {
    fileTreeElement.dataset.keyboardSetup = 'true';
    fileTreeElement.addEventListener('keydown', handleKeydown);
  }
}

/**
 * Get all visible file items (for navigation). Uses offsetParent so it
 * naturally skips items hidden by the search filter as well as items
 * inside collapsed folders.
 */
function getVisibleItems() {
  if (!fileTreeElement) return [];
  const allItems = fileTreeElement.querySelectorAll('.file-item');
  return Array.from(allItems).filter((item) => item.offsetParent !== null);
}

/**
 * Handle keyboard navigation in file tree
 */
function handleKeydown(e) {
  const items = getVisibleItems();
  const currentIndex = items.indexOf(focusedItem);

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    focusedItem?.classList.remove('focused');

    let newIndex;
    if (e.key === 'ArrowDown') {
      newIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    }

    focusedItem = items[newIndex];
    focusedItem?.focus();
    focusedItem?.classList.add('focused');
  }

  if (e.key === 'ArrowRight' && focusedItem?.classList.contains('folder')) {
    // Expand folder
    e.preventDefault();
    const wrapper = focusedItem.parentElement;
    const children = wrapper.querySelector('.folder-children');
    const arrow = focusedItem.querySelector('.folder-arrow');
    if (children && children.style.display === 'none') {
      children.style.display = 'block';
      if (arrow) arrow.style.transform = 'rotate(90deg)';
    }
  }

  if (e.key === 'ArrowLeft' && focusedItem?.classList.contains('folder')) {
    // Collapse folder
    e.preventDefault();
    const wrapper = focusedItem.parentElement;
    const children = wrapper.querySelector('.folder-children');
    const arrow = focusedItem.querySelector('.folder-arrow');
    if (children && children.style.display !== 'none') {
      children.style.display = 'none';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
    }
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    focusedItem?.click();
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    focusedItem?.classList.remove('focused');
    // Return focus to terminal
    if (typeof window.terminalFocus === 'function') {
      window.terminalFocus();
    }
  }
}

/**
 * Blur/unfocus file tree
 */
function blur() {
  focusedItem?.classList.remove('focused');
  focusedItem = null;
}

// Expose focus function globally for editor to restore focus
window.fileTreeFocus = focus;

/* ──────────────────────── Search filter ──────────────────────── */

function setupSearch() {
  searchInput = document.getElementById('file-tree-search');
  searchClearBtn = document.getElementById('file-tree-search-clear');
  searchWrapper = searchInput ? searchInput.parentElement : null;
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    applyFilter(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchInput.value = '';
      applyFilter('');
      searchInput.blur();
    }
  });

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      applyFilter('');
      searchInput.focus();
    });
  }
}

function applyFilter(query) {
  currentQuery = (query || '').trim().toLowerCase();
  if (searchWrapper) {
    searchWrapper.classList.toggle('has-query', currentQuery.length > 0);
  }
  if (!fileTreeElement) return;

  // Top-level wrappers walk recursively; each call returns whether the
  // subtree contains any matching item so ancestors can be revealed.
  const topWrappers = fileTreeElement.querySelectorAll(':scope > .file-wrapper');
  topWrappers.forEach((w) => filterWrapper(w, currentQuery));
}

function filterWrapper(wrapper, query) {
  const item = wrapper.querySelector(':scope > .file-item');
  const childContainer = wrapper.querySelector(':scope > .folder-children');
  if (!item) return false;

  // Last span is the name (after the optional arrow + icon)
  const nameEl = item.querySelector('span:last-child');
  const name = nameEl ? nameEl.textContent.toLowerCase() : '';
  const selfMatches = !query || name.includes(query);

  let descendantMatches = false;
  if (childContainer) {
    const childWrappers = childContainer.querySelectorAll(':scope > .file-wrapper');
    childWrappers.forEach((c) => {
      if (filterWrapper(c, query)) descendantMatches = true;
    });
  }

  const visible = !query || selfMatches || descendantMatches;
  wrapper.style.display = visible ? '' : 'none';

  // Auto-expand folders with descendant matches while filtering;
  // restore display state when query is cleared.
  if (childContainer) {
    if (query && descendantMatches) {
      childContainer.style.display = 'block';
      const arrow = item.querySelector('.folder-arrow');
      if (arrow) arrow.style.transform = 'rotate(90deg)';
    }
  }

  return visible;
}

/* ──────────────────────── Context menu ──────────────────────── */

function setupContextMenu() {
  contextMenuEl = document.getElementById('file-tree-context-menu');
  if (!contextMenuEl) return;

  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleContextMenuAction(btn.dataset.action);
      hideContextMenu();
    });
  });

  // Dismiss on outside click / scroll / Esc / window blur
  document.addEventListener('mousedown', (e) => {
    if (!contextMenuEl.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextMenuEl.classList.contains('visible')) {
      hideContextMenu();
    }
  });
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('scroll', hideContextMenu, true);
}

function showContextMenu(x, y, path) {
  if (!contextMenuEl) return;
  contextMenuPath = path;

  // Position first off-screen so we can measure its actual size,
  // then clamp to viewport to avoid overflow on right/bottom edges.
  contextMenuEl.style.left = '-9999px';
  contextMenuEl.style.top = '-9999px';
  contextMenuEl.classList.add('visible');

  const rect = contextMenuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  contextMenuEl.style.left = `${Math.min(x, maxX)}px`;
  contextMenuEl.style.top = `${Math.min(y, maxY)}px`;
}

function hideContextMenu() {
  if (!contextMenuEl) return;
  contextMenuEl.classList.remove('visible');
  contextMenuPath = null;
}

function handleContextMenuAction(action) {
  if (action === 'copy-path' && contextMenuPath) {
    try {
      clipboard.writeText(contextMenuPath);
    } catch (e) {
      console.error('Failed to copy filepath', e);
    }
  }
}

module.exports = {
  init,
  setProjectPathGetter,
  setOnFileClick,
  renderFileTree,
  clearFileTree,
  refreshFileTree,
  loadFileTree,
  focus,
  blur
};
