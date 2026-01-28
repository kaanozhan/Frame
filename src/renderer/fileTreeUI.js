/**
 * File Tree UI Module
 * Renders collapsible file tree in sidebar
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let fileTreeElement = null;
let currentProjectPath = null;
let onFileClickCallback = null;
let focusedItem = null;

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
 * Get all visible file items (for navigation)
 */
function getVisibleItems() {
  if (!fileTreeElement) return [];
  const allItems = fileTreeElement.querySelectorAll('.file-item');
  return Array.from(allItems).filter(item => {
    // Check if parent folder is expanded
    let parent = item.parentElement;
    while (parent && parent !== fileTreeElement) {
      if (parent.classList.contains('folder-children') && parent.style.display === 'none') {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
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
