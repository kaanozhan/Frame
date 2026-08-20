/**
 * shellSetup — how a lane Frame opens gets told about Frame.
 *
 * `launchEnv` puts `.frame/bin` first on the `PATH` of every PTY Frame spawns,
 * which works right up until the user's own rc files disagree: they run *after*
 * Frame sets the environment, and nvm, Homebrew and pyenv all prepend their own
 * directory. Measured on a developer machine `.frame/bin` ends up sixth, behind
 * the nvm bin that `npm i -g` installs Codex and Gemini into — so the guarantee
 * held only for tools that happened to live elsewhere, and it failed silently.
 *
 * The fix is a shell **function** per tool, defined by a generated file this
 * module knows how to deliver. A function is resolved before any `PATH` search,
 * so the ordering question disappears. The function is a router, not a second
 * injection point: it delegates to `.frame/bin/<id>`, which remains the only
 * thing that composes the preamble and the only thing that honours
 * `FRAME_NO_WRAP=1`.
 *
 * ── What lives here ──
 * The delivery *table*: which shell family a shell path belongs to, how setup
 * reaches that family, the marker that proves it arrived, and what part of a
 * buffered chunk survives that marker. Writing the init files is
 * `aiToolManager`'s job; sending and verifying is `ptyManager`'s.
 *
 * Pure: no fs, no Electron, no spawn — `launchEnv.js` is the shape being
 * copied. The two facts this module cannot derive on its own (whether the
 * folder is really a Frame project, which is an fs question) are passed in.
 */

const path = require('path');
const { FRAME_DIR } = require('../shared/frameConstants');

// Where the generated init files live, relative to `.frame/`. Inside the
// overlay, like everything else Frame writes: no rc file, no ZDOTDIR, no
// registry (the non-invasive-overlay constraint applied to the terminal).
const SHELL_DIR = 'runtime/shell';

const INIT_FILES = {
  posix: 'init.sh',
  fish: 'init.fish',
  powershell: 'init.ps1'
};

/**
 * Which families Frame can actually deliver on a platform.
 *
 * A family being *known* and a family being *deliverable here* are different
 * questions, and conflating them is what the old blanket win32 short-circuit
 * did. Git Bash on Windows resolves to the `posix` family, but its init file
 * defines functions pointing at extensionless wrappers Windows never writes —
 * delivering it would set the lane up to fail rather than leave it alone. The
 * reverse holds too: `init.ps1` must never be offered to a Mac.
 */
function initFamilies(platform = process.platform) {
  return platform === 'win32' ? ['powershell'] : ['posix', 'fish'];
}

// The marker's fixed half. The minted half follows it, and the two are never
// adjacent in anything sent to a shell — see `deliveryFor`.
const MARKER_PREFIX = '__frame_ready_';

// Shell basenames Frame can set up. `sh` and `dash` take the POSIX file;
// `powershell` and `pwsh` take the PowerShell one, which exists because
// nvm-windows reorders `PATH` exactly as nvm does and a function wins over
// any ordering. `nu` and `cmd` are deliberately absent: nushell's function
// and `PATH` model matches no generated file here, and `cmd` has no functions
// at all — `doskey` macros are too fragile to build on, so `cmd` gets the
// `PATH` entry and `PATHEXT` resolution and nothing more. Both are
// `unsupported`, which is silent by design: the lane works, it simply has no
// Frame context.
const FAMILY_BY_SHELL = {
  zsh: 'posix',
  bash: 'posix',
  sh: 'posix',
  dash: 'posix',
  ksh: 'posix',
  fish: 'fish',
  powershell: 'powershell',
  pwsh: 'powershell'
};

/**
 * The shell family a shell path belongs to, or '' when Frame has no init file
 * for it.
 *
 * Basename only: `/opt/homebrew/bin/fish` and `/usr/local/bin/fish` are the
 * same shell, and a login-shell argv0 (`-zsh`) is the same shell too.
 */
function shellFamily(shellPath) {
  if (!shellPath) return '';
  const base = String(shellPath).trim().split(/[\\/]/).pop() || '';
  const name = base.replace(/^-/, '').replace(/\.exe$/i, '').toLowerCase();
  return FAMILY_BY_SHELL[name] || '';
}

/**
 * Absolute path to a project's generated init file for a family, or '' when
 * either is missing.
 *
 * The one place that spells the layout out; `aiToolManager` writes through it
 * rather than rebuilding the path, so the writer and the sender can never
 * disagree about where the file is.
 */
function shellInitPath(projectPath, family) {
  const file = INIT_FILES[family];
  if (!projectPath || !file) return '';
  return path.join(projectPath, FRAME_DIR, ...SHELL_DIR.split('/'), file);
}

/**
 * A marker unique to one terminal and one attempt.
 *
 * Uniqueness across attempts is load-bearing: the retry types a second line,
 * and if it carried the first attempt's token then output still in flight from
 * the first would resolve the second instantly and setup would be reported
 * installed without ever having run.
 */
let mintCount = 0;
function mintMarker(terminalId, attempt = 1) {
  mintCount += 1;
  const safe = String(terminalId == null ? '' : terminalId).replace(/[^A-Za-z0-9]/g, '') || 'lane';
  return `${MARKER_PREFIX}${safe}_${attempt}_${mintCount.toString(36)}`;
}

/**
 * Single-quote a value for a POSIX or fish command line.
 *
 * Both shells treat `'` as fully literal and neither has an escape inside it,
 * so a quote in the path is closed, escaped and reopened. Project paths with
 * an apostrophe are rare and entirely legal.
 */
function singleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Single-quote a value for a PowerShell command line.
 *
 * PowerShell's single-quoted string is literal too — no backtick escapes
 * inside it, which is the whole reason to use it here — and a quote is escaped
 * by doubling rather than by the POSIX close-escape-reopen dance.
 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The `printf` that announces the marker — never containing it.
 *
 * In typed mode the tty echoes the command before running it, so a scan of the
 * output would match the echo and declare setup installed before the shell had
 * done anything at all. The token is therefore emitted as two adjacent quoted
 * fragments, which both shells concatenate at run time: the literal marker
 * exists only in real output. Cheap, and it removes an entire class of
 * false positives.
 */
function markerEcho(marker) {
  const cut = MARKER_PREFIX.length;
  return `printf '%s\\n' ${singleQuote(marker.slice(0, cut))}${singleQuote(marker.slice(cut))}`;
}

/**
 * The same trick in PowerShell: `Write-Output ('<prefix>' + '<token>')`.
 *
 * Concatenated at run time, so the literal marker exists only in real output.
 * PowerShell's delivery is a spawn flag and echoes nothing, but the halves
 * stay apart anyway — the property is the invariant, not the mode that
 * happens to need it today.
 */
function psMarkerEcho(marker) {
  const cut = MARKER_PREFIX.length;
  return `Write-Output (${psQuote(marker.slice(0, cut))} + ${psQuote(marker.slice(cut))})`;
}

/**
 * How setup reaches one lane's shell.
 *
 * Returns one of three shapes:
 *
 *   { mode: 'flag', args: ['-C', '…'], marker }   fish — nothing is typed
 *   { mode: 'type', line: ' . …', marker }        zsh/bash/sh — typed at spawn
 *   { mode: 'none', reason }                      nothing is sent
 *
 * `mode: 'none'` is the answer for a lane with no project, for a folder that
 * is not a Frame project, and for a shell whose family Frame cannot deliver
 * *here* — `cmd` and WSL on Windows, Git Bash too, since its `posix` init
 * file points at wrappers Windows does not write. In every one of those cases
 * nothing is sent and no function or variable is defined; the lane behaves
 * exactly as it did before this module existed, which is what `unsupported`
 * has always meant.
 *
 * zsh and bash get a typed line rather than a flag because the only
 * post-startup hook they offer reroutes the user's own startup files, which
 * Frame does not do. PowerShell takes a flag, so like fish it types nothing.
 */
function deliveryFor(shellPath, platform = process.platform, projectPath = '', options = {}) {
  const { marker = '', isFrameProject = true } = options;

  if (!projectPath) return { mode: 'none', reason: 'no-project' };
  if (!isFrameProject) return { mode: 'none', reason: 'not-a-frame-project' };

  const family = shellFamily(shellPath);
  if (!family) return { mode: 'none', reason: 'unsupported-shell' };
  if (!initFamilies(platform).includes(family)) return { mode: 'none', reason: 'unsupported-shell' };
  if (!marker) return { mode: 'none', reason: 'no-marker' };

  if (family === 'powershell') {
    // -ExecutionPolicy Bypass because a Windows client machine defaults to
    // Restricted, which blocks dot-sourcing an unsigned local .ps1. It lifts
    // the policy for this one process and touches nothing machine-wide — the
    // same bargain launchEnv already makes for PATH. Where Group Policy
    // overrides it the marker never arrives and the lane reports `failed`,
    // which is the designed path rather than a new failure mode.
    return {
      mode: 'flag',
      args: [
        '-ExecutionPolicy', 'Bypass',
        '-NoExit',
        '-Command',
        `. ${psQuote(shellInitPath(projectPath, family))}; ${psMarkerEcho(marker)}`
      ],
      marker
    };
  }

  const initFile = singleQuote(shellInitPath(projectPath, family));
  const echo = markerEcho(marker);

  if (family === 'fish') {
    // `-C` runs after fish's own config, so the function definitions win, and
    // the user sees nothing typed into their terminal.
    return { mode: 'flag', args: ['-C', `source ${initFile}; ${echo}`], marker };
  }

  // The leading space keeps the line out of history where the shell is
  // configured to honour it; the suppression that makes it invisible is
  // `ptyManager`'s buffer, not this space.
  return { mode: 'type', line: ` . ${initFile} && ${echo}`, marker };
}

/**
 * The line a user can paste into a lane to set it up by hand.
 *
 * What the failure row on a lane card offers next to its button — the honest
 * answer to "what would Frame have done here?". Project-relative, because a
 * lane's cwd is its project and a pasted absolute path is unreadable.
 */
function manualCommand(shellPath) {
  const family = shellFamily(shellPath);
  if (!family) return '';
  const rel = `${FRAME_DIR}/${SHELL_DIR}/${INIT_FILES[family]}`;
  // PowerShell dot-sources with the same operator POSIX does, and resolves a
  // relative path with forward slashes without complaint.
  return family === 'fish' ? `source ${rel}` : `. ${rel}`;
}

/**
 * What survives the marker in a buffered chunk.
 *
 * Setup output is held back until the marker proves the shell processed it, at
 * which point everything up to and including the marker's own line is dropped
 * and the remainder — the real first prompt — enters the normal pipeline. A
 * marker whose line has not been terminated yet drops the whole chunk; the
 * prompt arrives in the next one.
 */
function splitOnMarker(chunk, marker) {
  const text = chunk == null ? '' : String(chunk);
  if (!marker) return { found: false, rest: '' };

  const at = text.indexOf(marker);
  if (at === -1) return { found: false, rest: '' };

  const newline = text.indexOf('\n', at + marker.length);
  return { found: true, rest: newline === -1 ? '' : text.slice(newline + 1) };
}

module.exports = {
  SHELL_DIR,
  INIT_FILES,
  MARKER_PREFIX,
  initFamilies,
  shellFamily,
  shellInitPath,
  mintMarker,
  deliveryFor,
  manualCommand,
  splitOnMarker
};
