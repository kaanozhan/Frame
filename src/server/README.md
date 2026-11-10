# Frame Server

Frame Server runs your **server workspaces** on a machine you own: a Linux VPS, a Mac mini or a home server. Their terminals and agents run there and keep running while your laptop sleeps. Frame on your Mac connects over your own SSH and shows those workspaces in the same window as local ones.

Nothing runs as root, and nothing runs in Docker. Frame Server runs as your user, with your shell, your tools and your logins.

## Install from Frame (recommended)

1. Make sure `ssh <host> true` works **without a password prompt**. Frame runs SSH in batch mode, so keys, ssh-agent, `~/.ssh/config` and Tailscale SSH all work, but typed passwords and host-key questions do not.
2. In Frame, choose **File ▸ Connect to Server…**, pick the host and press **Connect**.
3. If Frame Server is not there, Frame says so. Press **Install Frame Server**. Frame then:
   - detects the server's platform (Linux x86_64 or aarch64);
   - has the server download the matching package from the GitHub release and verify its SHA-256. If the server cannot reach GitHub, Frame downloads the package and sends it over SSH;
   - unpacks it under `~/.frame-server/versions/<version>` and points `current` at it;
   - starts it as a systemd user service with linger, so it survives logout. Where systemd user services are not available, it starts a background process, and Frame restarts that process whenever it finds it stopped;
   - checks that the new version is running, then connects.
4. After connecting, the dialog shows a **server check-up**:
   - Claude Code / Codex installed and signed in;
   - GitHub CLI signed in;
   - git;
   - whether Frame Server keeps running after logout.

   Every missing item comes with the command to run on the server.

A Frame running **from source** (development) cannot use a release package. Instead it sends `git archive HEAD` and the server builds it with its own Node 18+. If build tools are missing, Frame names the command to install them.

## Updates and rollback

- When Frame is newer than the server, the dialog offers **Update Frame Server**. If agents are running on the server, Frame lists them and asks before updating, because an update restarts Frame Server and ends its terminals. Claude Code and Codex can resume their sessions afterwards.
- A new version that does not start is rolled back automatically.
- **Roll back to <version>** returns to the previous installed version. The last three versions are kept.
- A Frame and a Frame Server that speak different protocols cannot connect. Frame then offers the update, and nothing else.

## Install without the desktop

```bash
curl -fsSL https://github.com/kaanozhan/Frame/releases/latest/download/install-frame-server.sh | bash
```

The script installs the latest release with the same layout and service. Then use the `frame-server` command (`~/.frame-server/bin/frame-server`):

| Command | What it does |
|---|---|
| `frame-server status [--json]` | installed versions, current and previous, service mode, running state |
| `frame-server logs` | the last lines of the server log |
| `frame-server update [VERSION]` | install VERSION (default: the latest release) |
| `frame-server rollback` | switch back to the previous version |
| `frame-server install-service` | (re)create the service for the current version and start it |
| `frame-server run` | run in the foreground (what the service runs) |

Installer options for special cases are `--package-file FILE --checksum HEX`, `--from-source FILE --version V`, `--service systemd|detached|none` and `--home DIR`. See the header of `scripts/install-frame-server.sh`.

## Requirements on the server

- Linux x86_64 or aarch64. A macOS server works with the manual install below.
- `curl` or `wget`, `tar`, and `sha256sum` or `shasum`. Packages bundle Node 20 and a prebuilt `node-pty`, so no compiler is needed.
- The agent CLIs you use, installed and **signed in on the server as your user**. Frame never handles model credentials.
- Git access to your repositories, through an SSH key or `gh auth setup-git`, because the server clones from your remote.
- For "keeps running after logout": `loginctl enable-linger $USER`. This may need root once.

## Security

- **Access is your SSH.** Frame stores no SSH passwords or keys and runs your own `ssh`.
- **Localhost only.** Frame Server listens on `127.0.0.1`. `--bind <address>` listens elsewhere and prints a warning. Prefer SSH or Tailscale over opening a port.
- **Token.** A random 256-bit token is created on first run in `~/.frame-server/token` (mode 0600) and is required on every connection. To rotate it, delete the file and restart.
- **No browsers.** Connections that carry a browser `Origin` are refused.
- **Verified packages.** A package is installed only after its SHA-256 matches the release's checksum file. A failed or partial download never replaces a working version.

## Files

| Path | What |
|---|---|
| `~/.frame-server/versions/<v>/` | installed versions (`node/`, `app/`, `bin/frame-server`, `VERSION`) |
| `~/.frame-server/current`, `previous` | symlinks to the running and the previous version |
| `~/.frame-server/bin/frame-server` | the `frame-server` command |
| `~/.frame-server/token`, `connection.json` | access token and, while running, port/token/version (both 0600) |
| `~/.frame-server/server.log` | log when running as a background process (systemd: `journalctl --user -u frame-server`) |
| `~/.config/systemd/user/frame-server.service` | the user service |
| `~/frame/projects/<repo>` | the server's clone of each project |
| `~/frame/workspaces/<repo>/<name>` | server workspaces (git worktrees) |

## Manual install (fallback)

If you would rather not use packages, for example on a macOS server or to run a branch, run from a checkout:

```bash
git clone https://github.com/kaanozhan/Frame.git ~/frame-server/Frame
cd ~/frame-server/Frame
npm ci --omit=dev --ignore-scripts   # skip Electron and its rebuild step
npm rebuild node-pty                 # needs build-essential and python3
node src/server/index.js --help
```

Run `node src/server/index.js` under your own service manager. Frame connects to a server started this way and leaves it alone if its version matches. It offers the managed install when Frame is newer.
