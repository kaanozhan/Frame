/**
 * copyFilesMatch — which gitignored files a new workspace copies
 * (workspaces spec, T02 / G3 / S2).
 *
 * Pinned: `.env*` is the default; unanchored patterns match a name at any
 * depth, anchored ones from the root; `*` stays inside a segment, `**`
 * spans segments, `?` is one character; directory patterns cover their
 * contents; node_modules and .git never match; comments and blanks are
 * ignored; an explicit empty list matches nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_COPY_FILES, compile, selectFiles } = require('../src/shared/copyFilesMatch');

test('the default is .env*', () => {
  assert.deepEqual(DEFAULT_COPY_FILES, ['.env*']);
  const m = compile(undefined);
  assert.ok(m('.env'));
  assert.ok(m('.env.local'));
  assert.ok(m('apps/web/.env.production'));
  assert.ok(!m('env.txt'));
  assert.ok(m('src/.envrc-notes/readme.md'), 'a directory whose name matches is selected with its contents');
});

test('an explicit empty list matches nothing', () => {
  assert.ok(!compile([])('.env'));
  assert.ok(!compile('')('.env'));
});

test('unanchored patterns match a name at any depth', () => {
  const m = compile(['*.pem']);
  assert.ok(m('server.pem'));
  assert.ok(m('certs/dev/server.pem'));
  assert.ok(!m('server.pem.bak'));
});

test('anchored patterns match from the root only', () => {
  const m = compile(['config/local.json']);
  assert.ok(m('config/local.json'));
  assert.ok(!m('apps/config/local.json'));
  assert.ok(compile(['/local.json'])('local.json'));
  assert.ok(!compile(['/local.json'])('sub/local.json'));
});

test('* stays in one segment, ** spans segments, ? is one character', () => {
  assert.ok(compile(['config/*.json'])('config/a.json'));
  assert.ok(!compile(['config/*.json'])('config/deep/a.json'));
  assert.ok(compile(['config/**/*.json'])('config/deep/er/a.json'));
  assert.ok(compile(['config/**/*.json'])('config/a.json'), '** matches zero segments');
  assert.ok(compile(['certs/**'])('certs/a/b.key'));
  assert.ok(compile(['key?.txt'])('key1.txt'));
  assert.ok(!compile(['key?.txt'])('key12.txt'));
});

test('a directory pattern covers its contents', () => {
  const m = compile(['.secrets', 'local/']);
  assert.ok(m('.secrets'));
  assert.ok(m('.secrets/token'));
  assert.ok(m('local/a/b.txt'));
});

test('node_modules and .git never match', () => {
  const m = compile(['**', '*', 'node_modules', '.env*']);
  assert.ok(!m('node_modules/pkg/.env'));
  assert.ok(!m('apps/web/node_modules/x'));
  assert.ok(!m('.git/config'));
  assert.ok(m('.env'));
});

test('comments, blanks and a newline-separated string are accepted', () => {
  const m = compile('# secrets\n\n.env*\r\n  *.pem  \n');
  assert.ok(m('.env'));
  assert.ok(m('a/b.pem'));
  assert.ok(!m('# secrets'));
});

test('selectFiles filters candidates and normalises separators', () => {
  const out = selectFiles(['.env', 'src\\.env.local', 'README.md', './.env.test'], ['.env*']);
  assert.deepEqual(out, ['.env', 'src\\.env.local', './.env.test']);
});

test('a trailing /** also matches the collapsed directory itself', () => {
  const { selectFiles } = require('../src/shared/copyFilesMatch');
  assert.deepEqual(selectFiles(['certs/', 'other/'], ['certs/**']), ['certs/']);
});

test('dirsToExpand: collapsed folders an anchored pattern reaches into', () => {
  const { dirsToExpand } = require('../src/shared/copyFilesMatch');
  assert.deepEqual(dirsToExpand(['secrets/', 'build/', '.env'], ['secrets/*.key', '.env*']), ['secrets/']);
  assert.deepEqual(dirsToExpand(['config/'], ['config/local/*.json']), ['config/']);
  assert.deepEqual(dirsToExpand(['certs/'], ['certs/**']), [], 'already selected whole');
  assert.deepEqual(dirsToExpand(['node_modules/'], ['node_modules/x/*.js']), [], 'never node_modules');
});
