/**
 * globalLayer tests (T06): Frame's instructions exist once, outside every
 * project, and an upgrade never costs the user their additions.
 *
 * `userData` is injected rather than read from Electron, so these run against
 * a temp directory with no app involved.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const globalLayer = require('../src/main/globalLayer');
const templates = require('../src/shared/frameTemplates');
const managedBlock = require('../src/shared/docsManagedBlock');

let userData;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-global-'));
  globalLayer.init(userData);
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

// ─── first render ─────────────────────────────────────────────

test('ensure creates both files under userData/frame-global', () => {
  const result = globalLayer.ensure();
  assert.deepEqual(result, { agents: 'created', reference: 'created' });

  assert.equal(globalLayer.dirPath(), path.join(userData, 'frame-global'));
  assert.ok(fs.existsSync(globalLayer.agentsPath()));
  assert.ok(fs.existsSync(globalLayer.referencePath()));
  assert.deepEqual(fs.readdirSync(globalLayer.dirPath()).sort(), ['AGENTS.md', 'REFERENCE.md']);
});

test('the global core is project-independent', () => {
  globalLayer.ensure();
  const agents = fs.readFileSync(globalLayer.agentsPath(), 'utf8');

  assert.ok(!/Project Facts/.test(agents), 'the global copy states facts about no project');
  assert.ok(!/Creation date/.test(agents), 'a creation stamp belongs to a per-project file');
  assert.ok(!/symlink/.test(agents), 'the overlay never plants a CLAUDE.md symlink');
  assert.ok(/every project/.test(agents), 'the copy does not say it is global');
});

test('the global core carries no spec section; REFERENCE carries the protocol', () => {
  globalLayer.ensure();
  const agents = fs.readFileSync(globalLayer.agentsPath(), 'utf8');
  const reference = fs.readFileSync(globalLayer.referencePath(), 'utf8');

  // A project with spec-driven off must find no instruction to write specs.
  assert.ok(!/Spec-Driven Development/.test(agents));
  assert.ok(/Spec-Driven Development/.test(reference));
  assert.ok(managedBlock.findBlock(reference), 'the spec protocol is not in a managed block');
});

test('ensure is idempotent', () => {
  globalLayer.ensure();
  const before = fs.readFileSync(globalLayer.agentsPath(), 'utf8');

  assert.deepEqual(globalLayer.ensure(), { agents: 'current', reference: 'current' });
  assert.equal(fs.readFileSync(globalLayer.agentsPath(), 'utf8'), before);
});

// ─── upgrades ─────────────────────────────────────────────────

test('an out-of-date managed block is upgraded in place', () => {
  globalLayer.ensure();

  const current = fs.readFileSync(globalLayer.referencePath(), 'utf8');
  const stale = current.replace(
    new RegExp(`<!--\\s*${managedBlock.BLOCK_NAME}\\s+v=\\d+\\s*-->[\\s\\S]*?${managedBlock.END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    managedBlock.renderBlock('## Spec-Driven Development\n\nold body\n', 0)
  );
  fs.writeFileSync(globalLayer.referencePath(), stale, 'utf8');
  assert.ok(/old body/.test(fs.readFileSync(globalLayer.referencePath(), 'utf8')), 'fixture');

  assert.equal(globalLayer.ensure().reference, 'upgraded');
  const after = fs.readFileSync(globalLayer.referencePath(), 'utf8');
  assert.ok(!/old body/.test(after));
  assert.equal(managedBlock.findBlock(after).version, templates.SPEC_SECTION_VERSION);
});

test("an upgrade preserves the user's own additions", () => {
  globalLayer.ensure();

  const current = fs.readFileSync(globalLayer.referencePath(), 'utf8');
  const stale = current.replace(
    new RegExp(`<!--\\s*${managedBlock.BLOCK_NAME}\\s+v=\\d+\\s*-->[\\s\\S]*?${managedBlock.END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    managedBlock.renderBlock('## Spec-Driven Development\n\nold body\n', 0)
  );
  const mine = '\n\n## My team rules\n\nAlways run the linter before committing.\n';
  fs.writeFileSync(globalLayer.referencePath(), stale + mine, 'utf8');

  assert.equal(globalLayer.ensure().reference, 'upgraded');
  const after = fs.readFileSync(globalLayer.referencePath(), 'utf8');
  assert.ok(after.includes('## My team rules'), 'a user addition was flattened');
  assert.ok(after.includes('Always run the linter before committing.'));
});

test('a file the user rewrote wholesale is never regenerated', () => {
  globalLayer.ensure();
  fs.writeFileSync(globalLayer.agentsPath(), '# Mine now\n', 'utf8');

  assert.equal(globalLayer.ensure().agents, 'current');
  assert.equal(fs.readFileSync(globalLayer.agentsPath(), 'utf8'), '# Mine now\n');
});

test('a deleted file comes back on the next ensure', () => {
  globalLayer.ensure();
  fs.unlinkSync(globalLayer.referencePath());

  assert.equal(globalLayer.ensure().reference, 'created');
  assert.ok(fs.existsSync(globalLayer.referencePath()));
});

// ─── one copy, not per project ────────────────────────────────

test('two projects share one copy — nothing is written into either tree', () => {
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-proj-a-'));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-proj-b-'));
  try {
    globalLayer.ensure();
    globalLayer.ensure();

    assert.deepEqual(fs.readdirSync(projectA), []);
    assert.deepEqual(fs.readdirSync(projectB), []);
    assert.equal(fs.readdirSync(globalLayer.dirPath()).length, 2);
  } finally {
    fs.rmSync(projectA, { recursive: true, force: true });
    fs.rmSync(projectB, { recursive: true, force: true });
  }
});

test('ensure without init reports the error instead of throwing', () => {
  globalLayer.init(null);
  const result = globalLayer.ensure();
  assert.equal(result.agents, 'error');
  assert.ok(result.error);
});
