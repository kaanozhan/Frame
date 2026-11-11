#!/usr/bin/env node
// ssh stand-in for test/serverConnection.test.js (server-hardening T04).
//   ssh [-o …] host <command>  → runs <command> with bash under
//                                HOME=$FAKE_REMOTE_HOME, $FAKE_BIN_DIR first on PATH
//                                (fake uname / systemctl), stdin passed through.
//   ssh -N … -L <local>:<remote> host → a proxy until killed. <local> is
//                                `127.0.0.1:lp` or a socket path; <remote> is
//                                `127.0.0.1:rp` or a socket path. With
//                                FAKE_SSH_NO_STREAMLOCAL=1 a socket target is
//                                refused like sshd's AllowStreamLocalForwarding no.
// Host "nohost" fails like an unknown host.
const net = require('net');
const { spawn } = require('child_process');
const raw = process.argv.slice(2);
const args = [];
for (let i = 0; i < raw.length; i++) { if (raw[i] === '-o') { i++; continue; } args.push(raw[i]); }
if (args.includes('-N')) {
  const spec = args[args.indexOf('-L') + 1];
  // local: "127.0.0.1:lp" or "/path"; remote: "127.0.0.1:rp" or "/path"
  let local; let remote;
  if (spec.startsWith('/')) {
    const i = spec.indexOf(':');
    local = { path: spec.slice(0, i) };
    remote = spec.slice(i + 1);
  } else {
    const parts = spec.split(':');
    local = { port: Number(parts[1]) };
    remote = parts.slice(2).join(':');
  }
  const target = remote.startsWith('/') ? { path: remote } : { port: Number(remote.split(':')[1]) };
  const server = net.createServer((c) => {
    if (target.path && process.env.FAKE_SSH_NO_STREAMLOCAL === '1') {
      process.stderr.write('channel 2: open failed: administratively prohibited: open failed\n');
      c.destroy();
      return;
    }
    const u = target.path ? net.connect(target.path) : net.connect(target.port, '127.0.0.1');
    c.pipe(u); u.pipe(c);
    u.on('error', () => c.destroy());
    c.on('error', () => u.destroy());
  });
  if (local.path) { try { require('fs').rmSync(local.path, { force: true }); } catch (_) { /* none */ } server.listen(local.path); }
  else server.listen(local.port, '127.0.0.1');
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
} else {
  const [host, ...cmd] = args.filter((a) => a !== '-T');
  if (host === 'nohost') { process.stderr.write('ssh: Could not resolve hostname nohost\n'); process.exit(255); }
  const env = { ...process.env, HOME: process.env.FAKE_REMOTE_HOME, PATH: `${process.env.FAKE_BIN_DIR}:${process.env.PATH}` };
  delete env.FRAME_SERVER_HOME;
  const child = spawn('bash', ['-c', cmd.join(' ')], { env, stdio: 'inherit', cwd: process.env.FAKE_REMOTE_HOME });
  child.on('close', (code) => process.exit(code == null ? 1 : code));
}
