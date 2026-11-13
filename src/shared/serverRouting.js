/**
 * serverRouting — which things live on the server and how desktop and
 * server name the same project (server-workspaces spec).
 *
 * - Server terminals carry `srv-` ids, so the desktop's local teardown
 *   (renderer reload, quit) never touches them and main can route by id.
 * - A desktop project matches its server clone by normalized remote URL
 *   (GitHub is the source of truth; both checkouts are copies).
 * - The server clones into `~/frame/projects/<dir>`; `<dir>` is the repo
 *   name, made unique by owner when two remotes share a name.
 * - Connect to Server suggests the Host aliases from `~/.ssh/config`.
 */

const SERVER_TERMINAL_PREFIX = 'srv-';

function isServerTerminalId(id) {
  return typeof id === 'string' && id.startsWith(SERVER_TERMINAL_PREFIX);
}

/**
 * A server terminal id. Frame Server adds a per-boot nonce (`srv-<boot>-<n>`)
 * so an id from before a server restart is never reused for a new terminal
 * (server-hardening T3); the `srv-` prefix rule is unchanged.
 */
function serverTerminalId(n, boot = null) {
  return boot ? `${SERVER_TERMINAL_PREFIX}${boot}-${n}` : `${SERVER_TERMINAL_PREFIX}${n}`;
}

/** `{ boot, n }` of a server terminal id (`boot` null for an old `srv-<n>`), or null. */
function parseServerTerminalId(id) {
  if (!isServerTerminalId(id)) return null;
  const m = /^srv-(?:([a-z0-9]+)-)?(\d+)$/.exec(id);
  return m ? { boot: m[1] || null, n: Number(m[2]) } : null;
}

/**
 * Reconcile the server terminals a window (or main) knows for a project with
 * the server's live list after a reconnect (T3): `dispose` the ones the
 * server no longer has, `recreate` a lane whose workspace differs, `add`
 * the new ones. Each item is `{ terminalId, workspaceId }`.
 */
function adoptPlan(known, live) {
  const liveById = new Map((live || []).map((t) => [t.terminalId, t]));
  const knownById = new Map((known || []).map((t) => [t.terminalId, t]));
  const dispose = [];
  const recreate = [];
  for (const k of knownById.values()) {
    const l = liveById.get(k.terminalId);
    if (!l) dispose.push(k.terminalId);
    else if ((l.workspaceId || null) !== (k.workspaceId || null)) recreate.push(k.terminalId);
  }
  const add = [...liveById.keys()].filter((id) => !knownById.has(id));
  return { dispose, recreate, add };
}

/**
 * `git@github.com:Owner/Repo.git`, `https://github.com/Owner/Repo`,
 * `ssh://git@github.com:22/Owner/Repo.git/` → `github.com/owner/repo`.
 * Host and path are lower-cased (GitHub/GitLab names are case-insensitive).
 * A path remote becomes `file:/abs/path` (case kept). Null for anything else.
 */
function normalizeRemoteUrl(url) {
  let s = String(url || '').trim();
  if (!s) return null;
  // A path remote (`/srv/git/x.git`, `file:///srv/git/x.git`) only means
  // something on a machine that has that path — kept, but marked as such.
  const local = /^(?:file:\/\/)?(\/.+?)(?:\.git)?\/*$/i.exec(s);
  if (local) return `file:${local[1]}`;
  let host;
  let rest;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(s);
  const uri = /^[a-z+]+:\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/i.exec(s);
  if (uri) {
    host = uri[1];
    rest = uri[2];
  } else if (scp) {
    host = scp[1];
    rest = scp[2];
  } else {
    return null;
  }
  rest = rest.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/^\/+/, '');
  if (!host || !rest || !rest.includes('/')) return null;
  return `${host}/${rest}`.toLowerCase();
}

function sameRemote(a, b) {
  const na = normalizeRemoteUrl(a);
  return !!na && na === normalizeRemoteUrl(b);
}

/**
 * Folder name for a clone of `url` under the server's projects root.
 * `taken` maps existing folder names to their normalized remotes: the same
 * remote reuses its folder; a different remote with the same repo name gets
 * `<repo>-<owner>` (then a number).
 */
function projectDirName(url, taken = {}) {
  const norm = normalizeRemoteUrl(url);
  if (!norm) return null;
  const parts = norm.split('/');
  const repo = parts[parts.length - 1].replace(/[^a-z0-9._-]/g, '-');
  const owner = (parts[parts.length - 2] || 'repo').replace(/[^a-z0-9._-]/g, '-');
  const candidates = [repo, `${repo}-${owner}`];
  for (let i = 2; i < 100; i++) candidates.push(`${repo}-${owner}-${i}`);
  for (const name of candidates) {
    if (!Object.prototype.hasOwnProperty.call(taken, name) || taken[name] === norm) return name;
  }
  return null;
}

/**
 * How the server knows a project (server-onboarding): its normalized remote,
 * else `root:<sha>` — the root commit of a project with no remote — else null.
 */
function projectKey({ originUrl = null, root = null } = {}) {
  const norm = originUrl ? normalizeRemoteUrl(originUrl) : null;
  if (norm) return norm;
  if (typeof root === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(root)) return `root:${root}`;
  return null;
}

/**
 * The server folder for a project: remote-named as before, else its folder
 * name made safe, with `-2`, `-3` … when another project holds the name.
 * `taken` is `{ dir: key }`; a folder already holding this project is reused.
 */
function projectDirNameFor({ originUrl = null, root = null, name = '' } = {}, taken = {}) {
  if (originUrl && normalizeRemoteUrl(originUrl)) return projectDirName(originUrl, taken);
  const key = projectKey({ root });
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'project';
  for (let i = 1; i < 100; i++) {
    const dir = i === 1 ? base : `${base}-${i}`;
    if (!Object.prototype.hasOwnProperty.call(taken, dir) || taken[dir] === key) return dir;
  }
  return null;
}

/**
 * Host aliases from an OpenSSH client config: every name on a `Host` line,
 * without patterns (`*`, `?`, `!`). `Match` blocks are skipped.
 */
function parseSshConfigHosts(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^host\s*(?:=\s*|\s+)(.+)$/i.exec(line);
    if (!m) continue;
    for (const name of m[1].split(/\s+/)) {
      const n = name.replace(/^"|"$/g, '');
      if (!n || /[*?!]/.test(n) || out.includes(n)) continue;
      out.push(n);
    }
  }
  return out;
}

/**
 * The server workspace folder `p` is (or lies under), or null. `roots` are
 * server-side absolute folders; the longest match wins and the match is
 * separator-safe (`/w/ab` is not under `/w/a`). Used to route panel calls
 * (file tree, file reads, git, review) to Frame Server by path.
 */
function serverRootFor(p, roots) {
  if (typeof p !== 'string' || !p) return null;
  const path = p.length > 1 ? p.replace(/\/+$/, '') : p;
  let best = null;
  for (const raw of roots || []) {
    if (typeof raw !== 'string' || !raw) continue;
    const root = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
    if ((path === root || path.startsWith(`${root}/`)) && (!best || root.length > best.length)) best = root;
  }
  return best;
}

/**
 * One WORKSPACE_GIT_STATE payload for a desktop project: its local
 * workspaces' rows plus the server workspaces' rows from Frame Server's own
 * `workspaceGitState`. The server's GitHub access is kept apart
 * (`serverAccess`) — its `gh` is not the desktop's.
 */
function mergeGitStatePayloads(local, server, projectPath) {
  const none = { gh: false, authed: false, repoName: null };
  return {
    projectPath: projectPath || (local && local.projectPath) || null,
    access: (local && local.access) || none,
    serverAccess: server ? (server.access || none) : null,
    workspaces: { ...((local && local.workspaces) || {}), ...((server && server.workspaces) || {}) }
  };
}

/**
 * Where a panel call goes (server-hardening T6): `{ remote: rootEntry }` or
 * `{ local: true }`. The caller's workspace id decides — `main` or a local
 * workspace is local even when a server workspace has the same absolute path
 * (two machines sharing a home path); a server workspace id routes to it when
 * the path lies in its folder. Only a call without a workspace id falls back
 * to matching the path against the known server folders.
 *   roots:     [{ root, id, host, … }] (workspaceManager.serverRoots())
 *   locations: { [workspaceId]: { path, host } } for server workspaces
 */
function routeOf(p, ctx, roots, locations) {
  const id = ctx && typeof ctx.workspaceId === 'string' ? ctx.workspaceId : null;
  if (id) {
    const loc = locations && locations[id];
    if (!loc) return { local: true };
    const hit = serverRootFor(p, [loc.path]);
    if (!hit) return { local: true };
    const entry = (roots || []).find((r) => r.id === id) || { root: loc.path, id, host: loc.host };
    return { remote: entry };
  }
  const all = roots || [];
  const hit = serverRootFor(p, all.map((r) => r.root));
  const entry = hit ? all.find((r) => String(r.root).replace(/\/+$/, '') === hit) : null;
  return entry ? { remote: entry } : { local: true };
}

module.exports = {
  routeOf,
  serverRootFor,
  mergeGitStatePayloads,
  SERVER_TERMINAL_PREFIX,
  isServerTerminalId,
  parseServerTerminalId,
  adoptPlan,
  serverTerminalId,
  normalizeRemoteUrl,
  sameRemote,
  projectDirName,
  projectDirNameFor,
  projectKey,
  parseSshConfigHosts
};
