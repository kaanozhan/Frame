#!/usr/bin/env node
/**
 * Frame Server — runs a project's server workspaces on the user's own
 * machine (server-workspaces spec).
 *
 *   node src/server/index.js [--port 47821] [--bind 127.0.0.1]
 *
 * It listens on localhost only (unless --bind says otherwise, with a
 * warning), writes `~/.frame-server/connection.json` (0600: port, token,
 * protocol, version, pid) for the desktop to read over SSH, and accepts a
 * WebSocket only with the Bearer token and no browser Origin. After both
 * sides say hello (same protocol), the desktop sends requests
 * (`namespace.method`) and receives events. Access control is the user's
 * SSH; see src/server/README.md.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const pkg = require('../../package.json');
const shim = require('./electronShim');

// An installed package carries its exact version (a dev build's is
// `<version>-dev+<sha>`) in VERSION next to app/; a checkout uses package.json.
const FRAME_VERSION = (() => {
  try {
    const v = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'VERSION'), 'utf8').trim();
    if (v) return v;
  } catch (_) { /* not an installed package */ }
  return pkg.version;
})();

const HOME = process.env.FRAME_SERVER_HOME || path.join(os.homedir(), '.frame-server');
shim.install({ home: HOME, version: FRAME_VERSION });

const { WebSocketServer } = require('ws');
const P = require('../shared/serverProtocol');
const { generateToken, checkUpgrade, bindRule, DESKTOP_ORIGIN } = require('../shared/serverSecurity');

const net = require('net');

// The server listens on a Unix socket in its home (0700 dir, 0600 socket):
// no TCP port another local user could squat while the server is down to
// receive the desktop's token, and no port clash between two users on one
// host (server-hardening S8). `--port N` opts into TCP (manual runs, tests).
const SOCKET_NAME = 'server.sock';
const MAX_SOCKET_PATH = 100; // sun_path is 104 (macOS) / 108 (Linux) bytes

function parseArgs(argv) {
  const out = { port: null, bind: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--bind') out.bind = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (out.port !== null && (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535)) throw new Error('--port must be 0–65535');
  return out;
}

/**
 * Make `sockPath` free to listen on: a live server answering there is an
 * error (never two servers for one home); a stale file is removed.
 */
function prepareSocket(sockPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(sockPath)) return resolve();
    const probe = net.connect(sockPath);
    probe.once('connect', () => {
      probe.destroy();
      reject(new Error(`another Frame Server is already running for this home (${sockPath})`));
    });
    probe.once('error', () => {
      try { fs.rmSync(sockPath, { force: true }); } catch (_) { /* gone */ }
      resolve();
    });
  });
}

/**
 * Listen on the home's socket (umask 077, then chmod 0600), or on TCP when
 * `--port` was given or the socket path is too long for sun_path.
 * Resolves with the connection.json fields: `{ socket }` or `{ port }`.
 */
async function listen(server, { home, port, host }) {
  const sockPath = path.join(home, SOCKET_NAME);
  if (port === null && sockPath.length <= MAX_SOCKET_PATH) {
    await prepareSocket(sockPath);
    const old = process.umask(0o077);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(sockPath, () => { server.removeListener('error', reject); resolve(); }); });
    } finally {
      process.umask(old);
    }
    fs.chmodSync(sockPath, 0o600);
    return { socket: sockPath };
  }
  if (port === null) console.warn(`[frame-server] WARNING: ${sockPath} is too long for a socket; listening on a random localhost port instead.`);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port || 0, host, () => { server.removeListener('error', reject); resolve(); }); });
  return { port: server.address().port };
}

/** The install's token: created once (0600) and kept across restarts. */
function loadToken() {
  const file = path.join(HOME, 'token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch (_) { /* first run */ }
  const t = generateToken();
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return t;
}

function writeConnectionFile(info) {
  const file = path.join(HOME, 'connection.json');
  fs.writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

// ─── Methods and events ───────────────────────────────────────

const methods = new Map();
const clients = new Set();

/** Register request handlers: `{ 'terminals.create': async (params, client) => result }`. */
function registerMethods(table) {
  for (const [name, fn] of Object.entries(table)) methods.set(name, fn);
}

/** Send an event to every connected desktop. */
function broadcast(channel, payload) {
  const text = P.encode(P.event(channel, payload));
  for (const c of clients) {
    if (c.ready && c.ws.readyState === 1) c.ws.send(text);
  }
}

registerMethods({
  'server.ping': async () => ({ pong: true, frameVersion: FRAME_VERSION, platform: process.platform, arch: process.arch })
});

async function handleRequest(client, msg) {
  const fn = methods.get(msg.method);
  if (!fn) return client.ws.send(P.encode(P.failure(msg.id, `Unknown method ${msg.method}`)));
  try {
    const result = await fn(msg.params || {}, client);
    client.ws.send(P.encode(P.reply(msg.id, result)));
  } catch (err) {
    client.ws.send(P.encode(P.failure(msg.id, (err && err.message) || String(err))));
  }
}

// Called when the last desktop disconnects (server-hardening T9): the parts
// stop work that only a watching desktop needs.
const lastGoneHooks = [];
function onLastClientGone(fn) {
  lastGoneHooks.push(fn);
}

function dropClient(client) {
  if (!clients.delete(client)) return;
  if (clients.size > 0) return;
  for (const fn of lastGoneHooks) {
    try { fn(); } catch (err) { console.error(`[frame-server] idle hook failed: ${err.message}`); }
  }
}

function onConnection(ws) {
  const client = { ws, ready: false };
  clients.add(client);
  ws.send(P.encode(P.hello(FRAME_VERSION)));
  ws.on('message', (data) => {
    const decoded = P.decode(data.toString());
    if (!decoded.ok) return ws.close(1002, decoded.error.slice(0, 120));
    const msg = decoded.msg;
    if (!client.ready) {
      const check = P.checkHello(msg, FRAME_VERSION);
      if (!check.ok) return ws.close(1002, check.error.slice(0, 120));
      client.ready = true;
      return undefined;
    }
    if (msg.type === 'req') return handleRequest(client, msg);
    return undefined;
  });
  ws.on('close', () => dropClient(client));
  ws.on('error', () => dropClient(client));
}

// ─── Start ────────────────────────────────────────────────────

function start(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node src/server/index.js [--port N] [--bind 127.0.0.1]   (default: the Unix socket ~/.frame-server/server.sock)');
    return null;
  }
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.chmodSync(HOME, 0o700); // also when it already existed (S8)
  const token = loadToken();
  const bind = bindRule(args.bind);
  if (bind.warning) console.warn(`[frame-server] WARNING: ${bind.warning}`);

  const parts = [
    require('./terminals').setup({ shim, registerMethods, broadcast }),
    require('./projects').setup({ shim, registerMethods, broadcast }),
    require('./panels').setup({ shim, registerMethods, broadcast }),
    require('./doctor').setup({ shim, registerMethods, broadcast })
  ];
  onLastClientGone(() => {
    for (const part of parts) if (part && typeof part.idle === 'function') part.idle();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  wss.on('connection', onConnection);
  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Frame Server speaks WebSocket only.\n');
  });
  server.on('upgrade', (req, socket, head) => {
    const verdict = checkUpgrade(req.headers, token);
    if (!verdict.ok) {
      socket.write(`HTTP/1.1 ${verdict.status} ${verdict.status === 403 ? 'Forbidden' : 'Unauthorized'}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  listen(server, { home: HOME, port: args.port, host: bind.host }).then((where) => {
    const file = writeConnectionFile({ ...where, token, protocol: P.PROTOCOL_VERSION, frameVersion: FRAME_VERSION, pid: process.pid, origin: DESKTOP_ORIGIN });
    console.log(`[frame-server] Frame ${FRAME_VERSION} listening on ${where.socket || `${bind.host}:${where.port}`} (protocol ${P.PROTOCOL_VERSION}); connection details in ${file}`);
    server.on('error', (err) => console.error(`[frame-server] ${err.message}`));
  }).catch((err) => {
    console.error(`[frame-server] ${err.message}`);
    process.exit(1);
  });

  const stop = () => {
    try { fs.rmSync(path.join(HOME, 'connection.json'), { force: true }); } catch (_) { /* best effort */ }
    try { fs.rmSync(path.join(HOME, SOCKET_NAME), { force: true }); } catch (_) { /* best effort */ }
    for (const c of clients) c.ws.close(1001, 'server stopping');
    for (const part of parts) {
      try { part.stop(); } catch (err) { console.error(`[frame-server] stop failed: ${err.message}`); }
    }
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return { server, wss };
}

module.exports = { start, registerMethods, broadcast, parseArgs, prepareSocket, listen, onConnection, onLastClientGone, HOME };

if (require.main === module) start();
