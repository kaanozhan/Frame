/**
 * Specs Dashboard Module
 *
 * Full-page card grid view of all specs in the active project. Symmetric
 * with the tasksDashboard (Cmd+Shift+D) — opened via the Dashboard button
 * in the side Specs panel header.
 *
 * Layout: filterable card grid; clicking a card slides a full-page drawer
 * in from the right over the grid. The drawer shows the same spec detail
 * as specSection (lifecycle stepper, next-action bar, Spec / Plan / Tasks /
 * Outcome tabs, interactive task rows routed through UPDATE_TASK) so the
 * two surfaces read as one screen.
 *
 * The spec in the drawer is also pinned as a chip in the top bar (via the
 * inline host's drawerOpened/drawerClosed hooks). One chip, replaced on
 * every open; it outlives the drawer and the view, so switching to Home or
 * Terminals and back never loses the spec — clicking the chip re-opens it.
 *
 * State subscribes to the same SPEC_DATA + TASKS_DATA streams the side
 * panel uses, so dashboard, side panel, and disk all stay in sync.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const reportSection = require('./reportSection');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');
const specNextAction = require('./specNextAction');
const doneWindow = require('./doneWindow');
const { PHASES, buildGridModel } = require('./specs/filterModel');

// Scope renders as one segmented control; phases as chips carrying the
// card's phase-badge colour. Every phase is a subset of Active, so the chips
// render only while Active is selected (boards-done-window spec, D4).
const SCOPE_FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done',   label: 'Done' }
];

// Date sort, rendered as a second segmented control right of the scope.
const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest', title: 'Newest first (last updated)' },
  { id: 'oldest', label: 'Oldest', title: 'Oldest first (last updated)' }
];

let isVisible = false;
let specs = [];
let allTasks = [];
let selectedSlug = null;
let selectedSpec = null;   // full spec body (from GET_SPEC)
let selectedTab = 'spec';
let renderedSlug = null;    // slug whose detail HTML is currently in detailContentEl
let scope = 'active';        // 'all' | 'active' | 'done' — opens on Active; the user can pick All
let phase = null;            // narrows Active only; cleared by any scope pick
let sortOrder = 'newest';    // 'newest' | 'oldest' — by updated_at; kept across scope picks
// Done specs older than the project's done window sit behind a ghost tile
// in All and Done. The reveal is session state on the open project: it
// resets on a scope pick and on a project change.
let showOlderDone = false;
let loadedProjectPath = null;
let searchQuery = '';        // current search text (trimmed lower-cased when matched)
let searchMatches = null;    // Set of slugs matching the query, or null when no search is active
let searchDebounce = null;

let dashboardEl = null;
let gridEl = null;
let filtersEl = null;
let searchInputEl = null;
let searchWrapEl = null;
let detailEl = null;
let detailContentEl = null;

function init() {
  dashboardEl = document.getElementById('specs-dashboard');
  if (!dashboardEl) return;

  gridEl = document.getElementById('specs-dashboard-grid');
  filtersEl = document.getElementById('specs-dashboard-filters');
  searchInputEl = document.getElementById('specs-dashboard-search-input');
  searchWrapEl = document.querySelector('.specs-dashboard-search');
  detailEl = document.getElementById('specs-dashboard-detail');
  detailContentEl = detailEl.querySelector('.specs-dashboard-detail-content');

  // Header buttons
  document.getElementById('specs-dashboard-close')?.addEventListener('click', hide);
  document.getElementById('specs-dashboard-new')?.addEventListener('click', () => {
    // Defer to side panel's modal — keeps the New Spec UX in one place
    require('./specPanel').showNewSpecPrompt?.();
  });
  detailEl.querySelector('.specs-dashboard-detail-close')?.addEventListener('click', clearSelection);
  detailEl.querySelector('.specs-dashboard-detail-back')?.addEventListener('click', clearSelection);

  // The done window is a project setting; when it moves, the grid
  // re-partitions from the data it already holds.
  doneWindow.onChange(() => { if (isVisible) renderGrid(); });
  setupSearch();
  setupIPCListeners();

  // Esc closes detail first, then dashboard
  document.addEventListener('keydown', (e) => {
    if (!isVisible) return;
    if (e.key === 'Escape') {
      if (selectedSlug) clearSelection();
      else if (searchQuery) clearSearch();
      else hide();
    }
  });
}

function setupIPCListeners() {
  ipcRenderer.on(IPC.SPEC_DATA, (event, { projectPath, specs: incoming }) => {
    specs = incoming || [];
    if (projectPath && projectPath !== loadedProjectPath) {
      showOlderDone = false;
      loadedProjectPath = projectPath;
    }
    if (isVisible) {
      // spec.md content may have changed on disk — refresh matches if a
      // search is active (runSearch re-renders the grid itself).
      if (searchQuery) runSearch(searchQuery);
      else renderGrid();
      if (selectedSlug) reloadDetail();
    }
  });

  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
    allTasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    if (isVisible) {
      // Progress chips on cards depend on task state, so re-render the grid
      renderGrid();
      if (selectedSlug && selectedTab === 'tasks') {
        renderDetailBody();
        attachTaskActionHandlers();
      }
    }
  });

  ipcRenderer.on(IPC.TOGGLE_SPECS_DASHBOARD, () => toggle());

  // Keep the busy lock and the activity dots in sync with the assigned
  // Frame's live agent state (fires only on material changes).
  require('./agentDispatch').onSpecLaneActivity((slug) => {
    if (!isVisible) return;
    renderGrid();
    if (selectedSpec && slug === selectedSlug) {
      renderDetailHeader();
      renderDetailBody();
      attachTaskActionHandlers();
    }
  });
}

// ─── Visibility ──────────────────────────────────────────

// ─── Inline hosting (center-specs-tasks-views spec) ────────
// When multiTerminalUI registers itself as the inline host, the dashboard
// renders inside the center content area instead of the full-window overlay,
// and every legacy entry point (show/toggle, deep links, palette) routes
// through the host so no code path opens the overlay anymore.

let inlineHost = null;     // { open(), close(), drawerOpened?({slug,title}), drawerClosed?() } — set by multiTerminalUI
let inlineMounted = false;
let overlayParent = null;  // where the element lives when not inline-mounted

function setInlineHost(host) {
  inlineHost = host;
}

/** Mount into the center content area and load data. Called by the host. */
async function mountInline(container) {
  if (!dashboardEl || !container) return;
  if (!overlayParent) overlayParent = dashboardEl.parentNode;
  dashboardEl.classList.add('visible', 'inline');
  container.appendChild(dashboardEl);
  inlineMounted = true;
  await _load();
}

/** The host swapped the center to another view — reset without routing. */
function notifyDetached() {
  if (!inlineMounted) return;
  inlineMounted = false;
  isVisible = false;
  clearSelection({ notify: false });
  dashboardEl.classList.remove('visible', 'inline');
  if (overlayParent && dashboardEl.parentNode !== overlayParent) {
    overlayParent.appendChild(dashboardEl);
  }
}

async function _load() {
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    require('./taskInfoModal').open?.({
      title: 'No project selected',
      message: 'Select a project from the sidebar to view its specs.'
    });
    return;
  }
  // The side panel and the dashboard show the same data — keeping both open
  // overlaps z-indexes and confuses the layout. Force the side panel closed.
  try { require('./specPanel').hide?.(); } catch {}

  clearSearch();  // start from a clean search state on every open
  if (projectPath !== loadedProjectPath) {
    showOlderDone = false;
    loadedProjectPath = projectPath;
  }
  isVisible = true;

  // Fetch synchronously so the grid paints with real data on first frame
  // instead of waiting for the watcher's debounced push. Watcher still runs
  // for live updates afterward.
  ipcRenderer.send(IPC.WATCH_SPECS, projectPath);
  ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  try {
    specs = await ipcRenderer.invoke(IPC.LIST_SPECS, projectPath) || [];
  } catch (err) {
    specs = [];
  }
  renderGrid();
}

async function show() {
  if (!dashboardEl) return;
  if (inlineHost) {
    inlineHost.open();
    return;
  }
  dashboardEl.classList.add('visible');
  await _load();
}

function hide() {
  if (!dashboardEl) return;
  if (inlineMounted && inlineHost) {
    inlineHost.close(); // view switch triggers notifyDetached()
    return;
  }
  dashboardEl.classList.remove('visible');
  isVisible = false;
  clearSelection();
}

function toggle() {
  if (inlineHost) {
    inlineMounted ? inlineHost.close() : inlineHost.open();
    return;
  }
  isVisible ? hide() : show();
}

// ─── Filters ─────────────────────────────────────────────

/**
 * The filter row, painted from the same model the grid is painted from so
 * the counts always answer "what will I see if I click this". Phase chips
 * render only under Active; a scope pick clears the phase and the reveal.
 */
function renderFilters(model) {
  if (!filtersEl) return;
  const { counts } = model;
  const count = (n) => `<span class="specs-filter-count">${n || 0}</span>`;

  const segments = SCOPE_FILTERS.map(f => {
    const on = scope === f.id;
    const hiddenDone = counts.doneTotal - counts.done;
    const title = f.id === 'done' && hiddenDone > 0
      ? ` title="${counts.doneTotal} done in total · ${hiddenDone} older hidden"`
      : '';
    return `<button type="button" class="specs-filter-seg${on ? ' active' : ''}" data-scope="${f.id}" aria-pressed="${on}"${title}>${f.label}${count(counts[f.id])}</button>`;
  }).join('');

  let chips = '';
  if (scope === 'active') {
    chips = PHASES.map(p => {
      const on = phase === p.id;
      const n = counts[`phase:${p.id}`] || 0;
      return `<button type="button" class="specs-filter-chip phase-${p.id}${on ? ' active' : ''}${n ? '' : ' is-empty'}" data-phase="${p.id}" aria-pressed="${on}"><span class="specs-filter-dot" aria-hidden="true"></span>${p.label}${count(n)}</button>`;
    }).join('');
  }

  const sortSegments = SORT_OPTIONS.map(o => {
    const on = sortOrder === o.id;
    return `<button type="button" class="specs-filter-seg${on ? ' active' : ''}" data-sort="${o.id}" aria-pressed="${on}" title="${o.title}">${o.label}</button>`;
  }).join('');

  filtersEl.innerHTML = `
    <div class="specs-filter-scope" role="group" aria-label="Scope">${segments}</div>
    <div class="specs-filter-scope specs-filter-sort" role="group" aria-label="Sort by date">${sortSegments}</div>
    ${chips ? `<span class="specs-filter-divider" aria-hidden="true"></span>
    <div class="specs-filter-phases" role="group" aria-label="Phase">${chips}</div>` : ''}
  `;
  filtersEl.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      scope = btn.dataset.scope;
      phase = null;
      showOlderDone = false;
      renderGrid();
    });
  });
  filtersEl.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (sortOrder === btn.dataset.sort) return;
      sortOrder = btn.dataset.sort;
      renderGrid();
    });
  });
  filtersEl.querySelectorAll('[data-phase]').forEach(btn => {
    btn.addEventListener('click', () => {
      phase = phase === btn.dataset.phase ? null : btn.dataset.phase;
      renderGrid();
    });
  });
}

function gridModel() {
  return buildGridModel({
    specs,
    scope,
    phase,
    searchMatches,
    windowDays: doneWindow.get().specs,
    showOlder: showOlderDone,
    sort: sortOrder
  });
}

// ─── Search ──────────────────────────────────────────────

function setupSearch() {
  if (!searchInputEl) return;
  searchInputEl.addEventListener('input', () => {
    const value = searchInputEl.value;
    if (searchWrapEl) searchWrapEl.classList.toggle('has-query', value.trim().length > 0);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(value), 180);
  });
  document.getElementById('specs-dashboard-search-clear')?.addEventListener('click', () => {
    clearSearch();
    searchInputEl.focus();
  });
}

async function runSearch(rawQuery) {
  const query = (rawQuery || '').trim();
  searchQuery = query;
  if (!query) {
    searchMatches = null;
    if (isVisible) renderGrid();
    return;
  }
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  let matches = [];
  try {
    matches = await ipcRenderer.invoke(IPC.SEARCH_SPECS, { projectPath, query }) || [];
  } catch (err) {
    matches = [];
  }
  // A newer keystroke may have superseded this query while awaiting — ignore
  // stale results so the grid always reflects the latest input.
  if (searchQuery !== query) return;
  searchMatches = new Set(matches);
  if (isVisible) renderGrid();
}

function clearSearch() {
  searchQuery = '';
  searchMatches = null;
  clearTimeout(searchDebounce);
  if (searchInputEl) searchInputEl.value = '';
  if (searchWrapEl) searchWrapEl.classList.remove('has-query');
  if (isVisible) renderGrid();
}

// ─── Grid ────────────────────────────────────────────────

function renderGrid() {
  if (!gridEl) return;
  const model = gridModel();
  renderFilters(model);
  const filtered = model.visible;
  const olderTile = model.olderCount > 0
    ? `<button type="button" class="specs-card-older" tabindex="-1">
         <span class="specs-card-older-count">${model.olderCount}</span>
         <span class="specs-card-older-label">older done spec${model.olderCount === 1 ? '' : 's'}</span>
         <span class="specs-card-older-action">Show</span>
       </button>`
    : '';

  if (filtered.length === 0 && model.olderCount > 0) {
    // Everything done is outside the window: the tile is the whole grid.
    const days = doneWindow.get().specs;
    gridEl.innerHTML = `<div class="specs-dashboard-empty"><p>Nothing done in the last ${days} days.</p></div>${olderTile}`;
    wireOlderTile();
    return;
  }

  if (filtered.length === 0) {
    if (specs.length === 0) {
      gridEl.innerHTML = `
        <div class="specs-dashboard-empty">
          <h3>No specs yet</h3>
          <p>Define what you want to build with Spec-Driven Development.</p>
          <button class="btn btn-primary" id="specs-dashboard-empty-new">+ New Spec</button>
        </div>
      `;
      gridEl.querySelector('#specs-dashboard-empty-new')?.addEventListener('click', () => {
        require('./specPanel').showNewSpecPrompt?.();
      });
    } else if (searchMatches) {
      gridEl.innerHTML = `<div class="specs-dashboard-empty"><p>No specs match “${escapeHtml(searchQuery)}”.</p></div>`;
    } else {
      gridEl.innerHTML = `<div class="specs-dashboard-empty"><p>No specs match the active filter.</p></div>`;
    }
    return;
  }

  gridEl.innerHTML = filtered.map(renderCard).join('') + olderTile;
  gridEl.querySelectorAll('.specs-card').forEach(card => {
    if (card.dataset.malformed) return; // nothing to open — the reason is on the card
    card.addEventListener('click', () => openFromGrid(card.dataset.slug));
  });
  wireOlderTile();
}

/**
 * A card click. A spec living in another checkout (spec-in-workspace) selects
 * that workspace first; the switch lands the center on its terminals, so the
 * grid is mounted again and the drawer opened over it.
 */
function openFromGrid(slug) {
  const spec = specs.find((s) => s && s.slug === slug);
  const switched = spec ? require('./workspaceSection').selectSpecWorkspace(spec.workspace) : false;
  if (!switched) {
    selectCard(slug);
    return;
  }
  const ui = require('./terminal').getMultiTerminalUI();
  if (ui) ui.showSpecsGrid();
  selectCard(slug, { instant: true });
}

function wireOlderTile() {
  gridEl.querySelector('.specs-card-older')?.addEventListener('click', () => {
    showOlderDone = true;
    renderGrid();
  });
}

function renderCard(spec) {
  // A spec folder Frame could not read as a spec. It is shown with the
  // reason instead of being dropped from the list (issue #122), and it is
  // inert: no phase badge, no progress, no click-through to a detail view
  // that has nothing to show.
  if (spec.malformed) {
    return `
      <div class="specs-card specs-card-malformed" data-malformed="1">
        <div class="specs-card-top">
          <span class="spec-phase-badge phase-malformed">needs attention</span>
        </div>
        <div class="specs-card-title">${escapeHtml(spec.title)}</div>
        <div class="specs-card-slug">${escapeHtml(spec.slug)}</div>
        <div class="specs-card-malformed-reason">
          <strong>status.json</strong> ${escapeHtml(spec.malformed)}
        </div>
        <div class="specs-card-foot">
          <span class="specs-card-time">.frame/specs/${escapeHtml(spec.slug)}/status.json</span>
        </div>
      </div>
    `;
  }

  const taskMatches = allTasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(`spec:${spec.slug}:`));
  const total = taskMatches.length || spec.task_count || 0;
  const done = taskMatches.filter(t => t.status === 'completed').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const phaseLabel = spec.phase.replace(/_/g, ' ');
  const isSelected = spec.slug === selectedSlug ? 'selected' : '';

  return `
    <div class="specs-card ${isSelected}" data-slug="${escapeHtml(spec.slug)}">
      <div class="specs-card-top">
        ${require('./agentDispatch').specStatusDotHtml(spec.slug)}
        <span class="spec-phase-badge phase-${spec.phase}">${phaseLabel}</span>
        ${spec.ai_tool ? `<span class="specs-card-ai">${escapeHtml(spec.ai_tool)}</span>` : ''}
        ${require('./workspaceSection').workspaceChipHtml(spec.workspace)}
      </div>
      <div class="specs-card-title">${escapeHtml(spec.title)}</div>
      <div class="specs-card-slug">${escapeHtml(spec.slug)}</div>
      ${total > 0 ? `
        <div class="specs-card-progress">
          <div class="specs-card-progress-bar"><div class="specs-card-progress-fill" style="width: ${pct}%"></div></div>
          <span class="specs-card-progress-text">${done} / ${total}</span>
        </div>
      ` : `<div class="specs-card-progress-empty">No tasks yet</div>`}
      <div class="specs-card-foot">
        <span class="specs-card-time">${relativeTime(spec.updated_at)}</span>
      </div>
    </div>
  `;
}

// ─── Detail aside ───────────────────────────────────────

/**
 * Open a spec in the drawer. `instant` is the top-bar chip path: the grid
 * has just been mounted underneath, so the drawer must already cover it in
 * the same frame — no slide, and no flash of the grid while GET_SPEC is in
 * flight. The has-selection class goes on synchronously (with transitions
 * suppressed) and the content fills in when the data lands.
 */
async function selectCard(slug, { instant = false } = {}) {
  selectedSlug = slug;
  selectedTab = 'spec';
  if (instant && detailEl) {
    detailEl.classList.add('instant');
    detailEl.classList.add('has-selection');
    detailEl.setAttribute('aria-hidden', 'false');
    if (detailContentEl) {
      // Stale content from another spec must not show while we load
      if (renderedSlug !== slug) detailContentEl.innerHTML = '';
      detailContentEl.scrollTop = 0;
    }
  }
  await reloadDetail();
  if (instant && detailEl) {
    // Two frames so the class removal itself can never start a transition
    requestAnimationFrame(() => requestAnimationFrame(() => detailEl.classList.remove('instant')));
  }
  // Re-render to mark the selected card
  renderGrid();
}

/**
 * Close the drawer. `notify: false` is for the host-driven teardown
 * (notifyDetached) — the host is already mid-render there, and calling
 * back into it would re-enter that render.
 */
function clearSelection({ notify = true } = {}) {
  const hadSelection = !!selectedSlug;
  selectedSlug = null;
  selectedSpec = null;
  selectedTab = 'spec';
  if (detailEl) {
    detailEl.classList.remove('has-selection');
    detailEl.setAttribute('aria-hidden', 'true');
  }
  renderGrid();
  if (hadSelection && notify && inlineHost && inlineHost.drawerClosed) inlineHost.drawerClosed();
}

async function reloadDetail() {
  if (!selectedSlug) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  selectedSpec = await ipcRenderer.invoke(IPC.GET_SPEC, { projectPath, slug: selectedSlug });
  if (!selectedSpec) {
    // Spec was deleted out from under us
    clearSelection();
    return;
  }
  if (detailEl) {
    const opening = !detailEl.classList.contains('has-selection');
    detailEl.classList.add('has-selection');
    detailEl.setAttribute('aria-hidden', 'false');
    if (opening && detailContentEl) detailContentEl.scrollTop = 0;
  }
  renderDetailHeader();
  renderDetailBody();
  attachTaskActionHandlers();
  // The top bar pins whichever spec the drawer shows (one chip, replaced on
  // every open) so leaving this screen never loses the spec — the chip is
  // the way back. Fires on rename too, since that path lands here.
  if (inlineHost && inlineHost.drawerOpened) {
    inlineHost.drawerOpened({ slug: selectedSlug, title: selectedSpec.status.title || selectedSlug });
  }
}

function renderDetailHeader() {
  if (!detailContentEl || !selectedSpec) return;
  const { status, spec, plan, tasks, outcome } = selectedSpec;
  const aiLabel = status.ai_tool || '';
  const nextAction = specNextAction.nextActionForPhase(status.phase);

  // Same layout as specSection's detail (title → meta → stepper → next
  // action → tabs), centered in the spec-section column, so the drawer and
  // the section viewport are one screen.
  renderedSlug = status.slug;
  detailContentEl.innerHTML = `
    <div class="spec-section">
      <div class="spec-section-inner spec-detail">
        <div class="spec-detail-header">
          <h3 class="spec-detail-title">${escapeHtml(status.title)}</h3>
          <div class="spec-detail-meta">
            ${require('./agentDispatch').specStatusDotHtml(status.slug)}
            <span class="spec-detail-slug">${escapeHtml(status.slug)}</span>
            <button class="spec-rename-btn" id="spec-rename-btn" title="Rename spec" aria-label="Rename spec">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            ${aiLabel ? `<span class="spec-detail-ai">${escapeHtml(aiLabel)}</span>` : ''}
          </div>
        </div>
        ${require('./specSection').renderStepper(status.phase)}
        ${nextAction ? specNextAction.renderNextActionBar({
          action: nextAction,
          lane: require('./agentDispatch').getSpecLaneInfo(status.slug),
          hint: selectedSpec.implementHint,
          counts: specNextAction.taskCounts(allTasks, status.slug)
        }) : ''}
        <div class="spec-detail-tabs">
          ${tabBtn('spec',  'Spec',  !!spec)}
          ${tabBtn('plan',  'Plan',  !!plan)}
          ${tabBtn('tasks', tasksTabLabel(!!tasks), !!tasks || hasSpecTasks())}
          ${tabBtn('outcome', 'Outcome', !!outcome)}
        </div>
        <div class="spec-detail-body" id="specs-dashboard-detail-body"></div>
      </div>
    </div>
  `;
  detailContentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTab = btn.dataset.tab;
      renderDetailHeader();
      renderDetailBody();
      attachTaskActionHandlers();
    });
  });
  detailContentEl.querySelector('#spec-action-btn')?.addEventListener('click', () => {
    if (nextAction) runSpecCommand(nextAction.command);
  });
  detailContentEl.querySelector('#spec-rename-btn')?.addEventListener('click', () => {
    if (selectedSpec) {
      // Reuse the side panel's rename modal for consistency. After a successful
      // rename, the slug change propagates via SPEC_DATA push so we sync our
      // selection too.
      const oldSlug = selectedSpec.status.slug;
      require('./specPanel').showRenameModal?.(selectedSpec.status);
      // Fallback: poll for slug change via the next SPEC_DATA push and re-select.
      // (specPanel's modal will reload its own detail; we react when the rename
      // completes by checking the cached specs list on the next push.)
      const onceListener = (event, payload) => {
        const renamedSlug = (payload?.specs || []).find(s =>
          s.title === selectedSpec.status.title && s.slug !== oldSlug
        )?.slug;
        if (renamedSlug) {
          selectedSlug = renamedSlug;
          reloadDetail();
        }
        ipcRenderer.removeListener(IPC.SPEC_DATA, onceListener);
      };
      ipcRenderer.on(IPC.SPEC_DATA, onceListener);
      // Auto-cleanup after 30s in case rename was cancelled
      setTimeout(() => ipcRenderer.removeListener(IPC.SPEC_DATA, onceListener), 30000);
    }
  });
}

// The next-action bar is shared across the spec surfaces — see
// specNextAction.js. This surface passes selectedSpec.implementHint and the
// spec's task counts; the click wiring stays here (#spec-action-btn above).

async function runSpecCommand(command) {
  if (!selectedSlug) return;
  // Agent Dispatch owns lane targeting, prompt staging and the
  // continue-or-new-Frame question; it surfaces its own error toasts.
  await require('./agentDispatch').dispatchSpecCommand({
    slug: selectedSlug,
    title: (selectedSpec && selectedSpec.status && selectedSpec.status.title) || selectedSlug,
    command
  });
}

function tabBtn(tab, label, hasContent) {
  const active = selectedTab === tab ? 'active' : '';
  const empty = hasContent ? '' : 'empty';
  return `<button class="spec-tab-btn ${active} ${empty}" data-tab="${tab}">${label}${hasContent ? '' : ' <span class="spec-tab-empty-dot">·</span>'}</button>`;
}

function renderDetailBody() {
  if (!selectedSpec) return;
  const body = detailContentEl.querySelector('#specs-dashboard-detail-body');
  if (!body) return;

  if (selectedTab === 'tasks') {
    // "View Implementation Report" — only when the spec folder holds an
    // implement-report.html (getSpec exposes it as implementReportPath).
    // The autonomous implement mode regenerates the file after each task,
    // so reopening (or refreshing) it follows the run live.
    const reportRow = selectedSpec.implementReportPath
      ? `<div class="spec-plan-report-row"><button class="btn btn-secondary spec-implement-report-btn">View Implementation Report</button></div>`
      : '';
    body.innerHTML = reportRow + renderTasksTabBody();
    body.querySelector('.spec-implement-report-btn')?.addEventListener('click', () => {
      if (!selectedSpec || !selectedSpec.implementReportPath) return;
      reportSection.open({
        projectPath: state.getProjectPath(),
        slug: selectedSlug,
        title: selectedSpec.status?.title || selectedSlug,
        kind: 'implement'
      });
    });
    return;
  }

  const md = selectedSpec[selectedTab];
  if (md) {
    // "View Plan Report" — only when the spec folder holds a plan-report.html
    // (getSpec exposes it as planReportPath). Opens as a section tab.
    const reportRow = selectedTab === 'plan' && selectedSpec.planReportPath
      ? `<div class="spec-plan-report-row"><button class="btn btn-secondary spec-plan-report-btn">View Plan Report</button></div>`
      : '';
    body.innerHTML = reportRow + renderMarkdown(md);
    body.querySelector('.spec-plan-report-btn')?.addEventListener('click', () => {
      if (!selectedSpec || !selectedSpec.planReportPath) return;
      reportSection.open({
        projectPath: state.getProjectPath(),
        slug: selectedSlug,
        title: selectedSpec.status?.title || selectedSlug,
        kind: 'plan'
      });
    });
  } else if (selectedTab === 'outcome') {
    body.innerHTML = `<div class="spec-empty-tab">No outcomes yet — they're captured automatically as <code>/spec.implement</code> completes each task.</div>`;
  } else {
    const cmdMap = { spec: '/spec.new', plan: '/spec.plan', tasks: '/spec.tasks' };
    body.innerHTML = `<div class="spec-empty-tab">No <code>${selectedTab}.md</code> yet — run <code>${cmdMap[selectedTab]}</code> from the terminal.</div>`;
  }
}

function renderTasksTabBody() {
  if (!selectedSlug) return '';
  const prefix = `spec:${selectedSlug}:`;
  const items = allTasks
    .filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix))
    .sort((a, b) => (a.source || '').localeCompare(b.source || '', undefined, { numeric: true }));

  if (items.length === 0) {
    if (selectedSpec?.tasks) {
      return `
        <div class="spec-empty-tab">
          Waiting for <code>/spec.tasks</code> output to sync into tasks.json.
        </div>
        ${renderMarkdown(selectedSpec.tasks)}
      `;
    }
    return `<div class="spec-empty-tab">No tasks yet — run <code>/spec.tasks</code> from the terminal.</div>`;
  }

  const total = items.length;
  const completed = items.filter(t => t.status === 'completed').length;
  const inProgress = items.filter(t => t.status === 'in_progress').length;
  const pct = Math.round((completed / total) * 100);

  return `
    <div class="spec-tasks-progress">
      <div class="spec-tasks-progress-text">
        <strong>${completed} / ${total}</strong> done${inProgress ? ` · ${inProgress} in progress` : ''}
      </div>
      <div class="spec-tasks-progress-bar"><div class="spec-tasks-progress-fill" style="width: ${pct}%"></div></div>
    </div>
    <div class="spec-tasks-list">
      ${items.map(renderSpecTaskRow).join('')}
    </div>
  `;
}

function renderSpecTaskRow(task) {
  const taskNum = (task.source || '').split(':').pop() || '—';
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const isPending = task.status === 'pending';

  const statusIcon = isCompleted
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : isInProgress
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;

  let actions = '';
  if (isPending) {
    actions = `
      <button class="spec-task-action-btn" data-action="start" title="Start working">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
      </button>
      <button class="spec-task-action-btn" data-action="complete" title="Mark complete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    `;
  } else if (isInProgress) {
    actions = `
      <button class="spec-task-action-btn" data-action="complete" title="Mark complete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="spec-task-action-btn" data-action="pause" title="Move back to pending">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
      </button>
    `;
  } else {
    actions = `
      <button class="spec-task-action-btn" data-action="reopen" title="Reopen">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    `;
  }

  return `
    <div class="spec-task-row status-${task.status}" data-task-id="${escapeHtml(task.id)}">
      <span class="spec-task-status">${statusIcon}</span>
      <span class="spec-task-num">${escapeHtml(taskNum)}</span>
      <span class="spec-task-title">${escapeHtml(task.title)}</span>
      <span class="spec-task-actions">${actions}</span>
    </div>
  `;
}

function attachTaskActionHandlers() {
  if (!detailContentEl) return;
  detailContentEl.querySelectorAll('.spec-task-row').forEach(row => {
    const taskId = row.dataset.taskId;
    row.querySelectorAll('.spec-task-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSpecTaskAction(taskId, btn.dataset.action);
      });
    });
  });
}

function handleSpecTaskAction(taskId, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath || !taskId) return;
  const statusMap = { start: 'in_progress', complete: 'completed', pause: 'pending', reopen: 'pending' };
  const status = statusMap[action];
  if (!status) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId, updates: { status } });
}

// ─── Helpers ────────────────────────────────────────────

function hasSpecTasks() {
  if (!selectedSlug) return false;
  const prefix = `spec:${selectedSlug}:`;
  return allTasks.some(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
}

function tasksTabLabel(hasMarkdown) {
  if (!selectedSlug) return 'Tasks';
  const prefix = `spec:${selectedSlug}:`;
  const items = allTasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
  if (items.length === 0) return 'Tasks';
  const completed = items.filter(t => t.status === 'completed').length;
  return `Tasks <span class="spec-tab-count">${completed}/${items.length}</span>`;
}

function renderMarkdown(md) {
  if (!md) return '';
  return marked.parse(md).replace(/<script/gi, '&lt;script').replace(/on\w+=/gi, 'data-safe-');
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
  init, show, hide, toggle,
  setInlineHost, mountInline, notifyDetached,
  isInlineMounted: () => inlineMounted,
  // Drawer control for the top bar's spec chip (multiTerminalUI): open a
  // spec in the drawer while mounted, read what it shows, close it.
  openSpec: (slug, opts) => { if (inlineMounted && slug) selectCard(slug, opts); },
  getSelectedSlug: () => selectedSlug,
  closeDrawer: () => clearSelection({ notify: false })
};
