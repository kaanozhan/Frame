/**
 * Packaging closure: every script Frame copies into a project's `.frame/bin/`
 * must be in electron-builder's `build.files` whitelist.
 *
 * In development the scripts are read straight from the repository, so a
 * missing entry is invisible there. In the packaged app the file is simply
 * absent: copyParserScripts logs a warning and skips it, the hook that runs
 * it exits 0 silently, and the feature is dead in every user project. That
 * is how module-hint.js, docs-hint.js and spec-command-hint.js shipped
 * missing until 2.8.2.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const structureBootstrap = require('../src/main/structureBootstrap');

const buildFiles = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).build.files;

/** Is a repo-relative path included by the whitelist? (the patterns it uses) */
function packaged(rel) {
  const included = buildFiles.some((pattern) => {
    if (pattern.startsWith('!')) return false;
    if (pattern.endsWith('/**/*')) return rel.startsWith(pattern.slice(0, -'**/*'.length));
    return pattern === rel;
  });
  return included && !buildFiles.some((pattern) => pattern.startsWith('!') && pattern.slice(1) === rel);
}

test('every script copied into .frame/bin/ is in build.files', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-build-files-'));
  try {
    const copied = structureBootstrap.copyParserScripts(project);
    assert.ok(copied.length > 0, 'the staging copied something to check');
    // Where each copied name comes from: scripts/ in general, except the
    // app's own atomic writer, which is shipped from src/main (STR-01).
    const SOURCES = { 'fsSafe.js': 'src/main/fsSafe.js' };
    const shipped = copied
      .filter((name) => name !== 'intent-map.json') // seeded per project, not copied
      .map((name) => SOURCES[name] || `scripts/${name}`);
    const missing = shipped.filter((rel) => !packaged(rel));
    assert.deepEqual(missing, [], `add these to package.json build.files: ${missing.join(', ')}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('every scripts/ file the app requires at runtime is in build.files', () => {
  const required = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        for (const m of source.matchAll(/require\(\s*['"]((?:\.\.\/)+scripts\/[^'"]+)['"]\s*\)/g)) {
          const resolved = path.relative(REPO_ROOT, path.resolve(path.dirname(full), m[1]));
          required.add(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'src'));
  const missing = [...required].map((p) => p.split(path.sep).join('/')).filter((rel) => !packaged(rel));
  assert.deepEqual(missing, [], `add these to package.json build.files: ${missing.join(', ')}`);
});
