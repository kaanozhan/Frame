/**
 * Spec close state — helper tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * The helper is the one place that decides whether a closed spec is owed a
 * reminder, and both hooks trust its answer without a second look. So every
 * way of staying quiet is asserted here by its reason, alongside the one way
 * of speaking — a reminder that fires when it should not is worse than one
 * that never fires.
 *
 * The rule under test: a reminder goes only to the session that closed the
 * spec. Most cases therefore start the same way — the session takes its first
 * look while the spec is still open, then the spec's tasks are completed —
 * which is `closeIn` below.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const closeStateLib = require('../scripts/spec-close-state');
const {
  CLOSE_ITEMS, STATE_REL, SESSIONS_REL, SESSION_TTL_MS,
  closedSpecs, closeState, isOrchestrated, missingItems, pending, reminder, sessionKey
} = closeStateLib;

const AT = '2026-02-01T10:00:00Z';
const NOW = Date.parse('2026-03-01T00:00:00Z');

const task = (slug, n, status, completedAt = null) => ({
  id: `task-spec-${slug}-T0${n}`, title: `t${n}`, source: `spec:${slug}:T0${n}`, status, completedAt
});

const closed = (slug, at = AT) => [task(slug, 1, 'completed', at), task(slug, 2, 'completed', at)];
const open = (slug) => [task(slug, 1, 'completed', AT), task(slug, 2, 'in_progress')];

let tick = 0;
/** Write tasks.json with an mtime no earlier write shared. */
function writeTasks(root, tasks, { raw = null } = {}) {
  const file = path.join(root, '.frame', 'tasks.json');
  fs.writeFileSync(file, raw !== null ? raw : JSON.stringify({ tasks }));
  tick += 1;
  const at = new Date(Date.parse('2026-01-02T00:00:00Z') + tick * 1000);
  fs.utimesSync(file, at, at);
  return file;
}

function mkSpec(root, slug, { digest = false, status = null } = {}) {
  const dir = path.join(root, '.frame', 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (status) fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  if (digest) fs.writeFileSync(path.join(dir, 'digest.md'), '---\nkeywords: a\n---\nDone.\n');
  return dir;
}

/** A project holding the given specs and tasks. */
function mkProject({ specs = [], tasks = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specclose-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  for (const slug of specs) mkSpec(root, slug);
  writeTasks(root, tasks);
  return root;
}

/**
 * The session takes its first look with `before` on disk, then the tasks
 * become `after` — the session closed whatever `after` closes.
 */
function closeIn(root, session, before, after, now = NOW) {
  writeTasks(root, before);
  reminder(root, session, now);
  writeTasks(root, after);
}

const readState = (root) => JSON.parse(fs.readFileSync(path.join(root, STATE_REL), 'utf8'));

// ─── closed and open specs ────────────────────────────────

test('a spec is closed when it has spec tasks and all of them are completed', () => {
  const root = mkProject({
    specs: ['done-spec', 'half-spec', 'idle-spec'],
    tasks: [
      ...closed('done-spec'),
      task('half-spec', 1, 'completed', AT), task('half-spec', 2, 'in_progress'),
      task('idle-spec', 1, 'pending'),
      { id: 'plain', title: 'not a spec task', status: 'completed', completedAt: AT }
    ]
  });
  assert.deepEqual(closedSpecs(root).map((s) => s.slug), ['done-spec']);
  assert.deepEqual(closeState(root).open, ['half-spec', 'idle-spec'], 'the rest are open, and cached as such');
});

test('a spec with no tasks in tasks.json is not closed, whatever its folder holds', () => {
  const root = mkProject({ specs: ['no-tasks'], tasks: [] });
  assert.deepEqual(closedSpecs(root), []);
});

test('completed tasks whose spec folder is gone do not make a closed spec', () => {
  const root = mkProject({ specs: [], tasks: [] });
  closeIn(root, 's', open('deleted-spec'), closed('deleted-spec'));
  assert.deepEqual(closedSpecs(root), []);
  assert.equal(reminder(root, 's', NOW), null);
});

test('the close time is the latest completedAt among the spec tasks', () => {
  const root = mkProject({
    specs: ['a'],
    tasks: [task('a', 1, 'completed', '2026-02-01T10:00:00Z'), task('a', 2, 'completed', '2026-02-03T09:30:00Z')]
  });
  assert.deepEqual(closedSpecs(root), [{ slug: 'a', closedAt: '2026-02-03T09:30:00.000Z' }]);
});

test('with no completedAt the close time falls back to status.json last_phase_at', () => {
  const root = mkProject({ tasks: [task('a', 1, 'completed'), task('a', 2, 'completed')] });
  mkSpec(root, 'a', { status: { slug: 'a', phase: 'done', last_phase_at: '2026-02-05T08:00:00Z' } });
  assert.deepEqual(closedSpecs(root), [{ slug: 'a', closedAt: '2026-02-05T08:00:00.000Z' }]);
});

test('a date with no time counts as the end of that day', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a', '2026-02-01') });
  assert.equal(closedSpecs(root)[0].closedAt, '2026-02-01T23:59:59.999Z');
});

test('a slug that is not a plain folder name is never read as a spec', () => {
  const root = mkProject({ specs: ['ok'], tasks: [] });
  fs.mkdirSync(path.join(root, 'outside'), { recursive: true });
  writeTasks(root, [
    { id: 'x', source: 'spec:../../outside:T01', status: 'completed', completedAt: AT },
    { id: 'y', source: 'spec:-rf:T01', status: 'completed', completedAt: AT }
  ]);
  assert.deepEqual(closedSpecs(root), []);
  assert.equal(isOrchestrated(root, '../../outside'), null);
});

test('tasks.json as a bare array is read the same way', () => {
  const root = mkProject({ specs: ['a'] });
  writeTasks(root, null, { raw: JSON.stringify(closed('a')) });
  assert.deepEqual(closedSpecs(root).map((s) => s.slug), ['a']);
});

// ─── close items ──────────────────────────────────────────

test('without decision.js the digest is the only item owed, missing until digest.md exists', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a') });
  assert.deepEqual(CLOSE_ITEMS.map((i) => i.id), ['digest', 'cards']);
  assert.equal(closeStateLib.cardsDue(root), false, 'no decision.js — cards are not due');
  assert.deepEqual(missingItems(root, 'a'), ['digest']);
  mkSpec(root, 'a', { digest: true });
  assert.deepEqual(missingItems(root, 'a'), []);
});

// ─── decision cards (decision-cards-core T05) ─────────────

/** A project that can write cards: decision.js in .frame/bin/, as Frame ships it. */
function withCardTooling(root) {
  fs.mkdirSync(path.join(root, '.frame', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.frame', 'bin', 'decision.js'), '// stub\n');
  return root;
}

function writeCards(root, cards) {
  fs.writeFileSync(path.join(root, '.frame', 'decisions.jsonl'), cards.map((c) => JSON.stringify({
    date: '2026-10-14', decision: 'A decision.', why: 'A reason.', keywords: ['k'], files: [],
    supersedes: null, extends: null, ...c
  })).join('\n') + '\n');
}

test('with decision.js a closed spec owes a card until a current one names it', () => {
  const root = withCardTooling(mkProject({ specs: ['a'], tasks: closed('a') }));
  mkSpec(root, 'a', { digest: true });
  assert.equal(closeStateLib.cardsDue(root), true);
  assert.deepEqual(missingItems(root, 'a'), ['cards']);

  writeCards(root, [{ id: '20261014-aaaaaa', source: 'notes:2026-10-14 Something else' }]);
  assert.deepEqual(missingItems(root, 'a'), ['cards'], 'a card for another story does not count');

  writeCards(root, [{ id: '20261014-aaaaaa', source: 'spec:a' }]);
  assert.deepEqual(missingItems(root, 'a'), []);

  writeCards(root, [
    { id: '20261014-aaaaaa', source: 'spec:a' },
    { id: '20261015-bbbbbb', date: '2026-10-15', source: 'spec:b', supersedes: '20261014-aaaaaa' }
  ]);
  assert.deepEqual(missingItems(root, 'a'), ['cards'], 'a superseded card is not current');
});

test('scripts/decision.js also makes cards due — Frame\'s own repository', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a') });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'decision.js'), '// dev copy\n');
  assert.equal(closeStateLib.cardsDue(root), true);
});

test('the reminder names cards once the digest is there and a card is not', () => {
  const root = withCardTooling(mkProject({ specs: ['a'] }));
  mkSpec(root, 'a', { digest: true });
  closeIn(root, 's', open('a'), closed('a'));
  assert.match(reminder(root, 's', NOW).line, /and it has no decision cards yet\. Finish it:/);
});

test('the reminder names both items when both are missing', () => {
  const root = withCardTooling(mkProject({ specs: ['a'] }));
  closeIn(root, 's', open('a'), closed('a'));
  assert.match(reminder(root, 's', NOW).line, /and it has no digest or decision cards yet\. Finish it:/);
});

test('a card written after the reminder settles the spec on the next look', () => {
  const root = withCardTooling(mkProject({ specs: ['a'] }));
  mkSpec(root, 'a', { digest: true });
  closeIn(root, 's', open('a'), closed('a'));
  writeCards(root, [{ id: '20261014-aaaaaa', source: 'spec:a' }]);
  assert.equal(reminder(root, 's', NOW), null);
  assert.deepEqual(closeStateLib.pending(root), []);
});

// ─── the session that closed it ───────────────────────────

test('a spec this session closed with no digest gets the one-line reminder', () => {
  const root = mkProject({ specs: ['close-me'] });
  closeIn(root, 's1', open('close-me'), closed('close-me'));
  const out = reminder(root, 's1', NOW);
  assert.deepEqual(out.slugs, ['close-me']);
  assert.equal(out.line,
    'You completed the last task of spec "close-me" in this session and it has no digest yet. ' +
    'Finish it: run node .frame/bin/spec-close.js close-me and write what it asks for.');
  assert.ok(!out.line.includes('\n'), 'one line');
  assert.deepEqual(pending(root).map((s) => s.slug), ['close-me']);
});

test('once the digest exists there is nothing to say and nothing to record', () => {
  const root = mkProject({ specs: ['a'] });
  mkSpec(root, 'a', { digest: true });
  closeIn(root, 's1', open('a'), closed('a'));
  assert.equal(reminder(root, 's1', NOW), null);
  assert.deepEqual(pending(root), []);
});

test('a digest written after the reminder is seen without tasks.json changing', () => {
  const root = mkProject({ specs: ['a'] });
  closeIn(root, 's1', open('a'), closed('a'));
  assert.ok(reminder(root, 's1', NOW).line);
  mkSpec(root, 'a', { digest: true });
  assert.equal(reminder(root, 's1', NOW), null);
});

test('a spec is announced once per session, then recorded as session-dedup once', () => {
  const root = mkProject({ specs: ['a'] });
  closeIn(root, 's1', open('a'), closed('a'));
  assert.ok(reminder(root, 's1', NOW).line);
  assert.deepEqual(reminder(root, 's1', NOW), { quiet: 'session-dedup', reasons: ['session-dedup'] });
  assert.equal(reminder(root, 's1', NOW), null, 'the quiet reason is not recorded per call');
});

test('a spec already closed when a session starts is never announced to it', () => {
  // Another session closed it — or this one did, and a new conversation began.
  const root = mkProject({ specs: ['a'] });
  closeIn(root, 's1', open('a'), closed('a'));
  assert.ok(reminder(root, 's1', NOW).line, 'the closing session hears it');
  assert.deepEqual(reminder(root, 's2', NOW), { quiet: 'closed-earlier', reasons: ['closed-earlier'] });
  assert.equal(reminder(root, 's2', NOW), null, 'recorded once, not per call');
  assert.deepEqual(pending(root).map((s) => s.slug), ['a'], 'still owed — spec-close.js shows it');
});

test('in a project with old specs missing digests, a new session hears none of them', () => {
  const root = mkProject({ specs: ['old-one', 'old-two'], tasks: [...closed('old-one'), ...closed('old-two')] });
  assert.deepEqual(reminder(root, 's1', NOW), { quiet: 'closed-earlier', reasons: ['closed-earlier'] });
  assert.equal(reminder(root, 's1', NOW), null);
});

test('a spec created and closed inside one session is that session\'s own', () => {
  // Its tasks did not exist at the session's first look, so it was open at no
  // first look either — which is why the session notes what was closed, not
  // what was open.
  const root = mkProject({ specs: ['fresh'] });
  closeIn(root, 's1', [], closed('fresh'));
  assert.deepEqual(reminder(root, 's1', NOW).slugs, ['fresh']);
});

test('a spec reopened and closed again in the session is the session\'s own', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a') });
  assert.equal(reminder(root, 's1', NOW).quiet, 'closed-earlier');
  // A fix task is added to it, then completed.
  writeTasks(root, [...closed('a'), task('a', 3, 'pending')]);
  assert.equal(reminder(root, 's1', NOW), null, 'open again: nothing owed');
  writeTasks(root, [...closed('a'), task('a', 3, 'completed', AT)]);
  assert.deepEqual(reminder(root, 's1', NOW).slugs, ['a']);
});

test('more than three are named three at a time, the rest counted', () => {
  const slugs = ['a', 'b', 'c', 'd', 'e'];
  const root = mkProject({ specs: slugs });
  closeIn(root, 's1', slugs.flatMap(open), slugs.flatMap((slug, i) => closed(slug, `2026-02-0${i + 1}T10:00:00Z`)));
  const first = reminder(root, 's1', NOW);
  assert.deepEqual(first.slugs, ['e', 'd', 'c'], 'newest close first');
  assert.equal(first.more, 2);
  assert.match(first.line, /^You completed the last tasks of specs "e", "d", "c" and 2 more in this session and they have no digest yet\. Finish them: run node \S+ <slug> for each and write what it asks for\.$/);
  const second = reminder(root, 's1', NOW);
  assert.deepEqual(second.slugs, ['b', 'a'], 'the counted ones are named next');
  assert.equal(second.more, 0);
});

test('a result can announce one spec and record why another is withheld', () => {
  const root = mkProject({ specs: ['old', 'new'], tasks: [...closed('old'), ...open('new')] });
  // The first look already finds "old" closed, and says so once.
  assert.deepEqual(reminder(root, 's1', NOW), { quiet: 'closed-earlier', reasons: ['closed-earlier'] });
  writeTasks(root, [...closed('old'), ...closed('new')]);
  const out = reminder(root, 's1', NOW);
  assert.deepEqual(out.slugs, ['new']);
  assert.deepEqual(out.reasons, [], 'the reason was recorded at the first look');
});

// ─── orchestration ────────────────────────────────────────

test('a spec with a worktree folder is orchestrated and never announced', () => {
  const root = mkProject({ specs: ['a'] });
  fs.mkdirSync(path.join(root, '.frame', 'worktrees', 'a'), { recursive: true });
  closeIn(root, 's1', open('a'), closed('a'));
  assert.equal(isOrchestrated(root, 'a'), true);
  assert.deepEqual(reminder(root, 's1', NOW), { quiet: 'orchestrated', reasons: ['orchestrated'] });
  assert.deepEqual(pending(root), []);
});

function gitInit(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return git;
}

test('a spec with a frame/<slug>/ branch is orchestrated; its neighbour is not', () => {
  const root = mkProject({ specs: ['a', 'ab'] });
  const git = gitInit(root);
  git('branch', 'frame/a/work');
  closeIn(root, 's1', [...open('a'), ...open('ab')], [...closed('a'), ...closed('ab')]);
  assert.equal(isOrchestrated(root, 'a'), true);
  assert.equal(isOrchestrated(root, 'ab'), false, 'a prefix of another slug is not a match');
  const out = reminder(root, 's1', NOW);
  assert.deepEqual(out.slugs, ['ab']);
  assert.deepEqual(out.reasons, ['orchestrated']);
});

test('git is asked once per candidate per session', () => {
  const root = mkProject({ specs: ['a'] });
  const git = gitInit(root);
  git('branch', 'frame/a/integration');
  closeIn(root, 's1', open('a'), closed('a'));
  assert.equal(reminder(root, 's1', NOW).quiet, 'orchestrated');
  // The branch goes away; the session already has its answer and keeps it.
  git('branch', '-D', 'frame/a/integration');
  assert.equal(reminder(root, 's1', NOW), null);
});

test('when git will not answer the spec stays quiet, with its own reason', () => {
  const root = mkProject({ specs: ['a'] });
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /nowhere/at/all\n'); // a repository git cannot open
  closeIn(root, 's1', open('a'), closed('a'));
  assert.equal(isOrchestrated(root, 'a'), null);
  assert.deepEqual(reminder(root, 's1', NOW), { quiet: 'git-unavailable', reasons: ['git-unavailable'] });
});

// ─── tasks.json that cannot be read ───────────────────────

test('no tasks.json means nothing to say and no state written', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specclose-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  assert.equal(closeState(root), null);
  assert.equal(reminder(root, 's1', NOW), null);
  assert.ok(!fs.existsSync(path.join(root, STATE_REL)));
});

test('an unreadable tasks.json is recorded once per change of the file, not per call', () => {
  const root = mkProject({ specs: ['a'] });
  closeIn(root, 's1', open('a'), closed('a'));
  writeTasks(root, null, { raw: '{ "tasks": [ truncated' });
  assert.equal(closedSpecs(root), null);
  assert.deepEqual(reminder(root, 's1', NOW), { quiet: 'no-index', reasons: ['no-index'] });
  assert.equal(reminder(root, 's1', NOW), null);
  assert.equal(reminder(root, 's2', NOW), null);
  assert.deepEqual(pending(root), []);
  // Repaired: the next call reads it again, and the closing session still hears it.
  writeTasks(root, closed('a'));
  assert.ok(reminder(root, 's1', NOW).line);
});

test('a tasks.json with no task list is unreadable, not empty', () => {
  const root = mkProject({ specs: ['a'] });
  writeTasks(root, null, { raw: JSON.stringify({ tasks: { pending: [] } }) });
  assert.equal(closedSpecs(root), null);
});

// ─── the cache ────────────────────────────────────────────

test('a cache hit does not re-read tasks.json', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a') });
  const file = path.join(root, '.frame', 'tasks.json');
  assert.equal(closeState(root).hit, false);

  // Same size, same mtime, different content: if the helper read the file it
  // would find no closed spec.
  const stat = fs.statSync(file);
  const original = fs.readFileSync(file, 'utf8');
  const reopened = original.replace(/"completed"/g, '"compIeted"');
  assert.equal(Buffer.byteLength(reopened), stat.size);
  fs.writeFileSync(file, reopened);
  fs.utimesSync(file, stat.atime, stat.mtime);

  const state = closeState(root);
  assert.equal(state.hit, true);
  assert.deepEqual(state.closed.map((s) => s.slug), ['a']);
  assert.deepEqual(closedSpecs(root), [], 'a fresh read sees the new content');
});

test('a changed mtime or size is a miss and the lists are rebuilt', () => {
  const root = mkProject({ specs: ['a', 'b'], tasks: [...closed('a'), ...open('b')] });
  assert.deepEqual(closeState(root).closed.map((s) => s.slug), ['a']);
  writeTasks(root, [...closed('a'), ...closed('b')]);
  const state = closeState(root);
  assert.equal(state.hit, false);
  assert.deepEqual(state.closed.map((s) => s.slug), ['a', 'b']);
  assert.deepEqual(state.open, []);
  assert.equal(closeState(root).hit, true);
});

test('a corrupt state file costs a re-read, never an exception', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a') });
  closeState(root);
  fs.writeFileSync(path.join(root, STATE_REL), '{ not json');
  assert.equal(closeState(root).hit, false);
});

test('a state file from the first design, with a baseline, is not trusted', () => {
  const root = mkProject({ specs: ['a'], tasks: closed('a') });
  const stat = fs.statSync(path.join(root, '.frame', 'tasks.json'));
  fs.mkdirSync(path.dirname(path.join(root, STATE_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, STATE_REL), JSON.stringify({
    version: 1, baseline: '2026-01-01T00:00:00.000Z', tasks: { mtimeMs: stat.mtimeMs, size: stat.size }, closed: []
  }));
  const state = closeState(root);
  assert.equal(state.hit, false);
  assert.deepEqual(state.closed.map((s) => s.slug), ['a']);
  assert.equal(readState(root).baseline, undefined, 'the baseline is gone');
});

// ─── session keys and cleanup ─────────────────────────────

test('without a session id the day is the session', () => {
  const root = mkProject({ specs: ['a'] });
  const day1 = Date.parse('2026-03-01T09:00:00Z');
  assert.equal(sessionKey(undefined, day1), 'day-2026-03-01');
  closeIn(root, undefined, open('a'), closed('a'), day1);
  assert.ok(reminder(root, undefined, day1).line);
  assert.equal(reminder(root, undefined, day1 + 3600e3).quiet, 'session-dedup', 'same day: once');
  assert.equal(reminder(root, undefined, day1 + 24 * 3600e3).quiet, 'closed-earlier', 'next day: closed before it began');
});

test('a session id is made safe for a file name', () => {
  assert.equal(sessionKey('../../etc/passwd', NOW), '______etc_passwd');
  assert.equal(sessionKey('a'.repeat(200), NOW).length, 80);
});

test('session files older than seven days are removed when one is written', () => {
  const root = mkProject({ specs: ['a'], tasks: open('a') });
  const dir = path.join(root, SESSIONS_REL);
  fs.mkdirSync(dir, { recursive: true });
  const stale = path.join(dir, 'old-session.json');
  fs.writeFileSync(stale, '{}');
  const now = Date.now();
  const old = new Date(now - SESSION_TTL_MS - 60e3);
  fs.utimesSync(stale, old, old);
  reminder(root, 's1', now);
  assert.ok(!fs.existsSync(stale), 'stale session removed');
  assert.ok(fs.existsSync(path.join(dir, 's1.json')), 'current session kept');
});

// ─── never break ──────────────────────────────────────────

test('a root that does not exist is nothing to say', () => {
  const nowhere = path.join(os.tmpdir(), 'frame-specclose-missing', 'x');
  assert.equal(reminder(nowhere, 's1', NOW), null);
  assert.deepEqual(pending(nowhere), []);
  assert.equal(closedSpecs(nowhere), null);
});

test('a runtime directory that cannot be written degrades to quiet, not to an exception', () => {
  const root = mkProject({ specs: ['a'] });
  // A file where the state directory should be: nothing under it can be written.
  fs.mkdirSync(path.join(root, '.frame', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, '.frame', 'runtime', 'spec-close'), 'in the way');
  closeIn(root, 's1', open('a'), closed('a'));
  // With no session file every call is a first look, so the close reads as
  // earlier than the session: silence, never a wrong reminder.
  assert.equal(reminder(root, 's1', NOW).quiet, 'closed-earlier');
});
