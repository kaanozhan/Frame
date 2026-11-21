/**
 * release-build tests — the Frame Cloud address a release carries.
 *
 * releaseArgs is pure: these pin which FRAME_CLOUD_RELEASE_URL values reach
 * electron-builder as `-c.extraMetadata.frameCloudUrl` and which are left out
 * with a warning. The spawn itself is checked with a real `npm run dist`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { releaseArgs } = require('../scripts/release-build');

const FLAGS = ['--mac', '--dir'];
const OFF = /Frame Cloud will be off in this build/;

test('an https address is passed as extraMetadata, after the builder flags', () => {
  const { args, warning } = releaseArgs(FLAGS, { FRAME_CLOUD_RELEASE_URL: 'https://cloud.example.test' });
  assert.deepEqual(args, ['--mac', '--dir', '-c.extraMetadata.frameCloudUrl=https://cloud.example.test']);
  assert.equal(warning, null);
});

test('the address is trimmed and loses trailing slashes', () => {
  const { args } = releaseArgs([], { FRAME_CLOUD_RELEASE_URL: '  https://cloud.example.test/api//  ' });
  assert.deepEqual(args, ['-c.extraMetadata.frameCloudUrl=https://cloud.example.test/api']);
});

test('a missing or empty address leaves the flag out with a warning', () => {
  for (const env of [{}, { FRAME_CLOUD_RELEASE_URL: '' }, { FRAME_CLOUD_RELEASE_URL: '   ' }, undefined]) {
    const { args, warning } = releaseArgs(FLAGS, env);
    assert.deepEqual(args, FLAGS);
    assert.match(warning, /FRAME_CLOUD_RELEASE_URL is not set/);
    assert.match(warning, OFF);
  }
});

test('an http address is left out, even on loopback', () => {
  for (const url of ['http://cloud.example.test', 'http://localhost:3000', 'http://127.0.0.1:3000']) {
    const { args, warning } = releaseArgs(FLAGS, { FRAME_CLOUD_RELEASE_URL: url });
    assert.deepEqual(args, FLAGS, url);
    assert.match(warning, /not an https address/, url);
    assert.match(warning, OFF, url);
  }
});

test('an https loopback address is left out', () => {
  for (const url of ['https://localhost:3000', 'https://127.0.0.1']) {
    const { args, warning } = releaseArgs(FLAGS, { FRAME_CLOUD_RELEASE_URL: url });
    assert.deepEqual(args, FLAGS, url);
    assert.match(warning, /points at this machine/, url);
    assert.match(warning, OFF, url);
  }
});

test('an unparsable address is left out', () => {
  for (const url of ['cloud.example.test', 'not a url']) {
    const { args, warning } = releaseArgs(FLAGS, { FRAME_CLOUD_RELEASE_URL: url });
    assert.deepEqual(args, FLAGS, url);
    assert.match(warning, /not a URL/, url);
  }
});

test('the warning never repeats the address', () => {
  const { warning } = releaseArgs(FLAGS, { FRAME_CLOUD_RELEASE_URL: 'http://cloud.example.test/secret-path' });
  assert.ok(!warning.includes('cloud.example.test'));
});

test('the builder flags are not mutated', () => {
  const argv = ['--mac'];
  releaseArgs(argv, { FRAME_CLOUD_RELEASE_URL: 'https://cloud.example.test' });
  assert.deepEqual(argv, ['--mac']);
});
