/**
 * sessionStore tests — Frame Cloud sessions kept per server.
 *
 * The dev Frame and the installed one share userData, so each server's
 * session lives in its own file and neither overwrites the other; the old
 * single-server file moves to its server's file on first load. Electron is
 * stubbed: `app.getPath('userData')` points at a temporary folder and
 * safeStorage seals tokens with a readable prefix, so a test can tell a
 * sealed token from a plain one.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let userData = null;
const vault = { available: true };

const Module = require('node:module');
const EXTERNAL_STUBS = {
  electron: {
    app: { getPath: () => userData },
    safeStorage: {
      isEncryptionAvailable: () => vault.available,
      encryptString: (plain) => Buffer.from(`sealed:${plain}`),
      decryptString: (sealed) => {
        const text = sealed.toString();
        if (!text.startsWith('sealed:')) throw new Error('Error while decrypting the ciphertext');
        return text.slice('sealed:'.length);
      },
    },
  },
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

const STORE = require.resolve('../src/main/cloud/sessionStore');

/** A new module instance: a second Frame, or the same one after a restart. */
function freshStore() {
  delete require.cache[STORE];
  return require(STORE);
}

const PROD = 'https://cloud.example.test';
const LOCAL = 'http://localhost:3000';

function session(serverUrl, token) {
  return {
    serverUrl,
    token,
    deviceId: 'd1',
    user: { name: 'Ada', email: 'ada@example.com' },
    workspace: { name: 'Lab', slug: 'lab' },
    device: { id: 'd1', name: 'Studio' },
    webOrigin: 'https://web.example.test',
  };
}

function sessionsDir() {
  return path.join(userData, 'cloud-sessions');
}

function fileFor(serverUrl) {
  const key = crypto.createHash('sha256').update(serverUrl).digest('hex').slice(0, 16);
  return path.join(sessionsDir(), `${key}.json`);
}

function sessionFiles() {
  try {
    return fs.readdirSync(sessionsDir()).sort();
  } catch {
    return [];
  }
}

function legacyFile() {
  return path.join(userData, 'cloud-session.json');
}

/** A session file as the single-server store wrote it, with its .bak. */
function writeLegacy(serverUrl, token) {
  const { token: _plain, ...rest } = session(serverUrl, token);
  const raw = JSON.stringify(
    { version: 1, ...rest, savedAt: '2026-09-20T10:00:00.000Z', token: Buffer.from(`sealed:${token}`).toString('base64') },
    null,
    2
  );
  fs.writeFileSync(legacyFile(), raw);
  fs.writeFileSync(`${legacyFile()}.bak`, raw);
  return raw;
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-cloud-session-'));
  vault.available = true;
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

test('two Frames on two servers keep their sessions side by side across restarts', () => {
  const installed = freshStore();
  const dev = freshStore();
  assert.deepEqual(installed.save(session(PROD, 'tok-prod')), { ephemeral: false });
  assert.deepEqual(dev.save(session(LOCAL, 'tok-local')), { ephemeral: false });

  assert.deepEqual(sessionFiles(), [path.basename(fileFor(PROD)), path.basename(fileFor(LOCAL))].sort());
  const onDisk = JSON.parse(fs.readFileSync(fileFor(PROD), 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.serverUrl, PROD);
  assert.equal(Buffer.from(onDisk.token, 'base64').toString(), 'sealed:tok-prod', 'the token is sealed at rest');
  assert.ok(!fs.readFileSync(fileFor(PROD), 'utf8').includes('"tok-prod"'));

  const restarted = freshStore();
  const prod = restarted.load(PROD);
  const local = restarted.load(LOCAL);
  assert.equal(prod.token, 'tok-prod');
  assert.equal(prod.ephemeral, false);
  assert.deepEqual(prod.workspace, { name: 'Lab', slug: 'lab' });
  assert.equal(prod.webOrigin, 'https://web.example.test');
  assert.equal(local.token, 'tok-local');
  assert.equal(local.serverUrl, LOCAL);
});

test('clearing one server removes its file, backup and temp file and leaves the other', () => {
  const store = freshStore();
  store.save(session(PROD, 'tok-1'));
  store.save(session(PROD, 'tok-2')); // the second write leaves a .bak
  store.save(session(LOCAL, 'tok-local'));
  fs.writeFileSync(`${fileFor(PROD)}.tmp`, '{');
  assert.ok(fs.existsSync(`${fileFor(PROD)}.bak`));

  store.clear(PROD);

  assert.equal(store.load(PROD), null);
  assert.deepEqual(sessionFiles(), [path.basename(fileFor(LOCAL))]);
  assert.equal(freshStore().load(LOCAL).token, 'tok-local');
});

test('without safeStorage each server keeps its session in memory only', () => {
  vault.available = false;
  const store = freshStore();
  assert.deepEqual(store.save(session(PROD, 'tok-prod')), { ephemeral: true });
  assert.deepEqual(store.save(session(LOCAL, 'tok-local')), { ephemeral: true });
  assert.deepEqual(sessionFiles(), [], 'nothing is written');

  assert.equal(store.load(PROD).token, 'tok-prod');
  assert.equal(store.load(PROD).ephemeral, true);
  assert.equal(store.load(LOCAL).token, 'tok-local');

  store.clear(PROD);
  assert.equal(store.load(PROD), null);
  assert.equal(store.load(LOCAL).token, 'tok-local');

  assert.equal(freshStore().load(LOCAL), null, 'a restart forgets a memory-only session');
});

test('a token that no longer decrypts reads as absent', () => {
  freshStore().save(session(PROD, 'tok-prod'));
  const record = JSON.parse(fs.readFileSync(fileFor(PROD), 'utf8'));
  fs.writeFileSync(fileFor(PROD), JSON.stringify({ ...record, token: Buffer.from('garbage').toString('base64') }));

  assert.equal(freshStore().load(PROD), null);
});

test('a single-server file for the requested server moves to its own file unchanged', () => {
  const raw = writeLegacy(PROD, 'tok-old');

  const loaded = freshStore().load(PROD);

  assert.equal(loaded.token, 'tok-old');
  assert.equal(loaded.ephemeral, false);
  assert.equal(loaded.savedAt, '2026-09-20T10:00:00.000Z');
  assert.equal(fs.readFileSync(fileFor(PROD), 'utf8'), raw, 'copied as-is, token still sealed');
  assert.ok(!fs.existsSync(legacyFile()));
  assert.ok(!fs.existsSync(`${legacyFile()}.bak`));
  assert.equal(freshStore().load(PROD).token, 'tok-old', 'still signed in after the next restart');
});

test('a single-server file for another server is left alone until that server loads', () => {
  writeLegacy(LOCAL, 'tok-local');

  assert.equal(freshStore().load(PROD), null);
  assert.ok(fs.existsSync(legacyFile()));
  assert.deepEqual(sessionFiles(), []);

  assert.equal(freshStore().load(LOCAL).token, 'tok-local');
  assert.ok(!fs.existsSync(legacyFile()));
});

test('a server with its own file ignores the single-server file, and clearing it removes both', () => {
  freshStore().save(session(PROD, 'tok-new'));
  writeLegacy(PROD, 'tok-old');

  const store = freshStore();
  assert.equal(store.load(PROD).token, 'tok-new');
  assert.ok(fs.existsSync(legacyFile()), 'not migrated over a newer session');

  store.clear(PROD);
  assert.equal(store.load(PROD), null);
  assert.ok(!fs.existsSync(legacyFile()));
  assert.ok(!fs.existsSync(`${legacyFile()}.bak`));
});

test('clearing a server leaves a single-server file for another server', () => {
  writeLegacy(LOCAL, 'tok-local');
  freshStore().clear(PROD);
  assert.ok(fs.existsSync(legacyFile()));
});

test('a file is read only for the server it was saved for', () => {
  freshStore().save(session(PROD, 'tok-prod'));
  fs.copyFileSync(fileFor(PROD), fileFor(LOCAL));

  const store = freshStore();
  assert.equal(store.load(LOCAL), null);
  assert.equal(store.load(''), null);
  assert.equal(store.load(PROD).token, 'tok-prod');
});
