/**
 * Is a failed git spawn "git is not installed"? Node's spawn reports a missing
 * working directory as ENOENT too (a workspace folder removed by archive):
 * that must not switch git features off for the session (workspace-hardening L14).
 *
 * @param {object|null} err   the child_process error
 * @param {string} [cwd]      the working directory the spawn used
 * @param {(p: string) => boolean} [exists]  fs.existsSync, injectable for tests
 */
function isGitMissing(err, cwd, exists = require('fs').existsSync) {
  if (!err || (err.code !== 'ENOENT' && err.code !== 127)) return false;
  if (err.code === 'ENOENT' && cwd && !exists(cwd)) return false;
  return true;
}

module.exports = { isGitMissing };
