/**
 * Server panels — the desktop half of routing a server workspace's panels
 * to Frame Server (server-workspace-panels spec, T1).
 *
 * A panel call is "remote" when its path is a known server workspace's
 * folder or lies under one (serverRootFor; the known folders come from
 * workspaceManager.serverRoots(), not from the local disk — a server on this
 * same machine has the same paths). Each routed handler asks `rootOf(path)`
 * and, on a hit, lets this module answer through the server connection.
 * While the server is not connected, every routed call fails with
 * "<host> is offline" instead of falling back to local or stale data.
 *
 * Files are read-only in this spec: saving and file-tree actions under a
 * server root are refused.
 */

const { serverRootFor } = require('../shared/serverRouting');

const READ_ONLY_FILES = 'Editing files of a server workspace comes in a later update.';
const READ_ONLY_ACTIONS = 'File actions on server workspaces come in a later update.';

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

/** The server workspace a path belongs to: `{ root, host, id, projectPath, serverProjectPath }`, or null. */
function rootOf(p) {
  const all = roots();
  const hit = serverRootFor(p, all.map((r) => r.root));
  return hit ? all.find((r) => r.root.replace(/\/+$/, '') === hit) || null : null;
}

function offlineError(entry) {
  return new Error(`${(entry && entry.host) || 'The server'} is offline — reconnect to see this workspace.`);
}

/** A server call for a routed panel; rejects with the offline error while disconnected. */
function call(entry, method, params, timeoutMs) {
  if (!server().isConnected()) return Promise.reject(offlineError(entry));
  return server().call(method, params, timeoutMs);
}

module.exports = { rootOf, call, offlineError, READ_ONLY_FILES, READ_ONLY_ACTIONS };
