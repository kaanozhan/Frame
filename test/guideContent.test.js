/**
 * How to Use Frame — the guide's content (how-to-use-frame-guide spec).
 *
 * guideContent.js is pure by design: CI runs `npm test` with no `npm ci`, so
 * requiring it at the top of this file is itself half the test — if it grows
 * a dependency on electron, lucide or the DOM, this suite stops loading.
 *
 * What is covered is what the modal relies on and a content edit could
 * break silently: page order, ids, every command a page cites, the sketch
 * kinds, and that validate() actually catches each kind of mistake.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const guide = require('../src/renderer/guide/guideContent');
const { CHAPTERS, SKETCH_KINDS, ACTION_IDS, STAY_IDS, flattenPages, parseInline, validate } = guide;

// ─── helpers ──────────────────────────────────────────────

/** A minimal sound content tree to break one rule at a time. */
function fixture() {
  return [
    {
      id: 'a',
      title: 'A',
      pages: [
        { id: 'a.one', title: 'One', sketch: { kind: 'shell' }, blocks: [{ p: 'Hello {kbd:terminal.new}' }] },
        { id: 'a.two', title: 'Two', sketch: { kind: 'agents' }, blocks: [{ list: ['x', 'y'] }],
          actions: [{ id: 'settings.open', label: 'Open' }] }
      ]
    },
    {
      id: 'b',
      title: 'B',
      pages: [
        { id: 'b.one', title: 'Three', sketch: { kind: 'themes' }, blocks: [{ note: 'n' }],
          actions: [{ id: 'theme.dark', label: 'Dark', stay: true }] }
      ]
    }
  ];
}

function problemsFor(mutate) {
  const chapters = fixture();
  mutate(chapters);
  return validate(chapters);
}

// ─── the shipped content ──────────────────────────────────

test('the shipped content validates clean', () => {
  assert.deepEqual(validate(), []);
});

test('chapter ids and page ids are unique', () => {
  const chapterIds = CHAPTERS.map((c) => c.id);
  assert.equal(new Set(chapterIds).size, chapterIds.length);
  const pageIds = flattenPages().map((e) => e.page.id);
  assert.equal(new Set(pageIds).size, pageIds.length);
});

test('every page has a title, at least one block and a known sketch kind', () => {
  for (const { page } of flattenPages()) {
    assert.ok(page.title, `${page.id} has a title`);
    assert.ok(Array.isArray(page.blocks) && page.blocks.length > 0, `${page.id} has blocks`);
    assert.ok(SKETCH_KINDS.includes(page.sketch.kind), `${page.id} sketch kind is declared`);
  }
});

test('every cited command is in the allowlist, and only theme/zoom links stay open', () => {
  for (const { page } of flattenPages()) {
    for (const action of page.actions || []) {
      assert.ok(ACTION_IDS.includes(action.id), `${page.id} → ${action.id}`);
      if (action.stay) assert.ok(STAY_IDS.includes(action.id), `${page.id} stay → ${action.id}`);
    }
    for (const block of page.blocks) {
      const texts = Array.isArray(block.list) ? block.list : Object.values(block);
      for (const text of texts) {
        for (const seg of parseInline(text)) {
          if (seg.type === 'kbd') assert.ok(ACTION_IDS.includes(seg.value), `${page.id} {kbd:${seg.value}}`);
        }
      }
    }
  }
});

test('the allowlist has no duplicates and contains every stay id', () => {
  assert.equal(new Set(ACTION_IDS).size, ACTION_IDS.length);
  for (const id of STAY_IDS) assert.ok(ACTION_IDS.includes(id), id);
});

test('SKETCH_KINDS declares the twenty-one kinds (the plan\'s twenty plus workspaces), once each', () => {
  assert.equal(SKETCH_KINDS.length, 21);
  assert.equal(new Set(SKETCH_KINDS).size, 21);
  assert.ok(SKETCH_KINDS.includes('workspaces'), 'workspaces & servers (multi-server-connections)');
});

test('the guide opens on "What Frame is"', () => {
  assert.equal(flattenPages()[0].page.id, 'start.what');
});

// ─── flattenPages ─────────────────────────────────────────

test('flattenPages walks chapters in order and crosses chapter boundaries', () => {
  const flat = flattenPages(fixture());
  assert.deepEqual(flat.map((e) => e.page.id), ['a.one', 'a.two', 'b.one']);
  assert.deepEqual(flat.map((e) => e.chapterId), ['a', 'a', 'b']);
  assert.deepEqual(flat.map((e) => e.index), [0, 1, 2]);
});

test('flattenPages length equals the total page count of the shipped content', () => {
  const total = CHAPTERS.reduce((n, c) => n + c.pages.length, 0);
  assert.equal(flattenPages().length, total);
});

// ─── parseInline ──────────────────────────────────────────

test('parseInline splits text, kbd tokens and code spans', () => {
  assert.deepEqual(parseInline('Press {kbd:terminal.new} then run `claude`.'), [
    { type: 'text', value: 'Press ' },
    { type: 'kbd', value: 'terminal.new' },
    { type: 'text', value: ' then run ' },
    { type: 'code', value: 'claude' },
    { type: 'text', value: '.' }
  ]);
});

test('parseInline leaves plain text and markup-looking text as one text segment', () => {
  assert.deepEqual(parseInline('<b>not html</b>'), [{ type: 'text', value: '<b>not html</b>' }]);
  assert.deepEqual(parseInline(''), []);
});

// ─── validate catches each mistake ────────────────────────

test('validate accepts the sound fixture', () => {
  assert.deepEqual(validate(fixture()), []);
});

test('validate reports an empty content tree', () => {
  assert.deepEqual(validate([]), ['no chapters']);
});

test('validate reports duplicate chapter and page ids', () => {
  assert.match(problemsFor((c) => { c[1].id = 'a'; }).join('\n'), /duplicate chapter id "a"/);
  assert.match(problemsFor((c) => { c[1].pages[0].id = 'a.one'; }).join('\n'), /duplicate page id "a.one"/);
});

test('validate reports missing titles and chapters without pages', () => {
  assert.match(problemsFor((c) => { c[0].title = ''; }).join('\n'), /chapter "a" has no title/);
  assert.match(problemsFor((c) => { c[0].pages[0].title = ''; }).join('\n'), /page "a.one" has no title/);
  assert.match(problemsFor((c) => { c[1].pages = []; }).join('\n'), /chapter "b" has no pages/);
});

test('validate reports pages without blocks, malformed blocks and empty blocks', () => {
  assert.match(problemsFor((c) => { c[0].pages[0].blocks = []; }).join('\n'), /page "a.one" has no blocks/);
  assert.match(problemsFor((c) => { c[0].pages[0].blocks = [{ p: 'x', note: 'y' }]; }).join('\n'), /not exactly one of/);
  assert.match(problemsFor((c) => { c[0].pages[0].blocks = [{ html: '<b>' }]; }).join('\n'), /not exactly one of/);
  assert.match(problemsFor((c) => { c[0].pages[0].blocks = [{ p: '   ' }]; }).join('\n'), /empty p block/);
  assert.match(problemsFor((c) => { c[0].pages[1].blocks = [{ list: [] }]; }).join('\n'), /empty list block/);
});

test('validate reports an unknown sketch kind', () => {
  assert.match(problemsFor((c) => { c[0].pages[0].sketch = { kind: 'photo' }; }).join('\n'), /unknown sketch kind "photo"/);
  assert.match(problemsFor((c) => { delete c[0].pages[0].sketch; }).join('\n'), /unknown sketch kind/);
});

test('validate reports commands outside the allowlist, in links and in kbd tokens', () => {
  assert.match(problemsFor((c) => { c[0].pages[1].actions[0].id = 'nope.command'; }).join('\n'), /links "nope.command"/);
  assert.match(problemsFor((c) => { c[0].pages[0].blocks = [{ p: '{kbd:nope.key}' }]; }).join('\n'), /cites \{kbd:nope.key\}/);
});

test('validate reports an action without a label and stay on a non theme/zoom command', () => {
  assert.match(problemsFor((c) => { c[0].pages[1].actions[0].label = ''; }).join('\n'), /action without a label/);
  assert.match(problemsFor((c) => { c[0].pages[1].actions[0].stay = true; }).join('\n'), /marks "settings.open" as stay/);
});

test('no page or sketch names the module map (opt-in, off for new users)', () => {
  // STRUCTURE.json is opt-in per project and off by default, so the Guide —
  // global, read by every new user — never presents it.
  const MAP = /STRUCTURE\.json|module map|find-module|module-hint/;
  for (const page of flattenPages(CHAPTERS)) {
    assert.ok(!MAP.test(JSON.stringify(page)), `page ${page.id}`);
  }
  const sketches = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'renderer', 'guide', 'guideSketches.js'), 'utf8');
  assert.ok(!MAP.test(sketches), 'guideSketches.js');
});
