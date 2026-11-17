/**
 * Analytics UI hidden (src/shared/analyticsUi.js): the notice is never due,
 * and sending is unchanged. Loads analytics.js with the SDKs replaced by
 * recorders.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { ANALYTICS_UI_HIDDEN } = require('../src/shared/analyticsUi');

const sent = [];
const settings = { analyticsInstallId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' };
const STUBS = {
  '@aptabase/electron/main': { initialize: () => {}, trackEvent: (n) => sent.push(`aptabase:${n}`) },
  'posthog-node': { PostHog: class { capture(e) { sent.push(`posthog:${e.event}`); } shutdown() { return Promise.resolve(); } } },
  electron: { app: { getVersion: () => '0.0.0' } },
  './userSettings': {
    get: (k) => (k in settings ? settings[k] : null),
    set: (k, v) => { if (v === null || v === undefined) delete settings[k]; else settings[k] = v; },
    loadFailed: () => false
  }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};
const analytics = require('../src/main/analytics');
Module._load = loadOriginal;

test('UI hidden: the notice is not due, and events are still sent as before', { skip: !ANALYTICS_UI_HIDDEN && 'analytics UI is shown' }, () => {
  analytics.init();
  assert.equal(analytics.noticeState().show, false);
  analytics.trackAppStarted();
  assert.deepEqual(sent, ['aptabase:app_started', 'posthog:app_started']);
});
