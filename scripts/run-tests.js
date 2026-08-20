#!/usr/bin/env node
/**
 * Cross-platform test launcher.
 *
 * `FRAME_ACTIVITY_HOME=… node --test test/*.test.js` is a POSIX invocation
 * wearing an npm script's clothes: `cmd.exe` sets no inline environment
 * variable, does not expand the glob, and Node 20 does not expand it either —
 * so the Windows leg of CI would have run zero tests while reporting success.
 * CI deliberately installs nothing (see .github/workflows/ci.yml), so a
 * `cross-env`-shaped dependency is not available to fix it.
 *
 * This does the three things the shell was doing, in Node:
 *
 *   1. sets FRAME_ACTIVITY_HOME, so a test run never writes to the real
 *      activity log;
 *   2. lists the test files itself — which makes the `test/fixtures/`
 *      exclusion an explicit rule rather than an accident of what a glob
 *      happens to match;
 *   3. forwards the child's exit code, so a red suite is still a red build.
 *
 * Usage:
 *   node scripts/run-tests.js                  # the whole suite
 *   node scripts/run-tests.js shellSetup       # only matching files
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT_DIR, 'test');

// Only files directly in test/. `test/fixtures/` holds whole sample projects
// the suite runs *against*; a recursive walk would try to execute them.
function testFiles(filters) {
  const names = fs.readdirSync(TEST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => entry.name)
    .sort();

  if (!filters.length) return names;
  return names.filter((name) => filters.some((f) => name.toLowerCase().includes(f.toLowerCase())));
}

function main() {
  const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const files = testFiles(filters);

  if (!files.length) {
    console.error(filters.length
      ? `No test files match: ${filters.join(', ')}`
      : 'No test files found in test/');
    process.exit(1);
  }

  const child = spawn(
    process.execPath,
    ['--test', ...files.map((name) => path.join('test', name))],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        // A relative path, resolved by each test against the repo root, so the
        // value reads the same on every platform.
        FRAME_ACTIVITY_HOME: process.env.FRAME_ACTIVITY_HOME || path.join('.frame', 'runtime', 'test-activity')
      }
    }
  );

  // Exit code first, signal second: a suite killed by SIGINT must not look
  // like a pass to CI.
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code == null ? 1 : code));
  });
  child.on('error', (err) => {
    console.error(`Could not start the test runner: ${err.message}`);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { testFiles };
