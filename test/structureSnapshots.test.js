/**
 * structure-snapshot tests (STR-02 T03): content identity for the working
 * tree — stat-gated reuse versus full hashing, mixed observations while
 * files change, the content-keyed extraction cache and its size bound, and
 * stability of digests and revisions across no-op runs.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { discover } = require('../scripts/structure-discovery');
const { buildFull, serializeStructure } = require('../scripts/structure-generation');
const snapshot = require('../scripts/structure-snapshot');

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-snapshot-'));
  // every Frame project already has .frame/ (config.json); the runtime cache
  // lives inside it and is never part of the inventory
  fs.mkdirSync(path.join(root, '.frame'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function scaffold(files) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('a first observation hashes every file; an unchanged tree reuses every hash', () => {
  scaffold({ 'src/a.js': '// A', 'src/b.js': '// B', 'README.md': '# R' });
  const first = snapshot.observe(root, discover(root));
  assert.equal(first.hashed, 3);
  assert.equal(first.reused, 0);
  assert.deepEqual(first.changed.sort(), ['README.md', 'src/a.js', 'src/b.js']);
  assert.equal(first.manifest.entries['src/a.js'].sha256, sha('// A'));

  const second = snapshot.observe(root, discover(root), { manifest: first.manifest });
  assert.equal(second.hashed, 0);
  assert.equal(second.reused, 3);
  assert.deepEqual(second.changed, []);
  assert.equal(second.sourceDigest, first.sourceDigest);
});

test('only full hashing catches an edit that kept every stat field', () => {
  scaffold({ 'src/a.js': '// A' });
  const first = snapshot.observe(root, discover(root));
  // Simulate an edit the stat cannot see: the recorded hash is out of date
  // while size/mtime/ctime/ino are identical.
  const stale = JSON.parse(JSON.stringify(first.manifest));
  stale.entries['src/a.js'].sha256 = sha('// something else');

  const gated = snapshot.observe(root, discover(root), { manifest: stale });
  assert.deepEqual(gated.changed, [], 'stat-gated reuse trusts the stat');
  const full = snapshot.observe(root, discover(root), { manifest: stale, fullHash: true });
  assert.deepEqual(full.changed, ['src/a.js']);
  assert.equal(full.manifest.entries['src/a.js'].sha256, sha('// A'));
});

test('a real edit, an addition and a deletion are reported', () => {
  scaffold({ 'src/a.js': '// A', 'src/b.js': '// B' });
  const first = snapshot.observe(root, discover(root));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), '// A, longer now');
  fs.rmSync(path.join(root, 'src', 'b.js'));
  scaffold({ 'src/c.js': '// C' });
  const next = snapshot.observe(root, discover(root), { manifest: first.manifest });
  assert.deepEqual(next.changed.sort(), ['src/a.js', 'src/c.js']);
  assert.deepEqual(next.removed, ['src/b.js']);
  assert.notEqual(next.sourceDigest, first.sourceDigest);
});

test('a file that changes or vanishes while being observed marks the observation mixed', () => {
  scaffold({ 'src/a.js': '// A', 'src/b.js': '// B', 'src/c.js': '// C' });
  const found = discover(root);
  fs.rmSync(path.join(root, 'src', 'c.js')); // listed by discovery, gone before hashing
  const racing = { ...fs, readSync: (fd, buf, off, len, pos) => {
    const n = fs.readSync(fd, buf, off, len, pos);
    if (n > 0 && buf.subarray(off, off + n).toString().startsWith('// A')) {
      fs.writeFileSync(path.join(root, 'src', 'a.js'), '// A edited mid-read, different size');
    }
    return n;
  } };
  const result = snapshot.observe(root, found, { fs: racing });
  assert.deepEqual(result.mixed.sort(), ['src/a.js', 'src/c.js']);
  assert.ok(!('src/a.js' in result.manifest.entries), 'a mixed file is not recorded as observed');
  assert.ok(result.manifest.entries['src/b.js']);
  assert.deepEqual(result.removed, [], 'mixed paths are not reported as deletions');
});

test('files above the parse limit are identified by stat, not hashed', () => {
  scaffold({ 'big.txt': 'x'.repeat(200), 'small.txt': 'y' });
  const result = snapshot.observe(root, discover(root, { structure: { limits: { maxParseBytes: 100 } } }));
  assert.match(result.manifest.entries['big.txt'].sha256, /^stat:200:/);
  assert.equal(result.hashed, 1);
});

test('shouldStop ends the observation as stopped without reporting deletions', () => {
  scaffold({ 'a.js': '1', 'b.js': '2' });
  const first = snapshot.observe(root, discover(root));
  let calls = 0;
  const result = snapshot.observe(root, discover(root), { manifest: first.manifest, shouldStop: () => ++calls > 1 });
  assert.equal(result.stopped, true);
  assert.deepEqual(result.removed, []);
});

test('the manifest round-trips and a corrupt one is recomputed', () => {
  scaffold({ 'a.js': '1' });
  const result = snapshot.observe(root, discover(root));
  snapshot.saveManifest(root, result.manifest);
  assert.deepEqual(snapshot.loadManifest(root).entries, result.manifest.entries);
  fs.writeFileSync(snapshot.manifestPath(root), '{ corrupt');
  assert.deepEqual(snapshot.loadManifest(root).entries, {});
});

/* ----------------------------- extraction cache ----------------------------- */

function buildWithCache(manifest, prior = null, cacheOptions = {}) {
  const cache = snapshot.createExtractionCache(root, manifest, cacheOptions);
  const { structure } = buildFull({ rootDir: root, discovery: discover(root), prior, extract: cache.extract });
  return { cache, text: serializeStructure(structure, prior, '2026-09-26') };
}

test('cached extraction produces the same map bytes as a cold build', () => {
  scaffold({ 'src/a.js': '// Alpha\nfunction f() {}\nmodule.exports = { f };', 'src/b.py': '"""Beta."""\n', 'notes.txt': 'n' });
  const obs = snapshot.observe(root, discover(root));
  const cold = buildWithCache(obs.manifest);
  assert.equal(cold.cache.stats.hits, 0);
  // notes.txt has no extractor: nothing is read, so nothing needs caching
  assert.equal(cold.cache.stats.stored, 2);

  const warm = buildWithCache(obs.manifest);
  assert.equal(warm.cache.stats.hits, 2);
  assert.equal(warm.cache.stats.misses, 1);
  assert.equal(warm.text, cold.text);

  const plain = buildFull({ rootDir: root, discovery: discover(root), prior: null });
  assert.equal(serializeStructure(plain.structure, null, '2026-09-26'), cold.text);
});

test('the cache key covers content, extractor sources and the parse limit', () => {
  scaffold({ 'src/a.js': '// Alpha' });
  const obs = snapshot.observe(root, discover(root));
  buildWithCache(obs.manifest);
  const cache = snapshot.createExtractionCache(root, obs.manifest);
  const record = discover(root).files[0];
  cache.extract(record, { rootDir: root, maxParseBytes: 1234 });
  assert.equal(cache.stats.misses, 1, 'a different parse limit is a different key');
  assert.match(snapshot.extractorsDigest(), /^[0-9a-f]{64}$/);
});

test('bytes that changed after hashing are never cached under the old hash', () => {
  scaffold({ 'src/a.js': '// Alpha' });
  const obs = snapshot.observe(root, discover(root));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), '// Changed after hashing');
  const { cache } = buildWithCache(obs.manifest);
  assert.deepEqual(cache.mixed, ['src/a.js']);
  assert.equal(cache.stats.stored, 0);
  assert.ok(!fs.existsSync(snapshot.cacheDir(root)) || fs.readdirSync(snapshot.cacheDir(root)).length === 0);
});

test('transient read errors are not cached', () => {
  scaffold({ 'src/a.js': '// Alpha' });
  const obs = snapshot.observe(root, discover(root));
  const failing = { ...fs, readFileSync: (p, ...rest) => {
    if (String(p).endsWith(`${path.sep}a.js`)) { const e = new Error('EIO'); e.code = 'EIO'; throw e; }
    return fs.readFileSync(p, ...rest);
  } };
  const cache = snapshot.createExtractionCache(root, obs.manifest, { fs: failing });
  const result = cache.extract(discover(root).files[0], { rootDir: root });
  assert.equal(result.extraction.reason, 'read-error');
  assert.equal(cache.stats.stored, 0);
});

test('prune evicts least-recently-used entries down to the bound', () => {
  const files = {};
  for (let i = 0; i < 6; i++) files[`src/m${i}.js`] = `// Module ${i}\n${'x'.repeat(50)}`;
  scaffold(files);
  const obs = snapshot.observe(root, discover(root));
  const { cache } = buildWithCache(obs.manifest);
  const dir = snapshot.cacheDir(root);
  const names = fs.readdirSync(dir).sort();
  assert.equal(names.length, 6);
  // mark recency explicitly: the first two are the most recently used
  names.forEach((name, i) => {
    const t = new Date(Date.UTC(2026, 0, 1) + (i < 2 ? 100000 : i) * 1000);
    fs.utimesSync(path.join(dir, name), t, t);
  });
  const oneEntry = fs.statSync(path.join(dir, names[0])).size;
  const bounded = snapshot.createExtractionCache(root, obs.manifest, { maxBytes: oneEntry * 2 + 1 });
  const { evicted, bytes } = bounded.prune();
  assert.equal(evicted, 4);
  assert.ok(bytes <= oneEntry * 2 + 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), names.slice(0, 2));
  assert.equal(cache.stats.stored, 6);
});

test('no-op observations keep the source digest and the map revision', () => {
  scaffold({ 'src/a.js': '// A', 'docs/x.md': '# X' });
  const one = snapshot.observe(root, discover(root));
  const first = buildWithCache(one.manifest);
  const two = snapshot.observe(root, discover(root), { manifest: one.manifest });
  const second = buildWithCache(two.manifest, JSON.parse(first.text));
  assert.equal(two.sourceDigest, one.sourceDigest);
  assert.equal(JSON.parse(second.text).generation.revision, JSON.parse(first.text).generation.revision);
  assert.equal(second.text, first.text);
});
