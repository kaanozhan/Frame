/**
 * Spec command hook script tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Two things are asserted here, and the second is the important one.
 *
 * 1. Intent detection is narrow. "plan" and "implement" are ordinary English;
 *    a verb only counts when "spec" appears with it. The explicit forms
 *    (`/spec.plan`, `spec.plan`, `spec plan`) are what a user types when the
 *    slash command does not exist, which is the case this hook exists for.
 *
 * 2. The staged prompt is byte-identical to the one specManager's
 *    `getCommandPrompt` builds for the button. The hook deliberately
 *    duplicates that resolution — it ships to `.frame/bin/` and cannot
 *    require Electron main code — so the duplication needs a guard that
 *    fails when the two drift apart. Without it a template placeholder or a
 *    resolution rule could change on one path only, and the terminal would
 *    quietly go back to receiving something other than the current flow.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// specManager reaches two packages transitively: telemetry.js requires
// @aptabase/electron/main and userSettings.js requires electron. CI runs this
// suite with no node_modules on purpose (see .github/workflows/ci.yml), so
// both are stubbed before it loads — the same idiom specTasksSync.test.js
// uses. Neither is exercised: getCommandPrompt emits no telemetry, and
// app.getPath is only reached from userSettings.init(), which nothing calls.
const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: { app: {}, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

const specManager = require('../src/main/specManager');

const HOOK = path.join(__dirname, '..', 'scripts', 'spec-command-hint.js');
const REPO = path.join(__dirname, '..');

function runHook(input, { raw = null, cli = null } = {}) {
  const stdout = execFileSync('node', cli ? [HOOK, 'prompt', cli] : [HOOK, 'prompt'], {
    input: raw !== null ? raw : JSON.stringify(input),
    encoding: 'utf8'
  }); // execFileSync throws on non-zero exit — reaching here asserts exit 0
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const ctxOf = (out) => out.hookSpecificOutput.additionalContext;

/** A project with one spec in `phase`, and the command templates staged. */
function mkProject(specs = [{ slug: 'alpha', title: 'Alpha', phase: 'specified' }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-speccmd-'));
  const cmdDir = path.join(root, '.frame', 'runtime', 'commands', 'claude-code');
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const c of ['spec.new', 'spec.plan', 'spec.tasks', 'spec.implement']) {
    fs.writeFileSync(path.join(cmdDir, `${c}.md`), `# ${c}\nslug={slug} title={title} root={project_path}\n`);
  }
  for (const s of specs) {
    const dir = path.join(root, '.frame', 'specs', s.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ slug: s.slug, title: s.title, phase: s.phase }));
  }
  return root;
}

const ask = (root, prompt) => runHook({ session_id: 'a', cwd: root, prompt });

// ─── intent ───────────────────────────────────────────────

test('an explicit command resolves the only candidate and stages the flow', () => {
  const root = mkProject();
  const ctx = ctxOf(ask(root, '/spec.plan'));
  assert.match(ctx, /spec\.plan` on spec `alpha`/);
  assert.match(ctx, /\.frame\/runtime\/prompts\/alpha__spec\.plan\.md/);
  assert.ok(fs.existsSync(path.join(root, '.frame', 'runtime', 'prompts', 'alpha__spec.plan.md')));
});

test('the dotless and slashless forms count too', () => {
  for (const form of ['spec plan', 'spec.plan', '/spec.plan please']) {
    const root = mkProject();
    assert.ok(ask(root, form), `"${form}" should be recognised`);
  }
});

test('a conversational ask counts when "spec" is in it', () => {
  const root = mkProject();
  assert.ok(ask(root, 'alpha spec ini planla'));
});

test('a verb without "spec" is just English and says nothing', () => {
  const root = mkProject();
  assert.equal(ask(root, 'can you plan the migration for me'), null);
  assert.equal(ask(root, 'implement this function'), null);
  assert.equal(ask(root, 'bu isi planla'), null);
});

test('an unrelated prompt says nothing', () => {
  const root = mkProject();
  assert.equal(ask(root, 'why is this test failing'), null);
});

// ─── resolution ───────────────────────────────────────────

test('an explicitly named spec wins over phase matching', () => {
  const root = mkProject([
    { slug: 'alpha', title: 'Alpha', phase: 'specified' },
    { slug: 'beta', title: 'Beta', phase: 'planned' }
  ]);
  const ctx = ctxOf(ask(root, 'spec.plan for beta'));
  assert.match(ctx, /on spec `beta`/);
});

test('several candidates are listed for the agent to ask about, never guessed', () => {
  const root = mkProject([
    { slug: 'alpha', title: 'Alpha', phase: 'specified' },
    { slug: 'gamma', title: 'Gamma', phase: 'specified' }
  ]);
  const ctx = ctxOf(ask(root, '/spec.plan'));
  assert.match(ctx, /- alpha/);
  assert.match(ctx, /- gamma/);
  assert.match(ctx, /Ask the user which one/);
  assert.ok(!fs.existsSync(path.join(root, '.frame', 'runtime', 'prompts')), 'nothing staged while ambiguous');
});

test('no candidate at all is reported, not papered over', () => {
  const root = mkProject([{ slug: 'alpha', title: 'Alpha', phase: 'done' }]);
  const ctx = ctxOf(ask(root, '/spec.plan'));
  assert.match(ctx, /No spec is in a phase/);
});

test('a missing template tells the user to open the project in Frame, and stops', () => {
  const root = mkProject();
  fs.rmSync(path.join(root, '.frame', 'runtime', 'commands'), { recursive: true, force: true });
  const ctx = ctxOf(ask(root, '/spec.plan'));
  assert.match(ctx, /no template is staged/);
  assert.match(ctx, /do not reconstruct the flow from memory/i);
});

test('spec.new gets the template path — it has no target spec yet', () => {
  const root = mkProject();
  const ctx = ctxOf(ask(root, '/spec.new terminal colours'));
  assert.match(ctx, /spec\.new\.md/);
  assert.match(ctx, /the template is the flow/);
});

// ─── the drift guard ──────────────────────────────────────

test('the staged prompt is byte-identical to the one the button builds', () => {
  // The hook duplicates specManager's resolution because it ships to
  // .frame/bin/ and cannot require Electron main code. If the two ever
  // diverge, the terminal silently stops receiving the current flow — which
  // is the exact failure this hook was written to end.
  //
  // Built hermetically from the packaged templates rather than run against
  // this repository: `.frame/runtime/` is gitignored, so a clean checkout has
  // no staged commands and the comparison would be against nothing. That is
  // not a hook bug — the protocol names exactly two locations and says to
  // stop when neither exists — but it does mean the guard has to bring its
  // own staged copy.
  const packaged = path.join(REPO, 'src', 'templates', 'commands', 'claude-code');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-drift-'));
  const staged = path.join(root, '.frame', 'runtime', 'commands', 'claude-code');
  fs.mkdirSync(staged, { recursive: true });
  for (const file of fs.readdirSync(packaged)) {
    fs.copyFileSync(path.join(packaged, file), path.join(staged, file));
  }

  const cases = [
    ['alpha', 'spec.plan', 'specified'],
    ['beta', 'spec.tasks', 'planned'],
    ['gamma', 'spec.implement', 'tasks_generated']
  ];
  for (const [slug, , phase] of cases) {
    const dir = path.join(root, '.frame', 'specs', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ slug, title: `Title of ${slug}`, phase }));
  }

  // Both CLIs, because the two paths now differ by a dialect and each of them
  // has already drifted once in this spec: specManager gained the dialect and
  // the hook did not, then specManager gained the one-pass fill of tokens
  // inside a dialect value and the hook did not. A guard that only watched
  // Claude Code would have caught neither on the Codex side.
  for (const cli of ['claude-code', 'codex']) {
    for (const [slug, command] of cases) {
      const expected = specManager.getCommandPrompt(root, slug, command, cli);
      assert.ok(!expected.error, `${cli}/${command}: specManager said ${expected.error}`);

      const file = path.join(root, '.frame', 'runtime', 'prompts', `${slug}__${command}.md`);
      fs.rmSync(file, { force: true });
      runHook({ session_id: `drift-${cli}`, cwd: root, prompt: `${command} ${slug}` }, { cli });
      assert.ok(fs.existsSync(file), `${cli}/${command}: the hook staged nothing`);
      assert.equal(fs.readFileSync(file, 'utf8'), expected.prompt,
        `${cli}/${command}: the hook drifted from specManager`);
    }
  }
});

// ─── it never breaks ──────────────────────────────────────

test('the payload stays inlinable even with many candidates', () => {
  // additionalContext is inlined only up to 2000 characters; past that the
  // host spills it to a file and the pointer this hook exists to deliver
  // arrives as a preview instead.
  const specs = Array.from({ length: 40 }, (_, i) => ({ slug: `spec-number-${i}`, title: `A reasonably long spec title number ${i}`, phase: 'specified' }));
  const root = mkProject(specs);
  const ctx = ctxOf(ask(root, '/spec.plan'));
  assert.ok(ctx.length <= 1980, `${ctx.length} chars would spill`);
});

test('unparseable stdin exits 0 with no output', () => {
  assert.equal(runHook(null, { raw: 'not json at all' }), null);
});

test('a project with no .frame/ at all exits 0 with no output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bare-'));
  assert.equal(runHook({ session_id: 'a', cwd: root, prompt: 'why is this failing' }), null);
});

// ─── Codex ────────────────────────────────────────────────

test('a Codex session falls back to the base flow with its own dialect', () => {
  // T06 settled this: across 1 120 rendered lines the two CLIs differ on two,
  // so the flows are one source and a CLI without templates of its own runs
  // the base one. What must not happen is Codex being handed Claude Code's
  // phrasing — the dialect is the seam, and it is asserted here.
  const root = mkProject();
  const out = runHook({
    session_id: 'cx', cwd: root, prompt: '/spec.plan', turn_id: 't', permission_mode: 'default'
  });
  assert.ok(out, 'a Codex session gets the flow rather than a dead end');
  assert.match(ctxOf(out), /on spec `alpha`/);

  const staged = fs.readFileSync(
    path.join(root, '.frame', 'runtime', 'prompts', 'alpha__spec.plan.md'), 'utf8');
  assert.ok(!staged.includes('AskUserQuestion'),
    'Codex must not be sent after a structured-question tool it does not have');
});

test('an unmarked session still resolves claude-code', () => {
  const root = mkProject();
  const ctx = ctxOf(runHook({ session_id: 'cc', cwd: root, prompt: '/spec.plan' }));
  assert.match(ctx, /on spec `alpha`/);
});
