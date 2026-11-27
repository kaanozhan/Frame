/**
 * leadProtocol — framing and messages between the Chief's MCP server and its
 * host (lead-agent spec, T04). Pinned: JSON-lines framing with partial and
 * bad lines, token rejection, host request validation, and the MCP shapes
 * Claude Code sees (initialize, tools/list, tools/call).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../src/shared/leadProtocol');

test('line reader: whole, split, several per chunk, blank and CRLF lines', () => {
  const got = [];
  const r = L.createLineReader((m) => got.push(m));
  r.feed('{"a":1}\n');
  r.feed('{"b":');
  assert.deepEqual(got, [{ a: 1 }]);
  assert.equal(r.pending, '{"b":');
  r.feed('2}\n{"c":3}\r\n\n{"d"');
  r.feed(':4}\n');
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]);
  assert.equal(r.pending, '');
});

test('line reader: a bad line is reported and skipped, a runaway line is dropped whole', () => {
  const got = [];
  const errs = [];
  const r = L.createLineReader((m) => got.push(m), { onError: (e) => errs.push(e), maxLine: 32 });
  r.feed('not json\n{"ok":true}\n');
  assert.deepEqual(got, [{ ok: true }]);
  assert.equal(errs[0].code, L.RPC.PARSE);
  r.feed('x'.repeat(40));
  assert.equal(errs[1].message, 'Line too long');
  r.feed('still the same long line\n{"after":1}\n');
  assert.deepEqual(got, [{ ok: true }, { after: 1 }], 'the rest of the long line is discarded, the next line is read');
});

test('encode writes one line', () => {
  assert.equal(L.encode({ a: 'x\ny' }), '{"a":"x\\ny"}\n');
});

test('tokens: constant-time compare, generated tokens are long and distinct', () => {
  const t = L.generateToken();
  assert.ok(t.length >= 40);
  assert.notEqual(t, L.generateToken());
  assert.equal(L.tokensEqual(t, t), true);
  assert.equal(L.tokensEqual(t, `${t}x`), false);
  assert.equal(L.tokensEqual('', ''), false);
  assert.equal(L.tokensEqual(null, t), false);
});

test('host requests: token first, then type, tool and args', () => {
  const tok = 'secret';
  assert.equal(L.validateHostRequest(null, tok).error.code, 'bad-request');
  assert.equal(L.validateHostRequest([], tok).error.code, 'bad-request');
  assert.equal(L.validateHostRequest({ id: 1, type: 'list' }, tok).error.code, 'unauthorized');
  assert.equal(L.validateHostRequest({ id: 1, token: 'wrong', type: 'list' }, tok).error.code, 'unauthorized');
  assert.equal(L.validateHostRequest({ id: 1, token: tok, type: 'rm' }, tok).error.code, 'bad-request');
  assert.equal(L.validateHostRequest({ id: 1, token: tok, type: 'call' }, tok).error.code, 'bad-request');
  assert.equal(L.validateHostRequest({ id: 1, token: tok, type: 'call', tool: 't', args: [1] }, tok).error.code, 'bad-request');
  assert.deepEqual(L.validateHostRequest({ id: 7, token: tok, type: 'call', tool: 'terminal_read', args: { id: 'term-1' } }, tok),
    { ok: true, request: { id: 7, type: 'call', tool: 'terminal_read', args: { id: 'term-1' } } });
  assert.deepEqual(L.validateHostRequest({ id: 8, token: tok, type: 'hello' }, tok).request, { id: 8, type: 'hello', tool: null, args: {} });
  assert.deepEqual(L.hostOk(1, { x: 1 }), { id: 1, ok: true, result: { x: 1 } });
  assert.deepEqual(L.hostError(1, 'refused', 'no'), { id: 1, ok: false, error: { code: 'refused', message: 'no' } });
});

test('MCP: classify, initialize negotiation, tool results', () => {
  assert.deepEqual(L.classifyRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    { kind: 'request', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.deepEqual(L.classifyRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), { kind: 'notification', method: 'notifications/initialized', params: {} });
  assert.equal(L.classifyRpc({ jsonrpc: '2.0', id: 3, result: {} }).kind, 'response');
  assert.equal(L.classifyRpc({ id: 3, method: 'x' }).kind, 'invalid');
  assert.equal(L.classifyRpc(null).kind, 'invalid');

  const init = L.initializeResult({ requested: '2025-03-26', name: 'frame-lead', version: '1.0.0', instructions: 'Be the Chief.' });
  assert.deepEqual(init, {
    protocolVersion: '2025-03-26',
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'frame-lead', version: '1.0.0' },
    instructions: 'Be the Chief.'
  });
  assert.equal(L.initializeResult({ requested: '1999-01-01', name: 'n', version: 'v' }).protocolVersion, L.MCP_VERSIONS[0]);
  assert.equal('instructions' in L.initializeResult({ name: 'n', version: 'v' }), false);

  assert.deepEqual(L.toolResult({ a: 1 }), { content: [{ type: 'text', text: '{\n  "a": 1\n}' }] });
  assert.deepEqual(L.toolResult('refused', { isError: true }), { content: [{ type: 'text', text: 'refused' }], isError: true });
  assert.deepEqual(L.rpcResult(4, {}), { jsonrpc: '2.0', id: 4, result: {} });
  assert.deepEqual(L.rpcError(undefined, L.RPC.PARSE, 'bad'), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'bad' } });
});

test('self-contained: requires node built-ins only (it is copied out next to lead-mcp.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/shared/leadProtocol.js'), 'utf8');
  const reqs = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.deepEqual(reqs, ['crypto']);
});
