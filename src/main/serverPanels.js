/**
 * Server panels — the desktop half of routing a server workspace's panels
 * to Frame Server (server-workspace-panels spec, T1).
 *
 * A panel call is "remote" when its path is a known server workspace's
 * folder or lies under one (serverRootFor; the known folders come from
 * workspaceManager.serverRoots(), not from the local disk — a server on this
 * same machine has the same paths). Each routed handler asks `rootOf(path)`
 * and, on a hit, lets this module answer through that workspace's own server
 * (`serverKey`, multi-server-connections). While that server is not
 * connected, every routed call fails with "<host> is offline" instead of
 * falling back to local data, stale data or another server.
 *
 * Files are read-only in this spec: saving and file-tree actions under a
 * server root are refused.
 */

const { routeOf } = require('../shared/serverRouting');

const READ_ONLY_FILES = 'Editing files of a server workspace comes in a later update.';
const READ_ONLY_ACTIONS = 'File actions on server workspaces come in a later update.';
const READ_ONLY_GIT = 'Branch and worktree changes on a server workspace come in a later update — use git in its terminal.';

function server() {
  return require('./serverConnection');
}

function roots() {
  try {
    return require('./workspaceManager').serverRoots();
  } catch (_) {
    return [];
  }
}

/**
 * The server workspace a panel call belongs to: `{ root, host, serverKey, id,
 * projectPath, serverProjectPath }`, or null for a local call. `ctx` is the
 * caller's `{ workspaceId }`: with it, routing is by id (a local workspace
 * that shares a server workspace's absolute path stays local); without it,
 * by path (server-hardening T6, serverRouting.routeOf).
 */
function resolve(p, ctx = null) {
  const all = roots();
  const locations = {};
  for (const r of all) locations[r.id] = { path: r.root, host: r.host, serverKey: r.serverKey || null };
  const route = routeOf(p, ctx, all, locations);
  return route.remote || null;
}

/** Path-only routing, for calls that carry no workspace context. */
function rootOf(p) {
  return resolve(p, null);
}

/** The `{ workspaceId }` context of an IPC payload or trailing argument, or null. */
function ctxOf(x) {
  return x && typeof x === 'object' && typeof x.workspaceId === 'string' && x.workspaceId ? { workspaceId: x.workspaceId } : null;
}

function offlineError(entry) {
  return new Error(`${(entry && entry.host) || 'The server'} is offline — reconnect to see this workspace.`);
}

/** The connected link of `entry`'s server, or null. */
function linkOf(entry) {
  const link = entry && entry.serverKey ? server().of(entry.serverKey) : null;
  return link && link.isConnected() ? link : null;
}

/** A server call for a routed panel, on its own server; rejects with the offline error while that server is down. */
function call(entry, method, params, timeoutMs) {
  const link = linkOf(entry);
  if (!link) return Promise.reject(offlineError(entry));
  return link.call(method, params, timeoutMs);
}

module.exports = { resolve, rootOf, ctxOf, call, linkOf, offlineError, READ_ONLY_FILES, READ_ONLY_ACTIONS, READ_ONLY_GIT };
