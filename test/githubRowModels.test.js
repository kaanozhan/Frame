/**
 * The GitHub panel's row view-models (github-view-tree-layout spec, G2 / C10).
 *
 * Pure by design — no `lucide`, no `electron`, no DOM. Pinned: branch
 * ordering (current → local → remote), worktree slug detection under
 * `.frame/worktrees/<slug>`, the filter, `issue-<n>-<slug>` naming, label
 * contrast and relative time.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const rows = require('../src/renderer/github/rowModels');
const {
  SLUG_MAX, relativeTime, contrastColor, labelColor, issueBranchName,
  prRow, prRows, issueRow, issueRows, branchRows, worktreeSlug, worktreeRows,
  filterRows
} = rows;

const NOW = Date.parse('2026-09-13T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ─── relativeTime ─────────────────────────────────────────

test('relativeTime: the ladder from just now to years', () => {
  assert.equal(relativeTime(ago(30 * 1000), NOW), 'just now');
  assert.equal(relativeTime(ago(5 * MIN), NOW), '5 minutes ago');
  assert.equal(relativeTime(ago(1 * HOUR), NOW), '1 hour ago');
  assert.equal(relativeTime(ago(3 * HOUR), NOW), '3 hours ago');
  assert.equal(relativeTime(ago(1 * DAY), NOW), 'yesterday');
  assert.equal(relativeTime(ago(4 * DAY), NOW), '4 days ago');
  assert.equal(relativeTime(ago(8 * DAY), NOW), '1 week ago');
  assert.equal(relativeTime(ago(20 * DAY), NOW), '2 weeks ago');
  assert.equal(relativeTime(ago(45 * DAY), NOW), '1 month ago');
  assert.equal(relativeTime(ago(200 * DAY), NOW), '6 months ago');
  assert.equal(relativeTime(ago(400 * DAY), NOW), '1 year ago');
  assert.equal(relativeTime(ago(800 * DAY), NOW), '2 years ago');
});

test('relativeTime: unreadable input → empty string; future → just now', () => {
  assert.equal(relativeTime(null, NOW), '');
  assert.equal(relativeTime('nope', NOW), '');
  assert.equal(relativeTime(new Date(NOW + DAY).toISOString(), NOW), 'just now');
});

// ─── colors ───────────────────────────────────────────────

test('contrastColor: dark backgrounds get white text, light get black', () => {
  assert.equal(contrastColor('d73a4a'), '#ffffff');
  assert.equal(contrastColor('#0e8a16'), '#ffffff');
  assert.equal(contrastColor('fbca04'), '#000000');
  assert.equal(contrastColor('#ffffff'), '#000000');
  assert.equal(contrastColor('garbage'), '#ffffff');
});

test('labelColor: normalizes a hex label color, rejects anything else', () => {
  assert.equal(labelColor('D73A4A'), '#d73a4a');
  assert.equal(labelColor('#d73a4a'), '#d73a4a');
  assert.equal(labelColor('red'), null);
  assert.equal(labelColor(undefined), null);
});

// ─── issueBranchName ──────────────────────────────────────

test('issueBranchName: issue-<n>-<kebab-slug> (S7)', () => {
  assert.equal(issueBranchName(42, 'Fix login timeout'), 'issue-42-fix-login-timeout');
});

test('issueBranchName: punctuation collapses, edges trim, case lowers', () => {
  assert.equal(issueBranchName(7, '  Hello, World!!  (v2) '), 'issue-7-hello-world-v2');
  assert.equal(issueBranchName(7, 'ÄÖÜ'), 'issue-7');
  assert.equal(issueBranchName(7, ''), 'issue-7');
});

test('issueBranchName: the slug is capped and never ends in a dash', () => {
  const long = 'a'.repeat(30) + ' ' + 'b'.repeat(30);
  const name = issueBranchName(1, long);
  const slug = name.replace(/^issue-1-/, '');
  assert.ok(slug.length <= SLUG_MAX);
  assert.doesNotMatch(slug, /-$/);
  const exact = issueBranchName(1, 'a'.repeat(39) + ' b');
  assert.equal(exact, 'issue-1-' + 'a'.repeat(39));
});

// ─── pull requests ────────────────────────────────────────

const PR = {
  number: 12, title: 'Add dock', state: 'OPEN', isDraft: false,
  author: { login: 'alice' }, updatedAt: ago(2 * DAY), url: 'https://github.com/o/r/pull/12',
  reviewDecision: 'APPROVED', headRefName: 'feat/dock',
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]
};

test('prRow: open PR with author, time, review and checks', () => {
  const r = prRow(PR, NOW);
  assert.equal(r.kind, 'pr');
  assert.equal(r.id, '12');
  assert.equal(r.number, 12);
  assert.equal(r.icon, 'pr-open');
  assert.equal(r.primary, 'Add dock');
  assert.equal(r.secondary, 'feat/dock');
  assert.equal(r.meta, 'alice · 2 days ago');
  assert.equal(r.review, 'approved');
  assert.equal(r.checks, 'success');
  assert.equal(r.url, PR.url);
  assert.deepEqual(r.actions.map((a) => a.id), ['checkout', 'open']);
});

test('prRow: draft, merged and closed icons', () => {
  assert.equal(prRow({ ...PR, isDraft: true }, NOW).icon, 'pr-draft');
  assert.equal(prRow({ ...PR, state: 'MERGED', isDraft: true }, NOW).icon, 'pr-merged');
  assert.equal(prRow({ ...PR, state: 'CLOSED' }, NOW).icon, 'pr-closed');
});

test('prRow: checks collapse — failure beats pending beats success; none → null', () => {
  const c = (rollup) => prRow({ ...PR, statusCheckRollup: rollup }, NOW).checks;
  assert.equal(c([]), null);
  assert.equal(c(undefined), null);
  assert.equal(c([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'pending');
  assert.equal(c([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]), 'failure');
  assert.equal(c([{ state: 'SUCCESS' }]), 'success');
  assert.equal(c([{ state: 'PENDING' }]), 'pending');
  assert.equal(c([{ state: 'ERROR' }]), 'failure');
});

test('prRow: review decisions map, unknown → null; missing author survives', () => {
  assert.equal(prRow({ ...PR, reviewDecision: 'CHANGES_REQUESTED' }, NOW).review, 'changes-requested');
  assert.equal(prRow({ ...PR, reviewDecision: 'REVIEW_REQUIRED' }, NOW).review, 'review-required');
  assert.equal(prRow({ ...PR, reviewDecision: '' }, NOW).review, null);
  const r = prRow({ ...PR, author: null }, NOW);
  assert.equal(r.author, null);
  assert.equal(r.meta, '2 days ago');
});

test('prRows: tolerates a missing or malformed result', () => {
  assert.deepEqual(prRows(null), []);
  assert.deepEqual(prRows({ prs: 'x' }), []);
  assert.equal(prRows({ prs: [PR] }, NOW).length, 1);
});

// ─── issues ───────────────────────────────────────────────

const ISSUE = {
  number: 42, title: 'Fix login timeout', state: 'OPEN',
  labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'nocolor' }, { color: 'abcdef' }],
  createdAt: ago(3 * DAY), updatedAt: ago(HOUR), url: 'https://github.com/o/r/issues/42'
};

test('issueRow: open issue with label dots, time and actions', () => {
  const r = issueRow(ISSUE, NOW);
  assert.equal(r.kind, 'issue');
  assert.equal(r.number, 42);
  assert.equal(r.icon, 'issue-open');
  assert.equal(r.primary, 'Fix login timeout');
  assert.equal(r.meta, '1 hour ago');
  assert.deepEqual(r.labels, [{ name: 'bug', color: '#d73a4a' }, { name: 'nocolor', color: null }]);
  assert.deepEqual(r.actions.map((a) => a.id), ['start-work', 'open']);
});

test('issueRow: closed icon; issueRows tolerates garbage', () => {
  assert.equal(issueRow({ ...ISSUE, state: 'CLOSED' }, NOW).icon, 'issue-closed');
  assert.deepEqual(issueRows(undefined), []);
  assert.equal(issueRows({ issues: [ISSUE] }, NOW).length, 1);
});

// ─── branches ─────────────────────────────────────────────

const BRANCHES = {
  currentBranch: 'main',
  branches: [
    { name: 'origin/main', commit: 'aaa', date: '2 days ago', isRemote: true },
    { name: 'zeta', commit: 'bbb', date: '3 weeks ago', isRemote: false },
    { name: 'main', commit: 'ccc', date: '1 hour ago', isRemote: false },
    { name: 'alpha', commit: 'ddd', date: '6 months ago', isRemote: false },
    { name: 'origin/alpha', commit: 'ddd', date: '6 months ago', isRemote: true }
  ]
};

test('branchRows: current first and marked, then local by name, then remote by name (S2)', () => {
  const r = branchRows(BRANCHES);
  assert.deepEqual(r.map((b) => b.id), ['main', 'alpha', 'zeta', 'origin/alpha', 'origin/main']);
  assert.equal(r[0].current, true);
  assert.equal(r[0].icon, 'branch-current');
  assert.equal(r[1].current, false);
  assert.equal(r[1].icon, 'branch');
  assert.deepEqual(r.map((b) => b.isRemote), [false, false, false, true, true]);
});

test('branchRows: SHA and time sit in meta on one line', () => {
  const r = branchRows(BRANCHES);
  assert.equal(r[1].meta, 'ddd · 6 months ago');
  assert.equal(r[1].sha, 'ddd');
  assert.equal(r[1].time, '6 months ago');
});

test('branchRows: actions — none on current, Switch + Delete on local, Switch only on remote', () => {
  const r = branchRows(BRANCHES);
  assert.deepEqual(r[0].actions, []);
  assert.deepEqual(r[1].actions.map((a) => a.id), ['switch', 'delete']);
  assert.equal(r[1].actions[1].danger, true);
  assert.deepEqual(r[3].actions.map((a) => a.id), ['switch']);
});

test('branchRows: tolerates a missing result', () => {
  assert.deepEqual(branchRows(null), []);
  assert.deepEqual(branchRows({ error: 'x', branches: [] }), []);
});

// ─── worktrees ────────────────────────────────────────────

const PROJECT = '/Users/me/Frame';
const WORKTREES = {
  worktrees: [
    { path: '/Users/me/Frame', branch: 'main', isMain: true },
    { path: '/Users/me/Frame/.frame/worktrees/dock-panel', branch: 'frame/dock-panel/work' },
    { path: '/Users/me/elsewhere/hotfix', branch: 'hotfix' },
    { path: '/Users/me/Frame/.frame/worktrees/nested/deeper', detached: true }
  ]
};

test('worktreeSlug: only a direct child of <project>/.frame/worktrees', () => {
  assert.equal(worktreeSlug('/Users/me/Frame/.frame/worktrees/dock-panel', PROJECT), 'dock-panel');
  assert.equal(worktreeSlug('/Users/me/Frame/.frame/worktrees/dock-panel/', PROJECT + '/'), 'dock-panel');
  assert.equal(worktreeSlug('C:\\p\\Frame\\.frame\\worktrees\\slug', 'C:\\p\\Frame'), 'slug');
  assert.equal(worktreeSlug('/Users/me/Frame/.frame/worktrees/a/b', PROJECT), null);
  assert.equal(worktreeSlug('/Users/me/Frame/.frame/worktrees/', PROJECT), null);
  assert.equal(worktreeSlug('/Users/me/elsewhere/hotfix', PROJECT), null);
  assert.equal(worktreeSlug('/x', ''), null);
});

test('worktreeRows: folder name, branch, main marked, spec slug named (S11)', () => {
  const r = worktreeRows(WORKTREES, PROJECT);
  assert.equal(r.length, 4);
  assert.equal(r[0].primary, 'Frame');
  assert.equal(r[0].current, true);
  assert.equal(r[0].icon, 'worktree-main');
  assert.equal(r[0].secondary, 'main');
  assert.equal(r[0].meta, '');
  assert.deepEqual(r[0].actions.map((a) => a.id), ['open-terminal']);

  assert.equal(r[1].primary, 'dock-panel');
  assert.equal(r[1].secondary, 'frame/dock-panel/work');
  assert.equal(r[1].slug, 'dock-panel');
  assert.equal(r[1].meta, 'spec · dock-panel');
  assert.deepEqual(r[1].actions.map((a) => a.id), ['open-terminal', 'remove']);

  assert.equal(r[2].slug, null);
  assert.equal(r[2].meta, '');
  assert.equal(r[3].secondary, 'detached');
  assert.equal(r[3].slug, null);
});

test('worktreeRows: id is the full path; tolerates a missing result', () => {
  assert.equal(worktreeRows(WORKTREES, PROJECT)[1].id, WORKTREES.worktrees[1].path);
  assert.deepEqual(worktreeRows(null, PROJECT), []);
});

// Workspaces spec (T11): a worktree that is a workspace is labelled from the
// registry, wherever its folder lives; the rest are unchanged.
test('worktreeRows: workspace worktrees carry their workspace name', () => {
  const result = { worktrees: [
    { path: PROJECT, branch: 'main', isMain: true },
    { path: '/Users/me/frame/workspaces/Frame/teal', branch: 'ws/teal' },
    { path: '/Users/me/elsewhere/hotfix', branch: 'hotfix' }
  ] };
  const r = worktreeRows(result, PROJECT, [{ name: 'teal', path: '/Users/me/frame/workspaces/Frame/teal/' }]);
  assert.equal(r[1].workspace, 'teal');
  assert.equal(r[1].meta, 'workspace · teal');
  assert.equal(r[0].workspace, null);
  assert.equal(r[2].workspace, null);
  assert.equal(r[2].meta, '');
  assert.equal(worktreeRows(result, PROJECT)[1].workspace, null, 'no registry, no label');
});

// ─── filterRows ───────────────────────────────────────────

test('filterRows: empty query keeps every row, as a copy', () => {
  const all = branchRows(BRANCHES);
  const out = filterRows(all, '   ');
  assert.deepEqual(out, all);
  assert.notEqual(out, all);
});

test('filterRows: matches title, #number, plain number and branch name, case-insensitively (S8)', () => {
  const prs = prRows({ prs: [PR, { ...PR, number: 7, title: 'Other', headRefName: 'fix/x' }] }, NOW);
  assert.deepEqual(filterRows(prs, 'DOCK').map((r) => r.number), [12]);
  assert.deepEqual(filterRows(prs, '#7').map((r) => r.number), [7]);
  assert.deepEqual(filterRows(prs, '12').map((r) => r.number), [12]);
  assert.deepEqual(filterRows(prs, 'fix/x').map((r) => r.number), [7]);
  assert.deepEqual(filterRows(prs, 'nothing'), []);

  const branches = branchRows(BRANCHES);
  assert.deepEqual(filterRows(branches, 'alp').map((r) => r.id), ['alpha', 'origin/alpha']);
});

test('filterRows: worktrees match by folder, branch and spec slug', () => {
  const wts = worktreeRows(WORKTREES, PROJECT);
  assert.deepEqual(filterRows(wts, 'dock').map((r) => r.primary), ['dock-panel']);
  assert.deepEqual(filterRows(wts, 'hotfix').map((r) => r.primary), ['hotfix']);
});
