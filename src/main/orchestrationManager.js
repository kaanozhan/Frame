/**
 * Orchestration Manager
 *
 * Coordinates conductor-led, parallel spec execution. A conductor (a Claude
 * lane, loaded with CONDUCTOR.md) is given several ready specs; Frame runs each
 * in its own git worktree via a worker lane. This module is the nervous system:
 *
 *   - watches the command bus ($FRAME_ORCH_BUS) the conductor/workers write to
 *   - creates/cleans worktrees (delegating to gitBranchesManager)         [T10/T25]
 *   - tells the renderer to spawn worker lanes (ORCH_SPAWN_WORKER)         [T10]
 *   - relays worker reports into the conductor lane                        [T15]
 *   - enforces the footprint conflict guard — safety in code, not prompt   [T13]
 *   - merges worker branches into per-spec integration branches            [T22]
 *
 * Runtime state is ephemeral; git branches + .frame/specs are the source of
 * truth, so a session can be rebuilt from them (rehydration, T26).
 *
 * V1: a single active orchestration session at a time, claude-code conductor.
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const {
  FRAME_DIR,
  FRAME_BIN_DIR,
  ORCH_BUS_DIR,
  ORCH_BUS_ENV,
  ORCH_WORKTREES_DIR,
  ORCH_META_FILES,
  orchWorkBranch,
  orchIntegrationBranch
} = require('../shared/frameConstants');
const { getOrchBinScripts } = require('../shared/frameTemplates');
const ptyManager = require('./ptyManager');
const gitBranches = require('./gitBranchesManager');
const specManager = require('./specManager');

const WORKER_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'orchestration', 'WORKER.md');
const CONDUCTOR_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'orchestration', 'CONDUCTOR.md');

const WATCH_DEBOUNCE_MS = 150;
const DEFAULT_MAX_WORKERS = 5;
const STATUS_POLL_MS = 5000;   // how often to re-derive worker statuses
const IDLE_MS = 20000;         // no output for this long ⇒ idle
const SOFT_DONE_MS = 45000;    // idle this long + commits, no report ⇒ soft-done nudge

let mainWindow = null;

// Single active session (V1). Shape:
// { projectPath, conductorTerminalId, busDir, assignedSlugs:Set<string>,
//   workers: Map<slug, worker>, cap, watcher, debounce }
// worker = { slug, branch, worktreePath, terminalId, status, diffStat,
//            declaredFootprint, lastActivityAt }
let session = null;

function init(window) {
  mainWindow = window;
}

// ─── path helpers ─────────────────────────────────────────

function busDirFor(projectPath) {
  return path.join(projectPath, FRAME_DIR, ORCH_BUS_DIR);
}
function binDirFor(projectPath) {
  return path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR);
}
function worktreeDirFor(projectPath, slug) {
  return path.join(projectPath, FRAME_DIR, ORCH_WORKTREES_DIR, slug);
}

// Inject the bus path (+ optional slug) so a lane can reach Frame from any
// worktree, regardless of its own .frame/ copy.
function envForLane(slug) {
  const env = {
    [ORCH_BUS_ENV]: session.busDir,
    FRAME_ORCH_BIN: binDirFor(session.projectPath) // absolute path to .frame/bin (worktrees lack their own)
  };
  if (slug) env.FRAME_ORCH_SLUG = slug;
  return env;
}

// ─── footprint conflict (T13) ─────────────────────────────
//
// Two specs conflict if their declared footprints overlap. Plain paths match by
// equality; a glob/dir entry (`src/foo/**`, `src/foo/*`) matches by prefix.

function toPrefix(entry) {
  if (entry.includes('*')) return entry.slice(0, entry.indexOf('*')).replace(/\/?$/, '/');
  return entry;
}

function entriesOverlap(a, b) {
  if (a === b) return true;
  const pa = toPrefix(a);
  const pb = toPrefix(b);
  const aDir = pa.endsWith('/');
  const bDir = pb.endsWith('/');
  if (aDir && (b === pa.slice(0, -1) || b.startsWith(pa))) return true;
  if (bDir && (a === pb.slice(0, -1) || a.startsWith(pb))) return true;
  if (aDir && bDir) return pa.startsWith(pb) || pb.startsWith(pa);
  return false;
}

function footprintsOverlap(fa, fb) {
  for (const a of fa || []) {
    for (const b of fb || []) {
      if (entriesOverlap(a, b)) return true;
    }
  }
  return false;
}

// An in-flight spec whose footprint overlaps `footprint`, or null. done/failed
// workers don't block (their work is already integrated or abandoned).
function findFootprintConflict(slug, footprint) {
  for (const w of session.workers.values()) {
    if (w.slug === slug) continue;
    if (!['running', 'idle'].includes(w.status)) continue; // only in-flight workers block
    if (footprintsOverlap(footprint, w.declaredFootprint || [])) return w.slug;
  }
  return null;
}

// Write the interpolated worker prompt to the MAIN repo (worktrees lack .frame/
// runtime), return an instruction the agent reads. Absolute path so it resolves
// from inside the worktree.
function buildWorkerPrompt(projectPath, slug) {
  let tpl = '';
  try { tpl = fs.readFileSync(WORKER_TEMPLATE_PATH, 'utf8'); } catch (e) {}
  const body = (tpl || `You are a worker for spec ${slug}. Implement .frame/specs/${slug}/tasks.md in order, commit only to frame/${slug}/work, then run: node "$FRAME_ORCH_BIN/report-done.js".`).replace(/\{slug\}/g, slug);
  const dir = path.join(projectPath, FRAME_DIR, 'runtime', 'prompts');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${slug}__worker.md`);
  fs.writeFileSync(abs, body);
  return { promptPath: abs, instruction: `Read ${abs} and follow it exactly.` };
}

// Inject messages into the conductor's terminal AND submit them. Two rules:
//   1. text and Enter must be SEPARATE writes — a newline in the same chunk
//      reads as pasted input (shown but not acted on), so we write the message,
//      let the paste settle, then send a discrete Enter (same split
//      agentDispatch uses via terminalSendPromptThenEnter).
//   2. messages are QUEUED — if two workers report near-simultaneously, sending
//      both text+Enter pairs concurrently would interleave at the PTY and
//      garble the submit. The queue serializes them: each message fully lands
//      and submits before the next starts.
const relaySleep = (ms) => new Promise((r) => setTimeout(r, ms));

function relayToConductor(text) {
  if (!session || !session.conductorTerminalId) return;
  session.relayQueue.push(text);
  drainRelayQueue();
}

async function drainRelayQueue() {
  if (!session || session.relayDraining) return;
  session.relayDraining = true;
  try {
    while (session && session.conductorTerminalId && session.relayQueue.length) {
      const id = session.conductorTerminalId;
      const text = session.relayQueue.shift();
      try { ptyManager.writeToTerminal(id, text); } catch (e) {}
      await relaySleep(350);                                  // let the paste settle
      try { ptyManager.writeToTerminal(id, '\r'); } catch (e) {} // submit
      await relaySleep(400);                                  // gap before next message
    }
  } finally {
    if (session) session.relayDraining = false;
  }
}

// Materialize the .frame/bin command scripts for this project.
function materializeBinScripts(projectPath) {
  const binDir = binDirFor(projectPath);
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, body] of Object.entries(getOrchBinScripts())) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, body);
    try { fs.chmodSync(p, 0o755); } catch (e) {}
  }
}

// ─── state publish ────────────────────────────────────────

function serializeState() {
  if (!session) return {};
  return {
    active: true,
    projectPath: session.projectPath,
    conductorTerminalId: session.conductorTerminalId,
    assignedSlugs: Array.from(session.assignedSlugs),
    cap: session.cap,
    workers: Array.from(session.workers.values()).map((w) => ({
      slug: w.slug,
      branch: w.branch,
      worktreePath: w.worktreePath || null,
      terminalId: w.terminalId,
      status: w.status,
      diffStat: w.diffStat || null,
      footprint: w.declaredFootprint || [],
      blockedBy: w.blockedBy || null,
      merged: !!w.merged,
      lastActivityAt: w.lastActivityAt || null
    }))
  };
}

function publishState() {
  if (!session) return;
  const state = serializeState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ORCH_STATE, state);
  }
  // Mirror to the bus so the conductor's status.js can read it.
  try {
    fs.mkdirSync(session.busDir, { recursive: true });
    const dest = path.join(session.busDir, 'state.json');
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, dest);
  } catch (e) {}
}

// ─── bus watcher ──────────────────────────────────────────

function startBusWatcher() {
  fs.mkdirSync(session.busDir, { recursive: true });
  drainBus(); // pick up anything queued before the watcher attached
  try {
    session.watcher = fs.watch(session.busDir, () => {
      clearTimeout(session.debounce);
      session.debounce = setTimeout(drainBus, WATCH_DEBOUNCE_MS);
    });
  } catch (e) {
    console.error('[orch] failed to watch bus dir:', e.message);
  }
}

function drainBus() {
  if (!session) return;
  let files;
  try {
    files = fs.readdirSync(session.busDir);
  } catch (e) {
    return;
  }
  const requests = files.filter(
    (f) => f.endsWith('.json') && f !== 'state.json' && !f.endsWith('.tmp')
  );
  for (const f of requests) {
    const full = path.join(session.busDir, f);
    let req;
    try {
      req = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      continue; // partial/corrupt — atomic writers shouldn't cause this; skip
    }
    try { fs.unlinkSync(full); } catch (e) {}
    handleRequest(req);
  }
}

function handleRequest(req) {
  if (!req || !req.type) return;
  switch (req.type) {
    case 'dispatch':
      handleDispatch(req.slug).catch((e) => console.error('[orch] dispatch error:', e));
      return;
    case 'report-done':
      handleReportDone(req.slug).catch((e) => console.error('[orch] report-done error:', e));
      return;
    case 'merge':
      handleMerge(req.slug, req.args).catch((e) => console.error('[orch] merge error:', e));
      return;
    default:
      console.warn('[orch] unknown bus request type:', req.type);
  }
}

// ─── request handlers ─────────────────────────────────────

// T10 (worktree + worker spawn) + T13 (conflict guard). Cap check is T24.
async function handleDispatch(slug) {
  if (!session || !slug) return;

  const existing = session.workers.get(slug);
  if (existing && ['running', 'idle'].includes(existing.status)) {
    return; // already in flight — ignore duplicate dispatch (blocked/queued may re-dispatch)
  }

  const footprint = specManager.getSpecFootprint(session.projectPath, slug);

  // T24 — bounded parallelism cap (blocked/queued don't occupy a slot)
  const activeCount = Array.from(session.workers.values())
    .filter((w) => ['running', 'idle'].includes(w.status)).length;
  if (activeCount >= session.cap) {
    session.workers.set(slug, {
      slug, branch: orchWorkBranch(slug), worktreePath: null, terminalId: null,
      status: 'queued', declaredFootprint: footprint, lastActivityAt: Date.now()
    });
    relayToConductor(`QUEUED: "${slug}" — worker cap (${session.cap}) reached. Re-dispatch after a slot frees.`);
    publishState();
    return;
  }

  // T13 — code-enforced conflict guard (independent of the conductor's reasoning)
  const conflict = findFootprintConflict(slug, footprint);
  if (conflict) {
    session.workers.set(slug, {
      slug, branch: orchWorkBranch(slug), worktreePath: null, terminalId: null,
      status: 'blocked', declaredFootprint: footprint, blockedBy: conflict,
      lastActivityAt: Date.now()
    });
    relayToConductor(`BLOCKED: "${slug}" conflicts with in-flight "${conflict}" (overlapping footprint). Dispatch it after "${conflict}" merges.`);
    publishState();
    return;
  }

  // Create the isolated worktree (fresh base from current HEAD)
  const wt = await gitBranches.createOrchWorktree(session.projectPath, slug);
  if (wt.error) {
    relayToConductor(`DISPATCH FAILED: "${slug}" — worktree error: ${wt.error}`);
    return;
  }

  const { instruction } = buildWorkerPrompt(session.projectPath, slug);

  // Record the worker now (terminalId arrives once the renderer creates the
  // lane and reports it back via ORCH_WORKER_LANE).
  session.workers.set(slug, {
    slug, branch: wt.branch, worktreePath: wt.path, baseSha: wt.baseSha,
    terminalId: null, status: 'running', declaredFootprint: footprint, lastActivityAt: Date.now()
  });

  // Hand off to the renderer: it owns xterm, so it creates the lane (in the
  // worktree, with our orch env), then runs agentDispatch (start agent, wait
  // agent-ready, inject the worker prompt). See orchestrator.js (T12).
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ORCH_SPAWN_WORKER, {
      slug,
      worktreePath: wt.path,
      env: envForLane(slug),
      promptInstruction: instruction
    });
  }
  publishState();
}

// The renderer reports the terminalId it created for a worker lane, so the
// manager can track status, relay, and tear it down.
function registerWorkerLane(slug, terminalId) {
  if (!session || !slug || !terminalId) return { error: 'invalid' };
  const w = session.workers.get(slug);
  if (!w) return { error: 'no such worker' };
  w.terminalId = terminalId;
  w.lastActivityAt = Date.now();
  publishState();
  return { success: true };
}

// T15 — a worker reported completion: mark done, attach a diff stat, relay to
// the conductor with the merge command.
async function handleReportDone(slug) {
  if (!session || !slug) return;
  const w = session.workers.get(slug);
  if (!w) return;
  w.status = 'done';
  w.lastActivityAt = Date.now();
  let n = 0;
  try {
    n = (await gitBranches.worktreeChangedFiles(session.projectPath, slug, w.baseSha || 'HEAD')).length;
  } catch (e) {}
  w.diffStat = { files: n };
  relayToConductor(`WORKER DONE: "${slug}" — branch ${w.branch} (${n} file${n === 1 ? '' : 's'} changed). Review it (git log/diff) and tell the USER it's ready for their approval (board → Approve). Do NOT merge it yourself — approval is the user's call, unless they explicitly ask you to merge.`);
  publishState();
}

// T22 (drift check + fast-forward merge into integration) + T23 (meta reconcile
// reminder; the conductor performs the actual reconcile per CONDUCTOR.md).
async function handleMerge(slug, args = []) {
  if (!session || !slug) return;
  const w = session.workers.get(slug);
  if (!w) {
    relayToConductor(`MERGE FAILED: no worker found for "${slug}".`);
    return { status: 'failed', error: 'no worker' };
  }
  const force = Array.isArray(args) && args.includes('--force');

  // Drift: actual changed files not covered by the declared footprint (meta excluded).
  const actual = await gitBranches.worktreeChangedFiles(session.projectPath, slug, w.baseSha || 'HEAD');
  const declared = w.declaredFootprint || [];
  const drift = actual.filter(
    (f) => !ORCH_META_FILES.includes(f.split('/').pop()) && !declared.some((d) => entriesOverlap(d, f))
  );
  if (drift.length && !force) {
    relayToConductor(
      `DRIFT: "${slug}" changed files outside its declared footprint:\n  - ${drift.join('\n  - ')}\n` +
      `Review, then merge anyway with: node "$FRAME_ORCH_BIN/merge.js" ${slug} --force`
    );
    return { status: 'drift', drift };
  }

  const res = await gitBranches.mergeWorkToIntegration(session.projectPath, slug);
  if (res.error) {
    relayToConductor(`MERGE FAILED: "${slug}" — ${res.error}`);
    return { status: 'failed', error: res.error };
  }
  w.status = 'done';
  w.merged = true;
  w.lastActivityAt = Date.now();
  relayToConductor(
    `MERGED: "${slug}" → ${res.branch}. Reconcile meta now (npm run structure; mark ${slug} tasks done in tasks.json; append PROJECT_NOTES if useful), then advance to the next spec.`
  );
  publishState();
  return { status: 'merged', branch: res.branch };
}

// Per-worker merge trigger from the board UI (mirrors a conductor merge.js call).
async function mergeWorker(slug, force = false) {
  return handleMerge(slug, force ? ['--force'] : []);
}

// Per-worker cleanup from the board UI: stop its lane, remove the worktree, and
// prune the work branch ONLY if merged (un-merged work is kept — no data loss).
async function removeWorker(slug) {
  if (!session || !slug) return { error: 'no session' };
  const w = session.workers.get(slug);
  if (!w) return { error: 'no such worker' };
  if (w.terminalId) {
    try { ptyManager.destroyTerminal(w.terminalId); } catch (e) {}
  }
  let merged = false;
  try { merged = await gitBranches.isWorkMerged(session.projectPath, slug); } catch (e) {}
  if (w.worktreePath || w.branch) {
    try { await gitBranches.removeOrchWorktree(session.projectPath, slug, { deleteBranch: merged }); } catch (e) {}
  }
  session.workers.delete(slug);
  publishState();
  return { success: true, branchKept: !merged };
}

// ─── status polling (T16) ─────────────────────────────────
//
// Derives worker status from concrete signals: terminal liveness (exit ⇒
// failed), output recency (quiet ⇒ idle, active ⇒ running), and a soft-done
// nudge when a worker goes idle with commits but never reported. The renderer
// additionally overlays its richer laneStatus (processing/waiting) per lane.

function pollStatuses() {
  if (!session) return;
  let changed = false;
  for (const w of session.workers.values()) {
    if (!w.terminalId) continue;                       // blocked/queued/detached — no lane
    if (w.status === 'done' || w.status === 'failed') continue;

    const info = ptyManager.getTerminalInfo(w.terminalId);
    if (!info) {
      w.status = 'failed';
      w.lastActivityAt = Date.now();
      relayToConductor(`WORKER FAILED: "${w.slug}" — its lane exited unexpectedly.`);
      changed = true;
      continue;
    }

    const last = ptyManager.getLastOutputAt(w.terminalId) || w.lastActivityAt || Date.now();
    const idleFor = Date.now() - last;
    const next = idleFor >= IDLE_MS ? 'idle' : 'running';
    if (next !== w.status) { w.status = next; changed = true; }

    if (next === 'idle' && idleFor >= SOFT_DONE_MS && !w.softDoneNudged) {
      gitBranches.worktreeChangedFiles(session.projectPath, w.slug, w.baseSha || 'HEAD')
        .then((files) => {
          if (!session) return;
          const ww = session.workers.get(w.slug);
          if (ww && !ww.softDoneNudged && files.length && ['idle', 'running'].includes(ww.status)) {
            ww.softDoneNudged = true;
            relayToConductor(`SOFT-DONE? "${w.slug}" is idle with ${files.length} file(s) committed but sent no done report — verify it (finished, or waiting on input?).`);
            publishState();
          }
        })
        .catch(() => {});
    }
  }
  if (changed) publishState();
}

// ─── session lifecycle ────────────────────────────────────

async function startOrchestration(args = {}) {
  const { projectPath, conductorTerminalId, cap } = args;
  if (!projectPath) return { error: 'projectPath required' };
  if (session) await stopOrchestration(); // one session at a time

  session = {
    projectPath,
    conductorTerminalId: conductorTerminalId || null,
    busDir: busDirFor(projectPath),
    assignedSlugs: new Set(),
    workers: new Map(),
    cap: cap || DEFAULT_MAX_WORKERS,
    watcher: null,
    debounce: null,
    statusPoll: null,
    relayQueue: [],
    relayDraining: false
  };

  try {
    materializeBinScripts(projectPath);
  } catch (e) {
    console.error('[orch] failed to materialize bin scripts:', e.message);
  }
  // Materialize the conductor protocol doc so the conductor lane can read it.
  let conductorDocPath = null;
  try {
    let tpl = '';
    try { tpl = fs.readFileSync(CONDUCTOR_TEMPLATE_PATH, 'utf8'); } catch (e) {}
    const dir = path.join(projectPath, FRAME_DIR, 'orchestration');
    fs.mkdirSync(dir, { recursive: true });
    conductorDocPath = path.join(dir, 'CONDUCTOR.md');
    fs.writeFileSync(conductorDocPath, tpl || '# Conductor\nCoordinate specs; use $FRAME_ORCH_BIN/{dispatch,merge,status}.js.');
  } catch (e) {
    console.error('[orch] failed to materialize CONDUCTOR.md:', e.message);
  }
  session.conductorDocPath = conductorDocPath;

  startBusWatcher();
  session.statusPoll = setInterval(pollStatuses, STATUS_POLL_MS);
  // Recover any worktrees/branches left by a prior (e.g. app-closed) session so
  // they reappear on the board instead of being orphaned.
  try { await rehydrate(projectPath); } catch (e) {}
  publishState();
  return { success: true, busDir: session.busDir, conductorDocPath };
}

// T25 — teardown: stop worker lanes, remove their worktrees, prune only MERGED
// work branches (un-merged work is kept on its branch), leave main untouched.
async function stopOrchestration() {
  if (!session) return { success: true };
  const proj = session.projectPath;
  const workers = Array.from(session.workers.values());

  try { if (session.watcher) session.watcher.close(); } catch (e) {}
  clearTimeout(session.debounce);
  clearInterval(session.statusPoll);

  // Stop the conductor lane too (clean teardown).
  if (session.conductorTerminalId) {
    try { ptyManager.destroyTerminal(session.conductorTerminalId); } catch (e) {}
  }

  for (const w of workers) {
    if (w.terminalId) {
      try { ptyManager.destroyTerminal(w.terminalId); } catch (e) {}
    }
    if (w.worktreePath || w.branch) {
      let merged = false;
      try { merged = await gitBranches.isWorkMerged(proj, w.slug); } catch (e) {}
      try { await gitBranches.removeOrchWorktree(proj, w.slug, { deleteBranch: merged }); } catch (e) {}
    }
  }

  session = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ORCH_STATE, { active: false, workers: [] });
  }
  return { success: true };
}

// T26 — best-effort rehydration from frame/<slug>/* branches after a restart.
// Rebuilds worker entries (no live terminals; agents are ephemeral) so the
// board/status reflect prior work. Statuses come from git: merged ⇒ done.
async function rehydrate(projectPath) {
  if (!session || session.projectPath !== projectPath) {
    return { error: 'no matching active session' };
  }
  const branches = await gitBranches.listOrchBranches(projectPath);
  let recovered = 0;
  for (const [slug, kinds] of Object.entries(branches)) {
    if (session.workers.has(slug)) continue;
    // Only resurrect workers whose worktree still exists on disk. A branch with
    // no worktree means the worker was explicitly Removed / torn down (we keep
    // un-merged branches for safety) — that's archived work, not an active
    // worker, so it must NOT reappear on the board.
    if (!fs.existsSync(worktreeDirFor(projectPath, slug))) continue;
    let merged = false;
    if (kinds.integration && !kinds.work) {
      merged = true; // work branch pruned after a successful merge ⇒ done
    } else if (kinds.integration && kinds.work) {
      try { merged = await gitBranches.isWorkMerged(projectPath, slug); } catch (e) {}
    }
    session.workers.set(slug, {
      slug,
      branch: orchWorkBranch(slug),
      worktreePath: worktreeDirFor(projectPath, slug),
      terminalId: null,
      status: merged ? 'done' : 'idle',
      merged,
      detached: true, // recovered without a live lane
      declaredFootprint: specManager.getSpecFootprint(projectPath, slug),
      lastActivityAt: Date.now()
    });
    recovered++;
  }
  publishState();
  return { success: true, recovered };
}

function assignSpecs(slugs) {
  if (!session) return { error: 'no active orchestration' };
  session.assignedSlugs = new Set(Array.isArray(slugs) ? slugs : []);
  publishState();
  return { success: true, assigned: Array.from(session.assignedSlugs) };
}

function getState() {
  return serializeState();
}

// ─── IPC ──────────────────────────────────────────────────

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.START_ORCHESTRATION, (e, args) => startOrchestration(args || {}));
  ipcMain.handle(IPC.STOP_ORCHESTRATION, () => stopOrchestration());
  ipcMain.handle(IPC.GET_ORCH_STATE, () => getState());
  ipcMain.handle(IPC.ORCH_ASSIGN_SPECS, (e, args) => assignSpecs((args || {}).slugs));
  ipcMain.on(IPC.ORCH_WORKER_LANE, (e, args) => registerWorkerLane((args || {}).slug, (args || {}).terminalId));
  ipcMain.handle(IPC.ORCH_MERGE_WORKER, (e, args) => mergeWorker((args || {}).slug, (args || {}).force));
  ipcMain.handle(IPC.ORCH_REMOVE_WORKER, (e, args) => removeWorker((args || {}).slug));
}

module.exports = {
  init,
  setupIPC,
  startOrchestration,
  stopOrchestration,
  assignSpecs,
  registerWorkerLane,
  mergeWorker,
  removeWorker,
  getState,
  rehydrate,
  // exposed for later tasks / tests
  _internal: {
    worktreeDirFor,
    envForLane,
    publishState,
    drainBus,
    getSession: () => session
  }
};
