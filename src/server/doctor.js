/**
 * Server check-up — what this server can do for Frame and what is missing
 * (server-install-update spec).
 *
 *   server.doctor → { raw, items: [{ id, label, ok, optional?, detail, fix? }] }
 *
 * Measures, as the server user: whether Claude Code and Codex are installed
 * (the same login-shell probe agent lanes use) and signed in (their
 * credential files), whether `gh` is installed and authenticated, whether git
 * is there, and how Frame Server itself runs (systemd user service, linger,
 * or a detached process). serverInstall.doctorItems turns that into the
 * ready/missing list with a fix command for each gap. Read-only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { doctorItems } = require('../shared/serverInstall');

const PROBE_TIMEOUT_MS = 10000;

/** Run a command in the user's login shell (PATH from their profile); resolves { ok, stdout }. */
function shell(command) {
  const sh = process.env.SHELL || '/bin/bash';
  return new Promise((resolve) => {
    execFile(sh, ['-lc', command], { timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout || '') });
    });
  });
}

function exists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function claudeSignedIn(home) {
  if (exists(path.join(home, '.claude', '.credentials.json'))) return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    return !!(cfg && (cfg.oauthAccount || cfg.primaryApiKey));
  } catch (_) {
    return false;
  }
}

async function measure() {
  const home = os.homedir();
  const aiToolManager = require('../main/aiToolManager');
  const [claude, codex, ghInstalled, ghAuth, git, unit, lingerOut] = await Promise.all([
    aiToolManager.checkToolAvailable({ toolId: 'claude' }).catch(() => ({ available: false })),
    aiToolManager.checkToolAvailable({ toolId: 'codex' }).catch(() => ({ available: false })),
    shell('command -v gh'),
    shell('gh auth status'),
    shell('git --version'),
    shell('systemctl --user is-enabled frame-server'),
    shell('loginctl show-user "$USER" -p Linger --value')
  ]);
  const frameHome = process.env.FRAME_SERVER_HOME || path.join(home, '.frame-server');
  const mode = unit.ok && /enabled/.test(unit.stdout) ? 'systemd' : exists(path.join(frameHome, 'server.pid')) ? 'detached' : 'manual';
  return {
    claude: { installed: !!claude.available, signedIn: claudeSignedIn(home) },
    codex: { installed: !!codex.available, signedIn: exists(path.join(home, '.codex', 'auth.json')) },
    gh: { installed: ghInstalled.ok && !!ghInstalled.stdout.trim(), authed: ghAuth.ok },
    git: { installed: git.ok },
    service: { mode, linger: lingerOut.ok && lingerOut.stdout.trim() === 'yes' }
  };
}

function setup({ registerMethods }) {
  registerMethods({
    'server.doctor': async () => {
      const raw = await measure();
      return { raw, items: doctorItems(raw) };
    }
  });
  return { stop() {} };
}

module.exports = { setup, measure };
