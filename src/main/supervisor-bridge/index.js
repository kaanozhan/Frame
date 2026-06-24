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
const profilesLister = require('./profilesLister');
const taskSubmitter = require('./taskSubmitter');
const notifier = require('./notifier');

const DOC_CAP = 100;
const SPEC_CAP = 50;
const BRIEF_CAP = 200;
// audit.jsonl grows unbounded (one line per orchestration event). For Phase H
// the inspector only renders a single task's events, but we still cap the
// total bytes we'll scan per request — anything beyond the cap is older than
// what the inspector usefully surfaces, and an unbounded scan would block the
// main process on a long-running supervisor.
const AUDIT_SCAN_CAP_BYTES = 8 * 1024 * 1024;
const AUDIT_EVENTS_PER_TASK_CAP = 500;
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

/**
 * Scan <supervisor_root>/prompts/follow-ups/*.md and surface them as
 * brief candidates for the "Reuse existing brief" submit mode. We return
 * project-relative paths because the monitor's create_task_file resolves
 * non-absolute paths under ROOT and the renderer doesn't need the absolute.
 * Sorted newest-mtime first since users almost always want their most
 * recent brief.
 */
function listBriefs({ supervisor_root }) {
  if (!supervisor_root) return [];
  const dir = path.join(supervisor_root, 'prompts', 'follow-ups');
  if (!fs.existsSync(dir)) return [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (out.length >= BRIEF_CAP) break;
    if (!name.endsWith('.md')) continue;
    const abs = path.join(dir, name);
    let mtime = 0;
    try { mtime = fs.statSync(abs).mtimeMs; } catch { continue; }
    out.push({
      name,
      label: name.replace(/\.md$/, ''),
      path: path.join('prompts', 'follow-ups', name),
      absPath: abs,
      mtime,
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Read run-state/audit.jsonl and return every event whose task_id matches.
 * The supervisor's audit log is append-only JSONL, one event per line; we
 * scan the tail (capped at AUDIT_SCAN_CAP_BYTES) and filter in-process so the
 * renderer never has to parse the whole file. Per-task results are also
 * capped at AUDIT_EVENTS_PER_TASK_CAP (5xx self-revision passes would
 * otherwise flood the inspector).
 */
function readTaskAudit({ taskId, supervisorRoot }) {
  if (!taskId || !supervisorRoot) {
    return { ok: false, error: 'taskId and supervisorRoot required', events: [] };
  }
  const auditPath = path.join(supervisorRoot, 'run-state', 'audit.jsonl');
  if (!fs.existsSync(auditPath)) return { ok: true, events: [] };
  let fd;
  try {
    fd = fs.openSync(auditPath, 'r');
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    const readLen = Math.min(size, AUDIT_SCAN_CAP_BYTES);
    const start = size - readLen;
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    // If we started mid-line (tail read), discard the first partial line.
    if (start > 0 && lines.length) lines.shift();
    const events = [];
    for (const line of lines) {
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt && evt.task_id === taskId) events.push(evt);
    }
    const truncated = events.length > AUDIT_EVENTS_PER_TASK_CAP;
    return {
      ok: true,
      truncated,
      events: truncated ? events.slice(-AUDIT_EVENTS_PER_TASK_CAP) : events,
    };
  } catch (err) {
    return { ok: false, error: err.message, events: [] };
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
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

  // Phase D: profile dropdown + brief picker for the Submit-task composer.
  // Both scans are scoped to supervisor_root which the renderer resolved
  // already (kanban.js does this on mount); we just receive it in the payload.
  ipcMain.handle(SUP.SUPERVISOR_LIST_PROFILES, async (_evt, payload) => {
    return profilesLister.list(payload || {});
  });
  ipcMain.handle(SUP.SUPERVISOR_LIST_BRIEFS, async (_evt, payload) => {
    return listBriefs(payload || {});
  });

  // Phase D: Electron file picker for the "From file" submit mode. We surface
  // it through the bridge so the renderer never reaches for @electron/remote
  // — keeps the renderer-side discipline unchanged.
  ipcMain.handle(SUP.SUPERVISOR_PICK_BRIEF_FILE, async (_evt, payload) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const defaultPath = (payload && payload.defaultPath)
      || path.join(os.homedir(), 'Desktop', 'lemonade-stand');
    try {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        title: 'Pick a brief markdown file',
        defaultPath,
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
      return { ok: true, path: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Phase D: submit-task + daemon control + escalation respond.
  ipcMain.handle(SUP.SUPERVISOR_SUBMIT_TASK, async (_evt, payload) => {
    return taskSubmitter.submit(payload || {});
  });
  ipcMain.handle(SUP.SUPERVISOR_DAEMON_START, async () => {
    return taskSubmitter.startDaemon();
  });
  ipcMain.handle(SUP.SUPERVISOR_DAEMON_STOP, async () => {
    return taskSubmitter.stopDaemon();
  });
  ipcMain.handle(SUP.SUPERVISOR_RESPOND_ESCALATION, async (_evt, payload) => {
    return taskSubmitter.respondEscalation(payload || {});
  });

  // Phase E: OS notifications. The renderer's notifications.js diff-detector
  // sends SUPERVISOR_NOTIFY payloads; notifier surfaces them via Electron's
  // Notification API and forwards click events back as SUPERVISOR_NOTIFY_CLICK.
  notifier.register(ipcMain);

  // Phase K: read a brief file so the submit panel's Reuse mode can show
  // editable content. Accepts either an absolute path (From-file picker)
  // or a relPath under <supervisorRoot> (Reuse picker). 1 MiB cap rules
  // out accidentally loading a giant artifact into the panel.
  ipcMain.handle(SUP.SUPERVISOR_READ_BRIEF, async (_evt, payload) => {
    const p = payload || {};
    let abs = '';
    try {
      if (p.path && path.isAbsolute(p.path)) {
        abs = p.path;
      } else if (p.relPath && p.supervisorRoot) {
        abs = path.resolve(p.supervisorRoot, p.relPath);
        if (!abs.startsWith(path.resolve(p.supervisorRoot) + path.sep)) {
          return { ok: false, error: 'brief path escapes supervisor root' };
        }
      } else {
        return { ok: false, error: 'either path (absolute) or relPath+supervisorRoot required' };
      }
      const stat = fs.statSync(abs);
      if (stat.size > 1024 * 1024) {
        return { ok: false, error: `brief too large (${stat.size} bytes; cap 1 MiB)` };
      }
      const content = fs.readFileSync(abs, 'utf8');
      return { ok: true, path: abs, content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Phase H: stream every audit.jsonl event for a single task to feed the
  // inline task-detail expansion (decisions, critic verdicts, full timeline).
  // See readTaskAudit above for cap behavior.
  ipcMain.handle(SUP.SUPERVISOR_TASK_AUDIT, async (_evt, payload) => {
    return readTaskAudit(payload || {});
  });

  // Phase K: write a brief edited in the Reuse picker. Constrained to
  // <supervisorRoot>/prompts/inline/ so an attacker (or a buggy renderer)
  // can't overwrite arbitrary files. Mirrors taskSubmitter.writeInlineBrief
  // semantics but exposes the path directly to the renderer so the panel
  // can submit it.
  ipcMain.handle(SUP.SUPERVISOR_WRITE_BRIEF, async (_evt, payload) => {
    const p = payload || {};
    if (!p.supervisorRoot) return { ok: false, error: 'supervisorRoot required' };
    if (!p.relPath) return { ok: false, error: 'relPath required' };
    if (typeof p.content !== 'string') return { ok: false, error: 'content must be a string' };
    try {
      const inlineRoot = path.resolve(p.supervisorRoot, 'prompts', 'inline');
      const abs = path.resolve(p.supervisorRoot, p.relPath);
      if (!abs.startsWith(inlineRoot + path.sep)) {
        return { ok: false, error: 'writes are restricted to prompts/inline/' };
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, p.content, 'utf8');
      return { ok: true, path: abs, relPath: p.relPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = {
  register,
  listProjectDocs,
  listProjectSpecs,
  listWorkspaceProjects,
  listBriefs,
  readTaskAudit,
};
