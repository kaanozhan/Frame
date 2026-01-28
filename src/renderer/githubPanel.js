/**
 * GitHub Panel Module
 * UI for displaying GitHub issues with tabbed interface
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let isVisible = false;
let issuesData = [];
let currentTab = 'issues'; // issues, prs, actions (future)
let currentFilter = 'open'; // open, closed, all
let repoName = null;

// DOM Elements
let panelElement = null;
let contentElement = null;

/**
 * Initialize GitHub panel
 */
function init() {
  panelElement = document.getElementById('github-panel');
  contentElement = document.getElementById('github-content');

  if (!panelElement) {
    console.error('GitHub panel element not found');
    return;
  }

  setupEventListeners();
  setupIPCListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Close button
  const closeBtn = document.getElementById('github-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hide);
  }

  // Collapse button
  const collapseBtn = document.getElementById('github-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', hide);
  }

  // Refresh button
  const refreshBtn = document.getElementById('github-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshIssues);
  }

  // Tab buttons
  document.querySelectorAll('.github-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      setTab(tab);
    });
  });

  // Filter buttons
  document.querySelectorAll('.github-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.target.dataset.filter;
      setFilter(filter);
    });
  });
}

/**
 * Setup IPC listeners
 */
function setupIPCListeners() {
  ipcRenderer.on(IPC.TOGGLE_GITHUB_PANEL, () => {
    toggle();
  });
}

/**
 * Load GitHub issues
 */
async function loadIssues() {
  const state = require('./state');
  const projectPath = state.getProjectPath();

  if (!projectPath) {
    renderError('No project selected');
    return;
  }

  renderLoading();

  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GITHUB_ISSUES, {
      projectPath,
      state: currentFilter
    });

    if (result.error) {
      renderError(result.error);
    } else {
      issuesData = result.issues;
      repoName = result.repoName;
      render();
    }
  } catch (err) {
    console.error('Error loading issues:', err);
    renderError('Failed to load issues');
  }
}

/**
 * Refresh issues
 */
async function refreshIssues() {
  const refreshBtn = document.getElementById('github-refresh-btn');

  try {
    if (refreshBtn) {
      refreshBtn.classList.add('spinning');
      refreshBtn.disabled = true;
    }

    await loadIssues();
    showToast('Issues refreshed', 'success');
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Show GitHub panel
 */
function show() {
  if (panelElement) {
    panelElement.classList.add('visible');
    isVisible = true;
    loadIssues();
  }
}

/**
 * Hide GitHub panel
 */
function hide() {
  if (panelElement) {
    panelElement.classList.remove('visible');
    isVisible = false;
  }
}

/**
 * Toggle GitHub panel visibility
 */
function toggle() {
  if (isVisible) {
    hide();
  } else {
    show();
  }
}

/**
 * Set active tab
 */
function setTab(tab) {
  currentTab = tab;

  // Update active tab button
  document.querySelectorAll('.github-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // For now, only issues tab is implemented
  if (tab === 'issues') {
    loadIssues();
  } else {
    renderComingSoon(tab);
  }
}

/**
 * Set filter
 */
function setFilter(filter) {
  currentFilter = filter;

  // Update active filter button
  document.querySelectorAll('.github-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  loadIssues();
}

/**
 * Render loading state
 */
function renderLoading() {
  if (!contentElement) return;

  contentElement.innerHTML = `
    <div class="github-loading">
      <div class="github-loading-spinner"></div>
      <p>Loading issues...</p>
    </div>
  `;
}

/**
 * Render error state
 */
function renderError(message) {
  if (!contentElement) return;

  let helpText = '';
  if (message === 'gh CLI not installed') {
    helpText = '<span>Install GitHub CLI: <a href="#" onclick="require(\'electron\').shell.openExternal(\'https://cli.github.com/\')">cli.github.com</a></span>';
  } else if (message === 'Not a GitHub repository') {
    helpText = '<span>This project is not connected to a GitHub repository</span>';
  }

  contentElement.innerHTML = `
    <div class="github-error">
      <div class="github-error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p>${escapeHtml(message)}</p>
      ${helpText}
    </div>
  `;
}

/**
 * Render coming soon state for unimplemented tabs
 */
function renderComingSoon(tab) {
  if (!contentElement) return;

  const tabNames = {
    prs: 'Pull Requests',
    actions: 'Actions'
  };

  contentElement.innerHTML = `
    <div class="github-coming-soon">
      <div class="github-coming-soon-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <p>${tabNames[tab] || tab} - Coming Soon</p>
      <span>This feature will be available in a future update</span>
    </div>
  `;
}

/**
 * Render issues list
 */
function render() {
  if (!contentElement) return;

  // Update repo name in header
  const repoNameEl = document.getElementById('github-repo-name');
  if (repoNameEl) {
    repoNameEl.textContent = repoName || '';
    repoNameEl.style.display = repoName ? 'block' : 'none';
  }

  if (!issuesData || issuesData.length === 0) {
    contentElement.innerHTML = `
      <div class="github-empty">
        <div class="github-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <p>No ${currentFilter} issues</p>
        <span>${currentFilter === 'open' ? 'All issues are resolved!' : 'No issues found with this filter'}</span>
      </div>
    `;
    return;
  }

  contentElement.innerHTML = issuesData.map(issue => renderIssueItem(issue)).join('');

  // Add event listeners to issue items
  contentElement.querySelectorAll('.github-issue-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      if (url) {
        ipcRenderer.send(IPC.OPEN_GITHUB_ISSUE, url);
      }
    });
  });
}

/**
 * Render single issue item
 */
function renderIssueItem(issue) {
  const stateClass = issue.state === 'OPEN' ? 'open' : 'closed';
  const stateIcon = issue.state === 'OPEN'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>';

  const labels = issue.labels && issue.labels.length > 0
    ? issue.labels.map(label => {
        const bgColor = label.color ? `#${label.color}` : 'var(--bg-hover)';
        const textColor = label.color ? getContrastColor(label.color) : 'var(--text-secondary)';
        return `<span class="github-label" style="background: ${bgColor}; color: ${textColor}">${escapeHtml(label.name)}</span>`;
      }).join('')
    : '';

  const createdAt = formatRelativeTime(issue.createdAt);
  const author = issue.author ? issue.author.login : 'unknown';

  return `
    <div class="github-issue-item ${stateClass}" data-url="${escapeHtml(issue.url)}">
      <div class="github-issue-state ${stateClass}">
        ${stateIcon}
      </div>
      <div class="github-issue-content">
        <div class="github-issue-header">
          <span class="github-issue-number">#${issue.number}</span>
          <span class="github-issue-title">${escapeHtml(issue.title)}</span>
        </div>
        ${labels ? `<div class="github-issue-labels">${labels}</div>` : ''}
        <div class="github-issue-meta">
          <span>opened ${createdAt} by ${escapeHtml(author)}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Get contrasting text color for a background color
 */
function getContrastColor(hexColor) {
  const r = parseInt(hexColor.substr(0, 2), 16);
  const g = parseInt(hexColor.substr(2, 2), 16);
  const b = parseInt(hexColor.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? '#000000' : '#ffffff';
}

/**
 * Format relative time
 */
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? 'just now' : `${diffMinutes} minutes ago`;
    }
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }

  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.github-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `github-toast github-toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
  `;

  if (panelElement) {
    panelElement.appendChild(toast);
  }

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

/**
 * Get toast icon based on type
 */
function getToastIcon(type) {
  switch (type) {
    case 'success':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    case 'error':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    default:
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  loadIssues,
  isVisible: () => isVisible
};
