/**
 * Command staging plan tests (cli-spec-command-parity T04).
 *
 * resolveStagingPlan is pure given an existsFn, so these tests pin the
 * resolution contract without touching a filesystem: override-first sources,
 * the full staged file set per tool, and the bin helper's special handling.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const staging = require('../src/main/commandStaging');

const PROJECT = path.join(path.sep, 'proj');
const TOOL = 'claude-code';
const ALL_FILES = [...staging.COMMAND_TEMPLATE_FILES, ...staging.COMMAND_ASSET_FILES];

test('plan covers the four templates, both assets and the launch helper', () => {
  const plan = staging.resolveStagingPlan(PROJECT, TOOL, () => false);
  assert.equal(plan.length, ALL_FILES.length + 1);

  for (const file of ALL_FILES) {
    const entry = plan.find((e) => path.basename(e.dst) === file);
    assert.ok(entry, `missing plan entry for ${file}`);
    assert.equal(entry.dst, path.join(PROJECT, '.frame', 'runtime', 'commands', TOOL, file));
  }

  const helper = plan.find((e) => path.basename(e.dst) === staging.IMPLEMENT_HELPER_FILE);
  assert.ok(helper);
  assert.equal(helper.dst, path.join(PROJECT, '.frame', 'bin', staging.IMPLEMENT_HELPER_FILE));
  assert.equal(helper.executable, true);
});

test('sources fall back to the packaged copies when no override exists', () => {
  const plan = staging.resolveStagingPlan(PROJECT, TOOL, () => false);
  for (const file of ALL_FILES) {
    const entry = plan.find((e) => path.basename(e.dst) === file);
    assert.equal(entry.src, path.join(staging.FRAME_TEMPLATES_DIR, 'commands', TOOL, file));
  }
});

test('a project override wins over the packaged copy, per file', () => {
  const overridden = path.join(PROJECT, '.frame', 'templates', 'commands', TOOL, 'spec.plan.md');
  const plan = staging.resolveStagingPlan(PROJECT, TOOL, (p) => p === overridden);

  const planEntry = plan.find((e) => path.basename(e.dst) === 'spec.plan.md');
  assert.equal(planEntry.src, overridden);

  // every other file still resolves packaged
  for (const file of ALL_FILES.filter((f) => f !== 'spec.plan.md')) {
    const entry = plan.find((e) => path.basename(e.dst) === file);
    assert.equal(entry.src, path.join(staging.FRAME_TEMPLATES_DIR, 'commands', TOOL, file));
  }
});

test('the launch helper never resolves through the override dir', () => {
  const plan = staging.resolveStagingPlan(PROJECT, TOOL, () => true);
  const helper = plan.find((e) => path.basename(e.dst) === staging.IMPLEMENT_HELPER_FILE);
  assert.equal(helper.src, path.join(staging.FRAME_TEMPLATES_DIR, 'bin', staging.IMPLEMENT_HELPER_FILE));
});

test('available tools include claude-code', () => {
  assert.ok(staging.availableTools().includes('claude-code'));
});
