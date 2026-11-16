/**
 * The archive that carries git-ignored files to Frame Server (server-copy-files T01).
 * Pinned: a round trip keeps paths, modes, bytes and symlinks; anything that
 * could write outside the target folder, or into .git, is refused.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { pack, readEntries, checkEntries } = require('../src/shared/fileArchive');

const file = (p, body = 'x', mode = 0o644) => ({ path: p, type: 'file', mode, data: Buffer.from(body) });
const link = (p, target) => ({ path: p, type: 'symlink', mode: 0o777, target });

test('T01: a round trip keeps paths, modes, bytes and symlinks', () => {
  const bin = Buffer.from([0, 1, 2, 255, 10, 13]);
  const entries = readEntries(pack([
    file('.env', 'SECRET=1\n', 0o600),
    { path: 'certs/dev.pem', type: 'file', mode: 0o400, data: bin },
    file('empty.txt', ''),
    link('config/current', 'dev.json')
  ]));
  assert.deepEqual(entries.map((e) => [e.path, e.type, e.mode, e.size]), [
    ['.env', 'file', 0o600, 9],
    ['certs/dev.pem', 'file', 0o400, 6],
    ['empty.txt', 'file', 0o644, 0],
    ['config/current', 'symlink', 0o777, 0]
  ]);
  assert.equal(entries[0].data.toString(), 'SECRET=1\n');
  assert.ok(entries[1].data.equals(bin));
  assert.equal(entries[3].target, 'dev.json');
  assert.equal(checkEntries(entries), null);
});

test('T01: paths that leave the folder, are absolute or touch .git are refused', () => {
  const bad = [
    ['../outside', 'path leaves its folder'],
    ['a/../../b', 'path is not normalized'],
    ['/etc/passwd', 'absolute path'],
    ['C:/win', 'absolute path'],
    ['a\\b', 'backslash in path'],
    ['./a', 'path is not normalized'],
    ['a//b', 'path is not normalized'],
    ['.git/hooks/pre-commit', 'path inside .git'],
    ['.git', 'path inside .git'],
    ['', 'empty path']
  ];
  for (const [p, reason] of bad) {
    assert.deepEqual(checkEntries([file('ok.txt'), file(p)]), { path: p, reason }, p);
  }
  assert.equal(checkEntries([file('.github/workflows/x.yml'), file('src/.gitkeep')]), null, '.github and .gitkeep are fine');
});

test('T01: symlinks must stay inside the folder and out of .git', () => {
  assert.equal(checkEntries([link('a/b', '../c')]), null, 'up one level is still inside');
  assert.deepEqual(checkEntries([link('a/b', '../../etc/passwd')]), { path: 'a/b', reason: 'symlink points outside' });
  assert.deepEqual(checkEntries([link('x', '/etc/passwd')]), { path: 'x', reason: 'symlink points outside' });
  assert.deepEqual(checkEntries([link('x', '.git/config')]), { path: 'x', reason: 'symlink points into .git' });
});

test('T01: duplicates, unknown types and bad modes are refused', () => {
  assert.equal(checkEntries([file('a'), file('a')]).reason, 'duplicate path');
  assert.equal(checkEntries([{ path: 'd', type: 'dir', mode: 0o755 }]).reason, 'unknown entry type');
  assert.equal(checkEntries([{ path: 'a', type: 'file', mode: 0o17777, data: Buffer.alloc(0) }]).reason, 'bad file mode');
});

test('T01: a foreign, truncated or corrupt archive is not read', () => {
  assert.throws(() => readEntries(Buffer.from('not gzip')), /readable/);
  assert.throws(() => readEntries(zlib.gzipSync(Buffer.from('tar or something'))), /Not a Frame file archive/);
  const good = zlib.gunzipSync(pack([file('a.txt', 'hello world')]));
  assert.throws(() => readEntries(zlib.gzipSync(good.subarray(0, good.length - 3))), /truncated/);
});
