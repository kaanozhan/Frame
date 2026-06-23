// Supervisor home card — Phase G.
//
// Prominent CTA card mounted at the top of Frame's lane board (the project
// home screen). Surfaces the Supervisor as the foundational UI: a one-click
// route to the dashboard plus a live heartbeat dot + in-flight count so the
// user can tell the daemon's state without leaving the home screen.
//
// Subscribes to SUPERVISOR_STATE (Phase C). No new IPC channels — the
// heartbeat watcher already pushes everything we render here.
//
// Re-mountable: the lane board recreates its container on every render(), so
// mount() is called repeatedly with fresh host elements. Each call appends a
// new card; module-level state holds the latest snapshot and the set of
// connected cards so a single SUPERVISOR_STATE push updates all of them.
// Disconnected cards (from previous renders) are garbage-collected lazily on
// the next update.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

let subscribed = false;
let lastSnapshot = { alive: null, inflight: null };
const liveCards = new Set();

function injectStylesOnce() {
  if (document.querySelector('[data-supervisor-home-card-styles]')) return;
  const style = document.createElement('style');
  style.dataset.supervisorHomeCardStyles = '1';
  style.textContent = `
    .sup-home-card {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      padding: 16px 18px;
      margin-bottom: 16px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }
    .sup-home-card:hover {
      border-color: var(--accent-primary);
    }
    .sup-home-card-icon {
      flex: 0 0 auto;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      line-height: 1;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      color: var(--accent-primary);
    }
    .sup-home-card-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sup-home-card-title-row {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      flex-wrap: wrap;
    }
    .sup-home-card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .sup-home-card-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 99px;
      font-variant-numeric: tabular-nums;
    }
    .sup-home-card-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted);
      box-shadow: 0 0 0 2px transparent;
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
    }
    .sup-home-card-dot.alive {
      background: var(--success);
      box-shadow: 0 0 0 2px var(--success-subtle);
    }
    .sup-home-card-dot.dead {
      background: var(--error);
      box-shadow: 0 0 0 2px var(--error-subtle);
    }
    .sup-home-card-subtitle {
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .sup-home-card-actions {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .sup-home-card-cta {
      padding: 8px 14px;
      background: var(--accent-primary);
      color: var(--bg-deep);
      border: 1px solid var(--accent-primary);
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity var(--transition-fast);
    }
    .sup-home-card-cta:hover {
      opacity: 0.9;
    }
    .sup-home-card-shortcut {
      font-size: 11px;
      color: var(--text-tertiary);
      letter-spacing: 0.02em;
    }
  `;
  document.head.appendChild(style);
}

function subscribeOnce() {
  if (subscribed) return;
  subscribed = true;
  ipcRenderer.on(SUP.SUPERVISOR_STATE, (_evt, payload) => {
    if (!payload) return;
    if (payload.kind !== 'heartbeat' || !payload.data) return;
    const hb = payload.data;
    lastSnapshot.alive = !!hb.alive || hb.state === 'running';
    lastSnapshot.inflight = Array.isArray(hb.in_flight) ? hb.in_flight.length : null;
    refreshAll();
  });
}

function refreshAll() {
  for (const card of Array.from(liveCards)) {
    if (!card.isConnected) { liveCards.delete(card); continue; }
    paint(card);
  }
}

function paint(card) {
  const dot = card.querySelector('.sup-home-card-dot');
  const inflightEl = card.querySelector('.sup-home-card-inflight');
  if (dot) {
    dot.classList.toggle('alive', lastSnapshot.alive === true);
    dot.classList.toggle('dead', lastSnapshot.alive === false);
  }
  if (inflightEl) {
    if (lastSnapshot.inflight == null) {
      inflightEl.textContent = '—';
    } else {
      inflightEl.textContent = String(lastSnapshot.inflight);
    }
  }
}

function mount(host) {
  if (!host) return;
  injectStylesOnce();
  subscribeOnce();

  const card = document.createElement('div');
  card.className = 'sup-home-card';
  card.innerHTML = `
    <div class="sup-home-card-icon" aria-hidden="true">⚡</div>
    <div class="sup-home-card-body">
      <div class="sup-home-card-title-row">
        <span class="sup-home-card-title">Open Supervisor</span>
        <span class="sup-home-card-meta" title="Daemon status · in-flight tasks">
          <span class="sup-home-card-dot"></span>
          <span class="sup-home-card-inflight">—</span>
          <span>in-flight</span>
        </span>
      </div>
      <div class="sup-home-card-subtitle">Dashboard for queue, escalations, project memory</div>
    </div>
    <div class="sup-home-card-actions">
      <button type="button" class="sup-home-card-cta">Open dashboard →</button>
      <span class="sup-home-card-shortcut">or press ⌘⇧U</span>
    </div>
  `;
  card.querySelector('.sup-home-card-cta').addEventListener('click', () => {
    try { require('./index').open(); } catch (err) {
      console.warn('[supervisor] home card open failed:', err);
    }
  });
  // Card is the first child of the lane board so it sits above the grid /
  // empty state — discoverable without competing with frames for space.
  host.insertBefore(card, host.firstChild);
  liveCards.add(card);
  paint(card);
}

module.exports = { mount };
