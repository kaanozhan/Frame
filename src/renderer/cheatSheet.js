/**
 * Keyboard Shortcut Cheat Sheet
 *
 * Read-only modal listing every registered command that has a shortcut,
 * grouped by category. Reads from commandRegistry so it stays in sync
 * with the Command Palette automatically.
 */

const platform = require('./platform');
const registry = require('./commandRegistry');

let overlayEl = null;
let searchEl = null;
let listEl = null;
let isOpen = false;

function init() {
  overlayEl = document.getElementById('cheat-sheet-overlay');
  searchEl = document.getElementById('cheat-sheet-search');
  listEl = document.getElementById('cheat-sheet-list');

  if (!overlayEl || !searchEl || !listEl) {
    console.error('Cheat sheet: required DOM elements not found');
    return;
  }

  searchEl.addEventListener('input', render);
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });
}

function open() {
  if (isOpen) return;
  isOpen = true;
  searchEl.value = '';
  render();
  overlayEl.classList.add('visible');
  setTimeout(() => searchEl.focus(), 0);
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
  const query = searchEl.value.trim().toLowerCase();
  const grouped = groupShortcuts(query);

  if (grouped.length === 0) {
    listEl.innerHTML =
      '<div class="cheat-sheet-empty">No shortcuts match</div>';
    return;
  }

  listEl.innerHTML = grouped
    .map(
      (group) => `
      <div class="cheat-sheet-group">
        <div class="cheat-sheet-group-title">${escapeHtml(group.category || 'General')}</div>
        <div class="cheat-sheet-rows">
          ${group.commands
            .map(
              (cmd) => `
            <div class="cheat-sheet-row">
              <span class="cheat-sheet-title">${escapeHtml(cmd.title)}</span>
              <span class="cheat-sheet-shortcut">${escapeHtml(
                platform.formatShortcut(cmd.shortcut)
              )}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `
    )
    .join('');
}

function groupShortcuts(query) {
  const all = registry.getAll().filter((c) => c.shortcut);

  const filtered = query
    ? all.filter((c) => {
        const title = c.title.toLowerCase();
        const category = (c.category || '').toLowerCase();
        const display = platform.formatShortcut(c.shortcut).toLowerCase();
        return (
          title.includes(query) ||
          category.includes(query) ||
          display.includes(query)
        );
      })
    : all;

  const byCategory = new Map();
  for (const cmd of filtered) {
    const key = cmd.category || '';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(cmd);
  }

  const groups = Array.from(byCategory.entries()).map(([category, commands]) => {
    commands.sort((a, b) => a.title.localeCompare(b.title));
    return { category, commands };
  });

  groups.sort((a, b) => a.category.localeCompare(b.category));
  return groups;
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
