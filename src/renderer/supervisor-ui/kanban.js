// Supervisor kanban — Phase C (reactive nudge + fallback poll).
//
// We still rely on /api/workspace as the authoritative shape — server.py
// derive_workspace() does the column-bucket bookkeeping (escalations,
// elapsed_s, etc.) we don't want to reimplement client-side. What changed:
//   - audit.jsonl writes and queue/*/ directory changes get pushed via
//     SUPERVISOR_STATE → we coalesce a refetch on each (debounced 300ms)
//   - the 4s polling interval is only armed as a fallback if no
//     SUPERVISOR_STATE push lands within 5s of mount
//
// Also: after resolving the supervisorRoot from /api/meta.audit_path, we
// hand it to main via SUPERVISOR_STATE_INIT so stateWatcher knows what to
// watch. This is what kicks off heartbeat + audit pushes for both header
// and kanban; without it, both fall back to HTTP.
//
// /api/meta returns audit_path; we derive supervisorRoot = parent of run-state/
// so deliverable paths (project-relative) resolve to absolute paths that
// editor.openFile can consume.

const path = require('path');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');
const taskCard = require('./taskCard');
const escalationCard = require('./escalationCard');

const FALLBACK_AFTER_MS = 5000;
const FALLBACK_POLL_MS = 4000;
const REFETCH_DEBOUNCE_MS = 300;

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function create(root) {
  let alive = true;
  let supervisorRoot = null;
  let pendingScrollTaskId = null;
  let stateListener = null;
  let receivedPushAt = 0;
  let fallbackTimer = null;
  let fallbackArmTimer = null;
  let refetchDebounce = null;
  // Track the most recent in-flight task ids so we can offer Tail log on them.
  let lastInFlight = new Set();

  root.innerHTML = `
    <div class="sup-needs-you" id="sup-needs-you">
      <div class="sup-section-hdr">
        Needs You <span class="sup-count" id="sup-needs-count">0</span>
      </div>
      <div class="sup-needs-you-list" id="sup-needs-you-list"></div>
    </div>
    <div class="sup-columns">
      <div class="sup-col">
        <h3>Pending <span class="sup-count" id="sup-ct-pending">0</span></h3>
        <div class="sup-col-list" id="sup-list-pending"></div>
      </div>
      <div class="sup-col">
        <h3>In-flight <span class="sup-count" id="sup-ct-active">0</span></h3>
        <div class="sup-col-list" id="sup-list-active"></div>
      </div>
      <div class="sup-col">
        <h3>Done <span class="sup-count" id="sup-ct-done">0</span></h3>
        <div class="sup-col-list" id="sup-list-done"></div>
      </div>
      <div class="sup-col">
        <h3>Failed <span class="sup-count" id="sup-ct-failed">0</span></h3>
        <div class="sup-col-list" id="sup-list-failed"></div>
      </div>
    </div>
  `;

  async function resolveSupervisorRoot() {
    if (supervisorRoot) return supervisorRoot;
    try {
      const meta = await fetchJson('/api/meta');
      if (meta && meta.audit_path) {
        // audit_path = <ROOT>/run-state/audit.jsonl → ROOT = grandparent
        supervisorRoot = path.dirname(path.dirname(meta.audit_path));
        // Hand the root to main so stateWatcher can start. Idempotent on the
        // main side — calling repeatedly with the same root is a no-op.
        ipcRenderer.invoke(SUP.SUPERVISOR_STATE_INIT, { supervisorRoot })
          .catch((err) => console.warn('[supervisor] STATE_INIT failed:', err.message));
      }
    } catch (err) {
      console.warn('[supervisor] could not resolve audit_path:', err.message);
    }
    return supervisorRoot;
  }

  function onArtifactClick(absPath) {
    try {
      const editor = require('../editor');
      editor.openFile(absPath, 'supervisor');
    } catch (err) {
      console.warn('[supervisor] editor.openFile failed:', err);
    }
  }

  function fillList(elId, items, emptyMsg, columnKey) {
    const el = root.querySelector(`#${elId}`);
    if (!el) return;
    el.innerHTML = '';
    if (!items.length) {
      el.innerHTML = `<div class="sup-col-empty">${emptyMsg}</div>`;
      return;
    }
    const ctx = { supervisorRoot, onArtifactClick };
    items.forEach((t) => {
      const card = taskCard.render(t, columnKey, ctx);
      el.appendChild(card);
      if (pendingScrollTaskId && card.dataset.taskId === pendingScrollTaskId) {
        setTimeout(() => {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('flash');
          setTimeout(() => card.classList.remove('flash'), 2000);
        }, 50);
        pendingScrollTaskId = null;
      }
    });
  }

  async function poll() {
    if (!alive) return;
    await resolveSupervisorRoot();
    try {
      const ws = await fetchJson('/api/workspace');
      if (!alive) return;
      const cols = ws.columns || {};
      const pending = cols.pending || [];
      const active = cols.active || [];
      const awaiting = cols.awaiting || [];
      const allDone = cols.done || [];
      const done = allDone.filter((t) => t.status !== 'failed');
      const failed = allDone.filter((t) => t.status === 'failed');

      root.querySelector('#sup-ct-pending').textContent = String(pending.length);
      root.querySelector('#sup-ct-active').textContent = String(active.length);
      root.querySelector('#sup-ct-done').textContent = String(done.length);
      root.querySelector('#sup-ct-failed').textContent = String(failed.length);
      root.querySelector('#sup-needs-count').textContent = String(awaiting.length);

      lastInFlight = new Set(active.map((t) => t.id).filter(Boolean));

      fillList('sup-list-pending', pending, 'Queue empty', 'pending');
      fillList('sup-list-active', active, 'No active work', 'active');
      fillList('sup-list-done', done, 'No completed tasks', 'done');
      fillList('sup-list-failed', failed, 'No failures ✓', 'failed');

      const needsListEl = root.querySelector('#sup-needs-you-list');
      needsListEl.innerHTML = '';
      if (!awaiting.length) {
        needsListEl.innerHTML = '<div class="sup-needs-you-empty">Nothing needs you ✓</div>';
      } else {
        // Phase D: replaces the Phase B placeholder taskCard with the
        // Approve/Edit/Redirect card. taskCard is still used for the four
        // columns; only the Needs-You row uses escalationCard.
        awaiting.forEach((t) => needsListEl.appendChild(escalationCard.render(t)));
      }
    } catch (err) {
      // Quiet — keep the last rendered state
    }
  }

  function schedulePoll() {
    if (refetchDebounce) return;
    refetchDebounce = setTimeout(() => {
      refetchDebounce = null;
      poll();
    }, REFETCH_DEBOUNCE_MS);
  }

  function startFallback() {
    if (fallbackTimer) return;
    fallbackTimer = setInterval(poll, FALLBACK_POLL_MS);
  }

  function stopFallback() {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  // Optimistic-pending insertion. /api/workspace.columns.pending derives from
  // heartbeat.json, which only refreshes on the queue runner's 5s tick — so
  // a /api/workspace fetch right after a new YAML lands won't see it for up
  // to 5s. Bridge that gap by surfacing the new id immediately when the
  // queue watcher fires for queue/pending/. The next authoritative poll
  // either confirms or removes it.
  function applyOptimisticPending(id) {
    if (!id) return;
    const el = root.querySelector('#sup-list-pending');
    if (!el) return;
    if (el.querySelector(`[data-task-id="${CSS.escape(id)}"]`)) return;
    // Drop the "Queue empty" placeholder if present.
    const empty = el.querySelector('.sup-col-empty');
    if (empty) empty.remove();
    const ctx = { supervisorRoot, onArtifactClick };
    const synthetic = { id, title: id, status: 'pending' };
    const card = taskCard.render(synthetic, 'pending', ctx);
    card.classList.add('sup-card-optimistic');
    el.appendChild(card);
    const countEl = root.querySelector('#sup-ct-pending');
    if (countEl) countEl.textContent = String(el.querySelectorAll('.sup-card').length);
  }

  // Subscribe to main's reactive state pushes. Audit + queue events both
  // mean "workspace probably changed" → debounced refetch of /api/workspace.
  // We also optimistically render new pending cards so the user sees the
  // submission within ~1s instead of waiting for the next heartbeat tick.
  stateListener = (_evt, payload) => {
    if (!payload || !alive) return;
    receivedPushAt = Date.now();
    stopFallback();
    if (payload.kind === 'queue' && payload.data && payload.data.status === 'pending'
        && payload.data.name && /\.yaml$/.test(payload.data.name)) {
      applyOptimisticPending(payload.data.name.replace(/\.yaml$/, ''));
    }
    if (payload.kind === 'audit' || payload.kind === 'queue') {
      schedulePoll();
    }
  };
  ipcRenderer.on(SUP.SUPERVISOR_STATE, stateListener);

  function scrollToTask(taskId) {
    pendingScrollTaskId = taskId;
    poll();
  }

  // Phase F: command-palette "Tail current in-flight task". Locate the first
  // in-flight card, scroll it into view, and synthesize a click on its
  // "▾ Tail log" button so the live pane mounts. No-op when nothing is
  // in-flight or supervisorRoot hasn't been resolved (the tail button is only
  // rendered then anyway).
  function expandTailOnFirstInflight() {
    const list = root.querySelector('#sup-list-active');
    if (!list) return false;
    const firstCard = list.querySelector('.sup-card[data-task-id]');
    if (!firstCard) return false;
    const btn = firstCard.querySelector('.sup-card-tail-btn');
    if (!btn) return false;
    firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!firstCard.querySelector('.sup-card-tail-area.open')) btn.click();
    return true;
  }

  // Initial paint
  poll();

  // If no SUPERVISOR_STATE push arrives within 5s, resume polling at the
  // original 4s cadence.
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
    if (refetchDebounce) clearTimeout(refetchDebounce);
    fallbackArmTimer = null;
    refetchDebounce = null;
    // Phase H: clear inline-detail expansion state when the section closes so
    // a fresh open doesn't auto-expand previously-opened cards (and so the
    // audit/brief caches don't outlive the section's lifetime).
    try { taskCard.resetExpansion(); } catch { /* ignore */ }
  }

  return { stop, refresh: poll, scrollToTask, expandTailOnFirstInflight };
}

// Phase F helper for the "Supervisor — Tail current in-flight task" command.
// The kanban controller is owned by index.js (latestControllers); we surface
// a module-level shim so the command-registry entry stays a one-liner.
function expandTailOnFirstInflight() {
  const idx = require('./index');
  const controllers = idx.__getLatestControllers && idx.__getLatestControllers();
  const k = controllers && controllers.kanban;
  if (!k || typeof k.expandTailOnFirstInflight !== 'function') return false;
  return k.expandTailOnFirstInflight();
}

module.exports = { create, expandTailOnFirstInflight };
