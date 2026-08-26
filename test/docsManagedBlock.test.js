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

const { findBlock, upgradeDoc, appendBlock, renderBlock } = require('../src/shared/docsManagedBlock');

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

test('pre-split AGENTS.md carrying either full-section generation migrates to the core pointer', () => {
  for (const legacy of [templates.LEGACY_SPEC_DRIVEN_SECTION, templates.LEGACY_SPEC_DRIVEN_SECTION_V0]) {
    const doc = `# proj\n\n---\n\n${legacy}\n\n---\n\n## User's Own Section\n\nProse.\n`;
    const migrated = upgradeDoc(doc, {
      body: templates.SPEC_DRIVEN_CORE_SECTION,
      version: templates.SPEC_SECTION_VERSION,
      legacyMatchers: templates.AGENTS_SPEC_LEGACY_MATCHERS
    });
    assert.ok(migrated);
    assert.ok(migrated.includes(templates.renderSpecCoreSection()));
    assert.ok(!migrated.includes('exactly one file'));
    assert.ok(migrated.includes("## User's Own Section"));
  }
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

// ─── Named blocks ─────────────────────────────────────────────

const NAV_BLOCK = 'frame:managed:nav-section';

test('a second named block is found and upgraded independently of the spec block', () => {
  const doc = docWith(renderBlock(NEW_BODY, 1, NAV_BLOCK));

  // The spec block's name must not see the nav block's markers.
  assert.equal(findBlock(doc), null);

  const nav = findBlock(doc, NAV_BLOCK);
  assert.ok(nav);
  assert.equal(nav.version, 1);

  const upgraded = upgradeDoc(doc, {
    body: 'Fresh nav prose.', version: 2, blockName: NAV_BLOCK
  });
  assert.ok(upgraded);
  assert.ok(upgraded.includes(renderBlock('Fresh nav prose.', 2, NAV_BLOCK)));
  assert.ok(upgraded.includes("## User's Own Section"));
});

test('two blocks coexist in one document, each on its own version stamp', () => {
  const doc = `# Doc\n\n${renderBlock('spec body', 2)}\n\n---\n\n${renderBlock('nav body', 1, NAV_BLOCK)}\n`;

  // The nav block is stale; the spec block is current. Only the nav one moves.
  assert.equal(upgradeDoc(doc, { body: 'spec body', version: 2 }), null);

  const upgraded = upgradeDoc(doc, {
    body: 'nav body v2', version: 2, blockName: NAV_BLOCK
  });
  assert.ok(upgraded);
  assert.ok(upgraded.includes(renderBlock('spec body', 2)));
  assert.ok(upgraded.includes(renderBlock('nav body v2', 2, NAV_BLOCK)));
});

// ─── Additive branch ──────────────────────────────────────────

const FOOTER = '*This file was automatically created by Frame.*';

test('onAbsent append adds the block to a document that carries no section', () => {
  const doc = `# My Project\n\nIntro paragraph the user wrote.\n\n---\n\n${FOOTER}\n`;
  const appended = upgradeDoc(doc, {
    body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION],
    onAbsent: 'append', footerMarker: FOOTER
  });
  assert.ok(appended);
  // Added, not rewritten: the user's prose and the footer both survive, and
  // the block lands between them.
  assert.ok(appended.includes('Intro paragraph the user wrote.'));
  assert.ok(appended.includes(renderBlock(NEW_BODY, 2)));
  assert.ok(appended.indexOf(renderBlock(NEW_BODY, 2)) < appended.indexOf(FOOTER));
  // No stacked rules where the footer's separator used to be.
  assert.ok(!/-{3,}[ \t]*\n+-{3,}/.test(appended));
  // And the result is now on the marker path, so the next upgrade is a no-op.
  assert.equal(upgradeDoc(appended, { body: NEW_BODY, version: 2 }), null);
});

test('append with no footer marker puts the block at the end', () => {
  const doc = '# My Project\n\nJust prose.\n';
  const appended = appendBlock(doc, { body: NEW_BODY, version: 2 });
  assert.ok(appended.startsWith('# My Project\n\nJust prose.'));
  assert.ok(appended.trimEnd().endsWith(renderBlock(NEW_BODY, 2)));
});

test('append never fires where a section already exists', () => {
  const opts = {
    body: NEW_BODY, version: 2, legacyMatchers: [LEGACY_SECTION],
    onAbsent: 'append', footerMarker: FOOTER
  };

  // A legacy section is replaced, not duplicated.
  const migrated = upgradeDoc(docWith(LEGACY_SECTION), opts);
  assert.ok(migrated);
  assert.equal(migrated.match(/frame:managed:spec-section v=/g).length, 1);

  // A block at the current version stays a no-op even with append asked for.
  assert.equal(upgradeDoc(docWith(renderBlock(NEW_BODY, 2)), opts), null);

  // A marker fragment is corruption: never append beside it.
  const broken = docWith('<!-- frame:managed:spec-section v=1 -->\nbody, no end marker');
  assert.equal(upgradeDoc(broken, opts), null);
});

test('append rejects the same invalid inputs upgradeDoc does', () => {
  assert.equal(appendBlock(null, { body: NEW_BODY, version: 2 }), null);
  assert.equal(appendBlock('# Doc', { body: NEW_BODY, version: 1.5 }), null);
  assert.equal(appendBlock('# Doc', { version: 2 }), null);
});

// ─── Removing sections Frame has since moved elsewhere ────────

const { removeLegacySections } = require('../src/shared/docsManagedBlock');

const SEC_A = '## Alpha Rules\n\nFirst shipped section.';
const SEC_B = '## Beta Rules\n\nSecond shipped section.';

const threeSectionDoc = `# Doc

Intro.

---

${SEC_A}

---

${SEC_B}

---

## The User's Own

Theirs.

---

${FOOTER}
`;

test('every matcher must hit, or nothing is removed', () => {
  const both = removeLegacySections(threeSectionDoc, [SEC_A, SEC_B]);
  assert.equal(both.matched, 2);
  assert.ok(both.text);
  assert.ok(!both.text.includes('First shipped section.'));
  assert.ok(!both.text.includes('Second shipped section.'));
  // Everything that was not matched survives.
  assert.ok(both.text.includes("## The User's Own"));
  assert.ok(both.text.includes('Intro.'));
  assert.ok(both.text.includes(FOOTER));

  // One section edited: five-of-six is exactly the case that must not fire,
  // because stripping the rest strands the one the user worked on.
  const edited = threeSectionDoc.replace('Second shipped section.', 'Mine now.');
  const partial = removeLegacySections(edited, [SEC_A, SEC_B]);
  assert.equal(partial.text, null);
  assert.equal(partial.matched, 1);
  assert.equal(partial.total, 2);
  // `matched` is what separates "not this generation" from "this one, edited".
  assert.equal(removeLegacySections('# Unrelated\n\nProse.', [SEC_A, SEC_B]).matched, 0);
});

test('removal leaves no stacked separators or blank-line runs', () => {
  const { text } = removeLegacySections(threeSectionDoc, [SEC_A, SEC_B]);
  assert.ok(!/-{3,}[ \t]*\n\s*\n-{3,}/.test(text), 'two rules left stacked');
  assert.ok(!/\n{3,}/.test(text), 'blank-line run left behind');
});

test('removal refuses non-strings, empty matcher lists and unknown sections', () => {
  assert.equal(removeLegacySections(null, [SEC_A]).text, null);
  assert.equal(removeLegacySections(threeSectionDoc, []).text, null);
  assert.equal(removeLegacySections(threeSectionDoc, []).total, 0);
  assert.equal(removeLegacySections(threeSectionDoc, ['## Nope\n\nNever shipped.']).text, null);
});
