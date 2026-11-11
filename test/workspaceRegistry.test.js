/**
 * workspaceRegistry — the rules over a project's workspace records
 * (workspaces spec, T02 / C3 / C6 / S3 / S7).
 *
 * Pinned: a branch is held by at most one active workspace and the refusal
 * names the holder; archived workspaces hold nothing, so restore re-checks;
 * refusals never mutate the input; reconcile flags only active records whose
 * worktree vanished, and toStored drops that transient flag.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const reg = require('../src/shared/workspaceRegistry');

const NOW = '2026-11-10T10:00:00.000Z';
const LATER = '2026-11-10T12:00:00.000Z';

function teal() {
  return { id: 'w1', name: 'teal', branch: 'ws/teal', base: 'main', path: '/ws/repo/teal', now: NOW };
}

function withTeal() {
  const r = reg.add([], teal());
  assert.equal(r.ok, true);
  return r.records;
}

test('add builds a local, unarchived record', () => {
  const r = reg.add([], teal());
  assert.equal(r.ok, true);
  assert.deepEqual(r.record, {
    id: 'w1', name: 'teal', branch: 'ws/teal', base: 'main', path: '/ws/repo/teal',
    location: 'local', createdAt: NOW, archivedAt: null
  });
  assert.equal(r.records.length, 1);
});

test('add refuses a branch already open in another workspace and names it', () => {
  const records = withTeal();
  const r = reg.add(records, { id: 'w2', name: 'amber', branch: 'ws/teal', path: '/ws/repo/amber', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, reg.ERR.BRANCH_IN_USE);
  assert.equal(r.error.holder, 'teal');
  assert.match(r.error.message, /teal/);
  assert.equal(records.length, 1, 'input untouched');
});

test('add refuses a duplicate name, missing fields and the reserved main id', () => {
  const records = withTeal();
  assert.equal(reg.add(records, { id: 'w2', name: 'teal', branch: 'ws/x', path: '/p', now: NOW }).error.code, reg.ERR.NAME_IN_USE);
  assert.equal(reg.add(records, { id: 'w2', name: 'x', path: '/p' }).error.code, reg.ERR.INVALID);
  assert.equal(reg.add([], { id: 'main', name: 'x', branch: 'b', path: '/p' }).error.code, reg.ERR.INVALID);
});

test('archive releases the branch; restore takes it back', () => {
  let records = withTeal();
  const a = reg.archive(records, 'w1', LATER);
  assert.equal(a.ok, true);
  assert.equal(a.record.archivedAt, LATER);
  records = a.records;
  assert.equal(reg.findByBranch(records, 'ws/teal'), null, 'archived holds nothing');
  assert.deepEqual(reg.activeOf(records), []);
  assert.equal(reg.archivedOf(records)[0].id, 'w1');

  const r = reg.restore(records, 'w1');
  assert.equal(r.ok, true);
  assert.equal(r.record.archivedAt, null);
  assert.equal(reg.findByBranch(r.records, 'ws/teal').id, 'w1');
});

test('restore is refused when the branch is now open elsewhere', () => {
  let records = reg.archive(withTeal(), 'w1', LATER).records;
  records = reg.add(records, { id: 'w2', name: 'amber', branch: 'ws/teal', path: '/ws/repo/amber', now: LATER }).records;
  const r = reg.restore(records, 'w1');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, reg.ERR.BRANCH_IN_USE);
  assert.equal(r.error.holder, 'amber');
});

test('archive and restore reject the wrong state and unknown ids', () => {
  const records = withTeal();
  assert.equal(reg.restore(records, 'w1').error.code, reg.ERR.NOT_ARCHIVED);
  const archived = reg.archive(records, 'w1', LATER).records;
  assert.equal(reg.archive(archived, 'w1', LATER).error.code, reg.ERR.ALREADY_ARCHIVED);
  assert.equal(reg.archive(records, 'nope', LATER).error.code, reg.ERR.NOT_FOUND);
});

test('rename changes name and branch with the same collision rules', () => {
  let records = withTeal();
  records = reg.add(records, { id: 'w2', name: 'amber', branch: 'ws/amber', path: '/ws/repo/amber', now: NOW }).records;

  const ok = reg.rename(records, 'w1', { name: 'login', branch: 'feat/login' });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.name, 'login');
  assert.equal(ok.record.branch, 'feat/login');
  assert.equal(ok.record.path, '/ws/repo/teal', 'the folder is not moved here');

  assert.equal(reg.rename(records, 'w1', { name: 'amber' }).error.code, reg.ERR.NAME_IN_USE);
  const busy = reg.rename(records, 'w1', { branch: 'ws/amber' });
  assert.equal(busy.error.code, reg.ERR.BRANCH_IN_USE);
  assert.equal(busy.error.holder, 'amber');
  assert.equal(reg.rename(records, 'w1', { name: '' }).error.code, reg.ERR.INVALID);
});

test('reconcile flags active records whose worktree vanished, and only those', () => {
  let records = withTeal();
  records = reg.add(records, { id: 'w2', name: 'amber', branch: 'ws/amber', path: '/ws/repo/amber/', now: NOW }).records;
  records = reg.add(records, { id: 'w3', name: 'jade', branch: 'ws/jade', path: '/ws/repo/jade', now: NOW }).records;
  records = reg.archive(records, 'w3', LATER).records;

  const rows = [{ path: '/repo', isMain: true }, { path: '/ws/repo/amber' }];
  const out = reg.reconcile(records, rows);
  assert.equal(reg.findById(out, 'w1').missing, true);
  assert.equal('missing' in reg.findById(out, 'w2'), false, 'trailing slash normalised');
  assert.equal('missing' in reg.findById(out, 'w3'), false, 'archived records are never missing');

  const back = reg.reconcile(out, [...rows, { path: '/ws/repo/teal' }]);
  assert.equal('missing' in reg.findById(back, 'w1'), false, 'the flag clears when the worktree returns');
});

test('toStored drops the transient missing flag; mutators clear it too', () => {
  const flagged = reg.reconcile(withTeal(), []);
  assert.equal(flagged[0].missing, true);
  assert.equal('missing' in reg.toStored(flagged)[0], false);
  assert.equal(flagged[0].missing, true, 'toStored does not mutate');
  assert.equal('missing' in reg.archive(flagged, 'w1', LATER).record, false);
});

test('remove drops a record', () => {
  const r = reg.remove(withTeal(), 'w1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.records, []);
  assert.equal(reg.remove([], 'w1').error.code, reg.ERR.NOT_FOUND);
});

test('normalizeSettings falls back per key and cleans the branch prefix', () => {
  assert.deepEqual(reg.normalizeSettings(undefined), { setupScript: '', copyFiles: ['.env*'], branchPrefix: 'ws', mergeMethod: null, archiveOnMerge: true });
  assert.deepEqual(
    reg.normalizeSettings({ setupScript: 'npm install', copyFiles: ['.env', 3, '  ', ' *.pem '], branchPrefix: ' Feat//Me/ ' }),
    { setupScript: 'npm install', copyFiles: ['.env', '*.pem'], branchPrefix: 'feat/me', mergeMethod: null, archiveOnMerge: true }
  );
  assert.deepEqual(reg.normalizeSettings({ copyFiles: [] }).copyFiles, [], 'an explicit empty list stays empty');
  assert.equal(reg.normalizeSettings({ branchPrefix: '///' }).branchPrefix, 'ws');
  assert.equal(reg.normalizeSettings({ setupScript: 42 }).setupScript, '');
});

test('normalizeSettings: merge method and archive-on-merge (workspace-pr-flow)', () => {
  assert.equal(reg.normalizeSettings({ mergeMethod: 'rebase' }).mergeMethod, 'rebase');
  assert.equal(reg.normalizeSettings({ mergeMethod: 'octopus' }).mergeMethod, null);
  assert.equal(reg.normalizeSettings({ archiveOnMerge: false }).archiveOnMerge, false);
  assert.equal(reg.normalizeSettings({ archiveOnMerge: 'no' }).archiveOnMerge, true);
});

test('rename refuses a branch name that git would read as an option (workspace-hardening L2)', () => {
  const recs = reg.add([], { id: 'a1', name: 'teal', branch: 'ws/teal', base: 'main', path: '/w/teal', now: '2026-11-11T00:00:00Z' }).records;
  const res = reg.rename(recs, 'a1', { branch: '-f' });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /not a valid branch/);
  assert.equal(reg.rename(recs, 'a1', { branch: 'ws/ok' }).ok, true);
});

test('reconcile compares canonical paths when given canon', () => {
  const recs = [{ id: 'a', name: 'a', branch: 'b', path: '/link/p/a', createdAt: 'x' }];
  const rows = [{ path: '/real/p/a' }];
  const canon = (p) => p.replace(/^\/link\//, '/real/');
  assert.equal(reg.reconcile(recs, rows)[0].missing, true, 'string compare says missing');
  assert.equal(reg.reconcile(recs, rows, { canon })[0].missing, undefined);
});
