/**
 * Frame Server goes quiet when the last desktop leaves (server-hardening T9):
 * the client-gone hook fires once the last client disconnects, and the
 * panels part stops its git watcher and its PR poller.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

process.env.FRAME_SERVER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-idle-'));
const srv = require('../src/server/index.js');

function fakeWs() {
  const ws = new EventEmitter();
  ws.send = () => {};
  ws.close = () => {};
  return ws;
}

test('T9: the client-gone hook fires when the last desktop disconnects, once', () => {
  let gone = 0;
  srv.onLastClientGone(() => { gone += 1; });
  const a = fakeWs();
  const b = fakeWs();
  srv.onConnection(a);
  srv.onConnection(b);
  a.emit('close');
  assert.equal(gone, 0, 'one desktop is still there');
  b.emit('close');
  b.emit('error', new Error('after close'));
  assert.equal(gone, 1);
});

test('T9: idle panels stop the git watcher and the PR poller\'s project', () => {
  const shim = require('../src/server/electronShim');
  const prState = require('../src/main/workspaceGitState');
  const gitStatus = require('../src/main/gitStatusManager');
  const panels = require('../src/server/panels').setup({ shim, registerMethods() {}, broadcast() {} });
  let stopped = 0;
  const realStop = gitStatus.stopWatching;
  gitStatus.stopWatching = () => { stopped += 1; };
  try {
    prState.setWatched('/srv/app');
    assert.equal(prState.watched(), '/srv/app');
    panels.idle();
    assert.equal(prState.watched(), null, 'nothing is polled for nobody');
    assert.equal(stopped, 1, 'the git watcher stopped');
  } finally {
    gitStatus.stopWatching = realStop;
  }
});
