/**
 * cloudSession — the Electron shell around the Frame Cloud device flow.
 *
 * Holds no flow logic (that is deviceFlow.js). It builds the core's
 * dependencies from Electron — `net.fetch` for HTTP (system proxy and
 * certificate store), `shell.openExternal` for the browser, sessionStore for
 * persistence — owns the one public state object, and pushes it to the
 * renderer on every transition.
 *
 * The token lives in a module variable and never enters the state object:
 * the renderer runs with nodeIntegration, so the push payload is built by an
 * allowlist (toPublicState), not by deleting a field.
 *
 * Nothing here holds the app: startup() is fire-and-forget, every request has
 * a 15 s timeout, and quitting does not wait on an in-flight call.
 */

const os = require('os');
const { execFileSync } = require('child_process');
const { app, net, shell } = require('electron');
const { IPC } = require('../../shared/ipcChannels');
const userSettings = require('../userSettings');
const logger = require('../logger');
const sessionStore = require('./sessionStore');
const {
  resolveServerUrl,
  formatDeviceInfo,
  resolveInstallId,
  runSignIn,
  refreshSession,
  registerDevice,
  signOutDevice,
  fetchInviteMode,
  normalizeWaitlistEmail,
  joinWaitlist: joinWaitlistCall,
  checkServerUrl,
} = require('./deviceFlow');

// The release default comes from the packaged package.json: a release built
// with FRAME_CLOUD_RELEASE_URL carries `frameCloudUrl` there (written by
// scripts/release-build.js through electron-builder's extraMetadata). The
// repository's package.json has none, so `npm start` and builds made without
// it resolve to nothing and the Account section stays hidden. Developers set
// FRAME_CLOUD_URL or the cloudServerUrl setting.
const { frameCloudUrl } = require('../../../package.json');
const RELEASE_CLOUD_SERVER_URL = typeof frameCloudUrl === 'string' ? frameCloudUrl : '';
const REQUEST_TIMEOUT_MS = 15000;

const PUBLIC_KEYS = [
  'state',
  'ephemeral',
  'serverUrl',
  'userCode',
  'verificationUrl',
  'user',
  'workspace',
  'device',
  'reason',
  'serverUnreachable',
  // Early access, beside `state` (see inviteOnly below); only while signed out.
  'inviteOnly',
  'waitlistEmail',
];

// The address this machine last joined the waitlist with.
const WAITLIST_EMAIL_KEY = 'cloudWaitlistEmail';

let mainWindow = null;
let state = { state: 'unavailable' };
let token = null;
// Origin of the web app, taken from the sign-in's verification URL. Main-only:
// the projects service builds web links from it; the renderer never sees it.
let webOrigin = null;
let attempt = null; // AbortController of the running sign-in
let refreshing = null;
let started = false;
// Early access. Kept beside `state`, like webOrigin, so every transition keeps
// them: whether the server is invite-only (null until read, or when it cannot
// say) and the address this machine joined the waitlist with.
let inviteOnly = null;
let waitlistEmail = null;
let readingMode = null;
const listeners = new Set();

// Refused addresses already logged: resolveUrl runs on every getState.
const refusedLogged = new Set();

// ─── Dependencies for the core ────────────────────────────────

function resolveUrl() {
  const { url, refused } = resolveServerUrl({
    env: process.env.FRAME_CLOUD_URL,
    setting: userSettings.get('cloudServerUrl'),
    defaultUrl: RELEASE_CLOUD_SERVER_URL,
  });
  if (refused && !refusedLogged.has(refused)) {
    refusedLogged.add(refused);
    logger.warn('cloudSession', `Frame Cloud is off: ${refusalReason(refused)}`);
  }
  return url;
}

// Scheme and host only: the rest of a mistyped address could carry anything.
function refusalReason(address) {
  let parsed;
  try {
    parsed = new URL(address);
  } catch {
    return 'the server address is not a URL';
  }
  if (checkServerUrl(address).reason === 'insecure') {
    return `${parsed.protocol}//${parsed.host} is not https (plain http only reaches localhost and 127.0.0.1)`;
  }
  return `${parsed.protocol} is not an http(s) address`;
}

/**
 * `net.fetch` → `{ status, body }`. A timeout rejects with a plain Error so
 * the core reads it as a network failure, not as the user cancelling.
 */
async function fetchJson(url, { method = 'GET', body, token: bearer, signal } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  try {
    const res = await net.fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    if (timedOut) throw new Error('Frame Cloud request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abortError = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return err;
    };
    if (signal && signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function originOf(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function openUrl(url) {
  // The URL comes from the server; only hand web addresses to the OS.
  if (!/^https?:\/\//i.test(url || '')) return;
  shell.openExternal(url).catch(() => {
    /* the URL stays on screen with a Copy button */
  });
}

// The name the user gave this machine. On macOS `os.hostname()` is often a
// DHCP address, while ComputerName is what System Settings shows ("MacBook
// Pro"); LocalHostName is the Bonjour fallback. Read once, then cached.
let computerName = null;

function readComputerName() {
  if (computerName !== null) return computerName;
  computerName = '';
  if (process.platform !== 'darwin') return computerName;
  for (const key of ['ComputerName', 'LocalHostName']) {
    try {
      const value = execFileSync('/usr/sbin/scutil', ['--get', key], {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (value) {
        computerName = value;
        break;
      }
    } catch {
      /* not set — try the next one, then the hostname */
    }
  }
  return computerName;
}

// This install's id for device.register. It lives in Frame's settings, not in
// the session file (cleared on sign-out) and apart from the analytics id
// (deleted when analytics is turned off), so a sign-out keeps the device.
const INSTALL_ID_KEY = 'cloudInstallId';
let installId = null;

function readInstallId() {
  if (installId) return installId;
  const { id, write } = resolveInstallId(userSettings.get(INSTALL_ID_KEY));
  if (write === 'set') userSettings.set(INSTALL_ID_KEY, id);
  installId = id;
  return installId;
}

function deviceInfo() {
  return formatDeviceInfo({
    computerName: readComputerName(),
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    appVersion: app.getVersion(),
    installId: readInstallId(),
  });
}

// ─── Public state ─────────────────────────────────────────────

function toPublicState() {
  const out = {};
  for (const key of PUBLIC_KEYS) {
    if (state[key] !== undefined) out[key] = state[key];
  }
  if (state.state !== 'signedIn') {
    if (inviteOnly !== null) out.inviteOnly = inviteOnly;
    if (waitlistEmail) out.waitlistEmail = waitlistEmail;
  }
  return out;
}

function getPublicState() {
  return toPublicState();
}

function publish() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.CLOUD_SESSION_STATE, toPublicState());
}

/**
 * Every transition is pushed to the renderer, then told to main-process
 * listeners. `userStarted` is true only for the sign-in the user just finished.
 */
function setState(next, { userStarted = false } = {}) {
  state = next;
  publish();
  const change = { state: toPublicState(), userStarted };
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (err) {
      logger.error('cloudSession', 'session listener failed', err);
    }
  }
}

/** Subscribe to session changes. Returns the unsubscribe function. */
function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * What a main-process caller needs to make a bearer call, or null while not
 * signed in. Never sent to the renderer.
 */
function getAuth() {
  if (state.state !== 'signedIn' || !token) return null;
  const ws = state.workspace || null;
  return {
    serverUrl: state.serverUrl,
    token,
    cloudWorkspace: ws ? { name: ws.name, slug: ws.slug, role: ws.role } : null,
    webOrigin,
  };
}

function signedInState(serverUrl, session, ephemeral) {
  return {
    state: 'signedIn',
    serverUrl,
    ephemeral: Boolean(ephemeral),
    user: session.user,
    workspace: session.workspace,
    device: session.device,
  };
}

// Device flow has no redirect back to the app, so a completed sign-in is what
// brings Frame to the front. macOS will not hand focus over from the browser
// to a plain focus(); `steal` makes Frame the active app.
function bringToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function abortAttempt() {
  if (!attempt) return;
  attempt.abort();
  attempt = null;
}

// ─── Actions ──────────────────────────────────────────────────

/** Start a sign-in. Resolves when the attempt ends; callers need not wait. */
async function signIn() {
  if (state.state === 'signedIn') return getPublicState();
  abortAttempt();
  started = true; // a later getState() must not reload over this attempt

  const serverUrl = resolveUrl();
  if (!serverUrl) {
    setState({ state: 'unavailable' });
    return getPublicState();
  }

  const controller = new AbortController();
  attempt = controller;
  let verificationUrl;
  setState({ state: 'requestingCode', serverUrl });

  const result = await runSignIn({
    api: serverUrl,
    fetchJson,
    sleep,
    now: Date.now,
    signal: controller.signal,
    openUrl,
    deviceInfo: deviceInfo(),
    onState: (patch) => {
      if (attempt !== controller) return;
      if (patch.verificationUrl) verificationUrl = patch.verificationUrl;
      setState({ ...patch, serverUrl });
    },
  });

  // Cancelled or superseded: whoever took over has already set the state.
  if (attempt !== controller) return getPublicState();
  attempt = null;

  if (result.ok) {
    token = result.token;
    webOrigin = originOf(verificationUrl);
    const { ephemeral } = sessionStore.save({ serverUrl, token, webOrigin, ...result.session });
    setState(signedInState(serverUrl, result.session, ephemeral), { userStarted: true });
    bringToFront();
    // register does not describe the device; me does.
    refresh();
  } else if (result.reason === 'cancelled') {
    setState({ state: 'signedOut', serverUrl });
  } else {
    logger.info('cloudSession', `sign-in ended: ${result.reason}`);
    setState({ state: 'failed', serverUrl, reason: result.reason, verificationUrl });
  }
  return getPublicState();
}

function cancel() {
  // After a failed sign-in, "Join the waitlist" leads back to the start.
  if (!attempt && state.state === 'failed') {
    setState({ state: 'signedOut', serverUrl: state.serverUrl });
    return getPublicState();
  }
  if (!attempt) return getPublicState();
  abortAttempt();
  setState({ state: 'signedOut', serverUrl: state.serverUrl });
  return getPublicState();
}

/**
 * Signed out: one `invite.mode`, so the window knows whether to lead with the
 * waitlist. Concurrent callers share the request; a failure keeps the last
 * answer, and a server that cannot say (null) reads as not invite-only.
 */
function readInviteMode() {
  const api = state.serverUrl;
  if (!api) return Promise.resolve(getPublicState());
  if (readingMode) return readingMode;
  readingMode = fetchInviteMode({ api, fetchJson })
    .then((mode) => {
      if (state.serverUrl !== api) return;
      inviteOnly = mode;
      publish();
    })
    .catch(() => {})
    .then(() => {
      readingMode = null;
      return getPublicState();
    });
  return readingMode;
}

/**
 * Join the waitlist with the address the renderer typed. Main normalizes it
 * (the renderer is not trusted with the check); on success the address is
 * remembered on this machine, so the window shows "You're on the list" from
 * then on. → `{ ok: true }` or `{ ok: false, reason }`.
 */
async function joinWaitlist(rawEmail) {
  const email = normalizeWaitlistEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid' };
  const api = state.serverUrl;
  if (!api) return { ok: false, reason: 'unavailable' };
  const result = await joinWaitlistCall({ api, email, fetchJson });
  if (!result.ok) return result;
  userSettings.set(WAITLIST_EMAIL_KEY, email);
  waitlistEmail = email;
  publish();
  return { ok: true };
}

/**
 * One silent device.me. A dead token signs out quietly; an unreachable server
 * keeps the last data. Signed out, it reads the invite mode instead.
 */
function refresh() {
  if (state.state !== 'signedIn' || !token) {
    return state.state === 'unavailable' ? Promise.resolve(getPublicState()) : readInviteMode();
  }
  if (refreshing) return refreshing;

  const current = token;
  const serverUrl = state.serverUrl;
  refreshing = (async () => {
    const result = await refreshSession({ api: serverUrl, token: current, deviceInfo: deviceInfo(), fetchJson });
    if (token !== current) return; // signed out meanwhile
    if (result.ok) {
      // me does not know the web origin; keep the one sign-in stored.
      const { ephemeral } = sessionStore.save({ serverUrl, token: current, webOrigin, ...result.session });
      setState(signedInState(serverUrl, result.session, ephemeral));
    } else if (result.reason === 'unauthorized') {
      sessionExpired();
    } else if (result.reason === 'network') {
      setState({ ...state, serverUnreachable: true });
    }
  })()
    .catch(() => {})
    .then(() => {
      refreshing = null;
      return getPublicState();
    });
  return refreshing;
}

/** A bearer call answered 401: forget the session quietly, no error shown. */
function sessionExpired() {
  if (!token) return getPublicState();
  logger.info('cloudSession', 'session no longer valid — signed out');
  token = null;
  webOrigin = null;
  sessionStore.clear(state.serverUrl);
  setState({ state: 'signedOut', serverUrl: state.serverUrl });
  return getPublicState();
}

/**
 * The server forgot this device (412 DEVICE_NOT_REGISTERED): register it
 * again, once. Throws the CloudError when that fails too.
 */
async function reRegister() {
  const auth = getAuth();
  if (!auth) throw new Error('Frame Cloud is not signed in');
  await registerDevice({ api: auth.serverUrl, token: auth.token, info: deviceInfo(), fetchJson });
}

/** Tell the server, then forget the session locally whatever it said. */
async function signOut() {
  abortAttempt();
  const current = token;
  const serverUrl = state.serverUrl || resolveUrl();
  token = null;
  webOrigin = null;

  let serverUnreachable = false;
  if (current && serverUrl) {
    try {
      await signOutDevice({ api: serverUrl, token: current, fetchJson });
    } catch (err) {
      serverUnreachable = err.kind === 'network' || err.kind === 'rate_limited';
    }
  }
  sessionStore.clear(serverUrl);
  const next = { state: 'signedOut', serverUrl };
  if (serverUnreachable) next.serverUnreachable = true;
  setState(serverUrl ? next : { state: 'unavailable' });
  return getPublicState();
}

/**
 * Launch: show the stored session at once, then refresh it in the background.
 * Runs once — the renderer's first CLOUD_GET_STATE may already have done it.
 */
function startup() {
  if (!started) loadSession();
}

function loadSession() {
  started = true;
  abortAttempt();
  const serverUrl = resolveUrl();
  if (serverUrl !== state.serverUrl) inviteOnly = null; // another server's answer
  waitlistEmail = userSettings.get(WAITLIST_EMAIL_KEY) || null;
  if (!serverUrl) {
    token = null;
    webOrigin = null;
    setState({ state: 'unavailable' });
    return;
  }
  const stored = sessionStore.load(serverUrl);
  if (!stored) {
    token = null;
    webOrigin = null;
    setState({ state: 'signedOut', serverUrl });
    readInviteMode();
    return;
  }
  token = stored.token;
  // Sessions stored before web links existed have none; links stay hidden until the next sign-in.
  webOrigin = stored.webOrigin || null;
  setState(signedInState(serverUrl, stored, stored.ephemeral));
  refresh();
}

/** The current state, re-resolving first if the server address changed underneath. */
function getState() {
  if (!started || (!attempt && resolveUrl() !== (state.serverUrl || ''))) loadSession();
  return getPublicState();
}

// ─── Wiring ───────────────────────────────────────────────────

function init(window) {
  mainWindow = window;
  // Signed in, every return to Frame re-reads device.me: a workspace created
  // in the browser shows up on the way back, and so does a role an admin
  // changed there (the server reads the role per request). No throttle and no
  // timer: focus fires once per return and refresh() shares one request.
  window.on('focus', () => {
    if (state.state !== 'signedIn') return;
    refresh();
  });
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.CLOUD_SIGN_IN, () => {
    // The attempt can wait minutes for the browser; the renderer follows pushes.
    signIn().catch((err) => logger.error('cloudSession', 'sign-in crashed', err));
    return getPublicState();
  });
  ipcMain.handle(IPC.CLOUD_CANCEL_SIGN_IN, () => cancel());
  ipcMain.handle(IPC.CLOUD_SIGN_OUT, () => signOut());
  ipcMain.handle(IPC.CLOUD_GET_STATE, () => getState());
  ipcMain.handle(IPC.CLOUD_REFRESH, () => refresh());
  ipcMain.handle(IPC.CLOUD_JOIN_WAITLIST, (event, email) => joinWaitlist(email));
}

module.exports = {
  init,
  setupIPC,
  startup,
  signIn,
  cancel,
  refresh,
  signOut,
  getState,
  joinWaitlist,
  getPublicState,
  toPublicState,
  getAuth,
  onChange,
  sessionExpired,
  reRegister,
  openUrl,
  fetchJson,
};
