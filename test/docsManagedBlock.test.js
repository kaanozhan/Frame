/**
 * Managed-block engine tests (cli-spec-command-parity T01).
 *
 * The engine may rewrite only what it can prove is Frame's: a marker-wrapped
 * block with an older stamp, or a legacy section that byte-matches (modulo
 * whitespace) a text Frame itself shipped. These tests pin the safety
 * properties: version gating, byte-identical surroundings, once-only legacy
 * migration, customized bodies left alone, malformed markers left alone.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findBlock, upgradeDoc, renderBlock } = require('../src/shared/docsManagedBlock');

const LEGACY_SECTION = `## Spec-Driven Development (.frame/specs/)

Frame supports a structured workflow.

### Slash commands

- \`/spec.new <description>\` → write \`spec.md\`.
- \`/spec.plan\` → write \`plan.md\`.`;

const NEW_BODY = `## Spec-Driven Development (self-serve)

Resolve the staged template and follow it exactly.`;

const docWith = (middle) => `# My Project

Intro paragraph the user wrote.

---

${middle}

---

## User's Own Section

Untouched prose.
`;

// ─── findBlock ────────────────────────────────────────────────

test('findBlock parses markers and version', () => {
  const doc = docWith(renderBlock(NEW_BODY, 3));
  const block = findBlock(doc);
  assert.ok(block);
  assert.equal(block.version, 3);
  assert.equal(doc.slice(block.start, block.end), renderBlock(NEW_BODY, 3));
});

test('findBlock returns null without markers, on malformed markers, and on non-strings', () => {
  assert.equal(findBlock(docWith(LEGACY_SECTION)), null);
  // begin without end
  assert.equal(findBlock(docWith('<!-- frame:managed:spec-section v=1 -->\nbody')), null);
  // end before begin
  assert.equal(
    findBlock('<!-- /frame:managed:spec-section -->\n<!-- frame:managed:spec-section v=1 -->'),
    null
  );
  assert.equal(findBlock(null), null);
});

// ─── version gating ───────────────────────────────────────────

test('stamped current or newer is a no-op', () => {
  const current = docWith(renderBlock('tweaked by user', 2));
  assert.equal(upgradeDoc(current, { body: NEW_BODY, version: 2 }), null);
  assert.equal(upgradeDoc(current, { body: NEW_BODY, version: 1 }), null);
});

test('stamped older is upgraded in place with byte-identical surroundings', () => {
  const doc = docWith(renderBlock('old generation text', 1));
  const upgraded = upgradeDoc(doc, { body: NEW_BODY, version: 2 });
  assert.ok(upgraded);
  assert.equal(upgraded, docWith(renderBlock(NEW_BODY, 2)));
  // idempotent: the upgraded doc is now stamped current
  assert.equal(upgradeDoc(upgraded, { body: NEW_BODY, version: 2 }), null);
});

// ─── legacy migration ─────────────────────────────────────────

test('shipped legacy section migrates once', () => {
  const doc = docWith(LEGACY_SECTION);
  const opts = { body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION] };
  const migrated = upgradeDoc(doc, opts);
  assert.ok(migrated);
  assert.equal(migrated, docWith(renderBlock(NEW_BODY, 2)));
  // once-only: markers now gate; a second pass changes nothing
  assert.equal(upgradeDoc(migrated, opts), null);
});

test('legacy match tolerates whitespace drift but not text edits', () => {
  const reflowed = LEGACY_SECTION.replace('supports a structured workflow.', 'supports a structured\nworkflow.') + '  ';
  const migrated = upgradeDoc(docWith(reflowed), {
    body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION]
  });
  assert.ok(migrated);
});

test('customized body under a known heading leaves the file alone', () => {
  const customized = LEGACY_SECTION.replace('Frame supports', 'We heavily customized how Frame supports');
  const doc = docWith(customized);
  assert.equal(
    upgradeDoc(doc, { body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION] }),
    null
  );
});

test('unknown heading leaves the file alone', () => {
  const doc = docWith('## Something Else\n\nUnrelated.');
  assert.equal(
    upgradeDoc(doc, { body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION] }),
    null
  );
});

test('malformed markers block both paths', () => {
  // A dangling begin marker means corrupted Frame state — no block is found,
  // and legacy migration is refused even for a pristine section nearby.
  const polluted = docWith('<!-- frame:managed:spec-section v=1 -->\n' + LEGACY_SECTION);
  assert.equal(findBlock(polluted), null);
  assert.equal(
    upgradeDoc(polluted, { body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION] }),
    null
  );
});

test('section at end of file migrates and trailing separator stays outside the block', () => {
  const doc = `# P\n\nIntro.\n\n---\n\n${LEGACY_SECTION}\n`;
  const migrated = upgradeDoc(doc, { body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION] });
  assert.ok(migrated);
  assert.ok(migrated.startsWith('# P\n\nIntro.\n\n---\n\n'));
  assert.ok(migrated.includes(renderBlock(NEW_BODY, 2)));
});

// ─── template round-trip (T03) ────────────────────────────────
//
// The docs Frame emits must parse as managed blocks stamped current, and the
// frozen legacy constants must still pass the migration gate — otherwise a
// Frame release would either re-migrate its own docs or strand old ones.

const templates = require('../src/shared/frameTemplates');

test('freshly emitted REFERENCE.md parses at the current version', () => {
  const doc = templates.getReferenceTemplate('proj');
  const block = findBlock(doc);
  assert.ok(block);
  assert.equal(block.version, templates.SPEC_SECTION_VERSION);
  // stamped current → the upgrade driver leaves it alone
  assert.equal(upgradeDoc(doc, {
    body: templates.SPEC_DRIVEN_SECTION,
    version: templates.SPEC_SECTION_VERSION,
    legacyMatchers: templates.REFERENCE_SPEC_LEGACY_MATCHERS
  }), null);
});

test('freshly emitted AGENTS.md (specDriven) parses at the current version', () => {
  const doc = templates.getAgentsTemplate('proj', { specDriven: true });
  const block = findBlock(doc);
  assert.ok(block);
  assert.equal(block.version, templates.SPEC_SECTION_VERSION);
  assert.equal(upgradeDoc(doc, {
    body: templates.SPEC_DRIVEN_CORE_SECTION,
    version: templates.SPEC_SECTION_VERSION,
    legacyMatchers: templates.AGENTS_SPEC_LEGACY_MATCHERS
  }), null);
});

test('AGENTS.md without specDriven has no managed block', () => {
  assert.equal(findBlock(templates.getAgentsTemplate('proj', { specDriven: false })), null);
});

test('legacy matchers migrate the previously shipped section bodies', () => {
  const legacyRef = `# proj — Frame Reference\n\nIntro.\n\n---\n\n${templates.LEGACY_SPEC_DRIVEN_SECTION}\n\n---\n\n## PROJECT_NOTES.md Rules\n\nStuff.\n`;
  const migratedRef = upgradeDoc(legacyRef, {
    body: templates.SPEC_DRIVEN_SECTION,
    version: templates.SPEC_SECTION_VERSION,
    legacyMatchers: templates.REFERENCE_SPEC_LEGACY_MATCHERS
  });
  assert.ok(migratedRef);
  assert.ok(migratedRef.includes(templates.renderSpecSection()));
  assert.ok(migratedRef.includes('## PROJECT_NOTES.md Rules'));

  const legacyAgents = `# proj\n\n---\n\n${templates.LEGACY_SPEC_DRIVEN_CORE_SECTION}\n\n---\n\nFooter.\n`;
  const migratedAgents = upgradeDoc(legacyAgents, {
    body: templates.SPEC_DRIVEN_CORE_SECTION,
    version: templates.SPEC_SECTION_VERSION,
    legacyMatchers: templates.AGENTS_SPEC_LEGACY_MATCHERS
  });
  assert.ok(migratedAgents);
  assert.ok(migratedAgents.includes(templates.renderSpecCoreSection()));
});

test('subheadings inside the section do not truncate the match', () => {
  // LEGACY_SECTION contains an H3; the span must run to the next H1/H2.
  const migrated = upgradeDoc(docWith(LEGACY_SECTION), {
    body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION]
  });
  assert.ok(migrated);
  assert.ok(!migrated.includes('### Slash commands'));
  assert.ok(migrated.includes("## User's Own Section"));
});
