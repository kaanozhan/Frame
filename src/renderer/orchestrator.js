/**
 * Orchestrator (renderer) — a section viewport
 *
 * The conductor-led parallel-spec surface, rendered as a **section tab** next to
 * Home / Frames (not a modal): the host (MultiTerminalUI) mounts it into the
 * content area and shows a chip in the top bar. Layout: conductor terminal
 * embedded top-left, worker lanes bottom-left, assignable specs on the right.
 *
 * Composes existing pieces:
 *   - the conductor is a real lane whose live terminal is mounted into the top
 *     zone via manager.mountTerminal
 *   - workers are real lanes (each in its spec's worktree) created on
 *     ORCH_SPAWN_WORKER and handed to agentDispatch (start → wait ready →
 *     inject), shown as cards; clicking one enters its lane
 *
 * Main (orchestrationManager) owns worktrees, the bus, the conflict guard, and
 * merges. This is the renderer half.
 */

const { ipcRenderer } = require('electron');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_BIN_DIR, ORCH_BUS_DIR } = require('../shared/frameConstants');
const state = require('./state');
const agentDispatch = require('./agentDispatch');

let host = null;             // MultiTerminalUI
let seq = 0;
let liveContainer = null;    // current rendered root, for in-place worker updates
let activeVpKey = null;      // current section viewport key (for Stop → close tab)
let spawnChain = Promise.resolve(); // serializes worker-lane creation (see setHost)

// Sessions are PER-PROJECT: switching projects must not lose another project's
// conductor/workers. Each entry holds that project's view state; the live
// terminals themselves survive project switches in the terminal manager.
// Map<projectPath, { started, conductorId, latestState, assigned:Set<slug> }>
const sessions = new Map();

function _sess(projectPath, create = false) {
  let s = projectPath ? sessions.get(projectPath) : null;
  if (!s && create && projectPath) {
    s = { started: false, conductorId: null, latestState: { workers: [] }, assigned: new Set() };
    sessions.set(projectPath, s);
  }
  return s || null;
}

// The session for the project currently on screen (the visible viewport always
// belongs to the current project). null when no project / no session yet.
function _curSess(create = false) {
  return _sess(state.getProjectPath(), create);
}

function setHost(h) {
  host = h;

  // Main asks us to bring a worker lane to life for a dispatched spec.
  // Serialize spawns: terminalManager.createTerminal correlates its
  // TERMINAL_CREATED reply only by channel, so two concurrent creations both
  // latch onto the first reply and collapse into ONE terminal. Running them
  // one-at-a-time guarantees each worker gets its own lane.
  ipcRenderer.on(IPC.ORCH_SPAWN_WORKER, (event, payload) => {
    spawnChain = spawnChain
      .then(() => spawnWorkerLane(payload))
      .catch((err) => console.error('orchestrator: spawn failed', err));
  });

  // Live worker state → route to the right project's session, then update the
  // workers zone in place ONLY if that project is the one on screen (don't
  // disturb the mounted conductor terminal, and don't let a background
  // project's state bleed into the visible board).
  ipcRenderer.on(IPC.ORCH_STATE, (event, st) => {
    const projectPath = st && st.projectPath;
    if (!projectPath) return;
    if (st.active === false) {
      // Main tore this project's session down (Stop). Drop our view state.
      sessions.delete(projectPath);
    } else {
      const s = _sess(projectPath, true);
      s.latestState = st;
    }
    if (projectPath === state.getProjectPath() && liveContainer && document.body.contains(liveContainer)) {
      renderPipeline(liveContainer);
      renderWorkerZone(liveContainer);
    }
  });
}

// Open (or focus) the orchestrator section tab.
function open() {
  if (!host) return;
  if (!state.getProjectPath()) {
    _toast('Open a project first', 'error');
    return;
  }
  host.openSection('orchestrator', {}, api, { newTab: false });
}

// ─── session ──────────────────────────────────────────────

function orchEnv(projectPath) {
  return {
    FRAME_ORCH_BUS: path.join(projectPath, FRAME_DIR, ORCH_BUS_DIR),
    FRAME_ORCH_BIN: path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR)
  };
}

async function ensureSession() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return false;
  const s = _sess(projectPath, true);

  // Re-attach: this project already has a live session and its conductor
  // terminal survived the project switch — reuse it, don't spin up a second
  // conductor or restart main's session.
  if (s.started && s.conductorId && host.getManager().getTerminal(s.conductorId)) {
    return true;
  }

  let conductorId = null;
  try {
    conductorId = await host.createTerminalForCurrentProject({ projectPath, extraEnv: orchEnv(projectPath) });
  } catch (err) {
    console.error('orchestrator: conductor lane creation failed', err);
  }
  if (!conductorId) {
    _toast('Could not create the conductor Frame (terminal limit reached?)', 'error');
    return false;
  }
  host.getManager().setAssignment(conductorId, { kind: 'spec', label: 'conductor', ref: '__conductor__' });

  let res;
  try {
    res = await ipcRenderer.invoke(IPC.START_ORCHESTRATION, { projectPath, conductorTerminalId: conductorId });
  } catch (err) {
    console.error('orchestrator: START_ORCHESTRATION failed', err);
  }
  const docPath = (res && res.conductorDocPath) || path.join(projectPath, FRAME_DIR, 'orchestration', 'CONDUCTOR.md');

  s.started = true;
  s.conductorId = conductorId;
  // Start the conductor agent in the background (enter:false → stay on the tab).
  agentDispatch.dispatch({
    terminalId: conductorId,
    prompt: `You are the orchestration conductor. Read ${docPath} and follow it exactly. Wait for assigned specs.`,
    assignment: { kind: 'spec', label: 'conductor', ref: '__conductor__' },
    enter: false
  }).catch((err) => console.error('orchestrator: conductor dispatch failed', err));

  return true;
}

// ─── worker lane bridge ───────────────────────────────────

async function spawnWorkerLane({ projectPath, slug, worktreePath, env, promptInstruction } = {}) {
  if (!host || !slug) return;
  let terminalId = null;
  try {
    // File the lane under its own project (not "current") — a background
    // project may dispatch a worker while the user is viewing another one.
    terminalId = await host.createTerminalForCurrentProject({ projectPath, cwd: worktreePath, extraEnv: env });
  } catch (err) {
    console.error('orchestrator: worker lane creation failed', err);
  }
  if (!terminalId) {
    _toast(`Could not open a worker Frame for "${slug}"`, 'error');
    return;
  }
  ipcRenderer.send(IPC.ORCH_WORKER_LANE, { projectPath, slug, terminalId });

  // The lane is already created above (so it exists + joins the frame switcher).
  // enter:false → don't steal focus into it; the user stays on the orchestrator
  // board and switches into a worker only when they want (e.g. to approve).
  agentDispatch.dispatch({
    terminalId,
    prompt: promptInstruction,
    assignment: { kind: 'spec', label: `spec: ${slug}`, ref: slug },
    enter: false
  }).catch((err) => console.error('orchestrator: worker dispatch failed', err));
}

// ─── section viewport ─────────────────────────────────────

function createViewport() {
  const key = `orch-vp:${++seq}`;
  activeVpKey = key;
  let container = null;

  function navigate() {
    // Opened/focused — ensure the session, then refresh so the conductor mounts.
    ensureSession()
      .then((ok) => { if (ok && host) host.notifySectionChanged(); })
      .catch((err) => console.error('orchestrator: ensureSession failed', err));
  }

  function getChip() {
    return { type: 'orchestrator', title: 'Orchestrator' };
  }

  function render(el) {
    container = el;
    liveContainer = el;
    el.innerHTML = `
      <div class="orch-shell">
        <div class="orch-toolbar">
          <span class="orch-toolbar-title">Orchestrator</span>
          <button type="button" class="orch-stop">Stop &amp; clean up</button>
        </div>
        <div class="orch-pipeline" data-zone="pipeline"></div>
        <div class="orch-section">
          <section class="orch-conductor" data-zone="conductor"></section>
          <div class="orch-side">
            <section class="orch-workers" data-zone="workers"></section>
            <aside class="orch-specs" data-zone="specs"></aside>
          </div>
        </div>
      </div>
    `;
    el.querySelector('.orch-stop').addEventListener('click', stopSession);
    renderPipeline(el);
    renderConductorZone(el);
    renderWorkerZone(el);
    loadSpecs(el);
  }

  function dispose() {
    if (liveContainer === container) liveContainer = null;
    if (activeVpKey === key) activeVpKey = null;
    container = null;
  }

  return { type: 'orchestrator', key, viewClass: 'orchestrator-view', navigate, getChip, render, dispose };
}

// Stop the whole session: teardown (worktrees removed, merged branches pruned,
// un-merged work kept), reset local state, close the tab.
async function stopSession() {
  if (!window.confirm('Stop orchestration?\nWorker worktrees are removed and the conductor lane is closed. Un-merged work stays on its branch.')) return;
  const projectPath = state.getProjectPath();
  try { await ipcRenderer.invoke(IPC.STOP_ORCHESTRATION, { projectPath }); } catch (e) { console.error('orchestrator: stop failed', e); }
  sessions.delete(projectPath); // drop this project's view state (others untouched)
  if (host && activeVpKey) host.closeSection(activeVpKey);
  _toast('Orchestration stopped — worktrees cleaned up', 'info');
}

// ─── zones ────────────────────────────────────────────────

function renderConductorZone(root) {
  const zone = root.querySelector('[data-zone="conductor"]');
  if (!zone) return;
  const conductorId = _curSess() && _curSess().conductorId;
  zone.innerHTML = `
    <div class="orch-zone-head">
      <span class="orch-zone-title">Conductor</span>
      <button type="button" class="orch-zone-action orch-conductor-expand" title="Open full-screen" ${conductorId ? '' : 'disabled'}>Full screen ↗</button>
    </div>
    <div class="orch-conductor-host"></div>
  `;
  const hostEl = zone.querySelector('.orch-conductor-host');
  if (conductorId && host) {
    host.getManager().mountTerminal(conductorId, hostEl); // embed the live conductor terminal
    const expand = zone.querySelector('.orch-conductor-expand');
    if (expand) expand.addEventListener('click', () => host.enterLane(conductorId));
  } else {
    hostEl.innerHTML = '<div class="orch-empty">Starting conductor…</div>';
  }
}

// ─── pipeline rail ────────────────────────────────────────
//
// At-a-glance, color-coded view of where every worker is in the lifecycle:
// Queued → Running → Done → Approved, with Blocked/Failed shown off-track.
// Fed by the same live ORCH_STATE; click a chip to enter that worker's lane.

const PIPELINE_STAGES = [
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'approved', label: 'Approved' }
];

function stageOf(w) {
  switch (w.status) {
    case 'queued': return 'queued';
    case 'running':
    case 'idle': return 'running';
    case 'blocked': return 'blocked';
    case 'failed': return 'failed';
    case 'done': return w.merged ? 'approved' : 'done';
    default: return 'running';
  }
}

function renderPipeline(root) {
  const bar = root.querySelector('[data-zone="pipeline"]');
  if (!bar) return;
  const cur = _curSess();
  const workers = (cur && cur.latestState && cur.latestState.workers) || [];
  if (!workers.length) { bar.innerHTML = ''; return; } // hidden via :empty until there's activity
  const byStage = {};
  for (const w of workers) (byStage[stageOf(w)] = byStage[stageOf(w)] || []).push(w);

  const chip = (w) => {
    const st = stageOf(w);
    const idle = w.status === 'idle' ? ' is-idle' : '';
    return `<button class="orch-pipe-chip stage-${st}${idle}" data-tid="${w.terminalId || ''}" title="${_esc(w.slug)} · ${_esc(w.status)}"><span class="orch-pipe-chip-dot"></span><span class="orch-pipe-chip-label">${_esc(w.slug)}</span></button>`;
  };

  let html = '<span class="orch-pipe-title">Pipeline</span><div class="orch-pipe-flow">';
  PIPELINE_STAGES.forEach((s, i) => {
    const list = byStage[s.key] || [];
    html += `<div class="orch-pipe-station">
      <div class="orch-pipe-head"><span>${s.label}</span><span class="orch-pipe-count">${list.length}</span></div>
      <div class="orch-pipe-chips">${list.map(chip).join('') || '<span class="orch-pipe-empty">—</span>'}</div>
    </div>`;
    if (i < PIPELINE_STAGES.length - 1) html += '<span class="orch-pipe-arrow">→</span>';
  });
  html += '</div>';

  const off = [...(byStage.blocked || []), ...(byStage.failed || [])];
  if (off.length) {
    html += `<div class="orch-pipe-offtrack">${off.map(chip).join('')}</div>`;
  }
  bar.innerHTML = html;

  bar.querySelectorAll('.orch-pipe-chip').forEach((el) => {
    const tid = el.dataset.tid;
    if (tid) el.addEventListener('click', () => host.enterLane(tid));
  });
}

const WORKER_STATUS_LABEL = {
  queued: 'Queued', blocked: 'Blocked', running: 'Running',
  idle: 'Idle', done: 'Done', failed: 'Failed'
};

function renderWorkerZone(root) {
  const zone = root.querySelector('[data-zone="workers"]');
  if (!zone) return;
  const cur = _curSess();
  const workers = (cur && cur.latestState && cur.latestState.workers) || [];
  zone.innerHTML = `<div class="orch-zone-head"><span class="orch-zone-title">Workers</span><span class="orch-zone-count">${workers.length}</span></div>`;
  if (!workers.length) {
    zone.insertAdjacentHTML('beforeend', '<div class="orch-empty">No workers running. Assign a spec to begin.</div>');
    return;
  }
  const list = document.createElement('div');
  list.className = 'orch-worker-list';
  for (const w of workers) {
    const files = w.diffStat && w.diffStat.files != null ? w.diffStat.files : null;
    const fp = Array.isArray(w.footprint) ? w.footprint : [];
    const card = document.createElement('div');
    card.className = `orch-worker-card status-${w.status || 'idle'}`;
    card.innerHTML = `
      <div class="orch-worker-top">
        <span class="orch-worker-dot"></span>
        <span class="orch-worker-slug"></span>
        <span class="orch-worker-status-chip">${WORKER_STATUS_LABEL[w.status] || w.status || '—'}${w.blockedBy ? ' · ' + _esc(w.blockedBy) : ''}</span>
        <span class="orch-worker-time">${_relTime(w.lastActivityAt)}</span>
      </div>
      <div class="orch-worker-tree">
        <span class="orch-worker-branch" title="${_esc(w.branch || '')}">${_esc(w.branch || '')}</span>
        ${w.worktreePath ? `<span class="orch-worker-path" title="${_esc(w.worktreePath)}">${_esc(_shortPath(w.worktreePath))}</span>` : ''}
        ${files != null ? `<span class="orch-worker-diff">±${files} file${files === 1 ? '' : 's'}</span>` : ''}
        ${w.merged ? '<span class="orch-worker-merged">merged</span>' : ''}
      </div>
      ${fp.length ? `<div class="orch-worker-fp" title="${_esc(fp.join('\n'))}">footprint: ${_esc(fp.slice(0, 3).join(', '))}${fp.length > 3 ? ` +${fp.length - 3}` : ''}</div>` : ''}
      <div class="orch-worker-actions">
        <button class="orch-wbtn act-open" ${w.terminalId ? '' : 'disabled'} title="Open this worker's terminal">Open</button>
        <button class="orch-wbtn act-merge" ${['running', 'idle', 'done'].includes(w.status) ? '' : 'disabled'} title="Approve this worker's changes — collects its branch into the spec's integration branch (main stays manual)">Approve</button>
        <button class="orch-wbtn act-remove" title="Remove the worktree (un-merged work stays on its branch)">Remove</button>
      </div>
    `;
    card.querySelector('.orch-worker-slug').textContent = w.slug;
    const openBtn = card.querySelector('.act-open');
    if (w.terminalId) openBtn.addEventListener('click', () => host.enterLane(w.terminalId));
    card.querySelector('.act-merge').addEventListener('click', () => mergeWorkerAction(w.slug));
    card.querySelector('.act-remove').addEventListener('click', () => removeWorkerAction(w.slug));
    list.appendChild(card);
  }
  zone.appendChild(list);
}

async function mergeWorkerAction(slug) {
  const projectPath = state.getProjectPath();
  let res;
  try { res = await ipcRenderer.invoke(IPC.ORCH_MERGE_WORKER, { projectPath, slug }); }
  catch (e) { res = { status: 'failed', error: e.message }; }
  if (!res) return;
  if (res.status === 'merged') {
    _toast(`Approved "${slug}" → ${res.branch || 'integration'}`, 'info');
  } else if (res.status === 'drift') {
    const ok = window.confirm(`"${slug}" changed files outside its declared footprint:\n\n${(res.drift || []).join('\n')}\n\nApprove anyway?`);
    if (ok) {
      const f = await ipcRenderer.invoke(IPC.ORCH_MERGE_WORKER, { projectPath, slug, force: true }).catch((e) => ({ status: 'failed', error: e.message }));
      _toast(f && f.status === 'merged' ? `Approved "${slug}" (forced)` : `Approve failed: ${(f && f.error) || 'unknown'}`, f && f.status === 'merged' ? 'info' : 'error');
    }
  } else {
    _toast(`Approve failed: ${res.error || 'unknown'}`, 'error');
  }
}

async function removeWorkerAction(slug) {
  if (!window.confirm(`Remove worker "${slug}"?\nIts worktree is deleted; un-merged work stays on its branch.`)) return;
  let res;
  try { res = await ipcRenderer.invoke(IPC.ORCH_REMOVE_WORKER, { projectPath: state.getProjectPath(), slug }); }
  catch (e) { res = { error: e.message }; }
  if (res && res.success) _toast(`Removed "${slug}"${res.branchKept ? ' (branch kept — un-merged)' : ''}`, 'info');
  else _toast(`Remove failed: ${(res && res.error) || 'unknown'}`, 'error');
}

function _shortPath(p) {
  const parts = String(p || '').split('/');
  const i = parts.lastIndexOf('.frame');
  return i >= 0 ? parts.slice(i).join('/') : (parts.slice(-2).join('/') || p);
}

function _relTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

async function loadSpecs(root) {
  let specs = [];
  try {
    specs = await ipcRenderer.invoke(IPC.LIST_SPECS, state.getProjectPath());
  } catch (err) {
    console.error('orchestrator: LIST_SPECS failed', err);
  }
  renderSpecRail(root, Array.isArray(specs) ? specs : []);
}

const ASSIGNABLE_PHASES = ['tasks_generated', 'implementing', 'done'];
const specPhase = (s) => (s && (s.phase || (s.status && s.status.phase))) || 'draft';
const specSlug = (s) => s && (s.slug || (s.status && s.status.slug));
const specTitle = (s) => (s && (s.title || (s.status && s.status.title))) || specSlug(s);

function renderSpecRail(root, specs) {
  const zone = root.querySelector('[data-zone="specs"]');
  if (!zone) return;
  zone.innerHTML = '<div class="orch-zone-head"><span class="orch-zone-title">Specs</span></div>';
  if (!specs.length) {
    zone.insertAdjacentHTML('beforeend', '<div class="orch-empty">No specs yet.</div>');
    return;
  }
  const cur = _curSess();
  const assignedSet = (cur && cur.assigned) || new Set();
  for (const spec of specs) {
    const slug = specSlug(spec);
    if (!slug) continue;
    const phase = specPhase(spec);
    const assignable = ASSIGNABLE_PHASES.includes(phase);
    const isAssigned = assignedSet.has(slug);
    const row = document.createElement('div');
    row.className = 'orch-spec-row' + (assignable ? '' : ' disabled');
    row.innerHTML = `
      <div class="orch-spec-main">
        <div class="orch-spec-title"></div>
        <div class="orch-spec-phase">${_esc(phase)}</div>
      </div>
      <button type="button" class="orch-spec-assign" ${assignable && !isAssigned ? '' : 'disabled'}>${isAssigned ? 'Assigned' : 'Assign'}</button>
    `;
    row.querySelector('.orch-spec-title').textContent = specTitle(spec);
    const btn = row.querySelector('.orch-spec-assign');
    if (assignable && !isAssigned) btn.addEventListener('click', () => assignSpec(slug));
    zone.appendChild(row);
  }
}

let nudgeTimer = null;

function assignSpec(slug) {
  const projectPath = state.getProjectPath();
  const s = _sess(projectPath, true);
  s.assigned.add(slug);
  ipcRenderer.invoke(IPC.ORCH_ASSIGN_SPECS, { projectPath, slugs: Array.from(s.assigned) })
    .catch((err) => console.error('orchestrator: assign failed', err));
  // Coalesce rapid Assign clicks into ONE batch nudge to the conductor — per-spec
  // nudges pushed it into single-spec mode and could interleave in the terminal,
  // dropping the last one. One set-reconcile message keeps it in wave mode.
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => nudgeConductor(projectPath), 600);
  if (liveContainer && document.body.contains(liveContainer)) loadSpecs(liveContainer);
}

function nudgeConductor(projectPath) {
  const s = _sess(projectPath);
  if (!s || !s.conductorId) return;
  const set = Array.from(s.assigned);
  if (!set.length) return;
  agentDispatch.dispatch({
    terminalId: s.conductorId,
    prompt: `Assigned specs are now: ${set.join(', ')}. Per CONDUCTOR.md, treat this set as the source of truth: validate each is ready, build the conflict graph, and dispatch ALL ready, non-conflicting specs now (in waves). Do not wait for per-spec confirmation; re-check the full set, not just the newest one.`,
    enter: false
  }).catch((err) => console.error('orchestrator: assign-nudge failed', err));
}

// ─── helpers ──────────────────────────────────────────────

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _toast(message, type = 'info') {
  const existing = document.querySelector('.tasks-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `tasks-toast tasks-toast-${type}`;
  toast.innerHTML = `<span class="toast-message">${_esc(message)}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Active only when the CURRENT project has a live session — the Home card shows
// "Open Orchestrator" for a project with a running session and "Start
// Orchestrator" for one without, independent of other projects' sessions.
const api = {
  setHost,
  open,
  createViewport,
  isActive: () => {
    const s = _curSess();
    return !!(s && s.started);
  }
};
module.exports = api;
