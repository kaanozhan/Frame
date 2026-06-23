// Supervisor bridge (main) — Phase A skeleton + Phase B handlers.
//
// All supervisor-owned main-process modules live under src/main/supervisor-bridge/
// per docs/frame-edit-discipline.md §1.1 (additive new dirs never conflict on
// upstream rebase). The Frame edit is a single supervisor-mod line in
// src/main/index.js that invokes register(ipcMain) from setupAllIPC().

const fs = require('fs');
const os = require('os');
const path = require('path');
const SUP = require('../../shared/supervisor-ipc');
const stateWatcher = require('./stateWatcher');
const tailReader = require('./tailReader');

const DOC_CAP = 100;
const SPEC_CAP = 50;
const FRAME_WORKSPACES_PATH = path.join(os.homedir(), '.frame', 'workspaces.json');

function listProjectDocs({ project_id, project_path }) {
  const out = [];

  // <project_path>/develop/*.md (one level deep)
  if (project_path) {
    try {
      const devDir = path.join(project_path, 'develop');
      if (fs.existsSync(devDir)) {
        for (const name of fs.readdirSync(devDir)) {
          if (out.length >= DOC_CAP) break;
          if (name.endsWith('.md')) {
            out.push({ path: path.join(devDir, name), label: `develop/${name}` });
          }
        }
      }
    } catch (e) {
      // Best-effort: ignore unreadable dirs (broken symlinks etc).
    }
  }

  // ~/memory/<project_id>/**/*.md (recursive, capped)
  if (project_id) {
    try {
      const memRoot = path.join(os.homedir(), 'memory', project_id);
      if (fs.existsSync(memRoot)) {
        const walk = (dir, prefix) => {
          if (out.length >= DOC_CAP) return;
          let names;
          try { names = fs.readdirSync(dir); } catch { return; }
          for (const name of names) {
            if (out.length >= DOC_CAP) return;
            const full = path.join(dir, name);
            let stat;
            try { stat = fs.statSync(full); } catch { continue; }
            if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
            else if (name.endsWith('.md')) {
              out.push({ path: full, label: `memory/${prefix}${name}` });
            }
          }
        };
        walk(memRoot, '');
      }
    } catch (e) {
      // Best-effort
    }
  }

  if (out.length >= DOC_CAP) {
    console.warn(
      `[supervisor-bridge] doc cap of ${DOC_CAP} hit for project="${project_id}"; ` +
      `additional docs not listed`
    );
  }
  return out;
}

/**
 * Read Frame's own workspace projects from ~/.frame/workspaces.json. The
 * supervisor view uses this as its project source: the supervisor's
 * /api/memory/projects endpoint only knows about memory namespaces (no path),
 * and the brief's /api/meta.projects field doesn't exist server-side.
 * Returns [{ name, path, isFrameProject }] for the active workspace, or [].
 */
function listWorkspaceProjects() {
  try {
    if (!fs.existsSync(FRAME_WORKSPACES_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(FRAME_WORKSPACES_PATH, 'utf8'));
    const aw = data.activeWorkspace || 'default';
    const ws = (data.workspaces || {})[aw];
    if (!ws || !Array.isArray(ws.projects)) return [];
    return ws.projects
      .map((p) => ({
        name: p.name || (p.path ? path.basename(p.path) : ''),
        path: p.path || '',
        isFrameProject: !!p.isFrameProject,
      }))
      .filter((p) => p.path);
  } catch (e) {
    console.warn('[supervisor-bridge] failed to read workspaces.json:', e.message);
    return [];
  }
}

/**
 * Scan <project_path>/.frame/specs/ for one level of spec slugs and surface a
 * flat list of clickable markdown files. The brief originally pointed at a
 * (nonexistent) /api/frame-specs/<id> endpoint; reading the filesystem from
 * main is the local equivalent and keeps the channel architecture parallel
 * to SUPERVISOR_LIST_PROJECT_DOCS.
 *
 * For each slug dir we list spec.md → plan.md → tasks.md if present, and try
 * to read a one-line "phase" hint from the spec.md frontmatter or first
 * heading for display in the tree. Returns:
 *   [{ slug, phase, files: [{ path, label }] }]
 */
function listProjectSpecs({ project_path }) {
  if (!project_path) return [];
  const specsRoot = path.join(project_path, '.frame', 'specs');
  if (!fs.existsSync(specsRoot)) return [];
  let slugs;
  try { slugs = fs.readdirSync(specsRoot); } catch { return []; }
  const out = [];
  for (const slug of slugs) {
    if (out.length >= SPEC_CAP) break;
    const slugDir = path.join(specsRoot, slug);
    let stat;
    try { stat = fs.statSync(slugDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const files = [];
    for (const fname of ['spec.md', 'plan.md', 'tasks.md']) {
      const fpath = path.join(slugDir, fname);
      if (fs.existsSync(fpath)) files.push({ path: fpath, label: fname });
    }
    if (!files.length) continue;
    // Best-effort phase hint: first heading of spec.md if present.
    let phase = '';
    const specPath = path.join(slugDir, 'spec.md');
    if (fs.existsSync(specPath)) {
      try {
        const head = fs.readFileSync(specPath, 'utf8').slice(0, 1024);
        const m = head.match(/^#+\s+(.+)$/m);
        if (m) phase = m[1].trim().slice(0, 80);
      } catch { /* ignore */ }
    }
    out.push({ slug, phase, files });
  }
  return out;
}

function register(ipcMain) {
  // Round-trip sanity check used by the renderer's Supervisor section on first
  // open. Future phases register stateWatcher / tailReader / taskSubmitter
  // handlers here.
  ipcMain.handle(SUP.SUPERVISOR_PING, async () => {
    return { ok: true, ts: Date.now(), phase: 'B-readonly' };
  });

  // Phase B: enumerate markdown docs for a project across the supervisor's
  // own develop/ folder and the user's ~/memory/<project_id>/ namespace.
  ipcMain.handle(SUP.SUPERVISOR_LIST_PROJECT_DOCS, async (_evt, payload) => {
    return listProjectDocs(payload || {});
  });

  // Phase B: list .frame/specs/<slug>/{spec,plan,tasks}.md for a project.
  // No supervisor API endpoint exists for this — we scan the project's
  // own .frame/specs/ directory directly from main.
  ipcMain.handle(SUP.SUPERVISOR_LIST_PROJECT_SPECS, async (_evt, payload) => {
    return listProjectSpecs(payload || {});
  });

  // Phase B: surface Frame's own workspace projects to the supervisor view.
  // The supervisor API only knows about memory namespaces; pairing those
  // with Frame's known projects gives us project_path (which the docs and
  // specs handlers need to do anything useful beyond the memory tree).
  ipcMain.handle(SUP.SUPERVISOR_LIST_WORKSPACE_PROJECTS, async () => {
    return listWorkspaceProjects();
  });

  // Phase C: reactive file-watch driven state pushes + per-task tail logs.
  // Both register their own handlers; the renderer announces supervisorRoot
  // on mount (it has to resolve it from /api/meta first) which kicks off the
  // watcher lazily — see stateWatcher.js for why this is not driven by boot.
  stateWatcher.registerHandlers(ipcMain);
  tailReader.registerHandlers(ipcMain);
}

module.exports = { register, listProjectDocs, listProjectSpecs, listWorkspaceProjects };
