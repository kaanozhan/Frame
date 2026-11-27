/**
 * leadTranscript — what a Claude session has been doing, from its transcript
 * (lead-agent spec, T05; plan D16 / D20).
 *
 * Pure. The caller reads the transcript's tail (a few hundred KB, never the
 * whole file) and hands the parsed records here; the Chief gets a compact
 * summary — the last N events, files touched, the session's title — never the
 * transcript itself, so its own context stays small (D20).
 *
 * Record rules follow claudeSessionsManager: meta records, tool results,
 * harness scaffolding (`<command-name>`, `<system-reminder>`, caveats) and
 * sidechains (subagents) are not the session's story.
 */

const DEFAULT_EVENTS = 10;
const TEXT_EXCERPT = 280;

/** Tool inputs that name a file the tool read or changed. */
const FILE_KEYS = ['file_path', 'notebook_path', 'path'];
/** Tools whose file is a change, not just a read. */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function excerpt(text, n = TEXT_EXCERPT) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function isScaffolding(text) {
  const t = String(text || '').trim();
  return !t || t.startsWith('<') || t.startsWith('Caveat:');
}

/** The user's own words in a user record, or null. */
function userText(record) {
  if (record.isMeta) return null;
  const content = record.message && record.message.content;
  if (typeof content === 'string') return isScaffolding(content) ? null : content;
  if (!Array.isArray(content)) return null;
  if (content.some((p) => p && p.type === 'tool_result')) return null;
  const part = content.find((p) => p && p.type === 'text' && !isScaffolding(p.text));
  return part ? part.text : null;
}

function fileOf(input) {
  if (!input || typeof input !== 'object') return null;
  for (const k of FILE_KEYS) if (typeof input[k] === 'string' && input[k]) return input[k];
  return null;
}

function toolLabel(name, input) {
  const file = fileOf(input);
  if (file) return `${name} ${file}`;
  if (name === 'Bash' && input && typeof input.command === 'string') return `Bash: ${excerpt(input.command, 120)}`;
  if (input && typeof input.description === 'string') return `${name}: ${excerpt(input.description, 120)}`;
  return name;
}

/**
 * Records (oldest first) → `{ title, lastPrompt, events, filesChanged, filesRead, truncated }`.
 * events: `{ type: 'prompt'|'reply'|'tool', at, text }`, newest last, at most `maxEvents`.
 */
function summarize(records, { maxEvents = DEFAULT_EVENTS } = {}) {
  const events = [];
  const changed = new Set();
  const read = new Set();
  let title = null;
  let lastPrompt = null;
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'ai-title' && r.aiTitle) { title = r.aiTitle; continue; }
    if (r.type === 'summary' && r.summary) { title = title || r.summary; continue; }
    if (r.isSidechain) continue;
    const at = r.timestamp || null;
    if (r.type === 'user') {
      const text = userText(r);
      if (text) {
        lastPrompt = excerpt(text);
        events.push({ type: 'prompt', at, text: lastPrompt });
      }
      continue;
    }
    if (r.type !== 'assistant') continue;
    const content = r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part) continue;
      if (part.type === 'text' && part.text && part.text.trim()) {
        events.push({ type: 'reply', at, text: excerpt(part.text) });
      } else if (part.type === 'tool_use' && part.name) {
        const file = fileOf(part.input);
        if (file) (WRITE_TOOLS.has(part.name) ? changed : read).add(file);
        events.push({ type: 'tool', at, text: toolLabel(part.name, part.input) });
      }
    }
  }
  for (const f of changed) read.delete(f);
  const truncated = events.length > maxEvents;
  return {
    title,
    lastPrompt,
    events: truncated ? events.slice(-maxEvents) : events,
    filesChanged: [...changed],
    filesRead: [...read].slice(-20),
    truncated
  };
}

/**
 * JSON lines → records. A tail read starts mid-line, so the first line is
 * dropped when `fromMiddle`; unparsable lines are skipped.
 */
function parseLines(text, { fromMiddle = false } = {}) {
  const lines = String(text || '').split('\n');
  if (fromMiddle) lines.shift();
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) { /* partial or foreign line */ }
  }
  return out;
}

/**
 * The transcript path a Claude CLI's session file points to (plan D16
 * fallback). `~/.claude/sessions/<pid>.json` is internal to Claude Code —
 * observed, not documented — so anything unexpected returns null and only the
 * activity summary is lost.
 *
 * @param {object} sessionFile   parsed `<pid>.json` ({ pid, sessionId, cwd, … })
 * @param {string} projectsDir   `<claude config dir>/projects`
 * @param {(p:string)=>string} encodeProjectPath  claudeSessionsManager's encoder
 * @param {(...p:string[])=>string} join          path.join
 */
function transcriptPathFromSession(sessionFile, { projectsDir, encodeProjectPath, join }) {
  if (!sessionFile || typeof sessionFile !== 'object') return null;
  const { sessionId, cwd } = sessionFile;
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  if (typeof cwd !== 'string' || !cwd) return null;
  if (!projectsDir || typeof encodeProjectPath !== 'function' || typeof join !== 'function') return null;
  return join(projectsDir, encodeProjectPath(cwd), `${sessionId}.jsonl`);
}

module.exports = { DEFAULT_EVENTS, summarize, parseLines, transcriptPathFromSession, userText };
