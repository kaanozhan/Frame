#!/usr/bin/env node
// ssh stand-in for test/serverConnection.test.js (server-hardening T04).
//   ssh [-o …] host <command>  → runs <command> with bash under
//                                HOME=$FAKE_REMOTE_HOME, $FAKE_BIN_DIR first on PATH
//                                (fake uname / systemctl), stdin passed through.
//   ssh -N … -L lp:127.0.0.1:rp host → a TCP proxy from lp to rp until killed.
// Host "nohost" fails like an unknown host.
const net = require('net');
const { spawn } = require('child_process');
const raw = process.argv.slice(2);
const args = [];
for (let i = 0; i < raw.length; i++) { if (raw[i] === '-o') { i++; continue; } args.push(raw[i]); }
if (args.includes('-N')) {
  const spec = args[args.indexOf('-L') + 1].split(':');
  const server = net.createServer((c) => {
    const u = net.connect(Number(spec[3]), '127.0.0.1');
    c.pipe(u); u.pipe(c);
    u.on('error', () => c.destroy());
    c.on('error', () => u.destroy());
  });
  server.listen(Number(spec[1]), '127.0.0.1');
  process.on('SIGTERM', () => process.exit(0));
} else {
  const [host, ...cmd] = args.filter((a) => a !== '-T');
  if (host === 'nohost') { process.stderr.write('ssh: Could not resolve hostname nohost\n'); process.exit(255); }
  const env = { ...process.env, HOME: process.env.FAKE_REMOTE_HOME, PATH: `${process.env.FAKE_BIN_DIR}:${process.env.PATH}` };
  delete env.FRAME_SERVER_HOME;
  const child = spawn('bash', ['-c', cmd.join(' ')], { env, stdio: 'inherit', cwd: process.env.FAKE_REMOTE_HOME });
  child.on('close', (code) => process.exit(code == null ? 1 : code));
}
