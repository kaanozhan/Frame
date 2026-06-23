// Supervisor task card — Phase B (collapsed only).
//
// Expanded state lands in Phase D (or B.5). For now: title, profile chip,
// elapsed time if in-flight, and (for Done cards) a compact list of artifact
// links resolved against the supervisor root.

const path = require('path');

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

  card.innerHTML = `
    <div class="sup-card-row1">
      <span class="sup-tag ${tag}">${tag}</span>
      ${profileChip}
      <span class="sup-tid" title="${esc(t.id || '')}">${esc(tid)}</span>
    </div>
    <div class="sup-card-title" title="${esc(t.title || '')}">${esc(t.title || t.id || '(untitled)')}</div>
    ${metaParts.length ? `<div class="sup-card-meta">${metaParts.join('')}</div>` : ''}
  `;

  // Artifact links on Done cards
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

  return card;
}

module.exports = { render, statusTag };
