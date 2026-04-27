/**
 * File Editor Module
 * Overlay editor for viewing and editing files
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { marked } = require('marked');

let editorOverlay = null;
let editorTextarea = null;
let editorPreview = null;
let editorPreviewBtn = null;
let editorFilename = null;
let editorExt = null;
let editorPath = null;
let editorStatus = null;
let isPreviewMode = false;

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
  editorPreview = document.getElementById('editor-preview');
  editorPreviewBtn = document.getElementById('btn-editor-preview');
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

  // Reset markdown preview state
  isPreviewMode = false;
  if (editorPreview) editorPreview.style.display = 'none';
  if (editorTextarea) editorTextarea.style.display = '';
  if (editorPreviewBtn) editorPreviewBtn.style.display = 'none';

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
 * Toggle between raw text and rendered markdown preview
 */
function togglePreview() {
  isPreviewMode = !isPreviewMode;
  if (isPreviewMode) {
    editorPreview.innerHTML = marked.parse(editorTextarea.value).replace(/<script/gi, '&lt;script').replace(/on\w+=/gi, 'data-safe-');
    editorPreview.style.display = '';
    editorTextarea.style.display = 'none';
    editorPreviewBtn.textContent = 'Edit';
  } else {
    editorPreview.style.display = 'none';
    editorTextarea.style.display = '';
    editorPreviewBtn.textContent = 'Preview';
  }
}

/**
 * Setup event handlers
 */
function setupEventHandlers() {
  // Preview toggle button
  if (editorPreviewBtn) {
    editorPreviewBtn.addEventListener('click', togglePreview);
  }

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

      // Markdown: show preview by default, show toggle button
      const isMd = result.extension.toLowerCase() === 'md';
      if (isMd) {
        isPreviewMode = true;
        editorPreview.innerHTML = marked.parse(result.content).replace(/<script/gi, '&lt;script').replace(/on\w+=/gi, 'data-safe-');
        editorPreview.style.display = '';
        editorTextarea.style.display = 'none';
        editorPreviewBtn.textContent = 'Edit';
        editorPreviewBtn.style.display = '';
      } else {
        isPreviewMode = false;
        editorPreview.style.display = 'none';
        editorTextarea.style.display = '';
        editorPreviewBtn.style.display = 'none';
      }

      // Show overlay
      editorOverlay.classList.add('visible');

      // Focus textarea (only in edit mode)
      if (editorTextarea && !isMd) editorTextarea.focus();
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
