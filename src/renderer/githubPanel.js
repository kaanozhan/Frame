/**
 * GitHub Panel Module
 * UI for displaying GitHub issues, branches, and worktrees
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');

let isVisible = false;
let issuesData = [];
let branchesData = { currentBranch: '', branches: [] };
let worktreesData = { worktrees: [] };
let currentTab = 'issues'; // issues, prs, branches, worktrees
let currentFilter = 'open'; // open, closed, all
let repoName = null;

// DOM Elements
let panelElement = null;
let contentElement = null;
let filterElement = null;
let branchesActionsElement = null;

/**
 * Initialize GitHub panel
 */
function init() {
  panelElement = document.getElementById('github-panel');
  contentElement = document.getElementById('github-content');
  filterElement = document.getElementById('github-filter');
  branchesActionsElement = document.getElementById('github-branches-actions');

  if (!panelElement) {
    console.error('GitHub panel element not found');
    return;
  }

  setupEventListeners();
  setupIPCListeners();
  setupModalListeners();
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
    notify.success('Issues refreshed');
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

  // Show/hide filter for issues/prs tabs
  if (filterElement) {
    filterElement.style.display = (tab === 'issues' || tab === 'prs') ? 'flex' : 'none';
  }

  // Show/hide branches actions for branches tab
  if (branchesActionsElement) {
    branchesActionsElement.style.display = tab === 'branches' ? 'flex' : 'none';
  }

  // Load content based on tab
  if (tab === 'issues') {
    loadIssues();
  } else if (tab === 'branches') {
    loadBranches();
  } else if (tab === 'worktrees') {
    loadWorktrees();
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
function renderLoading(message = 'Loading...') {
  if (!contentElement) return;

  contentElement.innerHTML = `
    <div class="github-loading">
      <div class="github-loading-spinner"></div>
      <p>${message}</p>
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
 * Escape HTML for safe rendering
 */
// ==================== BRANCHES FUNCTIONALITY ====================

/**
 * Load git branches
 */
async function loadBranches() {
  const state = require('./state');
  const projectPath = state.getProjectPath();

  if (!projectPath) {
    renderBranchesError('No project selected');
    return;
  }

  renderLoading('Loading branches...');

  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath);

    if (result.error) {
      renderBranchesError(result.error);
    } else {
      branchesData = result;
      renderBranches();
    }
  } catch (err) {
    console.error('Error loading branches:', err);
    renderBranchesError('Failed to load branches');
  }
}

/**
 * Render branches list
 */
function renderBranches() {
  if (!contentElement) return;

  const { currentBranch, branches } = branchesData;

  if (!branches || branches.length === 0) {
    contentElement.innerHTML = `
      <div class="github-empty">
        <div class="github-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/>
            <circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
        </div>
        <p>No branches found</p>
        <span>Not a git repository?</span>
      </div>
    `;
    return;
  }

  // Separate local and remote branches
  const localBranches = branches.filter(b => !b.isRemote);
  const remoteBranches = branches.filter(b => b.isRemote);

  contentElement.innerHTML = `
    <div class="git-branches-section">
      <h4 class="git-branches-section-title">Local Branches</h4>
      ${localBranches.map(branch => renderBranchItem(branch, currentBranch)).join('')}
    </div>
    ${remoteBranches.length > 0 ? `
      <div class="git-branches-section">
        <h4 class="git-branches-section-title">Remote Branches</h4>
        ${remoteBranches.map(branch => renderBranchItem(branch, currentBranch)).join('')}
      </div>
    ` : ''}
  `;

  attachBranchEventListeners();
}

/**
 * Render single branch item
 */
function renderBranchItem(branch, currentBranch) {
  const isCurrent = branch.name === currentBranch;
  const canDelete = !isCurrent && !branch.isRemote;
  const canSwitch = !isCurrent;

  return `
    <div class="git-branch-item ${isCurrent ? 'current' : ''}" data-branch="${escapeHtml(branch.name)}">
      <div class="git-branch-indicator">
        ${isCurrent ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>' : ''}
      </div>
      <div class="git-branch-content">
        <div class="git-branch-name">${escapeHtml(branch.name)}</div>
        <div class="git-branch-meta">
          <span class="git-branch-commit">${escapeHtml(branch.commit || '')}</span>
          <span class="git-branch-date">${escapeHtml(branch.date || '')}</span>
        </div>
      </div>
      <div class="git-branch-actions">
        ${canSwitch ? `<button class="git-branch-action-btn checkout" title="Switch to branch"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>` : ''}
        ${canDelete ? `<button class="git-branch-action-btn delete" title="Delete branch"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Attach branch event listeners
 */
function attachBranchEventListeners() {
  // Checkout buttons
  contentElement.querySelectorAll('.git-branch-action-btn.checkout').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const branchName = btn.closest('.git-branch-item').dataset.branch;
      await handleSwitchBranch(branchName);
    });
  });

  // Delete buttons
  contentElement.querySelectorAll('.git-branch-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const branchName = btn.closest('.git-branch-item').dataset.branch;
      await handleDeleteBranch(branchName);
    });
  });
}

/**
 * Handle branch switch
 */
async function handleSwitchBranch(branchName) {
  const state = require('./state');
  const projectPath = state.getProjectPath();

  try {
    const result = await ipcRenderer.invoke(IPC.SWITCH_GIT_BRANCH, { projectPath, branchName });

    if (result.error === 'uncommitted_changes') {
      notify.error('Commit or stash changes first');
      return;
    }

    if (result.error) {
      notify.error(`Failed: ${result.error}`);
      return;
    }

    notify.success(`Switched to ${result.branch}`);
    await loadBranches();
  } catch (err) {
    notify.error('Failed to switch branch');
  }
}

/**
 * Handle branch deletion
 */
async function handleDeleteBranch(branchName) {
  if (!confirm(`Delete branch "${branchName}"?`)) return;

  const state = require('./state');
  const projectPath = state.getProjectPath();

  try {
    const result = await ipcRenderer.invoke(IPC.DELETE_GIT_BRANCH, { projectPath, branchName, force: false });

    if (result.error) {
      const forceDelete = confirm(`Branch "${branchName}" is not fully merged.\n\nForce delete?`);
      if (forceDelete) {
        const forceResult = await ipcRenderer.invoke(IPC.DELETE_GIT_BRANCH, { projectPath, branchName, force: true });
        if (forceResult.error) {
          notify.error(`Failed: ${forceResult.error}`);
          return;
        }
      } else {
        return;
      }
    }

    notify.success(`Deleted ${branchName}`);
    await loadBranches();
  } catch (err) {
    notify.error('Failed to delete branch');
  }
}

/**
 * Render branches error
 */
function renderBranchesError(message) {
  if (!contentElement) return;

  contentElement.innerHTML = `
    <div class="github-error">
      <div class="github-error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="6" y1="3" x2="6" y2="15"/>
          <circle cx="18" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
      </div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// ==================== WORKTREES FUNCTIONALITY ====================

/**
 * Load git worktrees
 */
async function loadWorktrees() {
  const state = require('./state');
  const projectPath = state.getProjectPath();

  if (!projectPath) {
    renderWorktreesError('No project selected');
    return;
  }

  renderLoading('Loading worktrees...');

  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GIT_WORKTREES, projectPath);

    if (result.error) {
      renderWorktreesError(result.error);
    } else {
      worktreesData = result;
      renderWorktrees();
    }
  } catch (err) {
    console.error('Error loading worktrees:', err);
    renderWorktreesError('Failed to load worktrees');
  }
}

/**
 * Render worktrees list
 */
function renderWorktrees() {
  if (!contentElement) return;

  const { worktrees } = worktreesData;

  if (!worktrees || worktrees.length === 0) {
    contentElement.innerHTML = `
      <div class="github-empty">
        <div class="github-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <p>No worktrees</p>
        <span>Add a worktree to work on multiple branches</span>
      </div>
    `;
    return;
  }

  contentElement.innerHTML = `
    <div class="git-worktrees-list">
      ${worktrees.map(wt => renderWorktreeItem(wt)).join('')}
    </div>
  `;

  attachWorktreeEventListeners();
}

/**
 * Render single worktree item
 */
function renderWorktreeItem(worktree) {
  const canRemove = !worktree.isMain;
  const pathName = worktree.path.split('/').pop() || worktree.path;

  return `
    <div class="git-worktree-item ${worktree.isMain ? 'main' : ''}" data-path="${escapeHtml(worktree.path)}">
      <div class="git-worktree-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div class="git-worktree-content">
        <div class="git-worktree-name">${escapeHtml(pathName)}</div>
        <div class="git-worktree-meta">
          <span class="git-worktree-branch">${escapeHtml(worktree.branch || 'detached')}</span>
          ${worktree.isMain ? '<span class="git-worktree-badge">main</span>' : ''}
        </div>
        <div class="git-worktree-path">${escapeHtml(worktree.path)}</div>
      </div>
      <div class="git-worktree-actions">
        ${canRemove ? `<button class="git-worktree-action-btn remove" title="Remove worktree"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Attach worktree event listeners
 */
function attachWorktreeEventListeners() {
  contentElement.querySelectorAll('.git-worktree-action-btn.remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wtPath = btn.closest('.git-worktree-item').dataset.path;
      await handleRemoveWorktree(wtPath);
    });
  });
}

/**
 * Handle worktree removal
 */
async function handleRemoveWorktree(wtPath) {
  if (!confirm(`Remove worktree at "${wtPath}"?`)) return;

  const state = require('./state');
  const projectPath = state.getProjectPath();

  try {
    const result = await ipcRenderer.invoke(IPC.REMOVE_GIT_WORKTREE, { projectPath, worktreePath: wtPath, force: false });

    if (result.error) {
      const forceRemove = confirm(`Worktree has local changes.\n\nForce remove?`);
      if (forceRemove) {
        await ipcRenderer.invoke(IPC.REMOVE_GIT_WORKTREE, { projectPath, worktreePath: wtPath, force: true });
      } else {
        return;
      }
    }

    notify.success('Worktree removed');
    await loadWorktrees();
  } catch (err) {
    notify.error('Failed to remove worktree');
  }
}

/**
 * Render worktrees error
 */
function renderWorktreesError(message) {
  if (!contentElement) return;

  contentElement.innerHTML = `
    <div class="github-error">
      <div class="github-error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// ==================== MODAL FUNCTIONALITY ====================

/**
 * Setup modal event listeners
 */
function setupModalListeners() {
  const modal = document.getElementById('create-branch-modal');
  const input = document.getElementById('new-branch-name');
  const closeBtn = document.getElementById('create-branch-modal-close');
  const cancelBtn = document.getElementById('create-branch-cancel');
  const confirmBtn = document.getElementById('create-branch-confirm');
  const createBranchBtn = document.getElementById('github-create-branch-btn');

  if (createBranchBtn) {
    createBranchBtn.addEventListener('click', () => showCreateBranchModal());
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => hideCreateBranchModal());
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => hideCreateBranchModal());
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => handleCreateBranch());
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleCreateBranch();
      } else if (e.key === 'Escape') {
        hideCreateBranchModal();
      }
    });
  }

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideCreateBranchModal();
      }
    });
  }
}

/**
 * Show create branch modal
 */
function showCreateBranchModal() {
  const modal = document.getElementById('create-branch-modal');
  const input = document.getElementById('new-branch-name');
  const select = document.getElementById('base-branch-select');
  const checkbox = document.getElementById('switch-to-branch');

  if (modal) {
    modal.classList.add('visible');

    // Reset form
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
    if (checkbox) {
      checkbox.checked = true;
    }

    // Populate base branch dropdown
    populateBaseBranchSelect(select);
  }
}

/**
 * Populate base branch select dropdown
 */
async function populateBaseBranchSelect(select) {
  if (!select) return;

  select.innerHTML = '<option value="">Loading...</option>';

  const state = require('./state');
  const projectPath = state.getProjectPath();

  if (!projectPath) {
    select.innerHTML = '<option value="">No project selected</option>';
    return;
  }

  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath);

    if (result.error || !result.branches) {
      select.innerHTML = '<option value="">Failed to load branches</option>';
      return;
    }

    // Get local branches only for base branch selection
    const localBranches = result.branches.filter(b => !b.isRemote);
    const currentBranch = result.currentBranch;

    select.innerHTML = localBranches.map(branch => {
      const isDefault = branch.name === currentBranch;
      return `<option value="${escapeHtml(branch.name)}" ${isDefault ? 'selected' : ''}>${escapeHtml(branch.name)}${isDefault ? ' (current)' : ''}</option>`;
    }).join('');

  } catch (err) {
    console.error('Failed to load branches for select:', err);
    select.innerHTML = '<option value="">Failed to load branches</option>';
  }
}

/**
 * Hide create branch modal
 */
function hideCreateBranchModal() {
  const modal = document.getElementById('create-branch-modal');
  if (modal) {
    modal.classList.remove('visible');
  }
}

/**
 * Handle create branch
 */
async function handleCreateBranch() {
  const input = document.getElementById('new-branch-name');
  const select = document.getElementById('base-branch-select');
  const checkbox = document.getElementById('switch-to-branch');

  const branchName = input?.value?.trim();
  const baseBranch = select?.value;
  const shouldCheckout = checkbox?.checked ?? true;

  if (!branchName) {
    notify.error('Please enter a branch name');
    return;
  }

  const state = require('./state');
  const projectPath = state.getProjectPath();

  try {
    const result = await ipcRenderer.invoke(IPC.CREATE_GIT_BRANCH, {
      projectPath,
      branchName,
      baseBranch,
      checkout: shouldCheckout
    });

    if (result.error) {
      notify.error(`Failed: ${result.error}`);
      return;
    }

    hideCreateBranchModal();
    const message = shouldCheckout
      ? `Created and switched to ${branchName}`
      : `Created ${branchName}`;
    notify.success(message);
    await loadBranches();
  } catch (err) {
    notify.error('Failed to create branch');
  }
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  loadIssues,
  loadBranches,
  loadWorktrees,
  isVisible: () => isVisible
};
