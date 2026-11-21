/**
 * Full-auto spec flow — main-process side (full-auto-spec-flow spec).
 *
 * T02 pins that `flow_mode` reaches the SPEC_DATA list entries, and only when
 * a spec declares one, so the renderer's trigger can diff it between pushes
 * and a spec without it costs the payload nothing.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// specManager reaches packages CI does not install; stub them before it loads
// (the same idiom specNewStaging.test.js uses).
const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: {}, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

const specManager = require('../src/main/specManager');

let projectPath;

function writeSpec(slug, extra = {}) {
  const dir = path.join(projectPath, '.frame', 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
    slug,
    title: `Title ${slug}`,
    phase: 'specified',
    generated_task_ids: [],
    ...extra
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'spec.md'), `# ${slug}\n`, 'utf8');
  return dir;
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specauto-'));
  fs.mkdirSync(path.join(projectPath, '.frame', 'specs'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
});

test('T02: list entries carry flow_mode only when the spec declares one', () => {
  writeSpec('auto-one', { flow_mode: 'full-auto' });
  writeSpec('plain-one');
  const bySlug = Object.fromEntries(specManager.listSpecs(projectPath).map((s) => [s.slug, s]));
  assert.equal(bySlug['auto-one'].flow_mode, 'full-auto');
  assert.equal(Object.prototype.hasOwnProperty.call(bySlug['plain-one'], 'flow_mode'), false);
});

test('T02: updateSpecStatus keeps flow_mode beside the other keys', () => {
  writeSpec('auto-two', { implement_mode: 'guided' });
  const r = specManager.updateSpecStatus(projectPath, 'auto-two', { flow_mode: 'full-auto' });
  assert.equal(r.status.flow_mode, 'full-auto');
  assert.equal(r.status.implement_mode, 'guided');
});
