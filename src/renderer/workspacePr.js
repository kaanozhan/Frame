/**
 * Workspace PR — each workspace's way out, in the renderer
 * (workspace-pr-flow spec).
 *
 * Main reads git and PR state and pushes it (WORKSPACE_GIT_STATE); this
 * module keeps the latest payload for the current project and turns it into
 * what the sidebar shows: row badges (uncommitted, unpushed, behind, PR with
 * its checks) and row-menu actions. It owns the PR actions themselves
 * (push, create, fix checks, merge) so workspaceSection stays a list.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const notify = require('./notify');
const { escapeHtml } = require('./htmlUtils');
const { fixChecksPrompt } = require('../shared/prFlow');

let current = null;          // last WORKSPACE_GIT_STATE payload for the current project
const listeners = new Set();

function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) {
    try { cb(current); } catch (err) { console.error('workspacePr listener failed', err); }
  }
}

/** Ask main for fresh state of the current project (and make it the polled one). */
async function refresh() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  try {
    const payload = await ipcRenderer.invoke(IPC.WORKSPACE_GIT_REFRESH, { projectPath });
    if (payload && payload.projectPath === state.getProjectPath()) {
      current = payload;
      emit();
    }
  } catch (err) {
    console.error('workspacePr: refresh failed', err);
  }
}

function init() {
  ipcRenderer.on(IPC.WORKSPACE_GIT_STATE, (event, payload) => {
    if (!payload || payload.projectPath !== state.getProjectPath()) return;
    current = payload;
    emit();
  });
  state.onProjectChange(() => {
    current = null;
    emit();
    refresh();
  });
  if (state.getProjectPath()) refresh();
}

/** Row state of a workspace, or null before the first read. */
function rowState(id) {
  return (current && current.workspaces && current.workspaces[id]) || null;
}

/** GitHub access of the current project: `{ gh, authed, repoName }`. */
function access() {
  return (current && current.access) || { gh: false, authed: false, repoName: null };
}

/** Why PR actions are unavailable, or null when they are. */
function prBlockedReason() {
  const a = access();
  if (!a.gh) return 'GitHub CLI (gh) is not installed';
  if (!a.authed) return 'GitHub CLI is not signed in — run `gh auth login`';
  if (!a.repoName) return 'This project has no GitHub remote';
  return null;
}

function checksDot(pr) {
  const c = pr.checks || {};
  if (c.failing) return { cls: 'failing', title: `${c.failing} failing: ${(c.failingNames || []).join(', ')}` };
  if (c.pending) return { cls: 'pending', title: `${c.pending} check${c.pending === 1 ? '' : 's'} running` };
  if (c.passing) return { cls: 'passing', title: `${c.passing} check${c.passing === 1 ? '' : 's'} passing` };
  return null;
}

/** Badges under a workspace row's labels: dirty, ↑unpushed, ↓behind, PR. */
function rowBadgesHtml(ws) {
  const s = rowState(ws.id);
  if (!s || ws.missing) return '';
  const parts = [];
  if (s.dirty) parts.push(`<span class="ws-badge dirty" title="${s.dirty} uncommitted change${s.dirty === 1 ? '' : 's'}">●${s.dirty}</span>`);
  if (s.unpushed) parts.push(`<span class="ws-badge ahead" title="${s.unpushed} commit${s.unpushed === 1 ? '' : 's'} not pushed">↑${s.unpushed}</span>`);
  if (s.behind) parts.push(`<span class="ws-badge behind" title="${s.behind} commit${s.behind === 1 ? '' : 's'} behind ${escapeHtml(ws.base || 'its base')}">↓${s.behind}</span>`);
  if (s.pr) {
    const dot = checksDot(s.pr);
    const comments = s.pr.comments ? ` · ${s.pr.comments} comment${s.pr.comments === 1 ? '' : 's'}` : '';
    parts.push(`<span class="ws-badge pr ${escapeHtml(s.pr.state)}" title="PR #${s.pr.number} · ${escapeHtml(s.pr.state)}${dot ? ` · ${escapeHtml(dot.title)}` : ''}${comments}">#${s.pr.number}${dot ? `<span class="ws-checks ${dot.cls}"></span>` : ''}</span>`);
  }
  return parts.length ? `<span class="ws-badges">${parts.join('')}</span>` : '';
}

/**
 * Row-menu items for a workspace: `{ id, label, disabled?, title? }`.
 * workspaceSection renders them above its own items and hands clicks back
 * through runAction.
 */
function menuItems(ws) {
  if (ws.missing) return [];
  const s = rowState(ws.id);
  const items = [];
  items.push({ id: 'pr:review', label: 'Review Changes…' });
  items.push({ id: 'pr:push', label: s && s.unpushed ? `Push (${s.unpushed})` : 'Push' });
  const blocked = prBlockedReason();
  const hasOpenPr = !!(s && s.pr && (s.pr.state === 'open' || s.pr.state === 'draft'));
  if (!hasOpenPr) {
    items.push({ id: 'pr:create', label: 'Create Pull Request…', disabled: !!blocked, title: blocked || '' });
  }
  if (s && s.pr && hasOpenPr && s.pr.checks && s.pr.checks.failing) {
    items.push({ id: 'pr:fix', label: `Fix Failing Checks (${s.pr.checks.failing})`, title: (s.pr.checks.failingNames || []).join(', ') });
  }
  if (s && s.pr && hasOpenPr) {
    const why = s.pr.ready ? '' : s.pr.state === 'draft' ? 'Draft pull requests cannot be merged'
      : !s.pr.mergeable ? 'Not mergeable (conflicts or unknown)'
      : s.pr.checks.failing ? 'Checks are failing' : s.pr.checks.pending ? 'Checks are still running' : '';
    items.push({ id: 'pr:merge', label: `Merge PR #${s.pr.number}`, disabled: !s.pr.ready || !!blocked, title: blocked || why });
  }
  if (s && s.pr && s.pr.url) {
    items.push({ id: 'pr:open', label: `Open PR #${s.pr.number} on GitHub` });
  }
  return items;
}

/** Run a PR-flow menu action for a workspace. Returns true when it was ours. */
function runAction(id, ws) {
  if (id === 'pr:review') { require('./reviewSection').open(ws); return true; }
  if (id === 'pr:push') { push(ws); return true; }
  if (id === 'pr:create') { openCreatePr(ws); return true; }
  if (id === 'pr:fix') { fixChecks(ws); return true; }
  if (id === 'pr:open') { openOnGitHub(ws); return true; }
  if (id === 'pr:merge') { merge(ws); return true; }
  return false;
}

// ─── Actions ──────────────────────────────────────────────────

async function push(ws) {
  const s = rowState(ws.id);
  if (s && s.dirty) {
    const go = window.confirm(`"${ws.name}" has ${s.dirty} uncommitted change${s.dirty === 1 ? '' : 's'}. Push only what is committed?`);
    if (!go) return null;
  }
  const result = await ipcRenderer.invoke(IPC.WORKSPACE_PUSH, { projectPath: state.getProjectPath(), id: ws.id });
  if (result && result.error) notify.error(`Push failed: ${result.error}`);
  else notify.success(`Pushed ${ws.branch}`);
  return result;
}

/**
 * The Create PR dialog: main composes the title/body (from the workspace's
 * spec, else its commits), the user edits them and picks draft, and main
 * pushes and runs `gh pr create`.
 */
async function openCreatePr(ws) {
  const blocked = prBlockedReason();
  if (blocked) {
    notify.error(blocked);
    return;
  }
  const modal = document.getElementById('create-pr-modal');
  if (!modal) return;
  const projectPath = state.getProjectPath();
  const titleEl = modal.querySelector('#cpr-title');
  const bodyEl = modal.querySelector('#cpr-body');
  const draftEl = modal.querySelector('#cpr-draft');
  const errorEl = modal.querySelector('#cpr-error');
  const createBtn = modal.querySelector('#cpr-create');
  const cancelBtn = modal.querySelector('#cpr-cancel');

  const draft = await ipcRenderer.invoke(IPC.WORKSPACE_PR_DRAFT, { projectPath, id: ws.id });
  if (!draft || draft.error) {
    notify.error((draft && draft.error) || 'Could not prepare the pull request');
    return;
  }
  modal.querySelector('#cpr-summary').textContent = `${draft.branch} → ${draft.base} · ${draft.commits} commit${draft.commits === 1 ? '' : 's'}`;
  titleEl.value = draft.title;
  bodyEl.value = draft.body;
  draftEl.checked = false;
  errorEl.textContent = '';
  createBtn.disabled = false;
  createBtn.textContent = 'Create pull request';
  modal.classList.add('visible');
  titleEl.focus();
  titleEl.select();

  await new Promise((resolve) => {
    const cleanup = () => {
      modal.classList.remove('visible');
      createBtn.removeEventListener('click', onCreate);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKey);
      modal.removeEventListener('mousedown', onBackdrop);
      resolve();
    };
    const onCancel = () => { if (!createBtn.disabled) cleanup(); };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onCreate(); }
    };
    const onCreate = async () => {
      if (createBtn.disabled) return;
      if (!titleEl.value.trim()) {
        errorEl.textContent = 'A pull request needs a title.';
        return;
      }
      createBtn.disabled = true;
      createBtn.textContent = 'Pushing and creating…';
      const result = await ipcRenderer.invoke(IPC.WORKSPACE_PR_CREATE, {
        projectPath, id: ws.id, title: titleEl.value, body: bodyEl.value, draft: draftEl.checked
      });
      if (!result || result.error) {
        errorEl.textContent = (result && result.error) || 'Could not create the pull request.';
        createBtn.disabled = false;
        createBtn.textContent = 'Create pull request';
        return;
      }
      createBtn.disabled = false;
      notify.success(result.url ? `Pull request created — ${result.url}` : 'Pull request created');
      cleanup();
    };
    createBtn.addEventListener('click', onCreate);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKey);
    modal.addEventListener('mousedown', onBackdrop);
  });
}

/**
 * Hand the failing checks to an agent in the workspace: select it, then a new
 * lane gets a prompt naming the PR, the checks and the commands that show
 * their logs (prFlow.fixChecksPrompt). The agent fixes and commits; the user
 * pushes.
 */
async function fixChecks(ws) {
  const s = rowState(ws.id);
  if (!s || !s.pr || !s.pr.checks || !s.pr.checks.failing) {
    notify.info('No failing checks on this workspace’s pull request.');
    return null;
  }
  require('./workspaceSection').select(ws);
  const prompt = fixChecksPrompt({ branch: ws.branch, number: s.pr.number, failingNames: s.pr.checks.failingNames || [] });
  return require('./agentDispatch').dispatch({
    createNew: true,
    prompt,
    assignment: { kind: 'task', label: `fix checks: #${s.pr.number}`, ref: `pr-${s.pr.number}` }
  });
}

/**
 * Merge the workspace's PR with the project's method (main decides: the
 * setting, else the repository's first allowed). Main then fast-forwards the
 * main checkout when safe and archives the workspace when the setting is on.
 */
async function merge(ws) {
  const s = rowState(ws.id);
  if (!s || !s.pr || !s.pr.ready) {
    notify.info('This pull request is not ready to merge.');
    return null;
  }
  if (!window.confirm(`Merge PR #${s.pr.number} (${ws.branch} → ${ws.base || 'main'}) with the project's merge method?`)) return null;
  const result = await ipcRenderer.invoke(IPC.WORKSPACE_PR_MERGE, { projectPath: state.getProjectPath(), id: ws.id });
  if (!result || result.error) {
    notify.error(`Merge failed: ${(result && result.error) || 'unknown error'}`);
    return result;
  }
  const notes = [`Merged PR #${result.number} (${result.method})`];
  if (result.fastForward && result.fastForward.updated) notes.push(`main checkout updated`);
  else if (result.fastForward && result.fastForward.reason) notes.push(`main checkout not updated: ${result.fastForward.reason}`);
  if (result.archived) notes.push('workspace archived');
  else if (result.archiveNote) notes.push(result.archiveNote);
  notify.success(notes.join(' · '));
  return result;
}

/** Open the workspace's PR in the browser (same channel the GitHub panel uses). */
function openOnGitHub(ws) {
  const s = rowState(ws.id);
  if (s && s.pr && s.pr.url) ipcRenderer.send(IPC.OPEN_GITHUB_ISSUE, s.pr.url);
}

module.exports = {
  init,
  refresh,
  onChange,
  rowState,
  access,
  prBlockedReason,
  rowBadgesHtml,
  menuItems,
  runAction,
  push,
  openCreatePr,
  fixChecks,
  openOnGitHub,
  merge
};
