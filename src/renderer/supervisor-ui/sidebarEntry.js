// Supervisor projects-sidebar entry — Phase G.
//
// Mounts a "⚡ Supervisor" row at the very top of Frame's projects rail so the
// foundational dashboard is reachable without remembering the ⌘⇧U shortcut.
// Functionally a sibling of sidebarChip (Phase F) but lives in a different
// surface — the projects sidebar view, above the workspace project list —
// so users see it as a top-level destination, not a status badge.
//
// Subscribes to SUPERVISOR_STATE for the heartbeat dot (mirrors the dot
// semantics in supervisor-ui/header.js and sidebarChip.js: muted/alive/dead).
// We don't introduce new IPC channels — the Phase C watcher already pushes
// what we need.
//
// Idempotent: mount() may be called more than once; subsequent calls become
// no-ops. We never tear down — the entry lives for the whole Frame session.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

let mounted = false;
let entryEl = null;
let dotEl = null;
let lastHeartbeatAt = 0;
let staleTimer = null;

const STALE_AFTER_MS = 15000;

function injectStylesOnce() {
  if (document.querySelector('[data-supervisor-sidebar-entry-styles]')) return;
  const style = document.createElement('style');
  style.dataset.supervisorSidebarEntryStyles = '1';
  style.textContent = `
    .sup-sidebar-entry {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      width: 100%;
      padding: 8px var(--space-sm);
      /* Bottom separator differentiates the action row from the project list
         below; bg-deep gives it the same "rail header" feeling as Frame's
         own section dividers. */
      margin: 0 0 var(--space-sm);
      background: var(--bg-elevated);
      border: 1px solid var(--accent-primary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      cursor: pointer;
      font: inherit;
      text-align: left;
      transition: background var(--transition-fast),
                  border-color var(--transition-fast),
                  color var(--transition-fast);
    }
    .sup-sidebar-entry:hover {
      background: var(--accent-primary);
      color: var(--bg-deep);
    }
    .sup-sidebar-entry:hover .sup-sidebar-entry-arrow {
      transform: translateX(2px);
    }
    .sup-sidebar-entry-icon {
      flex: 0 0 auto;
      font-size: 14px;
      line-height: 1;
      color: var(--accent-primary);
    }
    .sup-sidebar-entry:hover .sup-sidebar-entry-icon {
      color: var(--bg-deep);
    }
    .sup-sidebar-entry-label {
      flex: 1;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sup-sidebar-entry-arrow {
      flex: 0 0 auto;
      font-size: 12px;
      color: var(--text-tertiary);
      transition: transform var(--transition-fast), color var(--transition-fast);
    }
    .sup-sidebar-entry:hover .sup-sidebar-entry-arrow {
      color: var(--bg-deep);
    }
    /* Subtle divider line below — keeps the action row visually separate from
       the "Projects" header that follows so users don't read it as project #1. */
    .sup-sidebar-entry-sep {
      height: 1px;
      background: var(--border-subtle);
      margin: 0 0 var(--space-sm);
    }
    .sup-sidebar-entry-dot {
      flex: 0 0 auto;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
      box-shadow: 0 0 0 3px transparent;
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
    }
    .sup-sidebar-entry-dot.alive {
      background: var(--success);
      box-shadow: 0 0 0 3px var(--success-subtle);
    }
    .sup-sidebar-entry-dot.dead {
      background: var(--error);
      box-shadow: 0 0 0 3px var(--error-subtle);
    }
  `;
  document.head.appendChild(style);
}

function setState(kind) {
  if (!dotEl) return;
  dotEl.classList.toggle('alive', kind === 'alive');
  dotEl.classList.toggle('dead', kind === 'dead');
  if (entryEl) {
    entryEl.title = kind === 'alive'
      ? 'Supervisor daemon running — click to open dashboard'
      : kind === 'dead'
        ? 'Supervisor daemon offline — click to open dashboard'
        : 'Open Supervisor dashboard';
  }
}

function applyHeartbeat(hb) {
  if (!hb) return;
  lastHeartbeatAt = Date.now();
  const isAlive = !!hb.alive || hb.state === 'running';
  setState(isAlive ? 'alive' : 'dead');
  armStaleTimer();
}

function armStaleTimer() {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    if (Date.now() - lastHeartbeatAt >= STALE_AFTER_MS) setState('unknown');
  }, STALE_AFTER_MS);
}

function mount(host) {
  if (mounted) return;
  if (!host) return;
  mounted = true;
  injectStylesOnce();

  entryEl = document.createElement('button');
  entryEl.type = 'button';
  entryEl.className = 'sup-sidebar-entry';
  entryEl.tabIndex = -1;
  entryEl.innerHTML = `
    <span class="sup-sidebar-entry-icon" aria-hidden="true">⚡</span>
    <span class="sup-sidebar-entry-label">OPEN SUPERVISOR</span>
    <span class="sup-sidebar-entry-dot"></span>
    <span class="sup-sidebar-entry-arrow" aria-hidden="true">→</span>
  `;
  dotEl = entryEl.querySelector('.sup-sidebar-entry-dot');
  entryEl.addEventListener('click', () => {
    require('../commandRegistry').runById('supervisor.open');
  });
  // First child of the projects rail — sits above the "Projects" header so it
  // reads as a top-level destination, not a project in the workspace list.
  // Divider after it visually severs the action row from the project list.
  const sep = document.createElement('div');
  sep.className = 'sup-sidebar-entry-sep';
  host.insertBefore(sep, host.firstChild);
  host.insertBefore(entryEl, sep);
  setState('unknown');

  ipcRenderer.on(SUP.SUPERVISOR_STATE, (_evt, payload) => {
    if (!payload) return;
    if (payload.kind === 'heartbeat') applyHeartbeat(payload.data);
  });
}

module.exports = { mount };
