#!/usr/bin/env bash
# install-frame-server.sh — install, update or roll back Frame Server for the
# current user (server-install-update spec). No root, no Docker.
#
# The one installer: Frame desktop runs it over SSH (`bash -s -- …`), and a
# shell user can run it directly:
#
#   curl -fsSL https://github.com/kaanozhan/Frame/releases/latest/download/install-frame-server.sh | bash
#
# Options
#   --version V|latest     version to install (default: latest release)
#   --package-file FILE    install this package tarball instead of downloading
#   --checksum HEX         expected SHA-256 of --package-file
#   --from-source FILE     build from a source tarball (git archive) with this
#                          machine's Node ≥ 18 — used by unreleased desktops
#   --rollback             switch back to the previous installed version
#   --service-only         (re)create the service for the current version
#   --service MODE         auto (default) | systemd | detached | none
#   --home DIR             state folder (default ~/.frame-server)
#
# Layout:  <home>/versions/<v>/{node/bin/node,app/,bin/frame-server,VERSION}
#          <home>/current, <home>/previous (symlinks), <home>/bin/frame-server
# Progress lines start with "frame-install:"; the last line is
#   FRAME_INSTALL_RESULT {"ok":…,"version":…,"service":…,"rolledBack":…,"code":…,"message":…}
# Exit codes: 0 ok · 2 usage · 10 download unavailable · 11 checksum mismatch
#             12 missing build tools · 13 start failed (rolled back) · 14 unsupported platform
#             15 nothing to roll back to · 16 another install is running
set -uo pipefail

RELEASE_BASE="${FRAME_RELEASE_BASE:-https://github.com/kaanozhan/Frame/releases/download}"
LATEST_URL="${FRAME_RELEASE_LATEST:-https://github.com/kaanozhan/Frame/releases/latest}"
KEEP_VERSIONS=3
HEALTH_SECONDS="${FRAME_INSTALL_HEALTH_SECONDS:-25}"

VERSION="latest"; PACKAGE_FILE=""; CHECKSUM=""; SOURCE_FILE=""; MODE="install"; SERVICE="auto"
HOME_DIR="${FRAME_SERVER_HOME:-$HOME/.frame-server}"

say() { echo "frame-install: $*"; }
# A JSON string body: backslash, quote and control characters escaped, so the
# result line always parses whatever a path or message contains (S1).
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
  printf '%s' "$s" | LC_ALL=C tr -d '\000-\010\013\014\016-\037'
}
result() { # ok version service rolledBack code message
  printf 'FRAME_INSTALL_RESULT {"ok":%s,"version":"%s","service":"%s","rolledBack":%s,"code":%s,"message":"%s"}\n' \
    "$1" "$(json_escape "$2")" "$(json_escape "$3")" "$4" "$5" "$(json_escape "$6")"
}
die() { # code message
  say "error: $2"
  result false "${VERSION}" "${SERVICE}" false "$1" "$2"
  exit "$1"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --package-file) PACKAGE_FILE="${2:-}"; shift 2 ;;
    --checksum) CHECKSUM="${2:-}"; shift 2 ;;
    --from-source) SOURCE_FILE="${2:-}"; shift 2 ;;
    --rollback) MODE="rollback"; shift ;;
    --service-only) MODE="service"; shift ;;
    --service) SERVICE="${2:-auto}"; shift 2 ;;
    --home) HOME_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-frame-server: unknown option $1" >&2; exit 2 ;;
  esac
done

export FRAME_SERVER_HOME="$HOME_DIR"
mkdir -p "$HOME_DIR/versions" "$HOME_DIR/tmp" "$HOME_DIR/bin"
chmod 700 "$HOME_DIR"

# One installer at a time per home (S10): an atomic mkdir lock holding our
# pid. A live holder → exit 16; a dead one's lock is taken over once. One
# EXIT trap releases the lock and removes the stage.
LOCK="$HOME_DIR/install.lock"
STAGE=""
take_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid"; return 0; fi
  local holder
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then return 1; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null && echo $$ > "$LOCK/pid"
}
take_lock || die 16 "another install is running for $HOME_DIR (pid $(cat "$LOCK/pid" 2>/dev/null || echo ?)) — wait for it to finish"
trap '[ -n "$STAGE" ] && rm -rf "$STAGE"; [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"' EXIT

# ─── Helpers ──────────────────────────────────────────────────

platform() {
  local s m
  s="$(uname -s | tr '[:upper:]' '[:lower:]')"; m="$(uname -m)"
  case "$m" in x86_64|amd64) m=x64 ;; aarch64|arm64) m=arm64 ;; *) echo ""; return ;; esac
  case "$s" in linux|darwin) echo "$s-$m" ;; *) echo "" ;; esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
  else return 127; fi
}

link_target() { [ -L "$1" ] && basename "$(readlink "$1")" || echo ""; }

# The home with symlinks resolved (the server runs from the resolved path).
HOME_REAL="$(cd "$HOME_DIR" 2>/dev/null && pwd -P || echo "$HOME_DIR")"

# Is <pid> this home's Frame Server? Only when its command line runs from this
# home: a recorded pid may since belong to another process (S7).
is_frame_pid() {
  local pid="$1" args=""
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/cmdline" ]; then args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"; fi
  [ -n "$args" ] || args="$(ps -o args= -p "$pid" 2>/dev/null)"
  case "$args" in *"$HOME_DIR/"*|*"$HOME_REAL/"*) return 0 ;; esac
  return 1
}

running_pid() {
  local f="$HOME_DIR/connection.json" pid
  [ -f "$f" ] || return 0
  pid="$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$f" | head -n1)"
  is_frame_pid "$pid" && echo "$pid"
}

running_version() {
  local f="$HOME_DIR/connection.json"
  [ -f "$f" ] && sed -n 's/.*"frameVersion": *"\([^"]*\)".*/\1/p' "$f" | head -n1
}

systemd_ok() {
  [ "$SERVICE" = "detached" ] || [ "$SERVICE" = "none" ] && return 1
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

# The user unit serves the default home only (its ExecStart is
# %h/.frame-server): a run for any other --home never starts, stops or
# signals it (S6).
uses_systemd() {
  local def
  def="$(cd "$HOME/.frame-server" 2>/dev/null && pwd -P || echo "$HOME/.frame-server")"
  [ "$HOME_REAL" = "$def" ] && systemd_ok
}

write_unit() {
  local dir="$HOME/.config/systemd/user"
  mkdir -p "$dir"
  cat > "$dir/frame-server.service" <<'UNIT'
[Unit]
Description=Frame Server
After=network-online.target

[Service]
ExecStart=%h/.frame-server/current/bin/frame-server run
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
}

stop_server() {
  if uses_systemd && systemctl --user is-active frame-server >/dev/null 2>&1; then
    systemctl --user stop frame-server || true
  fi
  local pid
  pid="$(running_pid || true)"
  [ -z "$pid" ] && [ -f "$HOME_DIR/server.pid" ] && pid="$(cat "$HOME_DIR/server.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && is_frame_pid "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
  fi
  rm -f "$HOME_DIR/server.pid" "$HOME_DIR/connection.json"
}

# Start the current version; sets SERVICE_USED. Never call it inside $(…):
# its progress lines (the linger advice) would be captured into the mode (S1).
start_server() {
  if [ "$SERVICE" = "none" ]; then SERVICE_USED=none; return; fi
  if uses_systemd; then
    write_unit
    systemctl --user daemon-reload
    systemctl --user enable frame-server >/dev/null 2>&1 || true
    systemctl --user restart frame-server
    if command -v loginctl >/dev/null 2>&1 && [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
      loginctl enable-linger "$USER" >/dev/null 2>&1 || say "linger is off and could not be enabled — as root run: loginctl enable-linger $USER"
    fi
    SERVICE_USED=systemd
  else
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup "$HOME_DIR/current/bin/frame-server" run >> "$HOME_DIR/server.log" 2>&1 < /dev/null &
    else
      nohup "$HOME_DIR/current/bin/frame-server" run >> "$HOME_DIR/server.log" 2>&1 < /dev/null &
    fi
    echo $! > "$HOME_DIR/server.pid"
    SERVICE_USED=detached
  fi
}

# Nothing to fall back to: leave nothing running or restarting (S3). The unit
# is disabled and removed (systemd), or the detached server stopped.
quiesce() {
  if uses_systemd; then
    systemctl --user disable --now frame-server >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/frame-server.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  stop_server
  say "Frame Server is stopped: there is no working version to run"
}

# Wait until the running server reports version $1.
healthy() {
  [ "$SERVICE" = "none" ] && return 0
  local want="$1" i
  for i in $(seq 1 $((HEALTH_SECONDS * 5))); do
    if [ -n "$(running_pid || true)" ] && [ "$(running_version)" = "$want" ]; then return 0; fi
    sleep 0.2
  done
  return 1
}

switch_to() { # version — current → versions/<v>, previous → old current
  local old
  old="$(link_target "$HOME_DIR/current")"
  ln -sfn "$HOME_DIR/versions/$1" "$HOME_DIR/current"
  if [ -n "$old" ] && [ "$old" != "$1" ]; then ln -sfn "$HOME_DIR/versions/$old" "$HOME_DIR/previous"; fi
  ln -sfn "$HOME_DIR/current/bin/frame-server" "$HOME_DIR/bin/frame-server"
}

prune() {
  local keep_cur keep_prev count=0 v
  keep_cur="$(link_target "$HOME_DIR/current")"; keep_prev="$(link_target "$HOME_DIR/previous")"
  # newest first by modification time
  for v in $(ls -1t "$HOME_DIR/versions" 2>/dev/null); do
    case "$v" in *.partial) rm -rf "${HOME_DIR:?}/versions/$v"; continue ;; esac
    if [ "$v" = "$keep_cur" ] || [ "$v" = "$keep_prev" ]; then continue; fi
    count=$((count + 1))
    if [ $count -gt $((KEEP_VERSIONS - 2)) ]; then rm -rf "${HOME_DIR:?}/versions/$v"; say "removed old version $v"; fi
  done
}

# Start the current version and check it; on failure go back to $1 (the old current).
activate() { # new_version old_version
  stop_server
  start_server
  if healthy "$1"; then return 0; fi
  say "Frame Server $1 did not start — going back to ${2:-nothing}"
  [ -f "$HOME_DIR/server.log" ] && tail -n 20 "$HOME_DIR/server.log" | sed 's/^/frame-install:   /'
  if [ -n "$2" ] && [ -d "$HOME_DIR/versions/$2" ]; then
    ln -sfn "$HOME_DIR/versions/$2" "$HOME_DIR/current"
    stop_server
    start_server
    healthy "$2" && return 1
    say "the previous version $2 did not start either"
  fi
  # A reinstall of the running version is restored by its caller; anything
  # else has nothing left to run.
  [ "${3:-}" = "keep" ] || quiesce
  return 1
}

# ─── Rollback / service only ──────────────────────────────────

SERVICE_USED="$SERVICE"
if [ "$MODE" = "rollback" ]; then
  prev="$(link_target "$HOME_DIR/previous")"; cur="$(link_target "$HOME_DIR/current")"
  [ -n "$prev" ] && [ -d "$HOME_DIR/versions/$prev" ] || die 15 "there is no previous version to roll back to"
  VERSION="$prev"
  say "rolling back from ${cur:-none} to $prev"
  ln -sfn "$HOME_DIR/versions/$prev" "$HOME_DIR/current"
  if activate "$prev" "$cur"; then
    # Only now does the old current become the rollback target (S5): a
    # failed rollback leaves current and previous exactly as they were.
    [ -n "$cur" ] && ln -sfn "$HOME_DIR/versions/$cur" "$HOME_DIR/previous"
    result true "$prev" "$SERVICE_USED" false 0 "Rolled back to $prev"; exit 0
  fi
  result false "$prev" "$SERVICE_USED" true 13 "Frame Server $prev did not start; restored $cur"; exit 13
fi
if [ "$MODE" = "service" ]; then
  cur="$(link_target "$HOME_DIR/current")"
  [ -n "$cur" ] || die 15 "Frame Server is not installed"
  VERSION="$cur"
  if activate "$cur" ""; then result true "$cur" "$SERVICE_USED" false 0 "Service running $cur"; exit 0; fi
  result false "$cur" "$SERVICE_USED" false 13 "Frame Server $cur did not start"; exit 13
fi

# ─── Install ──────────────────────────────────────────────────

PLATFORM="$(platform)"
[ -n "$PLATFORM" ] || die 14 "unsupported platform $(uname -s) $(uname -m) — Frame Server packages exist for Linux x86_64 and aarch64"

# Packages are built against glibc 2.28 (the floor of the bundled Node 20):
# refuse older glibc and musl up front, naming the requirement (S2). A build
# from source uses this machine's own Node, so it is not checked here.
GLIBC_FLOOR="2.28"
check_libc() {
  local v ldd_out
  v="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
  if [ -z "$v" ]; then
    ldd_out="$(ldd --version 2>&1 || true)"
    case "$ldd_out" in
      *musl*) die 14 "Frame Server packages need glibc $GLIBC_FLOOR or newer; this system uses musl (Alpine and similar) — use Debian 10+, Ubuntu 20.04+, RHEL/Rocky/Alma 8+ or Amazon Linux 2023" ;;
    esac
    v="$(printf '%s\n' "$ldd_out" | sed -n 's/.* \([0-9][0-9]*\.[0-9][0-9]*\)$/\1/p' | head -n1)"
  fi
  [ -n "$v" ] || { say "warning: could not read the glibc version; Frame Server needs glibc $GLIBC_FLOOR or newer"; return 0; }
  if [ "$(printf '%s\n%s\n' "$GLIBC_FLOOR" "$v" | sort -t. -k1,1n -k2,2n | head -n1)" != "$GLIBC_FLOOR" ]; then
    die 14 "Frame Server packages need glibc $GLIBC_FLOOR or newer; this system has glibc $v — use Debian 10+, Ubuntu 20.04+, RHEL/Rocky/Alma 8+ or Amazon Linux 2023 (Amazon Linux 2 and CentOS 7 are too old)"
  fi
}
case "$PLATFORM" in linux-*) [ -n "$SOURCE_FILE" ] || check_libc ;; esac
STAGE="$HOME_DIR/tmp/install-$$"
rm -rf "$STAGE"; mkdir -p "$STAGE"

if [ -n "$SOURCE_FILE" ]; then
  # Build from source with this machine's tools.
  [ "$VERSION" != "latest" ] || die 2 "--from-source needs --version"
  missing=""
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    [ "${major:-0}" -ge 18 ] || missing="$missing node>=18"
  else
    missing="$missing node>=18"
  fi
  command -v npm >/dev/null 2>&1 || missing="$missing npm"
  command -v make >/dev/null 2>&1 || missing="$missing make"
  { command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1; } || missing="$missing g++"
  command -v python3 >/dev/null 2>&1 || missing="$missing python3"
  [ -z "$missing" ] || die 12 "building from source needs:$missing — on Debian/Ubuntu: sudo apt install -y build-essential python3 nodejs npm (Node 18 or newer)"
  say "building Frame Server $VERSION from source with Node $(node -v)"
  mkdir -p "$STAGE/pkg/app" "$STAGE/pkg/bin" "$STAGE/pkg/node/bin"
  tar -xf "$SOURCE_FILE" -C "$STAGE/pkg/app" || die 2 "the source tarball could not be unpacked"
  ( cd "$STAGE/pkg/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null && npm rebuild node-pty --loglevel=error >/dev/null && node scripts/fix-node-pty-helper.js ) \
    || die 12 "the build failed (npm ci / npm rebuild node-pty) — see the output above"
  [ -f "$STAGE/pkg/app/node_modules/node-pty/build/Release/spawn-helper" ] && chmod 755 "$STAGE/pkg/app/node_modules/node-pty/build/Release/spawn-helper"
  ln -s "$(command -v node)" "$STAGE/pkg/node/bin/node"
  cp "$STAGE/pkg/app/src/server/bin/frame-server" "$STAGE/pkg/bin/frame-server"
  chmod 755 "$STAGE/pkg/bin/frame-server"
  echo "$VERSION" > "$STAGE/pkg/VERSION"
  PKGDIR="$STAGE/pkg"
else
  if [ -z "$PACKAGE_FILE" ]; then
    # FRAME_INSTALL_ANY_PLATFORM=1 lets the test suite exercise downloads on a Mac.
    case "$PLATFORM" in linux-*) ;; *) [ "${FRAME_INSTALL_ANY_PLATFORM:-}" = "1" ] || die 14 "Frame Server packages are built for Linux; this is $PLATFORM" ;; esac
    if [ "$VERSION" = "latest" ]; then
      tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$LATEST_URL" 2>/dev/null | sed -n 's#.*/tag/v\{0,1\}##p')"
      [ -n "$tag" ] || die 10 "could not find the latest release (no curl, or GitHub unreachable)"
      VERSION="$tag"
    fi
    asset="frame-server-$VERSION-$PLATFORM.tar.gz"
    say "downloading $asset"
    fetch "$RELEASE_BASE/v$VERSION/$asset" "$STAGE/$asset" || die 10 "could not download $asset from GitHub — the desktop can upload it instead"
    fetch "$RELEASE_BASE/v$VERSION/$asset.sha256" "$STAGE/$asset.sha256" || die 10 "could not download the checksum for $asset"
    CHECKSUM="$(awk '{print $1; exit}' "$STAGE/$asset.sha256")"
    PACKAGE_FILE="$STAGE/$asset"
  fi
  [ -f "$PACKAGE_FILE" ] || die 2 "no package at $PACKAGE_FILE"
  if [ -n "$CHECKSUM" ]; then
    actual="$(sha256_of "$PACKAGE_FILE")"
    [ "$actual" = "$(echo "$CHECKSUM" | tr '[:upper:]' '[:lower:]')" ] || die 11 "checksum mismatch for $(basename "$PACKAGE_FILE") — nothing was installed"
    say "checksum verified"
  else
    say "warning: no checksum given for $(basename "$PACKAGE_FILE")"
  fi
  mkdir -p "$STAGE/unpack"
  tar -xzf "$PACKAGE_FILE" -C "$STAGE/unpack" || die 2 "the package could not be unpacked"
  PKGDIR="$(find "$STAGE/unpack" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [ -x "$PKGDIR/bin/frame-server" ] || die 2 "the package has no bin/frame-server"
  pkgver="$(cat "$PKGDIR/VERSION" 2>/dev/null || true)"
  [ "$VERSION" = "latest" ] && VERSION="$pkgver"
  [ "$pkgver" = "$VERSION" ] || die 2 "the package is $pkgver, not $VERSION"
fi

OLD="$(link_target "$HOME_DIR/current")"
OLD_PREV="$(link_target "$HOME_DIR/previous")"
TARGET="$HOME_DIR/versions/$VERSION"
REINSTALL_CURRENT=""
if [ -d "$TARGET" ]; then
  # An installed copy of this version (the running one, or the rollback
  # target): keep it aside until the new one starts, and put it back on
  # failure (S5).
  mv "$TARGET" "$TARGET.replaced.$$"
  if [ "$OLD" = "$VERSION" ]; then OLD=""; REINSTALL_CURRENT=1; fi
fi
rm -rf "$TARGET.partial" && mv "$PKGDIR" "$TARGET.partial" && mv "$TARGET.partial" "$TARGET" || die 2 "could not place $VERSION"
switch_to "$VERSION"
say "installed $VERSION in $TARGET"

if activate "$VERSION" "$OLD" "${REINSTALL_CURRENT:+keep}"; then
  rm -rf "$TARGET.replaced.$$"
  prune
  say "Frame Server $VERSION is running ($SERVICE_USED)"
  result true "$VERSION" "$SERVICE_USED" false 0 "Frame Server $VERSION is running"
  exit 0
fi
if [ -n "$REINSTALL_CURRENT" ]; then
  # A reinstall of the running version failed: put the old copy back.
  rm -rf "$TARGET"; mv "$TARGET.replaced.$$" "$TARGET"
  stop_server; start_server
  healthy "$VERSION" || quiesce
else
  # The new version never ran: drop it, restore an installed copy it
  # replaced, and leave current/previous as they were.
  rm -rf "${TARGET:?}"
  [ -d "$TARGET.replaced.$$" ] && mv "$TARGET.replaced.$$" "$TARGET"
  if [ -n "$OLD_PREV" ]; then ln -sfn "$HOME_DIR/versions/$OLD_PREV" "$HOME_DIR/previous"; else rm -f "$HOME_DIR/previous"; fi
  if [ -z "$OLD" ]; then
    # A first install: nothing may point at the deleted version.
    rm -f "$HOME_DIR/current" "$HOME_DIR/bin/frame-server"
  fi
fi
result false "$VERSION" "$SERVICE_USED" true 13 "Frame Server $VERSION did not start; ${OLD:-nothing} restored"
exit 13
