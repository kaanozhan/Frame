// Supervisor memory Q&A panel — Phase J.
//
// Native parity for the PWA's Memory Q&A surface (spec §2.1 F4 + §4.7). The
// PWA implementation lives in supervisor/mobile/index.html (askMemoryQA);
// we mirror its contract against the same /api/memory/* endpoints and gain
// Frame's editor integration: citation clicks open the source markdown in
// Frame's native markdown viewer instead of the mobile modal.
//
// Endpoints (all owned by supervisor monitor server.py):
//   GET  /api/memory/projects          → [{name, notes}]
//   POST /api/memory/qa                → {answer, sources[], clickup_items[], clickup_warning?}
//        body: {project, question, include_clickup?}
//   GET  /api/clickup/health           → {ok}
//
// Session-only answer history (cap 10, newest first). No persistence — the
// next Frame restart starts blank, matching the PWA. Subsequent Asks while a
// request is in-flight are queued (one slot) rather than ignored, so a user
// typing fast doesn't lose their second question.

const { shell } = require('electron');
const { marked } = require('marked');
const { SUPERVISOR_API } = require('./header');

const HISTORY_CAP = 10;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fetchJson(p, init) {
  const res = await fetch(`${SUPERVISOR_API}${p}`, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderMarkdown(text) {
  // marked is already a dep of Frame (see specSection.js:18). Falls back to
  // escaped text if marked is somehow unavailable so the panel never throws.
  try {
    return marked.parse(String(text || ''), { breaks: true, mangle: false, headerIds: false });
  } catch {
    return `<pre>${esc(text)}</pre>`;
  }
}

function create(root, opts = {}) {
  let alive = true;
  let currentProject = opts.initialProject || null;
  let projects = [];
  let cuHealthy = false;
  let history = []; // [{question, project, answer, sources, clickup_items, clickup_warning, elapsedS}]
  let inFlight = false;
  let queuedQuestion = null;
  const onOpenFile = opts.onOpenFile || (() => {});

  root.innerHTML = `
    <div class="sup-mem-card">
      <div class="sup-mem-hdr">
        <div class="sup-mem-title">Memory Q&amp;A: <strong id="sup-mem-proj">—</strong></div>
        <div class="sup-mem-sub">Searches your shared memory store, grounds the answer with citations,
          and lets you click any source open in Frame's markdown viewer.</div>
      </div>
      <div class="sup-mem-compose">
        <label class="sup-mem-proj-row">
          <span>Project</span>
          <select id="sup-mem-proj-sel"></select>
        </label>
        <label class="sup-mem-q-row">
          <span>Question</span>
          <textarea id="sup-mem-q" rows="3"
            placeholder="Ask anything grounded in this project's memory notes…"></textarea>
        </label>
        <div class="sup-mem-actions">
          <label class="sup-mem-cu-row" id="sup-mem-cu-row" hidden>
            <input type="checkbox" id="sup-mem-cu" />
            <span>Include ClickUp tasks (slower; 30–60s)</span>
          </label>
          <span class="sup-mem-status" id="sup-mem-status"></span>
          <button type="button" class="sup-btn primary" id="sup-mem-ask">Ask</button>
        </div>
      </div>
      <div class="sup-mem-history-hdr">
        <span>Recent answers</span>
        <button type="button" class="sup-btn" id="sup-mem-clear">Clear history</button>
      </div>
      <div class="sup-mem-history" id="sup-mem-history">
        <div class="sup-mem-empty">No answers yet — ask a question above.</div>
      </div>
    </div>
  `;

  const projSel = root.querySelector('#sup-mem-proj-sel');
  const projLabel = root.querySelector('#sup-mem-proj');
  const qEl = root.querySelector('#sup-mem-q');
  const askBtn = root.querySelector('#sup-mem-ask');
  const statusEl = root.querySelector('#sup-mem-status');
  const historyEl = root.querySelector('#sup-mem-history');
  const cuRow = root.querySelector('#sup-mem-cu-row');
  const cuCheckbox = root.querySelector('#sup-mem-cu');
  const clearBtn = root.querySelector('#sup-mem-clear');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'sup-mem-status' + (kind ? ` ${kind}` : '');
  }

  function syncProjLabel() {
    const name = (currentProject && currentProject.name) || projSel.value || '—';
    projLabel.textContent = name;
  }

  async function loadProjects() {
    try {
      const list = await fetchJson('/api/memory/projects');
      if (!alive) return;
      projects = Array.isArray(list) ? list : [];
      const desired = (currentProject && currentProject.name) || projSel.value || '';
      projSel.innerHTML = '<option value="">Choose a project…</option>' +
        projects.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} · ${p.notes} notes</option>`).join('');
      // Restore selection if the desired project still exists in the list.
      if (desired && projects.some((p) => p.name === desired)) {
        projSel.value = desired;
      }
      syncProjLabel();
    } catch (err) {
      // Quiet — leave the selector empty. The user will see the Ask button
      // surface a clearer error on submit.
      projSel.innerHTML = '<option value="">(memory projects unavailable)</option>';
    }
  }

  async function checkClickUpHealth() {
    try {
      const h = await fetchJson('/api/clickup/health');
      if (!alive) return;
      cuHealthy = !!(h && (h.ok || h.healthy));
    } catch {
      cuHealthy = false;
    }
    cuRow.hidden = !cuHealthy;
  }

  function renderClickupItems(items) {
    if (!items || !items.length) return '';
    return `
      <div class="sup-mem-cu-list">
        <div class="sup-mem-section-label">Related ClickUp tasks</div>
        ${items.map((i) => {
          const url = (i.url || '').trim();
          const name = esc(i.name || '(no name)');
          const type = esc(i.type || 'task');
          const list = i.list ? `<span class="sup-mem-cu-list-name">list: ${esc(i.list)}</span>` : '';
          const summary = i.summary ? `<div class="sup-mem-cu-summary">${esc(i.summary)}</div>` : '';
          const action = url
            ? `<button type="button" class="sup-mem-cu-open" data-url="${esc(url)}">Open in ClickUp ↗</button>`
            : '';
          return `
            <div class="sup-mem-cu-item">
              <div class="sup-mem-cu-head">
                <span class="sup-mem-cu-type">${type}</span>
                <span class="sup-mem-cu-name">${name}</span>
                ${list}
              </div>
              ${summary}
              ${action}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderSources(sources) {
    if (!sources || !sources.length) {
      return '<div class="sup-mem-empty">No sources cited.</div>';
    }
    return `
      <div class="sup-mem-sources">
        <div class="sup-mem-section-label">Sources</div>
        ${sources.map((s, idx) => {
          const ref = esc(s.ref || '');
          const summary = esc(s.summary || '');
          const score = s.score != null ? `<span class="sup-mem-src-score">score ${esc(s.score)}</span>` : '';
          // path is the absolute file path returned by the supervisor; the
          // dataset attr lets the click handler look it up without re-quoting
          // the path string into the onclick attribute.
          return `
            <button type="button" class="sup-mem-src" data-idx="${idx}" title="Open in Frame's markdown viewer">
              <span class="sup-mem-src-ref">▸ ${ref}</span>
              ${summary ? `<span class="sup-mem-src-summary">${summary}</span>` : ''}
              ${score}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderHistory() {
    if (!history.length) {
      historyEl.innerHTML = '<div class="sup-mem-empty">No answers yet — ask a question above.</div>';
      return;
    }
    historyEl.innerHTML = history.map((h, idx) => {
      const warn = h.clickup_warning
        ? `<div class="sup-mem-warn">⚠ ${esc(h.clickup_warning)}</div>` : '';
      return `
        <div class="sup-mem-entry" data-entry="${idx}">
          <div class="sup-mem-q-line">
            <span class="sup-mem-q-label">Q</span>
            <span class="sup-mem-q-text">${esc(h.question)}</span>
            <span class="sup-mem-q-meta">${esc(h.project)} · ${esc(h.elapsedS)}s</span>
          </div>
          ${warn}
          <div class="sup-mem-a">${renderMarkdown(h.answer)}</div>
          ${renderSources(h.sources)}
          ${renderClickupItems(h.clickup_items)}
        </div>
      `;
    }).join('');

    // Wire source click → editor.openFile via the absolute path on the source
    // object. We look up by entry+idx so a stale closure can't reference the
    // wrong history item after a clear or new push.
    historyEl.querySelectorAll('.sup-mem-entry').forEach((entryEl) => {
      const entryIdx = Number(entryEl.dataset.entry);
      const entry = history[entryIdx];
      if (!entry) return;
      entryEl.querySelectorAll('.sup-mem-src').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.idx);
          const src = entry.sources && entry.sources[i];
          if (src && src.path) onOpenFile(src.path);
        });
      });
      entryEl.querySelectorAll('.sup-mem-cu-open').forEach((btn) => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url;
          if (url) {
            try { shell.openExternal(url); }
            catch (err) { console.warn('[supervisor] shell.openExternal failed:', err); }
          }
        });
      });
    });
  }

  function pushHistory(entry) {
    history.unshift(entry);
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    renderHistory();
  }

  function setBusy(busy) {
    inFlight = busy;
    askBtn.disabled = busy;
    askBtn.textContent = busy ? 'Asking…' : 'Ask';
  }

  async function ask() {
    const project = projSel.value || (currentProject && currentProject.name) || '';
    const question = qEl.value.trim();
    if (!project) { setStatus('Pick a project first.', 'err'); return; }
    if (!question) { setStatus('Type a question.', 'err'); return; }
    if (inFlight) {
      // Queue one slot — the in-flight request fires the next one on completion.
      queuedQuestion = { project, question, include_clickup: cuCheckbox.checked };
      setStatus('Queued — will run after the current question.', 'busy');
      return;
    }
    const include_clickup = cuHealthy && cuCheckbox.checked;
    const eta = include_clickup ? '30–60s' : '10–30s';
    setBusy(true);
    setStatus(`Searching memory${include_clickup ? ' + ClickUp' : ''} (~${eta})…`, 'busy');

    const t0 = Date.now();
    try {
      const res = await fetch(`${SUPERVISOR_API}/api/memory/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, question, include_clickup }),
      });
      const data = await res.json().catch(() => ({}));
      if (!alive) return;
      const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res.ok || data.error) {
        setStatus(`Error: ${data.error || `HTTP ${res.status}`}`, 'err');
      } else {
        // Clear the composer on success — matches the PWA's clear-on-submit
        // pattern, and the answer is preserved in the history below.
        qEl.value = '';
        pushHistory({
          question,
          project,
          answer: data.answer || '(no answer)',
          sources: Array.isArray(data.sources) ? data.sources : [],
          clickup_items: Array.isArray(data.clickup_items) ? data.clickup_items : [],
          clickup_warning: data.clickup_warning || '',
          elapsedS,
        });
        const srcCount = (data.sources || []).length;
        const cuCount = (data.clickup_items || []).length;
        let msg = `Answered from ${srcCount} sources`;
        if (cuCount) msg += ` + ${cuCount} ClickUp items`;
        msg += ` in ${elapsedS}s.`;
        setStatus(msg, data.clickup_warning ? 'err' : 'ok');
      }
    } catch (err) {
      if (!alive) return;
      setStatus(`Request failed: ${err.message || err}`, 'err');
    } finally {
      if (!alive) return;
      setBusy(false);
      // Drain the queue slot — but only if it's still a fresh question.
      if (queuedQuestion) {
        const queued = queuedQuestion;
        queuedQuestion = null;
        // Put the queued question back into the composer + checkbox so the
        // user sees what's about to fire, then trigger another ask.
        qEl.value = queued.question;
        if (cuCheckbox) cuCheckbox.checked = !!queued.include_clickup;
        if (queued.project && projSel.value !== queued.project) projSel.value = queued.project;
        setTimeout(() => { if (alive) ask(); }, 50);
      }
    }
  }

  projSel.addEventListener('change', () => {
    // Reflect the dropdown selection in the header label. We don't reload
    // history — the user keeps their answer log when they switch projects.
    syncProjLabel();
  });
  askBtn.addEventListener('click', ask);
  qEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      ask();
    }
  });
  clearBtn.addEventListener('click', () => {
    if (!history.length) return;
    if (!window.confirm('Clear all Q&A history for this session?')) return;
    history = [];
    renderHistory();
    setStatus('History cleared.', 'ok');
  });

  function setProject(project) {
    currentProject = project || null;
    // If projects already loaded, snap the dropdown to the tree's selection.
    if (project && project.name && projects.some((p) => p.name === project.name)) {
      projSel.value = project.name;
    }
    syncProjLabel();
  }

  function stop() {
    alive = false;
  }

  // Initial paint — projects + ClickUp health probe run in parallel so the
  // user doesn't wait on the slower (CU) request before the dropdown fills.
  loadProjects();
  checkClickUpHealth();

  return {
    setProject,
    stop,
    // Test/debug surface.
    __getHistory: () => history,
  };
}

module.exports = { create };
