/**
 * serverProtocol — the messages between Frame desktop and Frame Server
 * (server-workspaces spec).
 *
 * One JSON object per WebSocket message:
 *   hello { type, protocol, frameVersion }        first message, both ways
 *   req   { type, id, method, params }            desktop → server
 *   res   { type, id, ok, result? | error? }      server → desktop
 *   event { type, channel, payload }              server → desktop
 *
 * The protocol number changes when a message's meaning changes; a mismatch
 * is refused with both versions named (installing/updating the server is a
 * later spec). Pure apart from timers in the pending-request table.
 */

// 2: the server listens on a Unix socket and connection.json names `socket`
// instead of `port` (server-hardening S8) — older desktops cannot reach it,
// so the mismatch is surfaced as an update.
const PROTOCOL_VERSION = 2;
const TYPES = new Set(['hello', 'req', 'res', 'event']);

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Why `msg` is not a valid protocol message, or null when it is. */
function validate(msg) {
  if (!isPlainObject(msg)) return 'message is not an object';
  if (!TYPES.has(msg.type)) return `unknown message type "${msg.type}"`;
  switch (msg.type) {
    case 'hello':
      if (!Number.isInteger(msg.protocol)) return 'hello without a protocol number';
      return null;
    case 'req':
      if (typeof msg.id !== 'string' || !msg.id) return 'request without an id';
      if (typeof msg.method !== 'string' || !/^[a-z]+\.[a-zA-Z]+$/.test(msg.method)) return 'request with an invalid method';
      if (msg.params !== undefined && !isPlainObject(msg.params)) return 'request params must be an object';
      return null;
    case 'res':
      if (typeof msg.id !== 'string' || !msg.id) return 'response without an id';
      if (typeof msg.ok !== 'boolean') return 'response without ok';
      if (!msg.ok && typeof msg.error !== 'string') return 'failed response without an error';
      return null;
    case 'event':
      if (typeof msg.channel !== 'string' || !msg.channel) return 'event without a channel';
      return null;
    default:
      return 'unknown message';
  }
}

/** Text → `{ ok: true, msg }` or `{ ok: false, error }`. Never throws. */
function decode(text) {
  let msg;
  try {
    msg = JSON.parse(String(text));
  } catch (_) {
    return { ok: false, error: 'not JSON' };
  }
  const error = validate(msg);
  return error ? { ok: false, error } : { ok: true, msg };
}

function encode(msg) {
  return JSON.stringify(msg);
}

const hello = (frameVersion) => ({ type: 'hello', protocol: PROTOCOL_VERSION, frameVersion: String(frameVersion || '') });
const request = (id, method, params = {}) => ({ type: 'req', id: String(id), method, params });
const reply = (id, result) => ({ type: 'res', id: String(id), ok: true, result: result === undefined ? null : result });
const failure = (id, error) => ({ type: 'res', id: String(id), ok: false, error: String(error || 'failed') });
const event = (channel, payload) => ({ type: 'event', channel, payload: payload === undefined ? null : payload });

/** Is the other side's hello compatible? `{ ok, error }` naming both versions. */
function checkHello(msg, ownFrameVersion) {
  if (!msg || msg.type !== 'hello') return { ok: false, error: 'The server did not introduce itself.' };
  if (msg.protocol !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `Frame Server ${msg.frameVersion || '?'} speaks protocol ${msg.protocol}; this Frame ${ownFrameVersion || ''} speaks ${PROTOCOL_VERSION}. Update the older side.`.replace(/\s+/g, ' ')
    };
  }
  return { ok: true, error: null };
}

/**
 * Pending requests by id: `add(id, timeoutMs)` → promise that settles when
 * `settle(res)` sees the matching response, rejects on timeout, and
 * `rejectAll(reason)` fails everything in flight (connection lost).
 */
function createPending() {
  const table = new Map();
  let seq = 0;
  return {
    nextId() {
      seq += 1;
      return `r${seq}`;
    },
    add(id, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          table.delete(id);
          reject(new Error('The server did not answer in time.'));
        }, timeoutMs);
        table.set(id, { resolve, reject, timer });
      });
    },
    settle(res) {
      const entry = table.get(res && res.id);
      if (!entry) return false;
      clearTimeout(entry.timer);
      table.delete(res.id);
      if (res.ok) entry.resolve(res.result);
      else entry.reject(new Error(res.error));
      return true;
    },
    rejectAll(reason) {
      for (const [id, entry] of table) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason || 'Disconnected from the server.'));
        table.delete(id);
      }
    },
    get size() {
      return table.size;
    }
  };
}

module.exports = {
  PROTOCOL_VERSION,
  validate,
  decode,
  encode,
  hello,
  request,
  reply,
  failure,
  event,
  checkHello,
  createPending
};
