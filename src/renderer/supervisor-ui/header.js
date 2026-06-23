// Supervisor header — Phase B.
//
// Polls /api/heartbeat (5s) and /api/workspace (4s) from the supervisor monitor
// running at SUPERVISOR_API. Renders the heartbeat dot, in-flight count, today's
// cost, and three action buttons. Submit/Stop are non-functional placeholders
// in Phase B — they alert "Phase D" so we know wiring is correct without
// hijacking behavior. Refresh forces a re-poll.
//
// /api/meta does NOT expose `profile` or `projects` in the actual server (the
// Phase B brief inferred this from the spec, but the code is authoritative —
// see supervisor/scripts/monitor/server.py:1151). We render the daemon state
// (running/idle/etc) from heartbeat.state instead of a missing profile field.

const SUPERVISOR_API = 'http://127.0.0.1:8766';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fetchJson(path) {
  const res = await fetch(`${SUPERVISOR_API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function create(root) {
  let hbTimer = null;
  let wsTimer = null;
  let alive = true;

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

  async function pollHeartbeat() {
    if (!alive) return;
    try {
      const hb = await fetchJson('/api/heartbeat');
      if (!alive) return;
      const isAlive = !!hb.alive;
      dotEl.classList.toggle('alive', isAlive);
      dotEl.classList.toggle('dead', !isAlive);
      daemonEl.textContent = hb.state || (isAlive ? 'running' : 'offline');
      inflightEl.textContent = String((hb.in_flight || []).length);
    } catch (err) {
      if (!alive) return;
      dotEl.classList.remove('alive');
      dotEl.classList.add('dead');
      daemonEl.textContent = 'unreachable';
    }
  }

  async function pollWorkspace() {
    if (!alive) return;
    try {
      const ws = await fetchJson('/api/workspace');
      if (!alive) return;
      const cost = (ws.totals && ws.totals.cost_today_usd) || 0;
      costEl.textContent = `$${Number(cost).toFixed(2)}`;
    } catch (err) {
      // Quiet — header keeps the last good value
    }
  }

  function refresh() {
    pollHeartbeat();
    pollWorkspace();
  }

  // Buttons
  root.querySelector('#sup-btn-submit').addEventListener('click', () => {
    alert('Submit task lands in Phase D.');
  });
  root.querySelector('#sup-btn-stop').addEventListener('click', () => {
    alert('Stop daemon lands in Phase D.');
  });
  root.querySelector('#sup-btn-refresh').addEventListener('click', refresh);

  function start() {
    if (hbTimer || wsTimer) return;
    refresh();
    hbTimer = setInterval(pollHeartbeat, 5000);
    wsTimer = setInterval(pollWorkspace, 4000);
  }

  function stop() {
    alive = false;
    if (hbTimer) clearInterval(hbTimer);
    if (wsTimer) clearInterval(wsTimer);
    hbTimer = null;
    wsTimer = null;
  }

  start();
  return { start, stop, refresh };
}

module.exports = { create, SUPERVISOR_API };
