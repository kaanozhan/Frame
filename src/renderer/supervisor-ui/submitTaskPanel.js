// Supervisor submit-task panel — Phase D + Phase O.
//
// Inline composer toggled by the header's [▶ Submit task] button. Four input
// modes (segmented control):
//   - Free-form         — title + profile + brief textarea (we materialise
//                         the text into <ROOT>/prompts/inline/<id>-<ts>.md
//                         in main; server requires brief to be a file path)
//   - From file         — Electron dialog.showOpenDialog → absolute brief path
//   - Reuse existing    — searchable list over <ROOT>/prompts/follow-ups/*.md
//   - Auto-spec (O)     — paste a free-form description; Haiku 4.5 classifies
//                         project+profile+brief; preview is editable before
//                         submit. Mirrors the PWA's Auto-spec UX.
//
// The panel mounts as a sibling between .supervisor-header and
// .supervisor-body so it slides under the chrome without overlaying the
// kanban. On successful submit the panel closes; the kanban state push from
// Phase C reactively shows the new card in Pending within ~1s.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');

// Phase P — drag/drop targets reuse this dir to persist clipboard-pasted or
// inline-dropped images. Workers can read them by absolute path via @-mentions.
const DROPPED_IMAGES_DIR = path.join(os.homedir(), '.supervisor', 'dropped-images');
const DROPPED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

let panelEl = null;
let mode = 'freeform';   // 'freeform' | 'file' | 'reuse' | 'auto'
let supervisorRoot = null;
let profileCache = null;
let briefCache = null;
let pickedFilePath = '';
let pickedBriefRel = '';
let pickedBriefLabel = '';
// Phase K: pristine content of the currently picked reuse-brief, so we can
// detect "edited" vs "unchanged" without re-fetching on submit.
let pickedBriefOriginal = '';
// Phase O: cached projects list (from /api/meta) for the Auto-spec dropdowns,
// plus the most-recent auto-spec proposal so Submit knows what to send.
let autoProjectCache = null;
let autoProposal = null;
let autoLastDescription = '';

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
  // Auto-spec mode owns its own Submit/Cancel pair (Generate / Submit task)
  // because the flow is two-step. The shared Profile dropdown above the panes
  // is also not relevant — the proposal carries the profile choice.
  const actions = panelEl.querySelector('.sup-sub-actions');
  if (actions) actions.style.display = next === 'auto' ? 'none' : '';
  const profileLabel = panelEl.querySelector('.sup-sub-grid > label > .sup-sub-profile');
  if (profileLabel && profileLabel.parentElement && profileLabel.parentElement.parentElement) {
    profileLabel.parentElement.parentElement.style.display = next === 'auto' ? 'none' : '';
  }
  if (next === 'auto') hydrateAutoProjects();
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
        <button class="sup-sub-mode" data-mode="auto" type="button">✨ Auto-spec</button>
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
      <label class="sup-sub-reuse-edit-label">Brief (editable)
        <textarea class="sup-sub-brief sup-sub-reuse-brief" rows="14"
          placeholder="Pick a brief above; its content will load here so you can tweak before submitting."
          disabled></textarea>
      </label>
      <label class="sup-sub-reuse-save-row">
        <input type="checkbox" class="sup-sub-reuse-save" checked />
        <span>Save edits to a new file under <code>prompts/inline/&lt;new-task-id&gt;.md</code> (unchecked → submit original path as-is)</span>
      </label>
    </div>

    <div class="sup-sub-pane" data-mode="auto">
      <label class="sup-sub-auto-desc-label">Describe what you want done
        <textarea class="sup-sub-auto-desc" rows="6"
          placeholder="e.g. Fix the Kitli search so product matching surfaces the right items. Haiku 4.5 picks the project + profile and drafts a brief you can edit before queueing."></textarea>
      </label>
      <div class="sup-sub-auto-row">
        <button type="button" class="sup-btn primary sup-sub-auto-generate">✨ Generate spec</button>
        <span class="sup-sub-auto-status"></span>
      </div>

      <div class="sup-sub-auto-preview" hidden>
        <div class="sup-sub-auto-preview-hdr">
          <span class="sup-sub-auto-badge">Auto-spec preview</span>
          <span class="sup-sub-auto-conf">confidence: —</span>
        </div>
        <div class="sup-sub-auto-rationale"></div>
        <div class="sup-sub-grid">
          <label>Project
            <select class="sup-sub-auto-project"></select>
          </label>
          <label>Profile
            <select class="sup-sub-auto-profile"></select>
          </label>
        </div>
        <div class="sup-sub-grid">
          <label>Task ID
            <input type="text" class="sup-sub-auto-id" placeholder="kebab-case slug" />
          </label>
          <label>Title
            <input type="text" class="sup-sub-auto-title" placeholder="Short title" />
          </label>
        </div>
        <label>Brief (markdown — edit freely)
          <textarea class="sup-sub-auto-brief" rows="12"></textarea>
        </label>
        <div class="sup-sub-auto-cost"></div>
        <div class="sup-sub-auto-acts">
          <button type="button" class="sup-btn sup-sub-auto-regenerate">Regenerate</button>
          <button type="button" class="sup-btn primary sup-sub-auto-submit">Submit task ►</button>
        </div>
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

  // Phase O — Auto-spec wiring
  panelEl.querySelector('.sup-sub-auto-generate').addEventListener('click', runAutoSpec);
  panelEl.querySelector('.sup-sub-auto-regenerate').addEventListener('click', runAutoSpec);
  panelEl.querySelector('.sup-sub-auto-submit').addEventListener('click', submitAuto);

  // Phase P — drag/drop file paths and images into the Auto-spec description
  // (and the editable reuse-brief textarea). Workers read the dropped paths
  // because Electron exposes `file.path` on the dropped File; for clipboard /
  // synthesised images we persist the bytes under ~/.supervisor/dropped-images/
  // first so the worker has an absolute path to Read.
  wireDropTarget(panelEl.querySelector('.sup-sub-auto-desc'), setAutoStatus);
  wireDropTarget(panelEl.querySelector('.sup-sub-auto-brief'), setAutoStatus);
  wireDropTarget(panelEl.querySelector('.sup-sub-reuse-brief'), setError);
}

function insertAtCursor(taEl, text) {
  if (!taEl || !text) return;
  const start = taEl.selectionStart || 0;
  const end = taEl.selectionEnd || 0;
  const before = taEl.value.slice(0, start);
  const after = taEl.value.slice(end);
  const needsLeadingNl = before && !before.endsWith('\n') ? '\n' : '';
  taEl.value = before + needsLeadingNl + text + after;
  const caret = (before + needsLeadingNl + text).length;
  taEl.selectionStart = taEl.selectionEnd = caret;
  taEl.dispatchEvent(new Event('input'));
}

function saveDroppedImageBuffer(buf, suggestedName) {
  try {
    if (!fs.existsSync(DROPPED_IMAGES_DIR)) {
      fs.mkdirSync(DROPPED_IMAGES_DIR, { recursive: true });
    }
  } catch (err) {
    return { ok: false, error: `mkdir failed: ${err.message}` };
  }
  const ts = Math.floor(Date.now() / 1000);
  const stem = (path.parse(suggestedName || 'image').name || 'image')
    .replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'image';
  let ext = path.extname(suggestedName || '').toLowerCase();
  const ALLOWED = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic'];
  if (!ALLOWED.includes(ext)) ext = '.png';
  const outPath = path.join(DROPPED_IMAGES_DIR, `${ts}-${stem}${ext}`);
  try {
    fs.writeFileSync(outPath, buf);
  } catch (err) {
    return { ok: false, error: `write failed: ${err.message}` };
  }
  return { ok: true, path: outPath };
}

function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(Buffer.from(r.result));
    r.onerror = () => reject(r.error || new Error('FileReader error'));
    r.readAsArrayBuffer(file);
  });
}

function wireDropTarget(taEl, statusFn) {
  if (!taEl) return;
  const setStatus = (msg, kind) => {
    if (typeof statusFn === 'function') statusFn(msg, kind || 'err');
  };
  taEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    taEl.classList.add('drag-over');
  });
  taEl.addEventListener('dragleave', () => taEl.classList.remove('drag-over'));
  taEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    taEl.classList.remove('drag-over');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const text = (e.dataTransfer && e.dataTransfer.getData('text/plain') || '').trim();
    const tokens = [];
    for (const f of files) {
      // Electron renderer: file.path is the absolute filesystem path. Prefer it
      // verbatim — no need to copy bytes anywhere.
      if (f.path) {
        tokens.push('@' + f.path);
        continue;
      }
      // No path (clipboard-pasted image, drag from a web source): persist the
      // bytes under ~/.supervisor/dropped-images/ and use the saved path.
      if (f.size > DROPPED_IMAGE_MAX_BYTES) {
        setStatus(`dropped ${f.name || 'file'} exceeds 5MB — skipped`);
        continue;
      }
      try {
        const buf = await readFileAsBuffer(f);
        const saved = saveDroppedImageBuffer(buf, f.name || 'pasted-image.png');
        if (saved.ok) tokens.push('@' + saved.path);
        else setStatus(`save failed: ${saved.error}`);
      } catch (err) {
        setStatus(`read failed: ${err.message}`);
      }
    }
    if (!tokens.length && text) {
      // Plain-text drop (e.g. a path dragged from the file column view).
      tokens.push(text);
    }
    if (tokens.length) insertAtCursor(taEl, tokens.join('\n'));
  });
}

function setAutoStatus(msg, kind) {
  if (!panelEl) return;
  const el = panelEl.querySelector('.sup-sub-auto-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.remove('loading', 'err');
  if (kind) el.classList.add(kind);
}

async function hydrateAutoProjects() {
  if (autoProjectCache) return autoProjectCache;
  try {
    const meta = await fetchJson('/api/meta');
    autoProjectCache = Array.isArray(meta && meta.projects) ? meta.projects : [];
  } catch {
    autoProjectCache = [];
  }
  if (!panelEl) return autoProjectCache;
  const projectSel = panelEl.querySelector('.sup-sub-auto-project');
  const profileSel = panelEl.querySelector('.sup-sub-auto-profile');
  if (projectSel && !projectSel.options.length && autoProjectCache.length) {
    const projOpts = autoProjectCache.map((p) => (
      `<option value="${esc(p.id)}">${esc(p.id)}</option>`
    )).join('') + `<option value="unknown">unknown</option>`;
    projectSel.innerHTML = projOpts;
  }
  if (profileSel && !profileSel.options.length && autoProjectCache.length) {
    profileSel.innerHTML = autoProjectCache.map((p) => (
      `<option value="${esc(p.profile)}">${esc(p.profile)}</option>`
    )).join('');
  }
  return autoProjectCache;
}

async function runAutoSpec() {
  if (!panelEl) return;
  const ta = panelEl.querySelector('.sup-sub-auto-desc');
  const desc = (ta.value || '').trim();
  if (!desc) { setAutoStatus('Description required.', 'err'); return; }
  autoLastDescription = desc;
  setAutoStatus('Generating spec (Haiku 4.5)…', 'loading');
  const genBtn = panelEl.querySelector('.sup-sub-auto-generate');
  const regenBtn = panelEl.querySelector('.sup-sub-auto-regenerate');
  if (genBtn) genBtn.disabled = true;
  if (regenBtn) regenBtn.disabled = true;
  try {
    const res = await fetch(`${SUPERVISOR_API}/api/tasks/auto-spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setAutoStatus(body.error || `auto-spec failed (HTTP ${res.status})`, 'err');
      return;
    }
    setAutoStatus('');
    renderAutoPreview(body.proposed, body.cost_usd);
  } catch (err) {
    setAutoStatus(`auto-spec failed: ${err.message}`, 'err');
  } finally {
    if (genBtn) genBtn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
  }
}

function renderAutoPreview(proposed, costUsd) {
  if (!panelEl) return;
  autoProposal = proposed;
  const preview = panelEl.querySelector('.sup-sub-auto-preview');
  preview.hidden = false;
  panelEl.querySelector('.sup-sub-auto-conf').textContent =
    `confidence: ${proposed.confidence || '—'}`;
  panelEl.querySelector('.sup-sub-auto-rationale').textContent = proposed.rationale || '';
  const projectSel = panelEl.querySelector('.sup-sub-auto-project');
  if (![...projectSel.options].some((o) => o.value === proposed.project)) {
    const opt = document.createElement('option');
    opt.value = proposed.project;
    opt.textContent = `${proposed.project} (new)`;
    projectSel.appendChild(opt);
  }
  projectSel.value = proposed.project;
  const profileSel = panelEl.querySelector('.sup-sub-auto-profile');
  if (![...profileSel.options].some((o) => o.value === proposed.profile)) {
    const opt = document.createElement('option');
    opt.value = proposed.profile;
    opt.textContent = proposed.profile;
    profileSel.appendChild(opt);
  }
  profileSel.value = proposed.profile;
  panelEl.querySelector('.sup-sub-auto-id').value = proposed.task_id || '';
  panelEl.querySelector('.sup-sub-auto-title').value = proposed.title || '';
  panelEl.querySelector('.sup-sub-auto-brief').value = proposed.brief || '';
  const costEl = panelEl.querySelector('.sup-sub-auto-cost');
  costEl.textContent = costUsd != null ? `Haiku call: $${costUsd.toFixed(4)}` : '';
}

async function submitAuto() {
  if (!panelEl) return;
  const id = panelEl.querySelector('.sup-sub-auto-id').value.trim();
  if (!ID_RE.test(id)) { setAutoStatus('Task ID must match [A-Za-z0-9_.-]{1,80}.', 'err'); return; }
  const profile = panelEl.querySelector('.sup-sub-auto-profile').value;
  if (!profile) { setAutoStatus('Pick a profile.', 'err'); return; }
  const title = panelEl.querySelector('.sup-sub-auto-title').value.trim();
  const brief = panelEl.querySelector('.sup-sub-auto-brief').value;
  if (!brief.trim()) { setAutoStatus('Brief cannot be empty.', 'err'); return; }

  const payload = {
    profile,
    supervisorRoot,
    id,
    title: title || id,
    briefInline: brief,
  };
  const submitBtn = panelEl.querySelector('.sup-sub-auto-submit');
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = 'Submitting…';
  setAutoStatus('Submitting…', 'loading');
  try {
    const res = await ipcRenderer.invoke(SUP.SUPERVISOR_SUBMIT_TASK, payload);
    if (res && res.ok) {
      close();
    } else {
      setAutoStatus((res && res.error) || 'Submit failed.', 'err');
    }
  } catch (err) {
    setAutoStatus(`IPC error: ${err.message}`, 'err');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
}

function rebindReuseRows() {
  panelEl.querySelectorAll('.sup-sub-reuse-row').forEach((row) => {
    row.addEventListener('click', async () => {
      pickedBriefRel = row.dataset.rel;
      pickedBriefLabel = row.dataset.label;
      panelEl.querySelector('.sup-sub-reuse-picked').textContent = pickedBriefLabel;
      panelEl.querySelectorAll('.sup-sub-reuse-row').forEach((r) => r.classList.remove('picked'));
      row.classList.add('picked');
      setError('');
      await loadPickedBriefIntoEditor();
    });
  });
}

async function loadPickedBriefIntoEditor() {
  if (!panelEl) return;
  const ta = panelEl.querySelector('.sup-sub-reuse-brief');
  if (!ta) return;
  if (!pickedBriefRel) {
    ta.value = '';
    ta.disabled = true;
    pickedBriefOriginal = '';
    return;
  }
  ta.disabled = true;
  ta.value = 'loading…';
  try {
    const res = await ipcRenderer.invoke(SUP.SUPERVISOR_READ_BRIEF, {
      relPath: pickedBriefRel,
      supervisorRoot,
    });
    if (res && res.ok) {
      // Phase P — enrich the loaded brief with the original task's profile +
      // deliverables. The user re-running a similar task gets the prior outputs
      // surfaced as @-references at the top of the brief so the worker reads
      // them first. This runs best-effort — if the lookup fails we still load
      // the raw brief content unchanged.
      const enrichment = await fetchReuseEnrichment(pickedBriefRel);
      let body = res.content || '';
      if (enrichment && enrichment.refsBlock) {
        body = enrichment.refsBlock + '\n\n' + body;
      }
      pickedBriefOriginal = body;
      ta.value = body;
      ta.disabled = false;
      if (enrichment && enrichment.profilePath) {
        // Pre-select the original profile in the shared dropdown above the pane.
        const profileSel = panelEl.querySelector('.sup-sub-profile');
        if (profileSel) {
          if (![...profileSel.options].some((o) => o.value === enrichment.profilePath)) {
            const opt = document.createElement('option');
            opt.value = enrichment.profilePath;
            opt.textContent = enrichment.profilePath;
            profileSel.appendChild(opt);
          }
          profileSel.value = enrichment.profilePath;
        }
      }
    } else {
      pickedBriefOriginal = '';
      ta.value = '';
      ta.disabled = true;
      setError((res && res.error) || 'failed to load brief');
    }
  } catch (err) {
    pickedBriefOriginal = '';
    ta.value = '';
    ta.disabled = true;
    setError(`IPC error: ${err.message}`);
  }
}

async function fetchReuseEnrichment(briefRel) {
  // Walk /api/workspace's done column looking for the task whose `brief`
  // matches the brief the user just picked. Pull its profile + deliverables
  // and synthesise a `## Reference materials` block of @-paths.
  if (!briefRel) return null;
  let workspace;
  try {
    workspace = await fetchJson('/api/workspace');
  } catch {
    return null;
  }
  const done = (workspace && workspace.columns && workspace.columns.done) || [];
  const match = done.find((t) => t && t.brief && t.brief === briefRel);
  if (!match) return null;
  const root = supervisorRoot || '';
  const abs = (rel) => (rel && rel.startsWith('/') ? rel : (root ? path.join(root, rel) : rel));
  const lines = [];
  lines.push('## Reference materials');
  lines.push('');
  lines.push('Source brief: @' + abs(briefRel));
  if (match.profile) lines.push('Source profile: @' + abs(match.profile));
  const deliverables = Array.isArray(match.deliverables) ? match.deliverables : [];
  if (deliverables.length) {
    lines.push('Source outputs:');
    for (const d of deliverables) lines.push('- @' + abs(d));
  }
  return { refsBlock: lines.join('\n'), profilePath: match.profile || '' };
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
    let briefPath = pickedBriefRel;
    // Phase K: if the textarea was edited and the user opted to save, write
    // the new content to prompts/inline/<id>.md and submit that path. Else
    // submit the original picked path verbatim.
    const ta = panelEl.querySelector('.sup-sub-reuse-brief');
    const saveChk = panelEl.querySelector('.sup-sub-reuse-save');
    const edited = ta && saveChk && saveChk.checked
      && (ta.value || '') !== pickedBriefOriginal;
    if (edited) {
      if (!supervisorRoot) { setError('supervisorRoot unresolved; cannot save edited brief'); return; }
      const relPath = `prompts/inline/${id}.md`;
      const writeRes = await ipcRenderer.invoke(SUP.SUPERVISOR_WRITE_BRIEF, {
        relPath, content: ta.value, supervisorRoot,
      });
      if (!writeRes || !writeRes.ok) {
        setError((writeRes && writeRes.error) || 'failed to save edited brief');
        return;
      }
      briefPath = relPath;
    }
    payload = { ...payload, id, title: title || pickedBriefLabel || id, brief: briefPath };
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
  pickedBriefOriginal = '';
  autoProposal = null;
  autoLastDescription = '';
}

function toggle() {
  if (panelEl && panelEl.isConnected) close();
  else open();
}

function isOpen() {
  return !!(panelEl && panelEl.isConnected);
}

module.exports = { toggle, open, close, isOpen };
