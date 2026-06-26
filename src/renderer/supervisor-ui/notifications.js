// Supervisor notifications detector (renderer) — Phase E.
//
// Watches state pushes from main + light /api polling and decides when to ask
// for an OS notification (delivered via SUPERVISOR_NOTIFY → notifier.js).
//
// Fires on:
//   - new entry in the Needs-You column (escalation)
//   - any task transitioning into status='failed'
//   - heartbeat goes stale (stale_s > 60 and we weren't already stale)
//   - heartbeat recovers (alive again after being stale)
//
// Dedupe: a 60s window keyed by (taskId, transition) — re-renders or repeated
// state pushes for the same task don't re-notify.
//
// Lifecycle: started from supervisor-ui/index.js#init() so it runs over Frame's
// full session, not just while the section is open. We piggyback on the same
// SUPERVISOR_STATE pushes the kanban listens to, but we ALSO do our own
// SUPERVISOR_STATE_INIT (idempotent) + initial /api/* fetches so the detector
// works the first time you launch Frame, before the user has ever opened the
// section.
//
// First /api/workspace snapshot only captures baseline state — we do NOT fire
// escalation/failed notifications for tasks that are already in those states
// on cold start (otherwise opening Frame to a workspace with two old failures
// would alert twice immediately).

const path = require('path');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');
const toast = require('./notificationToast');

const DEDUPE_MS = 60_000;
const STALE_THRESHOLD_S = 60;
const STALE_CHECK_MS = 10_000;
const REFETCH_DEBOUNCE_MS = 500;
const INIT_RETRY_MS = 30_000;
const HEARTBEAT_FALLBACK_MS = 15_000;

let started = false;
let stateListener = null;
let clickListener = null;
let onClickHandler = null;
let staleCheckTimer = null;
let initRetryTimer = null;
let refetchDebounceTimer = null;
let heartbeatPollTimer = null;
let supervisorRoot = null;

// knownTaskStates === null is the "no baseline yet" sentinel — see notes above.
let knownTaskStates = null;
let isStale = false;
let lastHeartbeat = null;
const dedupe = new Map();

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function shouldNotify(key) {
  const now = Date.now();
  const expiresAt = dedupe.get(key);
  if (expiresAt && expiresAt > now) return false;
  dedupe.set(key, now + DEDUPE_MS);
  // Best-effort GC on the dedupe map so it doesn't grow unbounded across a
  // long session.
  if (dedupe.size > 200) {
    for (const [k, exp] of dedupe) if (exp <= now) dedupe.delete(k);
  }
  return true;
}

function notify(payload) {
  ipcRenderer.send(SUP.SUPERVISOR_NOTIFY, payload);
}

function applyHeartbeat(hb) {
  if (!hb) return;
  lastHeartbeat = hb;
  checkStale();
}

function checkStale() {
  if (!lastHeartbeat) return;
  // Heartbeat.json has `ts` in unix seconds. /api/heartbeat also exposes
  // server-computed `stale_s` — we prefer that when present so we agree with
  // the PWA, and fall back to local-clock math otherwise.
  let stale_s;
  if (typeof lastHeartbeat.stale_s === 'number') {
    stale_s = lastHeartbeat.stale_s;
  } else {
    const ts = Number(lastHeartbeat.ts);
    if (!ts) return;
    stale_s = (Date.now() / 1000) - ts;
  }
  if (stale_s > STALE_THRESHOLD_S && !isStale) {
    isStale = true;
    if (shouldNotify('daemon:stale')) {
      notify({
        title: 'Supervisor daemon stale',
        body: `No heartbeat for ${Math.round(stale_s)}s`,
        kind: 'daemon-stale',
      });
    }
  } else if (stale_s <= STALE_THRESHOLD_S && isStale) {
    isStale = false;
    if (shouldNotify('daemon:recovered')) {
      notify({
        title: 'Supervisor daemon recovered',
        body: 'Heartbeat resumed',
        kind: 'daemon-recovered',
      });
    }
  }
}

async function pollWorkspace() {
  let ws;
  try { ws = await fetchJson('/api/workspace'); } catch { return; }
  const cols = ws.columns || {};
  const awaiting = cols.awaiting || [];
  const pending = cols.pending || [];
  const active = cols.active || [];
  const done = cols.done || [];
  const all = [...pending, ...active, ...awaiting, ...done];

  const awaitingIds = new Set(awaiting.map((t) => t.id).filter(Boolean));
  const activeIds = new Set(active.map((t) => t.id).filter(Boolean));
  const next = new Map();
  for (const t of all) {
    if (!t.id) continue;
    next.set(t.id, {
      status: t.status || '',
      awaiting: awaitingIds.has(t.id),
      inFlight: activeIds.has(t.id),
      title: t.title || t.id,
      error: t.error || t.error_message || t.last_error || '',
    });
  }

  if (knownTaskStates === null) {
    // Cold-start baseline — don't fire for pre-existing escalations/failures
    // or for tasks that were already in-flight / already done at launch.
    knownTaskStates = next;
    return;
  }

  for (const [id, n] of next) {
    const p = knownTaskStates.get(id);
    if (n.awaiting && (!p || !p.awaiting)) {
      if (shouldNotify(`${id}:escalation`)) {
        notify({
          title: 'Escalation needs you',
          body: n.title,
          kind: 'escalation',
          taskId: id,
        });
      }
    }
    if (n.status === 'failed' && (!p || p.status !== 'failed')) {
      if (shouldNotify(`${id}:failed`)) {
        notify({
          title: 'Task failed',
          body: n.error ? `${n.title}: ${n.error}` : n.title,
          kind: 'failed',
          taskId: id,
        });
      }
    }
    // Phase R: in-renderer toasts on lifecycle transitions. Quieter than OS
    // pings — `started` is the moment the daemon picked the task up,
    // `done` is the moment it left the active column for done.
    if (n.inFlight && (!p || !p.inFlight) && n.status !== 'done' && n.status !== 'failed') {
      if (shouldNotify(`${id}:started`)) {
        toast.show({
          title: n.title,
          kind: 'started',
          taskId: id,
        });
      }
    }
    if (n.status === 'done' && (!p || p.status !== 'done')) {
      if (shouldNotify(`${id}:done`)) {
        toast.show({
          title: n.title,
          kind: 'done',
          taskId: id,
        });
      }
    }
  }

  knownTaskStates = next;
}

function schedulePoll() {
  if (refetchDebounceTimer) return;
  refetchDebounceTimer = setTimeout(() => {
    refetchDebounceTimer = null;
    pollWorkspace();
  }, REFETCH_DEBOUNCE_MS);
}

async function announceSupervisorRoot() {
  if (supervisorRoot) return true;
  try {
    const meta = await fetchJson('/api/meta');
    if (meta && meta.audit_path) {
      // audit_path = <ROOT>/run-state/audit.jsonl → ROOT = grandparent
      supervisorRoot = path.dirname(path.dirname(meta.audit_path));
      // Tell main to start the state watcher. Idempotent — kanban does this
      // too when the section opens; calling twice with the same root is a no-op.
      try { await ipcRenderer.invoke(SUP.SUPERVISOR_STATE_INIT, { supervisorRoot }); }
      catch (err) { console.warn('[supervisor-notify] STATE_INIT failed:', err.message); }
      return true;
    }
  } catch {
    // Supervisor likely not running yet — silent, retry on initRetryTimer tick.
  }
  return false;
}

async function tryInit() {
  const ok = await announceSupervisorRoot();
  if (!ok) return;
  if (initRetryTimer) { clearInterval(initRetryTimer); initRetryTimer = null; }
  pollWorkspace();
  try { applyHeartbeat(await fetchJson('/api/heartbeat')); } catch { /* quiet */ }
  // Heartbeat fallback poll: stateWatcher's fs.watch on heartbeat.json only
  // fires when the daemon writes it, so a dead daemon → no events → we'd
  // never notice stale_s ticking up. The 10s checkStale timer handles the
  // math, but we still need a fresh value occasionally to keep `lastHeartbeat`
  // honest when /api/heartbeat is the only available source.
  if (!heartbeatPollTimer) {
    heartbeatPollTimer = setInterval(async () => {
      try { applyHeartbeat(await fetchJson('/api/heartbeat')); } catch { /* quiet */ }
    }, HEARTBEAT_FALLBACK_MS);
  }
}

function start(opts) {
  if (started) return;
  started = true;
  onClickHandler = (opts && opts.onNotifyClick) || null;
  // Route toast clicks through the same handler the OS notifications use so
  // clicking a "task done" toast opens the modal / scrolls the kanban.
  toast.setClickHandler(onClickHandler);

  stateListener = (_evt, payload) => {
    if (!payload) return;
    if (payload.kind === 'heartbeat' && payload.data) {
      applyHeartbeat(payload.data);
    } else if (payload.kind === 'audit' || payload.kind === 'queue') {
      schedulePoll();
    }
  };
  ipcRenderer.on(SUP.SUPERVISOR_STATE, stateListener);

  clickListener = (_evt, payload) => {
    if (onClickHandler && payload) {
      try { onClickHandler(payload); } catch (err) {
        console.warn('[supervisor-notify] click handler threw:', err);
      }
    }
  };
  ipcRenderer.on(SUP.SUPERVISOR_NOTIFY_CLICK, clickListener);

  staleCheckTimer = setInterval(checkStale, STALE_CHECK_MS);
  initRetryTimer = setInterval(tryInit, INIT_RETRY_MS);
  tryInit();
}

function stop() {
  if (!started) return;
  started = false;
  if (stateListener) ipcRenderer.removeListener(SUP.SUPERVISOR_STATE, stateListener);
  if (clickListener) ipcRenderer.removeListener(SUP.SUPERVISOR_NOTIFY_CLICK, clickListener);
  stateListener = null;
  clickListener = null;
  onClickHandler = null;
  if (staleCheckTimer) clearInterval(staleCheckTimer);
  if (initRetryTimer) clearInterval(initRetryTimer);
  if (heartbeatPollTimer) clearInterval(heartbeatPollTimer);
  if (refetchDebounceTimer) clearTimeout(refetchDebounceTimer);
  staleCheckTimer = null;
  initRetryTimer = null;
  heartbeatPollTimer = null;
  refetchDebounceTimer = null;
  knownTaskStates = null;
  lastHeartbeat = null;
  isStale = false;
  supervisorRoot = null;
  dedupe.clear();
}

module.exports = { start, stop };
