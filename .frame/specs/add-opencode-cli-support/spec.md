# Add OpenCode CLI support

## Why

Frame supports three AI CLIs today: Claude Code, Codex CLI, Gemini CLI.
A user explicitly asked for OpenCode support, and OpenCode is among the
larger players in the agentic-CLI market — adding it widens Frame's
addressable audience for "I want a desktop home for the agent I already
use" segment, which is a real chunk of new-user friction.

"Works with any AI tool" is already part of Frame's positioning. The
gap between *three* and *all the major ones* shows up as a credibility
gap in the README and on first-use evaluation. Closing it pays off
both in marketing and in raw adoption.

## What's in scope

- New tool entry in `src/main/aiToolManager.js` with the same shape as
  the existing three: id, name, description, detection logic, launch
  command, optional initial-prompt wrapper hint.
- Wrapper script in `.frame/bin/opencode` if OpenCode does not read
  `AGENTS.md` natively. Pattern matches the existing Codex wrapper:
  walk up the directory tree, find `AGENTS.md`, inject a leading
  "please read this file" prompt. Skip the wrapper entirely if
  OpenCode reads `AGENTS.md` natively (same path Gemini takes via
  the `GEMINI.md` symlink).
- Slash command templates under `src/templates/commands/opencode/`:
  `spec.new.md`, `spec.plan.md`, `spec.tasks.md`, `spec.implement.md`.
  Translate the existing Claude Code prompts to OpenCode's prompt
  conventions if they differ; otherwise the Claude Code prompts are
  the baseline and we adapt only where needed.
- AI tool selector UI updates (the existing radio list in the welcome
  modal and the in-app picker) to surface OpenCode as a 4th option.
- `frameProject.js` symlink-creation logic: if OpenCode has a
  conventional filename it reads natively (e.g. `OPENCODE.md`), add
  it to the symlink set alongside `CLAUDE.md` and `GEMINI.md`. If it
  reads `AGENTS.md` directly, no symlink needed.
- Update Frame README to list four supported AI tools.

## What's out of scope

- Changes to OpenCode itself — we adapt to its conventions, we don't
  ask the OpenCode project to change anything for us.
- Per-tool branching in the rest of Frame's code beyond what already
  exists for Claude/Codex/Gemini. If our internal model needs to grow
  to accommodate a 5th, 6th, 7th tool, that's a separate refactor.
- Auto-detection of installed AI tools — Frame's existing detection
  logic already covers this pattern; we only need to add OpenCode to
  the registry. No new detection infrastructure.
- Tool-specific feature flags or advanced settings (model selection,
  context size knobs, etc.). v1 is parity with what we offer the
  other three CLIs.

## Success criteria

- A user with OpenCode installed sees it as a selectable AI tool in
  Frame's welcome modal and tool selector
- Clicking "Start OpenCode" launches OpenCode in the project directory
  with `AGENTS.md` already in context (via native reading or wrapper
  injection)
- `/spec.new`, `/spec.plan`, `/spec.tasks`, `/spec.implement` work
  end-to-end when OpenCode is the active tool — same expected output
  shape as Claude Code (spec.md → plan.md → tasks.md → outcome.md)
- Existing Claude / Codex / Gemini users see zero behavior change
- README and welcome modal copy reflect the 4-tool support

## Out of scope (v1) — but worth noting

- **OpenCode-specific UX polish.** OpenCode's CLI conventions might
  enable better UX than what we use for Claude Code (e.g., richer
  status output, machine-readable progress). v1 is parity; OpenCode-
  specific enhancements come later if/when they prove valuable.
- **Multi-tool simultaneous sessions.** Running Claude in terminal 1
  and OpenCode in terminal 2 already works today via the per-terminal
  shell choice; we don't need new infrastructure for that.

## Open questions for /spec.plan

- Does OpenCode read `AGENTS.md` natively? If yes, no wrapper needed.
  If no, what's the cleanest entry-prompt pattern (CLI flag, env var,
  initial prompt)?
- Does OpenCode have its own convention file (`OPENCODE.md`,
  `.opencode/`, etc.)? If yes, add a symlink so OpenCode finds its
  expected path while `AGENTS.md` stays canonical.
- What's OpenCode's slash-command or instruction convention? Are the
  Claude Code prompts directly usable or do they need translation?
- Which OpenCode versions do we target — current stable only, or
  also the dev channel? Pin a minimum version in the detection
  logic so we don't get bug reports from ancient installs.
