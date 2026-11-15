const test = require('node:test');
const assert = require('node:assert');
const { isSafeExternalUrl } = require('../src/shared/externalLink');

test('allows http and https links', () => {
  assert.strictEqual(isSafeExternalUrl('https://example.com/a?b=c'), true);
  assert.strictEqual(isSafeExternalUrl('http://localhost:3000'), true);
});

test('rejects other schemes and malformed input', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x',
    'about:blank', 'vscode://x', 'not a url', '', null, undefined, 42]) {
    assert.strictEqual(isSafeExternalUrl(url), false, String(url));
  }
});
