/**
 * Overview Panel Module
 * Dashboard view showing project state
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const structureMap = require('./structureMap');

let isVisible = false;
let overviewData = null;
let containerElement = null;
let graphBuilding = null; // { progress } while a build runs, else null

/**
 * Initialize overview panel
 */
function init() {
  // Initialize structure map
  structureMap.init();

  // Live graph-build state: while building, the card shows progress; when a
  // build finishes (any terminal status) the panel re-renders from disk.
  ipcRenderer.on(IPC.CODE_GRAPH_STATUS, (event, payload) => {
    const state = require('./state');
    if (!payload || payload.projectPath !== state.getProjectPath()) return;
    if (payload.status === 'building') {
      graphBuilding = { progress: payload.progress || null };
      updateGraphCard();
    } else {
      graphBuilding = null;
      if (containerElement) refresh();
    }
  });
}

/** Re-render only the graph card in place (cheap progress updates). */
function updateGraphCard() {
  if (!containerElement) return;
  const card = containerElement.querySelector('[data-card="graph"]');
  if (!card) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderGraphCard(overviewData ? overviewData.graph : null);
  const newCard = wrapper.firstElementChild;
  card.replaceWith(newCard);
  // Re-wire the button — the in-place swap dropped the original listener.
  const btn = newCard.querySelector('[data-action="graph-reanalyze"]');
  if (btn) {
    btn.addEventListener('click', () => {
      const state = require('./state');
      const projectPath = state.getProjectPath();
      if (!projectPath) return;
      graphBuilding = { progress: null };
      updateGraphCard();
      ipcRenderer.invoke(IPC.REBUILD_CODE_GRAPH, projectPath);
    });
  }
}

/**
 * Load overview data
 */
async function loadOverview() {
  const state = require('./state');
  const projectPath = state.getProjectPath();

  if (!projectPath) {
    return { error: 'No project selected' };
  }

  try {
    overviewData = await ipcRenderer.invoke(IPC.LOAD_OVERVIEW, projectPath);
    return overviewData;
  } catch (err) {
    console.error('Error loading overview:', err);
    return { error: err.message };
  }
}

/**
 * Render overview in container
 */
async function render(container) {
  containerElement = container;
  container.innerHTML = renderLoading();

  const data = await loadOverview();

  if (data.error) {
    container.innerHTML = renderError(data.error);
    return;
  }

  container.innerHTML = renderOverview(data);

  // Setup click handlers for interactive cards
  setupCardInteractions(container, data);
}

/**
 * Render loading state
 */
function renderLoading() {
  return `
    <div class="overview-loading">
      <div class="overview-spinner"></div>
      <p>Loading project overview...</p>
    </div>
  `;
}

/**
 * Render error state
 */
function renderError(message) {
  return `
    <div class="overview-error">
      <div class="overview-error-icon">!</div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Render overview dashboard
 */
function renderOverview(data) {
  return `
    <div class="overview-container">
      <div class="overview-header">
        <h2>${escapeHtml(data.projectName)}</h2>
        <span class="overview-subtitle">Project Overview</span>
      </div>

      <div class="overview-grid">
        ${renderStructureCard(data.structure)}
        ${renderProgressCard(data.tasks)}
        ${renderDecisionsCard(data.decisions)}
        ${renderStatsCard(data.stats)}
        ${renderGraphCard(data.graph)}
      </div>

      <div class="overview-footer">
        <span>Last updated: ${formatTime(data.generatedAt)}</span>
        <button class="overview-refresh-btn" onclick="window.overviewRefresh && window.overviewRefresh()">Refresh</button>
      </div>
    </div>
  `;
}

/**
 * Render structure card
 */
function renderStructureCard(structure) {
  if (!structure || structure.totalModules === 0) {
    return `
      <div class="overview-card" data-card="structure">
        <div class="card-header">
          <span class="card-icon">📁</span>
          <span class="card-title">Structure</span>
        </div>
        <div class="card-empty">No STRUCTURE.json found</div>
      </div>
    `;
  }

  const groupsHtml = (structure.groups || []).map(g => `
    <div class="structure-group">
      <span class="group-name">${escapeHtml(g.name)}/</span>
      <span class="group-count">${g.count} modules</span>
    </div>
  `).join('');

  return `
    <div class="overview-card clickable" data-card="structure">
      <div class="card-header">
        <span class="card-icon">📁</span>
        <span class="card-title">Structure</span>
      </div>
      <div class="card-content">
        <div class="card-stat-big">${structure.totalModules}</div>
        <div class="card-stat-label">modules</div>
        <div class="structure-groups">
          ${groupsHtml}
        </div>
        ${structure.ipcChannels ? `<div class="card-meta">${structure.ipcChannels} IPC channels</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render progress card
 */
function renderProgressCard(tasks) {
  if (!tasks || tasks.total === 0) {
    return `
      <div class="overview-card">
        <div class="card-header">
          <span class="card-icon">✅</span>
          <span class="card-title">Progress</span>
        </div>
        <div class="card-empty">No tasks yet</div>
      </div>
    `;
  }

  const progressPercent = tasks.progress || 0;

  return `
    <div class="overview-card">
      <div class="card-header">
        <span class="card-icon">✅</span>
        <span class="card-title">Progress</span>
      </div>
      <div class="card-content">
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="progress-text">${tasks.completed}/${tasks.total} tasks completed</div>
        <div class="task-breakdown">
          <span class="task-stat completed">${tasks.completed} done</span>
          <span class="task-stat in-progress">${tasks.inProgress} in progress</span>
          <span class="task-stat pending">${tasks.pending} pending</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render decisions card
 */
function renderDecisionsCard(decisions) {
  if (!decisions || decisions.total === 0) {
    return `
      <div class="overview-card">
        <div class="card-header">
          <span class="card-icon">📝</span>
          <span class="card-title">Decisions</span>
        </div>
        <div class="card-empty">No decisions recorded</div>
      </div>
    `;
  }

  const recentDecisions = (decisions.decisions || []).slice(0, 5).map(d => `
    <div class="decision-item">
      <span class="decision-date">${d.date}</span>
      <span class="decision-title">${escapeHtml(d.title)}</span>
    </div>
  `).join('');

  return `
    <div class="overview-card">
      <div class="card-header">
        <span class="card-icon">📝</span>
        <span class="card-title">Decisions</span>
      </div>
      <div class="card-content">
        <div class="card-stat-big">${decisions.total}</div>
        <div class="card-stat-label">decisions recorded</div>
        <div class="decisions-list">
          ${recentDecisions}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render stats card
 */
function renderStatsCard(stats) {
  if (!stats) {
    return `
      <div class="overview-card">
        <div class="card-header">
          <span class="card-icon">📈</span>
          <span class="card-title">Stats</span>
        </div>
        <div class="card-empty">No stats available</div>
      </div>
    `;
  }

  const linesOfCode = stats.linesOfCode?.total || 0;
  const fileCount = stats.fileCount?.total || 0;
  const git = stats.git;

  return `
    <div class="overview-card">
      <div class="card-header">
        <span class="card-icon">📈</span>
        <span class="card-title">Stats</span>
      </div>
      <div class="card-content">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-value">${formatNumber(linesOfCode)}</div>
            <div class="stat-label">lines of code</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${fileCount}</div>
            <div class="stat-label">source files</div>
          </div>
          ${git ? `
            <div class="stat-item">
              <div class="stat-value">${git.commitCount}</div>
              <div class="stat-label">commits</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${escapeHtml(git.branch)}</div>
              <div class="stat-label">branch</div>
            </div>
          ` : ''}
        </div>
        ${git ? `<div class="card-meta">Last: ${escapeHtml(git.lastCommit)}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render code-graph card. States mirror meta.json's degradation matrix:
 * never built / building / built / partial / no-languages / error — each
 * says what happened and (where useful) offers Re-analyze.
 */
function renderGraphCard(graph) {
  const header = `
    <div class="card-header">
      <span class="card-icon">🕸️</span>
      <span class="card-title">Code Graph</span>
    </div>
  `;
  const reanalyzeBtn = '<button class="overview-refresh-btn" data-action="graph-reanalyze">Re-analyze</button>';

  if (graphBuilding) {
    const p = graphBuilding.progress;
    return `
      <div class="overview-card" data-card="graph">
        ${header}
        <div class="card-content">
          <div class="card-stat-label">Analyzing codebase…${p ? ` (${p.parsed}/${p.total} files)` : ''}</div>
        </div>
      </div>
    `;
  }

  if (!graph) {
    return `
      <div class="overview-card" data-card="graph">
        ${header}
        <div class="card-empty">Not analyzed yet</div>
        <div class="card-content">${reanalyzeBtn.replace('Re-analyze', 'Analyze')}</div>
      </div>
    `;
  }

  if (graph.status === 'no-languages') {
    return `
      <div class="overview-card" data-card="graph">
        ${header}
        <div class="card-content">
          <div class="card-stat-label">Couldn't detect any languages — review .frame/config.json</div>
          ${reanalyzeBtn}
        </div>
      </div>
    `;
  }

  if (graph.status === 'error') {
    return `
      <div class="overview-card" data-card="graph">
        ${header}
        <div class="card-content">
          <div class="card-stat-label">Analysis failed: ${escapeHtml(graph.error || 'unknown error')}</div>
          ${reanalyzeBtn}
        </div>
      </div>
    `;
  }

  // built / partial
  const counts = graph.counts || {};
  const notes = [];
  if (graph.status === 'partial') notes.push('partial — time budget hit');
  if ((graph.capsHit || []).length > 0) notes.push(`${graph.capsHit.length} cap(s) hit`);
  if ((graph.skippedLanguages || []).length > 0) notes.push(`skipped: ${graph.skippedLanguages.join(', ')}`);

  return `
    <div class="overview-card" data-card="graph">
      ${header}
      <div class="card-content">
        <div class="card-stat-big">${counts.symbols || 0}</div>
        <div class="card-stat-label">symbols · ${counts.files || 0} files · ${counts.imports || 0} imports</div>
        ${notes.length ? `<div class="card-meta">${escapeHtml(notes.join(' · '))}</div>` : ''}
        <div class="card-meta">Built ${formatTime(graph.builtAt)} · query: node .frame/bin/graph-query.js</div>
        ${reanalyzeBtn}
      </div>
    </div>
  `;
}

/**
 * Setup card click interactions
 */
function setupCardInteractions(container, data) {
  const state = require('./state');
  const projectPath = state.getProjectPath();

  // Structure card - open interactive map
  const structureCard = container.querySelector('[data-card="structure"].clickable');
  if (structureCard && projectPath) {
    structureCard.addEventListener('click', () => {
      structureMap.show(projectPath);
    });
  }

  // Graph card - trigger a rebuild (progress arrives via CODE_GRAPH_STATUS)
  const reanalyzeBtn = container.querySelector('[data-action="graph-reanalyze"]');
  if (reanalyzeBtn && projectPath) {
    reanalyzeBtn.addEventListener('click', () => {
      graphBuilding = { progress: null };
      updateGraphCard();
      ipcRenderer.invoke(IPC.REBUILD_CODE_GRAPH, projectPath);
    });
  }
}

/**
 * Refresh overview
 */
async function refresh() {
  if (containerElement) {
    await render(containerElement);
  }
}

// Expose refresh globally for onclick handler
window.overviewRefresh = refresh;

/**
 * Format time for display
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

module.exports = {
  init,
  render,
  refresh,
  loadOverview,
  isVisible: () => isVisible
};
