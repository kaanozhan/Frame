// Supervisor profile panel — Phase I (read-only v1).
//
// Renders the per-project profile pulled by SUPERVISOR_READ_PROFILE. The
// panel mounts as a tab in the supervisor right pane (alongside Kanban) and
// rerenders whenever the project tree's selection changes — see
// projectTree.js's onSelectProject callback.
//
// Sources, in fallback order:
//   1. <project_path>/.frame/profile.json  (preferred — canonical Frame shape)
//   2. <supervisorRoot>/profiles/<project_id>.yaml  (supervisor shape)
//
// We intentionally support both shapes in one read path because the two
// schemas overlap heavily (id / worker / policy / capabilities / budgets /
// context_sources) but the wrapper keys differ in a few spots (notably
// `allowedTools` vs `allowed_tools`, `spend_per_task_usd` vs
// `spend_ceiling_task_usd`). Normalization happens in pickViewModel().
//
// Structured-form ↔ JSON two-way edits, the nudge banner for missing
// profiles, and SAVE_PROFILE are deferred to a follow-up — see the WIP
// reference (Frame@local/wip-supervisor-integration-2026-06-22:
// src/renderer/profilePanel.js, 448 lines) for the design intent.

const path = require('path');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Phase N: turn a project display name ("kitli kids", "Localized Scraper")
// into the slug shape the supervisor's profile YAMLs use ("kitli-kids",
// "localized-scraper"). When the tree row has a real `id` (set by the main-
// side listWorkspaceProjects merge), use that directly; this fallback only
// runs for callers that handed us a name-only project descriptor.
function slugifyProjectName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalize either shape (Frame JSON / supervisor YAML) into a single view-
 * model the layout binds to. Fields are best-effort — a missing block yields
 * `null` rather than throwing, which the render path treats as "—".
 */
function pickViewModel(profile, sourceCtx) {
  const p = profile || {};
  const worker = p.worker || {};
  const permission = worker.permission || {};
  const policy = p.policy || {};
  const budgets = p.budgets || {};
  const project = p.project || {};

  // Frame-shape uses camelCase (allowedTools); supervisor-shape uses
  // snake_case (allowed_tools). Accept both, prefer whichever is present.
  const allowedTools = permission.allowedTools || permission.allowed_tools || [];

  // Workdir: explicit worker.workdir wins; fall back to the project_path the
  // renderer passed so Frame-shape profiles still have something to show.
  const workdir = worker.workdir || sourceCtx.project_path || '';

  // Model: provider + model when present; the YAML often sets model: null
  // (Claude Code default).
  const provider = worker.provider || '';
  const model = worker.model || '';
  const modelLine = provider
    ? (model ? `${provider} (${model})` : provider)
    : '';

  // Memory: prefer the explicit memoryId on the project block (canonicalised
  // with the `bm:` prefix for parity with the supervisor view's notation) and
  // fall back to the first bm: entry in context_sources, which is the
  // convention the YAML profiles use.
  let memory = '';
  if (project.memoryId) {
    memory = `bm:${project.memoryId}`;
  } else if (Array.isArray(p.context_sources)) {
    const bm = p.context_sources.find((s) => typeof s === 'string' && s.startsWith('bm:'));
    if (bm) memory = bm;
  }

  // Budgets: Frame shape uses spend_per_*; YAML uses spend_ceiling_*. The
  // numbers mean the same thing — surface whichever is set.
  const perTask = budgets.spend_per_task_usd != null
    ? budgets.spend_per_task_usd
    : budgets.spend_ceiling_task_usd;
  const perDay = budgets.spend_per_day_usd != null
    ? budgets.spend_per_day_usd
    : budgets.spend_ceiling_day_usd;
  const iterations = budgets.iteration_cap;

  return {
    id: p.id || project.id || '',
    name: project.name || '',
    workdir,
    modelLine,
    allowedTools,
    escalateCategories: policy.escalate_categories || [],
    rules: policy.rules || [],
    costCeilingUsd: policy.cost_ceiling_usd,
    perTask,
    perDay,
    iterations,
    capabilities: p.capabilities || [],
    contextSources: p.context_sources || [],
    memory,
  };
}

function formatBudgets(vm) {
  const parts = [];
  if (vm.perTask != null) parts.push(`per-task $${vm.perTask}`);
  if (vm.perDay != null) parts.push(`per-day $${vm.perDay}`);
  if (vm.iterations != null) parts.push(`iterations ${vm.iterations}`);
  return parts.join(' · ') || '—';
}

function shortenHome(p) {
  if (!p) return '';
  // The spec mockup shows ~/Desktop/... — collapse the actual $HOME so the
  // source path line doesn't visually dominate the panel.
  const home = (process.env.HOME || '').replace(/\/$/, '');
  if (home && p.startsWith(home + '/')) return '~' + p.slice(home.length);
  return p;
}

function create(root, opts = {}) {
  let alive = true;
  let currentProject = opts.initialProject || null;
  let currentSupervisorRoot = opts.supervisorRoot || null;
  let lastLoaded = null;
  let showingRaw = false;
  const onOpenFile = opts.onOpenFile || (() => {});

  function setEmpty(msg, kind) {
    root.innerHTML = `
      <div class="sup-profile-empty ${kind || ''}">
        ${esc(msg)}
      </div>
    `;
  }

  function renderLoaded(loaded, project) {
    if (!loaded || !loaded.ok) {
      const err = (loaded && loaded.error) || 'no profile found';
      const lookupId = project
        ? (project.id || slugifyProjectName(project.name) || project.name || '')
        : '';
      const trailing = project && project.path
        ? `<div class="sup-profile-empty-hint">Looked for <code>${esc(path.join(project.path, '.frame', 'profile.json'))}</code> and <code>profiles/${esc(lookupId)}.yaml</code>.</div>`
        : '';
      root.innerHTML = `
        <div class="sup-profile-empty">
          ${esc(err)}
          ${trailing}
        </div>
      `;
      return;
    }
    const vm = pickViewModel(loaded.profile, {
      project_path: project ? project.path : '',
    });
    const sourceLabel = loaded.source_type === 'frame-json'
      ? '.frame/profile.json'
      : 'supervisor YAML';
    const shortPath = shortenHome(loaded.source_path || '');
    const fallbackHint = loaded.source_type === 'supervisor-yaml'
      ? '<span class="sup-profile-fallback">— fallback (no .frame/profile.json)</span>'
      : '';
    const warningBanner = loaded.warning
      ? `<div class="sup-profile-warning">${esc(loaded.warning)}</div>`
      : '';

    // Allowed tools list: cap at 6 inline + "+N more" so a long tool list
    // doesn't push the rest of the layout off-screen on narrow widths.
    const tools = vm.allowedTools || [];
    const shownTools = tools.slice(0, 6);
    const moreTools = tools.length - shownTools.length;
    const toolsHtml = tools.length
      ? shownTools.map((t) => `<span class="sup-profile-chip">${esc(t)}</span>`).join('')
        + (moreTools > 0 ? `<span class="sup-profile-chip muted">+${moreTools} more</span>` : '')
      : '<span class="sup-profile-dash">—</span>';

    const escHtml = vm.escalateCategories.length
      ? vm.escalateCategories.map((c) => `<span class="sup-profile-chip">${esc(c)}</span>`).join('')
      : '<span class="sup-profile-dash">—</span>';

    const rulesHtml = vm.rules.length
      ? `<ul class="sup-profile-rules">${
          vm.rules.map((r) => {
            const cat = r && r.category ? esc(r.category) : '—';
            const route = r && r.route ? esc(r.route) : '—';
            return `<li><span class="sup-profile-rule-cat">${cat}</span><span class="sup-profile-rule-arrow">→</span><span class="sup-profile-rule-route route-${esc(route)}">${route}</span></li>`;
          }).join('')
        }</ul>`
      : '<span class="sup-profile-dash">—</span>';

    const headerName = vm.name || vm.id || (project ? project.name : '') || 'profile';

    root.innerHTML = `
      <div class="sup-profile-card">
        <div class="sup-profile-card-hdr">
          <div class="sup-profile-title">Profile: <strong>${esc(headerName)}</strong></div>
          <div class="sup-profile-source" title="${esc(loaded.source_path || '')}">
            Source: <code>${esc(shortPath)}</code> <span class="sup-profile-source-kind">(${esc(sourceLabel)})</span>
            ${fallbackHint}
          </div>
        </div>
        ${warningBanner}
        <dl class="sup-profile-grid">
          <dt>Workdir</dt><dd><code>${esc(shortenHome(vm.workdir)) || '—'}</code></dd>
          <dt>Model</dt><dd>${esc(vm.modelLine) || '—'}</dd>
          <dt>Allowed tools</dt><dd class="sup-profile-chips">${toolsHtml}</dd>
          <dt>Escalate cats</dt><dd class="sup-profile-chips">${escHtml}</dd>
          <dt>Rules</dt><dd>${rulesHtml}</dd>
          <dt>Budgets</dt><dd>${esc(formatBudgets(vm))}</dd>
          <dt>Memory</dt><dd><code>${esc(vm.memory) || '—'}</code></dd>
        </dl>
        <div class="sup-profile-actions">
          <button type="button" class="sup-btn" id="sup-profile-open">Open ${esc(sourceLabel)} in Frame ↗</button>
          <button type="button" class="sup-btn" id="sup-profile-raw-toggle">${showingRaw ? 'Hide raw' : 'Show raw'}</button>
          <span class="sup-profile-followup">Edits: follow-up phase</span>
        </div>
        <pre class="sup-profile-raw ${showingRaw ? 'open' : ''}" id="sup-profile-raw">${esc(loaded.raw || '')}</pre>
      </div>
    `;

    const openBtn = root.querySelector('#sup-profile-open');
    if (openBtn) {
      if (loaded.source_path) {
        openBtn.addEventListener('click', () => onOpenFile(loaded.source_path));
      } else {
        openBtn.setAttribute('disabled', 'disabled');
      }
    }
    const rawBtn = root.querySelector('#sup-profile-raw-toggle');
    if (rawBtn) {
      rawBtn.addEventListener('click', () => {
        showingRaw = !showingRaw;
        const pre = root.querySelector('#sup-profile-raw');
        if (pre) pre.classList.toggle('open', showingRaw);
        rawBtn.textContent = showingRaw ? 'Hide raw' : 'Show raw';
      });
    }
  }

  async function load() {
    if (!alive) return;
    if (!currentProject || !currentProject.path) {
      lastLoaded = null;
      setEmpty('Select a project from the tree on the left to view its profile.', 'idle');
      return;
    }
    setEmpty('Loading profile…', 'loading');
    try {
      // Phase N: profileReader looks up <supervisorRoot>/profiles/<id>.yaml
      // by an exact filename match. The Frame-workspaces source feeds rows
      // with display names ("kitli kids") that don't match the slug-shaped
      // YAML filenames ("kitli-kids.yaml") — pass the merge-set `id` when we
      // have it, otherwise slugify the display name so the regex check and
      // the file lookup both succeed.
      const project_id = currentProject.id
        || slugifyProjectName(currentProject.name)
        || currentProject.name
        || '';
      const loaded = await ipcRenderer.invoke(SUP.SUPERVISOR_READ_PROFILE, {
        project_id,
        project_path: currentProject.path || '',
        supervisorRoot: currentSupervisorRoot || undefined,
      });
      if (!alive) return;
      lastLoaded = loaded;
      // Reset the raw toggle so switching projects doesn't carry the previous
      // expanded state into a new (potentially much larger) profile.
      showingRaw = false;
      renderLoaded(loaded, currentProject);
    } catch (err) {
      if (!alive) return;
      setEmpty(`Failed to read profile: ${err.message || err}`, 'error');
    }
  }

  function setProject(project) {
    currentProject = project || null;
    load();
  }

  function setSupervisorRoot(root_) {
    if (root_ === currentSupervisorRoot) return;
    currentSupervisorRoot = root_ || null;
    // Only matters when the YAML fallback path would change; reload so the
    // panel shows the right source the next time it's looked at.
    if (currentProject) load();
  }

  function refresh() { load(); }

  function stop() { alive = false; }

  // Initial paint
  load();

  return {
    setProject,
    setSupervisorRoot,
    refresh,
    stop,
    // Test/debug surface — never read in production code.
    __getLastLoaded: () => lastLoaded,
  };
}

module.exports = { create, pickViewModel, formatBudgets, shortenHome, slugifyProjectName };
