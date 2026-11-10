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

function serverTerminalId(n) {
  return `${SERVER_TERMINAL_PREFIX}${n}`;
}

/**
 * `git@github.com:Owner/Repo.git`, `https://github.com/Owner/Repo`,
 * `ssh://git@github.com:22/Owner/Repo.git/` → `github.com/owner/repo`.
 * Host and path are lower-cased (GitHub/GitLab names are case-insensitive).
 * Null for anything that is not a recognisable remote.
 */
function normalizeRemoteUrl(url) {
  let s = String(url || '').trim();
  if (!s) return null;
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

module.exports = {
  SERVER_TERMINAL_PREFIX,
  isServerTerminalId,
  serverTerminalId,
  normalizeRemoteUrl,
  sameRemote,
  projectDirName,
  parseSshConfigHosts
};
