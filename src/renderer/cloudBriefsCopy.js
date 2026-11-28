/**
 * cloudBriefsCopy — the words the cloud Briefs view says.
 *
 * A port of Frame Cloud's `apps/web/src/lib/brief.ts` (and the column copy of
 * `brief-board.tsx`, `new-brief-dialog.tsx` and `ai-links.tsx`), so a brief
 * reads the same in Frame as on the web: the columns a list falls into, the
 * words for kinds, priorities and ending facts, the history as sentences, and
 * the New brief form. Ported rather than shared — Frame takes no dependency on
 * the web app — and pure: no DOM, no Electron, so `node --test` covers it.
 *
 * Creating, discussing, shaping, starting and moving a brief to Done and back
 * are the writes: the web's other write copy (Transform to Work, refusal
 * sentences for other mutations, search params) is left out.
 *
 * Done is a person's move (FrameCloud brief-manual-done, from `lib/brief.ts`
 * and `brief-move.tsx`): this overturns frame-cloud-brief-done's "Done means
 * merged" and "the Done column fills on its own". The rules that decide
 * whether a move asks for a reason (`missingParts`, `needsReason`) live here,
 * as on the web; the server enforces the same rule from its stored facts.
 *
 * A write the workspace role cannot make (`roleForbidden`, refused in main or
 * by the server) reads the one role sentence from cloudRoles in every table.
 *
 * GitHub tracking (FrameCloud brief-github-tracking, the web's `partRow`): while
 * the project's tracking is `ready`, a part's pull request takes its row —
 * "PR #N · Open / In review / Approved / Changes requested", or "Merged into
 * <base>, not <target>" — unless a live agent lane is working on it. A PR is
 * a pointer, never a merge: only the cloud's `mergedAt` counts. The history
 * reads `part-merged` as the web does, an observation with no actor.
 *
 * Milestones (FrameCloud board-active-milestone, from `lib/milestone.ts` and
 * `board-milestone.tsx`): the project's started milestone, the briefs under
 * it, its progress (done over backlog + active + done; ended briefs are
 * outside it), Overdue (a started milestone past its end date with briefs
 * left, on the viewer's local day), its end date and target branch as the
 * web words them. Frame's counts come from the board's own briefs, held moves
 * included, so they follow a Move to Done. A milestone from an older server
 * carries no counts (`briefs === null`) and reads as its name alone. Read-only:
 * Frame starts, closes and edits no milestone.
 */

const { ROLE_FORBIDDEN } = require('./cloudRoles');
const { toSlug, uniquify } = require('../shared/workspaceNames');

/**
 * The board's open columns, in order. A brief lands in one by its status:
 * Active on its own once work starts, Done by a person's move.
 */
const COLUMNS = [
  { status: 'backlog', title: 'Backlog' },
  { status: 'active', title: 'Active', hint: 'A brief moves here on its own once work starts on a machine.' },
  { status: 'done', title: 'Done', hint: 'Move a brief here when its work is finished.' },
];

/** A list grouped by status, each group keeping the list's order. Unknown statuses fall into Backlog. */
function groupByColumn(briefs) {
  const groups = { backlog: [], active: [], done: [], closed: [] };
  for (const brief of Array.isArray(briefs) ? briefs : []) {
    (groups[brief && brief.status] || groups.backlog).push(brief);
  }
  return groups;
}

/** The two kinds as the user sees them. */
const KIND_COPY = {
  proposal: {
    label: 'Proposal',
    badge: 'PROPOSAL',
    explanation:
      'An idea not decided yet. You can discuss it with an AI agent and turn it into work once it is worth doing.',
  },
  work: {
    label: 'Work',
    badge: 'WORK',
    explanation:
      'Work that has been decided on. An AI agent shapes it: it reads the brief and the code, decides whether it becomes one spec, several specs or a task, and writes those parts. Then they run.',
  },
};

const STATUS_LABELS = { backlog: 'Backlog', active: 'Active', done: 'Done', closed: 'Closed' };

function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.backlog;
}

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

function isPriority(value) {
  return value === 'high' || value === 'medium' || value === 'low';
}

/** 'High' / 'Medium' / 'Low', or '' for anything else. */
function priorityLabel(priority) {
  return PRIORITY_LABELS[priority] || '';
}

/** How a closed brief ended — `{ label, reason, at }` — or null for an open one. Close wins over drop over decision. */
function endingFact(brief) {
  const b = brief || {};
  if (b.closedAt) return { label: 'Closed', reason: b.closeReason || null, at: b.closedAt };
  if (b.droppedAt) return { label: 'Dropped', reason: b.dropReason || null, at: b.droppedAt };
  if (b.recordedDecisionAt) return { label: 'Recorded as decision', reason: null, at: b.recordedDecisionAt };
  return null;
}

/** The ending as one line: "Closed: reason", "Dropped", "Recorded as decision"; '' for an open brief. */
function endingLine(brief) {
  const ending = endingFact(brief);
  if (!ending) return '';
  return ending.reason ? `${ending.label}: ${ending.reason}` : ending.label;
}

/** "You" for the caller, "A workspace member" for anyone else: there is no member list. */
function actorLabel(id, meId) {
  return id && meId && id === meId ? 'You' : 'A workspace member';
}

const DATE_FORMAT = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

/** An ISO timestamp as "18 Sept 2026" in the viewer's time zone; '' when missing or unreadable. */
function formatDate(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** "a", "a and b", "a, b and c". */
function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What happened, without who or when. `data` is whatever that event's write recorded. */
function eventAction(event, meId) {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  switch (event.event) {
    case 'created':
      if (data.kind !== 'work') return 'created this brief as a proposal';
      return isPriority(data.priority)
        ? `created this brief as work with ${priorityLabel(data.priority).toLowerCase()} priority`
        : 'created this brief as work';
    case 'decided':
      return isPriority(data.priority)
        ? `transformed this proposal to work with ${priorityLabel(data.priority).toLowerCase()} priority`
        : 'transformed this proposal to work';
    case 'shaped': {
      const count = Number.isInteger(data.count) && data.count >= 0 ? data.count : 0;
      return `shaped this brief into ${count} ${count === 1 ? 'part' : 'parts'}`;
    }
    case 'started': {
      const count = Number.isInteger(data.count) && data.count >= 0 ? data.count : 0;
      return `started work on this brief's ${count} ${count === 1 ? 'part' : 'parts'}`;
    }
    case 'dropped': {
      const reason = text(data.reason);
      return reason ? `dropped this proposal: ${reason}` : 'dropped this proposal';
    }
    case 'decision-recorded':
      return 'recorded this proposal as a decision';
    case 'discussion-recorded': {
      // `provider` is free text the caller sent, so it reads as it was written.
      const provider = text(data.provider);
      return provider ? `recorded a discussion held with ${provider}` : 'recorded a discussion';
    }
    case 'updated': {
      const changes = [];
      if ('title' in data) changes.push('the title');
      if ('body' in data) changes.push('the description');
      if (isPriority(data.priority)) changes.push(`the priority to ${priorityLabel(data.priority).toLowerCase()}`);
      const branch = text(data.targetBranch);
      if (branch) changes.push(`the target branch to ${branch}`);
      return changes.length > 0 ? `changed ${joinList(changes)}` : 'saved this brief unchanged';
    }
    case 'part-added': {
      const title = text(data.title);
      return title ? `added the part “${title}”` : 'added a part';
    }
    case 'part-updated':
      return 'edited a part';
    case 'part-removed': {
      const title = text(data.title);
      return title ? `removed the part “${title}”` : 'removed a part';
    }
    case 'parts-reordered':
      return 'reordered the parts';
    case 'attachment-added': {
      const title = text(data.title);
      return title ? `attached “${title}”` : 'added an attachment';
    }
    case 'attachment-removed': {
      const title = text(data.title);
      return title ? `removed the attachment “${title}”` : 'removed an attachment';
    }
    case 'comment-added':
      return 'commented';
    case 'closed': {
      const reason = text(data.reason);
      return reason ? `closed this work: ${reason}` : 'closed this work';
    }
    case 'reopened':
      if (data.ended === 'dropped') return 'reopened this dropped proposal';
      if (data.ended === 'recorded') return 'reopened this proposal recorded as a decision';
      return 'reopened this work';
    case 'milestone-set':
      return text(data.milestoneId) ? 'moved this brief into a milestone' : 'took this brief out of its milestone';
    case 'assignee-set': {
      const assignee = text(data.assigneeId);
      if (!assignee) return 'cleared the assignee';
      if (assignee === event.actorId) return 'took this brief on';
      return assignee === meId ? 'assigned this brief to you' : 'assigned this brief to a workspace member';
    }
    case 'done': {
      const target = text(data.target);
      // A `done` written before manual Done carries no `missing`: the cloud
      // set it from merges, so it reads as an observation (see isObserved).
      if (!Array.isArray(data.missing)) {
        return target
          ? `This brief is done: every part is merged into ${target}`
          : 'This brief is done: every part is merged';
      }
      const reason = text(data.reason);
      const quoted = reason ? `: “${reason}”` : '';
      const missing = data.missing.length;
      if (missing === 0) return `moved this brief to Done${quoted}`;
      const into = target ? ` into ${target}` : '';
      return `moved this brief to Done with ${missing} ${missing === 1 ? 'part' : 'parts'} not merged${into}${quoted}`;
    }
    case 'done-reverted': {
      const reason = text(data.reason);
      return reason ? `moved this brief back to Active: “${reason}”` : 'moved this brief back to Active';
    }
    // Observed by the cloud, not done by a person, so it reads as a whole
    // sentence without an actor (see isObserved).
    case 'part-merged': {
      const title = text(data.title);
      const sha = text(data.sha);
      const target = text(data.target);
      const subject = title ? `“${title}”` : 'A part';
      const into = target ? ` into ${target}` : '';
      // A merge GitHub reported through a pull request (brief-github-tracking).
      const through = typeof data.pr === 'number' ? ` through PR #${data.pr}` : '';
      return sha ? `${subject} merged${into} at ${sha.slice(0, 7)}${through}` : `${subject} merged${into}${through}`;
    }
    default:
      // A server newer than this port: say something true rather than nothing.
      return 'changed this brief';
  }
}

/**
 * Whether the cloud observed this event rather than a person doing it, as the
 * web reads it: a part merged (`part-merged`), and a `done` from before
 * manual Done, whose data has no `missing` list. Drawing `part-merged`
 * overturns frame-cloud-brief-manual-done D8, which left it reading "changed
 * this brief" with its actor (frame-cloud-github-tracking D19).
 */
function isObserved(event) {
  const e = event || {};
  const data = e.data && typeof e.data === 'object' ? e.data : {};
  if (e.event === 'part-merged') return true;
  return e.event === 'done' && !Array.isArray(data.missing);
}

/** One history line: who did what, and the day it happened; an observed event has no actor. → `{ sentence, date }`. */
function eventSentence(event, meId) {
  const e = event || {};
  const action = eventAction(e, meId);
  return {
    sentence: isObserved(e) ? `${action}.` : `${actorLabel(e.actorId, meId)} ${action}.`,
    date: formatDate(e.at),
  };
}

/** The Parts tab's line for a shaped brief: "Shaped 18 Sept 2026"; '' when unshaped or unreadable. */
function shapedLine(iso) {
  const date = formatDate(iso);
  return date ? `Shaped ${date}` : '';
}

/** The Parts tab's line for a started brief: "Started 18 Sept 2026"; '' when unstarted or unreadable. */
function startedLine(iso) {
  const date = formatDate(iso);
  return date ? `Started ${date}` : '';
}

const PART_DEFINITION_LABEL = 'Definition';

const REASON_MESSAGES = {
  network: 'Frame Cloud could not be reached. Check your connection and try again.',
  notFound: 'This was not found in Frame Cloud. It may have been removed.',
  notConnected: 'This folder is not connected to a Frame Cloud project.',
  unauthorized: 'You are signed out of Frame Cloud.',
  noWorkspace: 'Your Frame Cloud account has no workspace.',
  roleForbidden: ROLE_FORBIDDEN,
};

/** The panel's sentence for a failed read's `reason`. */
function reasonMessage(reason) {
  return REASON_MESSAGES[reason] || 'Something went wrong loading briefs. Try again.';
}

// ─── Discussions ──────────────────────────────────────────────

const DISCUSSIONS_TITLE = 'Discussions';

/** A card's record count: "1 discussion recorded", "2 discussions recorded"; '' for none or unknown. */
function discussionCountLabel(count) {
  if (!Number.isInteger(count) || count < 1) return '';
  return `${count} discussion${count === 1 ? '' : 's'} recorded`;
}

/**
 * Where an open proposal stands, which decides its controls:
 * 'discussing' (a Discuss lane is open) · 'discuss' (nothing recorded yet) ·
 * 'decide' (at least one record: Move to Work, then Discuss) · 'none' (work,
 * or ended). New comments are a separate fact layered on 'decide'.
 */
function proposalStage({ brief, laneOpen, discussionCount }) {
  if (laneOpen) return 'discussing';
  const b = brief || {};
  if (b.kind !== 'proposal' || b.status === 'closed') return 'none';
  return Number.isInteger(discussionCount) && discussionCount > 0 ? 'decide' : 'discuss';
}

/** "1 new comment", "3 new comments"; '' for none or unknown. */
function newCommentsLabel(count) {
  if (!Number.isInteger(count) || count < 1) return '';
  return `${count} new comment${count === 1 ? '' : 's'}`;
}

/**
 * The ids of the comments that are new: added by someone other than `meId`
 * after the latest discussion record. Empty while nothing was recorded.
 */
function newCommentIds(comments, events, meId) {
  const records = (Array.isArray(events) ? events : []).filter((e) => e && e.event === 'discussion-recorded');
  if (records.length === 0) return new Set();
  const lastAt = Date.parse(records[records.length - 1].at);
  if (Number.isNaN(lastAt)) return new Set();
  return new Set((Array.isArray(comments) ? comments : [])
    .filter((c) => c && c.authorId !== meId && Date.parse(c.createdAt) > lastAt)
    .map((c) => c.id));
}

const MOVE_TO_WORK_LABEL = 'Move to Work';
const MOVE_TO_WORK_DESCRIPTION = 'This proposal becomes work you have decided on. It keeps its number and stays in Backlog.';
const REDISCUSS_LABEL = 'Re-discuss';
const REDISCUSS_HINT = 'Start a new discussion that opens on these comments.';

const DECIDE_MESSAGES = {
  notAProposal: 'This brief is no longer a proposal.',
  alreadyWork: 'This proposal has already moved to work.',
  alreadyClosed: 'This proposal has ended.',
  notFound: 'This brief was not found in Frame Cloud. It may have been removed.',
  badRequest: 'Pick a priority and try again.',
  network: REASON_MESSAGES.network,
  notConnected: REASON_MESSAGES.notConnected,
  unauthorized: REASON_MESSAGES.unauthorized,
  noWorkspace: REASON_MESSAGES.noWorkspace,
  roleForbidden: ROLE_FORBIDDEN,
};

/** The sentence for a Move to Work that failed. */
function decideErrorMessage(reason) {
  return DECIDE_MESSAGES[reason] || 'Something went wrong. Try again.';
}

/** A card's live lane: "Discussing in <lane>". */
function discussingIn(laneName) {
  return laneName ? `Discussing in ${laneName}` : 'Discussing';
}
const DISCUSS_LABEL = 'Discuss';
const GO_TO_DISCUSSION_LABEL = 'Go to discussion';
const DISCUSS_HINT = 'Talk this proposal over with an AI agent in a new lane. It can record what you settle here.';
const WRITE_UP_LABEL = 'Read the write-up';
const WRITE_UP_IN_LINKS = 'Write-up added to Links';

/** A trimmed string, or '' — a `brief_event.data` field is unknown on the wire. */
function eventText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function httpUrl(value) {
  const url = eventText(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * The brief's discussion records, newest first (`brief.events` is oldest
 * first). → `[{ id, date, actor, provider, summary, url, inLinks }]`; `url` is
 * '' unless it is an http(s) link, and `inLinks` says the brief's
 * `attachments` hold that url (its write-up went to Links). Records without a
 * summary are left out.
 */
function discussionRecords(events, meId, attachments = []) {
  const linked = new Set((Array.isArray(attachments) ? attachments : []).map((a) => a && a.url));
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && e.event === 'discussion-recorded')
    .map((e) => {
      const data = e.data && typeof e.data === 'object' ? e.data : {};
      return {
        id: e.id,
        date: formatDate(e.at),
        actor: actorLabel(e.actorId, meId),
        provider: eventText(data.provider),
        summary: eventText(data.summary),
        url: httpUrl(data.url),
      };
    })
    .map((r) => ({ ...r, inLinks: Boolean(r.url) && linked.has(r.url) }))
    .filter((r) => r.summary)
    .reverse();
}

const DISCUSS_MESSAGES = {
  notAnOpenProposal: 'Only an open proposal can be discussed.',
  unknownTool: 'Frame does not know the selected AI tool. Pick one in the AI tool menu and try again.',
  notFound: 'This brief was not found in Frame Cloud. It may have been removed.',
  network: REASON_MESSAGES.network,
  notConnected: REASON_MESSAGES.notConnected,
  unauthorized: REASON_MESSAGES.unauthorized,
  noWorkspace: REASON_MESSAGES.noWorkspace,
  roleForbidden: ROLE_FORBIDDEN,
};

/** The sentence for a Discuss that could not start. */
function discussErrorMessage(reason) {
  return DISCUSS_MESSAGES[reason] || 'The discussion could not start. Try again.';
}

// ─── Shape ────────────────────────────────────────────────────

/**
 * Where a work brief stands, which decides its work control:
 * 'start' (open, shaped, unstarted work — ahead of an open lane, since
 * shaping is finished once the parts are written) · 'lane' (a brief lane of
 * either purpose is open — one lane per brief) · 'shape' (open work whose
 * parts were never written) · 'none' (a proposal, an ended brief, or one
 * already started: neither Shape nor Start Work comes back).
 */
function workStage({ brief, laneOpen }) {
  const b = brief || {};
  const openWork = b.kind === 'work' && b.status !== 'closed';
  if (openWork && b.shapedAt && !b.startedAt) return 'start';
  if (laneOpen) return 'lane';
  return openWork && !b.shapedAt ? 'shape' : 'none';
}

/** A brief lane's link: "Discussing in <lane>" or "Shaping in <lane>". A lane without a purpose is a Discuss lane. */
function laneLabel(purpose, laneName) {
  if (purpose !== 'shape') return discussingIn(laneName);
  return laneName ? `Shaping in ${laneName}` : 'Shaping';
}

const SHAPE_LABEL = 'Shape';
const SHAPE_HINT = 'Split this work into specs and tasks with an AI agent in a new lane. It writes the parts once you approve them.';
const GO_TO_SHAPING_LABEL = 'Go to shaping';

const SHAPE_MESSAGES = {
  notShapeable: 'Only open work that has not been shaped yet can be shaped.',
  unknownTool: DISCUSS_MESSAGES.unknownTool,
  notFound: DISCUSS_MESSAGES.notFound,
  network: REASON_MESSAGES.network,
  notConnected: REASON_MESSAGES.notConnected,
  unauthorized: REASON_MESSAGES.unauthorized,
  noWorkspace: REASON_MESSAGES.noWorkspace,
  roleForbidden: ROLE_FORBIDDEN,
};

/** A shaped card's parts: "1 spec", "2 specs · 1 task"; '' for none or unknown. */
function partCountLabel(counts) {
  const c = counts && typeof counts === 'object' ? counts : {};
  const piece = (n, word) => (Number.isInteger(n) && n > 0 ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
  return [piece(c.spec, 'spec'), piece(c.task, 'task')].filter(Boolean).join(' · ');
}

/** The toast when a Shape landed: "Brief #5 was shaped into 2 parts and is ready to run."; the count is left out when unknown. */
function shapedNotice(number, count) {
  if (!Number.isInteger(count) || count < 1) return `Brief #${number} was shaped and is ready to run.`;
  return `Brief #${number} was shaped into ${count} ${count === 1 ? 'part' : 'parts'} and is ready to run.`;
}

const OPEN_BRIEF_LABEL = 'Open brief';

/** The sentence for a Shape that could not start. */
function shapeErrorMessage(reason) {
  return SHAPE_MESSAGES[reason] || 'Shaping could not start. Try again.';
}

// ─── Start Work ───────────────────────────────────────────────

const START_WORK_LABEL = 'Start Work';
const START_WORK_HINT = 'Turn every part into a spec or a task on a new branch, and begin with the one you choose.';

/** The dialog's heading: "Start work on brief #5". */
function startDialogTitle(number) {
  return `Start work on brief #${number}`;
}

/** The Begin dialog's heading, for one part of a started brief: "Begin “Fix typo”". */
function beginDialogTitle(title) {
  return `Begin “${title}”`;
}

const START_DIALOG_DESCRIPTION = 'Every part is reserved on the brief. Pick the one to begin now; the others wait on the brief until you begin them.';
const BEGIN_DIALOG_DESCRIPTION = 'Pick where this part runs. It gets its own branch there and opens in a lane.';
const START_CHOICE_TITLE = 'What to work on';
const PLACE_TITLE = 'Where to work';
const NEXT_LABEL = 'Next';
const BACK_LABEL = 'Back';
const CHANGE_LABEL = 'Change';
const PART_LABEL = 'Part';

/** The dialog's footer while Start Work has two steps: "Step 1 of 2 · What to work on". */
function stepLabel(step) {
  return step === 2 ? `Step 2 of 2 · ${PLACE_TITLE}` : `Step 1 of 2 · ${START_CHOICE_TITLE}`;
}

/** A Begin choice: "Begin with “Login flow”". */
function beginWithLabel(title) {
  return `Begin with “${title}”`;
}

/** What Begin opens, by the part's shape. */
function beginHint(shape) {
  return shape === 'spec'
    ? 'Writes this spec on its own branch, then opens a lane that plans it.'
    : 'Adds this task on its own branch, then opens a lane that runs it.';
}

const ORCHESTRATE_LABEL = 'Orchestrate';
const ORCHESTRATE_HINT = 'Run every part side by side, each on its own branch.';
const COMING_SOON = 'Coming soon';
const BRANCH_LABEL = 'Branch';
const FROM_LABEL = 'from';
const THIS_MAC_LABEL = 'This Mac';
/** Why the server card is disabled in local mode (frame-cloud-start-on-server C6). */
const LOCAL_MODE_LOCATION_HINT = 'This project keeps Frame files out of git (local mode), so its parts start on This Mac only.';

// ─── Start Work's three places (frame-cloud-start-places) ─────

/** Each place's card title. */
const PLACE_LABELS = {
  checkout: 'Project checkout',
  workspace: 'New workspace',
  server: 'Server workspace',
};

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The project checkout card's meta line: its path, and the branch it is on (none on a detached HEAD). */
function checkoutMeta(path, branch) {
  const p = String(path || '');
  return branch ? `${p} · on ${branch}` : p;
}

/**
 * The three short facts each card lists (D9). `branch` is the checkout's
 * current branch, which a new workspace leaves as it is.
 */
function placeFacts(place, { branch = '' } = {}) {
  if (place === 'checkout') return ['Your project folder switches to the part’s branch', 'Starts right away, no setup', 'One part at a time here'];
  if (place === 'server') return ['Keeps running while this Mac sleeps', 'Committed work only; you tick extra files', 'Setup runs there first'];
  return [branch ? `Its own folder; the checkout stays on ${branch}` : 'Its own folder; the checkout stays as it is', 'Setup runs first', 'Other parts can run beside it'];
}

/**
 * Why the project checkout card is locked, or null (D1, D6): a begun part
 * still in progress on its branch first, then its uncommitted changes. The
 * checkout is never stashed. `checkout` is the dialog view's.
 */
function checkoutLock(checkout) {
  const c = checkout || {};
  if (c.busy && c.busy.branch) {
    return `“${c.busy.title || c.busy.ref}” is in progress here, on ${c.busy.branch}. Switching the branch would pull it out from under that part.`;
  }
  const n = Number(c.changes) || 0;
  if (n > 0) return `${plural(n, 'uncommitted change', 'uncommitted changes')} here. Commit them to start in the project checkout.`;
  return null;
}

/**
 * The server card's state, from the saved servers (`{ key, host, status }`,
 * as serverConnect lists them) and local mode (D8): `localMode` (disabled in
 * every state), `none` (no server saved yet), `offline` (only servers not
 * connected) or `ready` (one or more connected). → `{ kind, connected:
 * [{ key, host }], offline: [{ key, host }] }`.
 */
function serverCardState(servers, { localMode = false } = {}) {
  const list = (Array.isArray(servers) ? servers : []).filter((s) => s && s.key);
  const view = (s) => ({ key: s.key, host: String(s.host || s.key) });
  const isUp = (s) => Boolean(s.status && s.status.state === 'connected');
  const connected = list.filter(isUp).map(view);
  const offline = list.filter((s) => !isUp(s)).map(view);
  let kind = 'ready';
  if (localMode) kind = 'localMode';
  else if (list.length === 0) kind = 'none';
  else if (connected.length === 0) kind = 'offline';
  return { kind, connected, offline };
}

/** The server card's meta line: the connected hosts. */
function serverCardMeta(hosts) {
  return (Array.isArray(hosts) ? hosts : []).join(', ');
}

/** A saved server that is not connected, on the server card. */
function serverOfflineLine(host) {
  return `${host} is not connected.`;
}

const CONNECT_LABEL = 'Connect';
const ADD_SERVER_LABEL = 'Add a server…';
const NO_SERVER_TAG = 'No server yet';
const NO_SERVER_TEXT = 'Run parts on a machine of your own, so they keep going while this Mac sleeps or is closed.';
const NO_SERVER_FACTS = ['A Linux or macOS machine you reach with ssh', 'Frame installs Frame Server there for you'];
const SERVER_SELECT_LABEL = 'Server';

/** A server in the Server select: its host, and "(not connected)" while it is down. */
function serverOptionLabel(host, { offline = false } = {}) {
  return offline ? `${host} (not connected)` : String(host || '');
}

/**
 * The notice when the Servers dialog closed to hand the screen to a terminal
 * (D3): Start Work closed with it, so the terminal is not covered.
 */
const SERVER_HANDOFF_NOTICE = 'Start Work closed so you can finish in the terminal. Open it again once the server is connected.';

/** The line under "Where to work" before a place is picked: what the branch will be set up from. */
function placePendingLine(targetBranch) {
  return targetBranch
    ? `Pick where it runs, and its branch is set up for that place: your local ${targetBranch} for the project checkout, a fetched origin/${targetBranch} for a workspace.`
    : 'Pick where it runs, and its branch is set up for that place.';
}

/** "Branch · <this>": where the branch row's branch goes. */
function branchPlaceLabel(place, host) {
  if (place === 'checkout') return 'in the project checkout';
  if (place === 'server') return `for the workspace on ${host || 'the server'}`;
  return 'for the new workspace';
}

/**
 * Where the branch is cut from, by place (D13): an `origin/` base is fetched
 * first (on the server for a server), a local base is cut as it is; in the
 * checkout it is then checked out in `path`. '' without a base.
 */
function baseNote(place, base, { host = '', path = '' } = {}) {
  const b = String(base || '');
  if (!b) return '';
  const remote = b.startsWith('origin/');
  const short = remote ? b.slice('origin/'.length) : b;
  if (place === 'server') return `Fetched on ${host || 'the server'} first, so the workspace starts from the latest ${short} there.`;
  if (place === 'checkout') {
    const where = path ? ` in ${path}` : ' in the project folder';
    return remote
      ? `Fetched from origin first, then cut and checked out${where}.`
      : `Cut from your local ${b} as it is on this Mac, then checked out${where}.`;
  }
  return remote
    ? `Fetched from origin first, so the workspace starts from the latest ${short}.`
    : `Cut from your local ${b} as it is on this Mac.`;
}

/**
 * What starting there will do, under the branch row: the checkout switching
 * from `from` to `branch`; the new workspace's `name` and `folder`; the
 * workspace on `host`, the project sent there first if missing (D4), and
 * `changes` uncommitted changes staying on this Mac.
 */
function placeOutcome(place, { branch = '', from = '', name = null, folder = '', host = '', changes = 0 } = {}) {
  const b = branch || 'the new branch';
  if (place === 'checkout') return from ? `The checkout switches from ${from} to ${b}.` : `The checkout switches to ${b}.`;
  if (place === 'server') {
    const h = host || 'the server';
    const n = Number(changes) || 0;
    const ws = name ? `Workspace ${name} on ${h}.` : `A new workspace on ${h}.`;
    let stays = '';
    if (n === 1) stays = ' The uncommitted change stays on this Mac.';
    else if (n > 1) stays = ` The ${n} uncommitted changes stay on this Mac.`;
    return `${ws} If this project is not on ${h} yet, Frame sends its committed history there first.${stays}`;
  }
  if (!name) return 'The workspace is named when it is created.';
  return folder ? `Workspace ${name}, in ${folder}.` : `Workspace ${name}.`;
}

/** The whole line under the branch row: the base note, then what will happen. */
function placeBranchLine(place, facts = {}) {
  return [baseNote(place, facts.base, facts), placeOutcome(place, facts)].filter(Boolean).join(' ');
}

/** The Start button, naming the place (spec START LABEL): "Start" until one is picked, "Starting…" while it runs. */
function startPlaceLabel(place, { host = '', pending = false } = {}) {
  if (pending) return 'Starting…';
  if (place === 'checkout') return 'Start in project checkout';
  if (place === 'workspace') return 'Start in new workspace';
  if (place === 'server') return `Start on ${host || 'the server'}`;
  return 'Start';
}

/**
 * The name the part's new workspace will get, as workspaceManager.create
 * names one opened from a branch: the branch's last segment, slugged and made
 * unique against `taken` (`feat/export-api` → `export-api`, then
 * `export-api-2`). null when the branch leaves no usable name, in which case
 * the workspace gets an automatic one.
 */
function beginWorkspaceName(branch, taken = []) {
  const slug = toSlug(String(branch || '').trim().split('/').pop());
  return slug ? uniquify(slug, taken) : null;
}

const BASE_FILTER_PLACEHOLDER = 'Find a branch…';
const BASE_LOCAL_TITLE = 'Local';
const BASE_REMOTE_TITLE = 'origin';
const NO_BASE_MATCH = 'No branch matches.';
const PICK_BASE_LABEL = 'Pick a base';

/** The line under the branch row when the brief's target branch is on neither this machine nor origin. */
function baseMissingLine(targetBranch) {
  return targetBranch
    ? `The target branch ${targetBranch} is not on this machine. Fetch it, or pick another base.`
    : 'This brief has no target branch. Pick a base to cut from.';
}

const CANCEL_LABEL = 'Cancel';

const PART_PROBLEMS = {
  empty: 'has no definition',
  noProblem: 'has no Problem section',
  noGoal: 'has no Goal section',
  noDescription: 'has no Description section',
  textBeforeHeading: 'has text before its first heading',
};

/** A part whose definition does not parse: "“Fix typo” has no Description section. Edit it on the web." */
function partProblemMessage(title, reason) {
  return `“${title}” ${PART_PROBLEMS[reason] || 'cannot be read'}. Edit it on the web, then start again.`;
}

const START_MESSAGES = {
  notStartable: 'Only open work that is shaped and not started yet can be started.',
  notWork: 'This brief is a proposal. Only work can be started.',
  alreadyClosed: 'This brief has ended.',
  notShaped: 'This brief is not shaped yet. Shape it first.',
  alreadyStarted: 'This brief has already been started, maybe on another machine.',
  partsMismatch: 'The brief\'s parts changed on the web. Close this and start again.',
  recordRefTaken: 'Another brief already uses one of these spec or task names. Pull the latest changes and start again.',
  baseMissing: baseMissingLine(''),
  badRequest: 'Pick the part to begin and try again.',
  localMode: 'This project keeps Frame files out of git (local mode), so its parts cannot start on a server. Start it on This Mac.',
  notFound: 'This brief was not found in Frame Cloud. It may have been removed.',
  network: REASON_MESSAGES.network,
  notConnected: REASON_MESSAGES.notConnected,
  unauthorized: REASON_MESSAGES.unauthorized,
  noWorkspace: REASON_MESSAGES.noWorkspace,
  roleForbidden: ROLE_FORBIDDEN,
};

/** The sentence for a start that was refused before anything was written. `result` is `{ reason, part?, detail? }`. */
function startErrorMessage(result) {
  const r = result || {};
  if (r.reason === 'serverUnavailable') {
    const why = String(r.detail || '').trim();
    return why ? `Could not start on the server. ${/[.!?]$/.test(why) ? why : `${why}.`}` : 'Could not start on the server. Check that it is connected, then try again.';
  }
  if (r.reason === 'serverOld') return `Update Frame Server on ${r.detail || 'that server'} to start parts there (Connect to Server ▸ Update).`;
  if (r.reason === 'baseNotOnOrigin') {
    const name = String(r.detail || '').replace(/^origin\//, '');
    return `${name ? `The branch ${name}` : 'That base'} is not on origin, and a server cuts only from origin. Push it first, or pick another base.`;
  }
  if (r.reason === 'badBranch') return `${r.detail ? `“${r.detail}”` : 'That'} is not a branch name git accepts.`;
  if (r.reason === 'branchTaken') return `A branch named ${r.detail || 'that'} already exists. Pick another name.`;
  if (r.reason === 'baseMissing' && r.detail) return `The branch ${r.detail} is not on this machine. Fetch it, or pick another base.`;
  if (r.reason === 'alreadyBegun') return `This part was already begun${r.detail ? ` on ${r.detail}` : ''}.`;
  if (r.reason === 'checkoutDirty') {
    const n = Number(r.detail) || 0;
    return `${n > 0 ? plural(n, 'uncommitted change', 'uncommitted changes') : 'Uncommitted changes'} in the project checkout. Commit them to start there, or pick another place.`;
  }
  if (r.reason === 'checkoutBusy') {
    return `“${r.part || 'Another part'}” is in progress in the project checkout${r.detail ? `, on ${r.detail}` : ''}. Pick another place, or finish that part first.`;
  }
  if (r.reason === 'badDefinition') return partProblemMessage(r.part || 'A part', r.detail);
  return START_MESSAGES[r.reason] || 'Start Work could not run. Try again.';
}

const PARTIAL_STEPS = {
  branch: 'creating the branch failed',
  workspace: 'opening a workspace on its branch failed',
  files: 'writing the parts failed',
};

/**
 * A start that went through in the cloud and then failed locally: which step
 * failed, what was written, and each missing part with the name to create it
 * under.
 */
function partialMessage(result) {
  const r = result || {};
  const step = PARTIAL_STEPS[r.step] || 'a step failed';
  const lines = [`The brief is started in Frame Cloud, but ${step}${r.error ? `: ${r.error}` : ''}.`];
  const written = Array.isArray(r.written) ? r.written : [];
  const missing = Array.isArray(r.missing) ? r.missing : [];
  if (written.length > 0) lines.push(`Written: ${written.join(', ')}.`);
  if (missing.length > 0) {
    lines.push(`Not written — create these by hand under the same names: ${missing
      .map((m) => `“${m.title}” (${m.shape} ${m.ref})`).join(', ')}.`);
  }
  return lines.join(' ');
}

/**
 * The toast when a part was begun in its own workspace: "Brief #5 started:
 * “Login flow” on feat/login, in workspace login." for the brief's first
 * part, "Began “Fix typo” on fix/typo, in workspace typo." for a later one.
 * In the project checkout it ends "…, in the project checkout." Without a
 * workspace name the sentence ends at the branch.
 */
function startedNotice({ mode, number, part, branch, workspace, place } = {}) {
  const title = part && part.title ? `“${part.title}”` : 'the part';
  const host = workspace && workspace.host ? ` on ${workspace.host}` : '';
  let where = workspace && workspace.name ? `${branch}, in workspace ${workspace.name}${host}` : branch;
  if (place === 'checkout') where = `${branch}, in the project checkout`;
  return mode === 'begin'
    ? `Began ${title} on ${where}.`
    : `Brief #${number} started: ${title} on ${where}.`;
}

/**
 * The note after a start whose `origin/` base could not be fetched: the
 * branch was cut from the last fetched copy. Null when the fetch worked or
 * the base was local.
 */
function fetchFailedNotice({ fetch, workspace } = {}) {
  if (!fetch || fetch.skipped || fetch.fetched) return null;
  const base = workspace && workspace.base ? `origin/${workspace.base}` : 'the base';
  return `Couldn't fetch ${base} — cut from the last fetched copy.`;
}

/**
 * The note after a server start that first sent the project there (T12), as
 * New Workspace says it: committed history only, and what stayed on this
 * Mac. Null when nothing was sent.
 */
function sentNotice({ sent, workspace } = {}) {
  if (!sent) return null;
  const host = (workspace && workspace.host) || 'the server';
  const n = Number(sent.uncommitted) || 0;
  return `Sent this project's committed history to ${host}.${n ? ` ${n} uncommitted change${n === 1 ? '' : 's'} stayed on this Mac — commit and push them to use them there.` : ''}`;
}

const OPEN_SPEC_LABEL = 'Open spec';
const OPEN_TASK_LABEL = 'Open task';

// ─── A started brief's progress ───────────────────────────────

/** A live lane's state, which wins over the record's own. */
const LANE_STATES = {
  'agent-working': { label: 'Working', tone: 'active' },
  'agent-approval': { label: 'Needs approval', tone: 'attention' },
};
const LANE_WAITING = { label: 'Awaiting input', tone: 'attention' };

/**
 * A part finished on this machine but not merged: its spec is `done` or its
 * task `completed`. Done is kept for a merge into the brief's target.
 */
const IMPLEMENTED_LABEL = 'Implemented';
const IMPLEMENTED = { label: IMPLEMENTED_LABEL, tone: 'implemented', run: null };

function specState(spec) {
  const done = Number.isInteger(spec.completed_count) ? spec.completed_count : 0;
  const total = Number.isInteger(spec.task_count) ? spec.task_count : 0;
  switch (spec.phase) {
    case 'done': return IMPLEMENTED;
    case 'implementing':
      return { label: total > 0 ? `Implementing · ${done}/${total}` : 'Implementing', tone: 'active', run: 'spec.implement' };
    case 'tasks_generated': return { label: 'Tasks ready', tone: 'idle', run: 'spec.implement' };
    case 'planned': return { label: 'Planned', tone: 'idle', run: 'spec.tasks' };
    default: return { label: 'Not started', tone: 'idle', run: 'spec.plan' };
  }
}

function taskState(task) {
  if (task.status === 'completed') return IMPLEMENTED;
  if (task.status === 'in_progress') return { label: 'In progress', tone: 'active', run: 'task' };
  return { label: 'Not started', tone: 'idle', run: 'task' };
}

/**
 * Whether a part counts as merged: the cloud saw it on a target
 * (`mergedAt`), and that target is still the brief's (`mergedBase ===
 * target`). A part merged into a target the brief has since moved off waits
 * again. The web's `countsAsMerged` rule.
 */
function countsAsMerged(part, target) {
  const p = part || {};
  return Boolean(p.mergedAt) && typeof target === 'string' && target.length > 0 && p.mergedBase === target;
}

/** A dropped part's row: "Dropped · <reason>", or "Dropped" without one. */
function droppedLabel(reason) {
  return reason ? `Dropped · ${reason}` : 'Dropped';
}

/** A merged part's row: "Merged into <target>". */
function mergedLabel(target) {
  return `Merged into ${target}`;
}

/** An open pull request's review after its number (the web's `REVIEW_LABEL`); no review reads "Open". */
const REVIEW_LABELS = {
  requested: 'In review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};
const PR_OPEN_LABEL = 'Open';

/** "PR #7", the number a PR row shows (and links when the server gave a URL). */
function prLabel(number) {
  return `PR #${number}`;
}

/**
 * A part's pull request as a row, while tracking is `ready` (the web's
 * `partRow`): merged into a base other than the target ("Merged into <base>,
 * not <target>", attention), or open ("PR #N · Open / In review / Approved",
 * review; "PR #N · Changes requested", attention). Null for no PR, a closed
 * one, or one merged into the target before the cloud counts the part. `run`
 * is the folder record's next step, kept so a task added after "Changes
 * requested" can run from the row (plan D7).
 */
function prStatus(p, target, run) {
  if (!Number.isInteger(p.prNumber) || p.prNumber <= 0) return null;
  const pr = (kind) => ({ number: p.prNumber, url: p.prUrl || null, kind, base: p.prBase || null });
  if (p.prState === 'merged' && p.prBase && p.prBase !== target) {
    return { label: `Merged into ${p.prBase}, not ${target}`, tone: 'attention', laneName: null, run, pr: pr('offTarget') };
  }
  if (p.prState === 'open') {
    const changes = p.prReview === 'changes_requested';
    return {
      label: `${prLabel(p.prNumber)} · ${REVIEW_LABELS[p.prReview] || PR_OPEN_LABEL}`,
      tone: changes ? 'attention' : 'review',
      laneName: null,
      run,
      pr: pr(changes ? 'changes' : 'review'),
    };
  }
  return null;
}

/**
 * Where one part of a started brief stands. `spec` is its `SPEC_DATA` entry
 * and `task` its `tasks.json` row (either absent when this folder does not
 * hold it), `lane` its lane info, `target` the brief's target branch,
 * `tracking` the brief's `mergeTracking`, `part.branch` the branch the cloud
 * has for it, and `part.begunBranch` the branch this machine began it on.
 * With `done` (the brief is Done) the row keeps its label but offers no Begin
 * or Run (plan D7): a Done brief's facts are frozen until it moves back to
 * Active. `setup` (`{ host }`) says this window is still setting up the
 * part's workspace (frame-cloud-start-places D19). In order:
 * - the cloud dropped it → "Dropped · <reason>";
 * - it counts as merged into `target` → "Merged into <target>";
 * - its workspace is being set up → "Setting up the workspace" or "Setting
 *   up on <host>", with no Run;
 * - the folder holds an unfinished record and a live agent lane → the lane's
 *   state, with no Run: the lane is the way in;
 * - only while tracking is `ready`, its pull request (see prStatus), keeping
 *   the record's Run;
 * - the folder holds its record → the record's state, where a finished
 *   record reads "Implemented";
 * - the cloud recorded its completion → "Implemented";
 * - the cloud has its branch (unless `part.branchGone`: this machine's own
 *   branch was deleted) → "On <branch>";
 * - this machine began it → "On <branch>";
 * - else it waits on the brief → Not started, with Begin.
 * → `{ label, tone: 'idle' | 'active' | 'attention' | 'implemented' |
 * 'review' | 'done' | 'dropped' | 'elsewhere', laneName, run: 'spec.plan' |
 * 'spec.tasks' | 'spec.implement' | 'task' | 'begin' | null }`, and on a PR
 * row only `pr: { number, url, kind: 'review' | 'changes' | 'offTarget', base }`.
 */
function partStatus({ done, ...facts } = {}) {
  const status = partStatusOf(facts);
  return done === true ? { ...status, run: null } : status;
}

function partStatusOf({ part, spec, task, lane, target, tracking = 'ready', setup = null } = {}) {
  const p = part || {};
  if (!p.recordRef) return { label: '', tone: 'idle', laneName: null, run: null };
  if (p.droppedAt) return { label: droppedLabel(p.dropReason), tone: 'dropped', laneName: null, run: null };
  if (countsAsMerged(p, target)) return { label: mergedLabel(target), tone: 'done', laneName: null, run: null };
  if (setup) return { label: settingUpLabel(setup.host), tone: 'active', laneName: null, run: null };
  const record = p.shape === 'spec' ? spec : task;
  const own = record ? (p.shape === 'spec' ? specState(record) : taskState(record)) : null;
  if (own && own.tone !== 'implemented' && lane && lane.agentName) {
    return { ...(LANE_STATES[lane.status] || LANE_WAITING), laneName: lane.name || '', run: null };
  }
  const pr = tracking === 'ready' ? prStatus(p, target, own ? own.run : null) : null;
  if (pr) return pr;
  if (own) return { ...own, laneName: null };
  if (p.completionSha) return { ...IMPLEMENTED, laneName: null };
  if (p.branch && !p.branchGone) return { label: `On ${p.branch}`, tone: 'elsewhere', laneName: null, run: null };
  if (p.begunBranch) return { label: `On ${p.begunBranch}`, tone: 'elsewhere', laneName: null, run: null };
  return { label: 'Not started', tone: 'idle', laneName: null, run: 'begin' };
}

/**
 * The workspace a begun part is in. A part begun on a Frame Server
 * (`begunServerKey`, frame-cloud-start-on-server) matches that server's
 * workspace on its `begunBranch`, offline or not. Otherwise: the active,
 * local workspace whose branch is the part's `begunBranch`, else its cloud
 * `branch`. Git checks a branch out in at most one worktree, so the match is
 * unique. A workspace that is archived or missing, or in another location,
 * is not a match, and the row then reads as it does without one.
 * → the workspace record, or null.
 */
function partWorkspace(part, workspaces) {
  const p = part || {};
  if (!Array.isArray(workspaces)) return null;
  const usable = (w) => w && !w.archivedAt && !w.missing;
  if (p.begunServerKey) {
    if (!p.begunBranch) return null;
    return workspaces.find((w) => usable(w) && w.location === 'server' && w.serverKey === p.begunServerKey
      && w.branch === p.begunBranch) || null;
  }
  const branch = p.begunBranch || p.branch;
  if (!branch) return null;
  return workspaces.find((w) => usable(w) && w.branch === branch && (w.location || 'local') === 'local') || null;
}

/** The part row's workspace chip, as its tooltip: "Switch to workspace login-flow". */
function partWorkspaceHint(name) {
  return `Switch to workspace ${name}`;
}

/**
 * The part row's chip for its workspace (D3): `name` on This Mac, `name ·
 * host` on a server, `name · host · offline` while that server is down —
 * which cannot be switched to. → `{ label, hint, offline }`.
 */
function partWorkspaceChip(ws) {
  const w = ws || {};
  const name = String(w.name || '');
  if (w.location !== 'server') return { label: name, hint: partWorkspaceHint(name), offline: false };
  const host = String(w.host || 'the server');
  if (w.offline) return { label: `${name} · ${host} · offline`, hint: `${host} is offline. Connect it to switch to workspace ${name}.`, offline: true };
  return { label: `${name} · ${host}`, hint: `Switch to workspace ${name} on ${host}`, offline: false };
}

/**
 * A part begun in the project checkout, where a workspace chip would be
 * (frame-cloud-start-places D10): "project checkout · feat/login".
 */
function checkoutRowLabel(branch) {
  return `project checkout · ${branch}`;
}

/** That label's tooltip. */
function checkoutRowHint(branch) {
  return `This part runs in the project checkout, on ${branch}.`;
}

/** A part whose workspace is still being set up (D19): with its host on a server. */
function settingUpLabel(host) {
  return host ? `Setting up on ${host}` : 'Setting up the workspace';
}

const RUN_LABEL = 'Run';
const BEGIN_LABEL = 'Begin';
const RUN_HINTS = {
  begin: 'Give this part its own branch and open it in a lane.',
  'spec.plan': 'Plan this spec in a new lane.',
  'spec.tasks': 'Break this spec\'s plan into tasks in a new lane.',
  'spec.implement': 'Implement this spec\'s tasks.',
  task: 'Run this task in a new lane.',
};

/** A part row's button: Begin for a part still on the brief, Run for its next step. */
function runLabel(run) {
  return run === 'begin' ? BEGIN_LABEL : RUN_LABEL;
}

/** What Run does for a part, as its tooltip. */
function runHint(run) {
  return RUN_HINTS[run] || '';
}

/** A part's lane link: "in Frame 3". */
function laneLine(laneName) {
  return laneName ? `in ${laneName}` : 'in a lane';
}

/**
 * A started brief's line under its parts, only with more than one. While
 * tracking is `ready` (the web's `partsSummarySegments`, plus Frame's own
 * "in progress" and "on another branch"): "1 of 5 merged · 1 in review ·
 * 1 changes requested · 1 implemented · 1 in progress · 1 on another branch ·
 * 1 dropped". Otherwise only completions are known, and a merged part counts
 * as implemented: "2 of 3 implemented · 1 in progress · 1 dropped". The head
 * counts out of the live parts; dropped parts are counted beside them, and a
 * zero piece is left out. "In progress" counts a lane's attention, not a
 * PR's. `statuses` are partStatus results.
 */
function partsSummary(statuses, tracking = 'ready') {
  const list = Array.isArray(statuses) ? statuses : [];
  if (list.length < 2) return '';
  const matching = (test) => list.filter((s) => s && test(s)).length;
  const count = (...tones) => matching((s) => tones.includes(s.tone));
  const dropped = count('dropped');
  const live = list.length - dropped;
  const pieces = [];
  if (tracking === 'ready') {
    pieces.push(`${count('done')} of ${live} merged`);
    const review = count('review');
    if (review > 0) pieces.push(`${review} in review`);
    const changes = matching((s) => s.pr && s.pr.kind === 'changes');
    if (changes > 0) pieces.push(`${changes} changes requested`);
    const implemented = count('implemented');
    if (implemented > 0) pieces.push(`${implemented} implemented`);
  } else {
    pieces.push(`${count('implemented', 'done')} of ${live} implemented`);
  }
  const active = matching((s) => s.tone === 'active' || (s.tone === 'attention' && !s.pr));
  if (active > 0) pieces.push(`${active} in progress`);
  const elsewhere = count('elsewhere');
  if (elsewhere > 0) pieces.push(`${elsewhere} on ${elsewhere === 1 ? 'another branch' : 'other branches'}`);
  if (dropped > 0) pieces.push(`${dropped} dropped`);
  return pieces.join(' · ');
}

/**
 * A card's attention line (the web's K2 row): the first part, in order, a
 * person should look at — "Changes requested on <title>" or "<title> merged
 * into <base>, not <target>" — plus " · N more", or '' when nothing asks.
 * `entries` are `[{ title, status }]` with partStatus results, so the line
 * never contradicts its rows: a part whose lane wins is not flagged, and
 * there are no PR rows unless tracking is `ready`.
 */
function partAttention(entries, target) {
  const list = Array.isArray(entries) ? entries : [];
  const flagged = [];
  for (const entry of list) {
    const status = entry && entry.status;
    const pr = status && status.tone === 'attention' ? status.pr : null;
    if (!pr) continue;
    const title = entry.title || '';
    if (pr.kind === 'changes') flagged.push(`Changes requested on ${title}`);
    else if (pr.kind === 'offTarget') flagged.push(`${title} merged into ${pr.base || 'another branch'}, not ${target}`);
  }
  if (flagged.length === 0) return '';
  return flagged.length > 1 ? `${flagged[0]} · ${flagged.length - 1} more` : flagged[0];
}

/**
 * The board's box while the project's pull requests and merges are not
 * tracked, word for word the web's (`project-header.tsx` `WARNING`): no
 * GitHub, or tracking turned off. Both lead to the project's Settings, the
 * only place either changes. This overturns frame-cloud-brief-done D2's
 * "Merges are tracked once GitHub is connected." (plan D4).
 */
const TRACKING_WARNINGS = {
  needs_github: {
    title: 'Not connected to GitHub',
    description: 'Pull requests and merges are not tracked. Connect GitHub in Settings.',
  },
  off: {
    title: 'GitHub tracking is off',
    description: 'Pull requests and merges are not tracked. Turn it on in Settings.',
  },
};
const OPEN_ON_WEB_LABEL = 'Open on web';

/** The board's tracking box for a `mergeTracking` → `{ title, description }`, or null while tracking is ready. */
function trackingWarning(tracking) {
  return Object.prototype.hasOwnProperty.call(TRACKING_WARNINGS, tracking) ? TRACKING_WARNINGS[tracking] : null;
}

/** A part link whose task this folder does not hold. */
function partNotHereMessage(ref) {
  return `${ref} is not in this folder's tasks. It may be on another branch or machine.`;
}

// ─── Moving to Done and back (manual Done) ────────────────────

const MOVE_TO_DONE_LABEL = 'Move to Done';
const MOVE_BACK_LABEL = 'Move back to Active';
/** A held move's control, while its Undo window is open. */
const MOVING_TO_DONE_LABEL = 'Moving to Done…';
/** An Active card whose every live part counts on a tracked project: waiting for a person. */
const READY_FOR_DONE_LABEL = 'Ready for Done';
const UNDO_LABEL = 'Undo';
const REASON_LABEL = 'Reason';
const MOVE_TO_DONE_ANYWAY_LABEL = 'Move to Done anyway';
const MOVE_BACK_DESCRIPTION =
  'The brief returns to Active with its parts as they are, and Close and the target branch open again. The move records why.';

/** The Undo toast: "Moved #5 to Done". */
function movedNotice(number) {
  return `Moved #${number} to Done`;
}

/** The dialog's heading for a move to Done that needs a reason: "Move #5 to Done?". */
function moveToDoneTitle(number) {
  return `Move #${number} to Done?`;
}

/** The dialog's heading for a move back: "Move #5 back to Active?". */
function moveBackTitle(number) {
  return `Move #${number} back to Active?`;
}

/** The move-to-Done dialog's description, naming the brief's target. */
function moveToDoneDescription(target) {
  const into = target ? ` into ${target}` : '';
  return `Some parts are not merged${into} yet, so the move records why the brief is done anyway.`;
}

/** The line over the dialog's missing parts: "1 part not merged into main.", "2 parts …". */
function missingPartsLine(count, target) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const into = target ? ` into ${target}` : '';
  return `${n} ${n === 1 ? 'part' : 'parts'} not merged${into}.`;
}

/**
 * Live parts that do not count on the brief's current target: what a move to
 * Done leaves unmerged, in the brief's part order. The web's `missingParts`.
 */
function missingParts(brief) {
  const b = brief || {};
  const parts = Array.isArray(b.parts) ? b.parts : [];
  return parts.filter((part) => part && !part.droppedAt && !countsAsMerged(part, b.targetBranch));
}

/**
 * Whether a move to Done asks for a reason: the project's merges are tracked
 * and a live part does not count yet. Untracked, nothing can be checked, so
 * nothing is asked. Decided from the panel's last read; a stale one is caught
 * by the server's `REASON_REQUIRED`.
 */
function needsReason(brief) {
  const b = brief || {};
  return b.mergeTracking === 'ready' && missingParts(b).length > 0;
}

/**
 * A Done brief's header line, as the web shows it: "Done: reason · date",
 * "Done · date" without a reason, or '' for a brief that is not Done.
 */
function doneLine(brief) {
  const b = brief || {};
  if (b.status !== 'done') return '';
  const head = b.doneReason ? `Done: ${b.doneReason}` : 'Done';
  const date = formatDate(b.doneAt);
  return date ? `${head} · ${date}` : head;
}

// The web's refusal sentences (`briefErrorMessage`) for the codes a move can
// meet, keyed by the reason main reduces them to (MOVE_REFUSALS).
const MOVE_MESSAGES = {
  alreadyDone: 'This brief is done, so it cannot be closed and its target is fixed. Move it back to Active first.',
  notDone: 'This brief is not done.',
  notStarted: 'Work on this brief has not started yet.',
  alreadyClosed: 'This brief is already closed.',
  notWork: 'Only work can take a priority, a milestone, parts, a start or a close.',
  reasonRequired: 'Give a reason.',
  notFound: DECIDE_MESSAGES.notFound,
  network: REASON_MESSAGES.network,
  notConnected: REASON_MESSAGES.notConnected,
  unauthorized: REASON_MESSAGES.unauthorized,
  noWorkspace: REASON_MESSAGES.noWorkspace,
  roleForbidden: ROLE_FORBIDDEN,
};

/** The sentence for a move that was refused or failed. */
function moveErrorMessage(reason) {
  return MOVE_MESSAGES[reason] || 'Something went wrong. Try again.';
}

// ─── New brief ────────────────────────────────────────────────

const NEW_BRIEF_TITLE = 'New brief';
const NEW_BRIEF_DESCRIPTION = 'A proposal to think over, or work you have decided on.';

const AI_LINKS_TITLE = 'AI conversations & links';
const AI_LINKS_HINT =
  'Add a Claude artifact, a ChatGPT conversation or any link the agent should read. Use a shared link so the agent can open it.';
const INVALID_LINK = 'That is not a full link. It should start with https://.';

const TITLE_REQUIRED = 'Give the brief a title.';
const LINK_TITLE_REQUIRED = 'Each link needs a title.';

/** "Create work" / "Create proposal", or "Creating…" while the request runs. */
function submitLabel(kind, pending) {
  if (pending) return 'Creating…';
  return kind === 'proposal' ? 'Create proposal' : 'Create work';
}

// The web's refusal sentences (`briefErrorMessage`), keyed by the reason
// main reduces a failure to. The web's "Check the highlighted field" would
// point at nothing here: main refuses the request as a whole.
const CREATE_MESSAGES = {
  badRequest: 'Check the title, description and links, then try again.',
  notFound: 'This project does not exist.',
  network: REASON_MESSAGES.network,
  notConnected: REASON_MESSAGES.notConnected,
  unauthorized: REASON_MESSAGES.unauthorized,
  noWorkspace: REASON_MESSAGES.noWorkspace,
  roleForbidden: ROLE_FORBIDDEN,
};
const CREATE_FALLBACK = 'Something went wrong. Try again.';

/** The form's sentence for a failed create's `reason`. */
function createErrorMessage(reason) {
  return CREATE_MESSAGES[reason] || CREATE_FALLBACK;
}

// ─── Milestones ──────────────────────────────────────────────

/** The three statuses as the user sees them. */
const MILESTONE_STATUS_LABEL = { started: 'Started', planned: 'Planned', closed: 'Closed' };

const OVERDUE_LABEL = 'Overdue';
const MILESTONE_LABEL = 'Milestone';
const STARTED_MILESTONE_LABEL = 'Started milestone';
const SHOW_ONLY_MILESTONE_LABEL = 'Show only this milestone';
const ALL_BRIEFS_LABEL = 'All briefs';
const NARROWED_EMPTY_LABEL = 'No open briefs in this milestone.';
const NO_END_DATE_LABEL = 'No end date';

function milestoneStatusLabel(status) {
  return MILESTONE_STATUS_LABEL[status] || MILESTONE_STATUS_LABEL.planned;
}

/** A timestamp as milliseconds, or null when missing or unreadable. */
function timeOf(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The project's started milestone, or null. A project has at most one, but an
 * older server may return several: the earliest started wins, one without a
 * `startedAt` goes last, and equal times keep the list's order.
 */
function startedMilestone(milestones) {
  const started = (Array.isArray(milestones) ? milestones : []).filter((m) => m && m.status === 'started');
  started.sort((a, b) => {
    const x = timeOf(a.startedAt);
    const y = timeOf(b.startedAt);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  });
  return started[0] || null;
}

/** The briefs under `milestoneId`, in the list's order. */
function briefsInMilestone(briefs, milestoneId) {
  if (typeof milestoneId !== 'string' || !milestoneId) return [];
  return (Array.isArray(briefs) ? briefs : []).filter((b) => b && b.milestoneId === milestoneId);
}

/**
 * The milestone's counts with backlog, active and done taken from `briefs`
 * (the board's list, held moves already applied), so the strip never
 * disagrees with the columns. Ended briefs are listed only on demand, so
 * `closed` stays the server's. Without `briefs` the server's counts stand in;
 * null when the server sent none (an older server).
 */
function countsWithBriefs(milestone, briefs) {
  if (!milestone || !milestone.briefs) return null;
  if (!Array.isArray(briefs)) return milestone.briefs;
  const own = briefsInMilestone(briefs, milestone.id);
  const of = (status) => own.filter((b) => b.status === status).length;
  return { backlog: of('backlog'), active: of('active'), done: of('done'), closed: milestone.briefs.closed };
}

/**
 * Done over unfinished plus done: `{ done, total, percent, label }`, the
 * percentage whole and 0 while there is nothing to finish. Null without counts.
 */
function milestoneProgress(counts) {
  if (!counts) return null;
  const total = counts.backlog + counts.active + counts.done;
  return {
    done: counts.done,
    total,
    percent: total === 0 ? 0 : Math.round((counts.done / total) * 100),
    label: total === 0 ? 'No briefs yet' : `${counts.done} of ${total} done`,
  };
}

/** The viewer's calendar date as `YYYY-MM-DD`, the shape `targetDate` has. */
function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A started milestone whose end date has passed with briefs still to finish.
 * The end date itself is not overdue; the day after is. Never without counts.
 */
function isOverdue(milestone, today = localToday()) {
  if (!milestone || !milestone.briefs) return false;
  return (
    milestone.status === 'started'
    && typeof milestone.targetDate === 'string'
    && milestone.targetDate < today
    && milestone.briefs.backlog + milestone.briefs.active > 0
  );
}

const TARGET_DATE_FORMAT = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar date as "Nov 20, 2026". It names a day, not an instant, so no time zone moves it. */
function formatTargetDate(date) {
  const [year = 0, month = 1, day = 1] = String(date).split('-').map(Number);
  return TARGET_DATE_FORMAT.format(new Date(Date.UTC(year, month - 1, day)));
}

/** "Ends Nov 20, 2026", or "No end date". */
function endsLine(targetDate) {
  return typeof targetDate === 'string' && targetDate ? `Ends ${formatTargetDate(targetDate)}` : NO_END_DATE_LABEL;
}

/**
 * "Targets release/1.0" for a milestone with a target branch of its own, or
 * null: without one each brief keeps its target, and the milestone says nothing.
 */
function targetBranchLine(milestone) {
  return milestone && typeof milestone.targetBranch === 'string' && milestone.targetBranch
    ? `Targets ${milestone.targetBranch}`
    : null;
}

/**
 * What the strip and Home's tracker draw for `milestone` (its `briefs` already
 * counted by the caller): `{ id, name, overdue, ends, target, progress }`. A
 * milestone from an older server (`briefs === null`) is its name alone: no
 * end date, branch, progress or Overdue. Null without a milestone.
 */
function milestoneSummary(milestone, today = localToday()) {
  if (!milestone || typeof milestone !== 'object') return null;
  const summary = { id: milestone.id, name: milestone.name, overdue: false, ends: null, target: null, progress: null };
  if (!milestone.briefs) return summary;
  return {
    ...summary,
    overdue: isOverdue(milestone, today),
    ends: endsLine(milestone.targetDate),
    target: targetBranchLine(milestone),
    progress: milestoneProgress(milestone.briefs),
  };
}

/**
 * The detail's Milestone row after the name: its status, and its end date
 * while it is open ("Started · Ends Nov 20, 2026", "Planned", "Closed"). An
 * older server's milestone reads its status alone.
 */
function milestoneRowFacts(milestone) {
  if (!milestone) return '';
  const facts = [milestoneStatusLabel(milestone.status)];
  if (milestone.briefs && milestone.status !== 'closed' && typeof milestone.targetDate === 'string' && milestone.targetDate) {
    facts.push(endsLine(milestone.targetDate));
  }
  return facts.join(' · ');
}

/** The progress bar's accessible name. */
function milestoneProgressLabel(name) {
  return `${name} progress`;
}

/** The board's notice when a brief was created but a link was not attached. */
function attachmentNotice(number, reason) {
  // A link that fails is refused on the brief, not the project.
  const sentence = reason === 'notFound' ? 'This brief does not exist.' : createErrorMessage(reason);
  return `Brief #${number} was created, but some links were not attached. ${sentence}`;
}

module.exports = {
  COLUMNS,
  groupByColumn,
  KIND_COPY,
  statusLabel,
  priorityLabel,
  endingFact,
  endingLine,
  actorLabel,
  formatDate,
  isObserved,
  eventSentence,
  shapedLine,
  startedLine,
  PART_DEFINITION_LABEL,
  reasonMessage,
  DISCUSSIONS_TITLE,
  discussionCountLabel,
  discussingIn,
  proposalStage,
  newCommentsLabel,
  newCommentIds,
  MOVE_TO_WORK_LABEL,
  MOVE_TO_WORK_DESCRIPTION,
  REDISCUSS_LABEL,
  REDISCUSS_HINT,
  decideErrorMessage,
  DISCUSS_LABEL,
  GO_TO_DISCUSSION_LABEL,
  DISCUSS_HINT,
  WRITE_UP_LABEL,
  WRITE_UP_IN_LINKS,
  discussionRecords,
  discussErrorMessage,
  workStage,
  laneLabel,
  SHAPE_LABEL,
  SHAPE_HINT,
  GO_TO_SHAPING_LABEL,
  shapeErrorMessage,
  shapedNotice,
  OPEN_BRIEF_LABEL,
  partCountLabel,
  START_WORK_LABEL,
  START_WORK_HINT,
  startDialogTitle,
  beginDialogTitle,
  START_DIALOG_DESCRIPTION,
  BEGIN_DIALOG_DESCRIPTION,
  START_CHOICE_TITLE,
  PLACE_TITLE,
  NEXT_LABEL,
  BACK_LABEL,
  CHANGE_LABEL,
  PART_LABEL,
  stepLabel,
  beginWithLabel,
  beginHint,
  ORCHESTRATE_LABEL,
  ORCHESTRATE_HINT,
  COMING_SOON,
  BRANCH_LABEL,
  FROM_LABEL,
  THIS_MAC_LABEL,
  LOCAL_MODE_LOCATION_HINT,
  PLACE_LABELS,
  checkoutMeta,
  placeFacts,
  checkoutLock,
  serverCardState,
  serverCardMeta,
  serverOfflineLine,
  CONNECT_LABEL,
  ADD_SERVER_LABEL,
  NO_SERVER_TAG,
  NO_SERVER_TEXT,
  NO_SERVER_FACTS,
  SERVER_SELECT_LABEL,
  serverOptionLabel,
  SERVER_HANDOFF_NOTICE,
  placePendingLine,
  branchPlaceLabel,
  baseNote,
  placeOutcome,
  placeBranchLine,
  startPlaceLabel,
  beginWorkspaceName,
  BASE_FILTER_PLACEHOLDER,
  BASE_LOCAL_TITLE,
  BASE_REMOTE_TITLE,
  NO_BASE_MATCH,
  PICK_BASE_LABEL,
  baseMissingLine,
  CANCEL_LABEL,
  partProblemMessage,
  startErrorMessage,
  partialMessage,
  startedNotice,
  fetchFailedNotice,
  sentNotice,
  OPEN_SPEC_LABEL,
  OPEN_TASK_LABEL,
  partWorkspace,
  partWorkspaceHint,
  partWorkspaceChip,
  checkoutRowLabel,
  checkoutRowHint,
  settingUpLabel,
  partNotHereMessage,
  IMPLEMENTED_LABEL,
  TRACKING_WARNINGS,
  trackingWarning,
  OPEN_ON_WEB_LABEL,
  countsAsMerged,
  droppedLabel,
  mergedLabel,
  REVIEW_LABELS,
  prLabel,
  partStatus,
  RUN_LABEL,
  BEGIN_LABEL,
  runLabel,
  runHint,
  laneLine,
  partsSummary,
  partAttention,
  MOVE_TO_DONE_LABEL,
  MOVE_BACK_LABEL,
  MOVING_TO_DONE_LABEL,
  READY_FOR_DONE_LABEL,
  UNDO_LABEL,
  REASON_LABEL,
  MOVE_TO_DONE_ANYWAY_LABEL,
  MOVE_BACK_DESCRIPTION,
  movedNotice,
  moveToDoneTitle,
  moveBackTitle,
  moveToDoneDescription,
  missingPartsLine,
  missingParts,
  needsReason,
  doneLine,
  moveErrorMessage,
  NEW_BRIEF_TITLE,
  NEW_BRIEF_DESCRIPTION,
  AI_LINKS_TITLE,
  AI_LINKS_HINT,
  INVALID_LINK,
  TITLE_REQUIRED,
  LINK_TITLE_REQUIRED,
  submitLabel,
  createErrorMessage,
  attachmentNotice,
  MILESTONE_STATUS_LABEL,
  OVERDUE_LABEL,
  MILESTONE_LABEL,
  STARTED_MILESTONE_LABEL,
  SHOW_ONLY_MILESTONE_LABEL,
  ALL_BRIEFS_LABEL,
  NARROWED_EMPTY_LABEL,
  NO_END_DATE_LABEL,
  milestoneStatusLabel,
  startedMilestone,
  briefsInMilestone,
  countsWithBriefs,
  milestoneProgress,
  localToday,
  isOverdue,
  formatTargetDate,
  endsLine,
  targetBranchLine,
  milestoneSummary,
  milestoneRowFacts,
  milestoneProgressLabel,
};
