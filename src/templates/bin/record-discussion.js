#!/usr/bin/env node
/**
 * Frame record-discussion command.
 *
 * Run by the agent in a Discuss lane to record a summary on a Frame Cloud
 * proposal. Frame stages this file in its own userData folder
 * (`cloud-discussions/record-discussion.js`) and names it by absolute path in
 * the lane's prompt, so a connected folder need not be a Frame project and
 * nothing is written into the user's repo:
 *
 *   ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE" <this file> --discussion <id> [--url <https link>] <<'FRAME_SUMMARY'
 *   <summary>
 *   FRAME_SUMMARY
 *
 * The summary comes on stdin. The command publishes one request in `bus/`
 * beside this file (tmp + rename, so the watcher only ever sees a complete
 * file), waits up to 30 s for Frame's reply in `bus/replies/`, prints it and
 * exits 0 when recorded, 1 otherwise. It carries only the discussion id Frame
 * issued; the brief, the project and the token stay in Frame.
 *
 * Self-contained on purpose: it runs from userData, outside app.asar, so the
 * shape checks below are copies of cloudDiscussions.js's (Frame checks again
 * and trusts nothing). Everything above `run()` is pure.
 *
 * Node 18, no dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUMMARY_MAX = 10000;
const WAIT_MS = 30000;
const POLL_MS = 200;
const ID_PATTERN = /^[0-9a-f]{24}$/;

const USAGE = 'Usage: record-discussion.js --discussion <id> [--url <https link>] <<\'FRAME_SUMMARY\' … FRAME_SUMMARY';

// ─── Pure ─────────────────────────────────────────────────────

/** argv (after the script) → `{ ok, discussionId, url }` or `{ ok: false, message }`. */
function parseArgs(argv) {
  const out = { discussionId: '', url: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if ((arg === '--discussion' || arg === '--url') && typeof value === 'string' && !value.startsWith('--')) {
      out[arg === '--discussion' ? 'discussionId' : 'url'] = value;
      i += 1;
    } else {
      return { ok: false, message: `Not recorded: unexpected argument ${JSON.stringify(arg)}. ${USAGE}` };
    }
  }
  if (!out.discussionId) return { ok: false, message: `Not recorded: --discussion is required. ${USAGE}` };
  return { ok: true, ...out };
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parsed args + the stdin text → the bus request, or why not. The same shape
 * Frame checks, so the agent hears the reason at once instead of after a
 * round trip. → `{ ok: true, request }` or `{ ok: false, message }`.
 */
function requestFor({ discussionId, url, summary, ts }) {
  if (!ID_PATTERN.test(String(discussionId))) {
    return { ok: false, message: 'Not recorded: the discussion id is malformed. Copy the command from the prompt exactly.' };
  }
  const text = String(summary == null ? '' : summary).trim();
  if (!text || text.length > SUMMARY_MAX) {
    return { ok: false, message: `Not recorded: the summary must be between 1 and ${SUMMARY_MAX} characters.` };
  }
  const request = { discussionId, summary: text, ts };
  if (url) {
    if (!isHttpUrl(url.trim())) return { ok: false, message: 'Not recorded: --url must be an http(s) link.' };
    request.url = url.trim();
  }
  return { ok: true, request };
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
 * Publish the request, wait for the reply. `summary` is the stdin text.
 * → `{ code, message }`; never throws.
 */
async function run({ argv, summary, busDir, now = Date.now, waitMs = WAIT_MS, pollMs = POLL_MS }) {
  const args = parseArgs(argv);
  if (!args.ok) return { code: 1, message: args.message };
  const built = requestFor({ ...args, summary, ts: now() });
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
    return { code: 1, message: `Not recorded: could not reach Frame's command bus (${err.code || err.message}).` };
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

  // Withdraw the request. If it is already gone, Frame took it and may still record it.
  try {
    fs.unlinkSync(requestFile);
  } catch {
    return {
      code: 1,
      message: 'Frame took the request but did not answer in time. It may still be recorded — check the brief in Frame before running this again.',
    };
  }
  return {
    code: 1,
    message: 'Not recorded: Frame did not answer. Make sure Frame is open and signed in to Frame Cloud, then run the command again.',
  };
}

if (require.main === module) {
  (async () => {
    const summary = process.stdin.isTTY ? '' : await readAll(process.stdin);
    const { code, message } = await run({ argv: process.argv.slice(2), summary, busDir: path.join(__dirname, 'bus') });
    (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(code);
  })();
}

module.exports = { WAIT_MS, parseArgs, requestFor, run };
