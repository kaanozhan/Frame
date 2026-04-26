/**
 * Command Palette
 *
 * Modal overlay for searching and triggering registered commands.
 * Reads from commandRegistry; renders results with platform-aware shortcut display.
 */

const platform = require('./platform');
const registry = require('./commandRegistry');

let overlayEl = null;
let inputEl = null;
let listEl = null;
let isOpen = false;
let currentResults = [];
let selectedIndex = 0;

function init() {
  overlayEl = document.getElementById('command-palette-overlay');
  inputEl = document.getElementById('command-palette-input');
  listEl = document.getElementById('command-palette-list');

  if (!overlayEl || !inputEl || !listEl) {
    console.error('Command palette: required DOM elements not found');
    return;
  }

  inputEl.addEventListener('input', render);
  inputEl.addEventListener('keydown', onInputKeydown);
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });
}

function open() {
  if (isOpen) return;
  isOpen = true;
  inputEl.value = '';
  selectedIndex = 0;
  render();
  overlayEl.classList.add('visible');
  setTimeout(() => inputEl.focus(), 0);
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  overlayEl.classList.remove('visible');
  if (typeof window.terminalFocus === 'function') {
    window.terminalFocus();
  }
}

function toggle() {
  if (isOpen) close();
  else open();
}

function render() {
  const query = inputEl.value;
  currentResults = registry.search(query).slice(0, 60);
  if (selectedIndex >= currentResults.length) selectedIndex = 0;

  if (currentResults.length === 0) {
    listEl.innerHTML =
      '<div class="command-palette-empty">No commands match</div>';
    return;
  }

  listEl.innerHTML = currentResults
    .map((cmd, idx) => {
      const shortcut = cmd.shortcut
        ? `<span class="command-palette-shortcut">${escapeHtml(
            platform.formatShortcut(cmd.shortcut)
          )}</span>`
        : '';
      const category = cmd.category
        ? `<span class="command-palette-category">${escapeHtml(cmd.category)}</span>`
        : '';
      return `
      <div class="command-palette-item ${idx === selectedIndex ? 'selected' : ''}" data-index="${idx}">
        <div class="command-palette-item-main">
          ${category}
          <span class="command-palette-title">${escapeHtml(cmd.title)}</span>
        </div>
        ${shortcut}
      </div>
    `;
    })
    .join('');

  listEl.querySelectorAll('.command-palette-item').forEach((el) => {
    el.addEventListener('click', () => runAt(parseInt(el.dataset.index, 10)));
    el.addEventListener('mousemove', () => {
      const idx = parseInt(el.dataset.index, 10);
      if (selectedIndex !== idx) {
        selectedIndex = idx;
        updateSelection();
      }
    });
  });

  scrollSelectedIntoView();
}

function updateSelection() {
  const items = listEl.querySelectorAll('.command-palette-item');
  items.forEach((el, idx) => {
    el.classList.toggle('selected', idx === selectedIndex);
  });
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const sel = listEl.querySelector('.command-palette-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function onInputKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentResults.length === 0) return;
    selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
    updateSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentResults.length === 0) return;
    selectedIndex = Math.max(selectedIndex - 1, 0);
    updateSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runAt(selectedIndex);
  }
}

function runAt(idx) {
  const cmd = currentResults[idx];
  if (!cmd) return;
  close();
  // Defer so DOM focus changes (palette closing, terminal refocusing) settle
  // before the command actually runs.
  setTimeout(() => registry.runById(cmd.id), 0);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { init, open, close, toggle };
