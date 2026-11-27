#!/usr/bin/env node
/**
 * Frame Chief MCP server (lead-agent spec, T06; plan D4 / D8 / D9).
 *
 * A stdio MCP server Claude Code starts for the Chief terminal (`--mcp-config`).
 * It owns nothing: every request is relayed over a local socket to the Chief
 * host in Frame (desktop main or Frame Server), which holds the tool registry,
 * the rules and all state. So a Chief can be restarted at any time, and new
 * tools (the work-queue spec) need no change here.
 *
 * Node built-ins only. The host copies this file and leadProtocol.js into
 * ~/.frame/run/ (outside the app's asar) and runs it with Frame's own binary
 * (FRAME_NODE + ELECTRON_RUN_AS_NODE=1), so no `node` on PATH is needed.
 *
 * Env (set in the MCP config the host writes):
 *   FRAME_LEAD_SOCKET  socket / named pipe of the host
 *   FRAME_LEAD_TOKEN   this Chief's token
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

// Materialized next to leadProtocol.js; in the source tree it lives in src/shared.
const P = require(fs.existsSync(path.join(__dirname, 'leadProtocol.js')) ? './leadProtocol' : '../../shared/leadProtocol');

const SERVER_NAME = 'frame-lead';
const SERVER_VERSION = '1.0.0';
const UNREACHABLE = 'Frame is not reachable from this Chief session. Ask the user to check that Frame (or Frame Server) is running, then restart the Chief.';

const socketPath = process.env.FRAME_LEAD_SOCKET || '';
const token = process.env.FRAME_LEAD_TOKEN || '';

// ─── host link ────────────────────────────────────────────

let sock = null;
let connecting = null;
let seq = 0;
const waiting = new Map(); // id → { resolve }

function failAll(message) {
  for (const { resolve } of waiting.values()) resolve(P.hostError(null, 'unreachable', message));
  waiting.clear();
}

function connect() {
  if (sock) return Promise.resolve(sock);
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    if (!socketPath) return reject(new Error('FRAME_LEAD_SOCKET is not set'));
    const s = net.createConnection(socketPath);
    const reader = P.createLineReader((msg) => {
      const w = msg && waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      w.resolve(msg);
    });
    s.setEncoding('utf8');
    s.on('data', (d) => reader.feed(d));
    s.once('connect', () => { sock = s; connecting = null; resolve(s); });
    s.on('error', (err) => {
      if (!sock) { connecting = null; reject(err); }
    });
    s.on('close', () => {
      if (sock === s) sock = null;
      failAll(UNREACHABLE);
    });
  });
  return connecting;
}

/** One request to the host; resolves with its response object (never rejects). */
async function host(type, extra = {}) {
  let s;
  try {
    s = await connect();
  } catch (_) {
    return P.hostError(null, 'unreachable', UNREACHABLE);
  }
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, { resolve });
    s.write(P.encode({ id, token, type, ...extra }));
  });
}

// ─── MCP over stdio ───────────────────────────────────────

function send(msg) {
  process.stdout.write(P.encode(msg));
}

async function handleRequest(id, method, params) {
  switch (method) {
    case 'initialize': {
      const hello = await host('hello');
      const info = hello.ok ? hello.result || {} : {};
      return send(P.rpcResult(id, P.initializeResult({
        requested: params.protocolVersion,
        name: info.name || SERVER_NAME,
        version: info.version || SERVER_VERSION,
        instructions: hello.ok ? info.instructions : UNREACHABLE
      })));
    }
    case 'ping':
      return send(P.rpcResult(id, {}));
    case 'tools/list': {
      const res = await host('list');
      return send(P.rpcResult(id, { tools: res.ok && Array.isArray(res.result) ? res.result : [] }));
    }
    case 'tools/call': {
      const name = params && params.name;
      if (typeof name !== 'string' || !name) return send(P.rpcError(id, P.RPC.INVALID_PARAMS, 'tools/call needs a name'));
      const res = await host('call', { tool: name, args: params.arguments || {} });
      if (res.ok) return send(P.rpcResult(id, P.toolResult(res.result)));
      const err = res.error || {};
      return send(P.rpcResult(id, P.toolResult(`${err.code || 'error'}: ${err.message || 'the call failed'}`, { isError: true })));
    }
    default:
      return send(P.rpcError(id, P.RPC.METHOD_NOT_FOUND, `Unknown method ${method}`));
  }
}

const stdin = P.createLineReader((msg) => {
  const c = P.classifyRpc(msg);
  if (c.kind === 'request') {
    handleRequest(c.id, c.method, c.params).catch((e) => send(P.rpcError(c.id, P.RPC.INTERNAL, e.message)));
  } else if (c.kind === 'invalid' && c.id !== undefined && c.id !== null) {
    send(P.rpcError(c.id, P.RPC.INVALID_REQUEST, 'Invalid request'));
  }
  // notifications (initialized, cancelled) need no answer
}, { onError: (e) => send(P.rpcError(null, e.code, e.message)) });

process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => stdin.feed(d));
process.stdin.on('end', () => {
  if (sock) sock.end();
  process.exit(0);
});
