/**
 * cloudStart — the pure core of starting a shaped Frame Cloud work brief.
 *
 * Start Work turns every part of an open, shaped, unstarted work brief into a
 * Frame spec or task on a fresh work branch, after telling the cloud which
 * spec slug or task id each part became (`brief.start`). Shape already wrote
 * each definition in Frame's own formats (cloudShape's SPEC_HEADINGS and
 * TASK_HEADINGS), so no agent writes the files: this module parses them,
 * picks each part's ref against what the folder already holds, and builds
 * the `spec.md`, `status.json` and `tasks.json` row main writes.
 *
 * Nothing here imports Electron, touches a file or runs git:
 * `cloudStartService.js` is the shell, and `node --test` covers every branch.
 */

const { TRANSLITERATE } = require('./cloudProjects');
const { getBrief, startThrough } = require('./cloudBriefs');

/** spec.new's slug limit (specManager's SLUG_MAX_LEN). */
const SLUG_MAX = 48;

/** A branch suggestion's name, after its type prefix, when it comes from a title. */
const BRANCH_NAME_MAX = 32;

/** Frame's task title limit (`tasks.json` schema). */
const TASK_TITLE_MAX = 60;

/** A part's type → its branch prefix. */
const BRANCH_PREFIXES = { feature: 'feat/', fix: 'fix/', refactor: 'refactor/', docs: 'docs/', test: 'test/' };

/** Where a begun part runs (frame-cloud-start-places): the project checkout, a new workspace, or a server workspace. */
const PLACES = ['checkout', 'workspace', 'server'];

function str(value) {
  return typeof value === 'string' ? value : '';
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ─── Names ────────────────────────────────────────────────────

/**
 * A title → spec.new's slug: lowercase, `[a-z0-9-]` only, runs of `-`
 * collapsed and trimmed, at most `max` characters (48 by default). Letters
 * are folded first as cloudProjects.suggestSlug does, so "Giriş akışı" keeps
 * its letters (`giris-akisi`). A slug too long is cut at the last word that
 * fits, not mid-word; a single word longer than `max` is cut hard.
 * → `fallback` when nothing is left.
 */
function slugify(title, fallback = '', max = SLUG_MAX) {
  const full = str(title)
    .toLowerCase()
    .replace(/[ıßæøœđłþ]/g, (ch) => TRANSLITERATE[ch])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= max) return full || fallback;
  const cut = full.slice(0, max + 1).lastIndexOf('-');
  return (cut > 0 ? full.slice(0, cut) : full.slice(0, max)).replace(/-+$/, '') || fallback;
}

/** A part's name for its spec slug or task id: its key from Shape, else its title's slug. */
function partName(part, fallback, max = SLUG_MAX) {
  const key = str(part && part.key);
  return key || slugify(part && part.title, fallback, max);
}

/**
 * The branch Start Work suggests for a part: the type's prefix, then its key
 * from Shape, else its title's slug within 32 characters (`fallback` when the
 * title has none).
 */
function suggestBranchName(type, part, fallback = 'work') {
  return `${BRANCH_PREFIXES[type] || BRANCH_PREFIXES.feature}${partName(part, fallback, BRANCH_NAME_MAX)}`;
}

// ─── Definitions ──────────────────────────────────────────────

/**
 * A definition split on its `## ` headings, outside code fences.
 * → `{ preamble, sections: [{ heading, body }] }`, bodies trimmed.
 */
function splitSections(text) {
  const sections = [];
  const preamble = [];
  let current = null;
  let fence = null;
  for (const line of str(text).replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
    }
    const heading = !fence && !fenceMatch && /^##(?!#)\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = { heading: heading[1], lines: [] };
      sections.push(current);
    } else {
      (current ? current.lines : preamble).push(line);
    }
  }
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim() })),
  };
}

function sameHeading(a, b) {
  return a.trim().toLowerCase() === b.toLowerCase();
}

/** The body under `name` (every section of that name, joined); '' when absent. */
function sectionBody(sections, name) {
  return sections.filter((s) => sameHeading(s.heading, name)).map((s) => s.body).filter(Boolean).join('\n\n');
}

/**
 * A spec part's definition, checked: it needs `## Problem` and `## Goal`,
 * each with content — the two sections Shape always fills. The text itself
 * becomes the spec's body as written.
 * → `{ ok: true, body }` or `{ ok: false, reason: 'empty' | 'noProblem' | 'noGoal' }`.
 */
function parseSpecDefinition(text) {
  const body = str(text).trim();
  if (!body) return { ok: false, reason: 'empty' };
  const { sections } = splitSections(body);
  if (!sectionBody(sections, 'Problem')) return { ok: false, reason: 'noProblem' };
  if (!sectionBody(sections, 'Goal')) return { ok: false, reason: 'noGoal' };
  return { ok: true, body };
}

/**
 * A task part's definition → the task's fields. `## Description` is required;
 * `## Acceptance Criteria` and `## Notes` are optional; a section under any
 * other heading is added to `notes` under its heading, so nothing is lost.
 * Text before the first heading has nowhere to go and is refused.
 * → `{ ok: true, fields: { description, acceptanceCriteria?, notes? } }` or
 * `{ ok: false, reason: 'empty' | 'textBeforeHeading' | 'noDescription' }`.
 */
function parseTaskDefinition(text) {
  if (!str(text).trim()) return { ok: false, reason: 'empty' };
  const { preamble, sections } = splitSections(text);
  if (preamble) return { ok: false, reason: 'textBeforeHeading' };
  const description = sectionBody(sections, 'Description');
  if (!description) return { ok: false, reason: 'noDescription' };
  const known = ['Description', 'Acceptance Criteria', 'Notes'];
  const extra = sections
    .filter((s) => s.body && !known.some((k) => sameHeading(s.heading, k)))
    .map((s) => `## ${s.heading}\n\n${s.body}`);
  const fields = { description };
  const acceptanceCriteria = sectionBody(sections, 'Acceptance Criteria');
  if (acceptanceCriteria) fields.acceptanceCriteria = acceptanceCriteria;
  const notes = [sectionBody(sections, 'Notes'), ...extra].filter(Boolean).join('\n\n');
  if (notes) fields.notes = notes;
  return { ok: true, fields };
}

// ─── Refs ─────────────────────────────────────────────────────

/** `base`, else `base-2`, `base-3`… — the first not in `taken`. A spec slug stays within 48 characters. */
function freeName(base, taken, max = Infinity) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const name = `${base.slice(0, max - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Each part's `recordRef`, in part order, named from its key or else its
 * title: a spec part's slug is checked
 * against the folder names in `.frame/specs/`, a task part's id
 * (`task-<slug>`) against every id in `tasks.json`, and refs picked earlier
 * in the same start count as taken. A title with no slug falls back to
 * `brief-<N>-part-<P>` (P counting from 1).
 * → `[{ partId, shape, ref }]`.
 */
function allocateRefs(parts, { specSlugs = [], taskIds = [] } = {}, number = 0) {
  const taken = { spec: new Set(specSlugs), task: new Set(taskIds) };
  return arr(parts).map((part, index) => {
    const slug = partName(part, `brief-${number}-part-${index + 1}`);
    const ref = part.shape === 'spec'
      ? freeName(slug, taken.spec, SLUG_MAX)
      : freeName(`task-${slug}`, taken.task);
    taken[part.shape === 'spec' ? 'spec' : 'task'].add(ref);
    return { partId: part.id, shape: part.shape === 'spec' ? 'spec' : 'task', ref };
  });
}

// ─── Files ────────────────────────────────────────────────────

/**
 * A spec part's folder: `spec.md` is the part's title as a heading over the
 * definition as written, and `status.json` is spec.new's required shape in
 * phase `specified`. `now` is an ISO timestamp.
 * → `{ 'spec.md': text, 'status.json': text }`.
 */
function specFiles({ slug, title, definition, now }) {
  const status = {
    slug,
    title,
    phase: 'specified',
    generated_task_ids: [],
    created_at: now,
    updated_at: now,
    last_phase_at: now,
  };
  return {
    'spec.md': `# ${title}\n\n${str(definition).trim()}\n`,
    'status.json': `${JSON.stringify(status, null, 2)}\n`,
  };
}

/** A title within 60 characters: cut at the last space inside the limit, or hard at 60. */
function taskTitle(title) {
  const t = str(title).trim();
  if (t.length <= TASK_TITLE_MAX) return t;
  const cut = t.slice(0, TASK_TITLE_MAX + 1).lastIndexOf(' ');
  return (cut > 0 ? t.slice(0, cut) : t.slice(0, TASK_TITLE_MAX)).trimEnd();
}

/**
 * A task part's `tasks.json` row, pending. `fields` is parseTaskDefinition's;
 * the priority is the brief's (medium when it has none), the category the
 * part's type.
 */
function taskRow({ part, fields, id, brief, now }) {
  const row = { id, title: taskTitle(part.title), description: fields.description };
  if (fields.acceptanceCriteria) row.acceptanceCriteria = fields.acceptanceCriteria;
  if (fields.notes) row.notes = fields.notes;
  return {
    ...row,
    status: 'pending',
    priority: brief.priority || 'medium',
    category: part.type,
    context: `Frame Cloud brief #${brief.number}`,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

/** Open, shaped, unstarted work: the only brief Start Work offers itself on. */
function startable(brief) {
  const b = brief || {};
  return b.kind === 'work' && b.status !== 'closed' && Boolean(b.shapedAt) && !b.startedAt;
}

// ─── Begun parts ──────────────────────────────────────────────
//
// Which parts this machine began, on which branch, and from which commit
// (`baseSha`, kept since frame-cloud-brief-done). Begin now sends the branch
// to the cloud too (`brief.recordBranch`), so every machine can show it; this
// store stays the machine's own record, for parts begun before that and for
// telling this machine's deleted branch from a teammate's. A part begun in a
// workspace on a Frame Server also keeps that server's key (`serverKey`,
// frame-cloud-start-on-server D13); an entry without one is This Mac's. A
// part begun in the project checkout keeps `place: 'checkout'` and its
// `title` (frame-cloud-start-places D2), so the checkout's lock can name it.

function isNonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function begunKey(projectId, number, partId) {
  return `${projectId}:${number}:${partId}`;
}

/** A full commit id as `git rev-parse` prints it: 40 lowercase hex characters. */
function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

/**
 * `{ ref, branch, begunAt, baseSha?, serverKey?, place?, title? }`, or null.
 * `baseSha` is optional: older entries have none. No `serverKey` means This
 * Mac, and no `place` a workspace, so the store grows without a migration.
 * `place` is only ever 'checkout', and `title` is kept only with it.
 */
function normalizeBegunEntry(raw) {
  const e = obj(raw);
  if (!isNonEmpty(e.ref) || !isNonEmpty(e.branch) || !isNonEmpty(e.begunAt)) return null;
  const entry = { ref: e.ref, branch: e.branch, begunAt: e.begunAt };
  if (isSha(e.baseSha)) entry.baseSha = e.baseSha;
  if (isNonEmpty(e.serverKey)) entry.serverKey = e.serverKey;
  if (e.place === 'checkout' && !entry.serverKey) {
    entry.place = 'checkout';
    if (isNonEmpty(e.title)) entry.title = e.title;
  }
  return entry;
}

function emptyBegun() {
  return { version: 1, begun: {} };
}

/** Any shape in → a valid store out: malformed entries and keys are dropped. */
function normalizeBegun(store) {
  const out = emptyBegun();
  for (const [key, raw] of Object.entries(obj(obj(store).begun))) {
    const entry = /^[^:]+:\d+:[^:]+$/.test(key) ? normalizeBegunEntry(raw) : null;
    if (entry) out.begun[key] = entry;
  }
  return out;
}

/** The store with one part recorded as begun (a later Begin of the same part replaces it). */
function addBegun(store, { projectId, number, partId, ref, branch, begunAt, baseSha, serverKey, place, title }) {
  const base = normalizeBegun(store);
  const entry = normalizeBegunEntry({ ref, branch, begunAt, baseSha, serverKey, place, title });
  if (!isNonEmpty(projectId) || !Number.isInteger(number) || !isNonEmpty(partId) || !entry) return base;
  return { version: 1, begun: { ...base.begun, [begunKey(projectId, number, partId)]: entry } };
}

/** `{ ref, branch, begunAt, baseSha?, serverKey?, place?, title? }` for a part this machine began, or null. */
function getBegun(store, projectId, number, partId) {
  const begun = obj(obj(store).begun);
  const key = begunKey(projectId, number, partId);
  return Object.prototype.hasOwnProperty.call(begun, key) ? normalizeBegunEntry(begun[key]) : null;
}

/**
 * Does a begun entry still stand? A Mac entry while `localBranches` (a Set
 * of this folder's branch names) has its branch. A server entry while its
 * server is in `servers` (`{ [serverKey]: Set | null }`, the saved servers)
 * and that server's set has the branch, or is null because the server is
 * offline or could not list it (D13). A server no longer saved cannot be
 * reached or listed, so its entry no longer stands (D4). Left out, either
 * map counts every entry of its kind.
 */
function begunLive(entry, localBranches = null, servers = null) {
  if (!entry) return false;
  if (!entry.serverKey) return !localBranches || localBranches.has(entry.branch);
  if (!servers) return true;
  if (!Object.prototype.hasOwnProperty.call(servers, entry.serverKey)) return false;
  const onServer = servers[entry.serverKey];
  return !onServer || onServer.has(entry.branch);
}

/**
 * The briefs with `begunBranch` (a branch, or null) and `branchGone` on each
 * listed part, `begunServerKey` on a part begun on a Frame Server, and
 * `begunPlace: 'checkout'` on one begun in the project checkout.
 * An entry that no longer stands (`begunLive`) — its branch deleted since,
 * or its server removed — lets the part wait to be begun again.
 * `branchGone` is true when that entry's branch is also the part's cloud
 * `branch`: this machine began it there and lost it, so the cloud's branch
 * must not keep the row at "On <branch>". A cloud branch begun on another
 * machine is never gone here. Briefs without parts are left as they are.
 */
function withBegunBranches(briefs, store, projectId, localBranches = null, servers = null) {
  return arr(briefs).map((brief) => {
    if (!Array.isArray(brief.parts)) return brief;
    return {
      ...brief,
      parts: brief.parts.map((part) => {
        const entry = getBegun(store, projectId, brief.number, part.id);
        const live = begunLive(entry, localBranches, servers);
        const branchGone = Boolean(entry && !live && part.branch && part.branch === entry.branch);
        const out = { ...part, begunBranch: live ? entry.branch : null, branchGone };
        if (live && entry.serverKey) out.begunServerKey = entry.serverKey;
        if (live && entry.place === 'checkout') out.begunPlace = 'checkout';
        return out;
      }),
    };
  });
}

// ─── The project checkout ─────────────────────────────────────

/**
 * The begun part that keeps the project checkout busy (frame-cloud-start-places
 * D1, D15): an entry of `projectId` begun in the checkout, whose branch is
 * the checkout's `currentBranch`, and whose record `isFinished(entry)` says
 * is not finished yet (its spec is not `done`, its task not `completed`).
 * → `{ title, ref, branch }`, the title falling back to the ref, or null.
 */
function checkoutBusy(store, projectId, currentBranch, isFinished = () => false) {
  if (!isNonEmpty(projectId) || !isNonEmpty(currentBranch)) return null;
  const prefix = `${projectId}:`;
  for (const [key, raw] of Object.entries(obj(obj(store).begun))) {
    if (!key.startsWith(prefix)) continue;
    const entry = normalizeBegunEntry(raw);
    if (!entry || entry.place !== 'checkout' || entry.branch !== currentBranch) continue;
    if (isFinished(entry)) continue;
    return { title: entry.title || entry.ref, ref: entry.ref, branch: entry.branch };
  }
  return null;
}

/**
 * Why the project checkout cannot take a part now, or null (D6, D14): a busy
 * part first — `{ reason: 'checkoutBusy', part: <title>, detail: <branch> }` —
 * then uncommitted changes — `{ reason: 'checkoutDirty', detail: <count> }`.
 * The checkout is never stashed, so either one locks it.
 */
function checkoutBlock({ changes, busy } = {}) {
  if (busy && isNonEmpty(busy.branch)) return { reason: 'checkoutBusy', part: str(busy.title) || str(busy.ref), detail: busy.branch };
  const count = Number(changes) || 0;
  if (count > 0) return { reason: 'checkoutDirty', detail: count };
  return null;
}

// ─── The dialog and the start ─────────────────────────────────

/**
 * What the branch is cut from by default: `origin/<targetBranch>`, which the
 * start fetches first, else the local `targetBranch`, else null. Origin's
 * copy wins because a local branch can be behind it, and New Workspace cuts
 * from origin's copy too (frame-cloud-start-workspace T11). The project
 * checkout prefers the local target (`prefer: 'local'`,
 * frame-cloud-start-places D13): it is switched where the user works.
 */
function pickBase(targetBranch, { local, remote }, { prefer = 'origin' } = {}) {
  if (!targetBranch) return null;
  if (prefer === 'local' && local) return targetBranch;
  if (remote) return `origin/${targetBranch}`;
  if (local) return targetBranch;
  return null;
}

/**
 * Each place's default base (D13, D17): the checkout's local target first,
 * a workspace's `origin/<target>` first, and a server's `origin/<target>`
 * only, since a server cuts from origin alone. `targetOn` says where the
 * brief's target exists: `{ local, remote }`.
 */
function placeBases(targetBranch, targetOn) {
  const on = obj(targetOn);
  return {
    checkout: pickBase(targetBranch, on, { prefer: 'local' }),
    workspace: pickBase(targetBranch, on),
    server: targetBranch && on.remote ? `origin/${targetBranch}` : null,
  };
}

/** The checkout's facts as the dialog reads them, or null when main gave none. */
function checkoutView(checkout) {
  if (!checkout || typeof checkout !== 'object') return null;
  const busy = checkout.busy && isNonEmpty(checkout.busy.branch)
    ? { title: str(checkout.busy.title) || str(checkout.busy.ref), ref: str(checkout.busy.ref), branch: checkout.busy.branch }
    : null;
  return {
    path: str(checkout.path),
    branch: str(checkout.branch),
    changes: Number.isInteger(checkout.changes) && checkout.changes > 0 ? checkout.changes : 0,
    busy,
  };
}

/**
 * The workspace's base for a branch cut from `base`: a branch name, never a
 * remote ref (`origin/main` → `main`), because the workspace record's base
 * drives ↓behind, the PR's base and Update from base.
 */
function workspaceBase(base) {
  const b = str(base).trim();
  return b.startsWith('origin/') ? b.slice('origin/'.length) : b;
}

/**
 * The branches the dialog's "from" menu offers, from gitBranchesManager's
 * list: local branches newest first, then origin's (its HEAD pointer left
 * out). → `[{ name, remote }]`.
 */
function baseOptions(branches) {
  const rows = arr(branches).filter((b) => b && typeof b.name === 'string' && b.name);
  const byTime = (a, b) => (b.time || 0) - (a.time || 0);
  const local = rows.filter((b) => !b.isRemote).sort(byTime).map((b) => ({ name: b.name, remote: false }));
  const remote = rows
    .filter((b) => b.isRemote && b.name.startsWith('origin/') && b.name !== 'origin/HEAD')
    .sort(byTime)
    .map((b) => ({ name: b.name, remote: true }));
  return [...local, ...remote];
}

/**
 * Fetch an `origin/<name>` base, so the branch is cut from origin's latest.
 * Never throws: a failure is reported, and the branch is cut from the last
 * fetched copy. A local base is not fetched (`skipped`).
 * → `{ fetched, error, skipped }`.
 */
async function fetchBase(base, deps) {
  if (!base.startsWith('origin/') || !deps.fetchBase) return { fetched: false, error: null, skipped: true };
  try {
    const result = obj(await deps.fetchBase(base.slice('origin/'.length)));
    return { fetched: result.fetched === true, error: result.fetched === true ? null : errorText(result.error || 'the fetch failed'), skipped: false };
  } catch (err) {
    return { fetched: false, error: errorText(err), skipped: false };
  }
}

/** Does `base` name a branch this folder has: a local one, or `origin/<name>`? */
async function baseExists(base, deps) {
  if (!base) return false;
  if (await deps.localBranchExists(base)) return true;
  return base.startsWith('origin/') && deps.remoteBranchExists(base.slice('origin/'.length));
}

/** Why a part's definition does not parse, or null when it does. */
function definitionProblem(part) {
  const parsed = part.shape === 'spec' ? parseSpecDefinition(part.definition) : parseTaskDefinition(part.definition);
  return parsed.ok ? null : parsed.reason;
}

/** The branch each part suggests: its type's prefix and its title's slug. */
function branchSuggestions(brief) {
  const byPart = {};
  arr(brief.parts).forEach((part, index) => {
    byPart[part.id] = suggestBranchName(part.type, part, `brief-${brief.number}-part-${index + 1}`);
  });
  return byPart;
}

/** Open, shaped work that was started: its parts not begun yet are begun one by one. */
function beginnable(brief) {
  const b = brief || {};
  return b.kind === 'work' && b.status !== 'closed' && Boolean(b.shapedAt) && Boolean(b.startedAt);
}

/** 'start' for a brief not started yet, 'begin' for a started one, or null for neither. */
function startMode(brief) {
  if (!brief || arr(brief.parts).length === 0) return null;
  if (startable(brief)) return 'start';
  return beginnable(brief) ? 'begin' : null;
}

/**
 * What the Start Work dialog shows for a brief detail and the folder's branches.
 * `begun` maps a part id to the branch this machine began it on. In 'start'
 * mode every part can be begun; in 'begin' mode only one with a reserved ref
 * that was not begun yet. A part whose definition does not parse carries its
 * `problem` and cannot be begun.
 * → `{ ok: true, mode, number, title, targetBranch, parts: [{ partId, title,
 * shape, type, ref, begunBranch, problem, canBegin }], suggestions, base,
 * bases }` or `{ ok: false, reason: 'notStartable' }`.
 * `base` is the default (the target, origin's else local) and `bases` what
 * the "from" menu offers.
 *
 * For the three places (frame-cloud-start-places D17) the view also carries
 * `placeBases` (each place's default base, from `targetOn: { local, remote }`,
 * all null without it), `checkout: { path, branch, changes, busy }` (the
 * project checkout's state; null when not given) and `workspaceFolder`
 * (where a new workspace's folder goes on this Mac; null when not given).
 */
function prepareView({ brief, base, begun = {}, branches = [], targetOn = null, checkout = null, workspaceFolder = null }) {
  const b = obj(brief);
  const mode = startMode(b);
  if (!mode) return { ok: false, reason: 'notStartable' };
  return {
    ok: true,
    mode,
    number: b.number,
    title: b.title,
    targetBranch: b.targetBranch,
    parts: b.parts.map((p) => {
      const problem = definitionProblem(p);
      const begunBranch = obj(begun)[p.id] || null;
      const open = mode === 'start' || (Boolean(p.recordRef) && !begunBranch);
      return {
        partId: p.id,
        title: p.title,
        shape: p.shape,
        type: p.type,
        ref: p.recordRef || null,
        begunBranch,
        problem,
        canBegin: open && !problem,
      };
    }),
    suggestions: branchSuggestions(b),
    base: base || null,
    bases: baseOptions(branches),
    placeBases: placeBases(b.targetBranch, targetOn),
    checkout: checkoutView(checkout),
    workspaceFolder: isNonEmpty(workspaceFolder) ? workspaceFolder : null,
  };
}

function errorText(err) {
  return (err && err.message) || String(err || 'unknown error');
}

/**
 * Does this machine's begun entry still stand in the way of Begin? The
 * service answers it (`deps.begunStands`) for a server entry by D13's rule;
 * without that dep, the Mac's branch decides, as before.
 */
async function begunStands(entry, deps) {
  if (deps.begunStands) return Boolean(await deps.begunStands(entry));
  return deps.localBranchExists(entry.branch);
}

/** `alreadyBegun`'s detail: the branch, and the host when the part is on a server (D5). */
async function begunDetail(entry, deps) {
  if (!entry.serverKey || !deps.hostOf) return entry.branch;
  const host = str(await deps.hostOf(entry.serverKey));
  return host ? `${entry.branch} on ${host}` : entry.branch;
}

/**
 * The checks a server start runs before `brief.start` (D9, D15): a base on
 * origin only, then the server's own preflight — reached, new enough, the
 * project on it, the branch free in its clone, origin holding the base.
 * → `{ ok: true, base, fetch, tasksPath }` or a refusal.
 */
async function serverChecks({ brief, branch, chosenBase }, deps) {
  let base;
  if (chosenBase) {
    if (!chosenBase.startsWith('origin/')) return { ok: false, reason: 'baseNotOnOrigin', detail: chosenBase };
    base = chosenBase;
  } else {
    if (!isNonEmpty(brief.targetBranch)) return { ok: false, reason: 'baseMissing', detail: brief.targetBranch };
    base = `origin/${brief.targetBranch}`;
  }
  if (!deps.serverPreflight) return { ok: false, reason: 'serverUnavailable', detail: '' };
  let pre;
  try {
    pre = obj(await deps.serverPreflight({ branch, base: workspaceBase(base) }));
  } catch (err) {
    return { ok: false, reason: 'serverUnavailable', detail: errorText(err) };
  }
  if (pre.ok === false) return { ok: false, reason: pre.reason === 'serverOld' ? 'serverOld' : 'serverUnavailable', detail: str(pre.detail) };
  if (pre.branchTaken) return { ok: false, reason: 'branchTaken', detail: branch };
  if (!pre.baseOnOrigin) return { ok: false, reason: 'baseNotOnOrigin', detail: base };
  const f = obj(pre.fetch);
  const fetch = { fetched: f.fetched === true, error: f.fetched === true ? null : errorText(f.error || 'the fetch failed'), skipped: false };
  const sent = pre.sent && typeof pre.sent === 'object' ? { uncommitted: Number(pre.sent.uncommitted) || 0 } : null;
  return { ok: true, base, fetch, tasksPath: str(pre.tasksPath) || null, sent };
}

/**
 * A Start Work or Begin request (`{ number, beginPartId, branch, base,
 * serverKey? }`) → what happened. One part is begun each time, in a workspace of its own
 * (frame-cloud-start-workspace): its branch is cut from the brief's target
 * without touching the main checkout, a new workspace opens that branch, and
 * only that part is written — a spec part's folder into the workspace, a
 * task part's row into the main checkout's `tasks.json`, where task state
 * lives (spec-in-workspace). On a brief not started yet
 * ('start'), every part's ref is picked against the folder and exactly one
 * `brief.start` reserves them all; the other parts stay in the cloud. On a
 * started brief ('begin'), the part's reserved ref is used and nothing is
 * sent.
 *
 * Every local check runs first — the part exists and can be begun, its
 * definition parses, the branch name is valid and free, the base (the
 * user's pick, else the brief's target) exists — so a refusal writes
 * nothing, locally or in the cloud. An `origin/` base is then fetched
 * (`deps.fetchBase`), before `brief.start`; a failed fetch is no refusal,
 * the branch is cut from the last fetched copy and the answer's `fetch`
 * says so. A local base is cut as it is. The folder's uncommitted changes are not
 * asked about (frame-cloud-start-workspace): nothing is stashed. A failure
 * after that is `partial`: the brief is started either way,
 * and the answer names the step and the part that was not written. Only a
 * part fully written is recorded as begun.
 *
 * Once it is, the branch goes to the cloud (`deps.recordBranch`) with the
 * commit it was cut from (`deps.branchSha(branch)`, the new branch's tip,
 * read right after it is cut — never the main checkout's HEAD).
 * That call is not awaited and its failure is swallowed: it never changes
 * Begin's answer, and the next Briefs read sends it again (frame-cloud-brief-done
 * D6, D9). Without a full commit id it is skipped.
 *
 * `deps`: `{ call, projectSlug, specSlugs(), taskIds(),
 * isValidBranchName(name), localBranchExists(name),
 * remoteBranchExists(name), fetchBase(name) → { fetched, error },
 * begun(partId) → { branch } | null,
 * createBranch(name, base, { track }) (cut, not checked out),
 * branchSha(name) → sha | null, createWorkspace(branch, base) → { workspace:
 * { id, name, path, branch, base }, setupScript }, writeSpec(slug, files,
 * root), writeTasks(rows), tasksPath() → the main checkout's tasks.json,
 * recordBegun({ partId, ref, branch, baseSha }), recordBranch({ id, partId,
 * branch, baseSha }), now() }`; each may be async, and the effects throw on
 * failure.
 *
 * Success carries `workspace` and its `setupScript`, which the renderer runs
 * before it opens the lane there, and `fetch: { fetched, error, skipped }`; a task part's `begin` also carries
 * `tasksPath`, so the task run updates the main checkout's file. Partial
 * steps: `branch`, `workspace` (the branch stays) and `files`.
 *
 * With `serverKey` the part starts on that Frame Server
 * (frame-cloud-start-on-server). The base must be `origin/<x>` (D15), and
 * `deps.serverPreflight({ branch, base })` → `{ branchTaken, baseOnOrigin,
 * fetch, tasksPath }`, or `{ ok: false, reason: 'serverUnavailable' |
 * 'serverOld', detail }`, runs before `brief.start` (D9); the Mac's branches
 * are not asked. No branch is cut here: `deps.createWorkspace` cuts it on
 * the server and answers `startSha`, the `baseSha` (D6). The service binds
 * `createWorkspace`, `writeSpec` and `writeTasks` to that server; the task
 * part's `tasksPath` is the server clone's, from the preflight. The begun
 * record keeps `serverKey`. Begin's guard asks `deps.begunStands(entry)`
 * when given (D14), and `deps.hostOf(serverKey)` names the host in
 * `alreadyBegun` (D5). When the preflight had to send the project there
 * (`sent: { uncommitted }`), the answer carries `sent` too (T12).
 *
 * `place` names where the part runs (frame-cloud-start-places D11):
 * 'checkout', 'workspace' or 'server'. Without it a `serverKey` means a
 * server, else a workspace; a server without a `serverKey`, or another place
 * with one, is `badRequest`. In the project checkout ('checkout', D12) the
 * lock is checked first, from `deps.checkoutState()` → `{ branch, changes,
 * busy }` (`checkoutBusy` / `checkoutDirty`, D14) — the checkout is never
 * stashed. The base defaults to the local target (D13). After `brief.start`
 * the branch is cut and checked out in the project folder
 * (`deps.createBranch(name, base, { track, checkout: true })`), no workspace
 * is opened, and the spec is written under `deps.checkoutPath`; the begun
 * record keeps `place: 'checkout'` and the part's title. The answer carries
 * `place`, `workspace: null` and `checkout: { from }`, the branch it left.
 * Partial steps there: `branch` and `files`.
 */
async function handleStartRequest(request, deps) {
  const r = obj(request);
  const serverKey = isNonEmpty(r.serverKey) ? r.serverKey : null;
  const place = PLACES.includes(r.place) ? r.place : (serverKey ? 'server' : 'workspace');
  if ((place === 'server') !== Boolean(serverKey)) return { ok: false, reason: 'badRequest' };
  const inCheckout = place === 'checkout';

  const read = await deps.call((ctx) => getBrief({ ...ctx, projectSlug: deps.projectSlug, number: r.number }));
  if (!read.ok) return { ok: false, reason: read.reason };
  const brief = read.value;
  const mode = startMode(brief);
  if (!mode) return { ok: false, reason: 'notStartable' };

  const part = brief.parts.find((p) => p.id === r.beginPartId);
  if (!part) return { ok: false, reason: 'badRequest' };
  if (mode === 'begin') {
    if (!part.recordRef) return { ok: false, reason: 'notStartable' };
    const begun = await deps.begun(part.id);
    // A record whose branch is gone (deleted since) no longer stands in the way.
    if (begun && await begunStands(begun, deps)) return { ok: false, reason: 'alreadyBegun', detail: await begunDetail(begun, deps) };
  }

  const problem = definitionProblem(part);
  if (problem) return { ok: false, reason: 'badDefinition', part: part.title, detail: problem };

  const refs = mode === 'start'
    ? allocateRefs(brief.parts, { specSlugs: await deps.specSlugs(), taskIds: await deps.taskIds() }, brief.number)
    : null;
  const ref = refs ? refs[brief.parts.indexOf(part)].ref : part.recordRef;

  const branch = str(r.branch).trim() || branchSuggestions(brief)[part.id];
  if (!deps.isValidBranchName(branch)) return { ok: false, reason: 'badBranch', detail: branch };

  // The base the user picked, else the brief's target (origin's, else local;
  // local first in the project checkout).
  const chosenBase = str(r.base).trim();
  let base;
  let fetch;
  let serverTasksPath = null;
  let sent = null;
  let checkoutFrom = '';
  if (serverKey) {
    const checked = await serverChecks({ brief, branch, chosenBase }, deps);
    if (!checked.ok) return checked;
    ({ base, fetch, sent } = checked);
    serverTasksPath = checked.tasksPath;
  } else {
    if (inCheckout) {
      // Main reads the checkout again: the renderer's lock is not trusted (C2).
      if (!deps.checkoutState) return { ok: false, reason: 'other' };
      const state = obj(await deps.checkoutState());
      const block = checkoutBlock(state);
      if (block) return { ok: false, ...block };
      checkoutFrom = str(state.branch);
    }
    if (await deps.localBranchExists(branch)) return { ok: false, reason: 'branchTaken', detail: branch };
    if (chosenBase) {
      if (!await baseExists(chosenBase, deps)) return { ok: false, reason: 'baseMissing', detail: chosenBase };
      base = chosenBase;
    } else {
      base = pickBase(brief.targetBranch, {
        local: await deps.localBranchExists(brief.targetBranch),
        remote: await deps.remoteBranchExists(brief.targetBranch),
      }, { prefer: inCheckout ? 'local' : 'origin' });
      if (!base) return { ok: false, reason: 'baseMissing', detail: brief.targetBranch };
    }
    fetch = await fetchBase(base, deps);
  }

  if (refs) {
    const started = await startThrough(deps.call, {
      id: brief.id,
      parts: refs.map((x) => ({ partId: x.partId, recordRef: x.ref })),
    });
    if (!started.ok) return { ok: false, reason: started.reason };
  }

  // The brief is started in the cloud from here: a failure is reported, never undone.
  const partial = (step, err) => ({
    ok: false,
    reason: 'partial',
    step,
    written: [],
    missing: [{ title: part.title, shape: part.shape, ref }],
    error: errorText(err),
  });

  let baseSha = null;
  if (!serverKey) {
    try {
      // A remote base is cut without tracking, so the work branch does not track
      // it. In the project checkout the branch is also checked out there.
      const track = !base.startsWith('origin/');
      await deps.createBranch(branch, base, inCheckout ? { track, checkout: true } : { track });
    } catch (err) {
      return partial('branch', err);
    }

    // The commit the branch was cut from: its own tip, right after it is cut.
    // Worktrees share refs with the main repository, so this is the same
    // commit the workspace starts at.
    try {
      const tip = deps.branchSha ? await deps.branchSha(branch) : null;
      baseSha = isSha(tip) ? tip : null;
    } catch {
      baseSha = null;
    }
  }

  // The part's own workspace, opened on the branch just cut — or, on a
  // server, cut and opened there in one call. A failure leaves a Mac branch
  // where it is: Start Work can be finished from it by hand. The server
  // drops its own half-made branch. The project checkout opens none.
  let workspace = null;
  let setupScript = '';
  if (!inCheckout) {
    try {
      const created = obj(await deps.createWorkspace(branch, workspaceBase(base)));
      const ws = obj(created.workspace);
      if (!isNonEmpty(ws.id) || !isNonEmpty(ws.path)) throw new Error('the workspace was not created');
      workspace = { id: ws.id, name: str(ws.name), path: ws.path, branch: str(ws.branch) || branch, base: ws.base || null };
      if (serverKey) {
        workspace.location = 'server';
        workspace.serverKey = serverKey;
        if (isNonEmpty(ws.host)) workspace.host = ws.host;
        baseSha = isSha(created.startSha) ? created.startSha : null;
      }
      setupScript = str(created.setupScript);
    } catch (err) {
      return partial('workspace', err);
    }
  }

  const now = deps.now();
  let begin;
  try {
    if (part.shape === 'spec') {
      const root = inCheckout ? deps.checkoutPath : workspace.path;
      await deps.writeSpec(ref, specFiles({ slug: ref, title: part.title, definition: part.definition, now }), root);
      begin = { shape: 'spec', slug: ref, title: part.title };
    } else {
      const row = taskRow({ part, fields: parseTaskDefinition(part.definition).fields, id: ref, brief, now });
      const tasksPath = serverKey ? serverTasksPath : (str(deps.tasksPath ? await deps.tasksPath() : '') || null);
      await deps.writeTasks([row]);
      begin = {
        shape: 'task',
        task: { id: row.id, title: row.title, description: row.description, priority: row.priority },
        tasksPath,
      };
    }
  } catch (err) {
    return partial('files', err);
  }
  const entry = { partId: part.id, ref, branch, baseSha };
  if (serverKey) entry.serverKey = serverKey;
  if (inCheckout) Object.assign(entry, { place: 'checkout', title: part.title });
  await deps.recordBegun(entry);
  if (baseSha && deps.recordBranch) {
    // Fired, not awaited: a failure never reaches Begin's answer.
    (async () => deps.recordBranch({ id: brief.id, partId: part.id, branch, baseSha }))().catch(() => {});
  }

  return {
    ok: true,
    mode,
    number: brief.number,
    branch,
    part: { title: part.title, shape: part.shape, ref },
    specs: part.shape === 'spec' ? 1 : 0,
    tasks: part.shape === 'task' ? 1 : 0,
    begin,
    place,
    workspace,
    setupScript,
    fetch,
    ...(sent ? { sent } : {}),
    ...(inCheckout ? { checkout: { from: checkoutFrom } } : {}),
  };
}

module.exports = {
  PLACES,
  SLUG_MAX,
  BRANCH_NAME_MAX,
  TASK_TITLE_MAX,
  BRANCH_PREFIXES,
  slugify,
  suggestBranchName,
  parseSpecDefinition,
  parseTaskDefinition,
  allocateRefs,
  specFiles,
  taskTitle,
  taskRow,
  startable,
  beginnable,
  startMode,
  isSha,
  emptyBegun,
  normalizeBegun,
  addBegun,
  getBegun,
  begunLive,
  withBegunBranches,
  checkoutBusy,
  checkoutBlock,
  pickBase,
  placeBases,
  workspaceBase,
  baseOptions,
  prepareView,
  handleStartRequest,
};
