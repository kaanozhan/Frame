/**
 * cloudBriefs — the pure core of reading and creating Frame Cloud briefs.
 *
 * Reads a cloud project's briefs, one brief with its parts, attachments and
 * comments, its history, and the project's milestones. The writes are:
 * creating a brief (`brief.create`, then `brief.addAttachment` per link);
 * recording a discussion on a proposal (`brief.recordDiscussion`); moving a
 * proposal to work (`brief.decide`); shaping an open work brief into its
 * parts (`brief.shape`); marking a shaped brief started with each part's
 * local spec slug or task id (`brief.start`); reporting the branch a part was
 * begun on and the commit where it finished (`brief.recordBranch`,
 * `brief.recordCompletion`); and moving a started brief to Done and back
 * (`brief.moveToDone`, `brief.moveBackToActive`). Done is a person's move
 * since FrameCloud's brief-manual-done, which overturns frame-cloud-brief-done's
 * "a brief Done stays on the server". Every other brief or milestone mutation
 * — a part merged, dropped or linked — stays on the server or the web.
 *
 * A milestone is read whole (FrameCloud milestone-board, board-active-milestone):
 * its goal, end date, own target branch, when it started and closed, and its
 * briefs counted by status. An older server sends only id, name and status;
 * the rest then reads as null, and `briefs === null` is how the renderer tells
 * that apart from a milestone that simply has no end date. Milestones stay
 * read-only in Frame, so the core builds the milestone's web page
 * (buildMilestoneWebUrl) and writes nothing.
 *
 * Reads also carry what GitHub tracking adds (FrameCloud brief-github-tracking):
 * every brief names its project's `mergeTracking` (`ready`, `needs_github` or
 * `off`), and each part its pull request (`prNumber`, `prState`, `prBase`,
 * `prReview`, `prUrl`). A PR is a pointer the cloud keeps; only the cloud
 * decides a part is merged. The tracking setting changes only on the web, so
 * Frame builds its Settings link (buildSettingsWebUrl) and nothing else.
 *
 * Like cloudProjects.js, nothing here imports Electron or touches a file:
 * every call takes `{ api, token, fetchJson, signal }`, so
 * `cloudBriefsService.js` is a thin shell and `node --test` runs the whole
 * thing with a fake fetch. Each answer is reduced to the fields the Briefs
 * view draws, with unknown values folded to safe defaults, so the renderer
 * never meets a shape it did not expect.
 */

const { callTrpc } = require('./deviceFlow');
const { buildWebUrl } = require('./cloudProjects');

const KINDS = new Set(['proposal', 'work']);
const PRIORITIES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['backlog', 'active', 'done', 'closed']);
const PART_SHAPES = new Set(['spec', 'task']);
const PART_TYPES = new Set(['feature', 'fix', 'refactor', 'docs', 'test']);
const MILESTONE_STATUSES = new Set(['planned', 'started', 'closed']);
/** Whether the cloud can see the project's merges: GitHub connected, not yet, or tracking turned off. */
const MERGE_TRACKING = new Set(['ready', 'needs_github', 'off']);
/** A part's pull request as the cloud last saw it, and its review. */
const PR_STATES = new Set(['open', 'closed', 'merged']);
const PR_REVIEWS = new Set(['requested', 'approved', 'changes_requested']);

/**
 * The server's limits (FrameCloud `BRIEF_TITLE_MAX`, `BRIEF_TEXT_MAX`,
 * `BRIEF_ATTACHMENT_TITLE_MAX`, `BRIEF_PROVIDER_MAX`).
 */
const LIMITS = Object.freeze({ title: 200, body: 10000, attachmentTitle: 200, provider: 40 });

/** Where Frame's New brief form sits among FrameCloud's brief sources: a person at a form. */
const CREATE_SOURCE = 'desk';

function str(value) {
  return typeof value === 'string' ? value : '';
}

/** A string, or null when absent or empty. */
function strOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function oneOf(set, value, fallback) {
  return set.has(value) ? value : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ─── Normalizing ──────────────────────────────────────────────

/** One `brief.list` entry, reduced to the fields Frame draws. */
function normalizeBrief(raw) {
  const b = obj(raw);
  const number = Number.isInteger(b.number) && b.number > 0 ? b.number : 0;
  return {
    id: str(b.id),
    number,
    kind: oneOf(KINDS, b.kind, 'proposal'),
    title: str(b.title),
    body: strOrNull(b.body),
    priority: PRIORITIES.has(b.priority) ? b.priority : null,
    milestoneId: strOrNull(b.milestoneId),
    targetBranch: str(b.targetBranch),
    status: oneOf(STATUSES, b.status, 'backlog'),
    closedAt: strOrNull(b.closedAt),
    closeReason: strOrNull(b.closeReason),
    droppedAt: strOrNull(b.droppedAt),
    dropReason: strOrNull(b.dropReason),
    recordedDecisionAt: strOrNull(b.recordedDecisionAt),
    shapedAt: strOrNull(b.shapedAt),
    startedAt: strOrNull(b.startedAt),
    mergeTracking: oneOf(MERGE_TRACKING, b.mergeTracking, 'ready'),
    // Manual Done (FrameCloud brief-manual-done): status still places the
    // card; these date and explain a Done brief, and `readyForDone` says every
    // live part is merged. A brief moved Done before that change has no
    // `doneBy`.
    doneAt: strOrNull(b.doneAt),
    doneBy: strOrNull(b.doneBy),
    doneReason: strOrNull(b.doneReason),
    readyForDone: b.readyForDone === true,
    createdAt: str(b.createdAt),
    updatedAt: str(b.updatedAt),
  };
}

function normalizePart(raw) {
  const p = obj(raw);
  return {
    id: str(p.id),
    position: Number.isInteger(p.position) ? p.position : 0,
    title: str(p.title),
    shape: oneOf(PART_SHAPES, p.shape, 'task'),
    type: oneOf(PART_TYPES, p.type, 'feature'),
    definition: str(p.definition),
    key: strOrNull(p.key),
    recordRef: strOrNull(p.recordRef),
    // Done (FrameCloud brief-done): the branch the part was begun on, the
    // commit where it finished, and the merge or drop the cloud recorded.
    branch: strOrNull(p.branch),
    completionSha: strOrNull(p.completionSha),
    mergedAt: strOrNull(p.mergedAt),
    mergedBase: strOrNull(p.mergedBase),
    droppedAt: strOrNull(p.droppedAt),
    dropReason: strOrNull(p.dropReason),
    // GitHub tracking (FrameCloud brief-github-tracking): the part's pull
    // request. An older server sends none of these. The URL is kept only when
    // it is http(s), since Frame opens it as it is and never builds one.
    prNumber: Number.isInteger(p.prNumber) && p.prNumber > 0 ? p.prNumber : null,
    prState: PR_STATES.has(p.prState) ? p.prState : null,
    prBase: strOrNull(p.prBase),
    prReview: PR_REVIEWS.has(p.prReview) ? p.prReview : null,
    prUrl: typeof p.prUrl === 'string' && isHttpUrl(p.prUrl) ? p.prUrl : null,
  };
}

function normalizeAttachment(raw) {
  const a = obj(raw);
  return { id: str(a.id), title: str(a.title), url: str(a.url) };
}

function normalizeComment(raw) {
  const c = obj(raw);
  return { id: str(c.id), authorId: str(c.authorId), text: str(c.text), createdAt: str(c.createdAt) };
}

/** `brief.getByNumber` → the brief with its parts (by position), attachments and comments. */
function normalizeBriefDetail(raw) {
  const d = obj(raw);
  return {
    ...normalizeBrief(d),
    parts: arr(d.parts).map(normalizePart).filter((p) => p.id).sort((a, b) => a.position - b.position),
    attachments: arr(d.attachments).map(normalizeAttachment).filter((a) => a.id),
    comments: arr(d.comments).map(normalizeComment).filter((c) => c.id),
  };
}

function normalizeEvent(raw) {
  const e = obj(raw);
  return { id: str(e.id), at: str(e.at), actorId: str(e.actorId), event: str(e.event), data: obj(e.data) };
}

/** A calendar date as `YYYY-MM-DD` that names a real day, or null. */
function calendarDateOrNull(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? value : null;
}

const MILESTONE_COUNT_KEYS = ['backlog', 'active', 'done', 'closed'];

/**
 * A milestone's briefs by status, or null unless all four counts are
 * non-negative integers: an older server sends none, and a half-read count
 * would draw a wrong bar.
 */
function milestoneCounts(value) {
  const c = obj(value);
  if (!MILESTONE_COUNT_KEYS.every((k) => Number.isInteger(c[k]) && c[k] >= 0)) return null;
  return { backlog: c.backlog, active: c.active, done: c.done, closed: c.closed };
}

/** One `milestone.list` entry, reduced to the fields Frame draws. */
function normalizeMilestone(raw) {
  const m = obj(raw);
  return {
    id: str(m.id),
    name: str(m.name),
    status: oneOf(MILESTONE_STATUSES, m.status, 'planned'),
    goal: strOrNull(m.goal),
    targetDate: calendarDateOrNull(m.targetDate),
    targetBranch: strOrNull(m.targetBranch),
    startedAt: strOrNull(m.startedAt),
    closedAt: strOrNull(m.closedAt),
    briefs: milestoneCounts(m.briefs),
  };
}

// ─── Reading calls ────────────────────────────────────────────

/** `brief.list` → the project's briefs, server (`number`) order. Ended ones only with `includeClosed`. */
async function listBriefs({ api, token, fetchJson, signal, projectSlug, includeClosed }) {
  const input = { projectSlug };
  if (includeClosed) input.includeClosed = true;
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.list', method: 'GET', input });
  return arr(data).map(normalizeBrief).filter((b) => b.id && b.number);
}

/**
 * `milestone.list` → the project's milestones, server (`createdAt`) order,
 * each normalized (see normalizeMilestone): `{ id, name, status, goal,
 * targetDate, targetBranch, startedAt, closedAt, briefs }`.
 */
async function listMilestones({ api, token, fetchJson, signal, projectSlug }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'milestone.list', method: 'GET', input: { projectSlug } });
  return arr(data).map(normalizeMilestone).filter((m) => m.id);
}

/** `brief.getByNumber` → the detail. Throws CloudError (`BRIEF_NOT_FOUND` → notFound). */
async function getBrief({ api, token, fetchJson, signal, projectSlug, number }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'brief.getByNumber',
    method: 'GET',
    input: { projectSlug, number },
  });
  return normalizeBriefDetail(data);
}

/** `brief.events` → the brief's history, oldest first. */
async function briefEvents({ api, token, fetchJson, signal, id }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.events', method: 'GET', input: { id } });
  return arr(data).map(normalizeEvent).filter((e) => e.id && e.event);
}

// ─── Creating ─────────────────────────────────────────────────

function badRequest(field) {
  return { ok: false, reason: 'badRequest', field };
}

/**
 * The renderer's request → the `brief.create` input, minus `projectSlug`.
 * Trims, sends priority only for work (medium unless given), leaves out an
 * empty body. → `{ ok: true, input }` or `{ ok: false, reason: 'badRequest', field }`.
 */
function buildCreateInput(request) {
  const r = obj(request);
  if (!KINDS.has(r.kind)) return badRequest('kind');
  const title = str(r.title).trim();
  if (!title || title.length > LIMITS.title) return badRequest('title');
  const body = str(r.body).trim();
  if (body.length > LIMITS.body) return badRequest('body');
  const input = { kind: r.kind, title, source: CREATE_SOURCE };
  if (body) input.body = body;
  if (r.kind === 'work') {
    if (r.priority === undefined || r.priority === null || r.priority === '') input.priority = 'medium';
    else if (PRIORITIES.has(r.priority)) input.priority = r.priority;
    else return badRequest('priority');
  }
  return { ok: true, input };
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
 * The request's links → `[{ title, url }]`, in order. Only `http(s)` URLs and
 * trimmed titles of 1–200 characters; one bad link refuses them all.
 */
function normalizeLinks(links) {
  if (links === undefined || links === null) return { ok: true, links: [] };
  if (!Array.isArray(links)) return badRequest('links');
  const out = [];
  for (const raw of links) {
    const l = obj(raw);
    const title = str(l.title).trim();
    const url = str(l.url).trim();
    if (!title || title.length > LIMITS.attachmentTitle || !isHttpUrl(url)) return badRequest('links');
    out.push({ title, url });
  }
  return { ok: true, links: out };
}

/** `brief.create` → the new brief, normalized. `input` is buildCreateInput's plus `projectSlug`. */
async function createBrief({ api, token, fetchJson, signal, input }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.create', method: 'POST', input });
  return normalizeBrief(data);
}

/** `brief.addAttachment` → the attachment, normalized. */
async function addAttachment({ api, token, fetchJson, signal, id, title, url }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'brief.addAttachment',
    method: 'POST',
    input: { id, title, url },
  });
  return normalizeAttachment(data);
}

/**
 * Create a brief, then attach its links one by one. `call` is
 * cloudProjectsService's wrapper (`fn → { ok, value } | { ok: false, reason }`).
 * A failed create sends no link; the first failed link stops the rest.
 * → `{ ok: true, number, attachmentError: reason | null }` or `{ ok: false, reason }`.
 */
async function createWithLinks(call, { input, links = [] }) {
  const created = await call((ctx) => createBrief({ ...ctx, input }));
  if (!created.ok) return { ok: false, reason: created.reason };
  const { id, number } = created.value;
  if (!id || !number) return { ok: false, reason: 'other' };
  for (const link of links) {
    const attached = await call((ctx) => addAttachment({ ...ctx, id, title: link.title, url: link.url }));
    if (!attached.ok) return { ok: true, number, attachmentError: attached.reason };
  }
  return { ok: true, number, attachmentError: null };
}

// ─── Discussions ──────────────────────────────────────────────

/**
 * `brief.recordDiscussion` → the brief, normalized. Appends one
 * `discussion-recorded` event to an open proposal and writes no column; `url`
 * and `provider` are left out when absent. Throws CloudError
 * (`NOT_A_PROPOSAL`, `ALREADY_CLOSED`, `BRIEF_NOT_FOUND`).
 */
async function recordDiscussion({ api, token, fetchJson, signal, id, summary, url, provider }) {
  const input = { id, summary };
  if (url) input.url = url;
  if (provider) input.provider = provider;
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.recordDiscussion', method: 'POST', input });
  return normalizeBrief(data);
}

// ─── Deciding ─────────────────────────────────────────────────

/** The server's refusals of `brief.decide` → the reason Frame reports. */
const DECIDE_REFUSALS = {
  NOT_A_PROPOSAL: 'notAProposal',
  ALREADY_WORK: 'alreadyWork',
  ALREADY_CLOSED: 'alreadyClosed',
  BRIEF_NOT_FOUND: 'notFound',
};

/** `brief.decide` → the brief, now work, normalized. Throws CloudError on a refusal. */
async function decideBrief({ api, token, fetchJson, signal, id, priority }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.decide', method: 'POST', input: { id, priority } });
  return normalizeBrief(data);
}

/**
 * Move a proposal to work with a priority through `call`. The refusals come
 * back as values, since `call` folds them all into one reason.
 * → `{ ok: true }` or `{ ok: false, reason }`.
 */
async function decideThrough(call, { id, priority }) {
  if (!PRIORITIES.has(priority)) return { ok: false, reason: 'badRequest' };
  const result = await call(async (ctx) => {
    try {
      await decideBrief({ ...ctx, id, priority });
      return { refused: null };
    } catch (err) {
      const refused = err && DECIDE_REFUSALS[err.message];
      if (refused) return { refused };
      throw err;
    }
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.value.refused) return { ok: false, reason: result.value.refused };
  return { ok: true };
}

// ─── Shaping ──────────────────────────────────────────────────

/**
 * `brief.shape` → the brief with its new parts, normalized. Writes every part
 * and `shapedAt` in one transaction on an open, unshaped work brief; `parts`
 * is `[{ title, shape, type, definition }]`, in order. Throws CloudError
 * (`NOT_WORK`, `ALREADY_CLOSED`, `ALREADY_SHAPED`, `BRIEF_NOT_FOUND`).
 */
async function shapeBrief({ api, token, fetchJson, signal, id, parts }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.shape', method: 'POST', input: { id, parts } });
  return normalizeBriefDetail(data);
}

// ─── Starting ─────────────────────────────────────────────────

/** The server's refusals of `brief.start` → the reason Frame reports. */
const START_REFUSALS = {
  NOT_WORK: 'notWork',
  ALREADY_CLOSED: 'alreadyClosed',
  NOT_SHAPED: 'notShaped',
  ALREADY_STARTED: 'alreadyStarted',
  PARTS_MISMATCH: 'partsMismatch',
  RECORD_REF_TAKEN: 'recordRefTaken',
  BRIEF_NOT_FOUND: 'notFound',
};

/**
 * `brief.start` → the brief detail, now started, normalized. Sets
 * `startedAt` once and links every part to its `recordRef`; `parts` is
 * `[{ partId, recordRef }]` and must name every part. Throws CloudError on a
 * refusal (see START_REFUSALS).
 */
async function startBrief({ api, token, fetchJson, signal, id, parts }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'brief.start', method: 'POST', input: { id, parts } });
  return normalizeBriefDetail(data);
}

/**
 * Start a brief through `call`. The refusals come back as values, since
 * `call` folds them all into one reason.
 * → `{ ok: true, detail }` or `{ ok: false, reason }`.
 */
async function startThrough(call, { id, parts }) {
  const result = await call(async (ctx) => {
    try {
      return { refused: null, detail: await startBrief({ ...ctx, id, parts }) };
    } catch (err) {
      const refused = err && START_REFUSALS[err.message];
      if (refused) return { refused };
      throw err;
    }
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.value.refused) return { ok: false, reason: result.value.refused };
  return { ok: true, detail: result.value.detail };
}

// ─── Done ─────────────────────────────────────────────────────

/**
 * `brief.recordBranch` → the brief detail, normalized. Records the branch a
 * part was begun on and the commit it was cut from (`baseSha`, 40 lowercase
 * hex). Replaces a live part's branch; a repeat of the stored values writes
 * nothing. Throws CloudError (`PART_DROPPED`, `PART_MERGED`, `NOT_STARTED`, …).
 */
async function recordBranch({ api, token, fetchJson, signal, id, partId, branch, baseSha }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'brief.recordBranch',
    method: 'POST',
    input: { id, partId, branch, baseSha },
  });
  return normalizeBriefDetail(data);
}

/**
 * `brief.recordCompletion` → the brief detail, normalized. Records the commit
 * where a part finished (`sha`, 40 lowercase hex); the cloud then checks it
 * against the brief's target. A repeat writes nothing. Throws CloudError
 * (`PART_DROPPED`, `NOT_STARTED`, …).
 */
async function recordCompletion({ api, token, fetchJson, signal, id, partId, sha }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'brief.recordCompletion',
    method: 'POST',
    input: { id, partId, sha },
  });
  return normalizeBriefDetail(data);
}

// ─── Moving to Done and back ──────────────────────────────────

/**
 * The server's refusals of `brief.moveToDone` and `brief.moveBackToActive` →
 * the reason Frame reports. `REASON_REQUIRED` means "ask the person"; every
 * other code is final, and Frame never retries it.
 */
const MOVE_REFUSALS = {
  REASON_REQUIRED: 'reasonRequired',
  NOT_STARTED: 'notStarted',
  ALREADY_DONE: 'alreadyDone',
  NOT_DONE: 'notDone',
  ALREADY_CLOSED: 'alreadyClosed',
  NOT_WORK: 'notWork',
  BRIEF_NOT_FOUND: 'notFound',
};

/** Where a move can go: Done, or back to Active. */
const MOVE_TARGETS = new Set(['done', 'active']);

/** The move's input: the id, and the trimmed reason unless it is blank (the server's "blank counts as absent"). */
function moveInput(id, reason) {
  const input = { id };
  const trimmed = str(reason).trim();
  if (trimmed) input.reason = trimmed;
  return input;
}

/**
 * `brief.moveToDone` → the brief detail, now Done, normalized. Asks GitHub
 * nothing; the reason is needed only when tracking is ready and a live part
 * is not merged. Throws CloudError on a refusal (see MOVE_REFUSALS).
 */
async function moveToDone({ api, token, fetchJson, signal, id, reason }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'brief.moveToDone',
    method: 'POST',
    input: moveInput(id, reason),
  });
  return normalizeBriefDetail(data);
}

/**
 * `brief.moveBackToActive` → the brief detail, Active again, normalized. The
 * server always wants a reason. Throws CloudError on a refusal (see
 * MOVE_REFUSALS).
 */
async function moveBackToActive({ api, token, fetchJson, signal, id, reason }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'brief.moveBackToActive',
    method: 'POST',
    input: moveInput(id, reason),
  });
  return normalizeBriefDetail(data);
}

/**
 * Move a brief to Done (`to: 'done'`) or back to Active (`to: 'active'`)
 * through `call`. The refusals come back as values, since `call` folds them
 * all into one reason. A move back with a blank reason is refused here as
 * `reasonRequired`, before anything is sent.
 * → `{ ok: true }` or `{ ok: false, reason }`.
 */
async function moveThrough(call, { id, to, reason }) {
  if (!MOVE_TARGETS.has(to)) return { ok: false, reason: 'badRequest' };
  if (to === 'active' && !str(reason).trim()) return { ok: false, reason: 'reasonRequired' };
  const send = to === 'done' ? moveToDone : moveBackToActive;
  const result = await call(async (ctx) => {
    try {
      await send({ ...ctx, id, reason });
      return { refused: null };
    } catch (err) {
      const refused = err && MOVE_REFUSALS[err.message];
      if (refused) return { refused };
      throw err;
    }
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.value.refused) return { ok: false, reason: result.value.refused };
  return { ok: true };
}

/**
 * From a brief's events (oldest first): how many discussions were recorded,
 * and how many comments someone other than `meId` added after the latest
 * record — none count as new while nothing was recorded.
 */
function discussionFacts(events, meId) {
  let discussionCount = 0;
  let newCommentCount = 0;
  for (const e of events) {
    if (e.event === 'discussion-recorded') {
      discussionCount += 1;
      newCommentCount = 0;
    } else if (e.event === 'comment-added' && discussionCount > 0 && e.actorId !== meId) {
      newCommentCount += 1;
    }
  }
  return { discussionCount, newCommentCount };
}

/**
 * The briefs with `discussionCount` and `newCommentCount` on each open
 * proposal, from its `brief.events` (the list does not carry them). `call` is
 * cloudProjectsService's wrapper; a proposal whose events fail to load gets
 * `null`s, never a failed board. Work and ended briefs get `null`s without a
 * request.
 */
async function addDiscussionCounts(call, briefs, meId = '') {
  const unknown = { discussionCount: null, newCommentCount: null };
  return Promise.all(briefs.map(async (brief) => {
    if (brief.kind !== 'proposal' || brief.status === 'closed') return { ...brief, ...unknown };
    const events = await call((ctx) => briefEvents({ ...ctx, id: brief.id }));
    return { ...brief, ...(events.ok ? discussionFacts(events.value, meId) : unknown) };
  }));
}

// ─── Part counts ──────────────────────────────────────────────

/** A brief's parts counted by shape: `{ spec, task }`. */
function partSummary(parts) {
  const out = { spec: 0, task: 0 };
  for (const p of arr(parts)) {
    if (p && (p.shape === 'spec' || p.shape === 'task')) out[p.shape] += 1;
  }
  return out;
}

/** A part as a card draws it: no definition, which only the detail shows. */
function partRow(part) {
  return {
    id: part.id,
    title: part.title,
    shape: part.shape,
    type: part.type,
    key: part.key,
    recordRef: part.recordRef,
    branch: part.branch,
    completionSha: part.completionSha,
    mergedAt: part.mergedAt,
    mergedBase: part.mergedBase,
    droppedAt: part.droppedAt,
    dropReason: part.dropReason,
    prNumber: part.prNumber,
    prState: part.prState,
    prBase: part.prBase,
    prReview: part.prReview,
    prUrl: part.prUrl,
  };
}

/**
 * The briefs with `partCounts` (`{ spec, task }`) and `parts` (each part's
 * row, see partRow, in order) on each open shaped work brief, from its
 * `brief.getByNumber`. `brief.list` now carries parts too, but without the
 * definition and only since FrameCloud's brief-done, so the board keeps
 * reading them here. `call` is cloudProjectsService's wrapper; a brief whose
 * detail fails to load gets `null`s, never a failed board. Every other brief
 * gets `null`s without a request.
 */
async function addPartCounts(call, briefs, projectSlug) {
  const none = { partCounts: null, parts: null };
  return Promise.all(briefs.map(async (brief) => {
    if (brief.kind !== 'work' || brief.status === 'closed' || !brief.shapedAt) return { ...brief, ...none };
    const detail = await call((ctx) => getBrief({ ...ctx, projectSlug, number: brief.number }));
    if (!detail.ok) return { ...brief, ...none };
    return { ...brief, partCounts: partSummary(detail.value.parts), parts: detail.value.parts.map(partRow) };
  }));
}

// ─── Tracking ─────────────────────────────────────────────────

/**
 * Whether the cloud can see the project's merges, from the listed briefs
 * (every brief carries its project's state): `needs_github` when any says so,
 * then `off`, else `ready`, which also covers no briefs.
 */
function mergeTrackingOf(briefs) {
  const listed = arr(briefs);
  if (listed.some((b) => b && b.mergeTracking === 'needs_github')) return 'needs_github';
  if (listed.some((b) => b && b.mergeTracking === 'off')) return 'off';
  return 'ready';
}

// ─── Web links ────────────────────────────────────────────────

/**
 * `{project url}/briefs/{number}` (the web's full brief page), or the project
 * URL when no number is given; null under buildWebUrl's guards.
 */
function buildBriefWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug, number } = {}) {
  const base = buildWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug });
  if (!base) return null;
  if (number === undefined || number === null) return base;
  return Number.isInteger(number) && number > 0 ? `${base}/briefs/${number}` : null;
}

/**
 * `{project url}/settings#github` (the project's Settings at its GitHub
 * section, where tracking is turned on or off); null under buildWebUrl's
 * guards.
 */
function buildSettingsWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug } = {}) {
  const base = buildWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug });
  return base ? `${base}/settings#github` : null;
}

/**
 * `{project url}/milestones/{id}` (the web's milestone page, route
 * `/$slug/$project/milestones/$milestoneId`), the id URL-encoded; null under
 * buildWebUrl's guards or for an empty id.
 */
function buildMilestoneWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug, milestoneId } = {}) {
  if (typeof milestoneId !== 'string' || !milestoneId) return null;
  const base = buildWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug });
  return base ? `${base}/milestones/${encodeURIComponent(milestoneId)}` : null;
}

module.exports = {
  LIMITS,
  normalizeBrief,
  normalizeBriefDetail,
  normalizeEvent,
  normalizeMilestone,
  listBriefs,
  listMilestones,
  getBrief,
  briefEvents,
  buildCreateInput,
  isHttpUrl,
  normalizeLinks,
  createBrief,
  addAttachment,
  createWithLinks,
  recordDiscussion,
  discussionFacts,
  addDiscussionCounts,
  partSummary,
  addPartCounts,
  decideBrief,
  decideThrough,
  shapeBrief,
  START_REFUSALS,
  startBrief,
  startThrough,
  recordBranch,
  recordCompletion,
  MOVE_REFUSALS,
  moveToDone,
  moveBackToActive,
  moveThrough,
  mergeTrackingOf,
  buildBriefWebUrl,
  buildSettingsWebUrl,
  buildMilestoneWebUrl,
};
