/**
 * Frame Server listens on a Unix socket (server-hardening S8).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fsock-'));
process.env.FRAME_SERVER_HOME = HOME;
const srv = require('../src/server/index.js');

test('S8: by default the server listens on <home>/server.sock, mode 0600, and names it', async () => {
  assert.equal(srv.parseArgs([]).port, null, 'no TCP port unless asked');
  const server = http.createServer();
  const where = await srv.listen(server, { home: HOME, port: null, host: '127.0.0.1' });
  try {
    assert.deepEqual(where, { socket: path.join(HOME, 'server.sock') });
    assert.equal(fs.statSync(where.socket).mode & 0o777, 0o600);
    assert.equal(server.address(), where.socket, 'not a TCP address');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S8: a live server on the socket is never displaced; a stale socket file is replaced', async () => {
  const sock = path.join(HOME, 'server.sock');
  const live = net.createServer().listen(sock);
  await new Promise((r) => live.once('listening', r));
  try {
    await assert.rejects(srv.prepareSocket(sock), /already running/);
  } finally {
    await new Promise((r) => live.close(r));
  }
  fs.writeFileSync(sock, ''); // left behind by a crash
  await srv.prepareSocket(sock);
  assert.equal(fs.existsSync(sock), false);
});

test('S8: --port still opts into TCP', async () => {
  assert.equal(srv.parseArgs(['--port', '0']).port, 0);
  const server = http.createServer();
  const where = await srv.listen(server, { home: HOME, port: 0, host: '127.0.0.1' });
  try {
    assert.ok(Number.isInteger(where.port) && where.port > 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
