/**
 * Send git-ignored files to a server workspace (server-copy-files).
 *
 * The desktop half of the "Send files to server" modal:
 *
 *   SEND_FILES_LIST { projectPath, workspaceId }
 *     → { ignored, untracked, sizes, server, copyFiles, host }   (sendFilesModel.buildTree's input)
 *   SEND_FILES_SEND { projectPath, workspaceId, paths, remember }
 *     → { written, overwritten, skipped, toMainCopy, remembered } | { error }
 *
 * What can be sent is decided here, from git, never taken from the renderer:
 * the project's git-ignored paths (`--directory`, so fully ignored folders
 * come collapsed) and its untracked, not ignored files. Frame's own `.frame/`
 * is never offered — the server provisions its own tooling, and in local
 * mode that folder holds tasks.json and specs. Sizes of collapsed folders
 * come from a bounded walk; files up to 5 MB outside heavy folders are
 * hashed so the server can say which ones it already has.
 *
 * Sending packs the chosen files (fileArchive) into a temp file, uploads it
 * over SSH into Frame Server's tmp folder (as the project bundle goes) and
 * asks the server to unpack it. Nothing here logs file contents.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { IPC } = require('../shared/ipcChannels');
const { pack } = require('../shared/fileArchive');
const model = require('../shared/sendFilesModel');

const HASH_MAX_BYTES = 5 * 1024 * 1024;
const WALK_MAX_ENTRIES = 20000;
const WALK_MAX_MS = 300;
const UPDATE_SERVER = 'Update Frame Server to send files to it (File ▸ Connect to Server…).';

function server() { return require('./serverConnection'); }
function git() { return require('./gitBranchesManager'); }

/** Never offered: Frame's own folder. */
function offered(rel) {
  const p = String(rel).replace(/\/+$/, '');
  return p && p !== '.frame' && !p.startsWith('.frame/');
}

/** The server workspace `workspaceId` names, or an error object. */
function locate(workspaceId) {
  let loc = null;
  try { loc = require('./workspaceManager').serverLocation(workspaceId); } catch (_) { loc = null; }
  if (!loc) return { error: 'That is not a server workspace.' };
  if (!server().isConnected()) return { error: `${loc.host || 'The server'} is offline — reconnect to send files.` };
  return { loc };
}

/** `{ ignored, untracked }` as git lists them, minus `.frame/`. */
async function candidates(projectPath) {
  const ig = await git().listIgnoredCandidates(projectPath);
  if (ig.error) throw new Error(ig.error);
  let untracked = [];
  try {
    const { stdout } = await git().execGitArgs(['ls-files', '--others', '--exclude-standard', '-z'], projectPath, { maxBuffer: 64 * 1024 * 1024 });
    untracked = stdout.split('\0').filter(Boolean);
  } catch (err) {
    throw new Error(err.error || err.message);
  }
  return { ignored: ig.paths.filter(offered), untracked: untracked.filter(offered) };
}

/** Bytes under `dir`, stopping after WALK_MAX_ENTRIES entries or WALK_MAX_MS; `{ size, cut }`. */
function boundedSize(dir) {
  const started = Date.now();
  let size = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    if (seen >= WALK_MAX_ENTRIES || Date.now() - started > WALK_MAX_MS) return { size, cut: true };
    const d = stack.pop();
    let names = [];
    try { names = fs.readdirSync(d); } catch (_) { continue; }
    for (const name of names) {
      seen += 1;
      const p = path.join(d, name);
      let st;
      try { st = fs.lstatSync(p); } catch (_) { continue; }
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) size += st.size;
    }
  }
  return { size, cut: false };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function list({ projectPath, workspaceId } = {}) {
  if (!projectPath) return { error: 'No project selected.' };
  const where = locate(workspaceId);
  if (where.error) return { error: where.error };
  const { loc } = where;
  let groups;
  try { groups = await candidates(projectPath); } catch (err) { return { error: `Could not list the files git does not carry: ${err.message}` }; }

  const sizes = {};
  const compareEntries = [];
  for (const raw of [...groups.ignored, ...groups.untracked]) {
    const rel = raw.replace(/\/+$/, '');
    const abs = path.join(projectPath, rel);
    if (raw.endsWith('/')) {
      sizes[rel] = boundedSize(abs);
      if (!model.isHeavy(rel)) compareEntries.push({ path: rel, type: 'dir', size: sizes[rel].size, sha256: null });
      continue;
    }
    let st;
    try { st = fs.lstatSync(abs); } catch (_) { continue; }
    sizes[rel] = { size: st.size };
    if (model.isHeavy(rel)) continue;
    const hash = st.isFile() && st.size <= HASH_MAX_BYTES ? sha256(abs) : null;
    compareEntries.push({ path: rel, type: 'file', size: st.size, sha256: hash });
  }

  let serverState = {};
  try {
    serverState = await server().call('files.compare', { projectPath: loc.serverProjectPath, root: loc.path, entries: compareEntries }) || {};
  } catch (err) {
    if (/Unknown method/.test(String(err && err.message))) return { error: UPDATE_SERVER };
    return { error: err.message };
  }
  const settings = require('./frameProject').getWorkspaceSettings(projectPath) || {};
  return { ignored: groups.ignored, untracked: groups.untracked, sizes, server: serverState, copyFiles: settings.copyFiles || [], host: loc.host };
}

/** Archive entries for one chosen path (a file, a symlink, or a whole collapsed folder). */
function entriesFor(projectPath, rel, out) {
  const abs = path.join(projectPath, rel);
  let st;
  try { st = fs.lstatSync(abs); } catch (_) { return; }
  if (st.isSymbolicLink()) out.push({ path: rel, type: 'symlink', mode: st.mode & 0o7777, target: fs.readlinkSync(abs) });
  else if (st.isFile()) out.push({ path: rel, type: 'file', mode: st.mode & 0o7777, data: fs.readFileSync(abs) });
  else if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) entriesFor(projectPath, `${rel}/${name}`, out);
  }
}

async function send({ projectPath, workspaceId, paths, remember = false } = {}) {
  if (!projectPath) return { error: 'No project selected.' };
  const where = locate(workspaceId);
  if (where.error) return { error: where.error };
  const { loc } = where;
  const wanted = new Set((Array.isArray(paths) ? paths : []).map((p) => String(p).replace(/\/+$/, '')));
  if (!wanted.size) return { error: 'Nothing is ticked.' };

  // Only what git says is outside it may go — never a path the renderer made up.
  let groups;
  try { groups = await candidates(projectPath); } catch (err) { return { error: err.message }; }
  const allowed = new Map();
  for (const raw of groups.ignored) allowed.set(raw.replace(/\/+$/, ''), 'ignored');
  for (const raw of groups.untracked) allowed.set(raw, 'untracked');
  const chosen = [...wanted].filter((p) => allowed.has(p));
  const refused = [...wanted].filter((p) => !allowed.has(p));
  if (refused.length) return { error: `Not files git leaves out: ${refused.slice(0, 3).join(', ')}${refused.length > 3 ? '…' : ''}` };

  const entries = [];
  for (const rel of chosen) entriesFor(projectPath, rel, entries);
  const bytes = entries.reduce((n, e) => n + (e.data ? e.data.length : 0), 0);
  if (model.sizeVerdict(bytes) === 'refuse') {
    return { error: `That is ${Math.round(bytes / 1024 / 1024)} MB — more than the 1 GB Frame sends at once. Untick dependency or build folders.` };
  }
  const untracked = chosen.filter((p) => allowed.get(p) === 'untracked');

  const name = `files-${crypto.randomBytes(6).toString('hex')}.fpk`;
  const local = path.join(os.tmpdir(), `frame-${name}`);
  let result;
  try {
    fs.writeFileSync(local, pack(entries), { mode: 0o600 });
    await require('./serverInstaller').upload(loc.host, local, `.frame-server/tmp/${name}`);
    result = await server().call('files.receive', { archive: name, projectPath: loc.serverProjectPath, root: loc.path, untracked }, 10 * 60 * 1000);
  } catch (err) {
    if (/Unknown method/.test(String(err && err.message))) return { error: UPDATE_SERVER };
    return { error: err.message };
  } finally {
    try { fs.rmSync(local, { force: true }); } catch (_) { /* gone */ }
  }

  let remembered = null;
  if (remember) {
    const fp = require('./frameProject');
    const tree = model.buildTree({ ignored: groups.ignored, untracked: groups.untracked });
    const merged = model.mergePatterns((fp.getWorkspaceSettings(projectPath) || {}).copyFiles, model.patternsFor(tree, new Set(chosen)));
    const saved = fp.setWorkspaceSettings(projectPath, { copyFiles: merged });
    remembered = saved && !saved.error ? saved.copyFiles : null;
  }
  return { ...result, remembered };
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.SEND_FILES_LIST, (event, payload) => list(payload));
  ipcMain.handle(IPC.SEND_FILES_SEND, (event, payload) => send(payload));
}

module.exports = { setupIPC, list, send, boundedSize, offered };
