#!/usr/bin/env node
/**
 * smoke-server-package — prove a Frame Server package works on this machine
 * (server-install-update spec).
 *
 *   node scripts/smoke-server-package.js release/server/frame-server-<v>-<platform>.tar.gz
 *
 * Unpacks the tarball into a temporary folder, starts `bin/frame-server run`
 * with a temporary FRAME_SERVER_HOME, connects with the token from
 * connection.json, says hello, opens a terminal, echoes through it, closes
 * it, clones a tiny local repo, creates a workspace in it, reads its review
 * file list and stops the server. Uses only the package's own Node and modules, so
 * it tests exactly what users install. Exits non-zero on any failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const tarball = path.resolve(process.argv[2] || '');
if (!fs.existsSync(tarball)) {
  console.error('usage: node scripts/smoke-server-package.js <frame-server-…tar.gz>');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-server-smoke-'));
const home = path.join(work, 'home');
fs.mkdirSync(home);
execFileSync('tar', ['-xzf', tarball, '-C', work]);
const pkgDir = path.join(work, fs.readdirSync(work).find((d) => d.startsWith('frame-server-')));
const WebSocket = require(path.join(pkgDir, 'app', 'node_modules', 'ws'));
const P = require(path.join(pkgDir, 'app', 'src', 'shared', 'serverProtocol'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  if (server) server.kill('SIGTERM');
  process.exit(1);
}

(async () => {
  console.log(`[smoke] ${path.basename(pkgDir)} (${fs.readFileSync(path.join(pkgDir, 'VERSION'), 'utf8').trim()})`);
  // A tiny origin repo so the workspace path (clone, worktree, tooling) runs too.
  const origin = path.join(work, 'origin.git');
  const seed = path.join(work, 'seed');
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'smoke', GIT_AUTHOR_EMAIL: 'smoke@frame', GIT_COMMITTER_NAME: 'smoke', GIT_COMMITTER_EMAIL: 'smoke@frame' } });
  // `init -b` needs git 2.28; the old-distro images ship 2.25.
  git(['init', '-q', '--bare', origin], work);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], origin);
  git(['init', '-q', seed], work);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], seed);
  fs.writeFileSync(path.join(seed, 'README.md'), 'smoke\n');
  git(['add', '.'], seed);
  git(['commit', '-qm', 'init'], seed);
  git(['push', '-q', origin, 'main'], seed);

  // As users run it: on the home's Unix socket (server-hardening S8).
  server = spawn(path.join(pkgDir, 'bin', 'frame-server'), ['run'], {
    env: { ...process.env, FRAME_SERVER_HOME: path.join(home, '.frame-server'), FRAME_SERVER_PROJECTS: path.join(home, 'frame', 'projects'), HOME: home },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  server.on('exit', (code) => { if (code) fail(`server exited with ${code}\n${log}`); });

  const conn = path.join(home, '.frame-server', 'connection.json');
  for (let i = 0; i < 100 && !fs.existsSync(conn); i++) await wait(100);
  if (!fs.existsSync(conn)) fail(`no connection.json after 10 s\n${log}`);
  const info = JSON.parse(fs.readFileSync(conn, 'utf8'));
  const mode = (fs.statSync(conn).mode & 0o777).toString(8);
  if (mode !== '600') fail(`connection.json mode is ${mode}, expected 600`);

  if (info.socket) {
    const sockMode = (fs.statSync(info.socket).mode & 0o777).toString(8);
    if (sockMode !== '600') fail(`server.sock mode is ${sockMode}, expected 600`);
  }
  const url = info.socket ? `ws+unix://${info.socket}:/` : `ws://127.0.0.1:${info.port}`;
  console.log(`[smoke] connecting to ${info.socket || `port ${info.port}`}`);
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${info.token}`, Origin: 'frame-desktop' } });
  const pending = P.createPending();
  let output = '';
  const call = (method, params) => {
    const id = pending.nextId();
    const p = pending.add(id, 15000);
    ws.send(P.encode(P.request(id, method, params)));
    return p;
  };
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') { ws.send(P.encode(P.hello('smoke'))); resolve(); }
      else if (msg.type === 'res') pending.settle(msg);
      else if (msg.type === 'event' && msg.channel === 'terminal.output') output += msg.payload.data;
    });
  }).catch((err) => fail(`websocket: ${err.message}`));

  const ping = await call('server.ping', {});
  console.log(`[smoke] ping: Frame ${ping.frameVersion} on ${ping.platform}-${ping.arch}`);
  const { terminalId } = await call('terminals.create', { cwd: work, cols: 80, rows: 24, shell: '/bin/sh' });
  await wait(500);
  await call('terminals.input', { terminalId, data: 'echo frame-smoke-$((6*7))\n' });
  for (let i = 0; i < 50 && !output.includes('frame-smoke-42'); i++) await wait(100);
  if (!output.includes('frame-smoke-42')) fail(`terminal did not echo; got ${JSON.stringify(output.slice(-200))}`);
  console.log(`[smoke] terminal ${terminalId} echoed through node-pty`);
  const snap = await call('terminals.attach', { terminalId });
  if (!snap.screen.includes('frame-smoke-42')) fail('screen mirror does not show the output');
  await call('terminals.destroy', { terminalId });

  const project = await call('projects.ensure', { originUrl: origin });
  const created = await call('workspaces.create', { projectPath: project.projectPath, from: 'new', base: 'main' });
  if (!created || created.error || !created.workspace) fail(`workspace create: ${created && created.error}`);
  if (!fs.existsSync(path.join(created.workspace.path, 'README.md'))) fail('the workspace worktree has no checkout');
  const review = await call('review.files', { root: created.workspace.path, base: 'main' });
  if (review.error) fail(`review.files: ${review.error}`);
  console.log(`[smoke] cloned the project and created workspace ${created.workspace.name} on ${created.workspace.branch}`);

  ws.close();
  server.removeAllListeners('exit');
  server.kill('SIGTERM');
  await wait(300);
  fs.rmSync(work, { recursive: true, force: true });
  console.log('[smoke] OK');
  process.exit(0);
})().catch((err) => fail(err.stack || err.message));
