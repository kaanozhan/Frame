/**
 * Command Palette
 *
 * Modal overlay for searching and triggering registered commands.
 * Reads from commandRegistry; renders results with platform-aware shortcut display.
 *
 * It also has a picker mode (`pick`): a command that needs one more choice
 * ("Switch Workspace…") hands over its own items. They keep the order the
 * caller gave them — the registry's recency and score ordering does not
 * apply — and use the same filter box, arrow keys and Enter.
 */

const platform = require('./platform');
const registry = require('./commandRegistry');
const { escapeHtml } = require('./htmlUtils');

let overlayEl = null;
let inputEl = null;
let listEl = null;
let isOpen = false;
let currentResults = [];
let selectedIndex = 0;
let picker = null;            // { items } while picking from a caller's list, else null
let commandPlaceholder = '';  // the input's own placeholder, restored after a pick

function init() {
  overlayEl = document.getElementById('command-palette-overlay');
  inputEl = document.getElementById('command-palette-input');
  listEl = document.getElementById('command-palette-list');

  if (!overlayEl || !inputEl || !listEl) {
    console.error('Command palette: required DOM elements not found');
    return;
  }

  commandPlaceholder = inputEl.placeholder || '';
  inputEl.addEventListener('input', render);
  inputEl.addEventListener('keydown', onInputKeydown);
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });
}

function open() {
  if (isOpen) return;
  show(null, commandPlaceholder);
}

/**
 * Open the palette as a picker over the caller's own items, in the caller's
 * order: `items` are `{ title, detail?, run }` — `detail` shows where a
 * command's shortcut would. Typing filters them; Enter (or a click) closes
 * the palette and calls the chosen item's `run`.
 */
function pick({ placeholder, items } = {}) {
  if (!overlayEl) return;
  show({ items: Array.isArray(items) ? items : [] }, placeholder || commandPlaceholder);
}

function show(nextPicker, placeholder) {
  picker = nextPicker;
  isOpen = true;
  inputEl.value = '';
  inputEl.placeholder = placeholder;
  selectedIndex = 0;
  render();
  overlayEl.classList.add('visible');
  setTimeout(() => inputEl.focus(), 0);
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  picker = null;
  inputEl.placeholder = commandPlaceholder;
  overlayEl.classList.remove('visible');
  if (typeof window.terminalFocus === 'function') {
    window.terminalFocus();
  }
}

function toggle() {
  if (isOpen) close();
  else open();
}

/** The registry's match, without its scoring: every character of `query`, in order. */
function matches(query, text) {
  const target = String(text || '').toLowerCase();
  let at = 0;
  for (const ch of query) {
    at = target.indexOf(ch, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

/** The picker's items that match the filter, in the caller's order. */
function pickerResults(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return picker.items.slice();
  return picker.items.filter((item) => matches(q, item.title) || matches(q, item.detail));
}

function render() {
  const query = inputEl.value;
  currentResults = (picker ? pickerResults(query) : registry.search(query)).slice(0, 60);
  if (selectedIndex >= currentResults.length) selectedIndex = 0;

  if (currentResults.length === 0) {
    listEl.innerHTML =
      `<div class="command-palette-empty">${picker ? 'Nothing matches' : 'No commands match'}</div>`;
    return;
  }

  listEl.innerHTML = currentResults
    .map((cmd, idx) => {
      const trailing = picker ? cmd.detail : (cmd.shortcut ? platform.formatShortcut(cmd.shortcut) : '');
      const shortcut = trailing
        ? `<span class="command-palette-shortcut">${escapeHtml(trailing)}</span>`
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
  const picked = !!picker; // close() leaves picker mode
  close();
  // Defer so DOM focus changes (palette closing, terminal refocusing) settle
  // before the command actually runs.
  setTimeout(() => {
    if (!picked) registry.runById(cmd.id);
    else if (typeof cmd.run === 'function') cmd.run();
  }, 0);
}

module.exports = { init, open, close, toggle, pick };
