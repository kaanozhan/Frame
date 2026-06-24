// Supervisor project tree — Phase B + Phase M.
//
// Left rail listing every project the supervisor knows about: Frame
// workspaces unioned with supervisor profiles unioned with memory
// namespaces (see src/main/supervisor-bridge/index.js#listWorkspaceProjects).
// For each project, three lazy children:
//   queue/ — /api/workspace filtered by substring match on title/id/profile/
//            brief vs the project name (workspace tasks don't carry a
//            project_id field, so we mirror the loose-match the PWA's
//            project filter already does at supervisor/mobile/index.html:990).
//            Clicking a queue row scrolls + flashes the matching card in
//            the kanban via the onScrollToTask callback.
//   docs/  — SUPERVISOR_LIST_PROJECT_DOCS({project_id: name, project_path}).
//            Lists develop/*.md + ~/memory/<name>/**/*.md.
//   specs/ — SUPERVISOR_LIST_PROJECT_SPECS({project_path}). Lists
//            .frame/specs/<slug>/{spec,plan,tasks}.md — scanned from the
//            filesystem since no supervisor API exposes this. Skipped for
//            projects that have no path (memory/profile-only entries).
//
// Phase M: openFile() now accepts any text-ish file extension and falls back
// to shell.openPath() so a click never silently no-ops. Tree projects also
// surface a small ✓ chip when the project is opened in Frame so the user can
// tell which entries have full filesystem context vs which only carry a
// supervisor profile or memory namespace.

const path = require('path');
const { ipcRenderer, shell } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');
const projectFilter = require('./projectFilter');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Phase N: canonical slug for the dedup pass below. Mirrors the main-side
// canonicalSlug in supervisor-bridge/index.js so two entries that came in
// with different surface spellings of the same project ("kitli kids" vs
// "kitli-kids") collapse into one row.
function canonicalSlug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Phase N: belt-and-braces dedup. The main-side listWorkspaceProjects already
 * merges by canonical slug, so most builds receive a clean list — but if any
 * caller (a future source, a stale handler) hands us two rows for the same
 * logical project we collapse them here so the UI never shows duplicates.
 * Collision resolution mirrors the main-side rule: supervisor-profile id
 * wins as canonical id; Frame-workspace name wins as display label; path is
 * carried over from whichever source had it.
 */
function dedupBySlug(projects) {
  const byKey = new Map();
  for (const p of projects) {
    const key = canonicalSlug(p.id || p.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...p });
      continue;
    }
    if (!existing.path && p.path) existing.path = p.path;
    if (p.isFrameProject) existing.isFrameProject = true;
    const sources = Array.isArray(existing.sources) ? existing.sources.slice() : [];
    for (const s of (p.sources || [])) {
      if (!sources.includes(s)) sources.push(s);
    }
    existing.sources = sources;
    const incomingSources = p.sources || [];
    if (incomingSources.includes('supervisor-profile') && p.id) {
      existing.id = p.id;
    }
    if (incomingSources.includes('frame-workspace') && p.name) {
      existing.name = p.name;
    }
    if (!existing.id) existing.id = p.id || key;
  }
  const out = Array.from(byKey.values());
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Frame's editor reads via fs.readFileSync(path, 'utf8') (src/main/fileEditor.js:24)
// — any text-ish extension renders inline; markdown gets the marked-preview
// path. Code-ish extensions are forwarded to the OS via shell.openPath so the
// user lands in their default editor (VS Code, etc) instead of a silent no-op.
const EDITOR_EXTS = new Set([
  '.md', '.markdown', '.html', '.htm', '.txt', '.json', '.yaml', '.yml',
  '.toml', '.ini', '.css', '.scss', '.sass', '.less', '.xml', '.svg',
  '.gql', '.graphql',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.lua', '.r', '.scala', '.kt',
  '.swift', '.dart', '.vue', '.svelte', '.astro',
  '.sh', '.bash', '.zsh', '.fish', '.sql', '.env',
]);

function openFile(absPath) {
  if (!absPath) return;
  const ext = path.extname(absPath).toLowerCase();
  if (EDITOR_EXTS.has(ext) || ext === '') {
    try {
      const editor = require('../editor');
      editor.openFile(absPath, 'supervisor');
      return;
    } catch (err) {
      console.warn('[supervisor] editor.openFile failed; falling back to shell:', err);
    }
  }
  // Unknown / binary extension — defer to the OS so we never silently no-op.
  try { shell.openPath(absPath); }
  catch (err) { console.warn('[supervisor] shell.openPath failed:', err); }
}

/**
 * Heuristic project-match: case-insensitive substring against title/id/
 * profile/brief. Mirrors the PWA's project filter — loose, but the only
 * option since the workspace payload has no project_id field.
 */
function taskMatchesProject(task, projectName) {
  if (!projectName) return false;
  const n = String(projectName).toLowerCase();
  if (!n) return false;
  return (
    (task.id || '').toLowerCase().includes(n) ||
    (task.title || '').toLowerCase().includes(n) ||
    (task.profile || '').toLowerCase().includes(n) ||
    (task.brief || '').toLowerCase().includes(n)
  );
}

function flatTasks(workspace) {
  const cols = (workspace && workspace.columns) || {};
  return [
    ...(cols.pending || []),
    ...(cols.active || []),
    ...(cols.awaiting || []),
    ...(cols.done || []),
  ];
}

function create(root, opts = {}) {
  let alive = true;
  const onScrollToTask = opts.onScrollToTask || (() => {});
  // Phase I: emit a selection event whenever the user clicks a project row so
  // the Profile tab can refocus on that project.
  const onSelectProject = opts.onSelectProject || (() => {});
  let selectedRowEl = null;
  let selectedProject = null;
  // Phase M: supervisorRoot is plumbed in so the main-side merge can include
  // <root>/profiles/*.yaml in the project list. The kanban resolves it on its
  // first poll and pushes it via setSupervisorRoot(); the initial load runs
  // without it and re-runs once the root lands.
  let supervisorRoot = opts.supervisorRoot || null;
  // Phase M: dim project rows that don't match the global filter. We
  // intentionally dim instead of hide so the user still sees the full list
  // and can switch with one click.
  let unsubFilter = null;
  let projectRowsByName = new Map();

  root.innerHTML = '<div class="sup-tree-empty">Loading projects…</div>';

  function applyFilterDimming(name) {
    projectRowsByName.forEach((rowEl, projectName) => {
      const dim = !!name && name !== projectName;
      rowEl.classList.toggle('dimmed', dim);
    });
  }

  function makeGroupNode(label, loader, renderChildren) {
    const wrap = document.createElement('div');
    wrap.className = 'sup-tree-node';
    wrap.innerHTML = `
      <div class="sup-tree-row group">
        <span class="sup-chev">▸</span>
        <span class="sup-label">${esc(label)}</span>
      </div>
      <div class="sup-tree-children"></div>
    `;
    const rowEl = wrap.querySelector('.sup-tree-row');
    const childrenEl = wrap.querySelector('.sup-tree-children');
    let loaded = false;
    rowEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const expanded = wrap.classList.toggle('expanded');
      rowEl.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
      if (expanded && !loaded) {
        loaded = true;
        childrenEl.innerHTML = '<div class="sup-tree-loading">loading…</div>';
        try {
          const data = await loader();
          if (!alive) return;
          childrenEl.innerHTML = '';
          renderChildren(childrenEl, data);
        } catch (err) {
          childrenEl.innerHTML = `<div class="sup-tree-loading">error: ${esc(err.message || err)}</div>`;
        }
      }
    });
    return wrap;
  }

  function renderQueueChildren(childrenEl, tasks) {
    if (!tasks.length) {
      childrenEl.innerHTML = '<div class="sup-tree-loading">no matching tasks</div>';
      return;
    }
    tasks.slice(0, 50).forEach((t) => {
      const row = document.createElement('div');
      row.className = 'sup-tree-row leaf';
      row.title = `${t.id} — ${t.status || ''}`;
      row.innerHTML = `
        <span class="sup-label">${esc((t.title || t.id || '').slice(0, 48))}</span>
        <span class="sup-meta-chip">${esc(t.status || '')}</span>
      `;
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onScrollToTask(t.id);
      });
      childrenEl.appendChild(row);
    });
  }

  function renderDocsChildren(childrenEl, docs) {
    if (!docs.length) {
      childrenEl.innerHTML = '<div class="sup-tree-loading">no docs</div>';
      return;
    }
    docs.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'sup-tree-row leaf';
      row.title = d.path;
      row.innerHTML = `<span class="sup-label">${esc(d.label)}</span>`;
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openFile(d.path);
      });
      childrenEl.appendChild(row);
    });
  }

  function renderSpecsChildren(childrenEl, specs) {
    if (!specs.length) {
      childrenEl.innerHTML = '<div class="sup-tree-loading">no specs</div>';
      return;
    }
    specs.forEach((s) => {
      const slugWrap = document.createElement('div');
      slugWrap.className = 'sup-tree-node';
      const phaseChip = s.phase ? `<span class="sup-meta-chip" title="${esc(s.phase)}">${esc(s.phase.slice(0, 18))}</span>` : '';
      slugWrap.innerHTML = `
        <div class="sup-tree-row group">
          <span class="sup-chev">▸</span>
          <span class="sup-label">${esc(s.slug)}</span>
          ${phaseChip}
        </div>
        <div class="sup-tree-children"></div>
      `;
      const slugRow = slugWrap.querySelector('.sup-tree-row');
      const slugKids = slugWrap.querySelector('.sup-tree-children');
      slugRow.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const expanded = slugWrap.classList.toggle('expanded');
        slugRow.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
        if (expanded && !slugKids.children.length) {
          s.files.forEach((f) => {
            const r = document.createElement('div');
            r.className = 'sup-tree-row leaf';
            r.title = f.path;
            r.innerHTML = `<span class="sup-label">${esc(f.label)}</span>`;
            r.addEventListener('click', (e2) => {
              e2.stopPropagation();
              openFile(f.path);
            });
            slugKids.appendChild(r);
          });
        }
      });
      childrenEl.appendChild(slugWrap);
    });
  }

  function buildProjectNode(p) {
    const node = document.createElement('div');
    node.className = 'sup-tree-node';
    // Phase M: badge entries that are open in Frame so the user can tell
    // which projects have full filesystem context (path + specs) vs which
    // are profile-/memory-only (queue + docs work; specs is hidden).
    const frameBadge = p.isFrameProject
      ? '<span class="sup-tree-frame-chip" title="Open in Frame">✓</span>'
      : '';
    node.innerHTML = `
      <div class="sup-tree-row project">
        <span class="sup-chev">▸</span>
        <span class="sup-label">${esc(p.name)}</span>
        ${frameBadge}
      </div>
      <div class="sup-tree-children"></div>
    `;
    const rowEl = node.querySelector('.sup-tree-row');
    const childrenEl = node.querySelector('.sup-tree-children');
    let built = false;
    rowEl.addEventListener('click', () => {
      // Phase I: mark this project as the selected one before toggling
      // expansion. Selection is independent of expand/collapse.
      if (selectedRowEl && selectedRowEl !== rowEl) {
        selectedRowEl.classList.remove('selected');
      }
      rowEl.classList.add('selected');
      selectedRowEl = rowEl;
      if (!selectedProject || selectedProject.name !== p.name) {
        selectedProject = p;
        onSelectProject(p);
      }
      const expanded = node.classList.toggle('expanded');
      rowEl.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
      if (expanded && !built) {
        built = true;

        const queueNode = makeGroupNode(
          'queue',
          async () => {
            const ws = await fetchJson('/api/workspace');
            return flatTasks(ws).filter((t) => taskMatchesProject(t, p.name));
          },
          renderQueueChildren
        );
        const docsNode = makeGroupNode(
          'docs',
          () => ipcRenderer.invoke(SUP.SUPERVISOR_LIST_PROJECT_DOCS, {
            project_id: p.name,
            project_path: p.path || '',
          }),
          renderDocsChildren
        );
        childrenEl.appendChild(queueNode);
        childrenEl.appendChild(docsNode);
        // Specs scan requires a real project_path — skip for memory- or
        // profile-only entries since the IPC would just return an empty list.
        if (p.path) {
          const specsNode = makeGroupNode(
            '.frame/specs',
            () => ipcRenderer.invoke(SUP.SUPERVISOR_LIST_PROJECT_SPECS, {
              project_path: p.path,
            }),
            renderSpecsChildren
          );
          childrenEl.appendChild(specsNode);
        }
      }
    });
    return node;
  }

  async function load() {
    try {
      const raw = await ipcRenderer.invoke(
        SUP.SUPERVISOR_LIST_WORKSPACE_PROJECTS,
        { supervisorRoot: supervisorRoot || undefined }
      );
      if (!alive) return;
      const projects = dedupBySlug(raw || []);
      root.innerHTML = '';
      if (!projects || !projects.length) {
        root.innerHTML = '<div class="sup-tree-empty">No projects found.<br/><small>Add one from the Home board.</small></div>';
        return;
      }
      projectRowsByName = new Map();
      projects.forEach((p) => {
        const node = buildProjectNode(p);
        const rowEl = node.querySelector('.sup-tree-row.project');
        if (rowEl) projectRowsByName.set(p.name, rowEl);
        root.appendChild(node);
      });
      applyFilterDimming(projectFilter.get());
    } catch (err) {
      if (!alive) return;
      root.innerHTML = `<div class="sup-tree-empty">project list unavailable<br/><small>${esc(err.message || err)}</small></div>`;
    }
  }

  function setSupervisorRoot(root_) {
    if (root_ === supervisorRoot) return;
    supervisorRoot = root_ || null;
    // Reload the project list now that we can include supervisor profiles
    // alongside the Frame-workspaces / memory-namespaces sources.
    if (supervisorRoot) load();
  }

  function start() {
    load();
    unsubFilter = projectFilter.subscribe((name) => applyFilterDimming(name));
  }

  function stop() {
    alive = false;
    if (unsubFilter) { unsubFilter(); unsubFilter = null; }
  }

  start();
  return { start, stop, refresh: load, setSupervisorRoot };
}

module.exports = { create, dedupBySlug, canonicalSlug };
