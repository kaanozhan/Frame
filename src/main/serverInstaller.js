/**
 * Server installer — installs, updates and rolls back Frame Server on a host
 * over the user's own SSH (server-install-update spec).
 *
 * The work on the server is done by one script, scripts/install-frame-server.sh,
 * streamed over SSH (`ssh host 'bash -s -- <args>' < script`), so a desktop
 * install and a `curl | bash` install produce the same layout. This module:
 *
 *   probe(host)       platform (uname) and what is installed (frame-server
 *                     status --json, or a hand-run server's connection.json)
 *   decide(host)      install / update / reinstall-dev / none (serverInstall)
 *   install(host)     released desktop → the server downloads the release
 *                     package; if it cannot reach GitHub (exit 10) the desktop
 *                     downloads it and streams it over SSH. A desktop running
 *                     from source streams `git archive HEAD` and the server
 *                     builds it. Progress lines go to `onProgress`.
 *   rollback(host)    back to the previous installed version
 *   runningAgents()   the connected server's terminals with an agent — the
 *                     caller asks the user before update or rollback
 *
 * Frame stores no SSH secrets; BatchMode means no prompts (FRAME_SSH lets
 * tests substitute ssh). FRAME_RELEASE_BASE overrides the release host (tests).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');
const I = require('../shared/serverInstall');
const logger = require('./logger');

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

function sshBin() {
  return process.env.FRAME_SSH || 'ssh';
}

function appRoot() {
  return path.join(__dirname, '..', '..');
}

function releaseBase() {
  return process.env.FRAME_RELEASE_BASE || I.RELEASE_BASE;
}

/**
 * Run `command` on `host`. `input` is a string, Buffer or readable stream
 * for its stdin. Lines of stdout go to `onLine`. Resolves { code, stdout, stderr }.
 */
function ssh(host, command, { input = null, onLine = null, timeout = INSTALL_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(sshBin(), [...SSH_OPTS, host, command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pendingLine = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (!onLine) return;
      pendingLine += text;
      const lines = pendingLine.split('\n');
      pendingLine = lines.pop();
      for (const l of lines) if (l.trim()) onLine(l);
    });
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-8000); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onLine && pendingLine.trim()) onLine(pendingLine);
      resolve({ code: code == null ? 1 : code, stdout, stderr });
    });
    // The remote `bash -s` may exit before reading all of the script (a
    // mode that ends early, a lock, an error): writing the rest then fails
    // with EPIPE. The exit code and result line say what happened, so a
    // closed stdin is not an error — and must never become an uncaught one.
    child.stdin.on('error', () => {});
    if (input && typeof input.pipe === 'function') {
      input.on('error', () => {});
      input.pipe(child.stdin);
    }
    else child.stdin.end(input || '');
  });
}

function sshFailure(host, res) {
  const last = String(res.stderr || '').trim().split('\n').pop();
  return last ? `ssh ${host}: ${last}` : `ssh ${host} failed (exit ${res.code})`;
}

// ─── Versions ────────────────────────────────────────────────

let devVersionCache = null;

/** This desktop's version; a desktop running from source is `<v>-dev+<sha>`. */
async function desktopVersion() {
  const { app } = require('electron');
  const version = app.getVersion();
  if (app.isPackaged) return { version, dev: false };
  if (!devVersionCache) {
    const sha = await new Promise((resolve) => {
      execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: appRoot() }, (err, out) => resolve(err ? 'local' : String(out).trim()));
    });
    devVersionCache = `${version}-dev+${sha}`;
  }
  return { version: devVersionCache, dev: true };
}

// ─── Probe and decide ────────────────────────────────────────

const PROBE = [
  'uname -sm',
  'if [ -x "$HOME/.frame-server/bin/frame-server" ]; then echo FRAME:MANAGED; "$HOME/.frame-server/bin/frame-server" status --json;',
  // A hand-run server: is the pid in its connection.json alive? (server-hardening S4)
  'elif [ -f "$HOME/.frame-server/connection.json" ]; then echo FRAME:MANUAL; cat "$HOME/.frame-server/connection.json"; echo;',
  '  pid="$(sed -n \'s/.*"pid": *\\([0-9][0-9]*\\).*/\\1/p\' "$HOME/.frame-server/connection.json" | head -n1)";',
  '  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo FRAME:ALIVE; else echo FRAME:DEAD; fi;',
  'else echo FRAME:NONE; fi'
].join('\n');

/**
 * What is on the host: `{ error?, unameS, unameM, installed: { current, previous,
 * versions, manual, running, runningVersion, service, linger } | null }`.
 */
async function probe(host) {
  const res = await ssh(host, PROBE, { timeout: 30000 });
  if (res.code !== 0) return { error: sshFailure(host, res) };
  const lines = res.stdout.split('\n');
  const [unameS = '', unameM = ''] = (lines[0] || '').trim().split(/\s+/);
  const markerAt = lines.findIndex((l) => l.startsWith('FRAME:'));
  const marker = markerAt >= 0 ? lines[markerAt].trim() : 'FRAME:NONE';
  const rest = lines.slice(markerAt + 1).join('\n').trim();
  let installed = null;
  try {
    if (marker === 'FRAME:MANAGED') {
      const s = JSON.parse(rest);
      installed = { current: s.current, previous: s.previous, versions: s.versions || [], manual: false, running: !!s.running, runningVersion: s.runningVersion, service: s.service, linger: !!s.linger };
    } else if (marker === 'FRAME:MANUAL') {
      const restLines = rest.split('\n');
      const aliveLine = restLines.findIndex((l) => l.trim() === 'FRAME:ALIVE' || l.trim() === 'FRAME:DEAD');
      const running = aliveLine >= 0 ? restLines[aliveLine].trim() === 'FRAME:ALIVE' : true;
      const c = JSON.parse((aliveLine >= 0 ? restLines.slice(0, aliveLine) : restLines).join('\n'));
      installed = { current: c.frameVersion || null, previous: null, versions: [], manual: true, running, runningVersion: running ? c.frameVersion || null : null, service: 'manual', linger: false };
    }
  } catch (_) {
    installed = null;
  }
  return { unameS, unameM, installed };
}

/** `{ action, reason, desktopVersion, dev, probe }` for a host. */
async function decide(host, { protocolOk = true } = {}) {
  const p = await probe(host);
  if (p.error) return { action: 'error', reason: p.error, probe: p };
  const { version, dev } = await desktopVersion();
  const d = I.installDecision({ installed: p.installed, desktopVersion: version, dev, protocolOk });
  return { ...d, desktopVersion: version, dev, probe: p };
}

// ─── Install / update / rollback ─────────────────────────────

function parseResult(stdout) {
  const line = String(stdout || '').split('\n').reverse().find((l) => l.startsWith('FRAME_INSTALL_RESULT '));
  if (!line) return null;
  try { return JSON.parse(line.slice('FRAME_INSTALL_RESULT '.length)); } catch (_) { return null; }
}

function scriptPath() {
  return path.join(appRoot(), 'scripts', 'install-frame-server.sh');
}

/** Run the installer on the host with `args` (already shell-safe words). */
async function runInstaller(host, args, onProgress) {
  const command = `bash -s -- ${args.join(' ')}`;
  const res = await ssh(host, command, {
    input: fs.createReadStream(scriptPath()),
    onLine: (l) => { if (l.startsWith('frame-install:') && onProgress) onProgress(l.replace(/^frame-install:\s*/, '')); }
  });
  const result = parseResult(res.stdout);
  if (!result) return { ok: false, code: res.code, message: sshFailure(host, res) };
  return { ...result, code: result.code != null ? result.code : res.code };
}

/** GET with redirects into a file (GitHub release assets redirect to a CDN). */
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Frame-desktop' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('download timed out')));
  });
}

/** Stream a local file to `remotePath` on the host. */
async function upload(host, localFile, remotePath) {
  const dir = path.posix.dirname(remotePath);
  const res = await ssh(host, `mkdir -p ${dir} && cat > ${remotePath}`, { input: fs.createReadStream(localFile) });
  if (res.code !== 0) throw new Error(`upload failed: ${sshFailure(host, res)}`);
}

/** Source tarball of this checkout (`git archive HEAD`) in a temp file. */
function sourceTarball() {
  const dest = path.join(os.tmpdir(), `frame-src-${process.pid}-${Date.now()}.tar`);
  return new Promise((resolve, reject) => {
    execFile('git', ['archive', '--format=tar', '-o', dest, 'HEAD'], { cwd: appRoot(), maxBuffer: 64 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(`git archive failed: ${err.message}`));
      else resolve(dest);
    });
  });
}

/**
 * Install (or update to) this desktop's version on `host`.
 * Resolves the installer's result `{ ok, version, service, rolledBack, code, message, via }`.
 */
async function install(host, { onProgress = () => {}, version: forcedVersion = null, dev: forcedDev = null } = {}) {
  const desk = await desktopVersion();
  const version = forcedVersion || desk.version;
  const dev = forcedDev == null ? desk.dev : forcedDev;
  const p = await probe(host);
  if (p.error) return { ok: false, message: p.error };

  if (dev) {
    onProgress(`This Frame runs from source — building ${version} on the server`);
    const tar = await sourceTarball();
    try {
      onProgress('Uploading the source');
      await upload(host, tar, '~/.frame-server/tmp/frame-src.tar');
    } finally {
      fs.rm(tar, { force: true }, () => {});
    }
    return { ...(await runInstaller(host, ['--from-source', '~/.frame-server/tmp/frame-src.tar', '--version', version], onProgress)), via: 'source' };
  }

  const asset = I.assetFor(p.unameS, p.unameM, version);
  if (asset.error) return { ok: false, code: 14, message: asset.error };
  onProgress(`Installing Frame Server ${version} for ${asset.platform}`);
  const first = await runInstaller(host, ['--version', version], onProgress);
  if (first.ok || first.code !== 10) return { ...first, via: 'server-download' };

  // The server could not reach GitHub: download here and stream it over.
  onProgress('The server cannot download the package — sending it from this Mac');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-server-dl-'));
  try {
    const local = path.join(dir, asset.asset);
    await download(I.releaseUrl(version, asset.asset).replace(I.RELEASE_BASE, releaseBase()), local);
    await download(I.releaseUrl(version, asset.checksum).replace(I.RELEASE_BASE, releaseBase()), `${local}.sha256`);
    const sum = I.parseChecksum(fs.readFileSync(`${local}.sha256`, 'utf8'), asset.asset);
    if (!sum) return { ok: false, code: 11, message: `No checksum found for ${asset.asset}` };
    onProgress('Uploading the package');
    await upload(host, local, `~/.frame-server/tmp/${asset.asset}`);
    return { ...(await runInstaller(host, ['--package-file', `~/.frame-server/tmp/${asset.asset}`, '--checksum', sum, '--version', version], onProgress)), via: 'desktop-upload' };
  } catch (err) {
    logger.warn('server', `desktop download failed: ${err.message}`);
    return { ok: false, code: 10, message: `Neither the server nor this Mac could download Frame Server ${version}: ${err.message}` };
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

/** Start the installed current version (after a reboot, or a stopped process). */
async function start(host, { onProgress = () => {} } = {}) {
  return runInstaller(host, ['--service-only'], onProgress);
}

/** Back to the previous installed version. */
async function rollback(host, { onProgress = () => {} } = {}) {
  return runInstaller(host, ['--rollback'], onProgress);
}

/**
 * Agents running on the connected server, for the update consent:
 * `[{ terminalId, workspaceId, workspace, agent }]`, or null when the list
 * cannot be read (not connected, an error, a timeout) — unknown is never
 * "none running" (server-hardening S9).
 */
async function runningAgents() {
  const sc = require('./serverConnection');
  if (!sc.isConnected()) return null;
  let list;
  try { list = await sc.call('terminals.list', {}); } catch (_) { return null; }
  if (!Array.isArray(list)) return null;
  let names = new Map();
  try {
    names = new Map(require('./workspaceManager').serverRoots().map((r) => [r.id, r.root.split('/').pop()]));
  } catch (_) { /* names stay ids */ }
  return I.agentTerminals(list).map((a) => ({ ...a, workspace: names.get(a.workspaceId) || a.workspaceId }));
}

module.exports = { probe, decide, install, start, rollback, runningAgents, desktopVersion, parseResult, upload };
