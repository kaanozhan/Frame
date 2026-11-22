/**
 * newProjectFolder — make the folder "Create a new project" promises (#223).
 *
 * The dialog used to be a folder picker with a "Create Project Here" button
 * that created nothing: the picked folder itself became the project, so a
 * user who picked the parent (`~/projects`) got that whole parent registered
 * and was offered Frame setup in it. Now the dialog asks for a name and a
 * location (a save dialog) and this creates `<location>/<name>`.
 *
 * Only an empty or missing folder becomes a new project: an existing folder
 * with files in it is what "Open a folder" is for, and a file is never one.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} target - the path the save dialog returned
 * @param {object} [fsImpl] - fs, injectable for tests
 * @returns {{ path: string, error: null } | { path: null, error: string }}
 */
function createProjectFolder(target, fsImpl = fs) {
  if (typeof target !== 'string' || !target.trim()) return { path: null, error: 'No project name was given.' };
  const dir = path.resolve(target);
  const name = path.basename(dir);
  let stat = null;
  try { stat = fsImpl.statSync(dir); } catch (_) { stat = null; }
  if (stat && !stat.isDirectory()) {
    return { path: null, error: `"${name}" already exists there and is not a folder — choose another name.` };
  }
  if (stat) {
    let entries = [];
    try { entries = fsImpl.readdirSync(dir).filter((e) => e !== '.DS_Store'); } catch (err) {
      return { path: null, error: `Could not read "${name}": ${err.message}` };
    }
    if (entries.length) {
      return { path: null, error: `A folder named "${name}" already exists there and is not empty — choose another name, or use Open a folder to open it.` };
    }
    return { path: dir, error: null };
  }
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { path: null, error: `Could not create "${name}": ${err.message}` };
  }
  return { path: dir, error: null };
}

module.exports = { createProjectFolder };
