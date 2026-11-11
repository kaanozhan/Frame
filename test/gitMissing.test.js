// isGitMissing — a missing working directory is not a missing git (workspace-hardening L14).
const test = require('node:test');
const assert = require('node:assert');
const { isGitMissing } = require('../src/shared/gitMissing');

test('ENOENT with an existing cwd means git is missing', () => {
  assert.equal(isGitMissing({ code: 'ENOENT' }, '/repo', () => true), true);
});

test('ENOENT for a folder that is gone is not git missing', () => {
  assert.equal(isGitMissing({ code: 'ENOENT' }, '/gone', () => false), false);
});

test('exit 127 from a shell counts; other errors do not', () => {
  assert.equal(isGitMissing({ code: 127 }, '/repo', () => true), true);
  assert.equal(isGitMissing({ code: 128 }, '/repo', () => true), false);
  assert.equal(isGitMissing(null, '/repo', () => true), false);
});

test('no cwd: ENOENT can only be the binary', () => {
  assert.equal(isGitMissing({ code: 'ENOENT' }, undefined, () => false), true);
});
