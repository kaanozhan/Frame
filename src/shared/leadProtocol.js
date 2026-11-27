/**
 * leadProtocol — the wire between the Chief's MCP server and its host
 * (lead-agent spec, T04; plan D4 / D8).
 *
 *   Claude ──stdio, MCP JSON-RPC──▶ lead-mcp.js ──socket, JSON lines + token──▶ leadHost
 *
 * Self-contained on purpose — node built-ins only, no other Frame module:
 * the host materializes this file next to lead-mcp.js under ~/.frame/run/
 * (outside the app's asar), and lead-mcp.js requires it from there. One
 * framing implementation, two processes.
 *
 * Host messages (one JSON object per line):
 *   request   { id, token, type: 'hello' | 'list' | 'call', tool?, args? }
 *   response  { id, ok: true, result } | { id, ok: false, error: { code, message } }
 * `hello` returns `{ name, version, instructions }`; `list` the MCP tool
 * definitions; `call` a tool's result. The tool registry lives in the host,
 * so new tools (the work-queue spec) need no change here or in lead-mcp.js.
 */

const crypto = require('crypto');

/** MCP protocol revisions this server can speak, newest first. */
const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const HOST_TYPES = ['hello', 'list', 'call'];

// JSON-RPC error codes.
const RPC = Object.freeze({ PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 });

const MAX_LINE = 4 * 1024 * 1024;

/**
 * Split a byte/string stream into JSON messages, one per line. Partial lines
 * wait for the rest; a bad line reports to `onError` and is skipped; a line
 * past `maxLine` is dropped whole so one runaway peer cannot grow memory.
 */
function createLineReader(onMessage, { onError = () => {}, maxLine = MAX_LINE } = {}) {
  let buf = '';
  let dropping = false;
  return {
    feed(chunk) {
      buf += typeof chunk === 'string' ? chunk : String(chunk);
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (dropping) { dropping = false; continue; }
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          onError({ code: RPC.PARSE, message: `Bad JSON: ${e.message}` });
          continue;
        }
        onMessage(msg);
      }
      if (buf.length > maxLine) {
        buf = '';
        dropping = true;
        onError({ code: RPC.INVALID_REQUEST, message: 'Line too long' });
      }
    },
    get pending() {
      return buf;
    }
  };
}

function encode(msg) {
  return `${JSON.stringify(msg)}\n`;
}

/** Constant-time token comparison; false for anything but two equal non-empty strings. */
function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// ─── host requests ────────────────────────────────────────

/** `{ ok: true, request }` or `{ ok: false, error }` for a message arriving at the host. */
function validateHostRequest(msg, token) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: { code: 'bad-request', message: 'Not an object' } };
  if (!tokensEqual(msg.token, token)) return { ok: false, error: { code: 'unauthorized', message: 'Bad or missing token' } };
  if (!HOST_TYPES.includes(msg.type)) return { ok: false, error: { code: 'bad-request', message: `Unknown type ${msg.type}` } };
  if (msg.type === 'call' && (typeof msg.tool !== 'string' || !msg.tool)) return { ok: false, error: { code: 'bad-request', message: 'call needs a tool' } };
  const args = msg.args === undefined || msg.args === null ? {} : msg.args;
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: { code: 'bad-request', message: 'args must be an object' } };
  return { ok: true, request: { id: msg.id, type: msg.type, tool: msg.tool || null, args } };
}

function hostOk(id, result) {
  return { id, ok: true, result };
}

function hostError(id, code, message) {
  return { id, ok: false, error: { code, message } };
}

// ─── MCP (JSON-RPC 2.0) ───────────────────────────────────

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

/** The revision to answer `initialize` with: the client's when we speak it, else our newest. */
function negotiateVersion(requested) {
  return MCP_VERSIONS.includes(requested) ? requested : MCP_VERSIONS[0];
}

function initializeResult({ requested, name, version, instructions }) {
  const out = {
    protocolVersion: negotiateVersion(requested),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name, version }
  };
  if (instructions) out.instructions = instructions;
  return out;
}

/** A tool's outcome as MCP content: one text block holding JSON, flagged on error. */
function toolResult(value, { isError = false } = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

/**
 * Classify an incoming MCP message.
 * @returns {{ kind: 'request'|'notification'|'response'|'invalid', id?, method?, params? }}
 */
function classifyRpc(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { kind: 'invalid', id: msg && msg.id };
  if (typeof msg.method === 'string') {
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    return msg.id === undefined || msg.id === null
      ? { kind: 'notification', method: msg.method, params }
      : { kind: 'request', id: msg.id, method: msg.method, params };
  }
  if (msg.id !== undefined && ('result' in msg || 'error' in msg)) return { kind: 'response', id: msg.id };
  return { kind: 'invalid', id: msg.id };
}

module.exports = {
  MCP_VERSIONS,
  HOST_TYPES,
  RPC,
  MAX_LINE,
  createLineReader,
  encode,
  tokensEqual,
  generateToken,
  validateHostRequest,
  hostOk,
  hostError,
  rpcResult,
  rpcError,
  negotiateVersion,
  initializeResult,
  toolResult,
  classifyRpc
};
