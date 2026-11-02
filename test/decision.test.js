/**
 * decision.js — the card writer and lookup CLI (decision-cards-core T02).
 *
 * Run as a process, the way an agent runs it from `.frame/bin/`. These pin
 * what `add` assigns (id, date), what it refuses (a source that does not
 * resolve, an unknown or superseded relation, a repeated id, a bad shape),
 * that it appends one whole line even after a torn one and under concurrent
 * writers, and what `related` and `list` print — including for a project
 * with no card file.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'decision.js');
const cards = require('../scripts/decision-cards');
const events = require('../src/shared/activityEvents');
const activityLog = require('../scripts/activity-log');

const DATE = '2026-10-23';

const NOTES = [
  '# Project Notes',
  '',
  '### [2026-10-14] Union merge for cards',
  '',
  'Cards from two branches must merge without a conflict.',
  ''
].join('\n');

function mkProject({ notes = NOTES, specs = ['spec-close-step'], files = ['src/main/gitSharing.js'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-decision-cli-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  if (notes !== null) fs.writeFileSync(path.join(root, '.frame', 'PROJECT_NOTES.md'), notes);
  for (const slug of specs) fs.mkdirSync(path.join(root, '.frame', 'specs', slug), { recursive: true });
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '');
  }
  return root;
}

function env(root) {
  return { ...process.env, FRAME_PROJECT_ROOT: root, FRAME_ACTIVITY_HOME: path.join(root, '.activity-home'), FRAME_DECISION_DATE: DATE };
}

function run(root, args, input) {
  const res = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: env(root), input });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function rows(root) {
  try {
    return fs.readFileSync(path.join(root, '.activity-home', activityLog.projectKey(root), 'activity.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function input(over = {}) {
  return {
    decision: 'Card files merge with the union driver.',
    why: 'Two branches each append a card, and a line-based union merge keeps both without a conflict.',
    keywords: ['union merge', 'gitattributes'],
    files: ['src/main/gitSharing.js'],
    source: 'notes:2026-10-14 Union merge for cards',
    ...over
  };
}

function add(root, over, args = []) {
  return run(root, ['add', JSON.stringify(input(over)), ...args]);
}

function fileLines(root) {
  return fs.readFileSync(cards.cardsPath(root), 'utf8').split('\n');
}

// ─── add ──────────────────────────────────────────────────────

test('add assigns the id and date, appends one line and says what it wrote', () => {
  const root = mkProject();
  const res = add(root);
  assert.equal(res.status, 0, res.stderr);
  const { cards: [card], malformed } = cards.readCards(root);
  assert.deepEqual(malformed, []);
  assert.equal(card.date, DATE);
  assert.match(card.id, /^20261023-[0-9a-f]{6}$/);
  assert.equal(card.id, require('../scripts/decision').cardId(card.decision, card.source, DATE));
  assert.equal(card.supersedes, null);
  assert.equal(card.extends, null);
  assert.deepEqual(fileLines(root).filter(Boolean).length, 1);
  assert.ok(fs.readFileSync(cards.cardsPath(root), 'utf8').endsWith('\n'));
  assert.match(res.stdout, new RegExp(`Recorded card ${card.id}`));
  assert.match(res.stdout, /story: PROJECT_NOTES\.md "### \[2026-10-14\] Union merge for cards"/);
});

test('add reads the card from stdin when no argument is given', () => {
  const root = mkProject();
  const res = run(root, ['add'], JSON.stringify(input()));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(cards.readCards(root).cards.length, 1);
});

test('add --json reports the card it wrote', () => {
  const root = mkProject();
  const res = add(root, {}, ['--json']);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.card.source, 'notes:2026-10-14 Union merge for cards');
  assert.deepEqual(out.warnings, []);
});

test('an id or date in the input is replaced, with a warning', () => {
  const root = mkProject();
  const res = add(root, { id: '20200101-000000', date: '2020-01-01' }, ['--json']);
  const out = JSON.parse(res.stdout);
  assert.equal(out.card.date, DATE);
  assert.notEqual(out.card.id, '20200101-000000');
  assert.match(out.warnings[0], /assigned by decision\.js/);
});

test('a source that does not resolve is refused and nothing is written', () => {
  const root = mkProject();
  const spec = add(root, { source: 'spec:no-such-spec' });
  assert.equal(spec.status, 1);
  assert.match(spec.stderr, /Card not recorded/);
  assert.match(spec.stderr, /\.frame\/specs\/no-such-spec\/ does not exist/);
  const notes = add(root, { source: 'notes:2026-10-14 A heading nobody wrote' });
  assert.equal(notes.status, 1);
  assert.match(notes.stderr, /no such heading exists — write the entry first/);
  assert.ok(!fs.existsSync(cards.cardsPath(root)), 'a refusal writes no file');
});

test('a spec source resolves to its folder; a notes title matches without case or spacing', () => {
  const root = mkProject();
  assert.equal(add(root, { source: 'spec:spec-close-step' }).status, 0);
  assert.equal(add(root, { source: 'notes:2026-10-14 union  MERGE for cards', decision: 'Another decision here.' }).status, 0);
  assert.equal(cards.readCards(root).cards.length, 2);
});

test('a notes source resolves in an unmigrated project whose notes sit at the root', () => {
  const root = mkProject({ notes: null });
  fs.writeFileSync(path.join(root, 'PROJECT_NOTES.md'), NOTES);
  assert.equal(add(root).status, 0);
});

test('every shape defect is named, each on its own line', () => {
  const root = mkProject();
  const res = add(root, { decision: 'One. Two.', why: 'A. B. C. D.', keywords: [] });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /- decision must be one sentence/);
  assert.match(res.stderr, /- why is 4 sentences/);
  assert.match(res.stderr, /- keywords holds 0/);
  const json = JSON.parse(add(root, { keywords: [] }, ['--json']).stdout);
  assert.equal(json.ok, false);
  assert.ok(json.defects.some((d) => /keywords holds 0/.test(d)));
});

test('input that is not a JSON object is refused', () => {
  const root = mkProject();
  assert.match(run(root, ['add', '{not json']).stderr, /not valid JSON/);
  assert.match(run(root, ['add', '[1,2]']).stderr, /must be a JSON object/);
  assert.equal(run(root, ['add', '{not json']).status, 1);
});

test('the same decision and source on the same day is refused as a repeat', () => {
  const root = mkProject();
  assert.equal(add(root).status, 0);
  const again = add(root);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /is already recorded/);
  assert.equal(cards.readCards(root).cards.length, 1);
});

test('supersedes and extends must name a current card', () => {
  const root = mkProject();
  const first = JSON.parse(add(root, {}, ['--json']).stdout).card;

  const unknown = add(root, { decision: 'Second decision.', supersedes: '20260101-abcdef' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /supersedes names card 20260101-abcdef, which is not in \.frame\/decisions\.jsonl/);

  const second = JSON.parse(add(root, { decision: 'Second decision.', supersedes: first.id }, ['--json']).stdout).card;
  assert.equal(second.supersedes, first.id);
  assert.deepEqual(cards.readCards(root).current.map((c) => c.id), [second.id]);

  const stale = add(root, { decision: 'Third decision.', extends: first.id });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, new RegExp(`card ${second.id} already supersedes — name ${second.id} instead`));

  assert.equal(add(root, { decision: 'Third decision.', extends: second.id }).status, 0);
});

test('a listed file that does not exist is a warning, not a refusal', () => {
  const root = mkProject();
  const res = add(root, { files: ['src/main/notYet.js', './src/main/gitSharing.js'] });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /warning: file src\/main\/notYet\.js does not exist \(yet\)/);
  assert.deepEqual(cards.readCards(root).cards[0].files, ['src/main/notYet.js', 'src/main/gitSharing.js']);
});

test('a line past 4 KB is refused', () => {
  const root = mkProject();
  const many = Array.from({ length: 300 }, (_, i) => `src/generated/file-${i}.js`);
  const res = add(root, { files: many });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /bytes as one line \(under 4096\)/);
});

// ─── the append ───────────────────────────────────────────────

test('a card after a torn last line lands on a line of its own', () => {
  const root = mkProject();
  fs.writeFileSync(cards.cardsPath(root), '{"id":"20261015-aaaaaa","date":"2026-10-15","decis');
  assert.equal(add(root).status, 0);
  const read = cards.readCards(root);
  assert.equal(read.cards.length, 1);
  assert.deepEqual(read.malformed.map((m) => m.line), [1]);
  assert.equal(read.cards[0].line, 2);
});

test('concurrent writers each land one whole line', async () => {
  const root = mkProject();
  const n = 16;
  await Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT, 'add', JSON.stringify(input({ decision: `Decision number ${i} for the race.` }))], { env: env(root) });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${i} exited ${code}`))));
  })));
  const read = cards.readCards(root);
  assert.deepEqual(read.malformed, []);
  assert.equal(read.cards.length, n);
  assert.equal(fileLines(root).filter(Boolean).length, n);
});

// ─── related / list ───────────────────────────────────────────

test('related ranks a shared file above a shared word and shows what is shared', () => {
  const root = mkProject({ files: ['src/main/gitSharing.js', 'src/main/other.js'] });
  add(root, { decision: 'Union drivers handle the card file.', files: ['src/main/other.js'], keywords: ['union merge'] });
  add(root, { decision: 'Sharing mode writes the attributes block.', files: ['src/main/gitSharing.js'], keywords: ['sharing'] });
  add(root, { decision: 'Something unrelated entirely.', files: [], keywords: ['zeta'] });

  const res = run(root, ['related', '--files', 'src/main/gitSharing.js', '--keywords', 'union,merge']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^2 current cards share a file or a keyword, best match first:/);
  const lines = res.stdout.split('\n');
  assert.match(lines[1], /Sharing mode writes the attributes block/);
  assert.match(lines[2], /shares: src\/main\/gitSharing\.js/);
  assert.match(lines[3], /Union drivers handle the card file/);
  assert.match(lines[4], /shares: "union", "merge"/);
  assert.doesNotMatch(res.stdout, /unrelated/);

  const json = JSON.parse(run(root, ['related', '--files=src/main/gitSharing.js', '--json']).stdout);
  assert.equal(json.cards.length, 1);
  assert.deepEqual(json.cards[0].sharedFiles, ['src/main/gitSharing.js']);
});

test('related leaves superseded cards out', () => {
  const root = mkProject();
  const first = JSON.parse(add(root, {}, ['--json']).stdout).card;
  add(root, { decision: 'Card files merge by union, revised.', supersedes: first.id });
  const json = JSON.parse(run(root, ['related', '--keywords', 'union', '--json']).stdout);
  assert.deepEqual(json.cards.map((c) => c.supersedes), [first.id]);
});

test('list prints current cards newest first and names every skipped line', () => {
  const root = mkProject();
  add(root, { decision: 'First decision.' });
  add(root, { decision: 'Second decision.' });
  fs.appendFileSync(cards.cardsPath(root), 'garbage\n');
  const res = run(root, ['list']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^2 current decision cards, newest first:/);
  assert.ok(res.stdout.indexOf('Second decision.') < res.stdout.indexOf('First decision.'));
  assert.match(res.stdout, /Skipped line 3: not valid JSON/);
  const json = JSON.parse(run(root, ['list', '--json']).stdout);
  assert.deepEqual(json.cards.map((c) => c.decision), ['Second decision.', 'First decision.']);
  assert.deepEqual(json.malformed.map((m) => m.line), [3]);
});

test('a project with no card file says so, and related and list exit 0', () => {
  const root = mkProject();
  for (const args of [['list'], ['related', '--keywords', 'union']]) {
    const res = run(root, args);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, 'No decision cards in this project yet.\n');
  }
  assert.deepEqual(JSON.parse(run(root, ['list', '--json']).stdout), { cards: [], malformed: [] });
  assert.ok(!fs.existsSync(cards.cardsPath(root)), 'reading never creates the file');
});

test('an unknown command prints the usage and exits 1', () => {
  const root = mkProject();
  const res = run(root, ['frobnicate']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Usage:/);
});

// ─── the activity row ─────────────────────────────────────────

test('a written card and a refused one each leave one registry-valid row, with no card text', () => {
  const root = mkProject();
  add(root);
  add(root, { source: 'spec:spec-close-step', decision: 'Spec decision.' });
  const first = cards.readCards(root).cards[0];
  add(root, { decision: 'Revised.', supersedes: first.id });
  add(root, { decision: 'Refused for its keywords.', keywords: [] });

  const got = rows(root);
  assert.equal(got.length, 4);
  assert.deepEqual(got.map((r) => [r.ev, r.kind]), [
    ['decision.added', 'action'], ['decision.added', 'action'], ['decision.added', 'action'], ['decision.rejected', 'suppression']
  ]);
  assert.deepEqual(events.validateEvent(got[0].ev, got[0]), { host: 'cli', source: 'notes', relation: 'none' });
  assert.deepEqual(events.validateEvent(got[1].ev, got[1]), { host: 'cli', source: 'spec', slug: 'spec-close-step', relation: 'none' });
  assert.deepEqual(events.validateEvent(got[2].ev, got[2]), { host: 'cli', source: 'notes', relation: 'supersedes' });
  assert.deepEqual(events.validateEvent(got[3].ev, got[3]), { host: 'cli', defects: 1 });
  const raw = JSON.stringify(got);
  assert.doesNotMatch(raw, /union driver|gitSharing|Revised/, 'no decision text or file name in the record');
});
