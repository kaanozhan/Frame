/**
 * serverTasks — the rules behind tasks in server workspaces (server-tasks).
 *
 * A project's tasks live in two kinds of home: the Mac's main checkout
 * (`.frame/tasks.json`, as always) and, for each Frame Server that holds the
 * project, that server's clone (server-specs B1 — one writer per file). The
 * desktop merges them into the one list every task surface reads, and sends
 * each change to the task's own home. Nothing here touches a file or a
 * server: lists and records in, lists and decisions out.
 *
 * A server task entry is the task's own fields plus
 *   { location: 'server', host, serverKey, serverProjectPath, tasksPath, offline }.
 * A Mac task carries none of them; its file is the push's own `tasksPath`.
 */

const list = (v) => (Array.isArray(v) ? v : []);

/**
 * The merged task list: the Mac's tasks first, unchanged, then each server
 * list's tasks tagged with their home. A server task whose id is already
 * listed is dropped — the Mac copy wins a duplicate: a merged spec's tasks
 * (`task-spec-<slug>-Tnn`) are imported into the Mac as completed after a
 * pull while the clone still holds them, and after merge the Mac is the
 * record. Other ids are random and cannot collide.
 *
 * `serverLists`: `[{ host, serverKey, serverProjectPath, tasksPath, offline, tasks }]`.
 */
function mergeTaskLists(macTasks, serverLists) {
  const out = [];
  const seen = new Set();
  for (const t of list(macTasks)) {
    if (!t) continue;
    out.push(t);
    if (t.id) seen.add(t.id);
  }
  for (const s of list(serverLists)) {
    if (!s) continue;
    for (const t of list(s.tasks)) {
      if (!t || !t.id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({
        ...t,
        location: 'server',
        host: s.host || null,
        serverKey: s.serverKey || null,
        serverProjectPath: s.serverProjectPath || null,
        tasksPath: s.tasksPath || null,
        offline: !!s.offline
      });
    }
  }
  return out;
}

function isServerTask(task) {
  return !!(task && task.location === 'server');
}

/** The chip a server task shows: `host`, or `host · offline`. Null for a Mac task. */
function taskChipLabel(task) {
  if (!isServerTask(task)) return null;
  const host = task.host || 'server';
  return task.offline ? `${host} · offline` : host;
}

/**
 * Where a task lives, by id in the merged list: `{ location: 'mac' }`,
 * `{ location: 'server', serverKey, serverProjectPath, host, offline }`, or
 * null when no task has that id. The merge already dropped duplicates, so the
 * first match is the home.
 */
function homeOf(taskId, merged) {
  if (!taskId) return null;
  const t = list(merged).find((x) => x && x.id === taskId);
  if (!t) return null;
  if (!isServerTask(t)) return { location: 'mac' };
  return { location: 'server', serverKey: t.serverKey, serverProjectPath: t.serverProjectPath, host: t.host, offline: !!t.offline };
}

/**
 * A reorder over the merged list, split by home: each home gets its own
 * entries in the order given (`{ id, status? }`), and a move never takes a
 * task to another home. Entries naming no listed task are dropped.
 * `{ mac: [...], servers: [{ serverKey, serverProjectPath, host, offline, order }] }`.
 */
function splitOrder(order, merged) {
  const mac = [];
  const servers = new Map();
  for (const entry of list(order)) {
    if (!entry || !entry.id) continue;
    const home = homeOf(entry.id, merged);
    if (!home) continue;
    if (home.location === 'mac') { mac.push(entry); continue; }
    const key = `${home.serverKey}::${home.serverProjectPath}`;
    if (!servers.has(key)) servers.set(key, { serverKey: home.serverKey, serverProjectPath: home.serverProjectPath, host: home.host, offline: home.offline, order: [] });
    servers.get(key).order.push(entry);
  }
  return { mac, servers: [...servers.values()] };
}

/**
 * Where Play runs a task. A task runs where its `tasks.json` lives, so the
 * agent can write it:
 *   - a Mac task: the selected workspace when it is local (or the main
 *     checkout); while a server workspace is selected, the main checkout,
 *     with `note: 'mac-task-on-server'` for the dialog to say why;
 *   - a server task: the selected workspace when it is on that server and
 *     project; otherwise `{ choose: [...] }` — that server's live workspaces of
 *     the project — or `{ error: 'offline' | 'no-workspace' }`.
 *
 * `selected`: the selected workspace record (`{ id, location, serverKey,
 * serverProjectPath }`), or null for the main checkout. `serverWorkspaces`:
 * the project's server workspace records (`{ id, name, serverKey,
 * serverProjectPath, offline }`).
 */
function runTarget(task, selected, serverWorkspaces) {
  const sel = selected && selected.id && selected.id !== 'main' ? selected : null;
  if (!isServerTask(task)) {
    if (sel && sel.location === 'server') return { workspaceId: 'main', note: 'mac-task-on-server' };
    return { workspaceId: sel ? sel.id : 'main' };
  }
  if (task.offline) return { error: 'offline' };
  const sameHome = (w) => w && w.serverKey === task.serverKey && w.serverProjectPath === task.serverProjectPath;
  if (sel && sel.location === 'server' && sameHome(sel) && !sel.offline) return { workspaceId: sel.id };
  const choose = list(serverWorkspaces).filter((w) => sameHome(w) && !w.offline && !w.archivedAt && !w.missing);
  if (!choose.length) return { error: 'no-workspace' };
  return { choose };
}

/**
 * What the Task Run dialog says about where a task runs, from runTarget's
 * answer: `{ text, blocking }`, or null when there is nothing to say (the
 * task runs where the user is). `blocking` disables Run. `selected` is the
 * selected workspace record (for its host).
 */
function runTargetNote(target, task, selected) {
  if (!target) return null;
  const host = (task && task.host) || 'the server';
  if (target.error === 'offline') return { text: `${host} is offline — reconnect to run this task.`, blocking: true };
  if (target.error === 'no-workspace') return { text: `${host} has no workspace of this project — create one there to run this task.`, blocking: true };
  if (target.choose) return { text: `This task lives on ${host}. Pick its workspace there to run it in.`, blocking: false };
  if (target.note === 'mac-task-on-server') {
    const there = (selected && selected.host) || 'the server';
    return { text: `This task lives on this Mac, so it runs in the main checkout — an agent on ${there} could not update this Mac's task list.`, blocking: false };
  }
  return null;
}

module.exports = { mergeTaskLists, isServerTask, taskChipLabel, homeOf, splitOrder, runTarget, runTargetNote };
