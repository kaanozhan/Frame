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
    { project_path: '/p', slug: 'my-spec', report_generator_path: '.frame/runtime/commands/claude-code/build-implement-report.mjs' }
  );
  assert.equal(out, 'root=/p slug=my-spec gen=.frame/runtime/commands/claude-code/build-implement-report.mjs');
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

// ─── full auto (full-auto-spec-flow T07) ──────────────────────

test('parseArgs reads the slug and --full-auto in any order', () => {
  assert.deepEqual(helper.parseArgs(['my-spec']), { slug: 'my-spec', fullAuto: false, error: null });
  assert.deepEqual(helper.parseArgs(['my-spec', '--full-auto']), { slug: 'my-spec', fullAuto: true, error: null });
  assert.deepEqual(helper.parseArgs(['--full-auto', 'my-spec']), { slug: 'my-spec', fullAuto: true, error: null });
});

test('parseArgs refuses an unknown flag and a missing slug', () => {
  assert.match(helper.parseArgs(['my-spec', '--ful-auto']).error, /unknown option --ful-auto/);
  assert.match(helper.parseArgs(['--full-auto']).error, /usage/);
  assert.match(helper.parseArgs([]).error, /usage/);
});

test('autoPromptVars names the three phase prompts the way spec.auto.md expects', () => {
  const vars = helper.autoPromptVars({ projectRoot: '/p', slug: 's', title: 'T', tasksPath: '/main/.frame/tasks.json' });
  assert.equal(vars.plan_prompt_path, '.frame/runtime/prompts/s__spec.plan.md');
  assert.equal(vars.tasks_prompt_path, '.frame/runtime/prompts/s__spec.tasks.md');
  assert.equal(vars.implement_prompt_path, '.frame/runtime/prompts/s__spec.implement.md');
  assert.equal(vars.tasks_path, '/main/.frame/tasks.json');
  assert.equal(vars.ask_mechanism, 'the `AskUserQuestion` tool');
  assert.equal(vars.title, 'T');
  // Every phase token spec.auto.md uses is filled.
  const fs = require('fs');
  const auto = fs.readFileSync(path.join(__dirname, '..', 'src', 'templates', 'commands', 'claude-code', 'spec.auto.md'), 'utf8');
  const filled = helper.interpolate(auto, vars);
  assert.ok(!/\{[a-z_]+\}/.test(filled), 'no token survives in the staged spec.auto prompt');
});

test('templateCandidates puts the project override before the staged copy', () => {
  const [override, staged] = helper.templateCandidates('/p', 'spec.auto');
  assert.equal(override, path.join('/p', '.frame', 'templates', 'commands', 'claude-code', 'spec.auto.md'));
  assert.equal(staged, path.join('/p', '.frame', 'runtime', 'commands', 'claude-code', 'spec.auto.md'));
});
