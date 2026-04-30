/**
 * Specs Panel Module
 *
 * UI for the spec-driven development workflow. Two views:
 *   - List view (default): all specs in the project with phase + task count
 *   - Detail view: spec / plan / tasks tabs for a single spec
 *
 * Read-only in Slice 1 — edits flow through /spec.new /spec.plan /spec.tasks
 * slash commands, which are wired in spec-1.7. The temporary "New spec"
 * prompt here is a stub until that lands.
 *
 * Subscribes to SPEC_DATA push from main/specManager.js, which fires
 * (debounced) whenever any file under .frame/specs/ changes.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

let isVisible = false;
let panelEl = null;
let contentEl = null;
let specs = [];           // list cache from SPEC_DATA push
let activeSlug = null;    // null = list view; slug = detail view
let activeSpec = null;    // full payload for detail view
let activeTab = 'spec';   // 'spec' | 'plan' | 'tasks'

function init() {
  panelEl = document.getElementById('specs-panel');
  contentEl = document.getElementById('specs-content');
  if (!panelEl) {
    console.error('specs-panel element not found');
    return;
  }
  setupEventListeners();
  setupIPCListeners();
}

function setupEventListeners() {
  document.getElementById('specs-close')?.addEventListener('click', hide);
  document.getElementById('specs-collapse-btn')?.addEventListener('click', hide);
  document.getElementById('specs-new-btn')?.addEventListener('click', showNewSpecPrompt);
}

function setupIPCListeners() {
  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs: incoming }) => {
    specs = incoming || [];
    if (activeSlug) reloadDetail();
    else renderList();
  });

  ipcRenderer.on(IPC.TOGGLE_SPECS_PANEL, () => toggle());
}

// ─── Visibility ─────────────────────────────────────

function show() {
  if (!panelEl) return;
  panelEl.classList.add('visible');
  isVisible = true;
  if (activeSlug) reloadDetail();
  else renderList();
}

function hide() {
  if (!panelEl) return;
  panelEl.classList.remove('visible');
  isVisible = false;
}

// Public toggle. The first time the user invokes this on a project where
// Spec-Driven Development isn't enabled yet, we show a suggestion modal
// instead of opening the panel — keeping the workflow opt-in.
async function toggle() {
  if (isVisible) {
    hide();
    return;
  }
  const projectPath = state.getProjectPath();
  if (projectPath) {
    const enabled = await ipcRenderer.invoke(IPC.IS_SPEC_DRIVEN_ENABLED, projectPath);
    if (!enabled) {
      showSuggestionModal(projectPath);
      return;
    }
  }
  show();
}

// ─── Watch lifecycle ────────────────────────────────

function startWatchingForProject(projectPath) {
  if (!projectPath) return;
  ipcRenderer.send(IPC.WATCH_SPECS, projectPath);
}

function stopWatching() {
  ipcRenderer.send(IPC.UNWATCH_SPECS);
}

// ─── List view ──────────────────────────────────────

function renderList() {
  if (!contentEl) return;

  if (!specs || specs.length === 0) {
    contentEl.innerHTML = `
      <div class="specs-empty">
        <div class="specs-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
            <line x1="9" y1="11" x2="15" y2="11"/>
          </svg>
        </div>
        <h3>No specs yet</h3>
        <p>Define what you want to build with Spec-Driven Development.</p>
        <div class="specs-empty-actions">
          <button class="btn btn-primary specs-new-trigger">New Spec</button>
        </div>
      </div>
    `;
    contentEl.querySelector('.specs-new-trigger')?.addEventListener('click', showNewSpecPrompt);
    return;
  }

  contentEl.innerHTML = specs.map(renderSpecRow).join('');
  contentEl.querySelectorAll('.spec-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.slug));
  });
}

function renderSpecRow(spec) {
  const phaseLabel = spec.phase.replace(/_/g, ' ');
  const updated = relativeTime(spec.updated_at);
  const tasksLabel = spec.task_count
    ? `${spec.task_count} task${spec.task_count === 1 ? '' : 's'}`
    : '';
  return `
    <div class="spec-row" data-slug="${escapeHtml(spec.slug)}">
      <div class="spec-row-title">${escapeHtml(spec.title)}</div>
      <div class="spec-row-meta">
        <span class="spec-phase-badge phase-${spec.phase}">${phaseLabel}</span>
        ${tasksLabel ? `<span class="spec-row-tasks">${tasksLabel}</span>` : ''}
        <span class="spec-row-time">${updated}</span>
      </div>
    </div>
  `;
}

// ─── Detail view ────────────────────────────────────

async function openDetail(slug) {
  activeSlug = slug;
  activeTab = 'spec';
  await reloadDetail();
}

async function reloadDetail() {
  if (!activeSlug) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  activeSpec = await ipcRenderer.invoke(IPC.GET_SPEC, { projectPath, slug: activeSlug });
  renderDetail();
}

function renderDetail() {
  if (!contentEl) return;
  if (!activeSpec) {
    contentEl.innerHTML = '<div class="specs-empty"><p>Spec not found.</p></div>';
    return;
  }
  const { status, spec, plan, tasks } = activeSpec;
  const phaseLabel = status.phase.replace(/_/g, ' ');
  const aiLabel = status.ai_tool || '';
  const nextAction = nextActionForPhase(status.phase);

  contentEl.innerHTML = `
    <div class="spec-detail">
      <div class="spec-detail-toolbar">
        <button class="spec-back-btn" id="spec-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <span class="spec-detail-slug">${escapeHtml(status.slug)}</span>
      </div>
      <div class="spec-detail-header">
        <h3 class="spec-detail-title">${escapeHtml(status.title)}</h3>
        <div class="spec-detail-meta">
          <span class="spec-phase-badge phase-${status.phase}">${phaseLabel}</span>
          ${aiLabel ? `<span class="spec-detail-ai">${escapeHtml(aiLabel)}</span>` : ''}
        </div>
      </div>
      ${nextAction ? renderNextActionBar(nextAction) : ''}
      <div class="spec-detail-tabs">
        ${renderTabButton('spec', 'Spec', !!spec)}
        ${renderTabButton('plan', 'Plan', !!plan)}
        ${renderTabButton('tasks', 'Tasks', !!tasks)}
      </div>
      <div class="spec-detail-body" id="spec-detail-body">
        ${renderTabBody(activeTab)}
      </div>
    </div>
  `;

  contentEl.querySelector('#spec-back-btn')?.addEventListener('click', backToList);
  contentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  contentEl.querySelector('#spec-action-btn')?.addEventListener('click', () => {
    if (nextAction) runSpecCommand(nextAction.command);
  });
}

// ─── Next-action bar ────────────────────────────────
//
// One primary "what's next?" button per phase. Clicking it sends the
// appropriate prompt template to the active terminal so Claude (or whichever
// AI tool is running) can produce the next artifact.

function nextActionForPhase(phase) {
  switch (phase) {
    case 'draft':
      return { command: 'spec.new',  label: 'Run /spec.new', hint: 'Have Claude write spec.md from your description.' };
    case 'specified':
      return { command: 'spec.plan', label: 'Run /spec.plan', hint: 'Generate plan.md from the spec.' };
    case 'planned':
      return { command: 'spec.tasks', label: 'Run /spec.tasks', hint: 'Break the plan into discrete tasks.' };
    default:
      return null; // tasks_generated / implementing / done — Slice 2 wires /spec.implement
  }
}

function renderNextActionBar(action) {
  return `
    <div class="spec-next-action">
      <div class="spec-next-action-text">
        <strong>${escapeHtml(action.label)}</strong>
        <span>${escapeHtml(action.hint)}</span>
      </div>
      <button class="btn btn-primary spec-action-btn" id="spec-action-btn">
        ${escapeHtml(action.label)}
      </button>
    </div>
  `;
}

async function runSpecCommand(command) {
  if (!activeSlug) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    showInlineError('Open a project first.');
    return;
  }
  // Write the interpolated prompt to .frame/runtime/prompts/<slug>__<command>.md
  // and send a short instruction to the terminal. This dodges Claude Code's
  // paste compression (which collapses long pastes to "[Pasted text +N lines]"
  // placeholders) — Claude reads the full prompt back from disk via its Read
  // tool.
  const result = await ipcRenderer.invoke(IPC.BUILD_SPEC_COMMAND_FILE, {
    projectPath,
    slug: activeSlug,
    command,
    aiTool: 'claude-code'
  });
  if (!result || !result.success) {
    showInlineError('Could not stage prompt: ' + (result?.error || 'unknown error'));
    return;
  }
  if (typeof window.terminalSendCommand !== 'function') {
    showInlineError('No terminal available. Open a terminal first.');
    return;
  }
  window.terminalSendCommand(result.instruction);
}

function renderTabButton(tab, label, hasContent) {
  const active = activeTab === tab ? 'active' : '';
  const empty = hasContent ? '' : 'empty';
  return `<button class="spec-tab-btn ${active} ${empty}" data-tab="${tab}">${label}${hasContent ? '' : ' <span class="spec-tab-empty-dot">·</span>'}</button>`;
}

function renderTabBody(tab) {
  const md = activeSpec?.[tab];
  if (md) return renderMarkdown(md);
  const cmdMap = { spec: '/spec.new', plan: '/spec.plan', tasks: '/spec.tasks' };
  return `<div class="spec-empty-tab">No <code>${tab}.md</code> yet — run <code>${cmdMap[tab]}</code> from the terminal.</div>`;
}

function switchTab(tab) {
  activeTab = tab;
  contentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const body = contentEl.querySelector('#spec-detail-body');
  if (body) body.innerHTML = renderTabBody(tab);
}

function backToList() {
  activeSlug = null;
  activeSpec = null;
  activeTab = 'spec';
  renderList();
}

// ─── New Spec stub ──────────────────────────────────
//
// Slice 1.7 replaces this with a proper modal + slash command flow that
// hands off to the active AI tool. For now, this minimal modal lets users
// seed a spec folder so the panel has something to show while we iterate
// on the lifecycle. Built inline (no HTML edit) since it's temporary —
// `window.prompt` is blocked in Electron's renderer.

function showNewSpecPrompt() {
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    showInlineError('Open a project first.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'spec-modal-overlay';
  overlay.innerHTML = `
    <div class="spec-modal spec-modal-wide" role="dialog" aria-modal="true" aria-labelledby="spec-modal-title">
      <h3 id="spec-modal-title">New Spec</h3>
      <p>Describe what you want to build. The first line becomes the title; the rest seeds <code>spec.md</code>.</p>
      <textarea
        class="spec-modal-textarea"
        rows="10"
        placeholder="Add Share button to ProductPage&#10;&#10;Customers viewing a product page have no quick way to share it on social media. The current flow requires copying the URL and pasting it manually into Twitter/X. We want a Share button next to the cart CTA that opens a Twitter intent URL prefilled with the product title and canonical URL."
        autocomplete="off"
        spellcheck="false"
      ></textarea>
      <div class="spec-modal-meta">
        <span class="spec-modal-slug-label">Slug:</span>
        <code class="spec-modal-slug">—</code>
      </div>
      <div class="spec-modal-error" role="alert"></div>
      <div class="spec-modal-actions">
        <button type="button" class="btn btn-secondary spec-modal-cancel">Cancel</button>
        <button type="button" class="btn btn-primary spec-modal-create">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.spec-modal-textarea');
  const slugEl = overlay.querySelector('.spec-modal-slug');
  const errorEl = overlay.querySelector('.spec-modal-error');
  const cancelBtn = overlay.querySelector('.spec-modal-cancel');
  const createBtn = overlay.querySelector('.spec-modal-create');

  setTimeout(() => input.focus(), 30);

  // Live slug preview from the first line
  const updateSlugPreview = () => {
    const { title } = parseTitleAndBody(input.value);
    slugEl.textContent = title ? deriveSlugPreview(title) : '—';
  };
  input.addEventListener('input', updateSlugPreview);

  const close = () => overlay.remove();
  const submit = async () => {
    const { title, description } = parseTitleAndBody(input.value);
    if (!title) {
      input.focus();
      return;
    }
    createBtn.disabled = true;
    const result = await ipcRenderer.invoke(IPC.CREATE_SPEC, {
      projectPath,
      opts: { title, description }
    });
    if (result && result.error) {
      errorEl.textContent = 'Could not create spec: ' + result.error;
      createBtn.disabled = false;
      return;
    }
    close();
    // SPEC_DATA push refreshes the list. /spec.new (Slice 1.7) will deep-link
    // straight into the new detail view; for now the user lands on the list.
  };

  cancelBtn.addEventListener('click', close);
  createBtn.addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    // Cmd/Ctrl+Enter submits — bare Enter inserts a newline (textarea default)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') close();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
}

// First non-empty line is the title; remaining text (after a blank line) is
// the description. Trims aggressively so a stray trailing newline doesn't
// matter.
function parseTitleAndBody(raw) {
  const text = String(raw || '').trim();
  if (!text) return { title: '', description: '' };
  const lines = text.split(/\r?\n/);
  const title = lines[0].trim();
  // Skip the title line and any blank lines after it
  let i = 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  const description = lines.slice(i).join('\n').trim();
  return { title, description };
}

// Same shape as specManager.generateSlug — duplicated here so the renderer
// can preview without a roundtrip. Keep in sync if the canonical changes.
function deriveSlugPreview(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 48)
    .replace(/^-+|-+$/g, '');
}

// ─── Spec-Driven Development opt-in suggestion ─────────────
//
// Shown the first time the user clicks the Specs panel on a project where
// the feature isn't enabled. Explains what the workflow does, then lets
// them turn it on or skip. Maximum friction: a one-time, dismissable modal.

function showSuggestionModal(projectPath) {
  const overlay = document.createElement('div');
  overlay.className = 'spec-modal-overlay';
  overlay.innerHTML = `
    <div class="spec-modal spec-modal-suggestion" role="dialog" aria-modal="true" aria-labelledby="spec-suggest-title">
      <h3 id="spec-suggest-title">Try Spec-Driven Development?</h3>
      <p class="spec-suggest-lead">
        Frame can structure your AI work into <strong>specs → plans → tasks</strong>.
        Talk to Claude in plain English; Frame turns it into structured artifacts that
        flow back into your tasks.json.
      </p>
      <ul class="spec-suggest-bullets">
        <li>One folder per spec under <code>.frame/specs/&lt;slug&gt;/</code></li>
        <li>Slash commands (<code>/spec.new</code>, <code>/spec.plan</code>, <code>/spec.tasks</code>) drive Claude through the lifecycle</li>
        <li>Generated tasks land in your existing tasks.json with a <code>spec · slug</code> chip</li>
        <li>Off by default — you stay in control</li>
      </ul>
      <p class="spec-suggest-fineprint">
        Enabling adds a "Spec-Driven Development" section to AGENTS.md and creates an empty
        <code>.frame/specs/</code> folder. You can disable later by editing those files directly.
      </p>
      <div class="spec-modal-error" role="alert"></div>
      <div class="spec-modal-actions">
        <button type="button" class="btn btn-secondary spec-suggest-skip">Maybe later</button>
        <button type="button" class="btn btn-primary spec-suggest-enable">Enable</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errorEl = overlay.querySelector('.spec-modal-error');
  const skipBtn = overlay.querySelector('.spec-suggest-skip');
  const enableBtn = overlay.querySelector('.spec-suggest-enable');

  setTimeout(() => enableBtn.focus(), 30);

  const close = () => overlay.remove();
  const enable = async () => {
    enableBtn.disabled = true;
    skipBtn.disabled = true;
    const result = await ipcRenderer.invoke(IPC.ENABLE_SPEC_DRIVEN, projectPath);
    if (!result || !result.success) {
      errorEl.textContent = 'Could not enable: ' + (result?.error || 'unknown error');
      enableBtn.disabled = false;
      skipBtn.disabled = false;
      return;
    }
    close();
    // Open the panel right away so the user lands somewhere productive
    show();
  };

  skipBtn.addEventListener('click', close);
  enableBtn.addEventListener('click', enable);
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
}

function showInlineError(message) {
  // Lightweight toast — same overlay shell as the modal, info-only
  const overlay = document.createElement('div');
  overlay.className = 'spec-modal-overlay';
  overlay.innerHTML = `
    <div class="spec-modal">
      <p>${escapeHtml(message)}</p>
      <div class="spec-modal-actions">
        <button type="button" class="btn btn-primary spec-modal-ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.spec-modal-ok').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ─── Helpers ────────────────────────────────────────

function renderMarkdown(md) {
  if (!md) return '';
  // Mirror the sanitization pattern from editor.js: cheap defense-in-depth
  // since this content comes from disk, not from the network.
  return marked
    .parse(md)
    .replace(/<script/gi, '&lt;script')
    .replace(/on\w+=/gi, 'data-safe-');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, (Date.now() - t) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  startWatchingForProject,
  stopWatching
};
