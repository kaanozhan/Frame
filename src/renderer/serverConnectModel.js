/**
 * serverConnectModel — the Connect dialog's state rules (server-hardening S12).
 *
 * Pure: the dialog (serverConnect.js) holds one model per saved server
 * (multi-server-connections) and draws the selected one. Progress
 * lines and the check-up are cleared when main reports that an install has
 * started (`installing`), never when a button is pressed — a second click on
 * a running install used to wipe its progress. One action runs at a time.
 */

function initial() {
  return { progressLines: [], doctor: null, doctorFor: null, inFlight: false };
}

/** Apply a status change from main. */
function onStatus(model, prev, next) {
  if (next && next.state === 'installing' && !(prev && prev.state === 'installing')) {
    return { ...model, progressLines: [], doctor: null, doctorFor: null };
  }
  return model;
}

/** Start an install / update / rollback: `{ allowed, model }`. */
function startAction(model) {
  if (model.inFlight) return { allowed: false, model };
  return { allowed: true, model: { ...model, inFlight: true } };
}

function endAction(model) {
  return { ...model, inFlight: false };
}

/** Whether the dialog's action buttons are disabled. */
function actionsDisabled(model, status) {
  return !!(model.inFlight || (status && status.state === 'installing'));
}

/**
 * The consent sentence before an update or rollback: the named agents, or —
 * when Frame could not list the server's terminals — a general warning
 * (server-hardening S9: unknown never reads as "none running").
 */
function consentText({ kind, agents, host }) {
  const verb = kind === 'rollback' ? 'Rolling back' : 'Updating';
  if (Array.isArray(agents)) {
    const n = agents.length;
    return `${n} agent${n === 1 ? ' is' : 's are'} running on ${host}. ${verb} restarts Frame Server and ends ${n === 1 ? 'its terminal' : 'their terminals'}; Claude Code and Codex can resume their sessions afterwards.`;
  }
  return `Frame could not list the terminals running on ${host}. ${verb} restarts Frame Server and ends any terminals and agents running there.`;
}

/**
 * The command a check-up item's "Open terminal" types into a server home
 * terminal (server-onboarding), or null when there is nothing to type: the
 * item is ready, has no fix, or its fix is not a single line.
 */
function fixTerminalFor(item) {
  if (!item || item.ok || typeof item.fix !== 'string') return null;
  const fix = item.fix.trim();
  if (!fix || /[\r\n]/.test(fix)) return null;
  return fix;
}

/** A fix terminal was opened: the next time the dialog opens, check again. */
function noteFixOpened(model) {
  return { ...model, recheckPending: true };
}

/** `{ recheck, model }`: whether this open should re-run the check-up, consuming the flag. */
function takeRecheck(model) {
  return { recheck: !!model.recheckPending, model: { ...model, recheckPending: false } };
}

// ─── Several servers (multi-server-connections) ──────────────

/**
 * The model of one server in a `{ [key]: model }` map: the dialog keeps one
 * per saved server, so one server's progress, check-up and in-flight action
 * never show on another's detail.
 */
function modelFor(models, key) {
  return (models && key && models[key]) || initial();
}

/** `models` with `key`'s model replaced. */
function withModel(models, key, model) {
  return { ...(models || {}), [key]: model };
}

/** `models` without the servers that are no longer listed. */
function pruneModels(models, keys) {
  const keep = new Set(keys || []);
  const out = {};
  for (const [k, v] of Object.entries(models || {})) if (keep.has(k)) out[k] = v;
  return out;
}

// Worst first: what the status bar's dot shows when several servers differ.
const SEVERITY = ['error', 'needs-install', 'needs-update', 'reconnecting', 'installing', 'connecting', 'connected'];

/**
 * The status bar's summary of the saved servers: `{ total, connected, state }`.
 * `state` is the worst state among servers that are not off (a server the user
 * disconnected does not turn the dot grey while another is connected), and
 * 'off' when every server is off. null when no server is saved.
 */
function summary(list) {
  const servers = Array.isArray(list) ? list : [];
  if (!servers.length) return null;
  const states = servers.map((s) => (s && s.status && s.status.state) || 'off');
  const live = states.filter((st) => st !== 'off');
  const state = live.length ? SEVERITY.find((st) => live.includes(st)) || live[0] : 'off';
  return { total: servers.length, connected: states.filter((st) => st === 'connected').length, state };
}

/** The server to show in the dialog: `wanted` if listed, else the first connected, else the first. */
function pickSelected(list, wanted) {
  const servers = Array.isArray(list) ? list : [];
  if (wanted && servers.some((s) => s.key === wanted)) return wanted;
  const up = servers.find((s) => s.status && s.status.state === 'connected');
  return (up || servers[0] || {}).key || null;
}

module.exports = {
  initial, onStatus, startAction, endAction, actionsDisabled, consentText, fixTerminalFor, noteFixOpened, takeRecheck,
  modelFor, withModel, pruneModels, summary, pickSelected
};
