/**
 * deviceFlow — the pure core of Frame Cloud sign-in.
 *
 * The desktop half of FrameCloud's OAuth 2.0 device authorization grant
 * (RFC 8628) plus the three bearer-token tRPC procedures that follow it
 * (`device.register`, `device.me`, `device.signOut`).
 *
 * Nothing here imports Electron or touches a file: every time-, network- and
 * side-effect-shaped thing is injected, so `cloudSession.js` (Electron) and a
 * future CLI are both thin shells over the same functions.
 *
 *   fetchJson(url, { method, body, token, signal }) → { status, body }
 *     rejects on transport failure only.
 *   sleep(ms, signal) → resolves after ms, rejects with an AbortError when
 *     the signal fires.
 *   now() → epoch milliseconds.
 *   openUrl(url) → may be a no-op.
 *   onState(patch) → synchronous.
 *
 * The token is returned to the caller and never passed to onState.
 */

const { randomUUID } = require('crypto');

const CLIENT_ID = 'frame-desktop';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_EXPIRES_IN_S = 900;
const DEFAULT_INTERVAL_S = 5; // RFC 8628 §3.2
const SLOW_DOWN_STEP_MS = 5000; // RFC 8628 §3.5
const MAX_BACKOFF_MS = 30000;

class CloudError extends Error {
  constructor(kind, { status = 0, message } = {}) {
    super(message || `Frame Cloud request failed (${kind})`);
    this.name = 'CloudError';
    this.kind = kind;
    this.status = status;
  }
}

function isAbort(err, signal) {
  return Boolean((signal && signal.aborted) || (err && err.name === 'AbortError'));
}

// ─── Building blocks ──────────────────────────────────────────

// The only hosts reached over plain http: a FrameCloud on this machine.
// Anywhere else the bearer token would cross the network in clear.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Whether Frame may talk to `url`: https on any host, http on LOOPBACK_HOSTS
 * only. → `{ ok: true, url }` or `{ ok: false, reason }`, where reason is
 * 'invalid' (not an http(s) URL) or 'insecure' (http elsewhere).
 */
function checkServerUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.protocol === 'https:') return { ok: true, url };
  if (parsed.protocol !== 'http:') return { ok: false, reason: 'invalid' };
  return LOOPBACK_HOSTS.has(parsed.hostname) ? { ok: true, url } : { ok: false, reason: 'insecure' };
}

/**
 * The first non-empty of env → setting → default, without trailing slashes,
 * decides; a refused one does not fall through to the next. → `{ url, refused }`:
 * `{ url, refused: null }` when checkServerUrl allows it, `{ url: '', refused:
 * <candidate> }` when it does not, `{ url: '', refused: null }` when all are empty.
 */
function resolveServerUrl({ env, setting, defaultUrl } = {}) {
  for (const candidate of [env, setting, defaultUrl]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim().replace(/\/+$/, '');
    if (!trimmed) continue;
    return checkServerUrl(trimmed).ok ? { url: trimmed, refused: null } : { url: '', refused: trimmed };
  }
  return { url: '', refused: null };
}

/** `/api/auth/device/code` body → camelCase, milliseconds. Throws on a malformed body. */
function parseCodeResponse(body) {
  const b = body && typeof body === 'object' ? body : {};
  const deviceCode = typeof b.device_code === 'string' ? b.device_code : '';
  const userCode = typeof b.user_code === 'string' ? b.user_code : '';
  const verificationUri = typeof b.verification_uri === 'string' ? b.verification_uri : '';
  const verificationUriComplete =
    typeof b.verification_uri_complete === 'string' ? b.verification_uri_complete : '';
  if (!deviceCode || !userCode || !(verificationUriComplete || verificationUri)) {
    throw new CloudError('other', { status: 200, message: 'Malformed device code response' });
  }
  const expiresIn = Number(b.expires_in) > 0 ? Number(b.expires_in) : DEFAULT_EXPIRES_IN_S;
  const interval = Number(b.interval) > 0 ? Number(b.interval) : DEFAULT_INTERVAL_S;
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: verificationUriComplete || verificationUri,
    expiresInMs: expiresIn * 1000,
    intervalMs: interval * 1000,
  };
}

/** Display-only grouping: 'TTN4YFST' → 'TTN4-YFST'. Other shapes are returned as-is. */
function formatUserCode(userCode) {
  const code = typeof userCode === 'string' ? userCode : '';
  if (code.length !== 8) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** One `/api/auth/device/token` answer → what the poll loop does next. */
function classifyTokenResponse(res) {
  if (!res) return 'network';
  const { status, body } = res;
  if (status === 429) return 'rate_limited';
  if (status === 200) {
    return body && typeof body.access_token === 'string' && body.access_token
      ? 'token'
      : 'expired';
  }
  const error = body && typeof body.error === 'string' ? body.error : '';
  switch (error) {
    case 'authorization_pending':
      return 'pending';
    case 'slow_down':
      return 'slow_down';
    case 'access_denied':
      return 'denied';
    case 'expired_token':
    case 'invalid_grant':
      return 'expired';
    default:
      // A 5xx without an OAuth error is the server being unwell, not a verdict.
      if (!error && (status === 0 || status >= 500)) return 'network';
      return 'expired';
  }
}

/** A failed tRPC answer → CloudError kind. */
function classifyTrpcError(res) {
  const status = res && Number(res.status) ? Number(res.status) : 0;
  const code = res && res.body && res.body.error && res.body.error.data
    ? res.body.error.data.code
    : undefined;
  if (status === 401 || code === 'UNAUTHORIZED') return 'unauthorized';
  if (status === 429 || code === 'TOO_MANY_REQUESTS') return 'rate_limited';
  if (code === 'DEVICE_NOT_REGISTERED') return 'not_registered';
  if (code === 'NO_WORKSPACE') return 'no_workspace';
  if (status === 0 || status >= 500) return 'network';
  return 'other';
}

// A hostname that is really a network address (macOS without a HostName
// takes one from DHCP) says nothing about the machine and changes with the
// network, so it is never used as a name.
function looksLikeAddress(name) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || (name.includes(':') && /^[0-9a-f:.]+$/i.test(name));
}

function cleanName(raw) {
  const name = String(raw == null ? '' : raw)
    .trim()
    .replace(/\.local$/i, '')
    .trim()
    .slice(0, 100);
  return looksLikeAddress(name) ? '' : name;
}

/** A machine name → the name the server shows for this device. */
function deviceName(hostname) {
  return cleanName(hostname) || 'Unknown device';
}

/**
 * Raw machine facts → the `device.register` input, cut to the server's limits.
 * `computerName` (the name the user gave the machine, e.g. macOS's
 * ComputerName) wins over `hostname` when the shell can supply it.
 * `installId` is this Frame install's id (resolveInstallId).
 */
function formatDeviceInfo({ computerName, hostname, platform, release, appVersion, installId } = {}) {
  return {
    name: cleanName(computerName) || deviceName(hostname),
    os: [platform, release].filter(Boolean).join(' ').slice(0, 100),
    appVersion: String(appVersion || '').slice(0, 40),
    installId: String(installId || '').slice(0, INSTALL_ID_MAX),
  };
}

// ─── Install id ───────────────────────────────────────────────

// FrameCloud's longest install id (device-connections, `deviceInstallIdSchema`).
const INSTALL_ID_MAX = 128;
const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This Frame install's id, sent with every `device.register`. FrameCloud keeps
 * one device per user and install (device-connections), so signing out and
 * back in on this machine finds the same device and its project connections.
 * A stored UUID is kept; anything else — nothing yet, or a value that is not
 * a UUID — is replaced, and `write: 'set'` tells the shell to store the new
 * one. `mint` is injected so tests can name the id.
 */
function resolveInstallId(stored, mint = randomUUID) {
  if (typeof stored === 'string' && INSTALL_ID_RE.test(stored)) return { id: stored, write: null };
  return { id: mint(), write: 'set' };
}

// ─── Endpoint calls ───────────────────────────────────────────

async function send(fetchJson, url, opts) {
  try {
    return await fetchJson(url, opts);
  } catch (err) {
    if (isAbort(err, opts.signal)) throw err;
    throw new CloudError('network', { message: 'Frame Cloud could not be reached' });
  }
}

async function requestDeviceCode({ api, fetchJson, signal }) {
  const res = await send(fetchJson, `${api}/api/auth/device/code`, {
    method: 'POST',
    body: { client_id: CLIENT_ID },
    signal,
  });
  if (res.status !== 200) {
    const kind = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'network' : 'other';
    throw new CloudError(kind, { status: res.status });
  }
  return parseCodeResponse(res.body);
}

/**
 * One tRPC procedure, no transformer. A query (GET) carries its input as
 * `?input=<url-encoded JSON>` and omits it when there is none; a mutation
 * posts the input as the body.
 */
async function callTrpc({ api, name, method, token, input, fetchJson, signal }) {
  const opts = { method, token, signal };
  let url = `${api}/trpc/${name}`;
  if (method === 'GET') {
    if (input !== undefined) url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  } else {
    opts.body = input || {};
  }
  const res = await send(fetchJson, url, opts);
  if (res.status === 200 && res.body && res.body.result) {
    return res.body.result.data;
  }
  const message = res.body && res.body.error && typeof res.body.error.message === 'string'
    ? res.body.error.message
    : undefined;
  throw new CloudError(classifyTrpcError(res), { status: res.status, message });
}

function registerDevice({ api, token, info, fetchJson, signal }) {
  return callTrpc({
    api, token, fetchJson, signal,
    name: 'device.register',
    method: 'POST',
    input: { name: info.name, os: info.os, appVersion: info.appVersion, installId: info.installId },
  });
}

function fetchMe({ api, token, fetchJson, signal }) {
  return callTrpc({ api, token, fetchJson, signal, name: 'device.me', method: 'GET' });
}

function signOutDevice({ api, token, fetchJson, signal }) {
  return callTrpc({ api, token, fetchJson, signal, name: 'device.signOut', method: 'POST', input: {} });
}

// ─── Early access ─────────────────────────────────────────────

// FrameCloud's `waitlist` spec: the longest address it accepts (RFC 5321).
const WAITLIST_EMAIL_MAX = 254;

/**
 * Whether the server only lets invited people sign up (FrameCloud
 * `invite.mode`, public, no token). → true / false, or null when the answer
 * is malformed or the server predates it (404). Other failures throw.
 */
async function fetchInviteMode({ api, fetchJson, signal }) {
  let data;
  try {
    data = await callTrpc({ api, fetchJson, signal, name: 'invite.mode', method: 'GET' });
  } catch (err) {
    if (err && err.status === 404) return null;
    throw err;
  }
  return data && typeof data.inviteOnly === 'boolean' ? data.inviteOnly : null;
}

/**
 * A waitlist address as the server stores it — trimmed and lowercased as a
 * whole, like FrameCloud's `normalizeWaitlistEmail` — or null when it cannot
 * be one: longer than 254 characters, or not `local@domain.tld`.
 */
function normalizeWaitlistEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > WAITLIST_EMAIL_MAX) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return null;
  const domain = email.slice(at + 1);
  if (/\s/.test(email) || !/^[^.]+(\.[^.]+)+$/.test(domain)) return null;
  return email;
}

function joinReason(err) {
  const status = err && err.status;
  if (status === 400) return 'invalid';
  if (status === 404) return 'unavailable';
  if (status === 429 || (err && err.kind === 'rate_limited')) return 'rateLimited';
  return 'network';
}

/**
 * Put `email` on FrameCloud's waitlist from this machine (`waitlist.join`,
 * public, no token). The server answers the same for a new and a known
 * address. → `{ ok: true }` or `{ ok: false, reason: 'invalid' | 'rateLimited'
 * | 'network' | 'unavailable' }`, the last for a server without the waitlist.
 * Never throws.
 */
async function joinWaitlist({ api, email, fetchJson, signal }) {
  try {
    await callTrpc({
      api, fetchJson, signal,
      name: 'waitlist.join',
      method: 'POST',
      input: { email, source: 'desktop' },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: joinReason(err) };
  }
}

/**
 * Poll `/api/auth/device/token` until the user decides, the code expires or
 * the signal fires. Waits `interval` before every request; `slow_down` adds
 * 5 s for the rest of the loop; a transport error or 429 doubles the wait
 * (capped at 30 s, never below the interval) until a real answer arrives.
 */
async function pollForToken({ api, code, fetchJson, sleep, now, signal }) {
  const deadline = now() + code.expiresInMs;
  let intervalMs = code.intervalMs;
  let backoffMs = 0;
  const body = { grant_type: DEVICE_GRANT_TYPE, device_code: code.deviceCode, client_id: CLIENT_ID };

  for (;;) {
    if (signal && signal.aborted) return { ok: false, reason: 'cancelled' };
    const remaining = deadline - now();
    if (remaining <= 0) return { ok: false, reason: 'expired' };
    const wait = backoffMs || intervalMs;

    try {
      await sleep(Math.min(wait, remaining), signal);
    } catch (err) {
      if (isAbort(err, signal)) return { ok: false, reason: 'cancelled' };
      throw err;
    }
    if (signal && signal.aborted) return { ok: false, reason: 'cancelled' };
    if (wait >= remaining) return { ok: false, reason: 'expired' };

    let res = null;
    try {
      res = await fetchJson(`${api}/api/auth/device/token`, { method: 'POST', body, signal });
    } catch (err) {
      if (isAbort(err, signal)) return { ok: false, reason: 'cancelled' };
      res = null;
    }

    const outcome = classifyTokenResponse(res);
    if (outcome === 'network' || outcome === 'rate_limited') {
      backoffMs = Math.max(intervalMs, Math.min((backoffMs || intervalMs) * 2, MAX_BACKOFF_MS));
      continue;
    }
    backoffMs = 0;
    switch (outcome) {
      case 'token':
        return { ok: true, token: res.body.access_token };
      case 'pending':
        continue;
      case 'slow_down':
        intervalMs += SLOW_DOWN_STEP_MS;
        continue;
      case 'denied':
        return { ok: false, reason: 'denied' };
      default:
        return { ok: false, reason: 'expired' };
    }
  }
}

// ─── Orchestration ────────────────────────────────────────────

function signInReason(err) {
  switch (err && err.kind) {
    case 'rate_limited':
      return 'rateLimited';
    case 'no_workspace':
      return 'noWorkspace';
    default:
      return 'network';
  }
}

/**
 * The whole sign-in: code → browser → poll → register.
 * Emits requestingCode → awaitingApproval → registering through onState and
 * resolves with the token and session, or with a failure reason. Never throws.
 * `session.workspace` is `{ name, slug }` or null: signing in no longer needs a
 * workspace, and only an older server's 412 NO_WORKSPACE still fails.
 */
async function runSignIn({ api, fetchJson, sleep, now, signal, openUrl, deviceInfo, onState }) {
  const emit = (patch) => {
    try {
      if (onState) onState(patch);
    } catch {
      /* a broken listener must not break the flow */
    }
  };
  const fail = (err) => ({ ok: false, reason: isAbort(err, signal) ? 'cancelled' : signInReason(err) });

  emit({ state: 'requestingCode' });
  let code;
  try {
    code = await requestDeviceCode({ api, fetchJson, signal });
  } catch (err) {
    return fail(err);
  }
  if (signal && signal.aborted) return { ok: false, reason: 'cancelled' };

  emit({
    state: 'awaitingApproval',
    userCode: formatUserCode(code.userCode),
    verificationUrl: code.verificationUriComplete,
  });
  try {
    if (openUrl) await openUrl(code.verificationUriComplete);
  } catch {
    /* the URL is on screen; a browser that fails to open is not a failed sign-in */
  }

  let polled;
  try {
    polled = await pollForToken({ api, code, fetchJson, sleep, now, signal });
  } catch (err) {
    return fail(err);
  }
  if (!polled.ok) return polled;

  emit({ state: 'registering' });
  let data;
  try {
    data = await registerDevice({ api, token: polled.token, info: deviceInfo, fetchJson, signal });
  } catch (err) {
    return fail(err);
  }
  if (signal && signal.aborted) return { ok: false, reason: 'cancelled' };

  return {
    ok: true,
    token: polled.token,
    session: {
      deviceId: data.deviceId,
      user: data.user,
      workspace: data.workspace,
    },
  };
}

function refreshReason(err) {
  switch (err && err.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'network':
    case 'rate_limited':
      return 'network';
    default:
      return 'other';
  }
}

function sessionFromMe(data) {
  return {
    deviceId: data.device ? data.device.id : undefined,
    user: data.user,
    workspace: data.workspace,
    device: data.device,
  };
}

/**
 * `device.me`, re-registering once when the server has forgotten this device.
 * `session.workspace` may be null, and may change from one call to the next.
 * Never throws.
 */
async function refreshSession({ api, token, deviceInfo, fetchJson, signal }) {
  try {
    return { ok: true, session: sessionFromMe(await fetchMe({ api, token, fetchJson, signal })) };
  } catch (err) {
    if (!err || err.kind !== 'not_registered') return { ok: false, reason: refreshReason(err) };
  }
  try {
    await registerDevice({ api, token, info: deviceInfo, fetchJson, signal });
    return { ok: true, session: sessionFromMe(await fetchMe({ api, token, fetchJson, signal })) };
  } catch (err) {
    return { ok: false, reason: refreshReason(err) };
  }
}

module.exports = {
  CLIENT_ID,
  DEVICE_GRANT_TYPE,
  SLOW_DOWN_STEP_MS,
  MAX_BACKOFF_MS,
  CloudError,
  LOOPBACK_HOSTS,
  checkServerUrl,
  resolveServerUrl,
  parseCodeResponse,
  formatUserCode,
  classifyTokenResponse,
  classifyTrpcError,
  deviceName,
  formatDeviceInfo,
  INSTALL_ID_MAX,
  resolveInstallId,
  requestDeviceCode,
  pollForToken,
  registerDevice,
  fetchMe,
  signOutDevice,
  runSignIn,
  refreshSession,
  callTrpc,
  WAITLIST_EMAIL_MAX,
  fetchInviteMode,
  normalizeWaitlistEmail,
  joinWaitlist,
};
