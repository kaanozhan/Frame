// Stand-in for src/server/index.js in test packages (installScript.test.js):
// writes connection.json like the real server and stays up until signalled.
const fs = require('fs');
const path = require('path');
const home = process.env.FRAME_SERVER_HOME || path.join(require('os').homedir(), '.frame-server');
const version = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'VERSION'), 'utf8').trim();
fs.writeFileSync(path.join(home, 'connection.json'),
  JSON.stringify({ port: 1, token: 't', protocol: 1, frameVersion: version, pid: process.pid }) + '\n');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1 << 30);
