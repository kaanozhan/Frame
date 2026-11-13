/**
 * File Tree Module
 * Generates directory tree structure
 *
 * Dotfiles and dot-directories are part of the tree: this is a tool for
 * working on projects whose configuration lives in `.frame/`, `.github/`,
 * `.claude/` and friends, and hiding them hid exactly the files a Frame user
 * edits most. Only machinery is skipped — `.git` (plumbing nobody edits, and
 * hundreds of hash-named entries) and `node_modules`.
 */

const fsp = require('fs').promises;
const path = require('path');
const { shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');

/** Never walked: repository plumbing and installed dependencies. */
const SKIP = new Set(['.git', 'node_modules']);

/**
 * Get file tree for a directory (async — the whole-subtree walk must not
 * block the main event loop)
 * @param {string} dirPath - Directory path
 * @param {number} maxDepth - Maximum depth to traverse
 * @param {number} currentDepth - Current depth level
 * @returns {Promise<Array>} File tree structure
 */
async function getFileTree(dirPath, maxDepth = 5, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];

  try {
    const items = await fsp.readdir(dirPath, { withFileTypes: true });
    const files = [];

    // Sort: directories first, then files
    items.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      if (SKIP.has(item.name)) continue;

      const fullPath = path.join(dirPath, item.name);
      const fileInfo = {
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory()
      };

      // Recursively get children for directories
      if (item.isDirectory()) {
        fileInfo.children = await getFileTree(fullPath, maxDepth, currentDepth + 1);
      }

      files.push(fileInfo);
    }

    return files;
  } catch (err) {
    console.error('Error reading directory:', err);
    return [];
  }
}

async function exists(p) {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** True when `child` is `parent` itself or lies anywhere beneath it. */
function isSameOrInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Finder-style free name in `dir` for a copy of `name`:
 * "a.txt" → "a copy.txt" → "a copy 2.txt" … (folders keep no extension).
 */
async function uniqueCopyPath(dir, name, isDirectory) {
  const first = path.join(dir, name);
  if (!(await exists(first))) return first;
  const ext = isDirectory ? '' : path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${base} copy${i === 1 ? '' : ` ${i}`}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
}

/**
 * Rename an entry in place. Only the name changes — the entry stays in its
 * directory, so a name containing a path separator is rejected.
 */
async function renameEntry(oldPath, newName) {
  const name = typeof newName === 'string' ? newName.trim() : '';
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    return { ok: false, error: 'Invalid name' };
  }
  const target = path.join(path.dirname(oldPath), name);
  if (target === oldPath) return { ok: true, path: target };
  // A case-only rename on a case-insensitive disk "exists" as itself.
  if (target.toLowerCase() !== oldPath.toLowerCase() && (await exists(target))) {
    return { ok: false, error: `"${name}" already exists` };
  }
  await fsp.rename(oldPath, target);
  return { ok: true, path: target };
}

/**
 * Paste a copied or cut entry into `destDir`. A copy that collides gets a
 * "copy" name; a move that collides is refused rather than silently renamed
 * or overwriting.
 */
async function pasteEntry({ source, mode, destDir }) {
  const stat = await fsp.lstat(source);
  const isDirectory = stat.isDirectory();
  const name = path.basename(source);

  if (isDirectory && isSameOrInside(destDir, source)) {
    return { ok: false, error: 'A folder cannot be pasted into itself' };
  }

  if (mode === 'cut') {
    const target = path.join(destDir, name);
    if (target === source) return { ok: true, path: target };
    if (await exists(target)) {
      return { ok: false, error: `"${name}" already exists in the destination` };
    }
    try {
      await fsp.rename(source, target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false });
      await fsp.rm(source, { recursive: true, force: true });
    }
    return { ok: true, path: target };
  }

  const target = await uniqueCopyPath(destDir, name, isDirectory);
  await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return { ok: true, path: target };
}

/** Run a file operation, turning a thrown error into `{ ok: false, error }`. */
async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('File tree operation failed:', err);
    return { ok: false, error: err.code === 'ENOENT' ? 'The item no longer exists' : err.message };
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  const serverPanels = require('./serverPanels');
  // Read-only on server workspaces (server-workspace-panels): no rename,
  // paste or trash under a server root — the server has no trash.
  // Routed by the caller's workspace id when it sends one (server-hardening T6).
  const refuseRemote = (ctx, ...paths) => paths.some((p) => p && serverPanels.resolve(p, ctx))
    ? { ok: false, error: serverPanels.READ_ONLY_ACTIONS }
    : null;

  ipcMain.on(IPC.LOAD_FILE_TREE, async (event, projectPath, ctx) => {
    const remote = serverPanels.resolve(projectPath, serverPanels.ctxOf(ctx));
    // The reply names its root, so a late answer for another folder is
    // dropped, and carries a server error instead of an empty tree
    // (server-hardening T7).
    let files = [];
    let error = null;
    if (remote) {
      try {
        files = (await serverPanels.call(remote, 'files.tree', { root: projectPath })) || [];
      } catch (err) {
        error = err.message;
      }
    } else {
      files = await getFileTree(projectPath);
    }
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC.FILE_TREE_DATA, { root: projectPath, files, error });
    }
  });

  ipcMain.handle(IPC.FILE_TREE_RENAME, (event, oldPath, newName, ctx) =>
    refuseRemote(serverPanels.ctxOf(ctx), oldPath) || guarded(() => renameEntry(oldPath, newName)));

  ipcMain.handle(IPC.FILE_TREE_TRASH, (event, targetPath, ctx) =>
    refuseRemote(serverPanels.ctxOf(ctx), targetPath) || guarded(async () => {
      await shell.trashItem(targetPath);
      return { ok: true };
    }));

  ipcMain.handle(IPC.FILE_TREE_PASTE, (event, payload) =>
    refuseRemote(serverPanels.ctxOf(payload), payload && payload.source, payload && payload.destDir) || guarded(() => pasteEntry(payload || {})));
}

module.exports = {
  getFileTree,
  setupIPC
};
