/**
 * Tool vocabulary — what each CLI calls the things Frame's hooks care about.
 *
 * A hint script wants to ask "is this an edit?" and "which file does it
 * touch?". Before this module it asked "is `tool_name` one of Edit, Write,
 * NotebookEdit?" and read `tool_input.file_path` — both of which are Claude
 * Code's vocabulary, not a universal one. Adding a second CLI that way would
 * put the same mapping in four scripts and make a third CLI a four-file edit.
 *
 * Three roles cover everything the hooks match on:
 *   edit    — the tool that changes a file on disk
 *   shell   — the tool that runs a command
 *   search  — the tool that looks for a pattern
 *
 * Measured against Codex CLI 0.149.1 (see
 * `.frame/specs/codex-parity/measurements.md`), the vocabulary is far smaller
 * than it first looked:
 *
 *   role     claude-code                 codex
 *   edit     Edit, Write, NotebookEdit   apply_patch     ← the only divergence
 *   shell    Bash                        Bash            ← identical
 *   search   Grep, Glob                  — (shell only)  ← Codex has no search tool
 *
 * Codex names its shell tool `Bash` and passes `tool_input.command`, exactly
 * as Claude Code does, so every shell-driven path ports unchanged. The real
 * work is the edit role: Claude Code hands over `tool_input.file_path`, while
 * Codex hands over a patch envelope and the path has to be read out of it.
 *
 * Pure — no fs, no Electron — so it runs under `node --test` and can be
 * required by the dependency-free scripts that ship into `.frame/bin/`.
 *
 * It lives in `scripts/` rather than `src/shared/` for one reason: the hint
 * scripts are copied into a project's `.frame/bin/` and cannot reach the app
 * tree from there. `redact.js` set the pattern — a sibling `require('./x')`
 * for the shipped scripts, `require('../../scripts/x')` for the app — and it
 * ships through `PARSER_FILES` like the rest.
 */

'use strict';

const CLAUDE = 'claude-code';
const CODEX = 'codex';

/**
 * How much `additionalContext` each host inlines before it stops.
 *
 * Claude Code's is exact and load-bearing: past 2000 characters it writes the
 * text to a file and hands the model a preview plus a path, which turns
 * guaranteed delivery back into optional reading — the failure `docs-hint`'s
 * per-section slicing exists to avoid. Codex showed no truncation at 20 000,
 * so the figure below is a floor, not a measured edge; nothing should be
 * built that needs it to be exact.
 */
const INLINE_CAP = {
  [CLAUDE]: 2000,
  [CODEX]: 20000
};

/**
 * `*** Add File: path`, `*** Update File: path`, `*** Delete File: path` and
 * the `*** Move to: path` that can follow an update. One patch may touch
 * several files, so this yields all of them.
 */
const PATCH_TARGET = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/gm;
const PATCH_MOVE = /^\*\*\*\s+Move\s+to:\s*(.+?)\s*$/gm;

function patchPaths(command) {
  const out = [];
  const text = String(command || '');
  for (const re of [PATCH_TARGET, PATCH_MOVE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && !out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

const CLIS = {
  [CLAUDE]: {
    edit: ['Edit', 'Write', 'NotebookEdit'],
    shell: ['Bash'],
    search: ['Grep', 'Glob'],
    editPaths: (input) => {
      const p = input.file_path || input.notebook_path;
      return p ? [String(p)] : [];
    },
    searchPattern: (input) => input.pattern || input.glob || null
  },
  [CODEX]: {
    edit: ['apply_patch'],
    shell: ['Bash'],
    search: [],
    // Codex passes the whole patch in `command`; the paths live in its
    // envelope headers rather than in a field of their own.
    editPaths: (input) => patchPaths(input.command),
    searchPattern: () => null
  }
};

const ROLES = ['edit', 'shell', 'search'];

/** Every tool name any known CLI uses for `role`. */
function toolsFor(role, cli) {
  if (cli) return (CLIS[cli] && CLIS[cli][role]) || [];
  const out = [];
  for (const spec of Object.values(CLIS)) {
    for (const name of spec[role] || []) if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The role a tool name plays, across every known CLI, or null.
 *
 * The union is unambiguous: no name means one thing to one CLI and something
 * else to another. `Bash` appears in both and means the same in both, which
 * is why a script can ask this without first knowing which CLI it is under.
 */
function roleOf(toolName) {
  if (!toolName) return null;
  for (const role of ROLES) {
    if (toolsFor(role).includes(toolName)) return role;
  }
  return null;
}

/** Which CLI a tool name belongs to, or null when it is shared or unknown. */
function cliOfTool(toolName) {
  const owners = Object.keys(CLIS).filter((cli) =>
    ROLES.some((role) => (CLIS[cli][role] || []).includes(toolName)));
  return owners.length === 1 ? owners[0] : null;
}

/**
 * Which CLI produced a hook payload.
 *
 * An explicit `cli` beats everything: Frame writes the hook config, so it can
 * name the CLI on the command line and nothing has to be inferred. The
 * fallbacks exist for a hand-installed hook — first the tool name when it
 * belongs to exactly one CLI, then the fields only Codex sends. Claude Code
 * is the default because it is the generation of hook config that already
 * exists in the field without a `--cli` flag.
 */
function cliOf(payload, explicit) {
  if (explicit && CLIS[explicit]) return explicit;
  const p = payload || {};
  const byTool = cliOfTool(p.tool_name);
  if (byTool) return byTool;
  if (p.turn_id || p.permission_mode || p.model) return CODEX;
  return CLAUDE;
}

/** Files an edit tool call would write, or [] when it is not an edit. */
function editPaths(toolName, toolInput, explicitCli) {
  if (roleOf(toolName) !== 'edit') return [];
  const cli = cliOfTool(toolName) || cliOf({ tool_name: toolName }, explicitCli);
  const spec = CLIS[cli];
  if (!spec) return [];
  try {
    return spec.editPaths(toolInput || []) || [];
  } catch {
    return [];
  }
}

/** The pattern a search tool call is looking for, or null. */
function searchPattern(toolName, toolInput, explicitCli) {
  if (roleOf(toolName) !== 'search') return null;
  const cli = cliOfTool(toolName) || cliOf({ tool_name: toolName }, explicitCli);
  const spec = CLIS[cli];
  if (!spec) return null;
  try {
    return spec.searchPattern(toolInput || {}) || null;
  } catch {
    return null;
  }
}

/** The command a shell tool call would run, or null. */
function shellCommand(toolName, toolInput) {
  if (roleOf(toolName) !== 'shell') return null;
  const cmd = (toolInput || {}).command;
  return typeof cmd === 'string' && cmd ? cmd : null;
}

/**
 * The `matcher` string for a hook that should fire on these roles under one
 * CLI — the value Frame writes into `.claude/settings.json` or
 * `CODEX_HOME/hooks.json`.
 */
function matcherFor(cli, roles) {
  const names = [];
  for (const role of roles) {
    for (const name of toolsFor(role, cli)) if (!names.includes(name)) names.push(name);
  }
  return names.join('|');
}

/** How much additionalContext this CLI inlines before it truncates. */
function inlineCap(cli) {
  return INLINE_CAP[cli] != null ? INLINE_CAP[cli] : INLINE_CAP[CLAUDE];
}

module.exports = {
  CLAUDE,
  CODEX,
  ROLES,
  roleOf,
  cliOf,
  cliOfTool,
  toolsFor,
  editPaths,
  searchPattern,
  shellCommand,
  matcherFor,
  inlineCap,
  patchPaths
};
