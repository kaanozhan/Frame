/**
 * implement-launch helper tests (T08): the pure parts of the bin helper —
 * template interpolation, permission-file shape, launch-line composition and
 * template resolution order. No filesystem, no exec: everything above main()
 * in src/templates/bin/implement-launch.js is pure, and these tests are what
 * keep it that way.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const helper = require('../src/templates/bin/implement-launch.js');

// ─── interpolation ────────────────────────────────────────────

test('interpolate fills the three implement placeholders', () => {
  const out = helper.interpolate(
    'root={project_path} slug={slug} gen={report_generator_path}',
    { project_path: '/p', slug: 'my-spec', report_generator_path: '.frame/runtime/assets/build-implement-report.mjs' }
  );
  assert.equal(out, 'root=/p slug=my-spec gen=.frame/runtime/assets/build-implement-report.mjs');
});

test('interpolate leaves unknown placeholders intact', () => {
  assert.equal(helper.interpolate('a {unknown} b', { slug: 'x' }), 'a {unknown} b');
});

test('interpolate returns empty string for empty template', () => {
  assert.equal(helper.interpolate('', { slug: 'x' }), '');
});

// ─── verification resolution ──────────────────────────────────

test('resolveVerificationCommand prefers test over lint and build', () => {
  const cmd = helper.resolveVerificationCommand({
    project: { commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build' } }
  });
  assert.equal(cmd, 'npm test');
});

test('resolveVerificationCommand falls through to lint, then build', () => {
  assert.equal(
    helper.resolveVerificationCommand({ project: { commands: { lint: 'eslint .', build: 'make' } } }),
    'eslint .'
  );
  assert.equal(
    helper.resolveVerificationCommand({ project: { commands: { build: 'make' } } }),
    'make'
  );
});

test('resolveVerificationCommand ignores blank commands and returns null when none', () => {
  assert.equal(helper.resolveVerificationCommand({ project: { commands: { test: '   ' } } }), null);
  assert.equal(helper.resolveVerificationCommand({}), null);
  assert.equal(helper.resolveVerificationCommand(null), null);
});

// ─── permission-file shape ────────────────────────────────────

test('buildPermissions without a check carries just the base allow/deny', () => {
  const perms = helper.buildPermissions(null);
  assert.deepEqual(perms.permissions.allow, helper.IMPLEMENT_ALLOW);
  assert.deepEqual(perms.permissions.deny, helper.IMPLEMENT_DENY);
});

test('buildPermissions adds exact + prefixed rules for the verification command', () => {
  const perms = helper.buildPermissions('npm test');
  assert.ok(perms.permissions.allow.includes('Bash(npm test)'));
  assert.ok(perms.permissions.allow.includes('Bash(npm test *)'));
  // base rules still present, deny untouched
  assert.ok(perms.permissions.allow.includes('Edit'));
  assert.deepEqual(perms.permissions.deny, helper.IMPLEMENT_DENY);
});

test('buildPermissions does not mutate the shared constant arrays', () => {
  const before = helper.IMPLEMENT_ALLOW.length;
  helper.buildPermissions('npm test');
  assert.equal(helper.IMPLEMENT_ALLOW.length, before);
});

test('deny list blocks push and hard resets', () => {
  assert.ok(helper.IMPLEMENT_DENY.includes('Bash(git push)'));
  assert.ok(helper.IMPLEMENT_DENY.includes('Bash(git push *)'));
  assert.ok(helper.IMPLEMENT_DENY.includes('Bash(git reset --hard *)'));
});

// ─── launch-line composition ──────────────────────────────────

test('buildLaunchArgs composes flags plus the read-this-file instruction', () => {
  const args = helper.buildLaunchArgs('/abs/perms.json', '.frame/runtime/prompts/my-spec__spec.implement.md');
  assert.deepEqual(args, [
    '--settings', '/abs/perms.json',
    '--permission-mode', 'auto',
    'Read .frame/runtime/prompts/my-spec__spec.implement.md and follow its instructions exactly.'
  ]);
});

// ─── template resolution order ────────────────────────────────

test('resolveRawTemplatePath prefers the override when it exists', () => {
  const root = '/proj';
  const override = path.join(root, helper.TEMPLATE_OVERRIDE_REL);
  const chosen = helper.resolveRawTemplatePath(root, (p) => p === override);
  assert.equal(chosen, override);
});

test('resolveRawTemplatePath falls back to the staged copy', () => {
  const root = '/proj';
  const staged = path.join(root, helper.TEMPLATE_STAGED_REL);
  const chosen = helper.resolveRawTemplatePath(root, (p) => p === staged);
  assert.equal(chosen, staged);
});

test('resolveRawTemplatePath returns null when neither exists', () => {
  assert.equal(helper.resolveRawTemplatePath('/proj', () => false), null);
});
