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
  items.push({ id: 'pr:push', label: s && s.unpushed ? `Push (${s.unpushed})` : 'Push' });
  return items;
}

/** Run a PR-flow menu action for a workspace. Returns true when it was ours. */
function runAction(id, ws) {
  if (id === 'pr:push') { push(ws); return true; }
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
  push
};
