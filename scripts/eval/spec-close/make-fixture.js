#!/usr/bin/env node
/**
 * Spec close step — fixture builder.
 *
 * Builds one throwaway Frame project for the close-step test run: a git
 * repository under the system temp directory holding a two-task dummy spec,
 * the scripts and hooks a real Frame project has, and nothing else. An
 * internal measurement instrument, not a product surface.
 *
 *   node scripts/eval/spec-close/make-fixture.js <kind> [--dir <path>]
 *
 * Five kinds, one per moment the close step has to get right:
 *
 *   natural        both tasks pending. The session implements the spec end
 *                  to end; the template's digest step is under test, and the
 *                  digest must land in the last task's commit.
 *   closing-turn   the last task still open, a script in the project closes
 *                  it. The session is asked to run that script and then one
 *                  more command; it closed the spec, so the reminder reaches
 *                  it on the second call.
 *   earlier-close  both tasks completed an hour before the session, no
 *                  digest and no card. The session is asked something
 *                  unrelated; it did not close the spec, so it must hear
 *                  nothing.
 *   fix-bug        a finished spec with its digest and its decision card,
 *                  and a bug in its code.
 *                  The session is asked to fix it: a Fix entry, the digest
 *                  left as it is.
 *   fix-decision   a finished spec with its digest and its decision card,
 *                  and a request that contradicts a rule the digest records:
 *                  a Fix entry, and the digest revised.
 *
 * Only `natural` shows the session the implement template. The others learn
 * what they owe from the hooks alone — the reminder, or the edit-time history
 * of a finished spec's file — which is the claim being tested.
 *
 * Everything Frame-shaped comes from Frame's own code rather than a copy of
 * it: `.frame/bin/` from structureBootstrap.copyParserScripts, the command
 * templates from commandStaging.stageCommandFiles, the hooks from
 * SPEC_HINT_HOOKS. A fixture that drifted from what Frame installs would
 * measure the fixture.
 *
 * Isolation: no remote, its own activity home beside the repository, a clean
 * tree on `feat/<slug>` so the template's pre-flight has nothing to ask — an
 * unanswered pre-flight is a hard stop, and a headless session cannot answer.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const structureBootstrap = require(path.join(REPO, 'src', 'main', 'structureBootstrap'));
const commandStaging = require(path.join(REPO, 'src', 'main', 'commandStaging'));
const { SPEC_HINT_HOOKS } = require(path.join(REPO, 'src', 'shared', 'frameTemplates'));

const KINDS = ['natural', 'closing-turn', 'earlier-close', 'fix-bug', 'fix-decision'];
const FINISHED = ['earlier-close', 'fix-bug', 'fix-decision']; // every task completed before the session
const SLUG = 'greeting-helper';
const TITLE = 'Greeting Helper';

// Frame's managed ignore block, as it writes it into a project's .frame/.
const FRAME_GITIGNORE = [
  '# managed by Frame — machine-local; edit outside this block',
  'runtime/', 'worktrees/', 'orchestration/', 'migration-backup/', 'bin/',
  'implement-permissions.json', '*.bak', '*.tmp', '*.corrupt-*', 'index/',
  'specs/*/implement-report.html', 'specs/*/plan-report.html', 'specs/*/report-data.json',
  '# end managed by Frame', ''
].join('\n');

const TASKS = [
  { n: 1, title: 'Add `src/greet.js` exporting `greet(name)`, which returns `Hello, <name>!` and `Hello, stranger!` when the name is empty or missing' },
  { n: 2, title: 'Add `test/greet.test.js` covering `greet` for a name, an empty string and no argument' }
];

const SPEC_MD = `---
keywords: greeting, greet, helper
---

# ${TITLE}

## Problem

The project greets people in two places with two different strings.

## Goal

One \`greet(name)\` helper in \`src/greet.js\`, with tests.

## Constraints

- No dependencies.
- An empty or missing name greets a stranger rather than printing \`undefined\`.

## Success Criteria

- When \`greet('Ada')\` is called, then it returns \`Hello, Ada!\`.
- When \`greet('')\` or \`greet()\` is called, then it returns \`Hello, stranger!\`.
- When \`npm test\` runs, then it passes.
`;

const PLAN_MD = `# Plan — ${TITLE}

## Architecture

A single pure function. Rejected: a class with a configurable salutation —
nothing asks for a second salutation.

## Files

- \`src/greet.js\` — **New.** The helper.
- \`test/greet.test.js\` — **New.** Its tests.

## Footprint

- src/greet.js
- test/greet.test.js

## Dependencies

None.

## Sequencing

1. Add \`src/greet.js\`.
2. Add \`test/greet.test.js\`.
`;

const TASKS_MD = `# Tasks — ${TITLE}\n\n${TASKS.map((t) => `- T0${t.n} · ${t.title}`).join('\n')}\n`;

const GREET_JS = `'use strict';

/** A greeting for \`name\`, or for a stranger when there is none. */
function greet(name) {
  return \`Hello, \${name ? name : 'stranger'}!\`;
}

module.exports = { greet };
`;

const GREET_TEST_JS = `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { greet } = require('../src/greet');

test('greets by name', () => assert.equal(greet('Ada'), 'Hello, Ada!'));
test('greets a stranger when the name is empty', () => assert.equal(greet(''), 'Hello, stranger!'));
test('greets a stranger when there is no name', () => assert.equal(greet(), 'Hello, stranger!'));
`;

// fix-bug's planted bug: the comma the spec promises is missing.
const GREET_JS_BUGGY = GREET_JS.replace('`Hello, ${', '`Hello ${');

// The digest a finished fixture spec carries. Its rule about strangers is
// what fix-decision is asked to overturn.
const DIGEST_MD = `---
keywords: greeting, greet, helper
---
Added a pure \`greet(name)\` helper in \`src/greet.js\`, with tests, so every greeting in the project reads the same.

- Rule: an empty or missing name greets a \`stranger\` — never \`undefined\` or an empty slot.
- Rejected: a configurable class — nothing asks for a second salutation.

Chain: spec.md → plan.md → tasks.md → outcome.md
`;

// The decision card a finished fixture spec carries beside its digest: a spec
// closed under the card rule has at least one (decision-cards-core D4), and
// spec-close.js reports the spec as missing a close item without it.
const CARD_JSONL = `${JSON.stringify({
  id: '20261013-5f1a2c',
  date: '2026-10-13',
  decision: 'An empty or missing name greets a `stranger`, never `undefined` or an empty slot.',
  why: 'Every greeting in the project reads the same, whatever the caller passes.',
  keywords: ['greeting', 'greet', 'empty name'],
  files: ['src/greet.js'],
  source: `spec:${SLUG}`,
  supersedes: null,
  extends: null
})}\n`;

const SMOKE_TEST_JS = `const { test } = require('node:test');
const assert = require('node:assert/strict');

// Here so \`npm test\` has something to run before the spec adds its own.
test('the project loads', () => assert.equal(typeof require('../src/index'), 'object'));
`;

const OUTCOME_MD = `## T01 — Add \`src/greet.js\`

Added \`greet(name)\` to a new \`src/greet.js\`: one template string, with a falsy name greeted as
\`stranger\` so an empty string and a missing argument take the same path. Chose a plain function over
the configurable class \`plan.md\` rejected. Files: \`src/greet.js\`.

_Captured: 2026-10-13 · 1 file change_

---
## T02 — Add \`test/greet.test.js\`

Added three cases to a new \`test/greet.test.js\` — a name, an empty string, no argument — run by the
existing \`npm test\`. No deviation from \`plan.md\`. Files: \`test/greet.test.js\`.

_Captured: 2026-10-13 · 1 file change_

---
`;

/** tools/close-task.js — closes the last task the way an agent's own script does: through the shell. */
const closeTaskScript = () => `// Marks ${SLUG}'s last task completed in .frame/tasks.json.
const fs = require('fs');
const file = '.frame/tasks.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const task = data.tasks.find((t) => t.source === 'spec:${SLUG}:T02');
const now = new Date().toISOString();
task.status = 'completed';
task.completedAt = now;
task.updatedAt = now;
fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log('T02 completed');
`;

// What each kind's session is asked. None but natural's mentions the
// digest, the outcome, the spec or the close script.
const PROMPTS = {
  natural: `/spec.implement ${SLUG}`,
  'closing-turn': 'Run `node tools/close-task.js`, then run `git status --short`, and tell me what each printed.',
  'earlier-close': 'What does src/greet.js export? Answer in one sentence.',
  'fix-bug': 'While testing the greeting helper I found a bug: greet(\'Ada\') returns "Hello Ada!" — the comma is missing. Fix it.',
  'fix-decision': 'While testing the greeting helper I realised greeting a stranger is wrong for us: an empty or missing name ' +
    'should return "Hello, friend!" instead. Change it.'
};

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function taskStates(kind, now) {
  const closedAt = new Date(now - 60 * 60 * 1000).toISOString();
  if (kind === 'natural') return ['pending', 'pending'].map((status) => ({ status, completedAt: null }));
  if (FINISHED.includes(kind)) return [1, 2].map(() => ({ status: 'completed', completedAt: closedAt }));
  return [{ status: 'completed', completedAt: closedAt }, { status: 'in_progress', completedAt: null }];
}

const PHASES = {
  natural: 'tasks_generated', 'closing-turn': 'implementing', 'earlier-close': 'done', 'fix-bug': 'done', 'fix-decision': 'done'
};

/**
 * Build one fixture. Returns what a runner needs: where it is, what to ask,
 * and where its hooks will record.
 *
 *   { kind, slug, base, root, activityHome, prompt, digestBefore }
 *
 * `base` holds the repository (`root`) and the activity home side by side, so
 * removing `base` removes every trace of the fixture.
 */
function makeFixture({ kind, dir = null, now = Date.now() } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}" — one of: ${KINDS.join(', ')}`);
  const base = dir ? path.resolve(dir) : fs.mkdtempSync(path.join(os.tmpdir(), `frame-spec-close-${kind}-`));
  const root = path.join(base, 'project');
  const activityHome = path.join(base, 'activity');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(activityHome, { recursive: true });
  const created = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const worked = kind !== 'natural'; // the code and the outcome are already there

  // ── the project ──
  write(root, 'package.json', `${JSON.stringify({
    name: 'greeting-fixture', version: '0.0.0', private: true, scripts: { test: 'node --test test/' }
  }, null, 2)}\n`);
  write(root, 'src/index.js', '\'use strict\';\n\nmodule.exports = {};\n');
  write(root, 'test/smoke.test.js', SMOKE_TEST_JS);
  if (worked) {
    write(root, 'src/greet.js', kind === 'fix-bug' ? GREET_JS_BUGGY : GREET_JS);
    write(root, 'test/greet.test.js', GREET_TEST_JS);
  }
  if (kind === 'closing-turn') write(root, 'tools/close-task.js', closeTaskScript());

  // ── .frame/ ──
  write(root, '.frame/.gitignore', FRAME_GITIGNORE);
  write(root, '.frame/config.json', `${JSON.stringify({
    version: '1.0', name: 'greeting-fixture', project: { commands: { test: 'npm test' } }
  }, null, 2)}\n`);
  const states = taskStates(kind, now);
  write(root, '.frame/tasks.json', JSON.stringify({
    project: 'greeting-fixture',
    version: '2.0',
    lastUpdated: created,
    tasks: TASKS.map((t, i) => ({
      id: `task-spec-${SLUG}-T0${t.n}`,
      title: t.title,
      description: '',
      source: `spec:${SLUG}:T0${t.n}`,
      status: states[i].status,
      priority: 'medium',
      category: 'feature',
      context: `From spec: ${SLUG}`,
      createdAt: created,
      updatedAt: states[i].completedAt || created,
      completedAt: states[i].completedAt
    })),
    metadata: { totalCreated: TASKS.length, totalCompleted: states.filter((s) => s.status === 'completed').length }
  }, null, 2));

  const specDir = `.frame/specs/${SLUG}`;
  write(root, `${specDir}/spec.md`, SPEC_MD);
  write(root, `${specDir}/plan.md`, PLAN_MD);
  write(root, `${specDir}/tasks.md`, TASKS_MD);
  if (worked) write(root, `${specDir}/outcome.md`, OUTCOME_MD);
  const digestBefore = kind.startsWith('fix-') ? DIGEST_MD : null;
  if (digestBefore) write(root, `${specDir}/digest.md`, digestBefore);
  if (digestBefore) write(root, '.frame/decisions.jsonl', CARD_JSONL);
  write(root, `${specDir}/status.json`, `${JSON.stringify({
    slug: SLUG,
    title: TITLE,
    phase: PHASES[kind],
    generated_task_ids: TASKS.map((t) => `task-spec-${SLUG}-T0${t.n}`),
    ai_tool: 'claude-code',
    created_at: created,
    updated_at: created,
    last_phase_at: created,
    implement_mode: 'autonomous'
  }, null, 2)}\n`);

  // ── what Frame installs, from Frame's own code ──
  structureBootstrap.copyParserScripts(root);
  commandStaging.stageCommandFiles(root);
  write(root, '.claude/settings.json', `${JSON.stringify({ hooks: SPEC_HINT_HOOKS }, null, 2)}\n`);

  // ── a clean tree on the spec's own branch ──
  // The commit is dated when the spec was created, before its tasks closed:
  // the index flags a file changed after its spec closed as stale, and a
  // fixture committed "now" would mark every finished file that way.
  const git = (...args) => execFileSync('git', args, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: created, GIT_COMMITTER_DATE: created }
  });
  git('init', '-q');
  git('checkout', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=Frame Fixture', '-c', 'user.email=fixture@frame.invalid', 'commit', '-q', '-m', `fixture: ${kind}`);
  git('checkout', '-q', '-b', `feat/${SLUG}`);
  // The session commits under an identity of its own, never the user's.
  git('config', 'user.name', 'Fixture Agent');
  git('config', 'user.email', 'agent@frame.invalid');

  // The spec index, as Frame keeps it: the edit-time history of a finished
  // spec's file is built from it, and it is where the fix rule reaches a
  // session that never saw the implement template.
  execFileSync(process.execPath, [path.join(root, '.frame', 'bin', 'spec-index.js'), '--force'], {
    cwd: root, stdio: 'ignore', env: { ...process.env, FRAME_PROJECT_ROOT: root }
  });

  return { kind, slug: SLUG, base, root, activityHome, prompt: PROMPTS[kind], digestBefore };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const kind = args.find((a) => !a.startsWith('--'));
  const dirAt = args.indexOf('--dir');
  try {
    const fixture = makeFixture({ kind, dir: dirAt >= 0 ? args[dirAt + 1] : null });
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\nUsage: make-fixture.js <${KINDS.join('|')}> [--dir <path>]\n`);
    process.exit(1);
  }
}

module.exports = { makeFixture, KINDS, FINISHED, SLUG, PROMPTS, DIGEST_MD, CARD_JSONL };
