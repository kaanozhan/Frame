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

const DOC_CAP = 100;

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
}

module.exports = { register, listProjectDocs };
