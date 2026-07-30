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

/* ------------------- {frame_global_path} substitution ------------------- */

const fs = require('fs');
const os = require('os');

test('markdown templates are marked for substitution, assets are not', () => {
  const plan = staging.resolveStagingPlan(PROJECT, TOOL, () => false);

  for (const file of staging.COMMAND_TEMPLATE_FILES) {
    const entry = plan.find((e) => path.basename(e.dst) === file);
    assert.equal(entry.substitute, true, `${file} should be substituted`);
  }
  for (const file of staging.COMMAND_ASSET_FILES) {
    const entry = plan.find((e) => path.basename(e.dst) === file);
    assert.ok(!entry.substitute, `${file} must not be substituted — its braces are not ours`);
  }
});

test('substitutePlaceholders replaces every occurrence', () => {
  const out = staging.substitutePlaceholders(
    'see {frame_global_path} and also {frame_global_path}',
    { frame_global_path: '/ud/frame-global/REFERENCE.md' }
  );
  assert.equal(out, 'see /ud/frame-global/REFERENCE.md and also /ud/frame-global/REFERENCE.md');
});

test('an unresolved placeholder is left visible, never blanked', () => {
  // An empty path would silently point a reader at /REFERENCE.md; the
  // placeholder surviving is a legible bug instead.
  assert.equal(
    staging.substitutePlaceholders('at {frame_global_path}', { frame_global_path: '' }),
    'at {frame_global_path}'
  );
  assert.equal(staging.substitutePlaceholders('at {frame_global_path}', {}), 'at {frame_global_path}');
  assert.equal(staging.substitutePlaceholders('at {frame_global_path}'), 'at {frame_global_path}');
});

test('other placeholders are untouched — specManager fills those per dispatch', () => {
  const out = staging.substitutePlaceholders(
    'root {project_path}, slug {slug}, global {frame_global_path}',
    { frame_global_path: '/ud/REFERENCE.md' }
  );
  assert.ok(out.includes('{project_path}'));
  assert.ok(out.includes('{slug}'));
  assert.ok(out.includes('/ud/REFERENCE.md'));
});

test('every shipped spec template carries the placeholder', () => {
  for (const file of staging.COMMAND_TEMPLATE_FILES) {
    const src = path.join(staging.FRAME_TEMPLATES_DIR, 'commands', TOOL, file);
    assert.ok(
      fs.readFileSync(src, 'utf8').includes(`{${staging.STAGED_PLACEHOLDER}}`),
      `${file} does not reference the global layer`
    );
  }
});

test('copyIfChanged applies the transform and stays content-stable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-staging-'));
  try {
    const src = path.join(dir, 'src.md');
    const dst = path.join(dir, 'out', 'dst.md');
    fs.writeFileSync(src, 'read {frame_global_path}\n');
    const transform = (c) => staging.substitutePlaceholders(c, { frame_global_path: '/ud/REFERENCE.md' });

    assert.equal(staging.copyIfChanged(src, dst, transform), true);
    assert.equal(fs.readFileSync(dst, 'utf8'), 'read /ud/REFERENCE.md\n');

    // Second pass must be a no-op — comparison happens after the transform,
    // or every project open would rewrite the file and re-trigger watchers.
    assert.equal(staging.copyIfChanged(src, dst, transform), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
