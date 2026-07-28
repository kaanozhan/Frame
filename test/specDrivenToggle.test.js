/**
 * Spec-Driven Development flag tests.
 *
 * Covers the default-on contract for new projects and the enable/disable
 * round-trip that Settings → Workflow drives: the flag in .frame/config.json
 * and the Frame-managed spec section in AGENTS.md move together, while
 * anything the user wrote around them survives untouched.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const frameProject = require('../src/main/frameProject');
const templates = require('../src/shared/frameTemplates');
const managedBlock = require('../src/shared/docsManagedBlock');

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
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents, 'utf8');
  return dir;
}

function readAgents(dir) {
  return fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
}

test('new projects get Spec-Driven Development on by default', () => {
  const config = templates.getFrameConfigTemplate('demo');
  assert.equal(config.features.specDriven, true);

  const agents = templates.getAgentsTemplate('demo', { specDriven: true });
  assert.ok(agents.includes('## Spec-Driven Development'));
  assert.ok(managedBlock.findBlock(agents), 'section must be marker-wrapped');
});

test('disable flips the flag and removes the managed section', () => {
  const dir = makeProject({
    specDriven: true,
    agents: templates.getAgentsTemplate('demo', { specDriven: true })
  });

  const result = frameProject.setSpecDrivenEnabled(dir, false);
  assert.equal(result.success, true);
  assert.equal(frameProject.isSpecDrivenEnabled(dir), false);

  const agents = readAgents(dir);
  assert.equal(managedBlock.findBlock(agents), null);
  assert.ok(!agents.includes('## Spec-Driven Development'));
  // Neighbouring sections and the footer survive, with no orphaned rule left
  // where the section used to be.
  assert.ok(agents.includes('## Writing Frame meta files — read the reference first'));
  assert.ok(agents.includes('*This file was automatically created by Frame.*'));
  assert.ok(!/-{3,}\s*\n\s*-{3,}/.test(agents), 'no doubled separator');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('enable after disable restores the section without touching user content', () => {
  const dir = makeProject({
    specDriven: true,
    agents: templates.getAgentsTemplate('demo', { specDriven: true }) +
      '\n\n## House Rules\n\nNever force-push.\n'
  });

  frameProject.setSpecDrivenEnabled(dir, false);
  const enabled = frameProject.setSpecDrivenEnabled(dir, true);
  assert.equal(enabled.success, true);
  assert.equal(frameProject.isSpecDrivenEnabled(dir), true);

  const agents = readAgents(dir);
  assert.ok(agents.includes('## Spec-Driven Development'));
  assert.ok(agents.includes('Never force-push.'), 'user section preserved');
  assert.ok(fs.existsSync(path.join(dir, '.frame', 'specs', '.gitkeep')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('disable leaves a hand-written spec section alone', () => {
  const custom = '# demo\n\n## Spec-Driven Development\n\nOur own house flavour.\n';
  const dir = makeProject({ specDriven: true, agents: custom });

  frameProject.setSpecDrivenEnabled(dir, false);
  assert.equal(frameProject.isSpecDrivenEnabled(dir), false);
  assert.equal(readAgents(dir), custom);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('toggling a non-Frame folder fails instead of writing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specdriven-none-'));
  const off = frameProject.setSpecDrivenEnabled(dir, false);
  const on = frameProject.setSpecDrivenEnabled(dir, true);
  assert.equal(off.success, false);
  assert.equal(on.success, false);
  assert.equal(fs.existsSync(path.join(dir, '.frame')), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
