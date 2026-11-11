// A Frame Server stand-in that speaks the real protocol (serverConnection.test.js):
// listens on 127.0.0.1, writes connection.json, checks the token, says hello,
// answers server.ping and terminals.list. `<home>/fake-mode` changes it per
// connection: "close" closes right after the upgrade (before hello),
// "slow-list" answers terminals.list after 1.5 s. With `<home>/fake-socket`
// present at start it listens on `<home>/server.sock` and writes `socket`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(process.env.FAKE_WS_MODULE);
const P = require(process.env.FAKE_PROTOCOL_MODULE);
const home = process.env.FRAME_SERVER_HOME || path.join(require('os').homedir(), '.frame-server');
const version = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'VERSION'), 'utf8').trim();
const token = crypto.randomBytes(16).toString('hex');
const mode = () => { try { return fs.readFileSync(path.join(home, 'fake-mode'), 'utf8').trim(); } catch (_) { return ''; } };
const useSocket = fs.existsSync(path.join(home, 'fake-socket'));
const sock = path.join(home, 'server.sock');
if (useSocket) fs.rmSync(sock, { force: true });
const wss = new WebSocket.Server({
  ...(useSocket ? { server: require('http').createServer().listen(sock) } : { host: '127.0.0.1', port: 0 }),
  verifyClient: (info) => info.req.headers.authorization === `Bearer ${token}`
});
const announce = () => fs.writeFileSync(path.join(home, 'connection.json'),
  JSON.stringify({ ...(useSocket ? { socket: sock } : { port: wss.address().port }), token, protocol: P.PROTOCOL_VERSION, frameVersion: version, pid: process.pid }) + '\n');
if (useSocket) wss.options.server.on('listening', announce); else wss.on('listening', announce);
wss.on('connection', (ws) => {
  if (mode() === 'close') { ws.close(); return; }
  ws.send(P.encode(P.hello(version)));
  ws.on('message', (data) => {
    const d = P.decode(data.toString());
    if (!d.ok || d.msg.type !== 'req') return;
    const { id, method } = d.msg;
    if (method === 'server.ping') ws.send(P.encode(P.reply(id, { platform: 'linux', arch: 'x64' })));
    else if (method === 'terminals.list') setTimeout(() => ws.send(P.encode(P.reply(id, []))), mode() === 'slow-list' ? 1500 : 0);
    else ws.send(P.encode(P.failure(id, `fake server: no ${method}`)));
  });
});
process.on('SIGTERM', () => process.exit(0));
