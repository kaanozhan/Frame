// Supervisor submit-task panel — Phase D.
//
// Inline composer toggled by the header's [▶ Submit task] button. Three input
// modes (segmented control):
//   - Free-form         — title + profile + brief textarea (we materialise
//                         the text into <ROOT>/prompts/inline/<id>-<ts>.md
//                         in main; server requires brief to be a file path)
//   - From file         — Electron dialog.showOpenDialog → absolute brief path
//   - Reuse existing    — searchable list over <ROOT>/prompts/follow-ups/*.md
//
// The panel mounts as a sibling between .supervisor-header and
// .supervisor-body so it slides under the chrome without overlaying the
// kanban. On successful submit the panel closes; the kanban state push from
// Phase C reactively shows the new card in Pending within ~1s.

const path = require('path');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');

let panelEl = null;
let mode = 'freeform';   // 'freeform' | 'file' | 'reuse'
let supervisorRoot = null;
let profileCache = null;
let briefCache = null;
let pickedFilePath = '';
let pickedBriefRel = '';
let pickedBriefLabel = '';

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function resolveSupervisorRoot() {
  if (supervisorRoot) return supervisorRoot;
  try {
    const meta = await fetchJson('/api/meta');
    if (meta && meta.audit_path) {
      supervisorRoot = path.dirname(path.dirname(meta.audit_path));
    }
  } catch {
    // Best-effort. If we can't resolve it, Free-form mode will surface a
    // clear error from main; From-file and Reuse modes still work because
    // their brief paths are user-picked / project-relative respectively.
  }
  return supervisorRoot;
}

async function loadProfiles(force = false) {
  if (profileCache && !force) return profileCache;
  await resolveSupervisorRoot();
  const items = await ipcRenderer.invoke(SUP.SUPERVISOR_LIST_PROFILES, {
    supervisorRoot,
    force,
  });
  profileCache = Array.isArray(items) ? items : [];
  return profileCache;
}

async function loadBriefs(force = false) {
  if (briefCache && !force) return briefCache;
  await resolveSupervisorRoot();
  const items = await ipcRenderer.invoke(SUP.SUPERVISOR_LIST_BRIEFS, {
    supervisor_root: supervisorRoot,
    force,
  });
  briefCache = Array.isArray(items) ? items : [];
  return briefCache;
}

function setMode(next) {
  mode = next;
  if (!panelEl) return;
  panelEl.querySelectorAll('.sup-sub-mode').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === next);
  });
  panelEl.querySelectorAll('.sup-sub-pane').forEach((p) => {
    p.classList.toggle('active', p.dataset.mode === next);
  });
}

function setError(msg) {
  if (!panelEl) return;
  const el = panelEl.querySelector('.sup-sub-error');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

function renderProfileOptions(selectEl, items) {
  selectEl.innerHTML = items.length
    ? items.map((p) => `<option value="${esc(p.path)}">${esc(p.label)}</option>`).join('')
    : '<option value="">(no profiles found)</option>';
}

function renderBriefList(listEl, items, filter) {
  const q = (filter || '').toLowerCase();
  const filtered = q
    ? items.filter((b) => b.label.toLowerCase().includes(q))
    : items;
  if (!filtered.length) {
    listEl.innerHTML = '<div class="sup-sub-reuse-empty">No briefs match</div>';
    return;
  }
  listEl.innerHTML = filtered.map((b, i) => (
    `<button type="button" class="sup-sub-reuse-row" data-idx="${i}" data-rel="${esc(b.path)}" data-label="${esc(b.label)}">
       ${esc(b.label)}
     </button>`
  )).join('');
}

function buildPanelHTML() {
  return `
    <div class="sup-sub-header">
      <strong>Submit task</strong>
      <div class="sup-sub-modes">
        <button class="sup-sub-mode active" data-mode="freeform" type="button">Free-form</button>
        <button class="sup-sub-mode" data-mode="file" type="button">From file</button>
        <button class="sup-sub-mode" data-mode="reuse" type="button">Reuse existing brief</button>
      </div>
      <button class="sup-sub-close" type="button" title="Close">×</button>
    </div>
    <div class="sup-sub-error"></div>
    <div class="sup-sub-grid">
      <label>Profile
        <select class="sup-sub-profile"><option value="">loading…</option></select>
      </label>
    </div>

    <div class="sup-sub-pane active" data-mode="freeform">
      <div class="sup-sub-grid">
        <label>Task ID
          <input type="text" class="sup-sub-id" placeholder="alnum, dot, dash, underscore (≤80 chars)" />
        </label>
        <label>Title (optional, defaults to id)
          <input type="text" class="sup-sub-title" placeholder="e.g. Phase E notifications" />
        </label>
      </div>
      <label>Brief
        <textarea class="sup-sub-brief" rows="10" placeholder="Write the brief inline. Saved under prompts/inline/&lt;id&gt;.md so the daemon can read it."></textarea>
      </label>
    </div>

    <div class="sup-sub-pane" data-mode="file">
      <div class="sup-sub-grid">
        <label>Task ID
          <input type="text" class="sup-sub-file-id" placeholder="alnum, dot, dash, underscore (≤80 chars)" />
        </label>
        <label>Title override (optional)
          <input type="text" class="sup-sub-file-title" placeholder="Defaults to id" />
        </label>
      </div>
      <div class="sup-sub-file-row">
        <button type="button" class="sup-btn sup-sub-pick">Pick brief file…</button>
        <span class="sup-sub-file-path">(no file picked)</span>
      </div>
    </div>

    <div class="sup-sub-pane" data-mode="reuse">
      <input type="text" class="sup-sub-reuse-search" placeholder="Search prompts/follow-ups/*.md…" />
      <div class="sup-sub-reuse-list">loading…</div>
      <div class="sup-sub-reuse-picked-row">picked: <span class="sup-sub-reuse-picked">(no brief picked)</span></div>
      <div class="sup-sub-grid">
        <label>New task ID
          <input type="text" class="sup-sub-reuse-id" placeholder="alnum, dot, dash, underscore" />
        </label>
        <label>Title override (optional)
          <input type="text" class="sup-sub-reuse-title" placeholder="Defaults to brief filename" />
        </label>
      </div>
    </div>

    <div class="sup-sub-actions">
      <button class="sup-btn primary sup-sub-submit" type="button">Submit</button>
      <button class="sup-btn sup-sub-cancel" type="button">Cancel</button>
    </div>
  `;
}

function bind() {
  panelEl.querySelector('.sup-sub-close').addEventListener('click', close);
  panelEl.querySelector('.sup-sub-cancel').addEventListener('click', close);
  panelEl.querySelectorAll('.sup-sub-mode').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  panelEl.querySelector('.sup-sub-pick').addEventListener('click', async () => {
    const res = await ipcRenderer.invoke(SUP.SUPERVISOR_PICK_BRIEF_FILE, {});
    if (res && res.ok && res.path) {
      pickedFilePath = res.path;
      panelEl.querySelector('.sup-sub-file-path').textContent = res.path;
      setError('');
    } else if (res && res.error) {
      setError(res.error);
    }
  });

  panelEl.querySelector('.sup-sub-reuse-search').addEventListener('input', (e) => {
    const listEl = panelEl.querySelector('.sup-sub-reuse-list');
    renderBriefList(listEl, briefCache || [], e.target.value);
    rebindReuseRows();
  });

  panelEl.querySelector('.sup-sub-submit').addEventListener('click', submit);
}

function rebindReuseRows() {
  panelEl.querySelectorAll('.sup-sub-reuse-row').forEach((row) => {
    row.addEventListener('click', () => {
      pickedBriefRel = row.dataset.rel;
      pickedBriefLabel = row.dataset.label;
      panelEl.querySelector('.sup-sub-reuse-picked').textContent = pickedBriefLabel;
      panelEl.querySelectorAll('.sup-sub-reuse-row').forEach((r) => r.classList.remove('picked'));
      row.classList.add('picked');
      setError('');
    });
  });
}

async function submit() {
  if (!panelEl) return;
  setError('');

  const profileSel = panelEl.querySelector('.sup-sub-profile');
  const profile = profileSel.value;
  if (!profile) { setError('Pick a profile.'); return; }

  let payload = { profile, supervisorRoot };

  if (mode === 'freeform') {
    const id = panelEl.querySelector('.sup-sub-id').value.trim();
    if (!ID_RE.test(id)) { setError('Task ID must match [A-Za-z0-9_.-]{1,80}.'); return; }
    const title = panelEl.querySelector('.sup-sub-title').value.trim();
    const briefInline = panelEl.querySelector('.sup-sub-brief').value;
    if (!briefInline.trim()) { setError('Brief cannot be empty.'); return; }
    payload = { ...payload, id, title: title || id, briefInline };
  } else if (mode === 'file') {
    const id = panelEl.querySelector('.sup-sub-file-id').value.trim();
    if (!ID_RE.test(id)) { setError('Task ID must match [A-Za-z0-9_.-]{1,80}.'); return; }
    if (!pickedFilePath) { setError('Pick a brief file first.'); return; }
    const title = panelEl.querySelector('.sup-sub-file-title').value.trim();
    payload = { ...payload, id, title: title || id, brief: pickedFilePath };
  } else if (mode === 'reuse') {
    const id = panelEl.querySelector('.sup-sub-reuse-id').value.trim();
    if (!ID_RE.test(id)) { setError('New task ID must match [A-Za-z0-9_.-]{1,80}.'); return; }
    if (!pickedBriefRel) { setError('Pick a brief from the list first.'); return; }
    const title = panelEl.querySelector('.sup-sub-reuse-title').value.trim();
    payload = { ...payload, id, title: title || pickedBriefLabel || id, brief: pickedBriefRel };
  }

  const submitBtn = panelEl.querySelector('.sup-sub-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  try {
    const res = await ipcRenderer.invoke(SUP.SUPERVISOR_SUBMIT_TASK, payload);
    if (res && res.ok) {
      // Phase C state push will land the new card in Pending within ~1s; no
      // manual refresh needed. Close and reset.
      close();
    } else {
      setError((res && res.error) || 'Submit failed.');
    }
  } catch (err) {
    setError(`IPC error: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
}

async function open() {
  const supervisorRootEl = document.querySelector('.supervisor-root');
  const headerEl = document.querySelector('.supervisor-header');
  if (!supervisorRootEl || !headerEl) return;
  if (panelEl && panelEl.isConnected) {
    panelEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  panelEl = document.createElement('div');
  panelEl.className = 'supervisor-submit-panel';
  panelEl.innerHTML = buildPanelHTML();
  headerEl.insertAdjacentElement('afterend', panelEl);
  bind();
  setMode('freeform');

  // Hydrate profile dropdown + brief list in parallel. We render whatever
  // comes back; an empty profile list is surfaced as a single disabled option
  // so the user sees there's nothing to pick (rather than a phantom submit).
  const [profiles, briefs] = await Promise.all([loadProfiles(false), loadBriefs(false)]);
  renderProfileOptions(panelEl.querySelector('.sup-sub-profile'), profiles);
  const listEl = panelEl.querySelector('.sup-sub-reuse-list');
  renderBriefList(listEl, briefs, '');
  rebindReuseRows();
}

function close() {
  if (panelEl && panelEl.parentNode) {
    panelEl.parentNode.removeChild(panelEl);
  }
  panelEl = null;
  pickedFilePath = '';
  pickedBriefRel = '';
  pickedBriefLabel = '';
}

function toggle() {
  if (panelEl && panelEl.isConnected) close();
  else open();
}

function isOpen() {
  return !!(panelEl && panelEl.isConnected);
}

module.exports = { toggle, open, close, isOpen };
