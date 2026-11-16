/**
 * serverList — the rules over the desktop's saved Frame Servers
 * (multi-server-connections spec).
 *
 * The list lives in user settings under `servers`:
 *   [{ key, host, serverId, autoConnect }]
 * - `key` is assigned by the desktop when a server is added (8 hex) and never
 *   changes, so routing, cached rows and remembered locations stay valid even
 *   when an old server is updated and starts reporting an id.
 * - `host` is what the user typed: an SSH host or alias.
 * - `serverId` is what Frame Server reports through `server.info`, or null for
 *   a server too old to answer. It only catches the same machine added twice.
 * - `autoConnect` says whether to connect on launch (left connected).
 *
 * The old single setting `server: { host, autoConnect }` migrates once; it is
 * left as it was so a downgraded build still finds its one server.
 *
 * Pure: the key generator is passed in where a key is made.
 */

const crypto = require('crypto');

function defaultMakeKey() {
  return crypto.randomBytes(4).toString('hex');
}

const HOST_HINT = 'Enter an SSH host such as "myserver" or "me@server.example.com".';
const CONFIG_HINT = 'Frame cannot carry ssh options here — put them in a Host entry in ~/.ssh/config and enter that name.';

/**
 * A pasted ssh command (server-first-connect): `ssh me@host` gives `me@host`;
 * `-p <port>` and `-l <user>` become ssh's own `ssh://user@host:port`; any
 * other option, or a remote command after the host, is refused with a hint.
 */
function fromSshCommand(words) {
  let port = null;
  let login = null;
  const dest = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (dest.length) return { error: 'Enter only the host, without a command after it.' };
    let m = /^-([pl])(.*)$/.exec(w);
    if (m) {
      const value = m[2] || words[++i];
      if (!value) return { error: HOST_HINT };
      if (m[1] === 'p') {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) return { error: `"${value}" is not a port.` };
        port = Number(value);
      } else {
        login = value;
      }
      continue;
    }
    if (w.startsWith('-')) return { error: CONFIG_HINT };
    dest.push(w);
  }
  if (dest.length !== 1) return { error: HOST_HINT };
  let host = dest[0];
  if (login && !host.includes('@') && !host.startsWith('ssh://')) host = `${login}@${host}`;
  if (port && !host.startsWith('ssh://')) host = `ssh://${host}:${port}`;
  return { host };
}

/**
 * The host as typed, trimmed; `{ error }` when it cannot be an SSH host. A
 * whole `ssh …` command pasted in is reduced to its host (server-first-connect).
 */
function normalizeHost(host) {
  const h = String(host == null ? '' : host).trim();
  const words = h.split(/\s+/);
  if (words.length > 1 && words[0] === 'ssh') {
    const r = fromSshCommand(words.slice(1));
    return r.error ? r : normalizeHost(r.host);
  }
  if (!h || /\s/.test(h) || h.startsWith('-')) {
    return { error: HOST_HINT };
  }
  return { host: h };
}

function validEntry(e) {
  return !!(e && typeof e === 'object' && typeof e.key === 'string' && e.key
    && typeof e.host === 'string' && !normalizeHost(e.host).error);
}

/** A clean copy of a stored list: malformed entries and repeated keys dropped. */
function sanitize(list) {
  const out = [];
  const keys = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    if (!validEntry(e) || keys.has(e.key)) continue;
    keys.add(e.key);
    out.push({
      key: e.key,
      host: e.host.trim(),
      serverId: typeof e.serverId === 'string' && e.serverId ? e.serverId : null,
      autoConnect: !!e.autoConnect
    });
  }
  return out;
}

function uniqueKey(list, makeKey) {
  const taken = new Set(list.map((e) => e.key));
  for (let i = 0; i < 100; i++) {
    const k = makeKey();
    if (k && !taken.has(k)) return k;
  }
  throw new Error('Could not make a unique server key.');
}

/**
 * Add `host`. `{ list, entry }`, or `{ error, existing }` when the host is not
 * an SSH host or the same alias is already listed (case-insensitive).
 */
function addServer(list, host, { makeKey = defaultMakeKey, autoConnect = true } = {}) {
  const clean = sanitize(list);
  const n = normalizeHost(host);
  if (n.error) return { error: n.error };
  const existing = clean.find((e) => e.host.toLowerCase() === n.host.toLowerCase());
  if (existing) return { error: `${existing.host} is already in the list.`, existing };
  const entry = { key: uniqueKey(clean, makeKey), host: n.host, serverId: null, autoConnect: !!autoConnect };
  return { list: [...clean, entry], entry };
}

/** The list without `key`. */
function removeServer(list, key) {
  return sanitize(list).filter((e) => e.key !== key);
}

/** The entry for `key`, or null. */
function findServer(list, key) {
  return sanitize(list).find((e) => e.key === key) || null;
}

/** The entry (other than `exceptKey`) that holds `serverId`, or null. */
function findByServerId(list, serverId, exceptKey = null) {
  if (!serverId) return null;
  return sanitize(list).find((e) => e.serverId === serverId && e.key !== exceptKey) || null;
}

/** `list` with `fields` merged into the entry for `key` (unknown keys leave it unchanged). */
function updateServer(list, key, fields) {
  return sanitize(list).map((e) => (e.key === key ? sanitize([{ ...e, ...fields, key }])[0] || e : e));
}

/** Keys of the servers to connect on launch, in list order. */
function autoConnectKeys(list) {
  return sanitize(list).filter((e) => e.autoConnect).map((e) => e.key);
}

/**
 * The saved list from user settings, migrating the old single `server`
 * setting when there is no list yet. `{ servers, migrated }`: `migrated` says
 * the caller should save `servers` back.
 */
function migrate({ servers, server } = {}, { makeKey = defaultMakeKey } = {}) {
  if (Array.isArray(servers)) return { servers: sanitize(servers), migrated: false };
  const host = server && typeof server === 'object' ? normalizeHost(server.host) : { error: true };
  if (host.error) return { servers: [], migrated: false };
  const entry = { key: makeKey(), host: host.host, serverId: null, autoConnect: !!server.autoConnect };
  return { servers: sanitize([entry]), migrated: true };
}

module.exports = {
  normalizeHost,
  sanitize,
  addServer,
  removeServer,
  findServer,
  findByServerId,
  updateServer,
  autoConnectKeys,
  migrate
};
