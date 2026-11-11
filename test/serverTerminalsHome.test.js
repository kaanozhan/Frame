/**
 * Frame Server home terminals (server-onboarding T04): a terminal in the
 * user's home folder with no project or workspace on the server, tagged with
 * the desktop project it was opened from. node-pty is stubbed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-home-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });

const spawned = [];
let pid = 5000;
const fakePty = {
  spawn(shell, args, opts) {
    const e = new EventEmitter();
    spawned.push({ shell, cwd: opts && opts.cwd });
    return { pid: ++pid, onData: (fn) => e.on('data', fn), onExit: (fn) => e.on('exit', fn), write() {}, resize() {}, kill() { e.emit('exit', { exitCode: 0 }); } };
  }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node-pty') return fakePty;
  return loadOriginal.call(this, request, ...rest);
};

const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
require('../src/server/terminals').setup({ shim: handle, registerMethods: (m) => Object.assign(methods, m), broadcast() {} });

test('a home terminal opens in the home folder, with no project or workspace on the server', async () => {
  const t = await methods['terminals.create']({ home: true, homeFor: '/Users/me/app', projectPath: '/srv/projects/app', workspaceId: 'w1', cwd: '/srv/elsewhere' });
  assert.equal(spawned[spawned.length - 1].cwd, process.env.HOME, 'cwd is the user\'s home, whatever else was passed');
  const listed = (await methods['terminals.list']({})).find((x) => x.terminalId === t.terminalId);
  assert.equal(listed.home, true);
  assert.equal(listed.homeFor, '/Users/me/app');
  assert.equal(listed.projectPath, null);
  assert.equal(listed.workspaceId, null);
});

test('workspace terminals are listed as before, not home', async () => {
  const t = await methods['terminals.create']({ projectPath: '/srv/projects/app', workspaceId: 'w1', cwd: process.env.HOME });
  const listed = (await methods['terminals.list']({})).find((x) => x.terminalId === t.terminalId);
  assert.equal(listed.home, false);
  assert.equal(listed.homeFor, null);
  assert.equal(listed.workspaceId, 'w1');
});
