// Supervisor header — Phase C (reactive).
//
// Subscribes to SUPERVISOR_STATE pushes from main (fs.watch on heartbeat.json +
// audit.jsonl tail). The /api/heartbeat + /api/workspace fetches survive in
// two narrow roles:
//   1) initial paint on mount, so the header isn't blank for the first second
//   2) fallback polling that kicks in 5s after mount if no SUPERVISOR_STATE
//      push has arrived (means main never got STATE_INIT, the supervisor
//      isn't running, or the daemon's tick is genuinely slower than 5s).
//
// /api/meta still doesn't expose `profile` or `projects` — daemon state from
// heartbeat.state is what we render.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

const SUPERVISOR_API = 'http://127.0.0.1:8766';
const FALLBACK_AFTER_MS = 5000;
const FALLBACK_HEARTBEAT_MS = 5000;
const FALLBACK_WORKSPACE_MS = 4000;

async function fetchJson(path) {
  const res = await fetch(`${SUPERVISOR_API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function create(root) {
  let alive = true;
  let stateListener = null;
  let receivedPushAt = 0;
  let fallbackHbTimer = null;
  let fallbackWsTimer = null;
  let fallbackArmTimer = null;

  root.innerHTML = `
    <div class="sup-live">
      <div class="sup-dot" id="sup-dot"></div>
      <div class="sup-brand">SUPERVISOR</div>
    </div>
    <div class="sup-meta">
      <span>daemon: <span class="v" id="sup-daemon">…</span></span>
      <span>in-flight: <span class="v" id="sup-inflight">0</span></span>
      <span>cost today: <span class="v" id="sup-cost">$0.00</span></span>
    </div>
    <div class="sup-actions">
      <button class="sup-btn primary" id="sup-btn-submit" title="Submit a new task (Phase D)">▶ Submit task</button>
      <button class="sup-btn" id="sup-btn-stop" title="Stop daemon (Phase D)">⏸ Stop daemon</button>
      <button class="sup-btn" id="sup-btn-refresh" title="Force re-poll now">↻ Refresh</button>
    </div>
  `;

  const dotEl = root.querySelector('#sup-dot');
  const daemonEl = root.querySelector('#sup-daemon');
  const inflightEl = root.querySelector('#sup-inflight');
  const costEl = root.querySelector('#sup-cost');

  function applyHeartbeat(hb) {
    if (!alive || !hb) return;
    const isAlive = !!hb.alive || hb.state === 'running';
    dotEl.classList.toggle('alive', isAlive);
    dotEl.classList.toggle('dead', !isAlive);
    daemonEl.textContent = hb.state || (isAlive ? 'running' : 'offline');
    inflightEl.textContent = String((hb.in_flight || []).length);
  }

  function applyWorkspaceTotals(ws) {
    if (!alive || !ws) return;
    const cost = (ws.totals && ws.totals.cost_today_usd) || 0;
    costEl.textContent = `$${Number(cost).toFixed(2)}`;
  }

  async function fetchHeartbeatOnce() {
    try {
      applyHeartbeat(await fetchJson('/api/heartbeat'));
    } catch (err) {
      if (!alive) return;
      dotEl.classList.remove('alive');
      dotEl.classList.add('dead');
      daemonEl.textContent = 'unreachable';
    }
  }

  async function fetchWorkspaceOnce() {
    try {
      applyWorkspaceTotals(await fetchJson('/api/workspace'));
    } catch (err) {
      // Quiet — keep the last good value
    }
  }

  function refresh() {
    fetchHeartbeatOnce();
    fetchWorkspaceOnce();
  }

  function startFallback() {
    if (fallbackHbTimer || fallbackWsTimer) return;
    fallbackHbTimer = setInterval(fetchHeartbeatOnce, FALLBACK_HEARTBEAT_MS);
    fallbackWsTimer = setInterval(fetchWorkspaceOnce, FALLBACK_WORKSPACE_MS);
  }

  function stopFallback() {
    if (fallbackHbTimer) clearInterval(fallbackHbTimer);
    if (fallbackWsTimer) clearInterval(fallbackWsTimer);
    fallbackHbTimer = null;
    fallbackWsTimer = null;
  }

  // Subscribe to main's reactive state pushes. Heartbeat data arrives
  // sub-second of the daemon writing run-state/heartbeat.json.
  stateListener = (_evt, payload) => {
    if (!payload || !alive) return;
    receivedPushAt = Date.now();
    stopFallback();
    if (payload.kind === 'heartbeat') applyHeartbeat(payload.data);
  };
  ipcRenderer.on(SUP.SUPERVISOR_STATE, stateListener);

  // Buttons
  root.querySelector('#sup-btn-submit').addEventListener('click', () => {
    alert('Submit task lands in Phase D.');
  });
  root.querySelector('#sup-btn-stop').addEventListener('click', () => {
    alert('Stop daemon lands in Phase D.');
  });
  root.querySelector('#sup-btn-refresh').addEventListener('click', refresh);

  // Initial paint — even if main is wired, the watcher only emits on the
  // *next* heartbeat write, so without this the header is blank for ~1s.
  refresh();

  // Arm the fallback: if no SUPERVISOR_STATE push lands within 5s of mount,
  // assume main never got STATE_INIT (or the supervisor is genuinely silent)
  // and resume the old polling cadence.
  fallbackArmTimer = setTimeout(() => {
    if (!alive) return;
    if (!receivedPushAt) startFallback();
  }, FALLBACK_AFTER_MS);

  function stop() {
    alive = false;
    if (stateListener) ipcRenderer.removeListener(SUP.SUPERVISOR_STATE, stateListener);
    stateListener = null;
    stopFallback();
    if (fallbackArmTimer) clearTimeout(fallbackArmTimer);
    fallbackArmTimer = null;
  }

  return { stop, refresh };
}

module.exports = { create, SUPERVISOR_API };
