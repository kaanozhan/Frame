/**
 * Prompts Panel Module
 * Displays per-project prompt history with search and expandable cards
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let isVisible = false;
let panelElement = null;
let searchInput = null;
let listElement = null;
let allPrompts = []; // { timestamp, text }

/**
 * Initialize prompts panel
 */
function init() {
  panelElement = document.getElementById('prompts-panel');
  searchInput = document.getElementById('prompts-search');
  listElement = document.getElementById('prompts-list');

  if (!panelElement) return;

  setupEventListeners();
  setupIPC();
}

/**
 * Setup DOM event listeners
 */
function setupEventListeners() {
  const closeBtn = document.getElementById('prompts-close');
  if (closeBtn) closeBtn.addEventListener('click', hide);

  const collapseBtn = document.getElementById('prompts-collapse-btn');
  if (collapseBtn) collapseBtn.addEventListener('click', hide);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderList(searchInput.value.trim().toLowerCase());
    });
  }
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.PROMPT_HISTORY_DATA, (event, data) => {
    allPrompts = parseHistory(data);
    renderList(searchInput ? searchInput.value.trim().toLowerCase() : '');
  });

  ipcRenderer.on(IPC.TOGGLE_HISTORY_PANEL, () => {
    toggle();
  });
}

/**
 * Parse raw history text into prompt objects
 * @param {string} raw
 * @returns {{ timestamp: string, text: string }[]}
 */
function parseHistory(raw) {
  if (!raw || raw.trim() === '') return [];

  const lines = raw.trim().split('\n');
  const result = [];

  for (const line of lines) {
    const match = line.match(/^\[(.+?)\]\s+([\s\S]+)/);
    if (match) {
      result.push({ timestamp: match[1], text: match[2] });
    }
  }

  // Newest first
  return result.reverse();
}

/**
 * Render prompt list with optional search filter
 * @param {string} query
 */
function renderList(query) {
  if (!listElement) return;
  listElement.innerHTML = '';

  const filtered = query
    ? allPrompts.filter(p => p.text.toLowerCase().includes(query))
    : allPrompts;

  if (filtered.length === 0) {
    listElement.innerHTML = `<div class="prompts-empty">${query ? 'No results.' : 'No prompts yet.'}</div>`;
    return;
  }

  filtered.forEach(prompt => {
    listElement.appendChild(createCard(prompt));
  });
}

const TRUNCATE_LENGTH = 120;

/**
 * Create a single prompt card element
 * @param {{ timestamp: string, text: string }} prompt
 */
function createCard(prompt) {
  const card = document.createElement('div');
  card.className = 'prompt-card';

  const isLong = prompt.text.length > TRUNCATE_LENGTH;
  let expanded = false;

  const ts = document.createElement('div');
  ts.className = 'prompt-card-timestamp';
  ts.textContent = formatTimestamp(prompt.timestamp);

  const body = document.createElement('div');
  body.className = 'prompt-card-body';
  body.textContent = isLong ? prompt.text.slice(0, TRUNCATE_LENGTH) + '…' : prompt.text;

  card.appendChild(ts);
  card.appendChild(body);

  if (isLong) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'prompt-card-expand';
    expandBtn.textContent = 'Show more';

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      expanded = !expanded;
      body.textContent = expanded ? prompt.text : prompt.text.slice(0, TRUNCATE_LENGTH) + '…';
      expandBtn.textContent = expanded ? 'Show less' : 'Show more';
      card.classList.toggle('expanded', expanded);
    });

    card.appendChild(expandBtn);
  }

  return card;
}

/**
 * Format ISO timestamp to readable string
 * @param {string} iso
 */
function formatTimestamp(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

/**
 * Toggle panel visibility
 */
function toggle() {
  isVisible ? hide() : show();
}

/**
 * Show the panel and load data
 */
function show() {
  if (!panelElement) return;
  isVisible = true;
  panelElement.classList.add('visible');
  ipcRenderer.send(IPC.LOAD_PROMPT_HISTORY);
}

/**
 * Hide the panel
 */
function hide() {
  if (!panelElement) return;
  isVisible = false;
  panelElement.classList.remove('visible');
}

/**
 * Whether the panel is currently visible
 */
function getIsVisible() {
  return isVisible;
}

module.exports = { init, toggle, show, hide, getIsVisible };
