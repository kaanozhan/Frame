/**
 * serverInstall — the rules behind installing and updating Frame Server
 * (server-install-update spec).
 *
 * Which package fits a server, how versions compare (dev builds included),
 * whether to install, update or leave the server alone, how a checksum file
 * reads, what the systemd user unit says, and how the server check-up turns
 * into ready/missing items with the command to fix each. Pure: strings and
 * plain values only — the SSH calls and the shell installer live elsewhere.
 */

const RELEASE_BASE = 'https://github.com/kaanozhan/Frame/releases/download';

/** Exit codes of scripts/install-frame-server.sh (also the result line's `code`). */
const INSTALL_EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  DOWNLOAD_UNAVAILABLE: 10,
  CHECKSUM_MISMATCH: 11,
  MISSING_BUILD_TOOLS: 12,
  START_FAILED: 13,
  UNSUPPORTED_PLATFORM: 14,
  NOTHING_TO_ROLL_BACK: 15,
  BUSY: 16 // another install is running for that home (server-hardening S10)
});

/**
 * The package for a server from `uname -s` / `uname -m`:
 * `{ platform, asset, checksum }` or `{ error }`.
 */
function assetFor(unameS, unameM, version) {
  const os = String(unameS || '').trim().toLowerCase();
  const m = String(unameM || '').trim().toLowerCase();
  if (os === 'darwin') return { error: 'macOS servers have no Frame Server package yet — use the manual install in src/server/README.md.' };
  if (os !== 'linux') return { error: `Frame Server packages are built for Linux; this server reports "${unameS || 'unknown'}".` };
  const arch = m === 'x86_64' || m === 'amd64' ? 'x64' : m === 'aarch64' || m === 'arm64' ? 'arm64' : null;
  if (!arch) return { error: `No Frame Server package for the ${unameM || 'unknown'} processor (packages exist for x86_64 and aarch64).` };
  const platform = `linux-${arch}`;
  const asset = `frame-server-${version}-${platform}.tar.gz`;
  return { platform, asset, checksum: `${asset}.sha256` };
}

/** Where a release asset is downloaded from. */
function releaseUrl(version, asset) {
  return `${RELEASE_BASE}/v${version}/${asset}`;
}

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null, build: m[5] || null };
}

/**
 * -1 / 0 / 1 like semver: numbers first, a prerelease (`2.9.0-dev`) sorts
 * before its release, build metadata (`+abc123`) does not order. Unparseable
 * versions sort first.
 */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * What to do with a server: `{ action, reason }`, action one of
 *   install       — nothing (or nothing managed) is there
 *   update        — the server runs an older version, or speaks another protocol
 *   reinstall-dev — this desktop runs from source and the server runs something else
 *   none          — matching
 * `installed` is `{ current, versions?, manual? }` or null; `dev` is true for a
 * desktop running from source (its version then carries `-dev+<sha>`).
 */
function installDecision({ installed = null, desktopVersion, dev = false, protocolOk = true } = {}) {
  if (!installed || !installed.current) {
    return { action: 'install', reason: 'Frame Server is not installed on this server.' };
  }
  const current = String(installed.current);
  if (dev) {
    return current === desktopVersion
      ? { action: 'none', reason: 'The server runs this development build.' }
      : { action: 'reinstall-dev', reason: `This Frame runs from source (${desktopVersion}); the server runs ${current}.` };
  }
  if (!protocolOk) {
    return { action: 'update', reason: `The server runs Frame Server ${current}, which speaks another protocol than this Frame ${desktopVersion}.` };
  }
  const cmp = compareVersions(current, desktopVersion);
  if (cmp < 0) return { action: 'update', reason: `The server runs Frame Server ${current}; this Frame is ${desktopVersion}.` };
  if (installed.manual) return { action: 'none', reason: `A hand-installed Frame Server ${current} is running.` };
  if (cmp > 0) return { action: 'none', reason: `The server runs a newer Frame Server (${current}) that this Frame can still talk to.` };
  return { action: 'none', reason: `The server runs Frame Server ${current}.` };
}

/**
 * The hex SHA-256 for `fileName` in a checksum file (`<hex>  <name>`,
 * `<hex> *<name>`, or a bare hex digest), lower-cased; null when absent.
 */
function parseChecksum(text, fileName) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let bare = null;
  for (const line of lines) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/.exec(line);
    if (!m) continue;
    if (!m[2]) { bare = bare || m[1].toLowerCase(); continue; }
    const name = m[2].trim().split('/').pop();
    if (!fileName || name === fileName) return m[1].toLowerCase();
  }
  return bare;
}

/** The systemd user unit that runs the current version. */
function systemdUnit() {
  return [
    '[Unit]',
    'Description=Frame Server',
    'After=network-online.target',
    '',
    '[Service]',
    'ExecStart=%h/.frame-server/current/bin/frame-server run',
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');
}

/**
 * The check-up as items for the Connect dialog. `raw` is what server.doctor
 * measured: `{ claude, codex: { installed, signedIn }, gh: { installed, authed },
 * git: { installed }, service: { mode, linger } }`. Each item is
 * `{ id, label, ok, optional?, detail, fix? }`; at least one agent CLI must be ready.
 */
function doctorItems(raw = {}) {
  const r = raw || {};
  const agent = (id, label, install, login) => {
    const a = r[id] || {};
    if (!a.installed) return { id, label, ok: false, detail: 'not installed', fix: install };
    if (!a.signedIn) return { id, label, ok: false, detail: 'installed, not signed in', fix: login };
    return { id, label, ok: true, detail: 'ready' };
  };
  const claude = agent('claude', 'Claude Code', 'npm install -g @anthropic-ai/claude-code', 'claude   # then sign in');
  const codex = agent('codex', 'Codex', 'npm install -g @openai/codex', 'codex login');
  const anyAgent = claude.ok || codex.ok;
  claude.optional = anyAgent && !claude.ok;
  codex.optional = anyAgent && !codex.ok;
  const gh = r.gh || {};
  const items = [
    claude,
    codex,
    !gh.installed
      ? { id: 'gh', label: 'GitHub CLI', ok: false, detail: 'not installed (needed for pull requests)', fix: 'sudo apt install -y gh' }
      : !gh.authed
        ? { id: 'gh', label: 'GitHub CLI', ok: false, detail: 'not signed in', fix: 'gh auth login && gh auth setup-git' }
        : { id: 'gh', label: 'GitHub CLI', ok: true, detail: 'signed in' },
    (r.git || {}).installed
      ? { id: 'git', label: 'git', ok: true, detail: 'installed' }
      : { id: 'git', label: 'git', ok: false, detail: 'not installed', fix: 'sudo apt install -y git' }
  ];
  const svc = r.service || {};
  if (svc.mode === 'systemd' && svc.linger) {
    items.push({ id: 'service', label: 'Keeps running after logout', ok: true, detail: 'systemd user service with linger' });
  } else if (svc.mode === 'manual') {
    items.push({
      id: 'service',
      label: 'Keeps running after logout',
      ok: false,
      detail: 'started by hand — it stops when that shell or session ends',
      fix: '~/.frame-server/bin/frame-server install-service'
    });
  } else {
    items.push({
      id: 'service',
      label: 'Keeps running after logout',
      ok: false,
      detail: svc.mode === 'systemd' ? 'systemd user service without linger — it stops when you log out' : 'running as a detached process — it stops on reboot',
      fix: 'sudo loginctl enable-linger "$USER"'
    });
  }
  return items;
}

const AGENT_NAMES = ['claude', 'codex', 'gemini', 'aider'];

/**
 * The server terminals running an agent, from `terminals.list` (each with its
 * last process info): `[{ terminalId, workspaceId, agent }]`. Used to ask
 * before an update or rollback ends them.
 */
function agentTerminals(list) {
  const out = [];
  for (const t of list || []) {
    const p = (t && t.process) || {};
    const tokens = [p.processName, ...String(p.commandLine || '').split(/\s+/)].filter(Boolean);
    const agent = tokens.map((x) => String(x).split('/').pop().toLowerCase()).find((x) => AGENT_NAMES.includes(x));
    if (agent) out.push({ terminalId: t.terminalId, workspaceId: t.workspaceId, agent });
  }
  return out;
}

/**
 * Whether an update or rollback must ask first (server-hardening S9): when
 * agents run, when the list could not be read (`agents === null`), or when
 * the server cannot be asked at all but something is installed. Unknown
 * never reads as "none running".
 */
function consentNeeded({ connected, agents, installed }) {
  if (connected) return agents === null || agents === undefined || agents.length > 0;
  return !!installed;
}

module.exports = { RELEASE_BASE, INSTALL_EXIT, consentNeeded, agentTerminals, assetFor, releaseUrl, parseVersion, compareVersions, installDecision, parseChecksum, systemdUnit, doctorItems };
