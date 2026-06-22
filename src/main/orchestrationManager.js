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
 * Sessions are PER-PROJECT: each project keeps its own conductor + workers +
 * bus watcher, so switching projects never tears down or hides another
 * project's orchestration. `sessions` is keyed by projectPath; core helpers
 * take an explicit `session` so a background project's bus events resolve to
 * the right state. claude-code conductor.
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

// Active sessions, keyed by projectPath (one per project). Session shape:
// { projectPath, conductorTerminalId, conductorDocPath, busDir,
//   assignedSlugs:Set<string>, workers: Map<slug, worker>, cap, watcher,
//   debounce, statusPoll, relayQueue, relayDraining }
// worker = { slug, branch, worktreePath, terminalId, status, diffStat,
//            declaredFootprint, lastActivityAt }
const sessions = new Map();

function init(window) {
  mainWindow = window;
}

function sessionFor(projectPath) {
  return (projectPath && sessions.get(projectPath)) || null;
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
function envForLane(session, slug) {
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
function findFootprintConflict(session, slug, footprint) {
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

function relayToConductor(session, text) {
  if (!session || !session.conductorTerminalId) return;
  session.relayQueue.push(text);
  drainRelayQueue(session);
}

async function drainRelayQueue(session) {
  if (!session || session.relayDraining) return;
  session.relayDraining = true;
  try {
    while (session.conductorTerminalId && session.relayQueue.length) {
      const id = session.conductorTerminalId;
      const text = session.relayQueue.shift();
      try { ptyManager.writeToTerminal(id, text); } catch (e) {}
      await relaySleep(350);                                  // let the paste settle
      try { ptyManager.writeToTerminal(id, '\r'); } catch (e) {} // submit
      await relaySleep(400);                                  // gap before next message
    }
  } finally {
    session.relayDraining = false;
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

function serializeState(session) {
  if (!session) return { active: false, workers: [] };
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

function publishState(session) {
  if (!session) return;
  const state = serializeState(session);
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

function startBusWatcher(session) {
  fs.mkdirSync(session.busDir, { recursive: true });
  drainBus(session); // pick up anything queued before the watcher attached
  try {
    session.watcher = fs.watch(session.busDir, () => {
      clearTimeout(session.debounce);
      session.debounce = setTimeout(() => drainBus(session), WATCH_DEBOUNCE_MS);
    });
  } catch (e) {
    console.error('[orch] failed to watch bus dir:', e.message);
  }
}

function drainBus(session) {
  if (!session || !sessions.has(session.projectPath)) return;
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
    handleRequest(session, req);
  }
}

function handleRequest(session, req) {
  if (!req || !req.type) return;
  switch (req.type) {
    case 'dispatch':
      handleDispatch(session, req.slug).catch((e) => console.error('[orch] dispatch error:', e));
      return;
    case 'report-done':
      handleReportDone(session, req.slug).catch((e) => console.error('[orch] report-done error:', e));
      return;
    case 'merge':
      handleMerge(session, req.slug, req.args).catch((e) => console.error('[orch] merge error:', e));
      return;
    default:
      console.warn('[orch] unknown bus request type:', req.type);
  }
}

// ─── request handlers ─────────────────────────────────────

// T10 (worktree + worker spawn) + T13 (conflict guard). Cap check is T24.
async function handleDispatch(session, slug) {
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
    relayToConductor(session, `QUEUED: "${slug}" — worker cap (${session.cap}) reached. Re-dispatch after a slot frees.`);
    publishState(session);
    return;
  }

  // T13 — code-enforced conflict guard (independent of the conductor's reasoning)
  const conflict = findFootprintConflict(session, slug, footprint);
  if (conflict) {
    session.workers.set(slug, {
      slug, branch: orchWorkBranch(slug), worktreePath: null, terminalId: null,
      status: 'blocked', declaredFootprint: footprint, blockedBy: conflict,
      lastActivityAt: Date.now()
    });
    relayToConductor(session, `BLOCKED: "${slug}" conflicts with in-flight "${conflict}" (overlapping footprint). Dispatch it after "${conflict}" merges.`);
    publishState(session);
    return;
  }

  // Create the isolated worktree (fresh base from current HEAD)
  const wt = await gitBranches.createOrchWorktree(session.projectPath, slug);
  if (wt.error) {
    relayToConductor(session, `DISPATCH FAILED: "${slug}" — worktree error: ${wt.error}`);
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
  // projectPath travels with the request so the renderer files the lane under
  // the right project even if the user is currently viewing another one.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ORCH_SPAWN_WORKER, {
      projectPath: session.projectPath,
      slug,
      worktreePath: wt.path,
      env: envForLane(session, slug),
      promptInstruction: instruction
    });
  }
  publishState(session);
}

// The renderer reports the terminalId it created for a worker lane, so the
// manager can track status, relay, and tear it down.
function registerWorkerLane(projectPath, slug, terminalId) {
  const session = sessionFor(projectPath);
  if (!session || !slug || !terminalId) return { error: 'invalid' };
  const w = session.workers.get(slug);
  if (!w) return { error: 'no such worker' };
  w.terminalId = terminalId;
  w.lastActivityAt = Date.now();
  publishState(session);
  return { success: true };
}

// T15 — a worker reported completion: mark done, attach a diff stat, relay to
// the conductor with the merge command.
async function handleReportDone(session, slug) {
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
  relayToConductor(session, `WORKER DONE: "${slug}" — branch ${w.branch} (${n} file${n === 1 ? '' : 's'} changed). Review it (git log/diff) and tell the USER it's ready for their approval (board → Approve). Do NOT merge it yourself — approval is the user's call, unless they explicitly ask you to merge.`);
  publishState(session);
}

// T22 (drift check + fast-forward merge into integration) + T23 (meta reconcile
// reminder; the conductor performs the actual reconcile per CONDUCTOR.md).
async function handleMerge(session, slug, args = []) {
  if (!session || !slug) return { status: 'failed', error: 'no session' };
  const w = session.workers.get(slug);
  if (!w) {
    relayToConductor(session, `MERGE FAILED: no worker found for "${slug}".`);
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
    relayToConductor(session,
      `DRIFT: "${slug}" changed files outside its declared footprint:\n  - ${drift.join('\n  - ')}\n` +
      `Review, then merge anyway with: node "$FRAME_ORCH_BIN/merge.js" ${slug} --force`
    );
    return { status: 'drift', drift };
  }

  const res = await gitBranches.mergeWorkToIntegration(session.projectPath, slug);
  if (res.error) {
    relayToConductor(session, `MERGE FAILED: "${slug}" — ${res.error}`);
    return { status: 'failed', error: res.error };
  }
  w.status = 'done';
  w.merged = true;
  w.lastActivityAt = Date.now();
  relayToConductor(session,
    `MERGED: "${slug}" → ${res.branch}. Reconcile meta now (npm run structure; mark ${slug} tasks done in tasks.json; append PROJECT_NOTES if useful), then advance to the next spec.`
  );
  publishState(session);
  return { status: 'merged', branch: res.branch };
}

// Per-worker merge trigger from the board UI (mirrors a conductor merge.js call).
async function mergeWorker(projectPath, slug, force = false) {
  const session = sessionFor(projectPath);
  if (!session) return { status: 'failed', error: 'no session' };
  return handleMerge(session, slug, force ? ['--force'] : []);
}

// Per-worker cleanup from the board UI: stop its lane, remove the worktree, and
// prune the work branch ONLY if merged (un-merged work is kept — no data loss).
async function removeWorker(projectPath, slug) {
  const session = sessionFor(projectPath);
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
  publishState(session);
  return { success: true, branchKept: !merged };
}

// ─── status polling (T16) ─────────────────────────────────
//
// Derives worker status from concrete signals: terminal liveness (exit ⇒
// failed), output recency (quiet ⇒ idle, active ⇒ running), and a soft-done
// nudge when a worker goes idle with commits but never reported. The renderer
// additionally overlays its richer laneStatus (processing/waiting) per lane.

function pollStatuses(session) {
  if (!session || !sessions.has(session.projectPath)) return;
  let changed = false;
  for (const w of session.workers.values()) {
    if (!w.terminalId) continue;                       // blocked/queued/detached — no lane
    if (w.status === 'done' || w.status === 'failed') continue;

    const info = ptyManager.getTerminalInfo(w.terminalId);
    if (!info) {
      w.status = 'failed';
      w.lastActivityAt = Date.now();
      relayToConductor(session, `WORKER FAILED: "${w.slug}" — its lane exited unexpectedly.`);
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
          if (!sessions.has(session.projectPath)) return;
          const ww = session.workers.get(w.slug);
          if (ww && !ww.softDoneNudged && files.length && ['idle', 'running'].includes(ww.status)) {
            ww.softDoneNudged = true;
            relayToConductor(session, `SOFT-DONE? "${w.slug}" is idle with ${files.length} file(s) committed but sent no done report — verify it (finished, or waiting on input?).`);
            publishState(session);
          }
        })
        .catch(() => {});
    }
  }
  if (changed) publishState(session);
}

// ─── session lifecycle ────────────────────────────────────

async function startOrchestration(args = {}) {
  const { projectPath, conductorTerminalId, cap } = args;
  if (!projectPath) return { error: 'projectPath required' };

  // Idempotent: returning to a project that already has a live session must
  // re-attach, not restart. The renderer reuses its existing conductor lane —
  // but if it had to spin up a fresh one (the old terminal was closed), adopt
  // the new id so relays reach a live terminal.
  const existing = sessions.get(projectPath);
  if (existing) {
    if (conductorTerminalId && conductorTerminalId !== existing.conductorTerminalId) {
      existing.conductorTerminalId = conductorTerminalId;
    }
    return {
      success: true,
      reattached: true,
      busDir: existing.busDir,
      conductorDocPath: existing.conductorDocPath
    };
  }

  const session = {
    projectPath,
    conductorTerminalId: conductorTerminalId || null,
    conductorDocPath: null,
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
  sessions.set(projectPath, session);

  try {
    materializeBinScripts(projectPath);
  } catch (e) {
    console.error('[orch] failed to materialize bin scripts:', e.message);
  }
  // Materialize the conductor protocol doc so the conductor lane can read it.
  try {
    let tpl = '';
    try { tpl = fs.readFileSync(CONDUCTOR_TEMPLATE_PATH, 'utf8'); } catch (e) {}
    const dir = path.join(projectPath, FRAME_DIR, 'orchestration');
    fs.mkdirSync(dir, { recursive: true });
    session.conductorDocPath = path.join(dir, 'CONDUCTOR.md');
    fs.writeFileSync(session.conductorDocPath, tpl || '# Conductor\nCoordinate specs; use $FRAME_ORCH_BIN/{dispatch,merge,status}.js.');
  } catch (e) {
    console.error('[orch] failed to materialize CONDUCTOR.md:', e.message);
  }

  startBusWatcher(session);
  session.statusPoll = setInterval(() => pollStatuses(session), STATUS_POLL_MS);
  // Recover any worktrees/branches left by a prior (e.g. app-closed) session so
  // they reappear on the board instead of being orphaned.
  try { await rehydrate(session); } catch (e) {}
  publishState(session);
  return { success: true, busDir: session.busDir, conductorDocPath: session.conductorDocPath };
}

// T25 — teardown: stop worker lanes, remove their worktrees, prune only MERGED
// work branches (un-merged work is kept on its branch), leave main untouched.
async function stopOrchestration(projectPath) {
  const session = sessionFor(projectPath);
  if (!session) return { success: true };
  const proj = session.projectPath;
  const workers = Array.from(session.workers.values());

  // Remove from the registry first so any in-flight bus/poll callbacks bail.
  sessions.delete(proj);

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

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ORCH_STATE, { active: false, projectPath: proj, workers: [] });
  }
  return { success: true };
}

// T26 — best-effort rehydration from frame/<slug>/* branches after a restart.
// Rebuilds worker entries (no live terminals; agents are ephemeral) so the
// board/status reflect prior work. Statuses come from git: merged ⇒ done.
async function rehydrate(session) {
  if (!session) return { error: 'no session' };
  const projectPath = session.projectPath;
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
  publishState(session);
  return { success: true, recovered };
}

function assignSpecs(projectPath, slugs) {
  const session = sessionFor(projectPath);
  if (!session) return { error: 'no active orchestration' };
  session.assignedSlugs = new Set(Array.isArray(slugs) ? slugs : []);
  publishState(session);
  return { success: true, assigned: Array.from(session.assignedSlugs) };
}

function getState(projectPath) {
  return serializeState(sessionFor(projectPath));
}

// ─── IPC ──────────────────────────────────────────────────

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.START_ORCHESTRATION, (e, args) => startOrchestration(args || {}));
  ipcMain.handle(IPC.STOP_ORCHESTRATION, (e, args) => stopOrchestration((args || {}).projectPath));
  ipcMain.handle(IPC.GET_ORCH_STATE, (e, args) => getState((args || {}).projectPath));
  ipcMain.handle(IPC.ORCH_ASSIGN_SPECS, (e, args) => assignSpecs((args || {}).projectPath, (args || {}).slugs));
  ipcMain.on(IPC.ORCH_WORKER_LANE, (e, args) => registerWorkerLane((args || {}).projectPath, (args || {}).slug, (args || {}).terminalId));
  ipcMain.handle(IPC.ORCH_MERGE_WORKER, (e, args) => mergeWorker((args || {}).projectPath, (args || {}).slug, (args || {}).force));
  ipcMain.handle(IPC.ORCH_REMOVE_WORKER, (e, args) => removeWorker((args || {}).projectPath, (args || {}).slug));
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
    sessionFor,
    getSession: (projectPath) => sessionFor(projectPath)
  }
};
