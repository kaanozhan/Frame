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

const HOME = process.env.FRAME_SERVER_HOME || path.join(os.homedir(), '.frame-server');
shim.install({ home: HOME, version: pkg.version });

const { WebSocketServer } = require('ws');
const P = require('../shared/serverProtocol');
const { generateToken, checkUpgrade, bindRule, DESKTOP_ORIGIN } = require('../shared/serverSecurity');

const DEFAULT_PORT = 47821;

function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, bind: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--bind') out.bind = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error('--port must be 0–65535');
  return out;
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
  'server.ping': async () => ({ pong: true, frameVersion: pkg.version, platform: process.platform, arch: process.arch })
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

function onConnection(ws) {
  const client = { ws, ready: false };
  clients.add(client);
  ws.send(P.encode(P.hello(pkg.version)));
  ws.on('message', (data) => {
    const decoded = P.decode(data.toString());
    if (!decoded.ok) return ws.close(1002, decoded.error.slice(0, 120));
    const msg = decoded.msg;
    if (!client.ready) {
      const check = P.checkHello(msg, pkg.version);
      if (!check.ok) return ws.close(1002, check.error.slice(0, 120));
      client.ready = true;
      return undefined;
    }
    if (msg.type === 'req') return handleRequest(client, msg);
    return undefined;
  });
  ws.on('close', () => clients.delete(client));
  ws.on('error', () => clients.delete(client));
}

// ─── Start ────────────────────────────────────────────────────

function start(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node src/server/index.js [--port 47821] [--bind 127.0.0.1]');
    return null;
  }
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const token = loadToken();
  const bind = bindRule(args.bind);
  if (bind.warning) console.warn(`[frame-server] WARNING: ${bind.warning}`);

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

  server.listen(args.port, bind.host, () => {
    const { port } = server.address();
    const file = writeConnectionFile({ port, token, protocol: P.PROTOCOL_VERSION, frameVersion: pkg.version, pid: process.pid, origin: DESKTOP_ORIGIN });
    console.log(`[frame-server] Frame ${pkg.version} listening on ${bind.host}:${port} (protocol ${P.PROTOCOL_VERSION}); connection details in ${file}`);
  });
  server.on('error', (err) => {
    console.error(`[frame-server] ${err.message}`);
    process.exit(1);
  });

  const stop = () => {
    try { fs.rmSync(path.join(HOME, 'connection.json'), { force: true }); } catch (_) { /* best effort */ }
    for (const c of clients) c.ws.close(1001, 'server stopping');
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return { server, wss };
}

module.exports = { start, registerMethods, broadcast, parseArgs, HOME };

if (require.main === module) start();
