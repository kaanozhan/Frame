/**
 * structure-read tests (STR-02 T02): the freshness contract every consumer
 * reads — fresh, dirty, stale and unknown, signature and digest checks,
 * legacy maps, ownership, and strictly read-only behavior.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { readDescriptor, readStructure, artifactSignature, lifecyclePath, DEFAULT_LEASE_MS } = require('../scripts/structure-read');

const OBSERVED = Date.parse('2026-09-26T12:00:00.000Z');
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-read-'));
  fs.mkdirSync(path.join(root, '.frame', 'runtime', 'structure'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const mapFile = () => path.join(root, '.frame', 'STRUCTURE.json');
const MAP = { version: '1.1', modules: { a: { file: 'a.js' } }, generation: { inventory: { coverage: 'complete' }, extraction: { coverage: 'complete' }, revision: 'rev-map' } };

function writeMap(content = MAP) {
  fs.writeFileSync(mapFile(), typeof content === 'string' ? content : JSON.stringify(content));
}

/** A receipt matching the map currently on disk, with optional overrides. */
function writeReceipt({ receipt = {}, epoch = { requested: 3, applied: 3 }, dirty = [] } = {}) {
  const bytes = fs.readFileSync(mapFile());
  const state = {
    version: 1,
    checkout: root,
    epoch,
    dirty,
    receipt: {
      view: 'working-tree',
      revision: 'rev-receipt',
      artifactDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
      artifactStat: artifactSignature(fs.lstatSync(mapFile())),
      sourceDigest: 's', policyDigest: 'p', curationDigest: 'c',
      observedAt: new Date(OBSERVED).toISOString(),
      leaseMs: 90000,
      coverage: 'complete',
      extraction: 'complete',
      ...receipt
    }
  };
  fs.writeFileSync(lifecyclePath(root), JSON.stringify(state));
}

const at = (offsetMs) => ({ now: () => OBSERVED + offsetMs });

test('fresh: matching receipt, nothing pending, complete coverage, lease valid', () => {
  writeMap();
  writeReceipt();
  const d = readDescriptor(root, at(1000));
  assert.equal(d.freshness, 'fresh');
  assert.deepEqual(d.reasons, []);
  assert.equal(d.view, 'working-tree');
  assert.equal(d.revision, 'rev-receipt');
  assert.equal(d.coverage, 'complete');
  assert.equal(d.observedAt, '2026-09-26T12:00:00.000Z');
  assert.equal(d.map, undefined, 'the descriptor never parses the map');

  const s = readStructure(root, at(1000));
  assert.equal(s.freshness, 'fresh');
  assert.deepEqual(s.map, MAP);
});

test('dirty: a pending epoch or recorded dirty reasons', () => {
  writeMap();
  writeReceipt({ epoch: { requested: 4, applied: 3 } });
  assert.deepEqual([readDescriptor(root, at(0)).freshness, readDescriptor(root, at(0)).reasons], ['dirty', ['pending-changes']]);
  writeReceipt({ dirty: ['file-event', 'config-changed'] });
  const d = readDescriptor(root, at(0));
  assert.equal(d.freshness, 'dirty');
  assert.deepEqual(d.reasons, ['file-event', 'config-changed']);
});

test('stale: an expired lease or incomplete coverage', () => {
  writeMap();
  writeReceipt();
  const expired = readDescriptor(root, at(90001));
  assert.equal(expired.freshness, 'stale');
  assert.deepEqual(expired.reasons, ['lease-expired']);

  writeReceipt({ receipt: { coverage: 'partial' } });
  const partial = readDescriptor(root, at(0));
  assert.equal(partial.freshness, 'stale');
  assert.deepEqual(partial.reasons, ['incomplete-coverage']);

  writeReceipt({ receipt: { leaseMs: undefined } });
  assert.equal(readDescriptor(root, at(DEFAULT_LEASE_MS - 1)).freshness, 'fresh', 'default lease applies');
  assert.equal(readDescriptor(root, at(DEFAULT_LEASE_MS + 1)).freshness, 'stale');
});

test('unknown: no receipt, a legacy map, or an artifact that changed since the receipt', () => {
  writeMap({ version: '1.0', modules: {} });
  const legacy = readStructure(root, at(0));
  assert.equal(legacy.freshness, 'unknown');
  assert.deepEqual(legacy.reasons, ['no-receipt']);
  assert.equal(legacy.revision, null);
  assert.deepEqual(legacy.map, { version: '1.0', modules: {} }, 'still readable');

  writeMap();
  writeReceipt();
  writeMap({ ...MAP, modules: { b: { file: 'b.js' } } }); // e.g. a checkout replaced it
  const changed = readDescriptor(root, at(0));
  assert.equal(changed.freshness, 'unknown');
  assert.deepEqual(changed.reasons, ['artifact-changed']);
});

test('a same-size rewrite with a matching stat is still caught by the digest in readStructure', () => {
  writeMap();
  writeReceipt();
  const stat = fs.lstatSync(mapFile());
  const swapped = JSON.stringify(MAP).replace('"a.js"', '"z.js"');
  fs.writeFileSync(mapFile(), swapped);
  fs.utimesSync(mapFile(), stat.atime, stat.mtime);
  // patch the receipt's stat so only the content differs
  const state = JSON.parse(fs.readFileSync(lifecyclePath(root), 'utf8'));
  state.receipt.artifactStat = artifactSignature(fs.lstatSync(mapFile()));
  fs.writeFileSync(lifecyclePath(root), JSON.stringify(state));

  assert.equal(readDescriptor(root, at(0)).freshness, 'fresh', 'the cheap path trusts the signature');
  const full = readStructure(root, at(0));
  assert.equal(full.freshness, 'unknown');
  assert.deepEqual(full.reasons, ['artifact-changed']);
});

test('a receipt from another view is not a working-tree verification', () => {
  writeMap();
  writeReceipt({ receipt: { view: 'git-index' } });
  const d = readDescriptor(root, at(0));
  assert.equal(d.freshness, 'unknown');
  assert.deepEqual(d.reasons, ['not-working-tree']);
});

test('missing and unparseable maps are unknown, never errors', () => {
  const missing = readStructure(root, at(0));
  assert.equal(missing.freshness, 'unknown');
  assert.deepEqual(missing.reasons, ['missing-map']);
  assert.equal(missing.map, null);

  writeMap('{ corrupt');
  const corrupt = readStructure(root, at(0));
  assert.equal(corrupt.freshness, 'unknown');
  assert.deepEqual(corrupt.reasons, ['map-unparseable']);
});

test('without a receipt, revision and coverage come from the map itself', () => {
  writeMap();
  const s = readStructure(root, at(0));
  assert.equal(s.revision, 'rev-map');
  assert.equal(s.coverage, 'complete');
  assert.equal(s.extraction, 'complete');
  assert.equal(s.freshness, 'unknown');
});

test('ownership follows the STR-01 rule: an unowned root map is never read', () => {
  fs.writeFileSync(path.join(root, 'STRUCTURE.json'), JSON.stringify({ modules: { user: { file: 'u.js' } } }));
  assert.deepEqual(readStructure(root, at(0)).reasons, ['missing-map']);
  fs.writeFileSync(path.join(root, '.frame', 'config.json'), JSON.stringify({ files: { structure: 'STRUCTURE.json' } }));
  const owned = readStructure(root, at(0));
  assert.equal(owned.path, path.join(root, 'STRUCTURE.json'));
  assert.ok(owned.map.modules.user);
});

test('reading writes nothing and the module uses built-ins only', () => {
  writeMap();
  writeReceipt();
  const snapshot = () => {
    const out = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d).sort()) {
        const abs = path.join(d, name);
        const st = fs.statSync(abs);
        out.push(`${abs}:${st.size}:${st.mtimeMs}`);
        if (st.isDirectory()) walk(abs);
      }
    };
    walk(root);
    return out;
  };
  const before = snapshot();
  readDescriptor(root, at(0));
  readStructure(root, at(999999));
  assert.deepEqual(snapshot(), before);

  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'structure-read.js'), 'utf8');
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(requires, ['crypto', 'fs', 'path']);
});

test('a missed bound is exposed; generation notes come from the map and the attempt record', () => {
  const { generationNotes } = require('../scripts/structure-read');
  writeMap();
  writeReceipt();
  const state = JSON.parse(fs.readFileSync(lifecyclePath(root), 'utf8'));
  state.missedBound = { reason: 'changing-files', at: '2026-09-26T12:00:00.000Z' };
  fs.writeFileSync(lifecyclePath(root), JSON.stringify(state));
  assert.deepEqual(readDescriptor(root, at(0)).missedBound, { reason: 'changing-files', at: '2026-09-26T12:00:00.000Z' });

  assert.deepEqual(generationNotes(root, { generation: { inventory: { coverage: 'partial', reasons: ['timeout'] } } }), ['covers only part of the project (timeout)']);
  fs.writeFileSync(path.join(root, '.frame', 'runtime', 'structure', 'scan.json'), JSON.stringify({ state: 'failed', reason: 'E_BOOM' }));
  assert.deepEqual(generationNotes(root, MAP), ['is from an earlier scan — the latest one failed (E_BOOM)']);
});
