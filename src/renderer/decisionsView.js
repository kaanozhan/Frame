/**
 * Decisions View Module
 *
 * The project's decision log — every `### [YYYY-MM-DD] Title` entry in
 * PROJECT_NOTES.md — as a center view, the way Tasks and Specs are
 * (decisions-view spec, replacing the Overview dashboard's five-row card).
 *
 * Rows are collapsed to date + title; clicking one expands that decision's
 * full body in place. A search box filters on date, title and body text.
 * Data is pulled once per open via LOAD_DECISIONS — no subscription, so the
 * view can't feed the IPC loop the specs/tasks dashboards once did.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');

let containerEl = null;
let decisions = [];
let query = '';
const expanded = new Set();

async function render(container) {
  containerEl = container;
  const projectPath = state.getProjectPath();

  if (!projectPath) {
    container.innerHTML = renderShell(renderEmpty(
      'No project selected',
      'Pick a project from the switcher at the top of the sidebar to read its decision log.'
    ), '');
    return;
  }

  container.innerHTML = renderShell(
    '<div class="decisions-loading">Reading PROJECT_NOTES.md…</div>',
    projectName(projectPath)
  );

  const data = await load(projectPath);
  if (containerEl !== container) return; // view switched while loading

  if (data.error) {
    container.innerHTML = renderShell(renderEmpty('Could not read decisions', data.error), projectName(projectPath));
    return;
  }

  decisions = data.decisions || [];
  query = '';
  expanded.clear();
  container.innerHTML = renderShell(renderList(), projectName(projectPath));
  wire(container);
}

async function load(projectPath) {
  try {
    return await ipcRenderer.invoke(IPC.LOAD_DECISIONS, projectPath);
  } catch (err) {
    console.error('decisionsView: LOAD_DECISIONS failed', err);
    return { error: err.message, decisions: [], total: 0 };
  }
}

function projectName(projectPath) {
  return projectPath.split('/').pop() || projectPath.split('\\').pop() || '';
}

/** Header + body frame; body is swapped as the view loads / filters. */
function renderShell(body, name) {
  return `
    <div class="decisions-view">
      <div class="decisions-header">
        <div class="decisions-title">
          <span class="decisions-mark">&#9670;</span>
          <h2>Decisions</h2>
          ${name ? `<span class="decisions-project">${escapeHtml(name)}</span>` : ''}
        </div>
        <div class="decisions-actions">
          <input type="search" class="decisions-search" placeholder="Search decisions…"
                 autocomplete="off" spellcheck="false">
          <span class="decisions-count"></span>
          <button class="decisions-refresh" tabindex="-1" title="Re-read PROJECT_NOTES.md">Refresh</button>
        </div>
      </div>
      <div class="decisions-body">${body}</div>
    </div>
  `;
}

function matches(decision) {
  if (!query) return true;
  const q = query.toLowerCase();
  return decision.date.includes(q)
    || decision.title.toLowerCase().includes(q)
    || (decision.body || '').toLowerCase().includes(q);
}

function renderList() {
  if (decisions.length === 0) {
    return renderEmpty(
      'No decisions recorded yet',
      'Decisions are the `### [YYYY-MM-DD] Title` entries in PROJECT_NOTES.md. Add one and it shows up here.'
    );
  }

  const visible = decisions.filter(matches);
  if (visible.length === 0) {
    return renderEmpty('No match', `Nothing in ${decisions.length} decisions matches “${escapeHtml(query)}”.`);
  }

  return `<div class="decisions-list">${visible.map(renderRow).join('')}</div>`;
}

function renderRow(decision) {
  const key = rowKey(decision);
  const isOpen = expanded.has(key);
  return `
    <article class="decision-row${isOpen ? ' open' : ''}" data-key="${escapeHtml(key)}">
      <button class="decision-head" tabindex="-1" aria-expanded="${isOpen}">
        <span class="decision-chevron">&#8250;</span>
        <span class="decision-date">${escapeHtml(decision.date)}</span>
        <span class="decision-title">${escapeHtml(decision.title)}</span>
      </button>
      ${isOpen ? `<div class="decision-body markdown-body">${renderMarkdown(decision.body)}</div>` : ''}
    </article>
  `;
}

function renderEmpty(title, message) {
  return `
    <div class="decisions-empty">
      <div class="decisions-empty-title">${escapeHtml(title)}</div>
      <p class="decisions-empty-message">${escapeHtml(message)}</p>
    </div>
  `;
}

/** date + line is stable across re-renders and unique per entry. */
function rowKey(decision) {
  return `${decision.date}:${decision.line}`;
}

function wire(container) {
  const body = container.querySelector('.decisions-body');
  const search = container.querySelector('.decisions-search');
  const count = container.querySelector('.decisions-count');

  const paint = () => {
    body.innerHTML = renderList();
    updateCount(count);
  };
  updateCount(count);

  body.addEventListener('click', (e) => {
    const head = e.target.closest('.decision-head');
    if (!head) return;
    const row = head.closest('.decision-row');
    const key = row.dataset.key;
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
    // Repaint just this row: a full list repaint would scroll the reader
    // away from the entry they clicked.
    const decision = decisions.find(d => rowKey(d) === key);
    if (decision) row.outerHTML = renderRow(decision);
  });

  search?.addEventListener('input', () => {
    query = search.value.trim();
    paint();
  });

  container.querySelector('.decisions-refresh')?.addEventListener('click', () => {
    render(container);
  });
}

function updateCount(countEl) {
  if (!countEl) return;
  const visible = decisions.filter(matches).length;
  countEl.textContent = query && visible !== decisions.length
    ? `${visible} / ${decisions.length}`
    : String(decisions.length);
}

function renderMarkdown(md) {
  if (!md) return '<p class="decision-body-empty">No detail recorded under this heading.</p>';
  return marked
    .parse(md)
    .replace(/<script/gi, '&lt;script')
    .replace(/on\w+=/gi, 'data-safe-');
}

module.exports = { render };
