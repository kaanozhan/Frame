/**
 * prFlow — push, PR, checks and merge rules (workspace-pr-flow spec, T01).
 *
 * Pinned: counts parse defensively; checks fold CheckRun and StatusContext
 * entries into passing/failing/pending with failing names; the PR maps to
 * draft/open/merged/closed and is `ready` only when open, mergeable and
 * green; the PR text comes from the spec (Why/What/Done + spec path) or from
 * commit subjects; the merge method honours the setting only when allowed;
 * the fix prompt names checks and log commands; the base is never pushable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCount, checksSummary, mapPrView, sectionLead, composePr, pickMergeMethod, fixChecksPrompt, isPushable,
  parseConflicts, updateMenuState, conflictPrompt, updateMessage, pushArgs
} = require('../src/shared/prFlow');

test('parseCount reads rev-list output and never returns garbage', () => {
  assert.equal(parseCount('3\n'), 3);
  assert.equal(parseCount(''), 0);
  assert.equal(parseCount('fatal: no upstream'), 0);
  assert.equal(parseCount(null), 0);
});

test('checksSummary folds CheckRun and StatusContext entries', () => {
  const s = checksSummary([
    { __typename: 'CheckRun', name: 'test (ubuntu)', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'vercel', state: 'PENDING' },
    { __typename: 'StatusContext', context: 'codecov', state: 'FAILURE' }
  ]);
  assert.deepEqual(s, { passing: 2, failing: 2, pending: 2, failingNames: ['lint', 'codecov'] });
  assert.deepEqual(checksSummary(null), { passing: 0, failing: 0, pending: 0, failingNames: [] });
});

test('mapPrView: state, checks and readiness', () => {
  const green = { number: 42, url: 'u', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    statusCheckRollup: [{ name: 't', status: 'COMPLETED', conclusion: 'SUCCESS' }], comments: [{}, {}] };
  const pr = mapPrView(green);
  assert.equal(pr.state, 'open');
  assert.equal(pr.comments, 2);
  assert.equal(pr.ready, true);

  assert.equal(mapPrView({ ...green, isDraft: true }).state, 'draft');
  assert.equal(mapPrView({ ...green, isDraft: true }).ready, false, 'a draft is not ready');
  assert.equal(mapPrView({ ...green, mergeable: 'CONFLICTING' }).ready, false);
  assert.equal(mapPrView({ ...green, statusCheckRollup: [{ name: 'x', status: 'QUEUED' }] }).ready, false, 'pending checks block');
  assert.equal(mapPrView({ ...green, state: 'MERGED' }).state, 'merged');
  assert.equal(mapPrView({ ...green, state: 'CLOSED' }).state, 'closed');
  assert.equal(mapPrView(null), null);
  assert.equal(mapPrView({}), null, 'no number, no PR');
});

test('sectionLead takes the first paragraph under a heading', () => {
  const md = '# T\n\n## Problem\n\nIt hurts.\nStill hurts.\n\nMore.\n\n## Goal\n\nFix it.\n';
  assert.equal(sectionLead(md, 'Problem'), 'It hurts.\nStill hurts.');
  assert.equal(sectionLead(md, 'Goal'), 'Fix it.');
  assert.equal(sectionLead(md, 'Missing'), '');
});

test('composePr from a spec: title, Why/What, completed tasks, spec path', () => {
  const { title, body } = composePr({
    spec: {
      slug: 'login',
      title: 'Login screen',
      spec: '# Login screen\n\n## Problem\n\nUsers cannot log in.\n\n## Goal\n\nA login form.\n',
      outcome: '# Outcome\n\n## T01 — Add the form\n\nDid it.\n\n---\n\n## T02 — Wire auth\n\nDone.\n'
    },
    commits: ['wire auth', 'add form']
  });
  assert.equal(title, 'Login screen');
  assert.match(body, /## Why\n\nUsers cannot log in\./);
  assert.match(body, /## What\n\nA login form\./);
  assert.match(body, /## Done\n\n- T01 — Add the form\n- T02 — Wire auth/);
  assert.match(body, /Spec: `\.frame\/specs\/login\/`/);
});

test('composePr without a spec: oldest subject as title, all subjects oldest first', () => {
  const r = composePr({ commits: ['third', 'second', 'first'] });
  assert.equal(r.title, 'first');
  assert.equal(r.body, '- first\n- second\n- third');
  assert.deepEqual(composePr({ commits: ['only'] }), { title: 'only', body: '' });
  assert.equal(composePr({ branch: 'ws/teal' }).title, 'ws/teal');
});

test('pickMergeMethod honours the setting only when the repo allows it', () => {
  const all = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true };
  assert.equal(pickMergeMethod(all, null), 'squash');
  assert.equal(pickMergeMethod(all, 'rebase'), 'rebase');
  assert.equal(pickMergeMethod({ ...all, rebaseMergeAllowed: false }, 'rebase'), 'squash');
  assert.equal(pickMergeMethod({ squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true }, null), 'merge');
  assert.equal(pickMergeMethod({ squashMergeAllowed: false, mergeCommitAllowed: false, rebaseMergeAllowed: false }, null), null);
  assert.equal(pickMergeMethod(undefined, null), 'squash', 'unknown flags count as allowed');
});

test('fixChecksPrompt names the PR, the checks and the log commands', () => {
  const p = fixChecksPrompt({ branch: 'ws/teal', number: 7, failingNames: ['lint', 'test'] });
  assert.match(p, /PR #7/);
  assert.match(p, /`ws\/teal`/);
  assert.match(p, /- lint\n- test/);
  assert.match(p, /gh pr checks 7/);
  assert.match(p, /--log-failed/);
  assert.match(p, /Do not push/);
});

test('isPushable refuses the base branch', () => {
  assert.equal(isPushable({ branch: 'ws/teal', base: 'main' }), true);
  assert.equal(isPushable({ branch: 'main', base: 'main' }), false);
  assert.equal(isPushable({ branch: 'origin/main', base: 'main' }), false);
  assert.equal(isPushable({ branch: '', base: 'main' }), false);
});

// ─── update-from-base ─────────────────────────────────────────

test('parseConflicts reads the -z list without duplicates', () => {
  assert.deepEqual(parseConflicts('a.js\0dir/b c.js\0a.js\0'), ['a.js', 'dir/b c.js']);
  assert.deepEqual(parseConflicts(''), []);
  assert.deepEqual(parseConflicts(null), []);
});

test('updateMenuState offers update, or resolve and abort while merging', () => {
  assert.deepEqual(updateMenuState({ behind: 3, base: 'main' }), [{ id: 'update:run', label: 'Update from main (3)' }]);
  assert.deepEqual(updateMenuState({ behind: 0, base: 'dev' }), [{ id: 'update:run', label: 'Update from dev' }], 'shown at 0: the count may be stale');
  assert.deepEqual(updateMenuState({ merging: true, conflicts: ['a', 'b'], behind: 4 }).map((i) => i.label),
    ['Resolve Conflicts with Agent (2)', 'Abort Update']);
  assert.equal(updateMenuState({ merging: true, conflicts: [] })[0].label, 'Finish Merge with Agent');
});

test('conflictPrompt names the base, branch and files and forbids pushing', () => {
  const p = conflictPrompt({ branch: 'ws/teal', base: 'main', files: ['a.js', 'b/c.js'] });
  assert.match(p, /`origin\/main`/);
  assert.match(p, /`ws\/teal`/);
  assert.match(p, /- a\.js\n- b\/c\.js/);
  assert.match(p, /git commit --no-edit/);
  assert.match(p, /Do not push/);
});

test('updateMessage describes every result', () => {
  assert.equal(updateMessage({ state: 'updated', commits: 2, base: 'main' }), 'Merged 2 commits from main — not pushed');
  assert.equal(updateMessage({ state: 'updated', commits: 1, base: 'main', fetchNote: 'offline' }), 'Merged 1 commit from main — not pushed (offline)');
  assert.equal(updateMessage({ state: 'up-to-date', base: 'main' }), 'Already up to date with main');
  assert.equal(updateMessage({ state: 'dirty', count: 1 }), 'Commit or stash your 1 uncommitted change first');
  assert.equal(updateMessage({ state: 'conflict', files: ['a', 'b'] }), 'Update stopped on 2 conflicted files');
  assert.equal(updateMessage({ error: 'boom' }), 'Update failed: boom');
});

test('pushArgs always names origin and the same branch, and refuses the base and option text (workspace-hardening L1)', () => {
  assert.deepEqual(pushArgs({ branch: 'ws/teal', base: 'main', upstream: null }).args, ['push', '-u', 'origin', 'refs/heads/ws/teal:refs/heads/ws/teal']);
  assert.deepEqual(pushArgs({ branch: 'ws/teal', base: 'main', upstream: 'origin/ws/teal' }).args, ['push', 'origin', 'refs/heads/ws/teal:refs/heads/ws/teal']);
  assert.deepEqual(pushArgs({ branch: 'feat', base: 'main', upstream: 'origin/main' }).args, ['push', '-u', 'origin', 'refs/heads/feat:refs/heads/feat'], 'a wrong upstream is re-pointed, never followed');
  assert.match(pushArgs({ branch: 'main', base: 'main' }).error, /base branch/);
  assert.match(pushArgs({ branch: '-f', base: 'main' }).error, /not a valid branch/);
  assert.match(pushArgs({ branch: '', base: 'main' }).error, /not a valid branch/);
});

test('mergeLanded: only a PR that reads back as merged has landed', () => {
  const { mergeLanded } = require('../src/shared/prFlow');
  assert.equal(mergeLanded({ state: 'merged' }), true);
  assert.equal(mergeLanded({ state: 'open' }), false, 'a merge queue leaves it open');
  assert.equal(mergeLanded(null), false, 'an unreadable PR is not taken as merged');
});

test('baseForBranch: the upstream when it is another branch, else the default', () => {
  const { baseForBranch } = require('../src/shared/prFlow');
  assert.equal(baseForBranch({ branch: 'feat/x', upstream: 'origin/develop', defaultBranch: 'main' }), 'develop');
  assert.equal(baseForBranch({ branch: 'feat/x', upstream: 'origin/feat/x', defaultBranch: 'main' }), 'main', 'its own upstream is not a base');
  assert.equal(baseForBranch({ branch: 'feat/x', upstream: null, defaultBranch: 'master' }), 'master');
  assert.equal(baseForBranch({ branch: 'feat/x', upstream: 'origin/-f', defaultBranch: 'main' }), 'main', 'never an option-like name');
  assert.equal(baseForBranch({ branch: 'feat/x', upstream: 'develop', defaultBranch: 'main' }), 'develop', 'a local upstream counts');
  assert.equal(baseForBranch({ branch: 'feat/x', upstream: null, defaultBranch: null }), null);
});
