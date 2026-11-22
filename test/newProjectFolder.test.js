/**
 * newProjectFolder (#223): "Create a new project" makes <location>/<name>
 * and opens it — never an existing folder that already holds work.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProjectFolder } = require('../src/main/newProjectFolder');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-newproj-')); }

test('a new name creates the folder inside the chosen location', () => {
  const parent = tmp();
  try {
    const res = createProjectFolder(path.join(parent, 'my-app'));
    assert.equal(res.error, null);
    assert.equal(res.path, path.join(parent, 'my-app'));
    assert.ok(fs.statSync(res.path).isDirectory());
    assert.deepEqual(fs.readdirSync(parent), ['my-app'], 'nothing else is written in the parent');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an existing empty folder is accepted', () => {
  const parent = tmp();
  try {
    fs.mkdirSync(path.join(parent, 'empty'));
    fs.writeFileSync(path.join(parent, 'empty', '.DS_Store'), '');
    assert.equal(createProjectFolder(path.join(parent, 'empty')).error, null);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an existing folder with work in it, or a file, is refused and left untouched', () => {
  const parent = tmp();
  try {
    fs.mkdirSync(path.join(parent, 'repos'));
    fs.writeFileSync(path.join(parent, 'repos', 'README.md'), 'mine');
    const full = createProjectFolder(path.join(parent, 'repos'));
    assert.equal(full.path, null);
    assert.match(full.error, /not empty/);
    assert.deepEqual(fs.readdirSync(path.join(parent, 'repos')), ['README.md']);

    fs.writeFileSync(path.join(parent, 'notes.txt'), 'x');
    assert.match(createProjectFolder(path.join(parent, 'notes.txt')).error, /not a folder/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an empty name is refused', () => {
  assert.equal(createProjectFolder('').path, null);
  assert.equal(createProjectFolder(null).path, null);
});
