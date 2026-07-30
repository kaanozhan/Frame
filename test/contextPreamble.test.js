/**
 * contextPreamble tests (T07): composition across tool/layer combinations.
 *
 * Two properties carry the design and are asserted everywhere: the preamble
 * contains **paths, never content**, and a project with spec-driven off gets
 * silence about specs rather than a negative instruction.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { compose, precedenceSentence } = require('../src/shared/contextPreamble');

const GLOBAL = '/Users/x/Library/Application Support/Frame/frame-global/AGENTS.md';
const PROJECT_LAYER = '/repo/.frame/AGENTS.md';

function base(extra) {
  return { globalPath: GLOBAL, toolId: 'claude', ...extra };
}

// ─── layers ───────────────────────────────────────────────────

test('the global layer alone is a valid preamble', () => {
  const text = compose(base());
  assert.ok(text.includes(GLOBAL));
  assert.ok(text.includes(precedenceSentence(false)));
});

test('the project layer appears only when it exists', () => {
  assert.ok(!compose(base()).includes('.frame/AGENTS.md'));
  assert.ok(compose(base({ projectLayerPath: PROJECT_LAYER })).includes(PROJECT_LAYER));
});

test('without a global layer there is nothing to say', () => {
  assert.equal(compose({ toolId: 'claude' }), '');
  assert.equal(compose(), '');
  assert.equal(compose(null), '');
});

test('the precedence rule is stated, not left to be inferred', () => {
  const text = compose(base({ nativeFiles: [{ path: '/repo/CLAUDE.md', kind: 'claude' }] }));
  assert.ok(text.includes(precedenceSentence(false)));
  assert.ok(/repository owns its code conventions/.test(text));
  assert.ok(/Frame owns the meta-workflow/.test(text));
});

// ─── per tool ─────────────────────────────────────────────────

test("Claude Code is left to read the repo's CLAUDE.md itself", () => {
  const text = compose(base({
    toolId: 'claude',
    nativeFiles: [{ path: '/repo/CLAUDE.md', kind: 'claude' }]
  }));
  assert.ok(/CLAUDE\.md` is yours to read as usual/.test(text));
  assert.ok(/Frame has not modified it/.test(text));
  assert.ok(!text.includes("- This repository's own instructions: `/repo/CLAUDE.md`"));
});

test("Gemini CLI is left to read the repo's GEMINI.md itself", () => {
  const text = compose(base({
    toolId: 'gemini',
    nativeFiles: [{ path: '/repo/GEMINI.md', kind: 'gemini' }]
  }));
  assert.ok(/GEMINI\.md` is yours to read as usual/.test(text));
});

test('a tool with no native convention is pointed at the repo file too', () => {
  const text = compose(base({
    toolId: 'codex',
    nativeFiles: [{ path: '/repo/CLAUDE.md', kind: 'claude' }]
  }));
  assert.ok(text.includes("- This repository's own instructions: `/repo/CLAUDE.md`"));
  assert.ok(!/yours to read as usual/.test(text));
});

test("a tool is still pointed at files that are not its own convention", () => {
  const text = compose(base({
    toolId: 'claude',
    nativeFiles: [
      { path: '/repo/CLAUDE.md', kind: 'claude' },
      { path: '/repo/.cursorrules', kind: 'cursor' },
      { path: '/repo/.github/copilot-instructions.md', kind: 'copilot' }
    ]
  }));
  assert.ok(text.includes('/repo/.cursorrules'));
  assert.ok(text.includes('/repo/.github/copilot-instructions.md'));
  assert.ok(/yours to read as usual/.test(text), "the tool's own file is still acknowledged");
});

test('a nested .claude/CLAUDE.md counts as the tool\'s own file', () => {
  const text = compose(base({
    toolId: 'claude',
    nativeFiles: [{ path: '/repo/.claude/CLAUDE.md', kind: 'claude' }]
  }));
  assert.ok(/yours to read as usual/.test(text));
});

test('windows separators are matched too', () => {
  const text = compose(base({
    toolId: 'claude',
    nativeFiles: [{ path: 'C:\\repo\\CLAUDE.md', kind: 'claude' }]
  }));
  assert.ok(/yours to read as usual/.test(text));
});

test('no native files at all: the Frame layers are the sole source', () => {
  const text = compose(base({ nativeFiles: [] }));
  assert.ok(text.includes(GLOBAL));
  assert.ok(!/yours to read as usual/.test(text));
  assert.ok(!/This repository's own instructions/.test(text));
});

// ─── spec-driven ──────────────────────────────────────────────

test('spec-driven on adds the activation paragraph', () => {
  const text = compose(base({ specDriven: true }));
  assert.ok(/Spec-driven development is active/.test(text));
  assert.ok(/spec\.md → plan\.md → tasks\.md/.test(text));
});

test('spec-driven off says nothing about specs — never a negative instruction', () => {
  for (const value of [false, undefined, null, 0]) {
    const text = compose(base({ specDriven: value }));
    assert.ok(!/spec/i.test(text), `"${value}" leaked spec text into the preamble`);
  }
});

// ─── pointers, not content ────────────────────────────────────

test('no file content is embedded — only paths', () => {
  const text = compose(base({
    projectLayerPath: PROJECT_LAYER,
    specDriven: true,
    nativeFiles: [{ path: '/repo/CLAUDE.md', kind: 'claude' }]
  }));

  // Anything that looks like a copied document would show up as markdown
  // headings or fenced code, which a pointer list never contains.
  assert.ok(!/^#/m.test(text), 'a heading suggests copied file content');
  assert.ok(!text.includes('```'), 'a code fence suggests copied file content');
  assert.ok(text.split('\n').length < 25, 'the preamble grew into a document');
});

test('the no-write rule travels with the pointers', () => {
  assert.ok(/Frame writes only inside `\.frame\/`/.test(compose(base())));
});

test('composition is deterministic', () => {
  const input = base({
    projectLayerPath: PROJECT_LAYER,
    specDriven: true,
    nativeFiles: [{ path: '/repo/CLAUDE.md', kind: 'claude' }]
  });
  assert.equal(compose(input), compose(input));
});
