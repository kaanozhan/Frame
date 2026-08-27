/**
 * Doc-health report tests (spec-docs-delivery-invariant T02).
 *
 * The report is the invariant made checkable: an agent reading Frame's prose
 * can reach what it names, and no document carries a section Frame must not
 * touch. These tests pin the two findings and, above all, the four-state
 * classification — collapsing `absent` and `unmatched` into one is what would
 * put a second protocol beside a user's own.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  report, namedPaths, hasSectionLike, headingStem, classifySection
} = require('../src/shared/docsHealth');
const { renderBlock, SPEC_BLOCK_NAME } = require('../src/shared/docsManagedBlock');

const LEGACY_SECTION = `## Spec-Driven Development (.frame/specs/)

Frame supports a structured workflow.

- \`/spec.new <description>\` → write \`spec.md\`.`;

const SPEC_BLOCK = {
  name: SPEC_BLOCK_NAME,
  legacyMatchers: [LEGACY_SECTION],
  headingStems: ['spec-driven development']
};

const everythingExists = () => true;
const nothingExists = () => false;

// ─── namedPaths ───────────────────────────────────────────────

test('named paths are collected from prose and from fenced commands', () => {
  const text = [
    'Read `.frame/STRUCTURE.json` first.',
    '',
    '```bash',
    'node .frame/bin/find-module.js <keyword>',
    '```',
    '',
    'The reference lives at `.frame/docs/REFERENCE.md`.'
  ].join('\n');

  assert.deepEqual(namedPaths(text), [
    '.frame/STRUCTURE.json',
    '.frame/bin/find-module.js',
    '.frame/docs/REFERENCE.md'
  ]);
});

test('placeholders and bare directories are not paths to check', () => {
  const text = [
    'Each spec lives in `.frame/specs/<slug>/spec.md`.',
    'Templates go to `.frame/runtime/commands/<tool>/<command>.md`.',
    'Styles live under `.frame/renderer/styles/**`.',
    'The folder is `.frame/specs/`.'
  ].join('\n');
  assert.deepEqual(namedPaths(text), []);
});

test('sentence punctuation is trimmed, real extensions are kept', () => {
  assert.deepEqual(namedPaths('It is written to `.frame/tasks.json`.'), ['.frame/tasks.json']);
  assert.deepEqual(namedPaths('See .frame/AGENTS.md, then stop.'), ['.frame/AGENTS.md']);
  assert.deepEqual(namedPaths('Look in .frame/docs/REFERENCE.md).'), ['.frame/docs/REFERENCE.md']);
});

test('a path named twice is reported once', () => {
  const text = '`.frame/tasks.json` and again `.frame/tasks.json`.';
  assert.deepEqual(namedPaths(text), ['.frame/tasks.json']);
});

// ─── heading detection ────────────────────────────────────────

test('heading stems survive the decoration Frame and users both add', () => {
  assert.equal(headingStem('## Spec-Driven Development (.frame/specs/)'), 'spec-driven development');
  assert.equal(headingStem('## Spec-driven development — how to suggest'), 'spec-driven development');
  assert.equal(headingStem('## Spec-Driven Development'), 'spec-driven development');
});

test('a hand-written variant of the heading still reads as a section', () => {
  const stems = ['spec-driven development'];
  assert.equal(hasSectionLike('## Spec-driven development — how to suggest\n\nProse.', stems), true);
  assert.equal(hasSectionLike('## Task Management\n\nProse.', stems), false);
  // Not a heading, just a mention.
  assert.equal(hasSectionLike('We use spec-driven development here.', stems), false);
});

// ─── the four states ──────────────────────────────────────────

test('a document carrying the block is managed', () => {
  const doc = `# Doc\n\n${renderBlock('body', 2)}\n`;
  assert.equal(classifySection(doc, SPEC_BLOCK), 'managed');
});

test('a shipped generation is legacy — the repair pass will replace it', () => {
  const doc = `# Doc\n\nIntro.\n\n${LEGACY_SECTION}\n`;
  assert.equal(classifySection(doc, SPEC_BLOCK), 'legacy');
});

test('a document with no section at all is absent — safe to append', () => {
  const doc = '# Doc\n\nIntro the user wrote.\n\n## Task Management\n\nRules.\n';
  assert.equal(classifySection(doc, SPEC_BLOCK), 'absent');
});

test("a user's own section is unmatched — never appended beside", () => {
  const doc = [
    '# Doc',
    '',
    '## Spec-driven development — how to suggest',
    '',
    'Ask once, in plain language, before coding.'
  ].join('\n');
  assert.equal(classifySection(doc, SPEC_BLOCK), 'unmatched');
  // The distinction is the whole point: this must not read as `absent`.
  assert.notEqual(classifySection(doc, SPEC_BLOCK), 'absent');
});

test('a dangling marker is unmatched, not appendable', () => {
  const doc = `# Doc\n\n<!-- ${SPEC_BLOCK_NAME} v=1 -->\nbody with no end marker\n`;
  assert.equal(classifySection(doc, SPEC_BLOCK), 'unmatched');
});

// ─── report ───────────────────────────────────────────────────

test('a pointer with no target is reported against the document naming it', () => {
  const docs = [{
    path: '.frame/AGENTS.md',
    text: 'The full workflow lives in `.frame/docs/REFERENCE.md`.',
    blocks: []
  }];
  const result = report(docs, (p) => p !== '.frame/docs/REFERENCE.md');
  assert.deepEqual(result.missingPaths, [
    { doc: '.frame/AGENTS.md', path: '.frame/docs/REFERENCE.md' }
  ]);
  assert.equal(result.ok, false);
});

test('a healthy pair of documents reports ok with nothing to do', () => {
  const docs = [
    { path: '.frame/AGENTS.md', text: `# A\n\n${renderBlock('core', 2)}\n`, blocks: [SPEC_BLOCK] },
    { path: '.frame/docs/REFERENCE.md', text: `# R\n\n${renderBlock('full', 2)}\n`, blocks: [SPEC_BLOCK] }
  ];
  const result = report(docs, everythingExists);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingPaths, []);
  assert.deepEqual(result.unmatchedSections, []);
  assert.deepEqual(result.appendableSections, []);
  assert.deepEqual(result.sections.map((s) => s.state), ['managed', 'managed']);
});

test('appendable and unmatched sections are separated, not lumped together', () => {
  const docs = [
    { path: 'a.md', text: '# A\n\nNo section here.\n', blocks: [SPEC_BLOCK] },
    {
      path: 'b.md',
      text: '# B\n\n## Spec-driven development — how to suggest\n\nOurs.\n',
      blocks: [SPEC_BLOCK]
    }
  ];
  const result = report(docs, everythingExists);
  assert.deepEqual(result.appendableSections, [{ doc: 'a.md', block: SPEC_BLOCK_NAME, state: 'absent' }]);
  assert.deepEqual(result.unmatchedSections, [{ doc: 'b.md', block: SPEC_BLOCK_NAME, state: 'unmatched' }]);
  // An appendable section is work, not a break — only the unmatched one
  // requires a human, so `ok` turns on that alone.
  assert.equal(result.ok, false);
  assert.equal(report([docs[0]], everythingExists).ok, true);
});

test('a document that could not be read is reported, never silently skipped', () => {
  const result = report([{ path: '.frame/docs/REFERENCE.md', text: null, blocks: [SPEC_BLOCK] }], everythingExists);
  assert.deepEqual(result.unreadable, [{ doc: '.frame/docs/REFERENCE.md' }]);
  assert.deepEqual(result.sections, []);
  assert.equal(result.ok, false);
});

test('several blocks in one document are classified independently', () => {
  const NAV_BLOCK = { name: 'frame:managed:nav-section', legacyMatchers: [], headingStems: ['project navigation'] };
  const doc = {
    path: '.frame/AGENTS.md',
    text: `# A\n\n${renderBlock('core', 2)}\n\n## Project Navigation\n\nOurs.\n`,
    blocks: [SPEC_BLOCK, NAV_BLOCK]
  };
  const result = report([doc], everythingExists);
  assert.deepEqual(result.sections.map((s) => s.state), ['managed', 'unmatched']);
});

test('the whole report degrades gracefully on empty input', () => {
  const result = report([], nothingExists);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sections, []);
});
