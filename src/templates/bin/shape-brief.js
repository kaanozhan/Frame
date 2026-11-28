#!/usr/bin/env node
/**
 * Frame shape-brief command.
 *
 * Run by the agent in a Shape lane to write the parts the user approved onto a
 * Frame Cloud work brief. Frame stages this file in its own userData folder
 * (`cloud-shapes/shape-brief.js`) and names it by absolute path in the lane's
 * prompt, so a connected folder need not be a Frame project and nothing is
 * written into the user's repo:
 *
 *   ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE" <this file> --shape <id> <<'FRAME_PARTS'
 *   [{ "title": "…", "key": "…", "shape": "spec", "type": "feature", "definition": "…" }, …]
 *   FRAME_PARTS
 *
 * The parts come on stdin as one JSON array; a JSON string holds no raw
 * newline, so no line of a definition can end the heredoc. The command
 * publishes one request in `bus/` beside this file (tmp + rename, so the
 * watcher only ever sees a complete file), waits up to 30 s for Frame's reply
 * in `bus/replies/`, prints it and exits 0 when shaped, 1 otherwise. It
 * carries only the shape id Frame issued; the brief, the project and the token
 * stay in Frame.
 *
 * Self-contained on purpose: it runs from userData, outside app.asar, so the
 * part checks below are copies of cloudShape.js's (Frame checks again and
 * trusts nothing). The bus protocol is record-discussion.js's. Everything
 * above `run()` is pure.
 *
 * Node 18, no dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TITLE_MAX = 200;
const DEFINITION_MAX = 10000;
// A part's optional key (FrameCloud `briefPartKeySchema`): kebab-case, at most 40.
const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_MAX = 40;
const SHAPES = ['spec', 'task'];
const TYPES = ['feature', 'fix', 'refactor', 'docs', 'test'];
const WAIT_MS = 30000;
const POLL_MS = 200;
const ID_PATTERN = /^[0-9a-f]{24}$/;

const USAGE = 'Usage: shape-brief.js --shape <id> <<\'FRAME_PARTS\' <JSON array of parts> FRAME_PARTS';

// ─── Pure ─────────────────────────────────────────────────────

/** argv (after the script) → `{ ok, shapeId }` or `{ ok: false, message }`. */
function parseArgs(argv) {
  let shapeId = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--shape' && typeof value === 'string' && !value.startsWith('--')) {
      shapeId = value;
      i += 1;
    } else {
      return { ok: false, message: `Not shaped: unexpected argument ${JSON.stringify(arg)}. ${USAGE}` };
    }
  }
  if (!shapeId) return { ok: false, message: `Not shaped: --shape is required. ${USAGE}` };
  return { ok: true, shapeId };
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

/** The first bad part's sentence, or '' when the part is fine. `n` is its 1-based place. */
function partProblem(part, n) {
  const p = part && typeof part === 'object' && !Array.isArray(part) ? part : {};
  const title = str(p.title).trim();
  if (!title || title.length > TITLE_MAX) return `part ${n} needs a title between 1 and ${TITLE_MAX} characters.`;
  if (!SHAPES.includes(p.shape)) return `part ${n} needs a shape of ${SHAPES.join(' or ')}.`;
  if (!TYPES.includes(p.type)) return `part ${n} needs a type of ${TYPES.join(', ')}.`;
  const definition = str(p.definition).trim();
  if (!definition || definition.length > DEFINITION_MAX) return `part ${n} needs a definition between 1 and ${DEFINITION_MAX} characters.`;
  const key = str(p.key).trim();
  if (key && (key.length > KEY_MAX || !KEY_PATTERN.test(key))) {
    return `part ${n} needs a key in kebab-case (a-z, 0-9 and single hyphens) of at most ${KEY_MAX} characters, or none.`;
  }
  return '';
}

/**
 * The shape id + the stdin text → the bus request, or why not. The same
 * checks Frame makes, so the agent hears the reason at once instead of after
 * a round trip. → `{ ok: true, request }` or `{ ok: false, message }`.
 */
function requestFor({ shapeId, partsText, ts }) {
  if (!ID_PATTERN.test(String(shapeId))) {
    return { ok: false, message: 'Not shaped: the shape id is malformed. Copy the command from the prompt exactly.' };
  }
  let parts;
  try {
    parts = JSON.parse(String(partsText == null ? '' : partsText));
  } catch {
    return { ok: false, message: 'Not shaped: the parts are not valid JSON. Send one JSON array of parts between the FRAME_PARTS lines.' };
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    return { ok: false, message: 'Not shaped: send the parts as a JSON array with at least one part.' };
  }
  for (let i = 0; i < parts.length; i += 1) {
    const problem = partProblem(parts[i], i + 1);
    if (problem) return { ok: false, message: `Not shaped: ${problem}` };
  }
  const clean = parts.map((p) => {
    const part = { title: p.title.trim(), shape: p.shape, type: p.type, definition: p.definition.trim() };
    const key = str(p.key).trim();
    return key ? { ...part, key } : part;
  });
  return { ok: true, request: { shapeId, parts: clean, ts } };
}

// ─── The file protocol ────────────────────────────────────────

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function readReply(file) {
  try {
    const reply = JSON.parse(fs.readFileSync(file, 'utf8'));
    return reply && typeof reply === 'object' ? reply : null;
  } catch {
    return null; // not there yet
  }
}

/**
 * Publish the request, wait for the reply. `partsText` is the stdin text.
 * → `{ code, message }`; never throws.
 */
async function run({ argv, partsText, busDir, now = Date.now, waitMs = WAIT_MS, pollMs = POLL_MS }) {
  const args = parseArgs(argv);
  if (!args.ok) return { code: 1, message: args.message };
  const built = requestFor({ shapeId: args.shapeId, partsText, ts: now() });
  if (!built.ok) return { code: 1, message: built.message };

  const name = `${now()}-${crypto.randomBytes(4).toString('hex')}.json`;
  const requestFile = path.join(busDir, name);
  const replyFile = path.join(busDir, 'replies', name);
  try {
    fs.mkdirSync(path.join(busDir, 'replies'), { recursive: true });
    const tmp = `${requestFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(built.request));
    fs.renameSync(tmp, requestFile);
  } catch (err) {
    return { code: 1, message: `Not shaped: could not reach Frame's command bus (${err.code || err.message}).` };
  }

  const deadline = now() + waitMs;
  for (;;) {
    const reply = readReply(replyFile);
    if (reply) {
      try { fs.unlinkSync(replyFile); } catch { /* Frame cleans up */ }
      const message = typeof reply.message === 'string' && reply.message ? reply.message : 'Frame answered without a message.';
      return { code: reply.ok === true ? 0 : 1, message };
    }
    if (now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  // Withdraw the request. If it is already gone, Frame took it and may still shape the brief.
  try {
    fs.unlinkSync(requestFile);
  } catch {
    return {
      code: 1,
      message: 'Frame took the request but did not answer in time. The brief may still be shaped — check it in Frame before running this again.',
    };
  }
  return {
    code: 1,
    message: 'Not shaped: Frame did not answer. Make sure Frame is open and signed in to Frame Cloud, then run the command again.',
  };
}

if (require.main === module) {
  (async () => {
    const partsText = process.stdin.isTTY ? '' : await readAll(process.stdin);
    const { code, message } = await run({ argv: process.argv.slice(2), partsText, busDir: path.join(__dirname, 'bus') });
    (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(code);
  })();
}

module.exports = { WAIT_MS, parseArgs, requestFor, run };
