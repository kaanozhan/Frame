/**
 * File Editor Module
 * Overlay editor for viewing and editing files
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let editorOverlay = null;
let editorTextarea = null;
let editorFilename = null;
let editorExt = null;
let editorPath = null;
let editorStatus = null;

let currentEditingFile = null;
let originalContent = '';
let isModified = false;
let onFileTreeRefreshCallback = null;
let openedFromSource = null; // Track where the file was opened from ('fileTree', 'terminal', etc.)

/**
 * Initialize editor module
 */
function init(onRefreshFileTree) {
  editorOverlay = document.getElementById('editor-overlay');
  editorTextarea = document.getElementById('editor-textarea');
  editorFilename = document.getElementById('editor-filename');
  editorExt = document.getElementById('editor-ext');
  editorPath = document.getElementById('editor-path');
  editorStatus = document.getElementById('editor-status');
  onFileTreeRefreshCallback = onRefreshFileTree;

  setupEventHandlers();
  setupIPC();
}

/**
 * Open file in editor
 * @param {string} filePath - Path to the file
 * @param {string} source - Where the file was opened from ('fileTree', 'terminal', etc.)
 */
function openFile(filePath, source = 'terminal') {
  openedFromSource = source;
  ipcRenderer.send(IPC.READ_FILE, filePath);
}

/**
 * Close editor
 */
function closeEditor() {
  if (isModified) {
    if (!confirm('You have unsaved changes. Close anyway?')) {
      return;
    }
  }

  editorOverlay.classList.remove('visible');

  // Restore focus to where the file was opened from
  if (openedFromSource === 'fileTree' && typeof window.fileTreeFocus === 'function') {
    window.fileTreeFocus();
  } else if (typeof window.terminalFocus === 'function') {
    window.terminalFocus();
  }

  currentEditingFile = null;
  originalContent = '';
  isModified = false;
  openedFromSource = null;
}

/**
 * Save file
 */
function saveFile() {
  if (!currentEditingFile) return;

  const content = editorTextarea.value;
  ipcRenderer.send(IPC.WRITE_FILE, {
    filePath: currentEditingFile,
    content: content
  });
}

/**
 * Update editor status
 */
function updateStatus(status, className = '') {
  if (editorStatus) {
    editorStatus.textContent = status;
    editorStatus.className = className;
  }
}

/**
 * Check if content is modified
 */
function checkModified() {
  const content = editorTextarea.value;
  isModified = content !== originalContent;

  if (isModified) {
    updateStatus('Modified', 'modified');
  } else {
    updateStatus('Ready', '');
  }
}

/**
 * Setup event handlers
 */
function setupEventHandlers() {
  // Close button
  const closeBtn = document.getElementById('btn-editor-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeEditor);
  }

  // Save button
  const saveBtn = document.getElementById('btn-editor-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveFile);
  }

  // Track modifications
  if (editorTextarea) {
    editorTextarea.addEventListener('input', checkModified);

    // Keyboard shortcuts
    editorTextarea.addEventListener('keydown', (e) => {
      // Ctrl+S or Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }

      // Escape to close
      if (e.key === 'Escape') {
        closeEditor();
      }

      // Tab for indentation
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editorTextarea.selectionStart;
        const end = editorTextarea.selectionEnd;
        editorTextarea.value = editorTextarea.value.substring(0, start) + '  ' + editorTextarea.value.substring(end);
        editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 2;
        checkModified();
      }
    });
  }

  // Close on overlay click (outside editor)
  if (editorOverlay) {
    editorOverlay.addEventListener('click', (e) => {
      if (e.target.id === 'editor-overlay') {
        closeEditor();
      }
    });
  }
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  // Receive file content
  ipcRenderer.on(IPC.FILE_CONTENT, (event, result) => {
    if (result.success) {
      currentEditingFile = result.filePath;
      originalContent = result.content;
      isModified = false;

      // Update UI
      if (editorFilename) editorFilename.textContent = result.fileName;
      if (editorExt) editorExt.textContent = result.extension.toUpperCase() || 'FILE';
      if (editorTextarea) editorTextarea.value = result.content;
      if (editorPath) editorPath.textContent = result.filePath;
      updateStatus('Ready', '');

      // Show overlay
      editorOverlay.classList.add('visible');

      // Focus textarea
      if (editorTextarea) editorTextarea.focus();
    } else {
      console.error('Error opening file:', result.error);
    }
  });

  // Receive save confirmation
  ipcRenderer.on(IPC.FILE_SAVED, (event, result) => {
    if (result.success) {
      originalContent = editorTextarea.value;
      isModified = false;
      updateStatus('Saved!', 'saved');

      // Reset status after 2 seconds
      setTimeout(() => {
        if (!isModified) {
          updateStatus('Ready', '');
        }
      }, 2000);

      // Refresh file tree
      if (onFileTreeRefreshCallback) {
        onFileTreeRefreshCallback();
      }
    } else {
      updateStatus('Save failed: ' + result.error, 'modified');
    }
  });
}

/**
 * Check if editor is open
 */
function isEditorOpen() {
  return editorOverlay && editorOverlay.classList.contains('visible');
}

/**
 * Get currently editing file path
 */
function getCurrentFile() {
  return currentEditingFile;
}

module.exports = {
  init,
  openFile,
  closeEditor,
  saveFile,
  isEditorOpen,
  getCurrentFile
};
