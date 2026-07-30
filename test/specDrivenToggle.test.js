/**
 * Spec-Driven Development flag tests.
 *
 * The toggle used to move two things together: the flag in
 * `.frame/config.json` and a managed section in the project's root
 * `AGENTS.md`. Since the overlay there is no per-project instruction file to
 * edit — Frame's conventions are one shared copy — so the toggle is a config
 * write and nothing more, and what an agent is actually told is decided at
 * launch by `contextPreamble` reading the flag.
 *
 * These tests pin both halves of that contract: the write touches only the
 * config, and the preamble's behaviour follows the flag in both directions.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const frameProject = require('../src/main/frameProject');
const templates = require('../src/shared/frameTemplates');
const { compose } = require('../src/shared/contextPreamble');

const GLOBAL = '/userData/frame-global/AGENTS.md';

function makeProject({ specDriven, agents }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specdriven-'));
  fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
  const config = templates.getFrameConfigTemplate('demo');
  config.features.specDriven = specDriven;
  fs.writeFileSync(
    path.join(dir, '.frame', 'config.json'),
    JSON.stringify(config, null, 2),
    'utf8'
  );
  if (agents !== undefined) fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents, 'utf8');
  return dir;
}

function snapshot(dir) {
  const out = new Map();
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relPath);
      else out.set(relPath, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  walk(dir, '');
  return out;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── the flag ─────────────────────────────────────────────────

test('new projects get Spec-Driven Development on by default', () => {
  assert.equal(templates.getFrameConfigTemplate('demo').features.specDriven, true);
});

test('enable flips the flag and reports success', () => {
  const dir = makeProject({ specDriven: false });
  try {
    const result = frameProject.enableSpecDriven(dir);
    assert.ok(result.success);
    assert.equal(frameProject.isSpecDrivenEnabled(dir), true);
  } finally {
    cleanup(dir);
  }
});

test('disable flips it back and never deletes specs on disk', () => {
  const dir = makeProject({ specDriven: true });
  try {
    const specDir = path.join(dir, '.frame', 'specs', 'a-spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '# mine\n');

    const result = frameProject.disableSpecDriven(dir);
    assert.ok(result.success);
    assert.equal(frameProject.isSpecDrivenEnabled(dir), false);
    assert.equal(fs.readFileSync(path.join(specDir, 'spec.md'), 'utf8'), '# mine\n');
  } finally {
    cleanup(dir);
  }
});

test('the round trip is idempotent and self-reporting', () => {
  const dir = makeProject({ specDriven: true });
  try {
    assert.equal(frameProject.enableSpecDriven(dir).alreadyEnabled, true);
    frameProject.disableSpecDriven(dir);
    assert.equal(frameProject.disableSpecDriven(dir).alreadyDisabled, true);
    assert.equal(frameProject.enableSpecDriven(dir).alreadyEnabled, undefined);
  } finally {
    cleanup(dir);
  }
});

test('neither direction works on a non-Frame project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-nonproject-'));
  try {
    assert.equal(frameProject.enableSpecDriven(dir).success, false);
    assert.equal(frameProject.disableSpecDriven(dir).success, false);
  } finally {
    cleanup(dir);
  }
});

// ─── nothing but the flag ─────────────────────────────────────

test("disabling does not touch the repository's own AGENTS.md", () => {
  const mine = '# Our conventions\n\n## Spec-Driven Development\n\nWe do it our way.\n';
  const dir = makeProject({ specDriven: true, agents: mine });
  try {
    frameProject.disableSpecDriven(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), mine);
  } finally {
    cleanup(dir);
  }
});

test("enabling does not write into the repository's own AGENTS.md", () => {
  const mine = '# Our conventions\n';
  const dir = makeProject({ specDriven: false, agents: mine });
  try {
    frameProject.enableSpecDriven(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), mine);
  } finally {
    cleanup(dir);
  }
});

test('enabling writes nothing outside .frame/', () => {
  const dir = makeProject({ specDriven: false, agents: '# Our conventions\n' });
  try {
    const before = snapshot(dir);
    frameProject.enableSpecDriven(dir);
    const after = snapshot(dir);

    for (const [rel, hash] of before) {
      if (rel === '.frame/config.json') continue; // the flag itself
      assert.equal(after.get(rel), hash, `${rel} changed`);
    }
    const created = [...after.keys()].filter((p) => !before.has(p) && !p.startsWith('.frame/'));
    assert.deepEqual(created, [], `enable wrote outside .frame/: ${created.join(', ')}`);
  } finally {
    cleanup(dir);
  }
});

test('disabling writes only the config', () => {
  const dir = makeProject({ specDriven: true, agents: '# Our conventions\n' });
  try {
    const before = snapshot(dir);
    frameProject.disableSpecDriven(dir);
    const after = snapshot(dir);

    const changed = [...after.keys()].filter((p) => after.get(p) !== before.get(p));
    assert.deepEqual(changed, ['.frame/config.json']);
  } finally {
    cleanup(dir);
  }
});

// ─── what the agent is actually told ──────────────────────────

test('the flag decides the preamble, in both directions', () => {
  const on = compose({ globalPath: GLOBAL, toolId: 'claude', specDriven: true });
  assert.ok(/Spec-driven development is active/.test(on));

  const off = compose({ globalPath: GLOBAL, toolId: 'claude', specDriven: false });
  assert.ok(!/spec/i.test(off), 'a project with the workflow off must hear nothing about specs');
});

test('the shared global core carries no spec section for the flag to contradict', () => {
  const core = templates.getAgentsTemplate('Frame', { global: true, referencePath: 'REFERENCE.md' });
  assert.ok(!/Spec-Driven Development/.test(core));
});

test('the reference still documents the protocol unconditionally', () => {
  // Documentation, not an instruction to act — it is only reached when the
  // preamble points at it, which happens only when the flag is on.
  assert.ok(/Spec-Driven Development/.test(templates.getReferenceTemplate('Frame')));
});
