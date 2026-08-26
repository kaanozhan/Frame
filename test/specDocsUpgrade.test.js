/**
 * Spec-docs upgrade tests (spec-docs-delivery-invariant T03).
 *
 * The bug this pass closes lived in a branch that never ran, so these tests
 * are deliberately end-to-end over real temp projects rather than unit tests
 * over the string engine: a passing `docsManagedBlock` suite is exactly what
 * shipped alongside the delivery gap.
 *
 * Three properties, one per project state:
 *
 *   - a pointer is never written at a document that will not carry the
 *     protocol, and *is* written once that document does;
 *   - a section Frame cannot prove is its own is never written over;
 *   - a project already at the current version comes out byte-identical.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const frameProject = require('../src/main/frameProject');
const templates = require('../src/shared/frameTemplates');
const managedBlock = require('../src/shared/docsManagedBlock');

// The stale mini-flow the 2026-07-23 matcher fix set out to remove. Its
// presence or absence is the thing every assertion below turns on.
const STALE_MARKER = 'write **exactly one file**';

function makeProject({ agents, reference }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specdocs-'));
  fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
  const config = templates.getFrameConfigTemplate('demo');
  config.features.specDriven = true;
  fs.writeFileSync(path.join(dir, '.frame', 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  // The shipped sections name these two by path, so a fixture without them is
  // not a healthy project — the report would be right to say so.
  fs.writeFileSync(path.join(dir, '.frame', 'tasks.json'), '{"tasks":[]}', 'utf8');
  fs.mkdirSync(path.join(dir, '.frame', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.frame', 'bin', 'implement-launch.js'), '// stub\n', 'utf8');
  if (agents != null) fs.writeFileSync(path.join(dir, '.frame', 'AGENTS.md'), agents, 'utf8');
  if (reference != null) {
    fs.mkdirSync(path.join(dir, '.frame', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.frame', 'docs', 'REFERENCE.md'), reference, 'utf8');
  }
  return dir;
}

const agentsPath = (dir) => path.join(dir, '.frame', 'AGENTS.md');
const referencePath = (dir) => path.join(dir, '.frame', 'docs', 'REFERENCE.md');
const read = (file) => fs.readFileSync(file, 'utf8');

// A project as Frame wrote it before the 2026-07-06 AGENTS/REFERENCE split:
// the whole workflow inline in AGENTS.md, and no reference document at all.
const preSplitAgents = `# demo - Frame Project

Intro prose the user wrote.

---

${templates.LEGACY_SPEC_DRIVEN_SECTION}

---

*This file was automatically created by Frame.*
`;

const currentReference = `# demo — Frame Reference

Intro.

---

${templates.renderSpecSection()}

---

*This file was automatically created by Frame.*
`;

// ─── Rule 1 — a pointer is never written at nothing ───────────

test('a pre-split project keeps its inline workflow while the reference is missing', () => {
  const dir = makeProject({ agents: preSplitAgents });
  const before = read(agentsPath(dir));

  const health = frameProject.upgradeSpecDocs(dir);

  // The stale flow is worse than the current one, but it is not nothing —
  // and replacing it with a pointer at an absent file is nothing. Until the
  // target exists, AGENTS.md is left exactly as it was.
  assert.equal(read(agentsPath(dir)), before);
  assert.ok(read(agentsPath(dir)).includes(STALE_MARKER));
  // The reference is not conjured here; that belongs to the artifact pass.
  assert.equal(fs.existsSync(referencePath(dir)), false);
  // And the break is reported rather than swallowed.
  assert.equal(health.ok, false);
  assert.ok(health.unreadable.some((u) => u.doc.endsWith('REFERENCE.md')));
});

test('once the reference carries the protocol, the pointer replaces the stale flow', () => {
  const dir = makeProject({ agents: preSplitAgents, reference: currentReference });

  frameProject.upgradeSpecDocs(dir);

  const agents = read(agentsPath(dir));
  // The 2026-07-23 removal holds: the stale mini-flow is gone…
  assert.ok(!agents.includes(STALE_MARKER));
  // …and what replaced it is reachable, which is what was missing.
  assert.ok(agents.includes(templates.SPEC_DRIVEN_CORE_SECTION));
  assert.ok(managedBlock.findBlock(agents));
  assert.ok(managedBlock.findBlock(read(referencePath(dir))));
  // Prose outside the section is untouched.
  assert.ok(agents.includes('Intro prose the user wrote.'));
});

// ─── A section Frame cannot prove is its own ──────────────────

test("a hand-written spec section is left alone and reported, in both documents", () => {
  const own = `# demo

Intro.

---

## Spec-driven development — how to suggest

When a significant request appears, ask once before coding.

---

*This file was automatically created by Frame.*
`;
  const dir = makeProject({ agents: own, reference: own });
  const beforeAgents = read(agentsPath(dir));
  const beforeReference = read(referencePath(dir));

  const health = frameProject.upgradeSpecDocs(dir);

  assert.equal(read(agentsPath(dir)), beforeAgents);
  assert.equal(read(referencePath(dir)), beforeReference);
  assert.equal(health.unmatchedSections.length, 2);
  assert.equal(health.ok, false);
});

// ─── A document with no section at all ────────────────────────

test('a reference with no spec section gets one appended, above the footer', () => {
  const bare = `# demo — Frame Reference

## Task Management

The user's own rules.

---

*This file was automatically created by Frame.*
`;
  const dir = makeProject({ agents: preSplitAgents, reference: bare });

  frameProject.upgradeSpecDocs(dir);

  const reference = read(referencePath(dir));
  assert.ok(reference.includes("The user's own rules."));
  assert.ok(managedBlock.findBlock(reference));
  assert.ok(reference.indexOf('frame:managed:spec-section') < reference.indexOf('automatically created by Frame'));
  // With the target now carrying the block, the pointer is allowed through in
  // the same pass — the ordering is what makes that safe.
  assert.ok(!read(agentsPath(dir)).includes(STALE_MARKER));
});

// ─── A healthy project must not move ──────────────────────────

test('a project stamped at the current version comes out byte-identical', () => {
  const agents = `# demo

Intro.

---

${templates.renderSpecCoreSection()}

---

*This file was automatically created by Frame.*
`;
  const dir = makeProject({ agents, reference: currentReference });
  const beforeAgents = read(agentsPath(dir));
  const beforeReference = read(referencePath(dir));

  const health = frameProject.upgradeSpecDocs(dir);

  assert.equal(read(agentsPath(dir)), beforeAgents);
  assert.equal(read(referencePath(dir)), beforeReference);
  assert.equal(health.ok, true);
  assert.deepEqual(health.sections.map((s) => s.state), ['managed', 'managed']);
});

test('upgradeSpecDocs reports nothing for a directory Frame does not manage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-notaproject-'));
  assert.equal(frameProject.upgradeSpecDocs(dir), null);
});

// ─── A pointer whose target exists but names something that does not ──

test('a path the prose names but that is not on disk is reported', () => {
  const agents = `# demo

---

${templates.renderSpecCoreSection()}

---

*This file was automatically created by Frame.*
`;
  const dir = makeProject({ agents, reference: currentReference });
  // The reference tells an agent to run this helper. Take it away and the
  // instruction becomes a dead end — exactly the class of break this pass
  // exists to surface, in a document nothing else is wrong with.
  fs.unlinkSync(path.join(dir, '.frame', 'bin', 'implement-launch.js'));

  const health = frameProject.upgradeSpecDocs(dir);

  assert.deepEqual(health.missingPaths, [
    { doc: '.frame/docs/REFERENCE.md', path: '.frame/bin/implement-launch.js' }
  ]);
  assert.equal(health.ok, false);
  // Nothing is rewritten over it: a missing file is reported, not repaired here.
  assert.deepEqual(health.sections.map((s) => s.state), ['managed', 'managed']);
});
