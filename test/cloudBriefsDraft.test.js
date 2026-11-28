/**
 * cloudBriefsDraft tests — the New brief form's state, without the form.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const draft = require('../src/renderer/cloudBriefsDraft');

// ─── linkService ──────────────────────────────────────────────

test('linkService names the known services', () => {
  const cases = [
    ['https://claude.ai/chat/abc', 'claude', 'Claude chat'],
    ['https://claude.ai/public/artifacts/abc', 'claude', 'Claude artifact'],
    ['https://abc.claude.site/artifact', 'claude', 'Claude artifact'],
    ['https://chatgpt.com/share/1', 'chatgpt', 'ChatGPT conversation'],
    ['https://chat.openai.com/c/1', 'chatgpt', 'ChatGPT conversation'],
    ['https://gemini.google.com/app/1', 'gemini', 'Gemini conversation'],
    ['https://g.co/gemini/share/1', 'gemini', 'Gemini conversation'],
    ['https://www.figma.com/file/1', 'figma', 'Figma file'],
    ['https://github.com/a/b/pull/1', 'github', 'GitHub link'],
  ];
  for (const [url, id, title] of cases) {
    const s = draft.linkService(url);
    assert.equal(s.id, id, url);
    assert.equal(s.defaultTitle, title, url);
  }
});

test('linkService titles an unknown link by its host, without www.', () => {
  assert.deepEqual(draft.linkService('  https://www.Example.com/a  '), { id: 'link', defaultTitle: 'example.com', host: 'example.com' });
  assert.equal(draft.linkService('https://g.co/other').id, 'link');
  assert.equal(draft.linkService('https://notgithub.com').id, 'link');
});

test('linkService refuses anything that is not a full http(s) URL', () => {
  for (const bad of ['', 'example.com', 'javascript:alert(1)', 'ftp://x.test', 'file:///etc', 'mailto:a@b.c', null]) {
    assert.equal(draft.linkService(bad), null, String(bad));
  }
});

// ─── Draft ────────────────────────────────────────────────────

test('emptyDraft is Work, Medium and empty, fresh each time', () => {
  const a = draft.emptyDraft();
  assert.equal(a.kind, 'work');
  assert.equal(a.priority, 'medium');
  assert.equal(a.title, '');
  assert.equal(a.body, '');
  assert.deepEqual(a.links, []);
  a.links.push({});
  assert.deepEqual(draft.emptyDraft().links, []);
});

test('addLink appends a row titled after its service, with a new key', () => {
  let d = draft.emptyDraft();
  d = draft.addLink(d, ' https://claude.ai/chat/1 ');
  d = draft.addLink(d, 'https://example.com');
  assert.deepEqual(d.links.map((l) => [l.key, l.title, l.url]), [
    [1, 'Claude chat', 'https://claude.ai/chat/1'],
    [2, 'example.com', 'https://example.com'],
  ]);
});

test('addLink refuses a non-http(s) text and leaves the draft alone', () => {
  const d = draft.emptyDraft();
  assert.equal(draft.addLink(d, 'not a link'), null);
  assert.deepEqual(d.links, []);
});

// ─── validateDraft ────────────────────────────────────────────

test('validateDraft stops an empty, whitespace or too-long title', () => {
  for (const title of ['', '   ', 'x'.repeat(201)]) {
    const r = draft.validateDraft({ ...draft.emptyDraft(), title });
    assert.equal(r.ok, false);
    assert.equal(r.titleError, true);
  }
  assert.equal(draft.validateDraft({ ...draft.emptyDraft(), title: 'x'.repeat(200) }).ok, true);
});

test('validateDraft names the link rows whose title was cleared', () => {
  let d = { ...draft.emptyDraft(), title: 'Ship it' };
  d = draft.addLink(d, 'https://a.test');
  d = draft.addLink(d, 'https://b.test');
  d.links[1] = { ...d.links[1], title: '  ' };
  const r = draft.validateDraft(d);
  assert.deepEqual(r, { ok: false, titleError: false, untitledKeys: [2] });
});

// ─── toRequest ────────────────────────────────────────────────

test('toRequest carries priority only for Work', () => {
  const work = draft.toRequest({ ...draft.emptyDraft(), title: ' Ship ', priority: 'high' });
  assert.deepEqual(work, { kind: 'work', title: 'Ship', body: '', links: [], priority: 'high' });
  const proposal = draft.toRequest({ ...draft.emptyDraft(), kind: 'proposal', title: 'Idea' });
  assert.equal('priority' in proposal, false);
});

test('toRequest sends links in the order shown, as title and url only', () => {
  let d = { ...draft.emptyDraft(), title: 'x' };
  d = draft.addLink(d, 'https://b.test');
  d = draft.addLink(d, 'https://a.test');
  d.links[0] = { ...d.links[0], title: ' Bee ' };
  assert.deepEqual(draft.toRequest(d).links, [
    { title: 'Bee', url: 'https://b.test' },
    { title: 'a.test', url: 'https://a.test' },
  ]);
});
