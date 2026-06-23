// Supervisor kanban — Phase B.
//
// Polls /api/workspace (4s) and renders 4 columns plus a full-width
// "Needs You" row above. Column mapping per server.py:derive_workspace
// (supervisor/scripts/monitor/server.py:336):
//   columns.pending   → Pending column
//   columns.active    → In-flight column
//   columns.awaiting  → Needs You row (above the grid)
//   columns.done      → Done + Failed columns (split client-side by t.status)
//
// /api/meta returns audit_path; we derive supervisorRoot = parent of run-state/
// so deliverable paths (which are project-relative) resolve to absolute paths
// that editor.openFile can consume.

const path = require('path');
const { SUPERVISOR_API } = require('./header');
const taskCard = require('./taskCard');

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function create(root) {
  let timer = null;
  let alive = true;
  let supervisorRoot = null;
  let pendingScrollTaskId = null;

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
      }
    } catch (err) {
      // Without the root, deliverable paths stay relative — editor.openFile
      // will fail and the user sees an error in the editor overlay. We log
      // once so the cause is debuggable.
      console.warn('[supervisor] could not resolve audit_path:', err.message);
    }
    return supervisorRoot;
  }

  function onArtifactClick(absPath) {
    try {
      const editor = require('../editor');
      // editor.openFile(filePath, source) — Phase A spec §9 Q2 verified the
      // signature accepts absolute paths outside the current Frame project
      // root: src/main/fileEditor.js reads via fs.readFileSync(filePath) with
      // no project-root check.
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
      // Split Done into "done" and "failed" — server lumps them in `done`.
      const done = allDone.filter((t) => t.status !== 'failed');
      const failed = allDone.filter((t) => t.status === 'failed');

      // Counts
      root.querySelector('#sup-ct-pending').textContent = String(pending.length);
      root.querySelector('#sup-ct-active').textContent = String(active.length);
      root.querySelector('#sup-ct-done').textContent = String(done.length);
      root.querySelector('#sup-ct-failed').textContent = String(failed.length);
      root.querySelector('#sup-needs-count').textContent = String(awaiting.length);

      fillList('sup-list-pending', pending, 'Queue empty', 'pending');
      fillList('sup-list-active', active, 'No active work', 'active');
      fillList('sup-list-done', done, 'No completed tasks', 'done');
      fillList('sup-list-failed', failed, 'No failures ✓', 'failed');

      // Needs-You row
      const needsListEl = root.querySelector('#sup-needs-you-list');
      needsListEl.innerHTML = '';
      if (!awaiting.length) {
        needsListEl.innerHTML = '<div class="sup-needs-you-empty">Nothing needs you ✓</div>';
      } else {
        const ctx = { supervisorRoot, onArtifactClick };
        awaiting.forEach((t) => needsListEl.appendChild(taskCard.render(t, 'awaiting', ctx)));
      }
    } catch (err) {
      // Quiet — keep the last rendered state
    }
  }

  function scrollToTask(taskId) {
    pendingScrollTaskId = taskId;
    poll();
  }

  function start() {
    if (timer) return;
    poll();
    timer = setInterval(poll, 4000);
  }

  function stop() {
    alive = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  start();
  return { start, stop, refresh: poll, scrollToTask };
}

module.exports = { create };
