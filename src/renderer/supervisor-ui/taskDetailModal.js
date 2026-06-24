// Supervisor task detail modal — Phase M.
//
// Full-screen modal mirroring the PWA's task detail view at
// supervisor/mobile/index.html (openTaskDetail / renderDetail near L631).
// Phase H put the same data inline in the card; Chris's PWA-parity smoke
// test 2026-06-23 asked for a modal instead so cards stay compact and the
// detail surface is the same shape across native + mobile clients.
//
// Two tabs:
//   Overview  — metric grid (cost / elapsed / tool uses / decisions ;
//               critique passes / revisions / escalations / status),
//               context (queue item / profile / brief with Open buttons),
//               and a collapsible brief preview.
//   Activity  — current narrative + recent activity timeline (audit.jsonl
//               filtered to the task, newest first), live-refreshed.
//
// The modal is rendered as a single sibling of #app under document.body so
// the supervisor tab's overflow:hidden can't clip it. Audit events come
// from the same SUPERVISOR_TASK_AUDIT IPC the inline card used in Phase H.

const fs = require('fs');
const path = require('path');
const { ipcRenderer, shell } = require('electron');
const { marked } = require('marked');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');
const { openFile } = require('./openFile');

const AUDIT_TTL_MS = 10_000;
const briefCache = new Map(); // taskId -> {content, abs}
const auditCache = new Map(); // taskId -> {events, ts}

let _root = null;          // <div class="sup-modal-root">
let _state = {
  task: null,
  ctx: null,                // { supervisorRoot, onOpenFile }
  tab: 'overview',
  briefShown: false,
};
let _refreshTimer = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function elapsedLabel(t) {
  const s = Number(t.elapsed_s || 0);
  if (!s) return '—';
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  return `${mins}m ${secs}s`;
}

function costLabel(t, isActive) {
  if (typeof t.cost_usd === 'number' && t.cost_usd > 0) return `$${t.cost_usd.toFixed(2)}`;
  return isActive ? 'running…' : '—';
}

function resolveAbs(p, supervisorRoot) {
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  if (!supervisorRoot) return p;
  return path.resolve(supervisorRoot, p);
}

function statusTag(t) {
  if (t.pending_human_response) return 'escalate';
  if (t.last_critique_verdict === 'revise') return 'revising';
  if (t.status === 'done') return 'done';
  if (t.status === 'failed') return 'failed';
  if (t.status === 'pending') return 'pending';
  return 'running';
}

function ensureRoot() {
  if (_root && _root.isConnected) return _root;
  _root = document.createElement('div');
  _root.className = 'sup-modal-root';
  _root.innerHTML = `
    <div class="sup-modal-overlay" data-role="overlay"></div>
    <div class="sup-modal-sheet" role="dialog" aria-modal="true" aria-label="Task detail">
      <header class="sup-modal-hdr">
        <div class="sup-modal-hdr-l">
          <div class="sup-modal-meta" data-role="meta"></div>
          <div class="sup-modal-title" data-role="title">…</div>
        </div>
        <button type="button" class="sup-modal-x" data-role="close" title="Close (Esc)">✕</button>
      </header>
      <nav class="sup-modal-tabs" role="tablist">
        <button type="button" class="sup-modal-tab active" data-mtab="overview" role="tab" aria-selected="true">Overview</button>
        <button type="button" class="sup-modal-tab" data-mtab="activity" role="tab" aria-selected="false">Activity</button>
      </nav>
      <div class="sup-modal-body" data-role="body"></div>
    </div>
  `;
  document.body.appendChild(_root);

  _root.querySelector('[data-role="overlay"]').addEventListener('click', close);
  _root.querySelector('[data-role="close"]').addEventListener('click', close);
  _root.querySelectorAll('.sup-modal-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.mtab));
  });
  document.addEventListener('keydown', _onKeydown);
  return _root;
}

function _onKeydown(e) {
  if (!_root || !_root.classList.contains('show')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

function switchTab(name) {
  _state.tab = name;
  if (!_root) return;
  _root.querySelectorAll('.sup-modal-tab').forEach((btn) => {
    const on = btn.dataset.mtab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  renderBody();
}

// ---- Body renderers -----------------------------------------------------

function renderOverview() {
  const t = _state.task;
  const ctx = _state.ctx || {};
  const isActive = t.is_active && t.status !== 'done' && t.status !== 'failed';

  const stats = [
    ['Cost', costLabel(t, isActive)],
    ['Elapsed', elapsedLabel(t)],
    ['Tool uses', String(t.tool_uses || 0)],
    ['Decisions', String(t.decisions || 0)],
    ['Critique passes', String(t.critique_passes || 0)],
    ['Revisions', String(t.critique_revises || 0), t.critique_revises ? 'warn' : ''],
    ['Escalations', String(t.escalations || 0), t.escalations ? 'warn' : ''],
    ['Status', t.status || '?'],
  ];
  const statsHtml = `
    <div class="sup-modal-grid">
      ${stats.map(([k, v, cls]) => `
        <div class="sup-modal-stat">
          <div class="sup-modal-stat-k">${esc(k)}</div>
          <div class="sup-modal-stat-v ${cls || ''}">${esc(v)}</div>
        </div>
      `).join('')}
    </div>
  `;

  // Context: queue item / profile / brief with Open buttons. We resolve
  // profile + brief against supervisorRoot so the Open click lands in the
  // right file even when the supervisor reports project-relative paths.
  const profileAbs = resolveAbs(t.profile, ctx.supervisorRoot);
  const briefAbs = resolveAbs(t.brief, ctx.supervisorRoot);
  const rowHtml = (label, val, absPath) => {
    if (!val) return '';
    const actions = absPath ? `
      <span class="sup-modal-path-actions">
        <button type="button" class="sup-modal-pa" data-open="${esc(absPath)}">Open</button>
        <button type="button" class="sup-modal-pa" data-reveal="${esc(absPath)}">Finder</button>
      </span>` : '';
    return `<div class="sup-modal-ctx-row">
      <span class="sup-modal-ctx-k">${esc(label)}:</span>
      <span class="sup-modal-ctx-v">${esc(val)}</span>
      ${actions}
    </div>`;
  };
  const ctxHtml = (t.queue_item_id || t.profile || t.brief) ? `
    <section class="sup-modal-section">
      <h4>Context</h4>
      <div class="sup-modal-ctx">
        ${rowHtml('Queue item', t.queue_item_id, '')}
        ${rowHtml('Profile', t.profile, profileAbs)}
        ${rowHtml('Brief', t.brief, briefAbs)}
      </div>
    </section>
  ` : '';

  // Failure surfaced from queue-progress.json when the task failed.
  let failureHtml = '';
  if (t.status === 'failed' || t.status === 'verification_failed') {
    const summary = t.failure_summary || '(no failure summary recorded)';
    const verif = t.verification && t.verification !== "(no verifies; trusting supervisor's done status)"
      ? t.verification : '';
    failureHtml = `
      <section class="sup-modal-section">
        <h4>Failure details</h4>
        <div class="sup-modal-failure-h">Summary</div>
        <pre class="sup-modal-failure">${esc(summary.slice(0, 1500))}</pre>
        ${verif ? `<div class="sup-modal-failure-h">Verification</div>
          <pre class="sup-modal-failure">${esc(verif.slice(0, 1500))}</pre>` : ''}
      </section>
    `;
  }

  // Brief preview — collapsible. Default collapsed so the modal doesn't
  // dominate the viewport on tasks with a multi-page brief.
  //
  // Phase P: when expanded, the brief body renders as rendered markdown
  // (marked.parse) inside .sup-brief-md instead of raw <pre> text — matches
  // Frame's existing markdown viewer styling and is what the user expected
  // when they clicked "Show brief".
  const briefHtml = t.brief ? `
    <section class="sup-modal-section">
      <h4>Brief preview</h4>
      <button type="button" class="sup-btn sup-modal-brief-toggle" data-role="brief-toggle">
        ${_state.briefShown ? 'Hide brief' : 'Show brief'}
      </button>
      <div class="sup-modal-brief-wrap ${_state.briefShown ? 'open' : ''}" data-role="brief-body">${_state.briefShown ? '<div class="sup-brief-md muted">loading…</div>' : ''}</div>
    </section>
  ` : '';

  // Deliverables (Phase Q) — files the agent produced during the task. Two
  // sources merged server-side: `file_written` audit events (post-Phase Q) +
  // regex over the final summary text (legacy fallback). Section is only
  // meaningful for terminal states; hidden for pending/running.
  const delivHtml = renderDeliverables(t, ctx);

  return statsHtml + ctxHtml + failureHtml + briefHtml + delivHtml;
}

function _isTerminalForDeliverables(t) {
  const s = t.status || '';
  return s === 'done' || s === 'failed' || s === 'succeeded_with_warnings'
    || s === 'revision_cap_reached' || s === 'verification_failed';
}

function _formatSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function _formatAgo(epochSec) {
  if (!epochSec) return '';
  const ms = Date.now() - (epochSec * 1000);
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function renderDeliverables(t, ctx) {
  if (!_isTerminalForDeliverables(t)) return '';
  const deliverables = Array.isArray(t.deliverables) ? t.deliverables : [];
  const meta = (t.deliverables_meta && typeof t.deliverables_meta === 'object')
    ? t.deliverables_meta : {};
  if (!deliverables.length) {
    return `
      <section class="sup-modal-section sup-deliverables">
        <h4>Deliverables</h4>
        <div class="sup-deliv-empty">
          No file changes tracked — agent may not have written files, or tracking
          missed them. Check the brief or the full task summary for output paths.
        </div>
      </section>
    `;
  }
  return `
    <section class="sup-modal-section sup-deliverables">
      <h4>Deliverables (${deliverables.length})</h4>
      <ul class="sup-deliv-list">
        ${deliverables.map((p) => {
          const info = meta[p] || {};
          const abs = info.abs || resolveAbs(p, ctx.supervisorRoot);
          const exists = info.exists !== false;
          const sizeLbl = exists ? _formatSize(info.size) : 'missing';
          const ageLbl = exists ? _formatAgo(info.mtime) : '';
          const dotSep = (sizeLbl && ageLbl) ? ' · ' : '';
          return `<li class="sup-deliv-row ${exists ? '' : 'missing'}">
            <div class="sup-deliv-pathwrap">
              <span class="sup-deliv-bullet">▸</span>
              <code class="sup-deliv-path" title="${esc(abs || p)}">${esc(p)}</code>
            </div>
            <div class="sup-deliv-actions">
              <span class="sup-deliv-meta">${esc(sizeLbl)}${dotSep}${esc(ageLbl)}</span>
              <button type="button" class="sup-modal-pa" data-open="${esc(abs || p)}" ${exists ? '' : 'disabled'}>Open</button>
              <button type="button" class="sup-modal-pa" data-reveal="${esc(abs || p)}" ${exists ? '' : 'disabled'}>Finder</button>
            </div>
          </li>`;
        }).join('')}
      </ul>
    </section>
  `;
}

function renderActivity() {
  const t = _state.task;
  const ctx = _state.ctx || {};
  const isActive = t.is_active && t.status !== 'done' && t.status !== 'failed';

  let narrHtml = '';
  if (t.current_narrative) {
    narrHtml = `
      <section class="sup-modal-section">
        <h4>Current narrative — what the agent is doing</h4>
        <div class="sup-modal-narr">"${esc(t.current_narrative)}"</div>
      </section>
    `;
  } else if (isActive && (t.tool_uses || 0) > 0) {
    narrHtml = `
      <section class="sup-modal-section">
        <h4>Current narrative</h4>
        <div class="sup-modal-narr muted">
          (agent is in a tool-call loop — ${t.tool_uses} calls so far.
          Next narrative snapshot fires every 25 tool uses or 90s.)
        </div>
      </section>
    `;
  }

  // Recent activity — placeholder rendered with t.recent[] (server-truncated),
  // patched async with the richer audit stream once it loads.
  const recentHtml = `
    <section class="sup-modal-section" data-role="recent-sec">
      <h4>Recent activity (newest first)</h4>
      <div data-role="recent-body">${renderRecentList(t, null)}</div>
    </section>
  `;

  return narrHtml + recentHtml;
}

function renderRecentList(t, events) {
  const src = (events && events.length)
    ? events.map((e) => ({ action: e.action, summary: shortSummary(e) }))
    : (Array.isArray(t.recent) ? t.recent : []);
  if (!src.length) {
    return `<div class="sup-modal-muted">(no events yet)</div>`;
  }
  return `<ul class="sup-modal-recent">
    ${src.slice().reverse().map((r) => `
      <li>
        <span class="sup-modal-rk action-${esc(r.action)}">${esc(r.action)}</span>
        <span class="sup-modal-rs">${esc(r.summary || '')}</span>
      </li>
    `).join('')}
  </ul>`;
}

function shortSummary(e) {
  const a = e.action;
  const d = e.detail || {};
  if (a === 'task_started') return d.title || '';
  if (a === 'task_finished') return `${d.status || '?'}${d.cost_usd ? ` · $${Number(d.cost_usd).toFixed(2)}` : ''}`;
  if (a === 'classified') return `route=${d.route || '?'}: ${(d.q || '').slice(0, 120)}`;
  if (a === 'answered') return (d.answer || '').slice(0, 120);
  if (a === 'escalated') return (d.draft || '').slice(0, 120);
  if (a === 'human_responded') return (d.answer || '').slice(0, 120);
  if (a === 'self_revision_critique') return `pass ${d.pass || '?'}: ${d.verdict || '?'}`;
  if (a === 'self_revision_revise') return (d.instructions || '').slice(0, 120);
  if (a === 'progress_snapshot') return (d.last_assistant || '').slice(0, 120);
  return '';
}

function renderBriefMd(text) {
  // marked is already a dep elsewhere (memoryPanel.js); fall back to escaped
  // text if it somehow throws so the panel never crashes the modal.
  try {
    return marked.parse(String(text || ''), { breaks: true, mangle: false, headerIds: false });
  } catch {
    return `<pre>${esc(text)}</pre>`;
  }
}

function paintBriefBody(body, raw) {
  if (!body || !body.isConnected) return;
  if (!raw) {
    body.innerHTML = '<div class="sup-brief-md muted">(empty brief)</div>';
    return;
  }
  body.innerHTML = `<div class="sup-brief-md">${renderBriefMd(raw)}</div>`;
}

function loadBriefIntoBody() {
  const t = _state.task;
  if (!_root || !t || !t.brief) return;
  const body = _root.querySelector('[data-role="brief-body"]');
  if (!body) return;
  const briefAbs = resolveAbs(t.brief, (_state.ctx || {}).supervisorRoot);
  const cached = briefCache.get(t.id);
  if (cached) { paintBriefBody(body, cached.content); return; }
  fetch(`${SUPERVISOR_API}/api/file?path=${encodeURIComponent(briefAbs)}`)
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((j) => {
      const full = (j && j.content) || '';
      const snippet = full.length > 4000 ? full.slice(0, 4000) + '\n\n…(truncated)' : full;
      briefCache.set(t.id, { content: snippet, abs: briefAbs });
      paintBriefBody(body, snippet);
    })
    .catch((err) => {
      if (!body.isConnected) return;
      body.innerHTML = `<div class="sup-brief-md muted">(could not load: ${esc(err.message)})</div>`;
    });
}

function loadAuditForActivity() {
  const t = _state.task;
  const ctx = _state.ctx || {};
  if (!t || !ctx.supervisorRoot) return;
  const cached = auditCache.get(t.id);
  const fresh = cached && (Date.now() - cached.ts) < AUDIT_TTL_MS;
  if (fresh) { paintAudit(cached.events); return; }
  ipcRenderer.invoke(SUP.SUPERVISOR_TASK_AUDIT, {
    taskId: t.id, supervisorRoot: ctx.supervisorRoot,
  }).then((res) => {
    const events = (res && res.events) || [];
    auditCache.set(t.id, { events, ts: Date.now() });
    paintAudit(events);
  }).catch((err) => {
    const body = _root && _root.querySelector('[data-role="recent-body"]');
    if (body) body.innerHTML = `<div class="sup-modal-muted">(audit load failed: ${esc(err.message)})</div>`;
  });
}

function paintAudit(events) {
  if (!_root || _state.tab !== 'activity') return;
  const body = _root.querySelector('[data-role="recent-body"]');
  if (body && _state.task) body.innerHTML = renderRecentList(_state.task, events);
}

function renderBody() {
  if (!_root || !_state.task) return;
  const body = _root.querySelector('[data-role="body"]');
  if (!body) return;
  if (_state.tab === 'overview') {
    body.innerHTML = renderOverview();
    wireOverviewHandlers(body);
    if (_state.briefShown) loadBriefIntoBody();
  } else {
    body.innerHTML = renderActivity();
    loadAuditForActivity();
  }
}

function wireOverviewHandlers(body) {
  body.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = el.dataset.open;
      if (!target) return;
      // Phase P: close the modal first so the editor overlay (z-index 1000)
      // isn't covered by the sup-modal-root (also z-index 1000, but later in
      // DOM order so it wins the stacking competition). Then route through
      // the shared helper — .md to Frame's markdown viewer, everything else
      // to the OS default app.
      close();
      openFile(target);
    });
  });
  body.querySelectorAll('[data-reveal]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = el.dataset.reveal;
      if (target) {
        try { shell.showItemInFolder(target); }
        catch (err) { console.warn('[supervisor] showItemInFolder failed:', err); }
      }
    });
  });
  const briefToggle = body.querySelector('[data-role="brief-toggle"]');
  if (briefToggle) {
    briefToggle.addEventListener('click', () => {
      _state.briefShown = !_state.briefShown;
      renderBody();
    });
  }
}

function renderHeader() {
  if (!_root || !_state.task) return;
  const t = _state.task;
  const tag = statusTag(t);
  const tid = (t.id || '').slice(-12);
  _root.querySelector('[data-role="meta"]').innerHTML = `
    <span class="sup-tag ${tag}">${tag}</span>
    <span class="sup-tid" title="${esc(t.id || '')}">${esc(tid)}</span>
  `;
  _root.querySelector('[data-role="title"]').textContent = t.title || t.id || '(untitled)';
}

// ---- Public --------------------------------------------------------------

/**
 * Open the modal for the given task. ctx.supervisorRoot enables audit IPC +
 * deliverable path resolution; ctx.onOpenFile is called when the user
 * clicks an Open button on a profile / brief / deliverable.
 */
function open(task, ctx) {
  if (!task) return;
  ensureRoot();
  _state.task = task;
  _state.ctx = ctx || {};
  _state.tab = 'overview';
  _state.briefShown = false;
  _root.classList.add('show');
  renderHeader();
  renderBody();
  // While the modal is open, keep the task data fresh by re-rendering with
  // whatever the kanban controller most recently fetched. We grab the latest
  // task object on a slow tick (the kanban polls every 4s; a 2s tick here
  // catches it ~one cycle behind without piling on requests).
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    if (!_root || !_root.classList.contains('show')) return;
    const fresh = lookupLatest(_state.task.id);
    if (fresh) {
      _state.task = fresh;
      renderHeader();
      // Only the Activity tab re-paints from audit; Overview re-renders too
      // so stats stay live.
      renderBody();
    }
  }, 2000);
}

function close() {
  if (!_root) return;
  _root.classList.remove('show');
  _state.task = null;
  _state.ctx = null;
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

function isOpen() {
  return !!(_root && _root.classList.contains('show'));
}

// Look up the freshest task object by id from whatever kanban most recently
// rendered. The kanban controller doesn't expose tasks directly; the
// supervisor-ui index module owns the controller registry, so we read from
// the cached workspace via /api/workspace as a fallback. Cheap enough at 2s.
let _lastTasksById = new Map();
let _lastFetch = 0;
function lookupLatest(taskId) {
  if (!taskId) return null;
  const now = Date.now();
  if (now - _lastFetch < 1500 && _lastTasksById.has(taskId)) {
    return _lastTasksById.get(taskId);
  }
  // Fire-and-forget fetch; subsequent ticks will see the cache populated.
  fetch(`${SUPERVISOR_API}/api/workspace`).then((r) => r.ok ? r.json() : null)
    .then((ws) => {
      if (!ws) return;
      const all = [];
      const cols = ws.columns || {};
      ['pending', 'active', 'awaiting', 'done'].forEach((k) => {
        (cols[k] || []).forEach((t) => all.push(t));
      });
      _lastTasksById = new Map(all.filter((t) => t.id).map((t) => [t.id, t]));
      _lastFetch = Date.now();
    }).catch(() => { /* quiet */ });
  return _lastTasksById.get(taskId) || null;
}

module.exports = { open, close, isOpen };
