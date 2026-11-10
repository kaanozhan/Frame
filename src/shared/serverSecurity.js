/**
 * serverSecurity — the few rules that keep Frame Server from becoming a
 * hole (server-workspaces spec; 2026-11-09 security decision).
 *
 * Access to the server is the user's SSH. Frame Server only refuses to
 * widen it: it listens on localhost unless told otherwise (and warns), it
 * requires a random per-install token on the WebSocket upgrade, and it
 * refuses browser origins — the class of bug behind claudecodeui's
 * unauthenticated RCE (CVE-2026-31975: default secret + unchecked upgrade).
 */

const crypto = require('crypto');

/** The Origin the desktop sends; browsers can never send it. */
const DESKTOP_ORIGIN = 'frame-desktop';
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** A fresh random token (256 bits, URL-safe). */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Constant-time token comparison; false for anything that is not two non-empty strings. */
function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Decide a WebSocket upgrade from its headers (lower-case keys, as Node
 * gives them). Requires `Authorization: Bearer <token>`; refuses any Origin
 * other than the desktop's (a page in a browser always sends its own).
 * Returns `{ ok, status, reason }`.
 */
function checkUpgrade(headers, token) {
  const h = headers || {};
  const origin = h.origin;
  if (origin !== undefined && origin !== DESKTOP_ORIGIN) {
    return { ok: false, status: 403, reason: 'origin not allowed' };
  }
  const m = /^Bearer\s+(\S+)$/i.exec(String(h.authorization || ''));
  if (!m || !tokensEqual(m[1], token)) {
    return { ok: false, status: 401, reason: 'missing or wrong token' };
  }
  return { ok: true, status: 101, reason: null };
}

/**
 * Where to listen. Default 127.0.0.1; any other address is honoured but
 * comes with a warning to print — the server is then reachable by whoever
 * can reach that interface, guarded only by the token.
 */
function bindRule(requested) {
  const host = requested ? String(requested).trim() : '127.0.0.1';
  if (LOCAL_HOSTS.has(host)) return { host, warning: null };
  return {
    host,
    warning: `Frame Server is listening on ${host}, not only on this machine. Anyone who can reach it is stopped only by the token — prefer SSH (or Tailscale) and the default 127.0.0.1.`
  };
}

module.exports = { DESKTOP_ORIGIN, generateToken, tokensEqual, checkUpgrade, bindRule };
