/**
 * Spec status repair tests (spec-status-repair, issue #122).
 *
 * The reported failure: Frame's own conductor agent wrote five spec folders
 * with `title`, `phase` and timestamps — the fields the staged templates name
 * — and the spec panel listed none of them, with no error anywhere. These
 * tests pin the two halves of the fix: what the folder itself can answer is
 * repaired, and what it cannot is shown rather than dropped.
 *
 * The rule these tests exist to protect: an existing slug is never rewritten.
 * Folder and slug disagreeing is a rename, and silently "fixing" it would cut
 * every `source: spec:<slug>:T##` link in tasks.json.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const specManager = require('../src/main/specManager');

let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-spec-repair-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function specDir(slug) {
  const dir = path.join(projectDir, '.frame', 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A spec folder as Frame's conductor writes it: no slug, no task ids. */
function writeConductorSpec(slug, extra = {}) {
  const dir = specDir(slug);
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '# tasks\n');
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
    title: 'Converted from the backlog',
    phase: 'tasks_generated',
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:10:00Z',
    last_phase_at: '2026-08-25T00:10:00Z',
    ...extra
  }, null, 2));
  return dir;
}

function readStatus(slug) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, '.frame', 'specs', slug, 'status.json'), 'utf8'));
}

test('a spec written without slug or generated_task_ids is listed, not hidden', () => {
  writeConductorSpec('convert-backlog');

  const specs = specManager.listSpecs(projectDir);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].slug, 'convert-backlog');
  assert.equal(specs[0].title, 'Converted from the backlog');
  assert.equal(specs[0].malformed, undefined);
});

test('the repair is persisted, so the rest of Frame reads what the panel accepted', () => {
  writeConductorSpec('convert-backlog');

  specManager.listSpecs(projectDir);

  const status = readStatus('convert-backlog');
  assert.equal(status.slug, 'convert-backlog');
  assert.deepEqual(status.generated_task_ids, []);
  // Fields it had are untouched.
  assert.equal(status.title, 'Converted from the backlog');
  assert.equal(status.created_at, '2026-08-25T00:00:00Z');
});

test('an existing slug is never overwritten by the folder name', () => {
  // A hand-renamed folder: slug and folder disagree. Rewriting the slug here
  // would silently orphan every task carrying `source: spec:original-name:T##`.
  writeConductorSpec('renamed-folder', { slug: 'original-name', generated_task_ids: ['task-1'] });

  const specs = specManager.listSpecs(projectDir);

  assert.equal(specs[0].slug, 'original-name');
  assert.equal(readStatus('renamed-folder').slug, 'original-name');
});

test('repairSpecStatus reports what it filled and leaves valid input alone', () => {
  const bare = { title: 'T', phase: 'draft' };
  const repaired = specManager.repairSpecStatus(bare, 'my-spec');
  assert.deepEqual(repaired.filled, ['slug', 'generated_task_ids']);
  assert.equal(repaired.status.slug, 'my-spec');

  const complete = { slug: 'a', title: 'T', phase: 'draft', generated_task_ids: [] };
  const untouched = specManager.repairSpecStatus(complete, 'a');
  assert.deepEqual(untouched.filled, []);
  assert.equal(untouched.status, complete, 'the same object comes back, so callers skip the write');
});

test('what cannot be derived is surfaced with its reason instead of skipped', () => {
  const dir = specDir('broken-phase');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
    title: 'Half written',
    phase: 'whatever-this-is'
  }, null, 2));

  const specs = specManager.listSpecs(projectDir);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].slug, 'broken-phase');
  assert.match(specs[0].malformed, /invalid phase/);
  assert.equal(specs[0].phase, null, 'no phase — nothing may mistake it for a live one');
  assert.equal(specs[0].task_count, 0);
});

test('a spec folder with no readable status.json is surfaced too', () => {
  const dir = specDir('no-status');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');

  const specs = specManager.listSpecs(projectDir);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].slug, 'no-status');
  assert.match(specs[0].malformed, /missing or unreadable/);
});

test('a directory holding no spec artifact is not a spec and stays invisible', () => {
  const dir = specDir('.backup-of-something');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'scratch\n');

  assert.deepEqual(specManager.listSpecs(projectDir), []);
});

test('valid specs are listed exactly as before and their file is not rewritten', () => {
  const dir = specDir('already-fine');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
    slug: 'already-fine',
    title: 'Already fine',
    phase: 'specified',
    generated_task_ids: [],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z'
  }, null, 2));
  const before = fs.statSync(path.join(dir, 'status.json')).mtimeMs;

  const specs = specManager.listSpecs(projectDir);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].malformed, undefined);
  assert.equal(specs[0].phase, 'specified');
  assert.equal(fs.statSync(path.join(dir, 'status.json')).mtimeMs, before, 'no write for a valid spec');
});

test('a phase advance works on a spec that was never repaired', () => {
  writeConductorSpec('advance-me');

  const result = specManager.updateSpecStatus(projectDir, 'advance-me', { phase: 'implementing' });

  assert.equal(result.error, undefined, `expected no validation error, got ${result.error}`);
  assert.equal(result.status.phase, 'implementing');
  assert.equal(result.status.slug, 'advance-me');
});
