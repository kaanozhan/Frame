/**
 * Initial-scan notices (STR-01 T11): FRAME_PROJECT_INITIALIZED results reach
 * the existing notice tray with the project name and the repair command. A
 * completed empty inventory is reported as empty, never as a failure; a
 * complete scan and a preserved existing map say nothing.
 *
 * Electron's ipcRenderer and the tray are stubbed — no DOM harness.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const listeners = new Map();
const pushed = [];
const STUBS = {
  electron: { ipcRenderer: { on: (channel, fn) => listeners.set(channel, fn) } },
  './statusBar/noticeTray': { push: (notice) => pushed.push(notice) }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

const { IPC } = require('../src/shared/ipcChannels');
const healthNotice = require('../src/renderer/healthNotice');

healthNotice.init();

beforeEach(() => {
  pushed.length = 0;
});

const REPAIR = 'node .frame/bin/update-structure.js --full';

function initialized(initialScan, extra = {}) {
  listeners.get(IPC.FRAME_PROJECT_INITIALIZED)({}, {
    projectPath: '/work/comeety',
    success: true,
    config: { name: 'CoMeety', _structureBootstrap: { copied: [], hook: null, initialScan } },
    ...extra
  });
}

test('a failed scan is an error that names the project and the repair command', () => {
  initialized({ status: 'error', reason: 'timeout', message: 'Initial scan timed out after 35s', repairCommand: REPAIR });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].severity, 'error');
  assert.equal(pushed[0].source, 'structure');
  assert.match(pushed[0].message, /^CoMeety: Frame is set up, but its file map was not generated \(the scan timed out\)/);
  assert.ok(pushed[0].message.endsWith(REPAIR));
});

test('tooling that could not be installed is reported, not swallowed', () => {
  initialized({ status: 'error', reason: 'tooling-unavailable', message: 'STRUCTURE tooling could not be installed: structure-state.js', repairCommand: REPAIR });
  assert.equal(pushed[0].severity, 'error');
  assert.match(pushed[0].message, /structure-state\.js/);
});

test('partial coverage is a warning with its reasons', () => {
  initialized({ status: 'partial', coverage: { coverage: 'partial', reasons: ['limit-maxFiles', 'unreadable'] }, repairCommand: REPAIR });
  assert.equal(pushed[0].severity, 'warning');
  assert.match(pushed[0].message, /CoMeety: the file map covers only part of the project \(limit-maxFiles, unreadable\)/);
  assert.match(pushed[0].message, /--full$/);
});

test('extraction failures on a complete inventory are a warning too', () => {
  initialized({ status: 'partial', coverage: { coverage: 'complete', reasons: [] }, extraction: { coverage: 'partial' } });
  assert.equal(pushed[0].severity, 'warning');
  assert.match(pushed[0].message, /basic metadata only/);
});

test('a completed empty inventory is reported as empty, not as a failure', () => {
  initialized({ status: 'ok', empty: true, state: 'complete' });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].severity, 'info');
  assert.match(pushed[0].message, /no files yet/);
});

test('a rebuild that preserved the previous map says where', () => {
  initialized({ status: 'ok', empty: false, recoveryPaths: ['.frame/runtime/structure/recovery/ab.json'] });
  assert.equal(pushed[0].severity, 'info');
  assert.match(pushed[0].message, /recovery/);
});

test('a complete scan, a preserved existing map and a failed init stay quiet', () => {
  initialized({ status: 'ok', empty: false });
  initialized({ status: 'skipped-existing', verified: false });
  initialized({ status: 'error' }, { success: false });
  listeners.get(IPC.FRAME_PROJECT_INITIALIZED)({}, { projectPath: '/x', success: true, config: { name: 'x', _structureBootstrap: null } });
  assert.deepEqual(pushed, []);
});

test('the project falls back to the folder name when config has none', () => {
  listeners.get(IPC.FRAME_PROJECT_INITIALIZED)({}, {
    projectPath: '/work/shop-api',
    success: true,
    config: { _structureBootstrap: { initialScan: { status: 'error', message: 'boom' } } }
  });
  assert.match(pushed[0].message, /^shop-api: /);
});

test('existing notices keep their behavior', () => {
  listeners.get(IPC.STATE_FILE_RECOVERED)({}, { file: 'workspaces.json' });
  listeners.get(IPC.MAIN_PROCESS_ERROR)({}, { severity: 'warning', source: 'git', message: 'git missing' });
  assert.deepEqual(pushed, [
    { severity: 'warning', source: 'state-file', message: 'workspaces.json was corrupt and has been restored from its backup.' },
    { severity: 'warning', source: 'git', message: 'git missing' }
  ]);
});
