/**
 * cloudProjects — the pure core of Frame Cloud projects.
 *
 * Reads the cloud workspace's projects and decides, for this device's known
 * folders, which of them is which cloud project. A folder is connected to a
 * project when the project's `frameProjectId` equals the folder's own
 * `projectId` — never by path, name or remote.
 *
 * Like deviceFlow.js, nothing here imports Electron or touches a file: every
 * call takes `{ api, token, fetchJson, signal }`, so `cloudProjectsService.js`
 * is a thin shell and `node --test` runs the whole thing with a fake fetch.
 */

const { callTrpc, LOOPBACK_HOSTS } = require('./deviceFlow');

// FrameCloud's slug rule: 3–32 characters of a-z and 0-9, hyphens only
// between two of them.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 32;

// Project slugs the web app's routes already use.
const RESERVED_SLUGS = new Set(['new', 'briefs', 'import', 'settings', 'members', 'projects', 'inbox', 'search']);

const MATCH_LABELS = {
  id: 'Your repository',
  remote: 'Same remote',
  name: 'Same name',
};

// ─── Roles ────────────────────────────────────────────────────

/**
 * What a workspace role may do, copied literally from FrameCloud's protocol
 * (`WORKSPACE_PERMISSIONS` in `entities/workspace.ts`, workspace-invites-and-
 * roles). Reading needs only membership, so no permission names it.
 *
 * - `work`: every brief and milestone write, linking a folder to an existing
 *   project.
 * - `manage`: adding projects (here, `link.create`), and the workspace's
 *   settings, members and GitHub connection on the web.
 *
 * The server enforces this on every request; Frame mirrors it only to offer
 * what the role can do and to refuse in main before sending.
 */
const WORKSPACE_PERMISSIONS = Object.freeze({
  work: Object.freeze(['admin', 'developer']),
  manage: Object.freeze(['admin']),
});

/** Whether `role` holds `permission` — the protocol's `can()`. An unknown role holds nothing. */
function can(role, permission) {
  const roles = Object.prototype.hasOwnProperty.call(WORKSPACE_PERMISSIONS, permission)
    ? WORKSPACE_PERMISSIONS[permission]
    : [];
  return roles.includes(role);
}

/** The two answers the renderer gets: `{ work, manage }` for `role`. */
function permissionsOf(role) {
  return { work: can(role, 'work'), manage: can(role, 'manage') };
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function slugShapeOk(slug) {
  return typeof slug === 'string' && slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_RE.test(slug);
}

// ─── Reading ──────────────────────────────────────────────────

/**
 * One `project.list` entry, reduced to the fields Frame uses. `thisDevice` is
 * whether the calling device is connected to it (FrameCloud
 * device-connections, `connection.thisDevice`); anything but `true` is no.
 */
function normalizeProject(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const status = p.status && typeof p.status === 'object' ? p.status : {};
  const connection = p.connection && typeof p.connection === 'object' ? p.connection : {};
  return {
    id: str(p.id),
    slug: str(p.slug),
    name: str(p.name),
    source: status.source === 'github' ? 'github' : 'scratch',
    frameProjectId: str(p.frameProjectId) || null,
    thisDevice: connection.thisDevice === true,
    createdAt: str(p.createdAt),
  };
}

/** `project.list` → normalized projects, server order. */
async function listProjects({ api, token, fetchJson, signal }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'project.list', method: 'GET' });
  return Array.isArray(data) ? data.map(normalizeProject).filter((p) => p.id) : [];
}

// ─── Matching ─────────────────────────────────────────────────

/**
 * The workspace's projects and this device's folders, seen from each side.
 *
 *   projects: normalized `project.list` entries.
 *   folders:  [{ path, name, projectId | null }], in display order.
 *
 * → {
 *     projectRows: [{ id, slug, name, source, state, folderNames, openPath }],
 *     folderRows:  [{ path, name, connected, ready, project: { id, slug, name } | null }],
 *   }
 *
 * A folder is a project's when the project's identity equals the folder's
 * `projectId`; an id the list no longer names belongs to no project (S8).
 * Connected is this device's, never the identity's: a teammate's clone of a
 * claimed project is recognised (`ready`) but not connected until this device
 * connects (frame-cloud-teammate-connection). A project row's `state`:
 *
 *   connected    — this device is connected, with or without a folder here
 *   ready        — a folder here carries its identity; this device is not connected
 *   notConnected — it has an identity, and no folder here carries it
 *   notClaimed   — no folder has claimed it
 */
function matchFolders(projects, folders) {
  const list = Array.isArray(projects) ? projects : [];
  const local = Array.isArray(folders) ? folders : [];

  const byIdentity = new Map();
  for (const p of list) {
    if (p.frameProjectId && !byIdentity.has(p.frameProjectId)) byIdentity.set(p.frameProjectId, p);
  }

  const folderRows = local.map((f) => {
    const project = f.projectId ? byIdentity.get(f.projectId) : undefined;
    return {
      path: f.path,
      name: f.name,
      connected: Boolean(project && project.thisDevice),
      ready: Boolean(project && !project.thisDevice),
      project: project ? { id: project.id, slug: project.slug, name: project.name } : null,
    };
  });

  const projectRows = list.map((p) => {
    const here = p.frameProjectId ? local.filter((f) => f.projectId === p.frameProjectId) : [];
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      source: p.source,
      state: projectState(p, here.length),
      folderNames: here.map((f) => f.name),
      openPath: here.length ? here[0].path : null,
    };
  });

  return { projectRows, folderRows };
}

function projectState(project, foldersHere) {
  if (!project.frameProjectId) return 'notClaimed';
  if (project.thisDevice) return 'connected';
  return foldersHere > 0 ? 'ready' : 'notConnected';
}

// ─── Linking calls ────────────────────────────────────────────

// Optional fields are left out rather than sent empty.
function compact(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) out[key] = value;
  }
  return out;
}

/** `project.checkSlug` → true when the slug is free in the cloud workspace. */
async function checkSlug({ api, token, fetchJson, signal, slug }) {
  const data = await callTrpc({ api, token, fetchJson, signal, name: 'project.checkSlug', method: 'GET', input: { slug } });
  return Boolean(data && data.available);
}

function normalizeCandidate(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    id: str(c.id),
    slug: str(c.slug),
    name: str(c.name),
    match: Object.prototype.hasOwnProperty.call(MATCH_LABELS, c.match) ? c.match : null,
    frameProjectId: str(c.frameProjectId) || null,
  };
}

/** `link.candidates` → projects this folder could connect to, matches first (server order). */
async function getCandidates({ api, token, fetchJson, signal, folderName, remote, frameProjectId }) {
  const data = await callTrpc({
    api, token, fetchJson, signal,
    name: 'link.candidates',
    method: 'GET',
    input: compact({ folderName, remote, frameProjectId }),
  });
  return Array.isArray(data) ? data.map(normalizeCandidate).filter((c) => c.id) : [];
}

/** `link.claim` → `{ projectId, projectSlug, workspaceSlug }`. Throws CloudError. */
function claim({ api, token, fetchJson, signal, projectId, frameProjectId, remote, acceptRemoteMismatch, takeOver }) {
  return callTrpc({
    api, token, fetchJson, signal,
    name: 'link.claim',
    method: 'POST',
    input: compact({ projectId, frameProjectId, remote, acceptRemoteMismatch, takeOver }),
  });
}

/** `link.create` → the same answer as claim; the project is created already linked. Throws CloudError. */
function create({ api, token, fetchJson, signal, name, slug, frameProjectId, remote }) {
  return callTrpc({
    api, token, fetchJson, signal,
    name: 'link.create',
    method: 'POST',
    input: compact({ name, slug, frameProjectId, remote }),
  });
}

/**
 * `link.connect` → the same answer as claim. Connects this device to a project
 * that already carries the folder's identity, and writes no identity. The
 * identity is sent so a list made stale by another folder's take-over is
 * refused (FRAME_PROJECT_MISMATCH) rather than obeyed. Throws CloudError.
 */
function connect({ api, token, fetchJson, signal, projectId, frameProjectId }) {
  return callTrpc({
    api, token, fetchJson, signal,
    name: 'link.connect',
    method: 'POST',
    input: { projectId, frameProjectId },
  });
}

/**
 * `link.disconnect` → `{ ok: true }`. Removes this device's connection only:
 * the project's identity, other members' devices and this user's other
 * devices stay. Throws CloudError.
 */
function disconnect({ api, token, fetchJson, signal, projectId }) {
  return callTrpc({
    api, token, fetchJson, signal,
    name: 'link.disconnect',
    method: 'POST',
    input: { projectId },
  });
}

const CODE_KINDS = {
  REMOTE_MISMATCH: 'remoteMismatch',
  FRAME_PROJECT_MISMATCH: 'mismatch',
  FRAME_PROJECT_TAKEN: 'taken',
  // link.connect on a project no folder has claimed (the list was stale).
  PROJECT_UNLINKED: 'unlinked',
  SLUG_TAKEN: 'slugTaken',
  BAD_REQUEST: 'badRequest',
  PROJECT_NOT_FOUND: 'notFound',
  UNAUTHORIZED: 'unauthorized',
  DEVICE_NOT_REGISTERED: 'notRegistered',
  NO_WORKSPACE: 'noWorkspace',
  // The caller's role lacks the permission (FrameCloud FORBIDDEN, any procedure).
  ROLE_FORBIDDEN: 'roleForbidden',
};

const TRANSPORT_KINDS = {
  unauthorized: 'unauthorized',
  not_registered: 'notRegistered',
  no_workspace: 'noWorkspace',
  network: 'network',
  rate_limited: 'network',
};

/**
 * A failed link call → what Frame does about it. The server puts its code in
 * the error message; the transport kinds from deviceFlow win over it.
 */
function classifyLinkError(err) {
  if (!err) return 'other';
  if (TRANSPORT_KINDS[err.kind]) return TRANSPORT_KINDS[err.kind];
  if (CODE_KINDS[err.message]) return CODE_KINDS[err.message];
  const status = Number(err.status) || 0;
  if (status === 401) return 'unauthorized';
  if (status === 400) return 'badRequest';
  if (status === 404) return 'notFound';
  return 'other';
}

// ─── Slugs ────────────────────────────────────────────────────

// Letters NFKD does not take apart.
const TRANSLITERATE = { ı: 'i', ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', đ: 'd', ł: 'l', þ: 'th' };

/**
 * A project name → a slug suggestion, or '' when none is valid. Mirrors the
 * server's slugify closely, not exactly; checkSlug and link.create decide.
 */
function suggestSlug(name) {
  const base = String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[ıßæøœđłþ]/g, (ch) => TRANSLITERATE[ch])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = base.slice(0, SLUG_MAX).replace(/-+$/, '');
  return validateSlug(slug) ? '' : slug;
}

/** null when `slug` is valid, else 'empty' | 'length' | 'format' | 'reserved'. */
function validateSlug(slug) {
  if (typeof slug !== 'string' || slug === '') return 'empty';
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return 'length';
  if (!SLUG_RE.test(slug)) return 'format';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

/** The next slug to try after a collision: `app` → `app-2`, `app-2` → `app-3`, kept within 32. */
function nextSlug(slug) {
  const current = String(slug || '');
  const m = current.match(/^(.*?)-(\d+)$/);
  const base = m && m[1] ? m[1] : current;
  const n = m && m[1] ? Number(m[2]) + 1 : 2;
  const suffix = `-${n}`;
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
}

// ─── Row planning ─────────────────────────────────────────────

/**
 * An unconnected folder and its `link.candidates` → how On this device draws
 * it. The first candidate with a match makes it a 'connect' row; otherwise it
 * is a 'create' row. Only an `id` or `remote` match on a project that carries
 * no other identity starts checked — name matches, taken projects and create
 * rows never do.
 *
 *   projectId: the folder's own id, when it has one.
 */
function planFolderRow(folderRow, candidates, projectId = null) {
  const list = Array.isArray(candidates) ? candidates : [];
  const takenByOther = (c) => Boolean(c.frameProjectId) && c.frameProjectId !== projectId;
  const options = list.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    match: c.match,
    matchLabel: c.match ? MATCH_LABELS[c.match] : '',
    alreadyConnected: takenByOther(c),
  }));
  const candidate = options.find((c) => c.match) || null;
  const name = (folderRow && folderRow.name) || '';
  return {
    group: candidate ? 'connect' : 'create',
    candidate,
    matchLabel: candidate ? candidate.matchLabel : '',
    alreadyConnected: candidate ? candidate.alreadyConnected : false,
    checked: Boolean(candidate && (candidate.match === 'id' || candidate.match === 'remote') && !candidate.alreadyConnected),
    name,
    slug: suggestSlug(name),
    options,
  };
}

/**
 * The one automatic tab switch: after a sign-in the user started, unless
 * turned off — and never for a role that cannot connect a folder. Only an
 * explicit `canWork: false` holds it back.
 */
function shouldAutoShowDevices({ userStartedSignIn, dismissed, unconnectedCount, canWork = true } = {}) {
  return Boolean(userStartedSignIn) && !dismissed && Number(unconnectedCount) > 0 && canWork !== false;
}

// ─── Web links ────────────────────────────────────────────────

/**
 * `{webOrigin}/{workspace}/{project}`, or null when any guard fails:
 * the origin must be http(s) (only its origin is used), both slugs must have
 * the slug shape, and an https API requires an https web origin unless the
 * web runs on localhost / 127.0.0.1.
 */
function buildWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug } = {}) {
  if (!slugShapeOk(projectSlug)) return null;
  const base = buildWorkspaceWebUrl({ apiUrl, webOrigin, workspaceSlug });
  return base ? `${base}/${encodeURIComponent(projectSlug)}` : null;
}

/** `{webOrigin}/{workspace}`, under the same guards as buildWebUrl. */
function buildWorkspaceWebUrl({ apiUrl, webOrigin, workspaceSlug } = {}) {
  if (!slugShapeOk(workspaceSlug)) return null;
  const base = webBase(apiUrl, webOrigin);
  return base ? `${base}/${encodeURIComponent(workspaceSlug)}` : null;
}

/** `{webOrigin}/new`, where a signed-in user without a workspace creates one. */
function buildNewWorkspaceWebUrl({ apiUrl, webOrigin } = {}) {
  const base = webBase(apiUrl, webOrigin);
  return base ? `${base}/new` : null;
}

/** The web origin every link starts from, or null when the origin guards fail. */
function webBase(apiUrl, webOrigin) {
  let web;
  let api;
  try {
    web = new URL(webOrigin);
    api = new URL(apiUrl);
  } catch {
    return null;
  }
  if (web.protocol !== 'http:' && web.protocol !== 'https:') return null;
  if (api.protocol === 'https:' && web.protocol !== 'https:' && !LOOPBACK_HOSTS.has(web.hostname)) {
    return null;
  }
  return web.origin;
}

module.exports = {
  SLUG_MIN,
  SLUG_MAX,
  RESERVED_SLUGS,
  MATCH_LABELS,
  WORKSPACE_PERMISSIONS,
  can,
  permissionsOf,
  normalizeProject,
  listProjects,
  matchFolders,
  checkSlug,
  getCandidates,
  claim,
  create,
  connect,
  disconnect,
  classifyLinkError,
  TRANSLITERATE,
  suggestSlug,
  validateSlug,
  nextSlug,
  planFolderRow,
  shouldAutoShowDevices,
  buildWebUrl,
  buildWorkspaceWebUrl,
  buildNewWorkspaceWebUrl,
};
