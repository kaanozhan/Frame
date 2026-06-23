// Supervisor bridge (main) — Phase A skeleton.
//
// All supervisor-owned main-process modules live under src/main/supervisor-bridge/
// per docs/frame-edit-discipline.md §1.1 (additive new dirs never conflict on
// upstream rebase). The Frame edit is a single supervisor-mod line in
// src/main/index.js that invokes register(ipcMain) from setupAllIPC().

const SUP = require('../../shared/supervisor-ipc');

function register(ipcMain) {
  // Round-trip sanity check used by the renderer's Supervisor section on first
  // open. Future phases register stateWatcher / tailReader / taskSubmitter
  // handlers here.
  ipcMain.handle(SUP.SUPERVISOR_PING, async () => {
    return { ok: true, ts: Date.now(), phase: 'A-skeleton' };
  });
}

module.exports = { register };
