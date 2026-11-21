/**
 * sessionStore — where Frame Cloud sessions live between launches.
 *
 * One file per server, `userData/cloud-sessions/<key>.json`, the key being the
 * first 16 hex characters of sha256(serverUrl). The dev Frame and the
 * installed one share userData: with a file each, a session on production and
 * one on a local FrameCloud sit side by side, and no two processes ever
 * read-modify-write the same file. Written through fsSafe.
 *
 * The token is `safeStorage.encryptString` output in base64; everything else
 * is plain JSON. When the OS offers no encryption (Linux without a keyring)
 * nothing is written: the session is kept in memory, per server, until quit
 * and `save()` answers `{ ephemeral: true }` so the Account section can say so.
 *
 * Before this, one `userData/cloud-session.json` held the only session. The
 * first load for its server moves it to that server's file.
 *
 * Log lines name the path and the outcome only — never the session.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const fsSafe = require('../fsSafe');
const logger = require('../logger');

const DIR_NAME = 'cloud-sessions';
const LEGACY_FILE_NAME = 'cloud-session.json';
const VERSION = 1;

// serverUrl → session record, for sessions that could not be written.
const memory = new Map();

function sessionPath(serverUrl) {
  const key = crypto.createHash('sha256').update(serverUrl).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), DIR_NAME, `${key}.json`);
}

function legacyPath() {
  return path.join(app.getPath('userData'), LEGACY_FILE_NAME);
}

/** The single-server file's text and server, or null when it is absent or unreadable. */
function readLegacy() {
  try {
    const raw = fs.readFileSync(legacyPath(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data.serverUrl === 'string' ? { raw, serverUrl: data.serverUrl } : null;
  } catch {
    return null;
  }
}

/** A session file and the fsSafe files beside it. */
function removeFiles(file) {
  for (const target of [file, `${file}.bak`, `${file}.tmp`]) {
    try {
      fs.unlinkSync(target);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('cloudSession', `could not delete ${target}`);
    }
  }
}

/**
 * When `serverUrl` has no file of its own and the single-server file is its,
 * copy that file unchanged (the token stays sealed) and remove the old one. A
 * single-server file for another server waits until that server is loaded.
 */
function migrateLegacy(serverUrl, file) {
  if (fs.existsSync(file)) return;
  const legacy = readLegacy();
  if (!legacy || legacy.serverUrl !== serverUrl) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fsSafe.writeFileAtomic(file, legacy.raw);
  } catch {
    logger.warn('cloudSession', `could not move ${legacyPath()} to ${file}`);
    return;
  }
  removeFiles(legacyPath());
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function pickSession(source, token) {
  return {
    serverUrl: source.serverUrl,
    token,
    deviceId: source.deviceId,
    user: source.user,
    workspace: source.workspace,
    device: source.device,
    webOrigin: source.webOrigin || null,
    savedAt: source.savedAt,
  };
}

/**
 * The stored session for `serverUrl`, or null. A file for another server, an
 * unknown version or a token that no longer decrypts all count as absent.
 * Never throws.
 */
function load(serverUrl) {
  if (!serverUrl) return null;
  const held = memory.get(serverUrl);
  if (held) return { ...held, ephemeral: true };
  const file = sessionPath(serverUrl);
  migrateLegacy(serverUrl, file);
  try {
    const { data, error } = fsSafe.readJsonWithRecovery(file);
    if (!data) {
      if (error) logger.warn('cloudSession', `unreadable session file ${file}`);
      return null;
    }
    if (data.version !== VERSION || data.serverUrl !== serverUrl || typeof data.token !== 'string') {
      return null;
    }
    if (!encryptionAvailable()) return null;
    const token = safeStorage.decryptString(Buffer.from(data.token, 'base64'));
    if (!token) return null;
    return { ...pickSession(data, token), ephemeral: false };
  } catch {
    logger.warn('cloudSession', `could not read the stored session at ${file}`);
    return null;
  }
}

/**
 * Persist `session` ({ serverUrl, token, deviceId, user, workspace, device, webOrigin })
 * in its server's file. Returns `{ ephemeral }` — true when it only lives in memory.
 */
function save(session) {
  const record = pickSession({ ...session, savedAt: new Date().toISOString() }, session.token);
  if (!encryptionAvailable()) {
    memory.set(record.serverUrl, record);
    logger.info('cloudSession', 'secure storage unavailable — session kept in memory only');
    return { ephemeral: true };
  }
  const file = sessionPath(record.serverUrl);
  try {
    const encrypted = safeStorage.encryptString(session.token).toString('base64');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fsSafe.writeFileAtomic(file, JSON.stringify({ version: VERSION, ...record, token: encrypted }, null, 2));
    memory.delete(record.serverUrl);
    return { ephemeral: false };
  } catch {
    memory.set(record.serverUrl, record);
    logger.warn('cloudSession', `could not write ${file} — session kept in memory only`);
    return { ephemeral: true };
  }
}

/**
 * Forget `serverUrl`'s session: its file, the fsSafe backup, the memory copy,
 * and the single-server file when that one is this server's too.
 */
function clear(serverUrl) {
  if (!serverUrl) return;
  memory.delete(serverUrl);
  removeFiles(sessionPath(serverUrl));
  const legacy = readLegacy();
  if (legacy && legacy.serverUrl === serverUrl) removeFiles(legacyPath());
}

module.exports = { load, save, clear };
