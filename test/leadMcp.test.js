/**
 * lead-mcp.js — the Chief's stdio MCP server (lead-agent spec, T06).
 *
 * Spawns the real script against a stub host on a local socket (node
 * built-ins only) and speaks MCP to it the way Claude Code does. Pinned:
 * instructions come from the host's hello, tools/list and tools/call are
 * relayed with the token, host errors become isError results, an unreachable
 * host is reported rather than hanging, and CHIEF.md fits the 4,096-character
 * limit Claude Code puts on server instructions.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const P = require('../src/shared/leadProtocol');

const SCRIPT = path.join(__dirname, '../src/templates/lead/lead-mcp.js');
const CHIEF = path.join(__dirname, '../src/templates/lead/CHIEF.md');
const TOKEN = 'tok-123';

function sockPath(tag) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\frame-lead-test-${process.pid}-${tag}`
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fl-')), 's.sock');
}

/** A host that answers like leadHost, recording what it received. */
function stubHost(file) {
  const seen = [];
  const server = net.createServer((c) => {
    c.setEncoding('utf8');
    const r = P.createLineReader((msg) => {
      seen.push(msg);
      if (!P.tokensEqual(msg.token, TOKEN)) return c.write(P.encode(P.hostError(msg.id, 'unauthorized', 'bad token')));
      if (msg.type === 'hello') return c.write(P.encode(P.hostOk(msg.id, { name: 'frame-lead', version: '9.9.9', instructions: 'You are the Chief.' })));
      if (msg.type === 'list') return c.write(P.encode(P.hostOk(msg.id, [{ name: 'terminals_list', description: 'List', inputSchema: { type: 'object', properties: {} } }])));
      if (msg.tool === 'terminal_send') return c.write(P.encode(P.hostError(msg.id, 'refused', 'conductor lane')));
      return c.write(P.encode(P.hostOk(msg.id, { echo: msg.tool, args: msg.args })));
    });
    c.on('data', (d) => r.feed(d));
  });
  return new Promise((resolve) => server.listen(file, () => resolve({ server, seen })));
}

/** Run lead-mcp.js, send `requests`, collect one response per request id. */
function runMcp(env, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = new Map();
    const want = requests.filter((r) => r.id !== undefined).length;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout; got ${[...out.keys()]}`)); }, 8000);
    const reader = P.createLineReader((msg) => {
      out.set(msg.id, msg);
      if (out.size >= want) { clearTimeout(timer); child.stdin.end(); }
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => reader.feed(d));
    child.on('exit', () => resolve(out));
    for (const r of requests) child.stdin.write(P.encode({ jsonrpc: '2.0', ...r }));
  });
}

test('initialize, tools/list and tools/call are relayed to the host with the token', async () => {
  const file = sockPath('a');
  const { server, seen } = await stubHost(file);
  try {
    const out = await runMcp({ FRAME_LEAD_SOCKET: file, FRAME_LEAD_TOKEN: TOKEN }, [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list', params: {} },
      { id: 3, method: 'tools/call', params: { name: 'terminal_read', arguments: { id: 'term-2' } } },
      { id: 4, method: 'tools/call', params: { name: 'terminal_send', arguments: { id: 'term-3', text: 'x' } } },
      { id: 5, method: 'ping' },
      { id: 6, method: 'resources/list' }
    ]);
    const init = out.get(1).result;
    assert.equal(init.protocolVersion, '2025-06-18');
    assert.equal(init.instructions, 'You are the Chief.');
    assert.deepEqual(init.serverInfo, { name: 'frame-lead', version: '9.9.9' });
    assert.deepEqual(out.get(2).result.tools.map((t) => t.name), ['terminals_list']);
    assert.deepEqual(JSON.parse(out.get(3).result.content[0].text), { echo: 'terminal_read', args: { id: 'term-2' } });
    assert.equal(out.get(3).result.isError, undefined);
    assert.equal(out.get(4).result.isError, true);
    assert.match(out.get(4).result.content[0].text, /^refused: conductor lane/);
    assert.deepEqual(out.get(5).result, {});
    assert.equal(out.get(6).error.code, P.RPC.METHOD_NOT_FOUND);
    assert.ok(seen.length >= 4 && seen.every((m) => m.token === TOKEN), 'every host request carries the token');
  } finally {
    server.close();
  }
});

test('a wrong token is refused by the host and surfaces as an error result', async () => {
  const file = sockPath('b');
  const { server } = await stubHost(file);
  try {
    const out = await runMcp({ FRAME_LEAD_SOCKET: file, FRAME_LEAD_TOKEN: 'wrong' }, [
      { id: 1, method: 'tools/call', params: { name: 'terminals_list', arguments: {} } }
    ]);
    assert.equal(out.get(1).result.isError, true);
    assert.match(out.get(1).result.content[0].text, /^unauthorized/);
  } finally {
    server.close();
  }
});

test('an unreachable host is reported, not hung on', async () => {
  const out = await runMcp({ FRAME_LEAD_SOCKET: sockPath('nobody'), FRAME_LEAD_TOKEN: TOKEN }, [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { id: 2, method: 'tools/call', params: { name: 'terminals_list' } }
  ]);
  assert.match(out.get(1).result.instructions, /not reachable/);
  assert.equal(out.get(2).result.isError, true);
  assert.match(out.get(2).result.content[0].text, /^unreachable/);
});

test('CHIEF.md has the roles-template sections and fits the MCP instructions limit', () => {
  const text = fs.readFileSync(CHIEF, 'utf8');
  assert.ok(text.length <= 4096, `CHIEF.md is ${text.length} characters`);
  for (const h of ['## Purpose', '## Steps', '## Commands', '## Notes']) assert.ok(text.includes(h), h);
  for (const tool of ['terminals_list', 'terminal_read', 'terminal_send', 'terminal_wait']) assert.ok(text.includes(tool), tool);
});

test('lead-mcp.js requires node built-ins and the protocol module only', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const reqs = [...src.matchAll(/require\(([^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(reqs.filter((r) => !/^'(fs|net|path)'$/.test(r)).length, 1, 'only the leadProtocol require is non-builtin');
});
