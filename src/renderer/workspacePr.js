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
const { exclusive } = require('./scopeGuard');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const notify = require('./notify');
const { escapeHtml } = require('./htmlUtils');
const { fixChecksPrompt, updateMenuState, updateMessage, conflictPrompt } = require('../shared/prFlow');
const laneStatus = require('./laneStatus');

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

/**
 * GitHub access for `ws`: the desktop's `gh` for local workspaces, the
 * server's for a server workspace (server-workspace-panels).
 */
function access(ws) {
  const none = { gh: false, authed: false, repoName: null };
  if (ws && ws.location === 'server') return (current && current.serverAccess) || none;
  return (current && current.access) || none;
}

/** Why PR actions are unavailable for `ws`, or null when they are. Server messages name the host. */
function prBlockedReason(ws) {
  const a = access(ws);
  const on = ws && ws.location === 'server' ? ` on ${ws.host || 'the server'}` : '';
  if (ws && ws.location === 'server' && ws.offline) return `${ws.host || 'The server'} is offline`;
  if (!a.gh) return `GitHub CLI (gh) is not installed${on}`;
  if (!a.authed) return `GitHub CLI is not signed in${on} — run \`gh auth login\`${on ? ' there' : ''}`;
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
  if (ws.offline) return ''; // the last known server state would be stale
  const raw = rowState(ws.id);
  if (!raw || ws.missing) return '';
  // Counts come from main (or the server); never interpolate them uncoerced (R12).
  const s = { ...raw, dirty: Number(raw.dirty) || 0, unpushed: Number(raw.unpushed) || 0, behind: Number(raw.behind) || 0,
    pr: raw.pr ? { ...raw.pr, number: Number(raw.pr.number) || 0, comments: Number(raw.pr.comments) || 0, state: String(raw.pr.state || '') } : null };
  const parts = [];
  if (s.dirty) parts.push(`<span class="ws-badge dirty" title="${s.dirty} uncommitted change${s.dirty === 1 ? '' : 's'}">●${s.dirty}</span>`);
  if (s.merging) {
    const n = (s.conflicts || []).length;
    parts.push(`<span class="ws-badge merging" title="Update from ${escapeHtml(ws.base || 'the base')} stopped${n ? ` on ${n} conflicted file${n === 1 ? '' : 's'}` : ''} — resolve or abort from the menu">⚠ merging</span>`);
  }
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
  if (ws.missing || ws.offline) return [];
  const s = rowState(ws.id);
  const items = [];
  items.push({ id: 'pr:review', label: 'Review Changes…' });
  for (const it of updateMenuState({ behind: s ? s.behind : 0, merging: !!(s && s.merging), conflicts: s ? s.conflicts : [], base: ws.base })) {
    items.push(it);
  }
  items.push({ id: 'pr:push', label: s && s.unpushed ? `Push (${s.unpushed})` : 'Push' });
  const blocked = prBlockedReason(ws);
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
  if (id === 'update:run') { updateFromBase(ws); return true; }
  if (id === 'update:resolve') { resolveConflicts(ws); return true; }
  if (id === 'update:abort') { abortUpdate(ws); return true; }
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
// One Create PR request at a time (R2): a second open — ⌘⌥P while the dialog
// is up or its draft is loading — refocuses the dialog instead of binding a
// second set of listeners that could create the PR for another workspace.
const openCreatePr = exclusive(openCreatePrOnce, {
  onBusy: () => {
    const modal = document.getElementById('create-pr-modal');
    const title = modal && modal.classList.contains('visible') && modal.querySelector('#cpr-title');
    if (title) title.focus();
  }
});

async function openCreatePrOnce(ws) {
  const blocked = prBlockedReason(ws);
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
  if (result.queued) {
    notify.info(`PR #${Number(result.number) || ''} was accepted but has not merged yet (merge queue or auto-merge). The workspace is kept; archive it once the PR has merged.`);
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

// ─── Update from base (update-from-base) ──────────────────────

const updating = new Set(); // workspace ids with an update in flight

/**
 * Fetch the base and merge it into the workspace branch (main decides; see
 * workspaceGitState.updateFromBase). Nothing is pushed.
 */
async function updateFromBase(ws) {
  if (!ws || updating.has(ws.id)) return null;
  // The project this update is for: the conflict follow-up acts on it, never
  // on whatever is selected when the user answers (R6).
  const projectPath = state.getProjectPath();
  updating.add(ws.id);
  notify.info(`Updating ${ws.name} from ${ws.base || 'main'}…`);
  let result;
  try {
    result = await ipcRenderer.invoke(IPC.WORKSPACE_UPDATE_FROM_BASE, { projectPath, id: ws.id });
  } catch (err) {
    result = { error: (err && err.message) || String(err) };
  } finally {
    updating.delete(ws.id);
  }
  const text = updateMessage(result);
  if (result && result.state === 'conflict') {
    notify.error(text);
    const choice = await askConflictChoice(ws, result.files || []);
    if (choice === 'resolve') await resolveConflicts(ws, result.files, { projectPath });
    else if (choice === 'abort') await abortUpdate(ws, { confirmed: true, projectPath });
    return result;
  }
  if (!result || result.error || result.state === 'dirty') notify.error(text);
  else if (result.state === 'updated') notify.success(text);
  else notify.info(text);
  return result;
}

/**
 * A workspace's terminals running an agent, most recently active first:
 * `[{ id, name, agentName }]`. The review's "Send to" and the conflict
 * hand-off pick from the same list (default: the first, else a new lane).
 */
function workspaceAgentLanes(projectPath, workspaceId) {
  let terms = [];
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    terms = ui ? ui.getManager().getTerminalsInScope(projectPath, workspaceId) : [];
  } catch (_) {
    terms = [];
  }
  return terms
    .map((t) => ({ id: t.id, name: t.customName || t.name || 'Terminal', st: laneStatus.getStatus(t.id) }))
    .filter((l) => l.st && l.st.agentName)
    .sort((a, b) => (b.st.lastActivityAt || 0) - (a.st.lastActivityAt || 0))
    .map((l) => ({ id: l.id, name: l.name, agentName: l.st.agentName, lastActivityAt: l.st.lastActivityAt || 0 }));
}

/**
 * The conflict dialog. Resolves 'resolve' | 'abort' | 'later'. Two updates
 * that both stop on conflicts take turns (R7): each click answers one.
 */
const askConflictChoice = exclusive(askConflictChoiceOnce, { queue: true });

function askConflictChoiceOnce(ws, files) {
  const modal = document.getElementById('update-conflict-modal');
  if (!modal) return Promise.resolve('later');
  modal.querySelector('#uc-summary').textContent = `Merging origin/${ws.base || 'main'} into ${ws.branch} stopped on ${files.length} conflicted file${files.length === 1 ? '' : 's'}.`;
  modal.querySelector('#uc-files').innerHTML = files.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  modal.classList.add('visible');
  const resolveBtn = modal.querySelector('#uc-resolve');
  resolveBtn.focus();
  return new Promise((resolve) => {
    const done = (choice) => {
      modal.classList.remove('visible');
      modal.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey, true);
      resolve(choice);
    };
    const onClick = (e) => {
      if (e.target.closest('#uc-resolve')) done('resolve');
      else if (e.target.closest('#uc-abort')) done('abort');
      else if (e.target.closest('#uc-later') || e.target === modal) done('later');
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('later'); }
    };
    modal.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
  });
}

/**
 * Hand a stopped update to an agent in the workspace: the most recently
 * active agent lane, else a new one. The agent resolves and commits; the
 * user pushes.
 */
async function resolveConflicts(ws, files = null, { projectPath = state.getProjectPath() } = {}) {
  if (state.getProjectPath() !== projectPath) {
    // Another project is open now: selecting this workspace would pair it
    // with the wrong project (R6). The row keeps offering "Resolve".
    notify.info(`"${ws.name}" is in another project — open it to hand the conflicts to an agent.`);
    return null;
  }
  const s = rowState(ws.id);
  const list = files || (s && s.conflicts) || [];
  require('./workspaceSection').select(ws);
  const lanes = workspaceAgentLanes(projectPath, ws.id);
  const prompt = conflictPrompt({ branch: ws.branch, base: ws.base || 'main', files: list });
  const assignment = { kind: 'task', label: `merge ${ws.base || 'main'}: conflicts`, ref: `update-${ws.id}` };
  const res = await require('./agentDispatch').dispatch(lanes.length
    ? { terminalId: lanes[0].id, prompt, assignment }
    : { createNew: true, prompt, assignment });
  if (res && res.success) notify.success(`Sent ${list.length} conflicted file${list.length === 1 ? '' : 's'} to ${lanes.length ? lanes[0].name : 'a new agent'}`);
  return res;
}

/** Abort a stopped update (`git merge --abort`): the branch goes back to where it was. */
async function abortUpdate(ws, { confirmed = false, projectPath = state.getProjectPath() } = {}) {
  if (!confirmed && !window.confirm(`Abort the update of "${ws.name}"? The branch goes back to where it was before the merge.`)) return null;
  const result = await ipcRenderer.invoke(IPC.WORKSPACE_UPDATE_ABORT, { projectPath, id: ws.id });
  if (!result || result.error) notify.error(`Abort failed: ${(result && result.error) || 'unknown error'}`);
  else if (result.aborted) notify.success(`Update aborted — ${ws.branch} is back where it was`);
  else notify.info('No update in progress.');
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
  merge,
  updateFromBase,
  resolveConflicts,
  abortUpdate,
  workspaceAgentLanes
};
