/**
 * Health notices
 *
 * Degraded/recovered states pushed from the main process: crash-guard errors
 * (MAIN_PROCESS_ERROR, with a warning severity for missing git/gh), state
 * files restored from backup (STATE_FILE_RECOVERED), Codex hooks that never
 * ran (CODEX_HOOKS_UNTRUSTED), corrupt tasks.json (TASKS_FILE_ERROR) and an
 * initial STRUCTURE scan that did not fully succeed (FRAME_PROJECT_INITIALIZED
 * — the project is initialized either way; only its map is degraded). It
 * also carries the layout migration's receipt — the one thing here that is
 * news rather than a degraded state, which is what the info severity is for:
 * Frame moved a project's own files without asking, so it says so, and says
 * where the backup is.
 *
 * This module owns the wording. Where it lands is the status bar's notice
 * tray (status-bar-notice-tray spec), which replaced a banner fixed over the
 * app header: the translucent strip let the header's text show through, and
 * it kept only the latest message. The tray keeps every notice, merges
 * repeats and colours its indicator by the worst unread severity.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const noticeTray = require('./statusBar/noticeTray');

function init() {
  ipcRenderer.on(IPC.MAIN_PROCESS_ERROR, (event, payload) => {
    show(
      payload && payload.severity === 'warning' ? 'warning' : 'error',
      (payload && payload.source) || 'main-process',
      payload && payload.message ? payload.message : 'An unexpected error occurred in the main process.'
    );
  });

  ipcRenderer.on(IPC.STATE_FILE_RECOVERED, (event, payload) => {
    const file = payload && payload.file ? payload.file : 'A state file';
    show('warning', 'state-file', `${file} was corrupt and has been restored from its backup.`);
  });

  ipcRenderer.on(IPC.CODEX_HOOKS_UNTRUSTED, () => {
    show('warning', 'codex-hooks', "Frame's Codex hooks are installed but have never run — open Codex and trust them, "
      + 'or its sessions get none of this project\u2019s context.');
  });

  ipcRenderer.on(IPC.FRAME_PROJECT_INITIALIZED, (event, payload) => {
    const notice = describeStructureScan(payload);
    if (notice) show(notice.severity, 'structure', notice.message);
  });

  ipcRenderer.on(IPC.TASKS_FILE_ERROR, (event, payload) => {
    if (payload && payload.recovered) {
      show('warning', 'tasks-file', 'tasks.json was corrupt and has been restored from its backup.');
    } else {
      show('warning', 'tasks-file', 'tasks.json was corrupt — started a fresh file; the broken copy is preserved next to it.');
    }
  });
}

/**
 * The notice for an init's initial STRUCTURE scan, or null when there is
 * nothing to say (a complete scan, a preserved existing map, a failed init).
 * Pure: takes the FRAME_PROJECT_INITIALIZED payload as sent.
 *
 *   error    the scan failed — Frame initialized, the map did not
 *   warning  partial coverage, or files that could not be parsed
 *   info     an empty project (not a failure), or a rebuild that preserved
 *            the previous map under recovery
 */
function describeStructureScan(payload) {
  if (!payload || !payload.success || !payload.config) return null;
  const bootstrap = payload.config._structureBootstrap;
  const scan = bootstrap && bootstrap.initialScan;
  if (!scan) return null;

  const base = String(payload.projectPath || '').split(/[\\/]/).filter(Boolean).pop();
  const project = payload.config.name || base || 'this project';
  const repair = scan.repairCommand || 'node .frame/bin/update-structure.js --full';

  if (scan.status === 'error') {
    const why = scan.reason === 'timeout' ? 'the scan timed out' : (scan.message || 'the scan failed');
    return {
      severity: 'error',
      message: `${project}: Frame is set up, but its file map was not generated (${why}). Rebuild it with: ${repair}`
    };
  }
  if (scan.status === 'partial') {
    const incomplete = scan.coverage && scan.coverage.coverage === 'partial';
    const detail = incomplete
      ? `covers only part of the project (${(scan.coverage.reasons || []).join(', ') || 'incomplete scan'})`
      : 'lists some files with basic metadata only — they could not be parsed';
    return { severity: 'warning', message: `${project}: the file map ${detail}. Rebuild it with: ${repair}` };
  }
  if (scan.status === 'ok' && scan.recoveryPaths && scan.recoveryPaths.length) {
    return { severity: 'info', message: `${project}: the file map was rebuilt; the previous one is preserved in .frame/runtime/structure/recovery/.` };
  }
  if (scan.status === 'ok' && scan.empty) {
    return { severity: 'info', message: `${project}: the file map is empty because the project has no files yet — it fills in as you add them.` };
  }
  return null;
}

function show(severity, source, message) {
  noticeTray.push({ severity, source, message });
}

/**
 * The layout migration's one-liner: the receipt of a move the user never
 * agreed to beforehand, or the reason one was left alone.
 *
 * Takes `migration` from IS_FRAME_PROJECT_RESULT verbatim, and says nothing
 * when there is nothing to say — which is every open of a project that was
 * already on the `.frame/` layout.
 */
function showMigration(migration) {
  if (!migration) return;

  if (migration.blocked === 'unmerged') {
    const files = (migration.unmerged || []).join(', ') || 'a Frame file';
    show('warning', 'migration', `Frame left this project alone: ${files} is in an unresolved merge. Finish the merge and reopen.`);
    return;
  }

  if (!migration.ran) return;

  const moved = (migration.moved || []).length;
  const parts = [`Frame moved ${moved} file${moved === 1 ? '' : 's'} into .frame/`];
  if (migration.backupDir) parts.push(`copies are in ${migration.backupDir}`);

  const symlinks = migration.symlinksRemoved || [];
  if (symlinks.length) {
    // Naming them matters: GEMINI.md has no replacement, so Gemini CLI stops
    // reading Frame's instructions in this project.
    parts.push(`${symlinks.join(' and ')} removed`);
  }
  if (migration.claudeMdRestored) parts.push('your original CLAUDE.md is back');

  let message = `${parts.join(' — ')}.`;
  if (migration.failedAt) {
    message += ` The move stopped at "${migration.failedAt}" — the backup has everything.`;
  }
  const review = (migration.review || []).length;
  if (review) message += ` ${review} need${review === 1 ? 's' : ''} a look — see Activity.`;

  show(migration.failedAt ? 'warning' : 'info', 'migration', message);
}

module.exports = { init, showMigration, describeStructureScan };
