/**
 * Receiving git-ignored files from the desktop (server-copy-files).
 *
 *   files.compare { projectPath, root, entries: [{ path, type, size, sha256|null }] }
 *                 → { [path]: 'same' | 'changed' | 'missing' }
 *   files.receive { archive, projectPath, root, untracked: [path] }
 *                 → { written, overwritten, skipped: [{ path, reason }], toMainCopy }
 *
 * `projectPath` is the server's main copy of the project; `root` is that copy
 * or one of its active workspaces — anything else is refused, as in specs.js.
 *
 * Receive takes only an upload named `files-*.fpk` in the server's tmp
 * folder, checks every entry of the archive before writing anything
 * (fileArchive.checkEntries — one bad entry refuses the whole send), and then
 * writes each file through a temp file and a rename, with its mode. Ignored
 * files go to the workspace and to the main copy (new workspaces copy them
 * from there); `untracked` ones go to the workspace only. A file whose way
 * passes through a symlinked folder is skipped, never followed. The archive
 * is removed in every case. Nothing logs file contents.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readEntries, checkEntries, pathProblem } = require('../shared/fileArchive');

const HASH_MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVE_RE = /^files-[A-Za-z0-9._-]+\.fpk$/;

function uploadsDir() {
  const home = process.env.FRAME_SERVER_HOME || path.join(os.homedir(), '.frame-server');
  return path.resolve(home, 'tmp');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function setup({ registerMethods }) {
  const projectRegistry = require('../main/projectRegistry');
  const workspaceRegistry = require('../shared/workspaceRegistry');

  /** The folder a call names, once it is known to belong to a server project. */
  function checkout(projectPath, root) {
    if (typeof projectPath !== 'string' || !projectPath || !projectRegistry.getProjects().some((p) => p.path === projectPath)) {
      throw new Error('This project is not on the server yet.');
    }
    if (typeof root !== 'string' || !root) throw new Error('Missing root.');
    const want = path.resolve(root);
    if (want === path.resolve(projectPath)) return want;
    let rows = [];
    try { rows = workspaceRegistry.activeOf(projectRegistry.getWorkspaceRecords(projectPath) || []); } catch (_) { rows = []; }
    if (rows.some((r) => r && r.path && path.resolve(r.path) === want)) return want;
    throw new Error('That folder is not a workspace of this project on the server.');
  }

  /** Why `rel` cannot be written under `base` (a symlinked or non-folder parent), or null. */
  function wayProblem(base, rel) {
    const segs = rel.split('/');
    let at = base;
    for (let i = 0; i < segs.length - 1; i++) {
      at = path.join(at, segs[i]);
      let st;
      try { st = fs.lstatSync(at); } catch (_) { return null; } // the rest does not exist yet
      if (st.isSymbolicLink()) return `${segs.slice(0, i + 1).join('/')} is a symlink on the server`;
      if (!st.isDirectory()) return `${segs.slice(0, i + 1).join('/')} is a file on the server`;
    }
    return null;
  }

  /** Write one entry under `base`; `{ overwrote }` or `{ skipped: reason }`. */
  function writeEntry(base, e) {
    const problem = wayProblem(base, e.path);
    if (problem) return { skipped: problem };
    const dest = path.join(base, e.path);
    let existing = null;
    try { existing = fs.lstatSync(dest); } catch (_) { existing = null; }
    if (existing && existing.isDirectory()) return { skipped: 'a folder with that name is on the server' };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (e.type === 'symlink') {
      if (existing) fs.rmSync(dest, { force: true });
      fs.symlinkSync(e.target, dest);
      return { overwrote: !!existing };
    }
    const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.frame-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    fs.writeFileSync(tmp, e.data, { mode: e.mode & 0o777 });
    fs.chmodSync(tmp, e.mode & 0o7777);
    fs.renameSync(tmp, dest); // replaces a file or a symlink, never follows it
    return { overwrote: !!existing };
  }

  registerMethods({
    'files.compare': async ({ projectPath, root, entries } = {}) => {
      const dir = checkout(projectPath, root);
      const out = {};
      for (const e of Array.isArray(entries) ? entries : []) {
        if (!e || pathProblem(e.path)) continue;
        const target = path.join(dir, e.path);
        let st;
        try { st = fs.lstatSync(target); } catch (_) { out[e.path] = 'missing'; continue; }
        if (e.type === 'dir') { out[e.path] = st.isDirectory() ? 'changed' : 'missing'; continue; }
        if (!st.isFile() || st.size !== Number(e.size)) { out[e.path] = 'changed'; continue; }
        if (e.sha256 && st.size <= HASH_MAX_BYTES) out[e.path] = sha256(target) === e.sha256 ? 'same' : 'changed';
        else out[e.path] = 'same';
      }
      return out;
    },

    'files.receive': async ({ archive, projectPath, root, untracked = [] } = {}) => {
      const uploads = uploadsDir();
      const file = path.resolve(uploads, String(archive || ''));
      if (path.dirname(file) !== uploads || !ARCHIVE_RE.test(path.basename(file))) {
        throw new Error(`The file archive must be an upload in ${uploads}.`);
      }
      try {
        const dir = checkout(projectPath, root);
        const mainCopy = path.resolve(projectPath);
        const entries = readEntries(fs.readFileSync(file));
        const bad = checkEntries(entries);
        if (bad) throw new Error(`Refused the whole send: ${bad.path} — ${bad.reason}. Nothing was written.`);
        const onlyWorkspace = new Set(Array.isArray(untracked) ? untracked : []);
        const result = { written: [], overwritten: [], skipped: [], toMainCopy: [] };
        for (const e of entries) {
          const r = writeEntry(dir, e);
          if (r.skipped) { result.skipped.push({ path: e.path, reason: r.skipped }); continue; }
          result.written.push(e.path);
          if (r.overwrote) result.overwritten.push(e.path);
          // The main copy keeps the last sent ignored files for future workspaces.
          if (dir !== mainCopy && !onlyWorkspace.has(e.path)) {
            const m = writeEntry(mainCopy, e);
            if (!m.skipped) result.toMainCopy.push(e.path);
          }
        }
        return result;
      } finally {
        fs.rmSync(file, { force: true });
      }
    }
  });

  return {};
}

module.exports = { setup, HASH_MAX_BYTES };
