// Supervisor escalation card — Phase D.
//
// Replaces the Phase B placeholder for "Needs You" entries. The PWA pattern
// is preserved verbatim (spec §4.1): three primary buttons — Approve / Edit /
// Redirect — and the Edit/Redirect actions expand an inline textarea rather
// than opening a modal. The card removes itself on the next state push from
// Phase C once the daemon acknowledges the response.
//
// Server contract: POST /api/escalations/{id}/respond with {kind, answer}.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function pickEscalationId(t) {
  // Different server versions surface the escalation key under different
  // names. Accept any reasonable shape — we only need a stable round-trip id.
  return (
    (t.escalation && t.escalation.id)
    || t.escalation_id
    || t.pending_escalation_id
    || t.id
  );
}

function pickDraft(t) {
  const direct = (t.escalation && (t.escalation.draft_answer || t.escalation.recommended_answer))
    || t.escalation_draft
    || t.draft_answer;
  if (direct) return direct;
  // Fallback: derive_tasks stuffs the draft into recent[].summary under the
  // 'escalated' action (truncated to 140 chars). Better than nothing for the
  // human to see what they're approving.
  const recent = Array.isArray(t.recent) ? t.recent : [];
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] && recent[i].action === 'escalated' && recent[i].summary) {
      return recent[i].summary;
    }
  }
  return '';
}

function pickCategory(t) {
  return (
    (t.escalation && (t.escalation.category || t.escalation.kind))
    || t.escalation_category
    || ''
  );
}

function pickConfidence(t) {
  const c = (t.escalation && (t.escalation.confidence || t.escalation.classifier_confidence))
    || t.escalation_confidence;
  if (c == null) return '';
  const n = Number(c);
  if (!isFinite(n)) return '';
  return `${Math.round(n * 100)}%`;
}

function render(t) {
  const card = document.createElement('div');
  card.className = 'sup-card sup-esc-card esc';
  card.dataset.taskId = t.id || '';
  const escId = pickEscalationId(t);
  card.dataset.escId = escId || '';

  const draft = pickDraft(t);
  const category = pickCategory(t);
  const confidence = pickConfidence(t);
  const title = t.title || t.id || '(untitled)';
  const tid = (t.id || '').slice(-12);

  const metaBits = [];
  if (category) metaBits.push(`<span class="sup-esc-cat">${esc(category)}</span>`);
  if (confidence) metaBits.push(`<span class="sup-esc-conf">${esc(confidence)} conf.</span>`);

  card.innerHTML = `
    <div class="sup-card-row1">
      <span class="sup-tag escalate">needs you</span>
      <span class="sup-tid" title="${esc(t.id || '')}">${esc(tid)}</span>
    </div>
    <div class="sup-card-title" title="${esc(title)}">${esc(title)}</div>
    ${metaBits.length ? `<div class="sup-esc-meta">${metaBits.join('')}</div>` : ''}
    ${draft ? `<div class="sup-esc-draft-label">Draft answer</div>
               <pre class="sup-esc-draft">${esc(draft)}</pre>` : ''}
    <div class="sup-esc-actions">
      <button type="button" class="sup-btn primary sup-esc-approve">Approve draft</button>
      <button type="button" class="sup-btn sup-esc-edit">Edit…</button>
      <button type="button" class="sup-btn sup-esc-redirect">Redirect…</button>
    </div>
    <div class="sup-esc-inline" hidden>
      <textarea class="sup-esc-textarea" rows="6"></textarea>
      <div class="sup-esc-inline-actions">
        <button type="button" class="sup-btn primary sup-esc-send">Send</button>
        <button type="button" class="sup-btn sup-esc-cancel">Cancel</button>
      </div>
    </div>
    <div class="sup-esc-status"></div>
  `;

  const statusEl = card.querySelector('.sup-esc-status');
  const inlineEl = card.querySelector('.sup-esc-inline');
  const textareaEl = card.querySelector('.sup-esc-textarea');
  const primaryRow = card.querySelector('.sup-esc-actions');
  let pendingKind = null;

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.classList.remove('ok', 'err');
    if (kind) statusEl.classList.add(kind);
  }

  function disableAll() {
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  }

  async function send(kind, answer) {
    if (!escId) { setStatus('Missing escalation id; cannot respond.', 'err'); return; }
    disableAll();
    setStatus('Sending…');
    try {
      const res = await ipcRenderer.invoke(SUP.SUPERVISOR_RESPOND_ESCALATION, {
        id: escId,
        kind,
        answer,
      });
      if (res && res.ok) {
        setStatus('Sent ✓', 'ok');
        // Card removal happens on the next state push from Phase C; if the
        // daemon hasn't dropped the escalation yet, the buttons stay disabled
        // and the "Sent ✓" tag tells the user it's in flight.
      } else {
        setStatus((res && res.error) || 'Failed.', 'err');
        // Re-enable so the user can retry / edit.
        card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    } catch (err) {
      setStatus(`IPC error: ${err.message}`, 'err');
      card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }

  card.querySelector('.sup-esc-approve').addEventListener('click', () => {
    // PWA contract: approve sends the '__recommended__' sentinel which the
    // server expands into the actual drafted answer. Mirroring this avoids a
    // race where we'd send a stale truncated draft from recent[].summary.
    send('approve', '__recommended__');
  });
  card.querySelector('.sup-esc-edit').addEventListener('click', () => {
    pendingKind = 'edit';
    inlineEl.hidden = false;
    primaryRow.style.display = 'none';
    textareaEl.value = draft || '';
    textareaEl.focus();
  });
  card.querySelector('.sup-esc-redirect').addEventListener('click', () => {
    pendingKind = 'redirect';
    inlineEl.hidden = false;
    primaryRow.style.display = 'none';
    textareaEl.value = '';
    textareaEl.focus();
  });
  card.querySelector('.sup-esc-cancel').addEventListener('click', () => {
    pendingKind = null;
    inlineEl.hidden = true;
    primaryRow.style.display = '';
    textareaEl.value = '';
    setStatus('');
  });
  card.querySelector('.sup-esc-send').addEventListener('click', () => {
    const answer = textareaEl.value.trim();
    if (!answer) { setStatus('Answer cannot be empty.', 'err'); return; }
    if (!pendingKind) return;
    send(pendingKind, answer);
  });

  return card;
}

module.exports = { render };
