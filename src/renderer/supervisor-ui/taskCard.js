// Supervisor task card — Phase B (collapsed) + Phase H (inline expansion).
//
// Phase H per Chris (2026-06-23): "I'm unable to click into cards to see
// full details like in the PWA." Clicking the card body toggles an inline
// expansion (height grows; the column reflows) per spec §4.1; we do NOT
// overlay a modal. Sections mirror the PWA's task-detail (spec §2.1 F2):
// status grid, brief, decisions, critic feedback, failure logs, deliverables
// (clickable → editor.openFile), and timeline. Decisions/critic/timeline
// come from audit.jsonl via SUPERVISOR_TASK_AUDIT (the /api/workspace payload
// only carries counts).
//
// Expansion state is module-level (keyed by task id) so the per-poll re-render
// in kanban.js doesn't collapse the card the user just opened. Audit + brief
// data are cached the same way to avoid re-fetching on every poll.

const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');

// Persistent state across re-renders (cleared when the supervisor section
// unmounts — see resetExpansion() exported below).
const expanded = new Set();
const auditCache = new Map();   // taskId -> { events, ts }
const briefCache = new Map();   // taskId -> { content, abs }
const AUDIT_TTL_MS = 5000;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function statusTag(t) {
  if (t.pending_human_response) return 'escalate';
  if (t.last_critique_verdict === 'revise') return 'revising';
  if (t.status === 'done') return 'done';
  if (t.status === 'failed') return 'failed';
  if (t.status === 'pending') return 'pending';
  return 'running';
}

function elapsedLabel(t) {
  const s = Number(t.elapsed_s || 0);
  if (!s) return null;
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  return `${mins}m ${secs}s`;
}

function costLabel(t) {
  if (typeof t.cost_usd === 'number' && t.cost_usd > 0) return `$${t.cost_usd.toFixed(2)}`;
  return null;
}

/**
 * Resolve a (possibly relative) deliverable path against the supervisor root.
 * Server returns paths like "src/foo.py" or "prompts/bar.md" — relative to
 * the supervisor ROOT. We compute ROOT from /api/meta.audit_path (parent of
 * `run-state/`).
 */
function resolveDeliverable(p, supervisorRoot) {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  if (!supervisorRoot) return p;
  return path.resolve(supervisorRoot, p);
}

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / (1024 * 1024)).toFixed(1)}M`;
}

function formatTimeAgo(mtimeMs) {
  if (!mtimeMs) return '';
  const diff = Date.now() - mtimeMs;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h ago`;
  return `${Math.round(diff / 86400_000)}d ago`;
}

// ---- Section renderers --------------------------------------------------

function renderStatusGrid(t) {
  const rows = [
    ['Status', t.status || '—'],
    ['Profile', t.profile || '—'],
    ['Cost', costLabel(t) || '—'],
    ['Elapsed', elapsedLabel(t) || '—'],
    ['Tool uses', String(t.tool_uses || 0)],
    ['Decisions', String(t.decisions || 0)],
    ['Critique passes', String(t.critique_passes || 0)],
    ['Revisions', String(t.critique_revises || 0)],
    ['Escalations', String(t.escalations || 0)],
    ['Queue item', t.queue_item_id || '—'],
  ];
  return `<div class="sup-exp-grid">${rows.map(([k, v]) => `
    <div class="sup-exp-stat"><div class="sup-exp-stat-k">${esc(k)}</div><div class="sup-exp-stat-v">${esc(v)}</div></div>
  `).join('')}</div>`;
}

function renderBriefSection(t, ctx, sectionEl) {
  if (!t.brief) {
    sectionEl.innerHTML = `<h4>Brief</h4><div class="sup-exp-muted">(no brief recorded)</div>`;
    return;
  }
  const briefAbs = resolveDeliverable(t.brief, ctx.supervisorRoot);
  sectionEl.innerHTML = `
    <h4>Brief <span class="sup-exp-path">${esc(t.brief)}</span></h4>
    <pre class="sup-exp-brief" data-role="brief-body">loading…</pre>
    <button type="button" class="sup-btn sup-exp-open-brief">Open full brief →</button>
  `;
  const body = sectionEl.querySelector('[data-role="brief-body"]');
  const openBtn = sectionEl.querySelector('.sup-exp-open-brief');
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof ctx.onArtifactClick === 'function') ctx.onArtifactClick(briefAbs);
  });

  const cached = briefCache.get(t.id);
  if (cached) {
    body.textContent = cached.content;
    return;
  }
  // First 500 chars only; /api/file returns the full file but we trim.
  fetch(`${SUPERVISOR_API}/api/file?path=${encodeURIComponent(briefAbs)}`)
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((j) => {
      const full = (j && j.content) || '';
      const snippet = full.length > 500 ? full.slice(0, 500) + '…' : full;
      briefCache.set(t.id, { content: snippet, abs: briefAbs });
      body.textContent = snippet || '(empty brief)';
    })
    .catch((err) => { body.textContent = `(could not load: ${err.message})`; });
}

function renderDecisions(events) {
  const classified = events.filter((e) => e.action === 'classified');
  const answeredByDecision = new Map();
  for (const e of events) {
    if (e.action === 'answered') {
      const did = (e.detail && e.detail.decision) || '';
      answeredByDecision.set(did, (e.detail && e.detail.answer) || '');
    }
  }
  if (!classified.length) {
    return `<h4>Decisions</h4><div class="sup-exp-muted">(no decisions yet)</div>`;
  }
  // dN naming matches audit.jsonl ordering (d1, d2, …) used by the supervisor.
  const items = classified.map((e, idx) => {
    const d = e.detail || {};
    const did = `d${idx + 1}`;
    const ans = answeredByDecision.get(did);
    const conf = typeof d.confidence === 'number' ? ` · ${Math.round(d.confidence * 100)}%` : '';
    return `<li>
      <div class="sup-exp-dec-row">
        <span class="sup-exp-route route-${esc(d.route || 'auto')}">${esc(d.route || 'auto')}</span>
        <span class="sup-exp-dec-conf">${esc(did)}${conf}</span>
      </div>
      <div class="sup-exp-dec-q">${esc(d.q || '(no question recorded)')}</div>
      ${ans ? `<div class="sup-exp-dec-a"><b>→</b> ${esc(ans)}</div>` : ''}
    </li>`;
  }).join('');
  return `<h4>Decisions (${classified.length})</h4><ul class="sup-exp-list">${items}</ul>`;
}

function renderCritic(events) {
  const critiques = events.filter((e) => e.action === 'self_revision_critique');
  if (!critiques.length) {
    return `<h4>Critic feedback</h4><div class="sup-exp-muted">(no critique passes)</div>`;
  }
  const items = critiques.map((e) => {
    const d = e.detail || {};
    const verdict = d.verdict || '?';
    const issues = Array.isArray(d.issues) ? d.issues : [];
    return `<li>
      <div class="sup-exp-dec-row">
        <span class="sup-exp-route route-${esc(verdict === 'revise' ? 'escalate' : 'auto')}">${esc(verdict)}</span>
        <span class="sup-exp-dec-conf">pass ${esc(String(d.pass || '?'))}</span>
      </div>
      ${d.reasoning ? `<div class="sup-exp-dec-q">${esc(d.reasoning)}</div>` : ''}
      ${issues.length ? `<ul class="sup-exp-issue-list">${issues.map((i) => `<li>${esc(String(i))}</li>`).join('')}</ul>` : ''}
    </li>`;
  }).join('');
  return `<h4>Critic feedback (${critiques.length})</h4><ul class="sup-exp-list">${items}</ul>`;
}

function renderFailure(t) {
  if (t.status !== 'failed') return '';
  const summary = t.failure_summary || '(no failure summary recorded)';
  const verif = t.verification && t.verification !== '(no verifies; trusting supervisor\'s done status)'
    ? t.verification : '';
  return `<h4>Failure</h4>
    <pre class="sup-exp-failure">${esc(summary.slice(0, 2000))}</pre>
    ${verif ? `<pre class="sup-exp-failure">${esc(verif.slice(0, 2000))}</pre>` : ''}`;
}

function renderDeliverables(t, ctx) {
  const deliverables = Array.isArray(t.deliverables) ? t.deliverables : [];
  if (!deliverables.length) {
    return `<h4>Deliverables</h4><div class="sup-exp-muted">(none extracted from agent summary)</div>`;
  }
  const items = deliverables.map((rel) => {
    const abs = resolveDeliverable(rel, ctx.supervisorRoot);
    let sizeStr = '';
    let mtimeStr = '';
    try {
      const st = fs.statSync(abs);
      sizeStr = formatBytes(st.size);
      mtimeStr = formatTimeAgo(st.mtimeMs);
    } catch { /* file may have been deleted/moved */ }
    return `<li>
      <button type="button" class="sup-exp-deliv" data-abs="${esc(abs || rel)}" title="${esc(abs || rel)}">
        <span class="sup-exp-deliv-name">${esc(rel)}</span>
        <span class="sup-exp-deliv-meta">${esc(sizeStr)}${sizeStr && mtimeStr ? ' · ' : ''}${esc(mtimeStr)}</span>
      </button>
    </li>`;
  }).join('');
  return `<h4>Deliverables (${deliverables.length})</h4><ul class="sup-exp-deliv-list">${items}</ul>`;
}

function renderTimeline(t, events) {
  // Prefer the rich audit stream when we have it; fall back to t.recent[]
  // (which derive_tasks pre-filtered and truncated).
  const src = (events && events.length)
    ? events.map((e) => ({ action: e.action, summary: shortSummary(e) }))
    : (Array.isArray(t.recent) ? t.recent : []);
  if (!src.length) return `<h4>Timeline</h4><div class="sup-exp-muted">(no events)</div>`;
  const items = src.slice().reverse().map((r) => `
    <li>
      <span class="sup-exp-tl-k action-${esc(r.action)}">${esc(r.action)}</span>
      <span class="sup-exp-tl-s">${esc(r.summary || '')}</span>
    </li>
  `).join('');
  return `<h4>Timeline (${src.length})</h4><ul class="sup-exp-timeline">${items}</ul>`;
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

// ---- Expansion build + audit fetch --------------------------------------

function buildExpanded(t, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'sup-card-expanded';
  wrap.innerHTML = `
    <section class="sup-card-exp-section sup-exp-status"></section>
    <section class="sup-card-exp-section sup-exp-brief-sec"></section>
    <section class="sup-card-exp-section sup-exp-fail-sec"></section>
    <section class="sup-card-exp-section sup-exp-deliv-sec"></section>
    <section class="sup-card-exp-section sup-exp-decisions"></section>
    <section class="sup-card-exp-section sup-exp-critic"></section>
    <section class="sup-card-exp-section sup-exp-timeline"></section>
  `;

  wrap.querySelector('.sup-exp-status').innerHTML = `<h4>Status</h4>${renderStatusGrid(t)}`;
  renderBriefSection(t, ctx, wrap.querySelector('.sup-exp-brief-sec'));

  const failHtml = renderFailure(t);
  const failSec = wrap.querySelector('.sup-exp-fail-sec');
  if (failHtml) failSec.innerHTML = failHtml; else failSec.remove();

  wrap.querySelector('.sup-exp-deliv-sec').innerHTML = renderDeliverables(t, ctx);
  // Wire deliverable clicks; pattern matches the collapsed-state list.
  wrap.querySelectorAll('.sup-exp-deliv').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abs = btn.dataset.abs;
      if (abs && typeof ctx.onArtifactClick === 'function') ctx.onArtifactClick(abs);
    });
  });

  // Decisions / critic / timeline depend on audit; render placeholders + fetch.
  const decEl = wrap.querySelector('.sup-exp-decisions');
  const critEl = wrap.querySelector('.sup-exp-critic');
  const tlEl = wrap.querySelector('.sup-exp-timeline');
  decEl.innerHTML = `<h4>Decisions</h4><div class="sup-exp-muted">loading…</div>`;
  critEl.innerHTML = `<h4>Critic feedback</h4><div class="sup-exp-muted">loading…</div>`;
  // Timeline can render from t.recent immediately while audit loads.
  tlEl.innerHTML = renderTimeline(t, null);

  loadAuditAndPaint(t, ctx, { decEl, critEl, tlEl });
  return wrap;
}

function loadAuditAndPaint(t, ctx, els) {
  const cached = auditCache.get(t.id);
  const fresh = cached && (Date.now() - cached.ts) < AUDIT_TTL_MS;
  if (fresh) { paintAuditSections(t, cached.events, els); return; }
  if (!ctx.supervisorRoot) {
    els.decEl.innerHTML = `<h4>Decisions</h4><div class="sup-exp-muted">(supervisor root not resolved)</div>`;
    els.critEl.innerHTML = `<h4>Critic feedback</h4><div class="sup-exp-muted">(supervisor root not resolved)</div>`;
    return;
  }
  ipcRenderer.invoke(SUP.SUPERVISOR_TASK_AUDIT, {
    taskId: t.id, supervisorRoot: ctx.supervisorRoot,
  }).then((res) => {
    const events = (res && res.events) || [];
    auditCache.set(t.id, { events, ts: Date.now() });
    paintAuditSections(t, events, els);
  }).catch((err) => {
    els.decEl.innerHTML = `<h4>Decisions</h4><div class="sup-exp-muted">(audit load failed: ${esc(err.message)})</div>`;
    els.critEl.innerHTML = `<h4>Critic feedback</h4><div class="sup-exp-muted">(audit load failed)</div>`;
  });
}

function paintAuditSections(t, events, els) {
  els.decEl.innerHTML = renderDecisions(events);
  els.critEl.innerHTML = renderCritic(events);
  els.tlEl.innerHTML = renderTimeline(t, events);
}

// ---- Public --------------------------------------------------------------

/**
 * Render a single task card into `parentEl`.
 * @param {object} t              task object from /api/workspace
 * @param {string} columnKey      pending|active|awaiting|done|failed
 * @param {object} ctx            { supervisorRoot, onArtifactClick }
 * @returns {HTMLElement} the card element (for highlighting/scroll-to)
 */
function render(t, columnKey, ctx) {
  const card = document.createElement('div');
  const tag = statusTag(t);
  card.className = 'sup-card';
  if (tag === 'escalate') card.classList.add('esc');
  if (tag === 'done' || tag === 'failed') card.classList.add('done');
  card.dataset.taskId = t.id || '';

  const profileChip = t.profile
    ? `<span class="sup-card-profile">${esc(t.profile)}</span>`
    : '';
  const tid = (t.id || '').slice(-12);

  const metaParts = [];
  const cost = costLabel(t);
  if (cost) metaParts.push(`<span>${cost}</span>`);
  const elapsed = elapsedLabel(t);
  if (elapsed && t.is_active) metaParts.push(`<span>${elapsed}</span>`);
  if (t.tool_uses) metaParts.push(`<span>${t.tool_uses} tools</span>`);

  // The clickable body lives in its own wrapper so toggle binding is unambiguous
  // — buttons / tail-area / artifact links sit outside it and don't toggle.
  const bodyHtml = `
    <div class="sup-card-body">
      <div class="sup-card-row1">
        <span class="sup-tag ${tag}">${tag}</span>
        ${profileChip}
        <span class="sup-tid" title="${esc(t.id || '')}">${esc(tid)}</span>
        <span class="sup-card-toggle" aria-label="Toggle details">▾</span>
      </div>
      <div class="sup-card-title" title="${esc(t.title || '')}">${esc(t.title || t.id || '(untitled)')}</div>
      ${metaParts.length ? `<div class="sup-card-meta">${metaParts.join('')}</div>` : ''}
    </div>
  `;
  card.innerHTML = bodyHtml;

  // "Tail log" affordance for in-flight cards — clicking expands a live PTY
  // pane below the body (kept from Phase C; orthogonal to Phase H expand).
  if (columnKey === 'active' && t.id && ctx && ctx.supervisorRoot) {
    const tailRow = document.createElement('div');
    tailRow.className = 'sup-card-tail-row';
    const tailBtn = document.createElement('button');
    tailBtn.type = 'button';
    tailBtn.className = 'sup-card-tail-btn';
    tailBtn.textContent = '▾ Tail log';
    tailRow.appendChild(tailBtn);

    const tailArea = document.createElement('div');
    tailArea.className = 'sup-card-tail-area';
    tailRow.appendChild(tailArea);

    let pane = null;
    let tailOpen = false;
    tailBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tailOpen = !tailOpen;
      tailBtn.textContent = tailOpen ? '▴ Hide log' : '▾ Tail log';
      tailArea.classList.toggle('open', tailOpen);
      if (tailOpen) {
        const lop = require('./liveOutputPane');
        pane = lop.create(tailArea, { taskId: t.id, supervisorRoot: ctx.supervisorRoot });
        pane.start();
      } else if (pane) {
        pane.stop();
        pane = null;
        tailArea.innerHTML = '';
      }
    });
    card.appendChild(tailRow);
  }

  // Artifact links on Done cards (collapsed-state compact list).
  const deliverables = Array.isArray(t.deliverables) ? t.deliverables : [];
  if (deliverables.length && (tag === 'done' || tag === 'failed')) {
    const artifactsEl = document.createElement('div');
    artifactsEl.className = 'sup-artifacts';
    deliverables.slice(0, 8).forEach((rel) => {
      const abs = resolveDeliverable(rel, ctx.supervisorRoot);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sup-artifact';
      const filename = path.basename(rel);
      btn.textContent = `▸ ${filename}`;
      btn.title = abs || rel;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof ctx.onArtifactClick === 'function') {
          ctx.onArtifactClick(abs || rel);
        }
      });
      artifactsEl.appendChild(btn);
    });
    card.appendChild(artifactsEl);
  }

  // Phase H: inline expansion. Toggle on body click; rehydrate state from
  // module-level Set so kanban.js polls don't collapse open cards.
  const bodyEl = card.querySelector('.sup-card-body');
  const toggleEl = card.querySelector('.sup-card-toggle');
  function setExpanded(on) {
    if (on) {
      card.classList.add('sup-card-open');
      if (toggleEl) toggleEl.textContent = '▴';
      expanded.add(t.id);
      const existing = card.querySelector('.sup-card-expanded');
      if (!existing) card.appendChild(buildExpanded(t, ctx));
    } else {
      card.classList.remove('sup-card-open');
      if (toggleEl) toggleEl.textContent = '▾';
      expanded.delete(t.id);
      const existing = card.querySelector('.sup-card-expanded');
      if (existing) existing.remove();
    }
  }
  if (bodyEl) {
    bodyEl.addEventListener('click', (e) => {
      // Allow internal links/buttons inside the body header itself to bubble
      // out unaffected; the toggle only fires when the click target is the
      // body wrapper or one of its non-interactive descendants.
      if (e.target.closest('button, a')) return;
      setExpanded(!card.classList.contains('sup-card-open'));
    });
  }
  if (expanded.has(t.id)) setExpanded(true);

  return card;
}

function resetExpansion() {
  expanded.clear();
  auditCache.clear();
  briefCache.clear();
}

module.exports = { render, statusTag, resetExpansion };
