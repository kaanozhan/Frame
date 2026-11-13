#!/usr/bin/env node
/**
 * build-server-package — build the Frame Server package for THIS platform
 * (server-install-update spec).
 *
 *   node scripts/build-server-package.js [--out release/server] [--version X]
 *
 * Produces `frame-server-<version>-<platform>.tar.gz` and its `.sha256`. The
 * tarball holds one folder with:
 *   node/bin/node       the Node running this script (CI pins Node 20)
 *   app/                package.json, src/ (minus the renderer), scripts/
 *                       (minus the eval corpus), production node_modules with
 *                       node-pty rebuilt for that Node
 *   bin/frame-server    the server command
 *   VERSION
 * Nothing is compiled on the user's server. Run it on the target platform
 * (CI builds linux-x64 and linux-arm64 on matching runners).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function platformName() {
  const osName = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null;
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null;
  if (!osName || !arch) throw new Error(`Unsupported build platform ${process.platform}-${process.arch}`);
  return `${osName}-${arch}`;
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });
}

function copy(src, dest) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !p.includes(`${path.sep}src${path.sep}renderer`) });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const version = arg('--version', require(path.join(ROOT, 'package.json')).version);
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'release', 'server')));
  const platform = platformName();
  const name = `frame-server-${version}-${platform}`;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-server-pkg-'));
  const pkg = path.join(stage, name);
  const app = path.join(pkg, 'app');

  console.log(`[package] ${name} with Node ${process.version}`);
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, f), path.join(app, f));
  copy(path.join(ROOT, 'src'), path.join(app, 'src'));
  // The server's modules reach into scripts/ (redact, detect-project,
  // activity-log, toolVocabulary, structure-*) and workspace tooling copies
  // some of them into worktrees, so ship the folder whole — minus the
  // retrieval eval corpus, which only the test suite reads.
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(app, 'scripts'), {
    recursive: true,
    filter: (p) => !p.startsWith(path.join(ROOT, 'scripts', 'eval'))
  });

  // Production dependencies without lifecycle scripts (no Electron download,
  // no electron-rebuild), then node-pty built for this Node.
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], app);
  run('npm', ['rebuild', 'node-pty'], app);
  run(process.execPath, [path.join(app, 'scripts', 'fix-node-pty-helper.js')], app);
  const builtHelper = path.join(app, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
  if (fs.existsSync(builtHelper)) fs.chmodSync(builtHelper, 0o755);

  fs.mkdirSync(path.join(pkg, 'node', 'bin'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(pkg, 'node', 'bin', 'node'));
  fs.chmodSync(path.join(pkg, 'node', 'bin', 'node'), 0o755);
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'server', 'bin', 'frame-server'), path.join(pkg, 'bin', 'frame-server'));
  fs.chmodSync(path.join(pkg, 'bin', 'frame-server'), 0o755);
  fs.writeFileSync(path.join(pkg, 'VERSION'), `${version}\n`);

  // Prove the native module loads with the bundled Node before shipping it.
  execFileSync(path.join(pkg, 'node', 'bin', 'node'), ['-e', "require('node-pty'); console.log('[package] node-pty loads')"], { cwd: app, stdio: 'inherit' });

  fs.mkdirSync(outDir, { recursive: true });
  const tarball = path.join(outDir, `${name}.tar.gz`);
  run('tar', ['-czf', tarball, '-C', stage, name], ROOT);
  fs.writeFileSync(`${tarball}.sha256`, `${sha256(tarball)}  ${path.basename(tarball)}\n`);
  fs.rmSync(stage, { recursive: true, force: true });
  const mb = (fs.statSync(tarball).size / 1024 / 1024).toFixed(1);
  console.log(`[package] ${tarball} (${mb} MB)`);
  console.log(`[package] ${tarball}.sha256`);
}

main();
