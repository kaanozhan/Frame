/**
 * File Tree UI Module
 * Renders collapsible file tree in sidebar
 */

const { ipcRenderer, clipboard, shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const notify = require('./notify');
const taskConfirmModal = require('./taskConfirmModal');

let fileTreeElement = null;
let currentProjectPath = null;
// The workspace the shown tree belongs to: every call about it carries this
// id, so main routes by workspace, not by path (server-hardening T6).
let treeWorkspaceId = null;
// The folder the tree is waiting for: a reply for any other root (a late
// answer after a workspace switch) is dropped; null while a note is shown
// (server-hardening T7).
let expectedRoot = null;
let workspaceIdGetter = null;
const treeCtx = () => {
  const id = treeWorkspaceId || (workspaceIdGetter && workspaceIdGetter()) || null;
  return id ? { workspaceId: id } : null;
};
let onFileClickCallback = null;
let focusedItem = null;

// Search filter state
let searchInput = null;
let searchClearBtn = null;
let searchWrapper = null;
let currentQuery = '';

// Context menu state — the right-clicked entry ({ path, isDirectory }), or
// { root: true } for the tree's empty space (the project folder itself)
let contextMenuEl = null;
let contextMenuTarget = null;

// In-app cut/copy clipboard: { path, mode: 'cut' | 'copy' } awaiting a paste
let fileClipboard = null;
// Folder to open on the next render — a paste target that may have been
// empty (no children container to expand yet)
let pendingExpandPath = null;

// Git status decoration cache (relative path -> classification)
let gitStatusFiles = {};
let gitStatusProjectPath = null;
const GIT_STATUS_CLASSES = [
  'git-modified',
  'git-added',
  'git-untracked',
  'git-deleted',
  'git-renamed',
  'git-conflict',
  'git-ignored',
  'git-has-changes'
];

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

/** Where the selected workspace's id comes from when a load names none. */
function setWorkspaceIdGetter(getter) {
  workspaceIdGetter = getter;
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
      showContextMenu(e.clientX, e.clientY, { path: file.path, isDirectory: file.isDirectory });
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
 *
 * Called on every FILE_TREE_DATA render to reset the DOM/state before
 * re-rendering, so it must NOT stop git-status watching by default —
 * doing so would kill the poll loop right after loadFileTree() started it.
 * Pass `{ unwatch: true }` only when truly leaving a project.
 */
function clearFileTree({ unwatch = false } = {}) {
  if (fileTreeElement) {
    fileTreeElement.innerHTML = '';
  }
  gitStatusFiles = {};
  gitStatusProjectPath = null;
  if (unwatch) {
    ipcRenderer.send(IPC.UNWATCH_GIT_STATUS);
  }
}

/**
 * Refresh file tree
 */
function refreshFileTree(projectPath) {
  const path = projectPath || (currentProjectPath && currentProjectPath());
  if (path) {
    // A refresh never replaces the server-offline note; selecting the
    // workspace again (loadFileTree) does.
    if (!projectPath && offlineNoteShown()) return;
    expectedRoot = path;
    ipcRenderer.send(IPC.LOAD_FILE_TREE, path, treeCtx());
  }
}

function offlineNoteShown() {
  return !!(fileTreeElement && fileTreeElement.querySelector('.ws-server-placeholder.offline'));
}

/**
 * Load file tree for path
 */
function loadFileTree(projectPath, workspaceId = null) {
  treeWorkspaceId = workspaceId || (workspaceIdGetter && workspaceIdGetter()) || null;
  expectedRoot = projectPath;
  ipcRenderer.send(IPC.LOAD_FILE_TREE, projectPath, treeCtx());
  ipcRenderer.send(IPC.WATCH_GIT_STATUS, projectPath, treeCtx());
}

/**
 * Show a note instead of the tree (a server workspace offline, an error).
 * Replies still in flight are dropped, so they cannot wipe the note.
 */
function showNote(text, className = 'ws-server-placeholder') {
  expectedRoot = null;
  clearFileTree();
  if (!fileTreeElement) return;
  const note = document.createElement('div');
  note.className = className;
  note.textContent = text;
  fileTreeElement.replaceChildren(note);
}

/** The `{ workspaceId }` of the shown tree, for files opened from it. */
function getTreeContext() {
  return treeCtx();
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.FILE_TREE_DATA, (event, payload) => {
    // `{ root, files, error }`; the project-open path still sends a bare array.
    const reply = Array.isArray(payload) ? { root: null, files: payload, error: null } : (payload || {});
    if (reply.root) {
      if (reply.root !== expectedRoot) return; // another folder's late answer, or a note is up
    } else if (offlineNoteShown()) {
      return; // a bare project tree must not replace the offline note either
    }
    if (reply.error) {
      showNote(`Could not read this workspace's files: ${reply.error}`, 'ws-server-placeholder tree-error');
      expectedRoot = reply.root || null;
      return;
    }
    const files = reply.files || [];
    // A re-render (refresh, or after a rename/paste/delete) keeps the open
    // folders and the scroll position instead of collapsing everything.
    const expanded = getExpandedFolderPaths();
    if (pendingExpandPath) {
      expanded.add(pendingExpandPath);
      pendingExpandPath = null;
    }
    const scrollTop = fileTreeElement ? fileTreeElement.scrollTop : 0;
    clearFileTree();
    renderFileTree(files, fileTreeElement);
    restoreExpandedFolders(expanded);
    applyCutDecoration();
    if (fileTreeElement) fileTreeElement.scrollTop = scrollTop;
    // Re-apply any active search filter to the new tree
    if (currentQuery) applyFilter(currentQuery);
    // Re-apply git decoration to the new tree
    applyGitStatusDecoration();
  });

  ipcRenderer.on(IPC.GIT_STATUS_DATA, (event, payload) => {
    if (!payload) return;
    gitStatusProjectPath = payload.projectPath;
    gitStatusFiles = payload.isRepo ? (payload.files || {}) : {};
    applyGitStatusDecoration();
  });
}

function setFolderExpanded(folderItem, expanded) {
  const children = folderItem.parentElement.querySelector(':scope > .folder-children');
  const arrow = folderItem.querySelector('.folder-arrow');
  if (!children) return;
  children.style.display = expanded ? 'block' : 'none';
  if (arrow) arrow.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)';
}

function getExpandedFolderPaths() {
  if (!fileTreeElement) return new Set();
  const paths = new Set();
  fileTreeElement.querySelectorAll('.folder-children').forEach((children) => {
    if (children.style.display === 'none') return;
    const item = children.parentElement.querySelector(':scope > .file-item');
    if (item) paths.add(item.dataset.path);
  });
  return paths;
}

function restoreExpandedFolders(paths) {
  if (!fileTreeElement || paths.size === 0) return;
  fileTreeElement.querySelectorAll('.file-item.folder').forEach((item) => {
    if (paths.has(item.dataset.path)) setFolderExpanded(item, true);
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

  const revealBtn = contextMenuEl.querySelector('[data-action="reveal"]');
  if (revealBtn && process.platform !== 'darwin') {
    revealBtn.textContent = process.platform === 'win32' ? 'Reveal in File Explorer' : 'Reveal in File Manager';
  }

  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = contextMenuTarget;
      hideContextMenu();
      handleContextMenuAction(btn.dataset.action, target);
    });
  });

  // Right-click on the tree's empty space targets the project folder itself —
  // the only thing to do there is paste. Rows stop propagation, so this only
  // sees clicks outside them.
  if (fileTreeElement) {
    fileTreeElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!fileClipboard || !getProjectRoot()) return;
      showContextMenu(e.clientX, e.clientY, { root: true });
    });
  }

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

function getProjectRoot() {
  return currentProjectPath ? currentProjectPath() : null;
}

/**
 * Show only what applies to the target: the project root gets Paste alone;
 * a file gets everything but Paste; a folder also gets Paste while
 * something is cut or copied.
 */
function configureMenu(target) {
  const canPaste = !!fileClipboard && (target.root || target.isDirectory);
  const visible = {
    reveal: !target.root,
    cut: !target.root,
    copy: !target.root,
    paste: canPaste,
    'copy-path': !target.root,
    rename: !target.root,
    delete: !target.root
  };
  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    btn.hidden = !visible[btn.dataset.action];
  });
  contextMenuEl.querySelectorAll('.context-menu-separator').forEach((sep) => {
    sep.hidden = !!target.root;
  });
}

function showContextMenu(x, y, target) {
  if (!contextMenuEl) return;
  contextMenuTarget = target;
  configureMenu(target);

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
  contextMenuTarget = null;
}

function handleContextMenuAction(action, target) {
  if (!target) return;

  switch (action) {
    case 'reveal':
      shell.showItemInFolder(target.path);
      break;
    case 'cut':
    case 'copy':
      fileClipboard = { path: target.path, mode: action };
      applyCutDecoration();
      break;
    case 'paste':
      pasteInto(target.root ? getProjectRoot() : target.path);
      break;
    case 'copy-path':
      try {
        clipboard.writeText(target.path);
      } catch (e) {
        console.error('Failed to copy filepath', e);
      }
      break;
    case 'rename':
      startRename(target.path);
      break;
    case 'delete':
      confirmDelete(target);
      break;
  }
}

function baseName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

/** Dim the row that is cut and waiting for a paste. */
function applyCutDecoration() {
  if (!fileTreeElement) return;
  fileTreeElement.querySelectorAll('.file-item.cut-pending').forEach((item) => {
    item.classList.remove('cut-pending');
  });
  if (!fileClipboard || fileClipboard.mode !== 'cut') return;
  fileTreeElement.querySelectorAll('.file-item').forEach((item) => {
    if (item.dataset.path === fileClipboard.path) item.classList.add('cut-pending');
  });
}

/**
 * Server workspaces are read-only in the tree for now
 * (server-workspace-panels): their files are on the server, which has no
 * trash. True — after saying so — when `p` is under a server workspace.
 */
function refuseOnServer(...paths) {
  let rows = [];
  try { rows = require('./workspaceSection').getWorkspaces().filter((w) => w.location === 'server'); } catch (_) { rows = []; }
  const { serverRootFor } = require('../shared/serverRouting');
  const roots = rows.map((w) => w.path);
  if (!paths.some((p) => p && serverRootFor(p, roots))) return false;
  notify.info('File actions on server workspaces come in a later update.');
  return true;
}

async function pasteInto(destDir) {
  if (fileClipboard && refuseOnServer(destDir, fileClipboard.path)) return;
  if (!fileClipboard || !destDir) return;
  const { path: source, mode } = fileClipboard;
  const result = await ipcRenderer.invoke(IPC.FILE_TREE_PASTE, { source, mode, destDir, ...(treeCtx() || {}) });
  if (!result || !result.ok) {
    notify.error(`Couldn't paste "${baseName(source)}": ${result ? result.error : 'unknown error'}`);
    return;
  }
  // A cut is spent once it lands; a copy can be pasted again.
  if (mode === 'cut') fileClipboard = null;
  // Open the destination so the pasted item is visible after the refresh.
  pendingExpandPath = destDir;
  refreshFileTree();
}

function findItem(p) {
  if (!fileTreeElement) return null;
  return Array.from(fileTreeElement.querySelectorAll('.file-item'))
    .find((item) => item.dataset.path === p) || null;
}

/**
 * Inline rename: the name span becomes an input. Enter or blur commits,
 * Esc cancels. Key and mouse events stay inside the input so the tree's
 * keyboard navigation and row click (open file / toggle folder) don't fire.
 */
function startRename(targetPath) {
  if (refuseOnServer(targetPath)) return;
  const item = findItem(targetPath);
  if (!item) return;
  const nameEl = item.querySelector('span:last-child');
  if (!nameEl) return;

  const oldName = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'file-tree-rename-input';
  input.value = oldName;
  input.spellcheck = false;
  nameEl.replaceWith(input);

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    input.replaceWith(nameEl);
    if (!commit || !newName || newName === oldName) return;

    const result = await ipcRenderer.invoke(IPC.FILE_TREE_RENAME, targetPath, newName, treeCtx());
    if (!result || !result.ok) {
      notify.error(`Couldn't rename "${oldName}": ${result ? result.error : 'unknown error'}`);
      return;
    }
    if (fileClipboard && fileClipboard.path === targetPath) fileClipboard.path = result.path;
    refreshFileTree();
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  ['click', 'mousedown', 'dblclick'].forEach((type) => {
    input.addEventListener(type, (e) => e.stopPropagation());
  });

  input.focus();
  // Select the name without its extension, like Finder does.
  const dot = item.classList.contains('folder') ? -1 : oldName.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : oldName.length);
}

function confirmDelete(target) {
  if (target && refuseOnServer(target.path)) return;
  const name = baseName(target.path);
  taskConfirmModal.open({
    heading: target.isDirectory ? 'Delete folder?' : 'Delete file?',
    message: `"${name}" will be moved to the Trash.`,
    confirmLabel: 'Move to Trash',
    onConfirm: async () => {
      const result = await ipcRenderer.invoke(IPC.FILE_TREE_TRASH, target.path, treeCtx());
      if (!result || !result.ok) {
        notify.error(`Couldn't delete "${name}": ${result ? result.error : 'unknown error'}`);
        return;
      }
      if (fileClipboard && fileClipboard.path === target.path) fileClipboard = null;
      refreshFileTree();
    }
  });
}

/* ──────────────────────── Git status decoration ──────────────────────── */

/**
 * Walk every rendered .file-item and apply the git status class matching its
 * path in the cached status map. Then roll changes up to ancestor folders
 * via a simple second pass.
 */
function applyGitStatusDecoration() {
  if (!fileTreeElement) return;

  const items = fileTreeElement.querySelectorAll('.file-item');
  // First pass: clear old classes and apply file-level classification
  items.forEach((item) => {
    GIT_STATUS_CLASSES.forEach((cls) => item.classList.remove(cls));
  });

  if (!gitStatusProjectPath || Object.keys(gitStatusFiles).length === 0) {
    return;
  }

  const projectPrefix = gitStatusProjectPath.endsWith('/')
    ? gitStatusProjectPath
    : gitStatusProjectPath + '/';

  items.forEach((item) => {
    if (item.classList.contains('folder')) return;
    const abs = item.dataset.path;
    if (!abs || !abs.startsWith(projectPrefix)) return;
    const rel = abs.substring(projectPrefix.length);
    const entry = gitStatusFiles[rel];
    if (!entry) return;
    const cls = `git-${entry.classification}`;
    if (GIT_STATUS_CLASSES.includes(cls)) {
      item.classList.add(cls);
    }
  });

  // Second pass: roll up changes to ancestor folder items.
  const changedItems = fileTreeElement.querySelectorAll(
    '.file-item.git-modified, .file-item.git-added, .file-item.git-untracked, .file-item.git-deleted, .file-item.git-renamed, .file-item.git-conflict'
  );
  changedItems.forEach((item) => {
    let parent = item.parentElement; // wrapper
    while (parent && parent !== fileTreeElement) {
      if (parent.classList && parent.classList.contains('file-wrapper')) {
        const folderItem = parent.querySelector(':scope > .file-item.folder');
        if (folderItem) folderItem.classList.add('git-has-changes');
      }
      parent = parent.parentElement;
    }
  });
}

module.exports = {
  init,
  setProjectPathGetter,
  setWorkspaceIdGetter,
  getTreeContext,
  showNote,
  setOnFileClick,
  renderFileTree,
  clearFileTree,
  refreshFileTree,
  loadFileTree,
  focus,
  blur
};
