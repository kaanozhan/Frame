// Supervisor task submitter (main) — Phase D.
//
// Posts to the supervisor monitor's `POST /api/queue/tasks` endpoint after a
// cheap id-collision check against `/api/workspace`. The server validates that
// both `profile` and `brief` resolve to existing paths under ROOT, so for
// Free-form mode (where the brief is a textarea) we materialise the text into
// <supervisorRoot>/prompts/inline/<id>-<ts>.md and submit that path.
//
// Returns the server's body verbatim on success (`{ok, task_id, path}`) or a
// uniform `{ok:false, error}` on transport / pre-flight failures so the
// renderer panel can show a single error surface.

const fs = require('fs');
const path = require('path');

const SUPERVISOR_API = 'http://127.0.0.1:8766';

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, ok: res.ok, body };
}

function collectIds(ws) {
  const out = new Set();
  const cols = (ws && ws.columns) || {};
  for (const k of ['pending', 'active', 'awaiting', 'done']) {
    for (const t of cols[k] || []) {
      if (t && t.id) out.add(t.id);
    }
  }
  return out;
}

async function idCollides(taskId) {
  try {
    const res = await fetchJson(`${SUPERVISOR_API}/api/workspace`);
    if (!res.ok || !res.body) return false;
    return collectIds(res.body).has(taskId);
  } catch {
    // If the workspace query fails we let the server be the source of truth —
    // its own queue/pending/<id>.yaml check will reject the duplicate.
    return false;
  }
}

function writeInlineBrief({ supervisorRoot, taskId, text }) {
  if (!supervisorRoot) {
    throw new Error('inline brief requires supervisorRoot');
  }
  const dir = path.join(supervisorRoot, 'prompts', 'inline');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${taskId}-${stamp}.md`;
  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, text, 'utf8');
  // Return both — main wants the absolute path for logging, server is happy
  // with either since it resolves relative paths under ROOT.
  return { absPath: abs, relPath: path.join('prompts', 'inline', filename) };
}

/**
 * Submit a task to the supervisor monitor.
 *
 * @param {object} payload
 * @param {string} payload.id             — `[A-Za-z0-9_.-]{1,80}`; server validates
 * @param {string} [payload.title]        — defaults to id server-side
 * @param {string} payload.profile        — path under ROOT (e.g. `profiles/solo.yaml`)
 * @param {string} [payload.brief]        — path under ROOT (From-file / Reuse modes)
 * @param {string} [payload.briefInline]  — raw brief text (Free-form mode)
 * @param {string} [payload.supervisorRoot] — required when briefInline is set
 * @param {string[]} [payload.depends_on]
 * @returns {Promise<{ok:boolean, task_id?:string, error?:string, path?:string}>}
 */
async function submit(payload) {
  if (!payload || !payload.id) return { ok: false, error: 'id is required' };
  if (!payload.profile) return { ok: false, error: 'profile is required' };

  // Materialise inline brief to a file under ROOT first; the server requires
  // brief to be a file path it can stat.
  let briefPath = payload.brief;
  if (!briefPath && payload.briefInline) {
    if (!payload.supervisorRoot) {
      return { ok: false, error: 'inline brief requires supervisorRoot' };
    }
    if (!payload.briefInline.trim()) {
      return { ok: false, error: 'brief is empty' };
    }
    try {
      const { relPath } = writeInlineBrief({
        supervisorRoot: payload.supervisorRoot,
        taskId: payload.id,
        text: payload.briefInline,
      });
      briefPath = relPath;
    } catch (err) {
      return { ok: false, error: `failed to write inline brief: ${err.message}` };
    }
  }
  if (!briefPath) return { ok: false, error: 'brief is required' };

  if (await idCollides(payload.id)) {
    return { ok: false, error: `task id "${payload.id}" already exists` };
  }

  const body = {
    id: payload.id,
    profile: payload.profile,
    brief: briefPath,
  };
  if (payload.title) body.title = payload.title;
  if (Array.isArray(payload.depends_on) && payload.depends_on.length) {
    body.depends_on = payload.depends_on;
  }

  try {
    const res = await fetchJson(`${SUPERVISOR_API}/api/queue/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.body) {
      return { ok: false, error: `monitor returned HTTP ${res.status} with empty body` };
    }
    if (res.body.ok) return res.body;
    return { ok: false, error: res.body.error || `monitor rejected (HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, error: `monitor unreachable: ${err.message}` };
  }
}

async function postNoBody(pathSegment) {
  try {
    const res = await fetchJson(`${SUPERVISOR_API}${pathSegment}`, { method: 'POST' });
    if (!res.body) {
      return { ok: false, error: `monitor returned HTTP ${res.status}` };
    }
    return res.body;
  } catch (err) {
    return { ok: false, error: `monitor unreachable: ${err.message}` };
  }
}

async function startDaemon() { return postNoBody('/api/queue/start'); }
async function stopDaemon() { return postNoBody('/api/queue/stop'); }

/**
 * Round-trip an escalation response. The server contract is
 * `POST /api/escalations/{id}/respond` with `{kind, answer}`.
 */
async function respondEscalation({ id, kind, answer }) {
  if (!id) return { ok: false, error: 'escalation id is required' };
  if (!['approve', 'edit', 'redirect'].includes(kind)) {
    return { ok: false, error: `unknown kind: ${kind}` };
  }
  try {
    const res = await fetchJson(`${SUPERVISOR_API}/api/escalations/${encodeURIComponent(id)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, answer: answer || '' }),
    });
    if (!res.body) {
      return { ok: false, error: `monitor returned HTTP ${res.status}` };
    }
    return res.body;
  } catch (err) {
    return { ok: false, error: `monitor unreachable: ${err.message}` };
  }
}

module.exports = {
  submit,
  startDaemon,
  stopDaemon,
  respondEscalation,
  SUPERVISOR_API,
};
