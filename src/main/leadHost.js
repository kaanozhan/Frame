/**
 * leadHost — the Chief's host, one per machine (lead-agent spec, T07).
 *
 * Runs unchanged in the desktop main process and in Frame Server; everything
 * machine-specific comes in through an adapter (src/main/leadManager.js on
 * the desktop, src/server/lead.js on a server). It owns all Chief state —
 * tokens, delivery queues, approvals, modes — so the Chief's Claude session
 * holds nothing and can be cleared or restarted at any time (plan D20).
 *
 *   Claude ─stdio─ lead-mcp.js ─socket+token─ leadHost ─adapter─ PTYs
 *
 * Tools are a registry (`name → { description, inputSchema, approval, run }`)
 * so the work-queue spec adds tools without touching dispatch (D19).
 * Approvals are generic records shown as one "Chief wants to …" card.
 *
 * adapter = {
 *   listTerminals(projectPath)  → [{ id, projectPath, workspace, cwd, home?, lead?, name? }]
 *   status(id)                  → { status, agent, kind?, msg? }       (ptyManager.agentStatus)
 *   pasteMode(id)               → boolean
 *   lastUserInputAt(id)         → epoch ms | null
 *   readScreen(id, lines)       → Promise<string|null>
 *   transcriptFor(id)           → Promise<string|null>                (a .jsonl path)
 *   write(id, data)
 *   orchestrationIds(projectPath) → Iterable<id>                       (conductor lanes, read-only)
 *   createTerminal?(opts)       → Promise<id>                          (unused in v1; the queue spec)
 *   onApprovalsChanged?(chief, pending[])                              (UI: show / clear cards)
 * }
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const rules = require('../shared/leadRules');
const proto = require('../shared/leadProtocol');
const programStatus = require('../shared/programStatus');
const transcript = require('../shared/leadTranscript');

const SERVER_NAME = 'frame-lead';
const SERVER_VERSION = '1.0.0';
const MCP_SERVER_KEY = 'frame-lead';
const ALLOWED_TOOLS = `mcp__${MCP_SERVER_KEY}__*`;
const INSTRUCTIONS_LIMIT = 4096;

const PASTE_SETTLE_MS = 350;   // paste → Enter: proven against Claude's TUI
const NEXT_SEND_MAX_MS = 2000; // after a delivery, wait for the status to leave ready, at most this long
const POLL_MS = 500;
const DEFAULT_READ_LINES = 60;
const MAX_READ_LINES = 400;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const DEFAULT_SEND_WAIT_S = 60;
const MAX_WAIT_S = 300;
const SOCKET_PATH_MAX = 100;

const TEMPLATE_DIR = path.join(__dirname, '../templates/lead');
const PROTOCOL_FILE = path.join(__dirname, '../shared/leadProtocol.js');

function shellQuote(s, platform = process.platform) {
  if (platform === 'win32') return `"${String(s).replace(/"/g, '\\"')}"`;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function readTail(file, bytes = TRANSCRIPT_TAIL_BYTES) {
  let fd = null;
  try {
    const st = fs.statSync(file);
    const n = Math.min(st.size, bytes);
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, st.size - n);
    return { text: buf.toString('utf8'), fromMiddle: st.size > n };
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.machine      this machine's key: 'desktop' or a server key
 * @param {string} [o.machineLabel]
 * @param {object} o.adapter
 * @param {string} [o.homeDir]    where ~/.frame lives (tests, Frame Server's own home)
 * @param {string} [o.nodePath]   binary that runs lead-mcp.js (FRAME_NODE)
 * @param {object} [o.logger]
 */
function createLeadHost({ machine, machineLabel = null, adapter, homeDir = os.homedir(), nodePath = process.execPath, logger = null } = {}) {
  if (!adapter) throw new Error('leadHost needs an adapter');
  const log = (lvl, msg) => { try { logger && logger[lvl] && logger[lvl]('lead', msg); } catch (_) { /* logging is best effort */ } };

  const frameDir = path.join(homeDir, '.frame');
  const runDir = path.join(frameDir, 'run');
  const modesFile = path.join(frameDir, 'lead.json');

  const chiefs = new Map();          // token → chief { token, chiefId, projectPath }
  const byChiefId = new Map();       // chiefId → chief
  let queues = new Map();            // targetId → [item]
  const pumping = new Set();         // targetIds with a pump running
  let approvals = rules.createApprovals();
  const approvalWaiters = new Map(); // approval id → [resolve]
  let server = null;
  let socketPath = null;
  let stopped = false;

  // ─── modes (D10) ───────────────────────────────────────

  function readModes() {
    try {
      const d = JSON.parse(fs.readFileSync(modesFile, 'utf8'));
      return d && typeof d.modes === 'object' && d.modes ? d.modes : {};
    } catch (_) {
      return {};
    }
  }

  function getMode(projectPath) {
    return rules.normalizeMode(readModes()[projectPath]);
  }

  function setMode(projectPath, mode) {
    const modes = readModes();
    modes[projectPath] = rules.normalizeMode(mode);
    fs.mkdirSync(frameDir, { recursive: true });
    const tmp = `${modesFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ modes }, null, 2)}\n`);
    fs.renameSync(tmp, modesFile);
    return modes[projectPath];
  }

  // ─── socket (D8) ───────────────────────────────────────

  function ensureServer() {
    if (server) return Promise.resolve(socketPath);
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(runDir, 0o700); } catch (_) { /* Windows */ }
    const tag = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    if (process.platform === 'win32') {
      socketPath = `\\\\.\\pipe\\frame-lead-${tag}`;
    } else {
      socketPath = path.join(runDir, `lead-${tag}.sock`);
      // sun_path is ~104 bytes on macOS (108 on Linux); a long home (Frame
      // Server, tests) would be silently truncated. Fall back to a short,
      // private directory under the system temp dir.
      if (Buffer.byteLength(socketPath) > SOCKET_PATH_MAX) {
        const short = path.join(os.tmpdir(), `frame-lead-${typeof process.getuid === 'function' ? process.getuid() : 'u'}`);
        fs.mkdirSync(short, { recursive: true, mode: 0o700 });
        try { fs.chmodSync(short, 0o700); } catch (_) { /* best effort */ }
        socketPath = path.join(short, `${tag}.sock`);
      }
      try { fs.unlinkSync(socketPath); } catch (_) { /* no stale socket */ }
    }
    return new Promise((resolve, reject) => {
      const s = net.createServer(onConnection);
      s.once('error', reject);
      s.listen(socketPath, () => {
        try { if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600); } catch (_) { /* best effort */ }
        server = s;
        resolve(socketPath);
      });
    });
  }

  function chiefForToken(tok) {
    for (const [t, chief] of chiefs) if (proto.tokensEqual(tok, t)) return chief;
    return null;
  }

  function onConnection(conn) {
    conn.setEncoding('utf8');
    const reader = proto.createLineReader((msg) => {
      const chief = chiefForToken(msg && msg.token);
      const v = proto.validateHostRequest(msg, chief ? chief.token : null);
      if (!v.ok) return conn.write(proto.encode(proto.hostError(msg && msg.id, v.error.code, v.error.message)));
      handle(chief, v.request)
        .then((res) => { if (!conn.destroyed) conn.write(proto.encode(res)); })
        .catch((e) => { if (!conn.destroyed) conn.write(proto.encode(proto.hostError(v.request.id, 'internal', e.message))); });
    });
    conn.on('data', (d) => reader.feed(d));
    conn.on('error', () => {});
  }

  async function handle(chief, req) {
    if (req.type === 'hello') return proto.hostOk(req.id, { name: SERVER_NAME, version: SERVER_VERSION, instructions: instructionsFor(chief) });
    if (req.type === 'list') return proto.hostOk(req.id, toolDefinitions());
    const tool = registry.get(req.tool);
    if (!tool) return proto.hostError(req.id, 'unknown-tool', `No tool ${req.tool}`);
    const result = await tool.run(chief, req.args || {});
    return proto.hostOk(req.id, result);
  }

  function instructionsFor(chief) {
    let role = '';
    try { role = fs.readFileSync(path.join(TEMPLATE_DIR, 'CHIEF.md'), 'utf8'); } catch (_) { role = '# Role: Chief\n'; }
    const ctx = `\n\n## This session\n\n- Project: ${chief.projectPath}\n- Machine: ${machineLabel || machine}\n- Send mode: ${getMode(chief.projectPath)}\n`;
    const out = role + ctx;
    return out.length <= INSTRUCTIONS_LIMIT ? out : out.slice(0, INSTRUCTIONS_LIMIT);
  }

  // ─── terminals ─────────────────────────────────────────

  function inScope(chief) {
    const all = (adapter.listTerminals(chief.projectPath) || []).map((t) => ({ machine, ...t }));
    return rules.scopeFilter(all, { projectPath: chief.projectPath, machine, chiefId: chief.chiefId });
  }

  function findInScope(chief, id) {
    return inScope(chief).find((t) => t.id === id) || null;
  }

  function orchestrationSet(projectPath) {
    try { return new Set(adapter.orchestrationIds ? adapter.orchestrationIds(projectPath) || [] : []); } catch (_) { return new Set(); }
  }

  function statusOf(id) {
    try { return adapter.status(id) || { status: rules.STATUS.UNKNOWN, agent: null }; } catch (_) { return { status: rules.STATUS.UNKNOWN, agent: null }; }
  }

  function describe(t, orch) {
    const s = statusOf(t.id);
    const out = { id: t.id, name: t.name || null, workspace: t.workspace || 'main', cwd: t.cwd || null, agent: s.agent || null, process: s.foreground || null, status: s.status };
    if (s.kind) out.kind = s.kind;
    if (s.error) out.error = s.error;
    if (orch.has(t.id)) out.conductor = true;
    const q = queues.get(t.id);
    if (q && q.length) out.queued = q.length;
    return out;
  }

  async function activityOf(id) {
    let file = null;
    try { file = await adapter.transcriptFor(id); } catch (_) { file = null; }
    if (!file) return null;
    const tail = readTail(file);
    if (!tail) return null;
    return transcript.summarize(transcript.parseLines(tail.text, { fromMiddle: tail.fromMiddle }));
  }

  // ─── delivery (D14 / D15) ──────────────────────────────

  function settle(item, outcome) {
    if (item.settled) return;
    item.settled = true;
    item.outcome = outcome;
    for (const fn of item.waiters) fn(outcome);
    item.waiters = [];
  }

  function enqueueDelivery(chief, targetId, text) {
    const item = { chiefId: chief.chiefId, targetId, text, settled: false, outcome: null, waiters: [] };
    item.done = new Promise((resolve) => item.waiters.push(resolve));
    queues = rules.enqueue(queues, targetId, item);
    pump(targetId);
    return item;
  }

  async function deliver(item) {
    const paste = !!adapter.pasteMode(item.targetId);
    adapter.write(item.targetId, paste ? programStatus.bracketedPaste(item.text) : item.text.replace(/[\r\n]+$/, ''));
    await sleep(PASTE_SETTLE_MS);
    adapter.write(item.targetId, '\r');
  }

  async function pump(targetId) {
    if (pumping.has(targetId)) return;
    pumping.add(targetId);
    try {
      while (!stopped) {
        const item = rules.head(queues, targetId);
        if (!item) break;
        const s = statusOf(targetId);
        if (s.status === rules.STATUS.ENDED) {
          const d = rules.dropTarget(queues, targetId);
          queues = d.queues;
          for (const it of d.dropped) settle(it, { outcome: 'cancelled', reason: 'The terminal closed before the message could be delivered.' });
          break;
        }
        const gate = rules.deliveryGate({ status: s.status, lastUserInputAt: adapter.lastUserInputAt(targetId), now: Date.now() });
        if (!gate.ok) {
          await sleep(gate.waitMs ? Math.min(gate.waitMs + 50, rules.USER_QUIET_MS) : POLL_MS);
          continue;
        }
        try {
          await deliver(item);
          settle(item, { outcome: 'delivered' });
        } catch (e) {
          settle(item, { outcome: 'cancelled', reason: `Delivery failed: ${e.message}` });
        }
        queues = rules.dequeue(queues, targetId);
        // Let the target pick it up before the next one goes in.
        const until = Date.now() + NEXT_SEND_MAX_MS;
        while (Date.now() < until && statusOf(targetId).status === rules.STATUS.READY) await sleep(100);
      }
    } finally {
      pumping.delete(targetId);
    }
  }

  // ─── approvals (D17) ───────────────────────────────────

  function notifyApprovals(chief) {
    if (!adapter.onApprovalsChanged || !chief) return;
    try {
      adapter.onApprovalsChanged(publicChief(chief), rules.pendingApprovals(approvals).filter((r) => r.chiefId === chief.chiefId));
    } catch (e) {
      log('warn', `approval notify failed: ${e.message}`);
    }
  }

  function requestApproval(chief, { action, target, summary, payload }) {
    const r = rules.requestApproval(approvals, { id: `ap-${crypto.randomBytes(6).toString('hex')}`, action, target, summary, payload, chiefId: chief.chiefId, at: Date.now() });
    approvals = rules.pruneApprovals(r.state);
    const record = r.record;
    const decided = new Promise((resolve) => approvalWaiters.set(record.id, [resolve]));
    notifyApprovals(chief);
    return { record, decided };
  }

  /** The user (or a second desktop) decided. First decision wins. */
  function decide(approvalId, { decision, text = null } = {}) {
    const r = rules.decideApproval(approvals, approvalId, { decision, text, at: Date.now() });
    if (!r.changed) return { ok: false, record: r.record || null };
    approvals = r.state;
    const waiters = approvalWaiters.get(approvalId) || [];
    approvalWaiters.delete(approvalId);
    for (const fn of waiters) fn(r.record);
    notifyApprovals(byChiefId.get(r.record.chiefId));
    return { ok: true, record: r.record };
  }

  function cancelWhere(pred, reason) {
    const c = rules.cancelApprovals(approvals, pred, { at: Date.now() });
    if (!c.changed) return;
    approvals = c.state;
    const touched = new Set();
    for (const rec of c.cancelled) {
      const waiters = approvalWaiters.get(rec.id) || [];
      approvalWaiters.delete(rec.id);
      for (const fn of waiters) fn({ ...rec, reason });
      touched.add(rec.chiefId);
    }
    for (const id of touched) notifyApprovals(byChiefId.get(id));
  }

  function pending(chiefId = null) {
    return rules.pendingApprovals(approvals).filter((r) => !chiefId || r.chiefId === chiefId);
  }

  // ─── tools ─────────────────────────────────────────────

  const registry = new Map();

  function register(name, def) {
    registry.set(name, { approval: true, ...def });
  }

  function toolDefinitions() {
    return [...registry.entries()].map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema }));
  }

  register('terminals_list', {
    approval: false,
    description: 'List every terminal of this project on this machine (main and all workspaces) with its agent and status: ready, working, approval, busy, unknown or ended.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(chief) {
      const orch = orchestrationSet(chief.projectPath);
      return { machine: machineLabel || machine, mode: getMode(chief.projectPath), terminals: inScope(chief).map((t) => describe(t, orch)) };
    }
  });

  register('terminal_read', {
    approval: false,
    description: 'Read one terminal: its visible screen as plain text and, for a Claude session, a short summary of recent activity (prompts, replies, tools, files). Compact by default.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Terminal id from terminals_list' },
        lines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES, description: `Screen lines from the bottom (default ${DEFAULT_READ_LINES})` },
        mode: { type: 'string', enum: ['screen', 'activity', 'both'], description: 'What to return (default both)' }
      },
      required: ['id'],
      additionalProperties: false
    },
    async run(chief, args) {
      const t = findInScope(chief, args.id);
      if (!t) return { error: 'not-found', reason: 'No such terminal in this project on this machine.' };
      const mode = ['screen', 'activity', 'both'].includes(args.mode) ? args.mode : 'both';
      const lines = Math.max(1, Math.min(MAX_READ_LINES, Number(args.lines) || DEFAULT_READ_LINES));
      const out = describe(t, orchestrationSet(chief.projectPath));
      if (mode !== 'activity') {
        let screen = null;
        try { screen = await adapter.readScreen(t.id, lines); } catch (_) { screen = null; }
        out.screen = screen;
      }
      if (mode !== 'screen') out.activity = await activityOf(t.id);
      return out;
    }
  });

  register('terminal_send', {
    approval: true,
    description: 'Send one message to a terminal as if the user typed it there. It is delivered when the agent there is ready (queued while it works). In user-guided mode the user approves it first. Refused for a conductor lane, a terminal waiting on the user, an unknown status, or a program that is not waiting for input.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Terminal id from terminals_list' },
        text: { type: 'string', description: 'The message, written for the agent in that terminal' },
        wait: { type: 'integer', minimum: 0, maximum: MAX_WAIT_S, description: `Seconds to wait for approval and delivery before returning (default ${DEFAULT_SEND_WAIT_S})` }
      },
      required: ['id', 'text'],
      additionalProperties: false
    },
    async run(chief, args) {
      const t = findInScope(chief, args.id);
      const text = typeof args.text === 'string' ? args.text : '';
      const target = t ? { id: t.id, ...statusOf(t.id), pasteMode: !!adapter.pasteMode(t.id) } : (args.id === chief.chiefId ? { id: chief.chiefId } : null);
      const refusal = rules.sendRefusal(target, { chiefId: chief.chiefId, inScope: !!t, orchestrationIds: orchestrationSet(chief.projectPath), text });
      if (refusal) return { outcome: 'refused', code: refusal.code, reason: refusal.reason };

      const waitMs = Math.max(0, Math.min(MAX_WAIT_S, args.wait === undefined ? DEFAULT_SEND_WAIT_S : Number(args.wait) || 0)) * 1000;
      const deadline = Date.now() + waitMs;
      const timeLeft = () => Math.max(0, deadline - Date.now());
      const within = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);

      let finalText = text;
      if (rules.needsApproval(registry.get('terminal_send'), getMode(chief.projectPath))) {
        const label = t.name || t.id;
        const { record, decided } = requestApproval(chief, {
          action: 'terminal_send',
          target: t.id,
          summary: `Send to ${label}${t.workspace && t.workspace !== 'main' ? ` (${t.workspace})` : ''}`,
          payload: { text, workspace: t.workspace || 'main', name: t.name || null }
        });
        const rec = await within(decided, timeLeft());
        if (!rec) {
          // Still undecided: deliver later if approved, but tell the Chief now.
          decided.then((r) => { if (r.status === 'approved' || r.status === 'edited') enqueueDelivery(chief, t.id, r.status === 'edited' ? r.text : text); });
          return { outcome: 'pending_approval', approval: record.id, reason: 'Waiting for the user to approve in Frame. Do not resend.' };
        }
        if (rec.status === 'rejected') return { outcome: 'rejected', reason: 'The user rejected this message.' };
        if (rec.status === 'cancelled') return { outcome: 'cancelled', reason: rec.reason || 'The approval was cancelled.' };
        if (rec.status === 'edited') finalText = rec.text;
        if (!finalText || !finalText.trim()) return { outcome: 'rejected', reason: 'The user cleared the message.' };
      }

      const item = enqueueDelivery(chief, t.id, finalText);
      const res = await within(item.done, timeLeft());
      if (!res) return { outcome: 'queued', reason: 'The terminal is busy; it goes out when the agent there is ready.', ...(finalText !== text ? { deliveredText: finalText } : {}) };
      return { ...res, ...(finalText !== text ? { deliveredText: finalText } : {}) };
    }
  });

  register('terminal_wait', {
    approval: false,
    description: 'Wait until a terminal stops working (its agent is ready, waiting on the user, or it ended), or until the timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Terminal id from terminals_list' },
        seconds: { type: 'integer', minimum: 1, maximum: MAX_WAIT_S, description: `Timeout in seconds (max ${MAX_WAIT_S})` }
      },
      required: ['id', 'seconds'],
      additionalProperties: false
    },
    async run(chief, args) {
      const t = findInScope(chief, args.id);
      if (!t) return { error: 'not-found', reason: 'No such terminal in this project on this machine.' };
      const until = Date.now() + Math.max(1, Math.min(MAX_WAIT_S, Number(args.seconds) || 30)) * 1000;
      const busy = (s) => s === rules.STATUS.WORKING || s === rules.STATUS.BUSY;
      let s = statusOf(t.id);
      while (busy(s.status) && Date.now() < until && !stopped) {
        await sleep(POLL_MS);
        s = statusOf(t.id);
      }
      return { id: t.id, status: s.status, ...(s.kind ? { kind: s.kind } : {}), timedOut: busy(s.status) };
    }
  });

  // ─── Chief lifecycle ───────────────────────────────────

  function publicChief(chief) {
    return { chiefId: chief.chiefId, projectPath: chief.projectPath, machine };
  }

  /** Copy lead-mcp.js + leadProtocol.js out of the app (asar) so a plain node can run them. */
  function materialize() {
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const mcp = path.join(runDir, 'lead-mcp.js');
    fs.writeFileSync(mcp, fs.readFileSync(path.join(TEMPLATE_DIR, 'lead-mcp.js')));
    fs.writeFileSync(path.join(runDir, 'leadProtocol.js'), fs.readFileSync(PROTOCOL_FILE));
    return mcp;
  }

  /**
   * Register a Chief terminal and return the command that starts its Claude
   * session: `claude --mcp-config <file> --allowedTools 'mcp__frame-lead__*'`.
   * A Chief already registered for the terminal gets a fresh token (a restart).
   */
  async function startChief({ chiefId, projectPath, platform = process.platform } = {}) {
    if (!chiefId || !projectPath) throw new Error('startChief needs chiefId and projectPath');
    stopChief(chiefId, { reason: 'The Chief restarted.' });
    const sock = await ensureServer();
    const mcp = materialize();
    const token = proto.generateToken();
    const chief = { token, chiefId, projectPath };
    chiefs.set(token, chief);
    byChiefId.set(chiefId, chief);
    const config = {
      mcpServers: {
        [MCP_SERVER_KEY]: {
          type: 'stdio',
          command: nodePath,
          args: [mcp],
          env: { ELECTRON_RUN_AS_NODE: '1', FRAME_LEAD_SOCKET: sock, FRAME_LEAD_TOKEN: token }
        }
      }
    };
    const configFile = path.join(runDir, `lead-${String(chiefId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    try { fs.chmodSync(configFile, 0o600); } catch (_) { /* Windows */ }
    const command = `claude --mcp-config ${shellQuote(configFile, platform)} --allowedTools ${shellQuote(ALLOWED_TOOLS, platform)}`;
    log('info', `Chief ${chiefId} registered for ${projectPath} on ${machine}`);
    return { command, configFile, mode: getMode(projectPath) };
  }

  /** Forget a Chief: its token stops working, its approvals and queued sends are cancelled. */
  function stopChief(chiefId, { reason = 'The Chief stopped.' } = {}) {
    const chief = byChiefId.get(chiefId);
    if (!chief) return false;
    chiefs.delete(chief.token);
    byChiefId.delete(chiefId);
    cancelWhere((r) => r.chiefId === chiefId, reason);
    for (const [targetId, items] of queues) {
      const keep = items.filter((it) => it.chiefId !== chiefId);
      for (const it of items) if (it.chiefId === chiefId) settle(it, { outcome: 'cancelled', reason });
      if (keep.length) queues.set(targetId, keep); else queues.delete(targetId);
    }
    try { fs.unlinkSync(path.join(runDir, `lead-${String(chiefId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`)); } catch (_) { /* gone */ }
    return true;
  }

  /** A terminal went away: drop its queue and cancel approvals aimed at it (or made by it, if it was a Chief). */
  function terminalGone(terminalId) {
    if (byChiefId.has(terminalId)) stopChief(terminalId, { reason: 'The Chief terminal closed.' });
    cancelWhere((r) => r.target === terminalId, 'The target terminal closed.');
    const d = rules.dropTarget(queues, terminalId);
    queues = d.queues;
    for (const it of d.dropped) settle(it, { outcome: 'cancelled', reason: 'The terminal closed.' });
  }

  function chiefsFor(projectPath) {
    return [...byChiefId.values()].filter((c) => !projectPath || c.projectPath === projectPath).map(publicChief);
  }

  function close() {
    stopped = true;
    for (const id of [...byChiefId.keys()]) stopChief(id, { reason: 'Frame is shutting down.' });
    if (server) {
      try { server.close(); } catch (_) { /* closed */ }
      server = null;
    }
    if (socketPath && process.platform !== 'win32') try { fs.unlinkSync(socketPath); } catch (_) { /* gone */ }
  }

  return {
    startChief,
    stopChief,
    terminalGone,
    chiefsFor,
    decide,
    pending,
    getMode,
    setMode,
    register, // the work-queue spec adds tools here (D19)
    toolDefinitions,
    close,
    get socketPath() { return socketPath; },
    // tests / diagnostics
    _handle: handle,
    _chiefForToken: chiefForToken
  };
}

module.exports = { createLeadHost, shellQuote, ALLOWED_TOOLS, MCP_SERVER_KEY, INSTRUCTIONS_LIMIT };
