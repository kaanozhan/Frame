/**
 * Decision Cards Panel (decision-cards-core T08)
 *
 * The project's current decision cards — one line each in
 * `.frame/decisions.jsonl` — listed newest first with their source. A card
 * expands to its why, keywords and files, and its story opens from it: a
 * spec in its own tab, a PROJECT_NOTES.md entry in place.
 *
 * Reached from the sidebar's Context → Decision cards row, the palette's "Go
 * to Decision cards" and the `decisionCards.open` command; hosted in the
 * center by `multiTerminalUI` (`PANEL_REGISTRY`) like Sessions. The dock's
 * Decisions tab, which lists PROJECT_NOTES.md entries, is a separate view and
 * stays as it is until that file's split retires it (plan D1). Add, undo and
 * delete come later (step 4b); this view only reads.
 *
 * Host contract, the same as every center-hosted panel: `show()` adds
 * `.visible` and loads, `hide()` drops `.visible`. The rows come from the
 * pure `decisions/cardsModel.js`.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');
const cardsModel = require('./decisions/cardsModel');

let panelElement = null;
let contentElement = null;
let searchElement = null;
let data = { cards: [], notes: [], malformed: [] };
let query = '';
const expanded = new Set();
const storyOpen = new Set();

function init() {
  panelElement = document.getElementById('decision-cards-panel');
  contentElement = document.getElementById('decision-cards-content');
  searchElement = document.getElementById('decision-cards-search');
  if (!panelElement || !contentElement) {
    console.error('decisionCardsPanel: #decision-cards-panel not found — Decision cards will not open');
    return;
  }

  const refreshBtn = document.getElementById('decision-cards-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', load);

  if (searchElement) {
    searchElement.addEventListener('input', () => {
      query = searchElement.value;
      render();
    });
  }

  contentElement.addEventListener('click', onClick);
}

/** Show the panel and (re)read the cards — the host calls this on mount. */
function show() {
  if (!panelElement) return;
  panelElement.classList.add('visible');
  load();
}

function hide() {
  if (!panelElement) return;
  panelElement.classList.remove('visible');
}

async function load() {
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    data = { cards: [], notes: [], malformed: [] };
    renderEmpty('No project selected', 'Pick a project from the switcher at the top of the sidebar to read its decision cards.');
    return;
  }
  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_DECISION_CARDS, projectPath);
    data = result && Array.isArray(result.cards) ? result : { cards: [], notes: [], malformed: [] };
  } catch (err) {
    console.error('decisionCardsPanel: LOAD_DECISION_CARDS failed', err);
    data = { cards: [], notes: [], malformed: [], error: err.message };
  }
  if (state.getProjectPath() !== projectPath) return; // switched while loading
  render();
}

function render() {
  if (!contentElement) return;
  if (data.error) {
    renderEmpty('Could not read decision cards', data.error);
    return;
  }
  const model = cardsModel.buildModel(data, { query });
  setCount(model);

  if (model.total === 0) {
    renderEmpty(
      'No decision cards yet',
      'A card is written when a decision made in conversation is recorded, and when a spec closes. ' +
      'They appear here, newest first.'
    );
    return;
  }
  if (model.shown === 0) {
    renderEmpty('No match', `Nothing in ${model.total} cards matches “${model.query}”.`);
    return;
  }

  const skipped = Array.isArray(data.malformed) && data.malformed.length
    ? `<p class="decision-cards-skipped">${data.malformed.length} line${data.malformed.length === 1 ? '' : 's'} of decisions.jsonl could not be read and ${data.malformed.length === 1 ? 'is' : 'are'} not shown.</p>`
    : '';
  contentElement.innerHTML = `<div class="decision-cards-list">${model.rows.map(renderRow).join('')}</div>${skipped}`;
}

function setCount(model) {
  const countEl = document.getElementById('decision-cards-count');
  if (!countEl) return;
  countEl.textContent = model.query && model.shown !== model.total
    ? `${model.shown} / ${model.total}`
    : `${model.total} card${model.total === 1 ? '' : 's'}`;
}

function renderRow(row) {
  const open = expanded.has(row.id);
  const relation = row.supersedes
    ? `<span class="decision-card-relation">supersedes ${escapeHtml(row.supersedes)}</span>`
    : row.extends ? `<span class="decision-card-relation">extends ${escapeHtml(row.extends)}</span>` : '';
  return `
    <article class="decision-card${open ? ' open' : ''}" data-id="${escapeHtml(row.id)}">
      <button class="decision-card-head" tabindex="-1" aria-expanded="${open}">
        <span class="decision-card-chevron">&#8250;</span>
        <span class="decision-card-date">${escapeHtml(row.date)}</span>
        <span class="decision-card-text">${escapeHtml(row.decision)}</span>
        <span class="decision-card-source decision-card-source-${row.story.kind}">${escapeHtml(row.story.kind === 'spec' ? 'Spec' : row.story.kind === 'notes' ? 'Notes' : 'Source')}</span>
      </button>
      ${open ? renderBody(row, relation) : ''}
    </article>
  `;
}

function renderBody(row, relation) {
  const keywords = row.keywords.map((k) => `<span class="decision-card-chip">${escapeHtml(k)}</span>`).join('');
  const files = row.files.length
    ? `<ul class="decision-card-files">${row.files.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>`
    : '<p class="decision-card-none">Names no file.</p>';
  return `
    <div class="decision-card-body">
      <p class="decision-card-why">${escapeHtml(row.why)}</p>
      <div class="decision-card-meta">
        <span class="decision-card-id">${escapeHtml(row.id)}</span>
        ${relation}
      </div>
      ${keywords ? `<div class="decision-card-chips">${keywords}</div>` : ''}
      ${files}
      ${renderStory(row)}
    </div>
  `;
}

function renderStory(row) {
  const { story } = row;
  if (story.kind === 'spec') {
    return `<button class="decision-card-story" data-slug="${escapeHtml(story.slug)}" tabindex="-1">Open spec ${escapeHtml(story.slug)}</button>`;
  }
  if (story.kind === 'notes') {
    if (!story.found) {
      return `<p class="decision-card-story-missing">${escapeHtml(story.label)} — story not found</p>`;
    }
    const open = storyOpen.has(row.id);
    return `
      <button class="decision-card-story" data-notes="${escapeHtml(row.id)}" tabindex="-1" aria-expanded="${open}">
        ${open ? 'Hide' : 'Show'} the PROJECT_NOTES.md entry: ${escapeHtml(`${story.date} ${story.title}`)}
      </button>
      ${open ? `<div class="decision-card-notes markdown-body">${renderMarkdown(story.body)}</div>` : ''}
    `;
  }
  return `<p class="decision-card-story-missing">${escapeHtml(story.label)} — story not found</p>`;
}

function onClick(e) {
  const story = e.target.closest('.decision-card-story');
  if (story) {
    if (story.dataset.slug) {
      require('./specSection').open(story.dataset.slug);
      return;
    }
    const id = story.dataset.notes;
    if (id) {
      if (storyOpen.has(id)) storyOpen.delete(id); else storyOpen.add(id);
      repaintRow(id);
    }
    return;
  }
  const head = e.target.closest('.decision-card-head');
  if (!head) return;
  const id = head.closest('.decision-card').dataset.id;
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  repaintRow(id);
}

/** Repaint one card: a full repaint would scroll the reader away from it. */
function repaintRow(id) {
  const el = contentElement.querySelector(`.decision-card[data-id="${CSS.escape(id)}"]`);
  const row = cardsModel.buildModel(data, { query }).rows.find((r) => r.id === id);
  if (el && row) el.outerHTML = renderRow(row);
}

function renderEmpty(title, message) {
  if (!contentElement) return;
  const countEl = document.getElementById('decision-cards-count');
  if (countEl) countEl.textContent = '';
  contentElement.innerHTML = `
    <div class="decision-cards-empty">
      <div class="decision-cards-empty-title">${escapeHtml(title)}</div>
      <p class="decision-cards-empty-message">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderMarkdown(md) {
  if (!md) return '<p class="decision-card-none">No detail recorded under this heading.</p>';
  return marked
    .parse(md)
    .replace(/<script/gi, '&lt;script')
    .replace(/on\w+=/gi, 'data-safe-');
}

module.exports = { init, show, hide };
