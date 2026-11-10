# Frame Server

Frame Server runs your **server workspaces** on a machine you own (a Linux VPS, a Mac mini, a home server). Their terminals and agents run there and keep running when your laptop sleeps. Frame on your Mac connects to it over your own SSH and shows those workspaces in the same window as local ones.

This is the first self-hosted slice (spec `server-workspaces`). Installing and updating the server from the desktop comes later; for now you install it once by hand.

## Requirements on the server

- Linux x64 (arm64 and macOS should work too), with SSH access for your user
- Node.js 18 or newer, plus `git`
- Build tools for `node-pty`: `python3`, `make` and a C++ compiler (`sudo apt install -y build-essential python3` on Debian/Ubuntu)
- The agent CLIs you use (Claude Code, Codex, …), installed and **logged in on the server as your user**. Frame never handles your model credentials.
- Git access to your repositories from the server (an SSH key or credential helper), because the server clones from your remote.

## Install

```bash
git clone https://github.com/kaanozhan/Frame.git ~/frame-server/Frame
cd ~/frame-server/Frame
npm ci --omit=dev --ignore-scripts   # skip Electron and its rebuild step
npm rebuild node-pty                 # build node-pty for this Node
node src/server/index.js --help
```

## Run it as a service (systemd user unit)

Create `~/.config/systemd/user/frame-server.service`:

```ini
[Unit]
Description=Frame Server
After=network-online.target

[Service]
WorkingDirectory=%h/frame-server/Frame
ExecStart=/usr/bin/env node src/server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now frame-server
loginctl enable-linger "$USER"     # keep it running when you are logged out
journalctl --user -u frame-server -f
```

Terminals start your login shell (`-i -l`), so your shell profile (PATH, nvm, …) applies inside them even though the service itself starts with a minimal environment.

## Connect from Frame

In Frame: **File ▸ Connect to Server…**, then pick your SSH host (Frame lists the `Host` entries of your `~/.ssh/config`) or type `user@host`. Frame then:

1. reads `~/.frame-server/connection.json` over SSH (port and token),
2. opens an SSH tunnel to that port (`ssh -N -L …`),
3. connects through the tunnel and keeps reconnecting if the link drops.

Your SSH config does the authentication: keys, agent, jump hosts and Tailscale SSH all work as they do in your terminal.

## Security

- **Access is your SSH.** Frame stores no SSH passwords or keys and runs your own `ssh`.
- **Localhost only.** The server listens on `127.0.0.1` by default. `--bind <address>` listens elsewhere and prints a warning. Prefer SSH or Tailscale over opening a port.
- **Token.** A random 256-bit token is created on first run in `~/.frame-server/token` (mode 0600) and is required on every connection. Delete the file and restart to rotate it.
- **No browsers.** Connections that carry a browser `Origin` are refused, so a web page cannot talk to the server even from the same machine.
- **Same user.** Everything runs as the user that runs the service: shells, agents and git.

## Files

| Path | What |
|---|---|
| `~/.frame-server/token` | the access token (0600) |
| `~/.frame-server/connection.json` | port, token, protocol and version while the server runs (0600) |
| `~/frame/projects/<repo>` | the server's clone of each project ("project home") |
| `~/frame/workspaces/<repo>/<name>` | server workspaces (git worktrees), as on the desktop |

Stopping the server ends its terminals. Agents' own session resume brings conversations back after a restart.
